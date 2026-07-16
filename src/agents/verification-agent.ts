/**
 * Verification Agent — handles threshold verification queries against the Compact Contract.
 * Returns boolean results indicating whether a wallet's credential grade meets a minimum threshold.
 * Privacy-first: never discloses actual grades or signals in responses or events.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { MessageBus } from '../bus/message-bus.js';

// Timer type declarations for environment-agnostic usage
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

/**
 * Abstraction over the Compact Contract for testability.
 */
export interface VerificationContract {
  getCredentialGrade(walletAddress: string): Promise<string | null>;
  isAvailable(): Promise<boolean>;
}

const GRADE_ORDER: Record<string, number> = {
  'AAA': 5,
  'AA': 4,
  'A': 3,
  'BBB': 2,
  'BB': 1,
  'C': 0,
};

const VALID_GRADES = new Set(['AAA', 'AA', 'A', 'BBB', 'BB', 'C']);

const DEFAULT_CONTRACT_TIMEOUT_MS = 2000;
const MIN_WALLET_ADDRESS_LENGTH = 10;

/**
 * Verification Agent implementation.
 * Processes "verify-threshold" requests and returns boolean results
 * without disclosing actual grades or signals.
 */
export class VerificationAgent implements Agent {
  readonly id = 'verification-agent';
  readonly name = 'Verification Agent';

  private state: AgentLifecycleState = 'idle';
  private startTime: number = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;
  private contractTimeoutMs: number = DEFAULT_CONTRACT_TIMEOUT_MS;

  constructor(
    private readonly bus: MessageBus,
    private readonly contract: VerificationContract
  ) {}

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startMs = Date.now();
    this.requestCount++;

    if (message.type !== 'request' || message.topic !== 'verification.verify-threshold') {
      this.errorCount++;
      const elapsed = Date.now() - startMs;
      this.totalResponseTimeMs += elapsed;
      return this.createErrorResponse(message, 'unsupported-topic', `Unsupported topic: ${message.topic}`);
    }

    const payload = message.payload as Record<string, unknown>;
    const walletAddress = payload.walletAddress as string | undefined;
    const minimumGrade = payload.minimumGrade as string | undefined;
    const queryingAddress = payload.queryingAddress as string | undefined;

    // Input validation: minimumGrade
    if (!minimumGrade || !VALID_GRADES.has(minimumGrade)) {
      this.errorCount++;
      const elapsed = Date.now() - startMs;
      this.totalResponseTimeMs += elapsed;
      return this.createErrorResponse(message, 'invalid-grade', `Invalid minimum grade: must be one of ${[...VALID_GRADES].join(', ')}`);
    }

    // Input validation: walletAddress
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.length < MIN_WALLET_ADDRESS_LENGTH) {
      this.errorCount++;
      const elapsed = Date.now() - startMs;
      this.totalResponseTimeMs += elapsed;
      return this.createErrorResponse(message, 'invalid-address', 'Invalid wallet address: must be a non-empty string of at least 10 characters');
    }

    // Contract call with timeout
    let actualGrade: string | null;
    try {
      actualGrade = await this.callContractWithTimeout(walletAddress);
    } catch (_error: unknown) {
      this.errorCount++;
      const elapsed = Date.now() - startMs;
      this.totalResponseTimeMs += elapsed;
      return this.createErrorResponse(message, 'temporary-unavailable', 'Compact Contract is temporarily unavailable');
    }

    // Publish verification.queried event (privacy: only timestamp and querying address)
    await this.publishQueriedEvent(queryingAddress ?? message.sourceAgentId);

    // No credential found
    if (actualGrade === null) {
      const elapsed = Date.now() - startMs;
      this.totalResponseTimeMs += elapsed;
      return this.createResponse(message, { result: null, reason: 'no-credential-found' });
    }

    // Threshold comparison — privacy: only boolean result disclosed
    const actualOrder = GRADE_ORDER[actualGrade];
    const minimumOrder = GRADE_ORDER[minimumGrade];
    const meetsThreshold = actualOrder !== undefined && minimumOrder !== undefined && actualOrder >= minimumOrder;

    const elapsed = Date.now() - startMs;
    this.totalResponseTimeMs += elapsed;
    return this.createResponse(message, { result: meetsThreshold });
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
        topic: 'verification.verify-threshold',
        description: 'Verifies whether a wallet credential meets a minimum grade threshold',
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

  private applyProfile(profile: BehaviorProfile): void {
    const timeout = profile.parameters.contractTimeoutMs;
    if (typeof timeout === 'number' && timeout > 0) {
      this.contractTimeoutMs = timeout;
    }
  }

  private async callContractWithTimeout(walletAddress: string): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Contract call timed out'));
        }
      }, this.contractTimeoutMs);

      this.contract.getCredentialGrade(walletAddress).then(
        (result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        }
      );
    });
  }

  private async publishQueriedEvent(queryingAddress: string): Promise<void> {
    await this.bus.publish({
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic: 'verification.queried',
      payload: {
        timestamp: new Date().toISOString(),
        queryingAddress,
      },
    });
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

export default VerificationAgent;
