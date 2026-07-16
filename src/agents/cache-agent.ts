/**
 * Cache Agent — manages the Supabase PostgreSQL Request_Cache.
 * Handles storage, retrieval, and expiration of cached scoring results.
 * Implements graceful degradation: cache failures never halt the scoring pipeline.
 * Enforces row-level security (NIGHTSCORE service role only).
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { MessageBus } from '../bus/message-bus.js';

// Timer type declarations for environment-agnostic usage
declare function setTimeout(callback: () => void, ms: number): number;

/**
 * A single cached scoring result entry.
 */
export interface CacheEntry {
  walletAddress: string;
  signalHash: string;
  creditGrade: string;
  reasoning: Record<string, unknown>[];
  computedAt: number; // Unix ms timestamp
}

/**
 * Abstraction over the Supabase cache for testability.
 * Enforces RLS: only the NIGHTSCORE service role can read/write.
 */
export interface CacheStore {
  get(walletAddress: string, signalHash: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
}

const VALID_GRADES = new Set(['AAA', 'AA', 'A', 'BBB', 'BB', 'C']);

const DEFAULT_TTL_MS = 86_400_000; // 24 hours
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_CONNECTION_POOL_SIZE = 5;
const MIN_POOL_SIZE = 1;
const MAX_POOL_SIZE = 20;

/**
 * Delays execution for the specified duration.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Cache Agent implementation.
 * Processes "check-cache" and "store-result" requests with retry logic
 * and graceful degradation on persistent failures.
 */
export class CacheAgent implements Agent {
  readonly id = 'cache-agent';
  readonly name = 'Cache Agent';

  private state: AgentLifecycleState = 'idle';
  private startTime: number = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;

  // Behavior Profile parameters
  private ttlMs: number = DEFAULT_TTL_MS;
  private maxRetries: number = DEFAULT_MAX_RETRIES;
  private retryDelayMs: number = DEFAULT_RETRY_DELAY_MS;
  private _connectionPoolSize: number = DEFAULT_CONNECTION_POOL_SIZE;

  constructor(
    private readonly bus: MessageBus,
    private readonly store: CacheStore
  ) {}

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startMs = Date.now();
    this.requestCount++;

    let result: ResponseMessage | ErrorMessage;

    if (message.type !== 'request') {
      this.errorCount++;
      result = this.createErrorResponse(message, 'unsupported-type', `Unsupported message type: ${message.type}`);
    } else if (message.topic === 'cache.check-cache') {
      result = await this.handleCheckCache(message);
    } else if (message.topic === 'cache.store-result') {
      result = await this.handleStoreResult(message);
    } else {
      this.errorCount++;
      result = this.createErrorResponse(message, 'unsupported-topic', `Unsupported topic: ${message.topic}`);
    }

    const elapsed = Date.now() - startMs;
    this.totalResponseTimeMs += elapsed;
    return result;
  }

