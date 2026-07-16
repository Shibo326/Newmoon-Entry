/**
 * Signal Agent - Reads wallet signals from Compact Witness, normalizes them
 * using Behavior Profile parameters, and produces a 6-value signal vector.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  BusMessage,
  ResponseMessage,
  ErrorMessage,
} from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { MessageBus } from '../bus/message-bus.js';

export type SignalType =
  | 'walletAge'
  | 'transactionFrequency'
  | 'defiInteractions'
  | 'repaymentHistory'
  | 'assetDiversity'
  | 'liquidationHistory';

export interface RawSignalResult {
  value: number;
  transactionCount: number;
}

export interface CompactWitness {
  readSignal(walletAddress: string, signalType: SignalType): Promise<RawSignalResult>;
  isWalletConnected(walletAddress: string): Promise<boolean>;
}

/** Error thrown when wallet connection is lost during signal reading. */
export class WalletConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletConnectionError';
  }
}

const SIGNAL_TYPES: SignalType[] = [
  'walletAge',
  'transactionFrequency',
  'defiInteractions',
  'repaymentHistory',
  'assetDiversity',
  'liquidationHistory',
];

/** Default normalization ranges per signal type. */
const DEFAULT_NORMALIZATION: Record<SignalType, { min: number; max: number }> = {
  walletAge: { min: 0, max: 365 },
  transactionFrequency: { min: 0, max: 100 },
  defiInteractions: { min: 0, max: 50 },
  repaymentHistory: { min: 0, max: 100 },
  assetDiversity: { min: 0, max: 20 },
  liquidationHistory: { min: 0, max: 10 },
};

const DEFAULT_MIN_TRANSACTIONS = 3;
const DEFAULT_SIGNAL_VALUE = 0.5;

/**
 * Simple string hash for monitoring purposes (djb2 algorithm).
 * Produces a hex string hash of the signal vector - not cryptographic.
 */
function hashSignalVector(signals: number[]): string {
  const str = signals.map((s) => s.toFixed(6)).join(',');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalize a raw value using min-max normalization, clamped to [0.0, 1.0].
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return DEFAULT_SIGNAL_VALUE;
  const normalized = (value - min) / (max - min);
  return Math.max(0.0, Math.min(1.0, normalized));
}

export class SignalAgent implements Agent {
  readonly id = 'signal-agent';
  readonly name = 'Signal Agent';

  private state: AgentLifecycleState = 'idle';
  private activatedAt: number | null = null;
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;

  private minTransactionsForSignal = DEFAULT_MIN_TRANSACTIONS;
  private normalization: Record<SignalType, { min: number; max: number }> = { ...DEFAULT_NORMALIZATION };

  constructor(
    private readonly bus: MessageBus,
    private readonly witness: CompactWitness
  ) {}

  async initialize(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.activatedAt = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
  }

