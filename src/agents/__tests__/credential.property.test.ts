/**
 * Property-based tests for Credential Agent.
 * Tests Properties 15, 16 from the design document.
 *
 * Validates: Requirements 7.2, 7.7
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { CredentialAgent } from '../credential-agent.js';
import type { CompactContract } from '../credential-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockBus(): MessageBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockResolvedValue({} as any),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
}

function createMockContract(overrides?: Partial<CompactContract>): CompactContract {
  return {
    mint: vi.fn().mockResolvedValue({ txHash: '0xabc123', mintTimestamp: 1700000000 }),
    revoke: vi.fn().mockResolvedValue(undefined),
    hasCredential: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

const fastProfile: BehaviorProfile = {
  agentId: 'credential-agent',
  version: 1,
  parameters: { maxRetries: 3, backoffBaseMs: 1, mintTimeoutMs: 60000 },
  lastModified: Date.now(),
};

function createMintRequest(payload: Record<string, unknown>): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'credential-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'mint-credential',
    payload,
  };
}

const VALID_GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'] as const;

// Arbitrary for valid wallet addresses (non-empty strings)
const arbWalletAddress = fc.stringMatching(/^addr_[a-z0-9]{5,20}$/);

// Arbitrary for valid signal vector hashes (non-empty strings)
const arbSignalHash = fc.stringMatching(/^hash_[a-f0-9]{8,32}$/);

// Arbitrary for valid credit grades
const arbValidGrade = fc.constantFrom(...VALID_GRADES);

// Arbitrary for invalid credit grades (strings not in the valid set)
const arbInvalidGrade = fc.string({ minLength: 1, maxLength: 10 }).filter(
  s => !VALID_GRADES.includes(s as any)
);

// ─── Property 15: Credential Request Validation ─────────────────────────────
/**
 * **Validates: Requirements 7.7**
 *
 * For any mint-credential request missing the wallet address, Credit Grade,
 * or signal vector hash, or containing a Credit Grade not in {AAA, AA, A, BBB, BB, C},
 * the Credential Agent SHALL reject the request with a validation error listing
 * the invalid fields without invoking the Compact Contract.
 */
