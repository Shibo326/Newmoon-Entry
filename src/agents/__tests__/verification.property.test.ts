/**
 * Property-based tests for Verification Agent.
 * Tests Properties 17, 18, 19 from the design document.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.8
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { VerificationAgent } from '../verification-agent.js';
import type { VerificationContract } from '../verification-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { BusMessage, RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'] as const;
type CreditGrade = (typeof VALID_GRADES)[number];

const GRADE_ENCODING: Record<string, number> = {
  AAA: 5,
  AA: 4,
  A: 3,
  BBB: 2,
  BB: 1,
  C: 0,
};

function createMockBus(): MessageBus & { publishedMessages: BusMessage[] } {
  const publishedMessages: BusMessage[] = [];
  return {
    publishedMessages,
    publish: vi.fn(async (msg: BusMessage) => { publishedMessages.push(msg); }),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockResolvedValue({} as any),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
}

function createMockContract(gradeToReturn: string | null): VerificationContract {
  return {
    getCredentialGrade: vi.fn().mockResolvedValue(gradeToReturn),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

function defaultProfile(): BehaviorProfile {
  return {
    agentId: 'verification-agent',
    version: 1,
    parameters: { contractTimeoutMs: 2000 },
    lastModified: Date.now(),
  };
}

function createRequest(payload: Record<string, unknown>): RequestMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    sourceAgentId: 'test-caller',
    targetAgentId: 'verification-agent',
    type: 'request',
    correlationId: `corr-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    topic: 'verification.verify-threshold',
    payload,
  };
}

/** Arbitrary for a valid wallet address (at least 10 chars). */
const arbValidWalletAddress = fc.stringOf(fc.char(), { minLength: 10, maxLength: 80 })
  .map(s => `addr_test_${s}`);

/** Arbitrary for a valid credit grade from the valid set. */
const arbValidGrade = fc.constantFrom(...VALID_GRADES);

/** Arbitrary for a querying address (arbitrary non-empty string). */
const arbQueryingAddress = fc.stringOf(fc.char(), { minLength: 10, maxLength: 50 })
  .map(s => `querier_${s}`);

// ─── Property 17: Threshold Comparison Correctness ──────────────────────────
/**
 * **Validates: Requirements 8.1, 8.2**
 *
 * For any stored Credit Grade G and requested minimum grade M from
 * {AAA, AA, A, BBB, BB, C}, the Verification Agent SHALL return true
 * if and only if the numeric encoding of G (AAA=5, AA=4, A=3, BBB=2, BB=1, C=0)
 * is greater than or equal to the numeric encoding of M.
 */
