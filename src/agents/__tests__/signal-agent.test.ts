import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SignalAgent, WalletConnectionError } from '../signal-agent.js';
import type { CompactWitness, SignalType, RawSignalResult } from '../signal-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { BusMessage, RequestMessage } from '../../types/messages.js';
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

function createMockWitness(overrides?: Partial<CompactWitness>): CompactWitness {
  return {
    readSignal: vi.fn().mockResolvedValue({ value: 50, transactionCount: 10 }),
    isWalletConnected: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createReadSignalsRequest(walletAddress = '0xABC123'): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'signal-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'read-signals',
    payload: { walletAddress },
  };
}

function createDefaultProfile(): BehaviorProfile {
  return {
    agentId: 'signal-agent',
    version: 1,
    parameters: {
      minTransactionsForSignal: 3,
      normalization: {
        walletAge: { min: 0, max: 365 },
        transactionFrequency: { min: 0, max: 100 },
        defiInteractions: { min: 0, max: 50 },
        repaymentHistory: { min: 0, max: 100 },
        assetDiversity: { min: 0, max: 20 },
        liquidationHistory: { min: 0, max: 10 },
      },
    },
    lastModified: Date.now(),
  };
}

describe('SignalAgent', () => {
  let bus: MessageBus;
  let witness: CompactWitness;
  let agent: SignalAgent;

  beforeEach(async () => {
    bus = createMockBus();
    witness = createMockWitness();
    agent = new SignalAgent(bus, witness);
    await agent.initialize(createDefaultProfile());
    await agent.onActivate();
  });

  describe('basic properties', () => {
    it('has correct id and name', () => {
      expect(agent.id).toBe('signal-agent');
      expect(agent.name).toBe('Signal Agent');
    });

    it('reports capabilities for read-signals topic', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0]!.topic).toBe('read-signals');
    });

    it('reports health correctly after activation', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('active');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
    });
  });

  describe('read-signals handler', () => {
    it('returns a normalized 6-value signal vector', async () => {
      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      const payload = response.payload as { signals: number[]; estimated: boolean[]; hash: string };
      expect(payload.signals).toHaveLength(6);
      expect(payload.estimated).toHaveLength(6);
      expect(typeof payload.hash).toBe('string');
      expect(payload.hash.length).toBeGreaterThan(0);
    });

    it('normalizes values to [0.0, 1.0] range', async () => {
      // Set up witness to return mid-range values
      (witness.readSignal as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: 182.5, // half of max 365 for walletAge
        transactionCount: 10,
      });

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[] };
      // All values should be normalized to 0.5 (182.5 / 365 = 0.5)
      expect(payload.signals[0]).toBeCloseTo(0.5, 4);
    });

    it('clamps values above max to 1.0', async () => {
      (witness.readSignal as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: 500, // above max of 365
        transactionCount: 10,
      });

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[] };
      expect(payload.signals[0]).toBe(1.0);
    });

    it('clamps values below min to 0.0', async () => {
      (witness.readSignal as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: -10,
        transactionCount: 10,
      });

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[] };
      expect(payload.signals[0]).toBe(0.0);
    });

    it('publishes signals.read event with hash (not raw signals)', async () => {
      const request = createReadSignalsRequest();
      await agent.handleMessage(request);

      expect(bus.publish).toHaveBeenCalled();
      const publishedEvent = (bus.publish as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => (call[0] as BusMessage).topic === 'signals.read'
      );
      expect(publishedEvent).toBeDefined();
      const eventPayload = (publishedEvent![0] as BusMessage).payload as Record<string, unknown>;
      expect(typeof eventPayload.hash).toBe('string');
      // Ensure no raw signals are present
      expect(eventPayload.signals).toBeUndefined();
      expect(eventPayload.vector).toBeUndefined();
    });
  });

  describe('insufficient data handling', () => {
    it('assigns 0.5 default when transactionCount < threshold', async () => {
      (witness.readSignal as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: 200,
        transactionCount: 2, // below threshold of 3
      });

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[]; estimated: boolean[] };
      // All signals should be 0.5 with estimated=true
      for (let i = 0; i < 6; i++) {
        expect(payload.signals[i]).toBe(0.5);
        expect(payload.estimated[i]).toBe(true);
      }
    });

    it('sets estimated flag correctly for mixed data availability', async () => {
      let callCount = 0;
      (witness.readSignal as ReturnType<typeof vi.fn>).mockImplementation(
        async (_wallet: string, _signal: SignalType): Promise<RawSignalResult> => {
          callCount++;
          if (callCount <= 3) {
            return { value: 50, transactionCount: 10 }; // sufficient
          }
          return { value: 20, transactionCount: 1 }; // insufficient
        }
      );

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[]; estimated: boolean[] };
      // First 3: not estimated
      expect(payload.estimated[0]).toBe(false);
      expect(payload.estimated[1]).toBe(false);
      expect(payload.estimated[2]).toBe(false);
      // Last 3: estimated
      expect(payload.estimated[3]).toBe(true);
      expect(payload.estimated[4]).toBe(true);
      expect(payload.estimated[5]).toBe(true);
      // Estimated values should be 0.5
      expect(payload.signals[3]).toBe(0.5);
      expect(payload.signals[4]).toBe(0.5);
      expect(payload.signals[5]).toBe(0.5);
    });
  });

  describe('wallet disconnection during read', () => {
    it('aborts and reports succeeded/failed signals on connection error', async () => {
      let callCount = 0;
      (witness.readSignal as ReturnType<typeof vi.fn>).mockImplementation(
        async (_wallet: string, _signal: SignalType): Promise<RawSignalResult> => {
          callCount++;
          if (callCount === 3) {
            throw new WalletConnectionError('Connection lost');
          }
          return { value: 50, transactionCount: 10 };
        }
      );

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      const payload = response.payload as {
        code: string;
        description: string;
        details?: { succeeded: string[]; failed: string[] };
      };
      expect(payload.code).toBe('wallet-disconnected');
      expect(payload.details!.succeeded).toHaveLength(2);
      expect(payload.details!.failed).toHaveLength(4); // The failed one + 3 remaining
    });

    it('discards partial data on connection loss', async () => {
      let callCount = 0;
      (witness.readSignal as ReturnType<typeof vi.fn>).mockImplementation(
        async (): Promise<RawSignalResult> => {
          callCount++;
          if (callCount === 2) {
            throw new WalletConnectionError('Connection lost');
          }
          return { value: 50, transactionCount: 10 };
        }
      );

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      // No signals should be returned (discarded)
      const payload = response.payload as Record<string, unknown>;
      expect(payload.signals).toBeUndefined();
    });
  });

  describe('disconnected wallet rejection', () => {
    it('rejects with invalid-wallet error when wallet is not connected', async () => {
      (witness.isWalletConnected as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      const payload = response.payload as { code: string; description: string };
      expect(payload.code).toBe('invalid-wallet');
    });

    it('does not invoke readSignal when wallet is not connected', async () => {
      (witness.isWalletConnected as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const request = createReadSignalsRequest();
      await agent.handleMessage(request);

      expect(witness.readSignal).not.toHaveBeenCalled();
    });
  });

  describe('normalization with Behavior Profile', () => {
    it('uses normalization parameters from profile', async () => {
      const profile: BehaviorProfile = {
        agentId: 'signal-agent',
        version: 2,
        parameters: {
          minTransactionsForSignal: 3,
          normalization: {
            walletAge: { min: 0, max: 730 }, // 2 years
            transactionFrequency: { min: 0, max: 200 },
            defiInteractions: { min: 0, max: 100 },
            repaymentHistory: { min: 0, max: 100 },
            assetDiversity: { min: 0, max: 40 },
            liquidationHistory: { min: 0, max: 20 },
          },
        },
        lastModified: Date.now(),
      };

      await agent.onConfigUpdate(profile);

      // With new normalization, 365 / 730 = 0.5 for walletAge
      (witness.readSignal as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: 365,
        transactionCount: 10,
      });

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[] };
      expect(payload.signals[0]).toBeCloseTo(0.5, 4);
    });

    it('uses custom minTransactionsForSignal from profile', async () => {
      const profile: BehaviorProfile = {
        agentId: 'signal-agent',
        version: 2,
        parameters: {
          minTransactionsForSignal: 5,
          normalization: {
            walletAge: { min: 0, max: 365 },
            transactionFrequency: { min: 0, max: 100 },
            defiInteractions: { min: 0, max: 50 },
            repaymentHistory: { min: 0, max: 100 },
            assetDiversity: { min: 0, max: 20 },
            liquidationHistory: { min: 0, max: 10 },
          },
        },
        lastModified: Date.now(),
      };

      await agent.onConfigUpdate(profile);

      // 4 transactions is now below the threshold of 5
      (witness.readSignal as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: 200,
        transactionCount: 4,
      });

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      const payload = response.payload as { signals: number[]; estimated: boolean[] };
      expect(payload.signals[0]).toBe(0.5);
      expect(payload.estimated[0]).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns error for unsupported topic', async () => {
      const msg: BusMessage = {
        id: uuidv4(),
        sourceAgentId: 'orchestrator-agent',
        targetAgentId: 'signal-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'unknown-topic',
        payload: {},
      };

      const response = await agent.handleMessage(msg);
      expect(response.type).toBe('error');
      const payload = response.payload as { code: string };
      expect(payload.code).toBe('unsupported-topic');
    });

    it('returns error when walletAddress is missing', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'orchestrator-agent',
        targetAgentId: 'signal-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'read-signals',
        payload: {},
      };

      const response = await agent.handleMessage(msg);
      expect(response.type).toBe('error');
      const payload = response.payload as { code: string };
      expect(payload.code).toBe('invalid-request');
    });

    it('handles non-connection read errors with succeeded/failed report', async () => {
      let callCount = 0;
      (witness.readSignal as ReturnType<typeof vi.fn>).mockImplementation(
        async (): Promise<RawSignalResult> => {
          callCount++;
          if (callCount === 4) {
            throw new Error('Unexpected read error');
          }
          return { value: 50, transactionCount: 10 };
        }
      );

      const request = createReadSignalsRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      const payload = response.payload as {
        code: string;
        details?: { succeeded: string[]; failed: string[] };
      };
      expect(payload.code).toBe('signal-read-failed');
      expect(payload.details!.succeeded).toHaveLength(3);
      expect(payload.details!.failed).toHaveLength(3);
    });
  });

  describe('health tracking', () => {
    it('increments request count on each handled message', async () => {
      const request = createReadSignalsRequest();
      await agent.handleMessage(request);
      await agent.handleMessage(request);

      const health = agent.getHealth();
      expect(health.requestCount).toBe(2);
    });

    it('increments error count on failures', async () => {
      (witness.isWalletConnected as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const request = createReadSignalsRequest();
      await agent.handleMessage(request);

      const health = agent.getHealth();
      expect(health.errorCount).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('transitions to idle on deactivate', async () => {
      await agent.onDeactivate();
      const health = agent.getHealth();
      expect(health.state).toBe('idle');
    });
  });
});
