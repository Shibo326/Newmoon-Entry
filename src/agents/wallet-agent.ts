/**
 * Wallet Agent implementation.
 * Manages Lace Wallet connection state, session persistence,
 * and wallet-related events for the NightScore agent pipeline.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { MessageBus } from '../bus/message-bus.js';

/**
 * Abstraction over the Lace Wallet DApp Connector API.
 * Allows testability without requiring a real browser extension.
 */
export interface WalletConnector {
  connect(timeoutMs: number): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getAddress(): string | null;
  onDisconnect(callback: () => void): void;
}

/**
 * Abstraction over browser session storage for testability.
 */
export interface SessionStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const AGENT_ID = 'wallet-agent';
const AGENT_NAME = 'Wallet Agent';
const DEFAULT_SESSION_KEY = 'ns_wallet_session';
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

export class WalletAgent implements Agent {
  readonly id = AGENT_ID;
  readonly name = AGENT_NAME;

  private state: AgentLifecycleState = 'idle';
  private activatedAt: number | null = null;
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;
  private connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS;
  private readonly sessionStorageKey: string;

  constructor(
    private readonly bus: MessageBus,
    private readonly connector: WalletConnector,
    private readonly storage: SessionStorage,
    sessionStorageKey?: string
  ) {
    this.sessionStorageKey = sessionStorageKey ?? DEFAULT_SESSION_KEY;
  }

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startTime = Date.now();
    this.requestCount++;

    try {
      let result: ResponseMessage | ErrorMessage;

      switch (message.topic) {
        case 'wallet.connect':
          result = await this.handleConnect(message);
          break;
        case 'wallet.validate-session':
          result = await this.handleValidateSession(message);
          break;
        case 'wallet.disconnect':
          result = await this.handleDisconnect(message);
          break;
        default:
          result = this.createErrorResponse(message, 'UNKNOWN_TOPIC', `Unknown topic: ${message.topic}`);
          break;
      }

      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;

      if (result.type === 'error') {
        this.errorCount++;
      }

      return result;
    } catch (_err: unknown) {
      this.errorCount++;
      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;
      const description = _err instanceof Error ? _err.message : 'Unknown internal error';
      return this.createErrorResponse(message, 'INTERNAL_ERROR', description);
    }
  }

  getHealth(): AgentHealth {
    const now = Date.now();
    const uptimeSeconds = this.activatedAt !== null
      ? Math.floor((now - this.activatedAt) / 1000)
      : 0;
    const avgResponseTimeMs = this.requestCount > 0
      ? this.totalResponseTimeMs / this.requestCount
      : 0;

    return {
      state: this.state,
      uptimeSeconds,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTimeMs,
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      { topic: 'wallet.connect', description: 'Initiate Lace Wallet connection' },
      { topic: 'wallet.validate-session', description: 'Verify active wallet session' },
      { topic: 'wallet.disconnect', description: 'Disconnect wallet and clear session' },
    ];
  }

  async initialize(profile: BehaviorProfile): Promise<void> {
    if (profile.parameters['connectionTimeoutMs'] !== undefined) {
      this.connectionTimeoutMs = profile.parameters['connectionTimeoutMs'] as number;
    }
    if (profile.parameters['sessionStorageKey'] !== undefined) {
      // sessionStorageKey from profile is informational; constructor key takes precedence
    }

    // Register unexpected disconnect handler
    this.connector.onDisconnect(() => {
      void this.handleUnexpectedDisconnect();
    });

    // Attempt auto-reconnect from session storage
    await this.attemptAutoReconnect();
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.activatedAt = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    if (profile.parameters['connectionTimeoutMs'] !== undefined) {
      this.connectionTimeoutMs = profile.parameters['connectionTimeoutMs'] as number;
    }
  }

  // --- Private handlers ---

  private async handleConnect(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    try {
      const result = await this.connector.connect(this.connectionTimeoutMs);

      // Persist connection state
      this.storage.set(this.sessionStorageKey, JSON.stringify({
        address: result.address,
        connectedAt: Date.now(),
      }));

      // Emit wallet.connected event
      await this.bus.publish({
        id: uuidv4(),
        sourceAgentId: this.id,
        targetAgentId: null,
        type: 'event',
        correlationId: message.correlationId,
        timestamp: Date.now(),
        topic: 'wallet.connected',
        payload: { address: result.address },
      });

      return this.createResponse(message, { address: result.address, connected: true });
    } catch (_err: unknown) {
      const description = _err instanceof Error ? _err.message : 'Connection failed';

      // Transition to idle on failure
      this.state = 'idle';

      // Emit wallet.connection_failed event
      await this.bus.publish({
        id: uuidv4(),
        sourceAgentId: this.id,
        targetAgentId: null,
        type: 'event',
        correlationId: message.correlationId,
        timestamp: Date.now(),
        topic: 'wallet.connection_failed',
        payload: { reason: description },
      });

      return this.createErrorResponse(message, 'CONNECTION_FAILED', description);
    }
  }

  private async handleValidateSession(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    if (this.connector.isConnected()) {
      const address = this.connector.getAddress();
      if (address) {
        return this.createResponse(message, { address, valid: true });
      }
    }

    // Check if we have stored session data but connector reports disconnected
    const storedSession = this.storage.get(this.sessionStorageKey);
    if (storedSession) {
      // Session exists but connection is gone → expired/disconnected
      return this.createErrorResponse(message, 'SESSION_EXPIRED', 'Wallet session has expired');
    }

    return this.createErrorResponse(message, 'DISCONNECTED', 'No active wallet connection');
  }

  private async handleDisconnect(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    // Clear session storage
    this.storage.remove(this.sessionStorageKey);

    // Invoke disconnect
    await this.connector.disconnect();

    // Emit wallet.disconnected event
    await this.bus.publish({
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: message.correlationId,
      timestamp: Date.now(),
      topic: 'wallet.disconnected',
      payload: {},
    });

    return this.createResponse(message, { disconnected: true });
  }

  private async handleUnexpectedDisconnect(): Promise<void> {
    // Clear session storage on unexpected disconnect
    this.storage.remove(this.sessionStorageKey);

    // Transition to idle
    this.state = 'idle';

    // Emit wallet.disconnected event
    await this.bus.publish({
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic: 'wallet.disconnected',
      payload: { unexpected: true },
    });
  }

  private async attemptAutoReconnect(): Promise<void> {
    const storedSession = this.storage.get(this.sessionStorageKey);
    if (!storedSession) return;

    try {
      const result = await this.connector.connect(this.connectionTimeoutMs);

      // Update stored session with fresh timestamp
      this.storage.set(this.sessionStorageKey, JSON.stringify({
        address: result.address,
        connectedAt: Date.now(),
      }));
    } catch {
      // Auto-reconnect failed silently; clear stale session
      this.storage.remove(this.sessionStorageKey);
    }
  }

  // --- Helpers ---

  private createResponse(originalMessage: BusMessage, payload: Record<string, unknown>): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'response',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload,
    };
  }

  private createErrorResponse(originalMessage: BusMessage, code: string, description: string): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'error',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload: { code, description },
    };
  }
}

export default WalletAgent;
