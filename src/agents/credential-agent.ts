/**
 * Credential Agent - Manages ZK Credential NFT minting, revocation,
 * and lifecycle on the Midnight blockchain via Compact Contract.
 *
 * Responsibilities:
 * - Validate mint-credential requests (wallet, grade, hash)
 * - Revoke existing credentials before re-minting
 * - Mint with exponential backoff retry
 * - Enforce 60s mint timeout
 * - Store only Credit Grade and Proof Hash on-chain (no raw signals)
 * - Publish "credential.minted" event on success
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

// Timer type declarations for environment-agnostic usage
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

/**
 * Interface abstracting the Compact Contract for testability.
 */
export interface CompactContract {
  mint(params: { walletAddress: string; creditGrade: string; proofHash: string }): Promise<{ txHash: string; mintTimestamp: number }>;
  revoke(walletAddress: string): Promise<void>;
  hasCredential(walletAddress: string): Promise<boolean>;
}

const VALID_GRADES: ReadonlySet<string> = new Set<string>(['AAA', 'AA', 'A', 'BBB', 'BB', 'C']);

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_MINT_TIMEOUT_MS = 60_000;

interface CredentialAgentProfile {
  maxRetries: number;
  backoffBaseMs: number;
  mintTimeoutMs: number;
}

function extractProfileParams(profile: BehaviorProfile): CredentialAgentProfile {
  const params = profile.parameters;
  return {
    maxRetries: typeof params['maxRetries'] === 'number' ? params['maxRetries'] : DEFAULT_MAX_RETRIES,
    backoffBaseMs: typeof params['backoffBaseMs'] === 'number' ? params['backoffBaseMs'] : DEFAULT_BACKOFF_BASE_MS,
    mintTimeoutMs: typeof params['mintTimeoutMs'] === 'number' ? params['mintTimeoutMs'] : DEFAULT_MINT_TIMEOUT_MS,
  };
}

/**
 * Creates a promise that rejects after the specified timeout.
 */
function createTimeout(ms: number): { promise: Promise<never>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('MINT_TIMEOUT'));
    }, ms);
  });
  return {
    promise,
    clear: () => clearTimeout(timer!),
  };
}

