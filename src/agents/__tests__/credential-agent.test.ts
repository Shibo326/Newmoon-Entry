import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { CredentialAgent } from '../credential-agent.js';
import type { CompactContract } from '../credential-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

// --- Test Helpers ---

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

function createMintRequest(payload: Record<string, unknown> = {}): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'credential-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'mint-credential',
    payload: {
      walletAddress: 'addr_test1qz_valid_wallet',
      creditGrade: 'AA',
      signalVectorHash: 'hash_abc123',
      ...payload,
    },
  };
}

const defaultProfile: BehaviorProfile = {
  agentId: 'credential-agent',
  version: 1,
  parameters: { maxRetries: 3, backoffBaseMs: 1000, mintTimeoutMs: 60000 },
  lastModified: Date.now(),
};

// Fast profile for tests that exercise retries (avoid slow backoff waits)
const fastProfile: BehaviorProfile = {
  agentId: 'credential-agent',
  version: 1,
  parameters: { maxRetries: 3, backoffBaseMs: 1, mintTimeoutMs: 60000 },
  lastModified: Date.now(),
};

// --- Tests ---

describe('CredentialAgent', () => {
  let bus: MessageBus;
  let contract: CompactContract;
  let agent: CredentialAgent;

  beforeEach(async () => {
    bus = createMockBus();
    contract = createMockContract();
    agent = new CredentialAgent(bus, contract);
    await agent.initialize(fastProfile);
  });

  describe('identity and interface', () => {
    it('has correct id and name', () => {
      expect(agent.id).toBe('credential-agent');
      expect(agent.name).toBe('Credential Agent');
    });

    it('returns mint-credential capability', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0]!.topic).toBe('mint-credential');
    });

    it('returns initial health as idle with zero counts', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('idle');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
      expect(health.avgResponseTimeMs).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('onActivate sets state to active', async () => {
      await agent.onActivate();
      expect(agent.getHealth().state).toBe('active');
    });

    it('onDeactivate sets state to idle', async () => {
      await agent.onActivate();
      await agent.onDeactivate();
      expect(agent.getHealth().state).toBe('idle');
    });

    it('onConfigUpdate updates profile parameters', async () => {
      const newProfile: BehaviorProfile = {
        agentId: 'credential-agent',
        version: 2,
        parameters: { maxRetries: 5, backoffBaseMs: 500, mintTimeoutMs: 30000 },
        lastModified: Date.now(),
      };
      await agent.onConfigUpdate(newProfile);
      // Verify indirectly: with maxRetries=5, minting should retry 5 times
      (contract.mint as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(contract.mint).toHaveBeenCalledTimes(5);
    });
  });

  describe('input validation', () => {
    it('rejects request missing walletAddress', async () => {
      const msg = createMintRequest({ walletAddress: '' });
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'validation-failed' }));
      const fields = (result.payload as any).details.invalidFields as string[];
      expect(fields.some((f: string) => f.includes('walletAddress'))).toBe(true);
      expect(contract.mint).not.toHaveBeenCalled();
    });

    it('rejects request missing creditGrade', async () => {
      const msg = createMintRequest({ creditGrade: undefined });
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'validation-failed' }));
    });

    it('rejects request with invalid creditGrade', async () => {
      const msg = createMintRequest({ creditGrade: 'XYZ' });
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'validation-failed' }));
      const fields = (result.payload as any).details.invalidFields as string[];
      expect(fields.some((f: string) => f.includes('creditGrade'))).toBe(true);
    });

    it('rejects request missing signalVectorHash', async () => {
      const msg = createMintRequest({ signalVectorHash: '' });
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'validation-failed' }));
      const fields = (result.payload as any).details.invalidFields as string[];
      expect(fields.some((f: string) => f.includes('signalVectorHash'))).toBe(true);
    });

    it('rejects request with multiple invalid fields', async () => {
      const msg = createMintRequest({ walletAddress: '', creditGrade: 'INVALID', signalVectorHash: '' });
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      const details = (result.payload as any).details.invalidFields as string[];
      expect(details).toHaveLength(3);
    });

    it('accepts all valid credit grades', async () => {
      const grades = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'];
      for (const grade of grades) {
        const freshAgent = new CredentialAgent(createMockBus(), createMockContract());
        await freshAgent.initialize(fastProfile);
        const msg = createMintRequest({ creditGrade: grade });
        const result = await freshAgent.handleMessage(msg);
        expect(result.type).toBe('response');
      }
    });

    it('does not invoke contract on validation failure', async () => {
      const msg = createMintRequest({ walletAddress: '' });
      await agent.handleMessage(msg);

      expect(contract.hasCredential).not.toHaveBeenCalled();
      expect(contract.mint).not.toHaveBeenCalled();
      expect(contract.revoke).not.toHaveBeenCalled();
    });
  });

  describe('revocation before re-mint', () => {
    it('revokes existing credential before minting new one', async () => {
      (contract.hasCredential as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
      expect(contract.revoke).toHaveBeenCalledWith('addr_test1qz_valid_wallet');
      expect(contract.mint).toHaveBeenCalled();
    });

    it('does not revoke if no existing credential', async () => {
      (contract.hasCredential as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const msg = createMintRequest();
      await agent.handleMessage(msg);

      expect(contract.revoke).not.toHaveBeenCalled();
      expect(contract.mint).toHaveBeenCalled();
    });

    it('aborts with revocation-failed after retries exhausted', async () => {
      (contract.hasCredential as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (contract.revoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('revoke fail'));

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'revocation-failed' }));
      // Should have retried 3 times
      expect(contract.revoke).toHaveBeenCalledTimes(3);
      // Should NOT have attempted to mint
      expect(contract.mint).not.toHaveBeenCalled();
    });

    it('succeeds if revocation succeeds on retry', async () => {
      (contract.hasCredential as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (contract.revoke as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
      expect(contract.revoke).toHaveBeenCalledTimes(2);
      expect(contract.mint).toHaveBeenCalled();
    });
  });

  describe('minting with retry and exponential backoff', () => {
    it('returns minting-failed after all retries exhausted', async () => {
      (contract.mint as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('tx fail'));

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'minting-failed' }));
      expect(contract.mint).toHaveBeenCalledTimes(3);
    });

    it('succeeds if mint succeeds on retry', async () => {
      (contract.mint as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ txHash: '0xretry', mintTimestamp: 1700000001 });

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
      expect(result.payload).toEqual(expect.objectContaining({ txHash: '0xretry' }));
      expect(contract.mint).toHaveBeenCalledTimes(2);
    });

    it('only passes creditGrade and proofHash to contract (no raw signals)', async () => {
      const msg = createMintRequest({
        walletAddress: 'wallet123',
        creditGrade: 'BBB',
        signalVectorHash: 'proof_hash_xyz',
      });
      await agent.handleMessage(msg);

      expect(contract.mint).toHaveBeenCalledWith({
        walletAddress: 'wallet123',
        creditGrade: 'BBB',
        proofHash: 'proof_hash_xyz',
      });
    });
  });

  describe('mint timeout', () => {
    it('returns timeout error if mint does not complete within mintTimeoutMs', async () => {
      // Use short timeout
      const timeoutProfile: BehaviorProfile = {
        agentId: 'credential-agent',
        version: 1,
        parameters: { maxRetries: 3, backoffBaseMs: 1, mintTimeoutMs: 50 },
        lastModified: Date.now(),
      };
      await agent.initialize(timeoutProfile);

      (contract.mint as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'timeout' }));
    });

    it('does not timeout if mint completes within mintTimeoutMs', async () => {
      const msg = createMintRequest();
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
    });
  });

  describe('success event publishing', () => {
    it('publishes credential.minted event on success', async () => {
      const msg = createMintRequest({ creditGrade: 'AAA' });
      await agent.handleMessage(msg);

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          topic: 'credential.minted',
          sourceAgentId: 'credential-agent',
          targetAgentId: null,
          payload: {
            txHash: '0xabc123',
            creditGrade: 'AAA',
            mintTimestamp: 1700000000,
          },
        })
      );
    });

    it('does not publish event on failure', async () => {
      (contract.mint as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const msg = createMintRequest();
      await agent.handleMessage(msg);

      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('includes correlationId from original message in event', async () => {
      const msg = createMintRequest();
      await agent.handleMessage(msg);

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: msg.correlationId,
        })
      );
    });
  });

  describe('unsupported topic handling', () => {
    it('returns error for unknown topic', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'orchestrator-agent',
        targetAgentId: 'credential-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'unknown-topic',
        payload: {},
      };
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(expect.objectContaining({ code: 'unsupported-topic' }));
    });
  });

  describe('health metrics tracking', () => {
    it('increments requestCount on each message', async () => {
      const msg = createMintRequest();
      await agent.handleMessage(msg);
      await agent.handleMessage(msg);

      expect(agent.getHealth().requestCount).toBe(2);
    });

    it('increments errorCount on error responses', async () => {
      const msg = createMintRequest({ walletAddress: '' });
      await agent.handleMessage(msg);

      expect(agent.getHealth().errorCount).toBe(1);
    });

    it('tracks response time', async () => {
      const msg = createMintRequest();
      await agent.handleMessage(msg);

      expect(agent.getHealth().avgResponseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