  getHealth(): AgentHealth {
    const uptimeSeconds = this.activatedAt
      ? Math.floor((Date.now() - this.activatedAt) / 1000)
      : 0;
    return {
      state: this.state,
      uptimeSeconds,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTimeMs:
        this.requestCount > 0 ? this.totalResponseTimeMs / this.requestCount : 0,
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        topic: 'read-signals',
        description: 'Read wallet signals and produce a normalized 6-value signal vector',
      },
    ];
  }

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startMs = Date.now();
    this.requestCount++;

    try {
      if (message.type === 'request' && message.topic === 'read-signals') {
        const result = await this.handleReadSignals(message);
        this.totalResponseTimeMs += Date.now() - startMs;
        return result;
      }

      this.errorCount++;
      this.totalResponseTimeMs += Date.now() - startMs;
      return this.createError(message, 'unsupported-topic', `Unsupported topic: ${message.topic}`);
    } catch (_error) {
      this.errorCount++;
      this.totalResponseTimeMs += Date.now() - startMs;
      const description = _error instanceof Error ? _error.message : 'Unknown error';
      return this.createError(message, 'internal-error', description);
    }
  }

  private async handleReadSignals(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const walletAddress = message.payload
      ? (message.payload as Record<string, unknown>).walletAddress
      : undefined;

    if (!walletAddress || typeof walletAddress !== 'string') {
      this.errorCount++;
      return this.createError(message, 'invalid-request', 'walletAddress is required');
    }

    // Requirement 5.6: Reject if wallet is not connected
    const isConnected = await this.witness.isWalletConnected(walletAddress);
    if (!isConnected) {
      this.errorCount++;
      return this.createError(message, 'invalid-wallet', 'Wallet is not connected or session is inactive');
    }

    // Read all 6 signals from Compact Witness
    const signals: number[] = [];
    const estimated: boolean[] = [];
    const succeeded: SignalType[] = [];
    const failed: SignalType[] = [];

    for (const signalType of SIGNAL_TYPES) {
      try {
        const raw = await this.witness.readSignal(walletAddress, signalType);
        succeeded.push(signalType);

        // Requirement 5.2: Insufficient data → default 0.5 and estimated flag
        if (raw.transactionCount < this.minTransactionsForSignal) {
          signals.push(DEFAULT_SIGNAL_VALUE);
          estimated.push(true);
        } else {
          // Requirement 5.4: Normalize using Behavior Profile parameters
          const range = this.normalization[signalType];
          const normalizedValue = normalize(raw.value, range.min, range.max);
          signals.push(normalizedValue);
          estimated.push(false);
        }
      } catch (error) {
        // Requirement 5.3: Abort on wallet connection loss
        if (error instanceof WalletConnectionError) {
          // Mark all remaining signals as failed
          const remainingIndex = SIGNAL_TYPES.indexOf(signalType);
          for (let i = remainingIndex; i < SIGNAL_TYPES.length; i++) {
            failed.push(SIGNAL_TYPES[i]!);
          }

          this.errorCount++;
          return this.createError(
            message,
            'wallet-disconnected',
            'Wallet connection lost during signal reading',
            {
              succeeded,
              failed,
            }
          );
        }
        // For non-connection errors, also abort (treat as connection issue)
        failed.push(signalType);
        const remainingIndex = SIGNAL_TYPES.indexOf(signalType) + 1;
        for (let i = remainingIndex; i < SIGNAL_TYPES.length; i++) {
          failed.push(SIGNAL_TYPES[i]!);
        }
        this.errorCount++;
        return this.createError(
          message,
          'signal-read-failed',
          `Failed to read signal: ${signalType}`,
          { succeeded, failed }
        );
      }
    }

    // Requirement 5.5: Publish signals.read event with hash only (not raw signals)
    const hash = hashSignalVector(signals);
    await this.publishSignalsReadEvent(hash);

    return this.createResponse(message, { signals, estimated, hash });
  }

  private async publishSignalsReadEvent(hash: string): Promise<void> {
    const event: BusMessage = {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic: 'signals.read',
      payload: { hash },
    };
    await this.bus.publish(event);
  }

  private createResponse(
    original: BusMessage,
    payload: Record<string, unknown>
  ): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: original.sourceAgentId,
      type: 'response',
      correlationId: original.correlationId,
      timestamp: Date.now(),
      topic: original.topic,
      payload,
    };
  }

  private createError(
    original: BusMessage,
    code: string,
    description: string,
    details?: Record<string, unknown>
  ): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: original.sourceAgentId,
      type: 'error',
      correlationId: original.correlationId,
      timestamp: Date.now(),
      topic: original.topic,
      payload: { code, description, details },
    };
  }

  private applyProfile(profile: BehaviorProfile): void {
    const params = profile.parameters;

    if (typeof params.minTransactionsForSignal === 'number') {
      this.minTransactionsForSignal = params.minTransactionsForSignal;
    }

    // Load normalization parameters from profile if provided
    if (params.normalization && typeof params.normalization === 'object') {
      const normConfig = params.normalization as Record<string, unknown>;
      for (const signalType of SIGNAL_TYPES) {
        const signalNorm = normConfig[signalType];
        if (signalNorm && typeof signalNorm === 'object') {
          const norm = signalNorm as Record<string, unknown>;
          if (typeof norm.min === 'number' && typeof norm.max === 'number') {
            this.normalization[signalType] = { min: norm.min, max: norm.max };
          }
        }
      }
    }
  }
}

export default SignalAgent;