/**
 * Sleep utility for backoff delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CredentialAgent implements Agent {
  readonly id = 'credential-agent';
  readonly name = 'Credential Agent';

  private state: AgentLifecycleState = 'idle';
  private startTime: number = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;
  private profileParams: CredentialAgentProfile = {
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    mintTimeoutMs: DEFAULT_MINT_TIMEOUT_MS,
  };

  constructor(
    private readonly bus: MessageBus,
    private readonly contract: CompactContract
  ) {}

  async initialize(profile: BehaviorProfile): Promise<void> {
    this.profileParams = extractProfileParams(profile);
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.startTime = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    this.profileParams = extractProfileParams(profile);
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
      { topic: 'mint-credential', description: 'Mint a ZK Credential NFT on Midnight' },
    ];
  }

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startMs = Date.now();
    this.requestCount++;

    if (message.type !== 'request' || message.topic !== 'mint-credential') {
      this.errorCount++;
      return this.buildError(message, 'unsupported-topic', `Unsupported topic: ${message.topic}`);
    }

    const payload = message.payload as Record<string, unknown>;

    // Step 1: Validate input fields
    const validationErrors = this.validateRequest(payload);
    if (validationErrors.length > 0) {
      this.errorCount++;
      this.totalResponseTimeMs += Date.now() - startMs;
      return this.buildError(message, 'validation-failed', 'Request validation failed', {
        invalidFields: validationErrors,
      });
    }

    const walletAddress = payload['walletAddress'] as string;
    const creditGrade = payload['creditGrade'] as string;
    const signalVectorHash = payload['signalVectorHash'] as string;

    // Step 2: Revoke existing credential if one exists
    try {
      const hasExisting = await this.contract.hasCredential(walletAddress);
      if (hasExisting) {
        const revoked = await this.revokeWithRetry(walletAddress);
        if (!revoked) {
          this.errorCount++;
          this.totalResponseTimeMs += Date.now() - startMs;
          return this.buildError(message, 'revocation-failed',
            `Failed to revoke existing credential after ${this.profileParams.maxRetries} retries`);
        }
      }
    } catch (_err) {
      this.errorCount++;
      this.totalResponseTimeMs += Date.now() - startMs;
      return this.buildError(message, 'revocation-failed', 'Revocation check failed');
    }

    // Step 3: Mint with retry and timeout
    // Only creditGrade and proofHash go on-chain (no raw signals)
    const mintResult = await this.mintWithRetry(walletAddress, creditGrade, signalVectorHash);

    this.totalResponseTimeMs += Date.now() - startMs;

    if (mintResult.success) {
      // Step 4: Publish credential.minted event
      const eventMessage: BusMessage = {
        id: uuidv4(),
        sourceAgentId: this.id,
        targetAgentId: null,
        type: 'event',
        correlationId: message.correlationId,
        timestamp: Date.now(),
        topic: 'credential.minted',
        payload: {
          txHash: mintResult.txHash,
          creditGrade,
          mintTimestamp: mintResult.mintTimestamp,
        },
      };
      await this.bus.publish(eventMessage);

      return this.buildResponse(message, {
        txHash: mintResult.txHash,
        creditGrade,
        mintTimestamp: mintResult.mintTimestamp,
      });
    }

    this.errorCount++;
    return this.buildError(message, mintResult.errorCode, mintResult.errorMessage);
  }

  /**
   * Validates request payload fields.
   * Returns array of field-specific error descriptions.
   */
  private validateRequest(payload: Record<string, unknown>): string[] {
    const errors: string[] = [];

    const walletAddress = payload['walletAddress'];
    if (walletAddress === undefined || walletAddress === null || typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
      errors.push('walletAddress is required and must be a non-empty string');
    }

    const creditGrade = payload['creditGrade'];
    if (creditGrade === undefined || creditGrade === null || typeof creditGrade !== 'string') {
      errors.push('creditGrade is required and must be a string');
    } else if (!VALID_GRADES.has(creditGrade)) {
      errors.push(`creditGrade must be one of: AAA, AA, A, BBB, BB, C (got: ${creditGrade})`);
    }

    const signalVectorHash = payload['signalVectorHash'];
    if (signalVectorHash === undefined || signalVectorHash === null || typeof signalVectorHash !== 'string' || signalVectorHash.trim().length === 0) {
      errors.push('signalVectorHash is required and must be a non-empty string');
    }

    return errors;
  }

  /**
   * Attempts to revoke an existing credential with retries.
   * Returns true if revocation succeeded, false if all retries exhausted.
   */
  private async revokeWithRetry(walletAddress: string): Promise<boolean> {
    const { maxRetries, backoffBaseMs } = this.profileParams;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.contract.revoke(walletAddress);
        return true;
      } catch (_err) {
        if (attempt < maxRetries - 1) {
          const delayMs = backoffBaseMs * Math.pow(2, attempt);
          await sleep(delayMs);
        }
      }
    }

    return false;
  }

  /**
   * Attempts to mint a credential with exponential backoff retry and timeout.
   */
  private async mintWithRetry(
    walletAddress: string,
    creditGrade: string,
    proofHash: string
  ): Promise<
    | { success: true; txHash: string; mintTimestamp: number }
    | { success: false; errorCode: string; errorMessage: string }
  > {
    const { maxRetries, backoffBaseMs, mintTimeoutMs } = this.profileParams;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const timeout = createTimeout(mintTimeoutMs);
        try {
          const result = await Promise.race([
            this.contract.mint({ walletAddress, creditGrade, proofHash }),
            timeout.promise,
          ]);
          timeout.clear();
          return { success: true, txHash: result.txHash, mintTimestamp: result.mintTimestamp };
        } catch (err) {
          timeout.clear();
          if (err instanceof Error && err.message === 'MINT_TIMEOUT') {
            return { success: false, errorCode: 'timeout', errorMessage: 'Minting transaction timed out' };
          }
          throw err; // re-throw to hit retry logic
        }
      } catch (_err) {
        if (attempt < maxRetries - 1) {
          const delayMs = backoffBaseMs * Math.pow(2, attempt);
          await sleep(delayMs);
        }
      }
    }

    return { success: false, errorCode: 'minting-failed', errorMessage: `Minting failed after ${maxRetries} retries` };
  }

  private buildResponse(originalMessage: BusMessage, payload: Record<string, unknown>): ResponseMessage {
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

  private buildError(
    originalMessage: BusMessage,
    code: string,
    description: string,
    details?: Record<string, unknown>
  ): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'error',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload: { code, description, ...(details ? { details } : {}) },
    };
  }
}

export default CredentialAgent;