describe('Property 17: Threshold Comparison Correctness', () => {
  it('all 36 grade pair combinations produce correct boolean result', async () => {
    // Exhaustively test all 36 combinations (6 stored × 6 minimum)
    for (const storedGrade of VALID_GRADES) {
      for (const minimumGrade of VALID_GRADES) {
        const bus = createMockBus();
        const contract = createMockContract(storedGrade);
        const agent = new VerificationAgent(bus, contract);
        await agent.initialize(defaultProfile());
        await agent.onActivate();

        const request = createRequest({
          walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
          minimumGrade,
          queryingAddress: 'querier-test-1234567890',
        });

        const response = await agent.handleMessage(request);

        expect(response.type).toBe('response');
        const expectedResult = GRADE_ENCODING[storedGrade]! >= GRADE_ENCODING[minimumGrade]!;
        expect((response as any).payload.result).toBe(expectedResult);
      }
    }
  });

  it('random grade pairs produce correct boolean based on numeric encoding', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        arbValidGrade,
        arbValidWalletAddress,
        async (storedGrade, minimumGrade, walletAddress) => {
          const bus = createMockBus();
          const contract = createMockContract(storedGrade);
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress,
            minimumGrade,
            queryingAddress: 'querier-1234567890',
          });

          const response = await agent.handleMessage(request);

          expect(response.type).toBe('response');
          const expectedResult = GRADE_ENCODING[storedGrade]! >= GRADE_ENCODING[minimumGrade]!;
          expect((response as any).payload.result).toBe(expectedResult);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('grade equality always returns true', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        arbValidWalletAddress,
        async (grade, walletAddress) => {
          const bus = createMockBus();
          const contract = createMockContract(grade);
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress,
            minimumGrade: grade,
            queryingAddress: 'querier-1234567890',
          });

          const response = await agent.handleMessage(request);
          expect(response.type).toBe('response');
          expect((response as any).payload.result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 18: Verification Input Validation ─────────────────────────────
/**
 * **Validates: Requirements 8.5, 8.6**
 *
 * For any threshold query where the minimum grade is not in {AAA, AA, A, BBB, BB, C},
 * the Verification Agent SHALL reject with an invalid-grade error. For any query where
 * the wallet address is empty or malformed, it SHALL reject with an invalid-address error.
 * Neither rejection SHALL invoke the Compact Contract.
 */
describe('Property 18: Verification Input Validation', () => {
  /** Generate strings that are NOT valid grades. */
  const arbInvalidGrade = fc.string({ minLength: 1, maxLength: 20 })
    .filter(s => !VALID_GRADES.includes(s as any));

  /** Generate malformed addresses (empty or shorter than 10 chars). */
  const arbMalformedAddress = fc.oneof(
    fc.constant(''),
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 9 })
  );

  it('rejects invalid grades without invoking the contract', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInvalidGrade,
        arbValidWalletAddress,
        async (invalidGrade, walletAddress) => {
          const bus = createMockBus();
          const contract = createMockContract('A');
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress,
            minimumGrade: invalidGrade,
            queryingAddress: 'querier-1234567890',
          });

          const response = await agent.handleMessage(request);

          expect(response.type).toBe('error');
          expect((response as any).payload.code).toBe('invalid-grade');
          // Contract must NOT be called
          expect(contract.getCredentialGrade).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects empty grade string without invoking the contract', async () => {
    const bus = createMockBus();
    const contract = createMockContract('A');
    const agent = new VerificationAgent(bus, contract);
    await agent.initialize(defaultProfile());
    await agent.onActivate();

    const request = createRequest({
      walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
      minimumGrade: '',
      queryingAddress: 'querier-1234567890',
    });

    const response = await agent.handleMessage(request);

    expect(response.type).toBe('error');
    expect((response as any).payload.code).toBe('invalid-grade');
    expect(contract.getCredentialGrade).not.toHaveBeenCalled();
  });

  it('rejects malformed/empty wallet addresses without invoking the contract', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMalformedAddress,
        arbValidGrade,
        async (malformedAddress, validGrade) => {
          const bus = createMockBus();
          const contract = createMockContract('A');
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress: malformedAddress,
            minimumGrade: validGrade,
            queryingAddress: 'querier-1234567890',
          });

          const response = await agent.handleMessage(request);

          expect(response.type).toBe('error');
          expect((response as any).payload.code).toBe('invalid-address');
          // Contract must NOT be called
          expect(contract.getCredentialGrade).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects missing wallet address (undefined) without invoking the contract', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        async (validGrade) => {
          const bus = createMockBus();
          const contract = createMockContract('A');
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            minimumGrade: validGrade,
            queryingAddress: 'querier-1234567890',
          });

          const response = await agent.handleMessage(request);

          expect(response.type).toBe('error');
          expect((response as any).payload.code).toBe('invalid-address');
          expect(contract.getCredentialGrade).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 19: Verification Privacy ──────────────────────────────────────
/**
 * **Validates: Requirements 8.3, 8.8**
 *
 * For any threshold verification query and response, the response SHALL contain
 * only the boolean result (true/false) or an error — never the actual Credit Grade
 * value, wallet signals, or signal vector. The verification.queried event SHALL
 * contain only the timestamp and querying address, never the result or queried wallet address.
 */