  getHealth(): AgentHealth {
    return {
      state: this.state,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTimeMs: this.requestCount > 0
        ? Math.round(this.totalResponseTimeMs / this.requestCount)
        : 0,
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        topic: 'cache.check-cache',
        description: 'Check the Request Cache for a valid cached scoring result',
      },
      {
        topic: 'cache.store-result',
        description: 'Store a scoring result in the Request Cache',
      },
    ];
  }

  async initialize(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
    this.state = 'idle';
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.startTime = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
  }

  /**
   * Exposes connection pool size for testing profile application.
   */
  get connectionPoolSize(): number {
    return this._connectionPoolSize;
  }

  private applyProfile(profile: BehaviorProfile): void {
    const ttl = profile.parameters.ttlMs;
    if (typeof ttl === 'number' && ttl > 0) {
      this.ttlMs = ttl;
    }

    const poolSize = profile.parameters.connectionPoolSize;
    if (typeof poolSize === 'number' && poolSize >= MIN_POOL_SIZE && poolSize <= MAX_POOL_SIZE) {
      this._connectionPoolSize = poolSize;
    }

    const retries = profile.parameters.maxRetries;
    if (typeof retries === 'number' && retries >= 0) {
      this.maxRetries = retries;
    }

    const retryDelay = profile.parameters.retryDelayMs;
    if (typeof retryDelay === 'number' && retryDelay >= 0) {
      this.retryDelayMs = retryDelay;
    }
  }

  /**
   * Handle "check-cache" requests.
   * Returns cached grade + reasoning if a valid entry exists (matching hash, within TTL).
   * Returns cache-miss with wallet address and hash when no valid entry.
   * On persistent failure, returns cache-unavailable (graceful degradation).
   */
  private async handleCheckCache(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const payload = message.payload as Record<string, unknown>;
    const walletAddress = payload.walletAddress as string | undefined;
    const signalHash = payload.signalHash as string | undefined;

    if (!walletAddress || typeof walletAddress !== 'string') {
      this.errorCount++;
      return this.createErrorResponse(message, 'validation-error', 'walletAddress is required');
    }

    if (!signalHash || typeof signalHash !== 'string') {
      this.errorCount++;
      return this.createErrorResponse(message, 'validation-error', 'signalHash is required');
    }

    // Attempt cache read with retries
    let entry: CacheEntry | null;
    try {
      entry = await this.withRetry(() => this.store.get(walletAddress, signalHash), 'read');
    } catch (_error: unknown) {
      // Graceful degradation: cache unavailable, don't halt pipeline
      return this.createResponse(message, { cacheAvailable: false });
    }

    if (entry && (Date.now() - entry.computedAt) < this.ttlMs) {
      // Cache hit: valid entry within TTL
      return this.createResponse(message, {
        hit: true,
        grade: entry.creditGrade,
        reasoning: entry.reasoning,
      });
    }

    // Cache miss
    return this.createResponse(message, {
      hit: false,
      walletAddress,
      signalHash,
    });
  }

  /**
   * Handle "store-result" requests.
   * Validates all fields, writes to cache (overwriting existing for same wallet).
   * On persistent failure, returns cache-unavailable (graceful degradation).
   */
  private async handleStoreResult(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const payload = message.payload as Record<string, unknown>;

    // Validate required fields
    const missingFields: string[] = [];

    const walletAddress = payload.walletAddress;
    if (!walletAddress || typeof walletAddress !== 'string') {
      missingFields.push('walletAddress');
    }

    const signalHash = payload.signalHash;
    if (!signalHash || typeof signalHash !== 'string') {
      missingFields.push('signalHash');
    }

    const creditGrade = payload.creditGrade;
    if (!creditGrade || typeof creditGrade !== 'string') {
      missingFields.push('creditGrade');
    }

    const reasoning = payload.reasoning;
    if (reasoning === undefined || reasoning === null) {
      missingFields.push('reasoning');
    }

    const timestamp = payload.timestamp;
    if (timestamp === undefined || timestamp === null || typeof timestamp !== 'number') {
      missingFields.push('timestamp');
    }

    if (missingFields.length > 0) {
      this.errorCount++;
      return this.createErrorResponse(
        message,
        'validation-error',
        `Missing required fields: ${missingFields.join(', ')}`
      );
    }

    // Validate creditGrade is in the allowed set
    if (!VALID_GRADES.has(creditGrade as string)) {
      this.errorCount++;
      return this.createErrorResponse(
        message,
        'validation-error',
        `Invalid creditGrade: must be one of ${[...VALID_GRADES].join(', ')}`
      );
    }

    const entry: CacheEntry = {
      walletAddress: walletAddress as string,
      signalHash: signalHash as string,
      creditGrade: creditGrade as string,
      reasoning: Array.isArray(reasoning) ? reasoning as Record<string, unknown>[] : [reasoning as Record<string, unknown>],
      computedAt: timestamp as number,
    };

    // Attempt cache write with retries
    try {
      await this.withRetry(() => this.store.set(entry), 'write');
    } catch (_error: unknown) {
      // Graceful degradation: cache unavailable, don't halt pipeline
      return this.createResponse(message, { cacheAvailable: false });
    }

    return this.createResponse(message, { stored: true });
  }

  /**
   * Execute an operation with retry logic.
   * On persistent failure, publishes "cache.failure" event and throws.
   */
  private async withRetry<T>(operation: () => Promise<T>, operationType: 'read' | 'write'): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await delay(this.retryDelayMs);
        }
      }
    }

    // All retries exhausted — publish failure event
    await this.publishCacheFailureEvent(operationType);
    throw lastError;
  }

  /**
   * Publish a "cache.failure" event when all retries are exhausted.
   */
  private async publishCacheFailureEvent(operation: 'read' | 'write'): Promise<void> {
    try {
      await this.bus.publish({
        id: uuidv4(),
        sourceAgentId: this.id,
        targetAgentId: null,
        type: 'event',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'cache.failure',
        payload: {
          operation,
          timestamp: Date.now(),
        },
      });
    } catch (_publishError: unknown) {
      // Even event publishing failure should not halt the pipeline
    }
  }

  private createResponse(message: BusMessage, payload: Record<string, unknown>): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: message.sourceAgentId,
      type: 'response',
      correlationId: message.correlationId,
      timestamp: Date.now(),
      topic: message.topic,
      payload,
    };
  }

  private createErrorResponse(message: BusMessage, code: string, description: string): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: message.sourceAgentId,
      type: 'error',
      correlationId: message.correlationId,
      timestamp: Date.now(),
      topic: message.topic,
      payload: { code, description },
    };
  }
}

export default CacheAgent;
