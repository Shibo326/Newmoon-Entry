import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { VerificationAgent } from '../verification-agent.js';
import type { VerificationContract } from '../verification-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

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

function createMockContract(grade: string | null = 'A', delay = 0): VerificationContract {
  return {
    getCredentialGrade: vi.fn().mockImplementation(async () => {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      return grade;
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

function createRequest(overrides: Partial<RequestMessage> & { payload?: Record<string, unknown> } = {}): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'test-caller',
    targetAgentId: 'verification-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'verification.verify-threshold',
    payload: {
      walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
      minimumGrade: 'BBB',
      queryingAddress: 'querier-address-1234567890',
      ...overrides.payload,
    },
    ...overrides,
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

describe('VerificationAgent', () => {
  let bus: MessageBus;
  let contract: VerificationContract;
  let agent: VerificationAgent;

  beforeEach(async () => {
    bus = createMockBus();
    contract = createMockContract('A');
    agent = new VerificationAgent(bus, contract);
    await agent.initialize(defaultProfile());
    await agent.onActivate();
  });

  describe('Agent interface conformance', () => {
    it('has correct id and name', () => {
      expect(agent.id).toBe('verification-agent');
      expect(agent.name).toBe('Verification Agent');
    });

    it('returns capabilities for verify-threshold topic', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0]!.topic).toBe('verification.verify-threshold');
    });

    it('reports health status', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('active');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
    });

    it('transitions through lifecycle states', async () => {
      expect(agent.getHealth().state).toBe('active');
      await agent.onDeactivate();
      expect(agent.getHealth().state).toBe('idle');
      await agent.onActivate();
      expect(agent.getHealth().state).toBe('active');
    });
  });

  describe('Input validation', () => {
    it('rejects invalid minimum grade with invalid-grade error', async () => {
      const request = createRequest({ payload: { walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3', minimumGrade: 'XYZ' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('invalid-grade');
    });

    it('rejects empty minimum grade', async () => {
      const request = createRequest({ payload: { walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3', minimumGrade: '' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('invalid-grade');
    });

    it('rejects missing minimum grade', async () => {
      const request = createRequest({ payload: { walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('invalid-grade');
    });

    it('rejects empty wallet address with invalid-address error', async () => {
      const request = createRequest({ payload: { walletAddress: '', minimumGrade: 'A' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('invalid-address');
    });

    it('rejects wallet address shorter than 10 characters', async () => {
      const request = createRequest({ payload: { walletAddress: 'short', minimumGrade: 'A' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('invalid-address');
    });

    it('rejects missing wallet address', async () => {
      const request = createRequest({ payload: { minimumGrade: 'A' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('invalid-address');
    });

    it('does NOT invoke contract on invalid grade', async () => {
      const request = createRequest({ payload: { walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3', minimumGrade: 'INVALID' } });
      await agent.handleMessage(request);

      expect(contract.getCredentialGrade).not.toHaveBeenCalled();
    });

    it('does NOT invoke contract on invalid address', async () => {
      const request = createRequest({ payload: { walletAddress: 'short', minimumGrade: 'A' } });
      await agent.handleMessage(request);

      expect(contract.getCredentialGrade).not.toHaveBeenCalled();
    });
  });

  describe('Threshold comparison', () => {
    it.each([
      { actual: 'AAA', minimum: 'C', expected: true },
      { actual: 'AAA', minimum: 'AAA', expected: true },
      { actual: 'AA', minimum: 'A', expected: true },
      { actual: 'A', minimum: 'A', expected: true },
      { actual: 'BBB', minimum: 'BB', expected: true },
      { actual: 'BB', minimum: 'C', expected: true },
      { actual: 'C', minimum: 'C', expected: true },
      { actual: 'C', minimum: 'BB', expected: false },
      { actual: 'BB', minimum: 'BBB', expected: false },
      { actual: 'BBB', minimum: 'A', expected: false },
      { actual: 'A', minimum: 'AA', expected: false },
      { actual: 'AA', minimum: 'AAA', expected: false },
    ])('grade $actual >= $minimum → $expected', async ({ actual, minimum, expected }) => {
      contract = createMockContract(actual);
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createRequest({ payload: { walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3', minimumGrade: minimum } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as any).payload.result).toBe(expected);
    });
  });

  describe('No credential found', () => {
    it('returns null result with no-credential-found reason when wallet has no credential', async () => {
      contract = createMockContract(null);
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as any).payload.result).toBeNull();
      expect((response as any).payload.reason).toBe('no-credential-found');
    });
  });

  describe('Contract timeout', () => {
    it('returns temporary-unavailable when contract exceeds timeout', async () => {
      contract = createMockContract('A', 3000); // 3s delay > 2s timeout
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('temporary-unavailable');
    });

    it('returns temporary-unavailable when contract throws', async () => {
      const failingContract: VerificationContract = {
        getCredentialGrade: vi.fn().mockRejectedValue(new Error('Connection refused')),
        isAvailable: vi.fn().mockResolvedValue(false),
      };
      agent = new VerificationAgent(bus, failingContract);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('temporary-unavailable');
    });
  });

  describe('Privacy', () => {
    it('response contains only boolean result, not the actual grade', async () => {
      contract = createMockContract('AAA');
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createRequest({ payload: { walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3', minimumGrade: 'C' } });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      const payload = (response as any).payload;
      expect(payload.result).toBe(true);
      // Must NOT contain actual grade or signals
      expect(payload).not.toHaveProperty('grade');
      expect(payload).not.toHaveProperty('actualGrade');
      expect(payload).not.toHaveProperty('signals');
      expect(payload).not.toHaveProperty('walletAddress');
    });

    it('no-credential response does not disclose grade info', async () => {
      contract = createMockContract(null);
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createRequest();
      const response = await agent.handleMessage(request);

      const payload = (response as any).payload;
      expect(payload.result).toBeNull();
      expect(payload.reason).toBe('no-credential-found');
      expect(payload).not.toHaveProperty('grade');
      expect(payload).not.toHaveProperty('signals');
    });
  });

  describe('Event publishing', () => {
    it('publishes verification.queried event with timestamp and querying address only', async () => {
      const request = createRequest({
        payload: {
          walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
          minimumGrade: 'BBB',
          queryingAddress: 'querier-address-1234567890',
        },
      });
      await agent.handleMessage(request);

      expect(bus.publish).toHaveBeenCalled();
      const publishedCalls = (bus.publish as any).mock.calls;
      const eventCall = publishedCalls.find(
        (call: any[]) => call[0].topic === 'verification.queried'
      );

      expect(eventCall).toBeDefined();
      const event = eventCall[0];
      expect(event.type).toBe('event');
      expect(event.payload.queryingAddress).toBe('querier-address-1234567890');
      expect(event.payload.timestamp).toBeDefined();
      // Verify ISO 8601 format
      expect(new Date(event.payload.timestamp).toISOString()).toBe(event.payload.timestamp);

      // Privacy: must NOT contain the result or queried wallet address
      expect(event.payload).not.toHaveProperty('result');
      expect(event.payload).not.toHaveProperty('walletAddress');
      expect(event.payload).not.toHaveProperty('grade');
    });

    it('uses sourceAgentId as querying address when queryingAddress not provided', async () => {
      const request = createRequest({
        payload: {
          walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
          minimumGrade: 'BBB',
        },
      });
      await agent.handleMessage(request);

      const publishedCalls = (bus.publish as any).mock.calls;
      const eventCall = publishedCalls.find(
        (call: any[]) => call[0].topic === 'verification.queried'
      );

      expect(eventCall).toBeDefined();
      expect(eventCall[0].payload.queryingAddress).toBe('test-caller');
    });

    it('does NOT publish event on input validation errors', async () => {
      const request = createRequest({ payload: { walletAddress: 'short', minimumGrade: 'INVALID' } });
      await agent.handleMessage(request);

      const publishedCalls = (bus.publish as any).mock.calls;
      const eventCall = publishedCalls.find(
        (call: any[]) => call[0]?.topic === 'verification.queried'
      );
      expect(eventCall).toBeUndefined();
    });
  });

  describe('Config update', () => {
    it('respects contractTimeoutMs from behavior profile', async () => {
      // Set a very short timeout
      const shortTimeoutProfile: BehaviorProfile = {
        agentId: 'verification-agent',
        version: 2,
        parameters: { contractTimeoutMs: 50 },
        lastModified: Date.now(),
      };

      contract = createMockContract('A', 100); // 100ms delay > 50ms timeout
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(shortTimeoutProfile);
      await agent.onActivate();

      const request = createRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('temporary-unavailable');
    });

    it('updates timeout on config update', async () => {
      contract = createMockContract('A', 100);
      agent = new VerificationAgent(bus, contract);
      await agent.initialize(defaultProfile()); // 2000ms timeout - will succeed
      await agent.onActivate();

      // Update to very short timeout
      await agent.onConfigUpdate({
        agentId: 'verification-agent',
        version: 2,
        parameters: { contractTimeoutMs: 10 },
        lastModified: Date.now(),
      });

      const request = createRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as any).payload.code).toBe('temporary-unavailable');
    });
  });

  describe('Health metrics tracking', () => {
    it('increments request count on each call', async () => {
      const request = createRequest();
      await agent.handleMessage(request);
      await agent.handleMessage(request);

      expect(agent.getHealth().requestCount).toBe(2);
    });

    it('increments error count on validation failures', async () => {
      const badRequest = createRequest({ payload: { walletAddress: 'x', minimumGrade: 'WRONG' } });
      await agent.handleMessage(badRequest);

      expect(agent.getHealth().errorCount).toBe(1);
    });
  });
});