describe('Property 19: Verification Privacy', () => {
  /** Fields that MUST NOT appear in response or event payloads. */
  const FORBIDDEN_FIELDS = ['grade', 'actualGrade', 'creditGrade', 'signals', 'signalVector', 'vector'];

  it('response never contains actual grade, signals, or wallet signals', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        arbValidGrade,
        arbValidWalletAddress,
        arbQueryingAddress,
        async (storedGrade, minimumGrade, walletAddress, queryingAddress) => {
          const bus = createMockBus();
          const contract = createMockContract(storedGrade);
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress,
            minimumGrade,
            queryingAddress,
          });

          const response = await agent.handleMessage(request);

          expect(response.type).toBe('response');
          const payload = (response as any).payload;

          // Response should only have `result` (boolean)
          for (const field of FORBIDDEN_FIELDS) {
            expect(payload).not.toHaveProperty(field);
          }

          // The result must be a boolean — never the actual grade string
          expect(typeof payload.result).toBe('boolean');
          // The actual stored grade must not appear anywhere in the payload
          expect(JSON.stringify(payload)).not.toContain(`"${storedGrade}"`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('verification.queried event contains only timestamp and queryingAddress', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        arbValidGrade,
        arbValidWalletAddress,
        arbQueryingAddress,
        async (storedGrade, minimumGrade, walletAddress, queryingAddress) => {
          const bus = createMockBus();
          const contract = createMockContract(storedGrade);
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress,
            minimumGrade,
            queryingAddress,
          });

          await agent.handleMessage(request);

          // Find the verification.queried event
          const queriedEvents = bus.publishedMessages.filter(
            m => m.topic === 'verification.queried'
          );
          expect(queriedEvents.length).toBe(1);

          const event = queriedEvents[0]!;
          const eventPayload = event.payload as Record<string, unknown>;

          // Event MUST contain timestamp and queryingAddress
          expect(eventPayload.timestamp).toBeDefined();
          expect(typeof eventPayload.timestamp).toBe('string');
          // Verify ISO 8601 format
          expect(new Date(eventPayload.timestamp as string).toISOString()).toBe(eventPayload.timestamp);
          expect(eventPayload.queryingAddress).toBe(queryingAddress);

          // Event MUST NOT contain result, wallet address, grade, or signals
          expect(eventPayload).not.toHaveProperty('result');
          expect(eventPayload).not.toHaveProperty('walletAddress');
          expect(eventPayload).not.toHaveProperty('queriedWallet');
          for (const field of FORBIDDEN_FIELDS) {
            expect(eventPayload).not.toHaveProperty(field);
          }

          // The actual grade and queried wallet must not leak into the event
          const eventStr = JSON.stringify(eventPayload);
          expect(eventStr).not.toContain(walletAddress);
          // Only check grade doesn't appear if it wouldn't be a substring of other fields
          if (!queryingAddress.includes(storedGrade)) {
            expect(eventStr).not.toContain(`"${storedGrade}"`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no-credential response does not disclose grade or signals', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        arbValidWalletAddress,
        arbQueryingAddress,
        async (minimumGrade, walletAddress, queryingAddress) => {
          const bus = createMockBus();
          const contract = createMockContract(null); // no credential
          const agent = new VerificationAgent(bus, contract);
          await agent.initialize(defaultProfile());
          await agent.onActivate();

          const request = createRequest({
            walletAddress,
            minimumGrade,
            queryingAddress,
          });

          const response = await agent.handleMessage(request);

          expect(response.type).toBe('response');
          const payload = (response as any).payload;

          // Response should be null result with reason
          expect(payload.result).toBeNull();
          expect(payload.reason).toBe('no-credential-found');

          // Must NOT contain any grade, signals, or wallet data
          for (const field of FORBIDDEN_FIELDS) {
            expect(payload).not.toHaveProperty(field);
          }
          expect(payload).not.toHaveProperty('walletAddress');
        }
      ),
      { numRuns: 100 }
    );
  });
});