describe('Property 15: Credential Request Validation', () => {
  it('rejects requests with missing walletAddress', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidGrade,
        arbSignalHash,
        fc.constantFrom(undefined, null, '', '   '),
        async (grade, hash, badWallet) => {
          const contract = createMockContract();
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const payload: Record<string, unknown> = {
            creditGrade: grade,
            signalVectorHash: hash,
          };
          if (badWallet !== undefined) {
            payload['walletAddress'] = badWallet;
          }

          const msg = createMintRequest(payload);
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('error');
          expect((result.payload as any).code).toBe('validation-failed');
          const invalidFields = (result.payload as any).details.invalidFields as string[];
          expect(invalidFields.some((f: string) => f.includes('walletAddress'))).toBe(true);

          // Contract must NOT have been invoked
          expect(contract.hasCredential).not.toHaveBeenCalled();
          expect(contract.mint).not.toHaveBeenCalled();
          expect(contract.revoke).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects requests with missing creditGrade', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbSignalHash,
        fc.constantFrom(undefined, null),
        async (wallet, hash, badGrade) => {
          const contract = createMockContract();
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const payload: Record<string, unknown> = {
            walletAddress: wallet,
            signalVectorHash: hash,
          };
          if (badGrade !== undefined) {
            payload['creditGrade'] = badGrade;
          }

          const msg = createMintRequest(payload);
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('error');
          expect((result.payload as any).code).toBe('validation-failed');
          const invalidFields = (result.payload as any).details.invalidFields as string[];
          expect(invalidFields.some((f: string) => f.includes('creditGrade'))).toBe(true);

          // Contract must NOT have been invoked
          expect(contract.hasCredential).not.toHaveBeenCalled();
          expect(contract.mint).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects requests with invalid creditGrade not in valid set', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbSignalHash,
        arbInvalidGrade,
        async (wallet, hash, invalidGrade) => {
          const contract = createMockContract();
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: invalidGrade,
            signalVectorHash: hash,
          });
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('error');
          expect((result.payload as any).code).toBe('validation-failed');
          const invalidFields = (result.payload as any).details.invalidFields as string[];
          expect(invalidFields.some((f: string) => f.includes('creditGrade'))).toBe(true);

          // Contract must NOT have been invoked
          expect(contract.hasCredential).not.toHaveBeenCalled();
          expect(contract.mint).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects requests with missing signalVectorHash', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        fc.constantFrom(undefined, null, '', '   '),
        async (wallet, grade, badHash) => {
          const contract = createMockContract();
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const payload: Record<string, unknown> = {
            walletAddress: wallet,
            creditGrade: grade,
          };
          if (badHash !== undefined) {
            payload['signalVectorHash'] = badHash;
          }

          const msg = createMintRequest(payload);
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('error');
          expect((result.payload as any).code).toBe('validation-failed');
          const invalidFields = (result.payload as any).details.invalidFields as string[];
          expect(invalidFields.some((f: string) => f.includes('signalVectorHash'))).toBe(true);

          // Contract must NOT have been invoked
          expect(contract.hasCredential).not.toHaveBeenCalled();
          expect(contract.mint).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects requests with multiple missing/invalid fields and lists all of them', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(undefined, null, '', '   '),
        fc.constantFrom(undefined, null, 'INVALID', 'xyz', 'D'),
        fc.constantFrom(undefined, null, '', '  '),
        async (badWallet, badGrade, badHash) => {
          const contract = createMockContract();
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const payload: Record<string, unknown> = {};
          if (badWallet !== undefined) payload['walletAddress'] = badWallet;
          if (badGrade !== undefined) payload['creditGrade'] = badGrade;
          if (badHash !== undefined) payload['signalVectorHash'] = badHash;

          const msg = createMintRequest(payload);
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('error');
          expect((result.payload as any).code).toBe('validation-failed');
          const invalidFields = (result.payload as any).details.invalidFields as string[];

          // Should list errors for all three fields
          expect(invalidFields.some((f: string) => f.includes('walletAddress'))).toBe(true);
          expect(invalidFields.some((f: string) => f.includes('creditGrade'))).toBe(true);
          expect(invalidFields.some((f: string) => f.includes('signalVectorHash'))).toBe(true);

          // Contract must NOT have been invoked
          expect(contract.hasCredential).not.toHaveBeenCalled();
          expect(contract.mint).not.toHaveBeenCalled();
          expect(contract.revoke).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts all valid grades with valid fields (positive case)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        arbSignalHash,
        async (wallet, grade, hash) => {
          const contract = createMockContract();
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: grade,
            signalVectorHash: hash,
          });
          const result = await agent.handleMessage(msg);

          // Valid requests should succeed (not be validation-rejected)
          expect(result.type).toBe('response');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 16: Credential Revocation Before Re-Mint ──────────────────────
/**
 * **Validates: Requirements 7.2**
 *
 * For any wallet address that already holds an active ZK credential, minting
 * a new credential SHALL first revoke the existing one. If revocation fails
 * after exhausting the configured retry count, the mint SHALL be aborted
 * without creating a new credential.
 */
describe('Property 16: Credential Revocation Before Re-Mint', () => {
  it('revokes existing credential before minting when one exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        arbSignalHash,
        async (wallet, grade, hash) => {
          const contract = createMockContract({
            hasCredential: vi.fn().mockResolvedValue(true),
            revoke: vi.fn().mockResolvedValue(undefined),
            mint: vi.fn().mockResolvedValue({ txHash: '0xnew', mintTimestamp: Date.now() }),
          });
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: grade,
            signalVectorHash: hash,
          });
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('response');
          // Revocation was called before minting
          expect(contract.revoke).toHaveBeenCalledWith(wallet);
          expect(contract.mint).toHaveBeenCalled();

          // Verify ordering: revoke was called before mint
          const revokeOrder = (contract.revoke as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
          const mintOrder = (contract.mint as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
          expect(revokeOrder).toBeLessThan(mintOrder!);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not revoke when no existing credential', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        arbSignalHash,
        async (wallet, grade, hash) => {
          const contract = createMockContract({
            hasCredential: vi.fn().mockResolvedValue(false),
            revoke: vi.fn().mockResolvedValue(undefined),
            mint: vi.fn().mockResolvedValue({ txHash: '0xfresh', mintTimestamp: Date.now() }),
          });
          const agent = new CredentialAgent(createMockBus(), contract);
          await agent.initialize(fastProfile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: grade,
            signalVectorHash: hash,
          });
          const result = await agent.handleMessage(msg);

          expect(result.type).toBe('response');
          // Revocation must NOT have been called
          expect(contract.revoke).not.toHaveBeenCalled();
          // But minting still happens
          expect(contract.mint).toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('aborts mint when revocation fails after all retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        arbSignalHash,
        fc.integer({ min: 1, max: 5 }),
        async (wallet, grade, hash, maxRetries) => {
          const contract = createMockContract({
            hasCredential: vi.fn().mockResolvedValue(true),
            revoke: vi.fn().mockRejectedValue(new Error('revocation failed')),
            mint: vi.fn().mockResolvedValue({ txHash: '0x', mintTimestamp: Date.now() }),
          });
          const agent = new CredentialAgent(createMockBus(), contract);

          const profile: BehaviorProfile = {
            agentId: 'credential-agent',
            version: 1,
            parameters: { maxRetries, backoffBaseMs: 1, mintTimeoutMs: 60000 },
            lastModified: Date.now(),
          };
          await agent.initialize(profile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: grade,
            signalVectorHash: hash,
          });
          const result = await agent.handleMessage(msg);

          // Must abort with revocation-failed error
          expect(result.type).toBe('error');
          expect((result.payload as any).code).toBe('revocation-failed');

          // Revoke was called exactly maxRetries times
          expect(contract.revoke).toHaveBeenCalledTimes(maxRetries);

          // Mint must NOT have been called
          expect(contract.mint).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('succeeds when revocation eventually succeeds within retry limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        arbSignalHash,
        fc.integer({ min: 2, max: 5 }),
        async (wallet, grade, hash, maxRetries) => {
          // Revoke fails on all attempts except the last one
          const revokeFn = vi.fn();
          for (let i = 0; i < maxRetries - 1; i++) {
            revokeFn.mockRejectedValueOnce(new Error('transient failure'));
          }
          revokeFn.mockResolvedValueOnce(undefined);

          const contract = createMockContract({
            hasCredential: vi.fn().mockResolvedValue(true),
            revoke: revokeFn,
            mint: vi.fn().mockResolvedValue({ txHash: '0xsuccess', mintTimestamp: Date.now() }),
          });
          const agent = new CredentialAgent(createMockBus(), contract);

          const profile: BehaviorProfile = {
            agentId: 'credential-agent',
            version: 1,
            parameters: { maxRetries, backoffBaseMs: 1, mintTimeoutMs: 60000 },
            lastModified: Date.now(),
          };
          await agent.initialize(profile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: grade,
            signalVectorHash: hash,
          });
          const result = await agent.handleMessage(msg);

          // Should succeed because revocation eventually worked
          expect(result.type).toBe('response');
          expect(contract.revoke).toHaveBeenCalledTimes(maxRetries);
          expect(contract.mint).toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('applies configured retry count from behavior profile', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbValidGrade,
        arbSignalHash,
        fc.integer({ min: 1, max: 8 }),
        async (wallet, grade, hash, maxRetries) => {
          const contract = createMockContract({
            hasCredential: vi.fn().mockResolvedValue(true),
            revoke: vi.fn().mockRejectedValue(new Error('always fails')),
            mint: vi.fn().mockResolvedValue({ txHash: '0x', mintTimestamp: Date.now() }),
          });
          const agent = new CredentialAgent(createMockBus(), contract);

          const profile: BehaviorProfile = {
            agentId: 'credential-agent',
            version: 1,
            parameters: { maxRetries, backoffBaseMs: 1, mintTimeoutMs: 60000 },
            lastModified: Date.now(),
          };
          await agent.initialize(profile);

          const msg = createMintRequest({
            walletAddress: wallet,
            creditGrade: grade,
            signalVectorHash: hash,
          });
          await agent.handleMessage(msg);

          // Retry count respects the profile configuration
          expect(contract.revoke).toHaveBeenCalledTimes(maxRetries);
        }
      ),
      { numRuns: 100 }
    );
  });
});
