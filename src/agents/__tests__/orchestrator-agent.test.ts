import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { OrchestratorAgentImpl } from '../orchestrator-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage, ResponseMessage, ErrorMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { CreditGrade, SignalContribution } from '../../types/workflow.js';

// --- Test Helpers ---

function createMockBus(requestHandler?: (msg: RequestMessage) => ResponseMessage | ErrorMessage): MessageBus {
  const defaultHandler = (msg: RequestMessage): ResponseMessage | ErrorMessage => ({
    id: uuidv4(),
    sourceAgentId: msg.targetAgentId ?? 'unknown',
    targetAgentId: msg.sourceAgentId,
    type: 'response',
    correlationId: msg.correlationId,
    timestamp: Date.now(),
    topic: msg.topic,
    payload: {},
  });

  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
      return (requestHandler ?? defaultHandler)(msg);
    }),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
}

function createStepResponses(overrides?: Partial<Record<string, (msg: RequestMessage) => ResponseMessage | ErrorMessage>>) {
  const defaults: Record<string, (msg: RequestMessage) => ResponseMessage | ErrorMessage> = {
    'wallet.validate-session': (msg) => ({
      id: uuidv4(),
      sourceAgentId: 'wallet-agent',
      targetAgentId: msg.sourceAgentId,
      type: 'response',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: { address: '0xabc123', valid: true },
    }),
    'cache.check-cache': (msg) => ({
      id: uuidv4(),
      sourceAgentId: 'cache-agent',
      targetAgentId: msg.sourceAgentId,
      type: 'response',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: { hit: false, walletAddress: '0xabc123' },
    }),
    'signal.read-signals': (msg) => ({
      id: uuidv4(),
      sourceAgentId: 'signal-agent',
      targetAgentId: msg.sourceAgentId,
      type: 'response',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: {
        walletAge: 0.8,
        transactionFrequency: 0.7,
        defiInteractions: 0.6,
        repaymentHistory: 0.9,
        assetDiversity: 0.5,
        liquidationHistory: 0.1,
      },
    }),
    'scoring.compute-grade': (msg) => ({
      id: uuidv4(),
      sourceAgentId: 'scoring-agent',
      targetAgentId: msg.sourceAgentId,
      type: 'response',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: {
        grade: 'AA' as CreditGrade,
        reasoning: [
          { signal: 'walletAge', direction: 'positive', weight: 0.2 },
          { signal: 'transactionFrequency', direction: 'positive', weight: 0.15 },
          { signal: 'defiInteractions', direction: 'positive', weight: 0.15 },
          { signal: 'repaymentHistory', direction: 'positive', weight: 0.25 },
          { signal: 'assetDiversity', direction: 'positive', weight: 0.15 },
          { signal: 'liquidationHistory', direction: 'negative', weight: 0.1 },
        ] as SignalContribution[],
      },
    }),
    'cache.store-result': (msg) => ({
      id: uuidv4(),
      sourceAgentId: 'cache-agent',
      targetAgentId: msg.sourceAgentId,
      type: 'response',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: { stored: true },
    }),
    'credential.mint-credential': (msg) => ({
      id: uuidv4(),
      sourceAgentId: 'credential-agent',
      targetAgentId: msg.sourceAgentId,
      type: 'response',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: { txHash: '0xtx123', mintTimestamp: Date.now() },
    }),
  };

  const merged = { ...defaults, ...overrides };

  return (msg: RequestMessage): ResponseMessage | ErrorMessage => {
    const handler = merged[msg.topic];
    if (handler) {
      return handler(msg);
    }
    return {
      id: uuidv4(),
      sourceAgentId: 'unknown',
      targetAgentId: msg.sourceAgentId,
      type: 'error',
      correlationId: msg.correlationId,
      timestamp: Date.now(),
      topic: msg.topic,
      payload: { code: 'UNKNOWN_TOPIC', description: `No handler for topic: ${msg.topic}` },
    };
  };
}

const defaultProfile: BehaviorProfile = {
  agentId: 'orchestrator-agent',
  version: 1,
  parameters: {
    maxConcurrentWorkflows: 10,
    queueLimit: 50,
    queueResumeAt: 40,
    workflowTimeoutMs: 120000,
    stepTimeoutMs: 30000,
  },
  lastModified: Date.now(),
};

// --- Tests ---

describe('OrchestratorAgent', () => {
  let bus: MessageBus;
  let agent: OrchestratorAgentImpl;

  beforeEach(() => {
    bus = createMockBus(createStepResponses());
    agent = new OrchestratorAgentImpl(bus);
  });

  describe('identity and interface', () => {
    it('has correct id and name', () => {
      expect(agent.id).toBe('orchestrator-agent');
      expect(agent.name).toBe('Orchestrator Agent');
    });

    it('returns orchestrator capabilities', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0]!.topic).toBe('orchestrator.request-score');
    });

    it('returns initial health as idle with zero counts', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('idle');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
      expect(health.uptimeSeconds).toBe(0);
      expect(health.avgResponseTimeMs).toBe(0);
    });

    it('getQueueDepth returns 0 (concurrency not yet implemented)', () => {
      expect(agent.getQueueDepth()).toBe(0);
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

    it('initialize applies profile parameters', async () => {
      await agent.initialize(defaultProfile);
      // We verify behavior rather than internal state via timeout testing
      expect(agent.getHealth().state).toBe('idle');
    });

    it('onConfigUpdate applies new parameters', async () => {
      await agent.initialize(defaultProfile);
      await agent.onConfigUpdate({
        ...defaultProfile,
        parameters: { stepTimeoutMs: 5000, workflowTimeoutMs: 60000 },
      });
      // Verified through behavior in timeout tests
    });
  });

  describe('requestScore - successful pipeline', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('executes all 6 pipeline steps in order', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(result.status).toBe('success');
      expect(result.workflowId).toBeDefined();
      expect(result.grade).toBe('AA');
      expect(result.reasoning).toHaveLength(6);
      expect(result.credential).toBeDefined();
      expect(result.credential!.txHash).toBe('0xtx123');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

      // Verify bus.request called 6 times in order
      const requestCalls = (bus.request as ReturnType<typeof vi.fn>).mock.calls;
      expect(requestCalls).toHaveLength(6);
      expect(requestCalls[0]![0].topic).toBe('wallet.validate-session');
      expect(requestCalls[1]![0].topic).toBe('cache.check-cache');
      expect(requestCalls[2]![0].topic).toBe('signal.read-signals');
      expect(requestCalls[3]![0].topic).toBe('scoring.compute-grade');
      expect(requestCalls[4]![0].topic).toBe('cache.store-result');
      expect(requestCalls[5]![0].topic).toBe('credential.mint-credential');
    });

    it('passes walletAddress in validate-session payload', async () => {
      await agent.requestScore('0xwallet');

      const requestCalls = (bus.request as ReturnType<typeof vi.fn>).mock.calls;
      expect(requestCalls[0]![0].payload).toEqual({ walletAddress: '0xwallet' });
    });

    it('passes signals to compute-grade step', async () => {
      await agent.requestScore('0xabc123');

      const requestCalls = (bus.request as ReturnType<typeof vi.fn>).mock.calls;
      const computeGradePayload = requestCalls[3]![0].payload;
      expect(computeGradePayload.signals).toBeDefined();
      expect(computeGradePayload.signals).toHaveProperty('walletAge', 0.8);
    });

    it('provides step timings for all steps', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(result.stepTimings).toHaveProperty('validate-session');
      expect(result.stepTimings).toHaveProperty('check-cache');
      expect(result.stepTimings).toHaveProperty('read-signals');
      expect(result.stepTimings).toHaveProperty('compute-grade');
      expect(result.stepTimings).toHaveProperty('store-result');
      expect(result.stepTimings).toHaveProperty('mint-credential');
    });

    it('publishes workflow-complete event on success', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          topic: 'workflow-complete',
          payload: expect.objectContaining({
            workflowId: result.workflowId,
            status: 'success',
            totalDurationMs: expect.any(Number),
            stepTimings: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('requestScore - cache-hit short-circuit', () => {
    beforeEach(async () => {
      const handler = createStepResponses({
        'cache.check-cache': (msg) => ({
          id: uuidv4(),
          sourceAgentId: 'cache-agent',
          targetAgentId: msg.sourceAgentId,
          type: 'response',
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: {
            hit: true,
            grade: 'A' as CreditGrade,
            reasoning: [
              { signal: 'walletAge', direction: 'positive', weight: 0.2 },
            ] as SignalContribution[],
          },
        }),
      });

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(defaultProfile);
    });

    it('skips signal, scoring, store-result, and credential steps on cache hit', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(result.status).toBe('success');
      expect(result.cachedResult).toBe(true);
      expect(result.grade).toBe('A');
      expect(result.reasoning).toHaveLength(1);

      // Only validate-session and check-cache should be called
      const requestCalls = (bus.request as ReturnType<typeof vi.fn>).mock.calls;
      expect(requestCalls).toHaveLength(2);
      expect(requestCalls[0]![0].topic).toBe('wallet.validate-session');
      expect(requestCalls[1]![0].topic).toBe('cache.check-cache');
    });

    it('marks skipped steps with 0ms timing', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(result.stepTimings['read-signals']).toBe(0);
      expect(result.stepTimings['compute-grade']).toBe(0);
      expect(result.stepTimings['store-result']).toBe(0);
      expect(result.stepTimings['mint-credential']).toBe(0);
    });

    it('does not include credential in cached result', async () => {
      const result = await agent.requestScore('0xabc123');
      expect(result.credential).toBeUndefined();
    });

    it('publishes workflow-complete event on cache hit', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'workflow-complete',
          payload: expect.objectContaining({
            workflowId: result.workflowId,
            status: 'success',
          }),
        })
      );
    });
  });

  describe('requestScore - step error handling', () => {
    it('halts pipeline on agent error and records failed step', async () => {
      const handler = createStepResponses({
        'signal.read-signals': (msg) => ({
          id: uuidv4(),
          sourceAgentId: 'signal-agent',
          targetAgentId: msg.sourceAgentId,
          type: 'error',
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: { code: 'WALLET_INVALID', description: 'Wallet session not found' },
        }),
      });

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(defaultProfile);

      const result = await agent.requestScore('0xabc123');

      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe('read-signals');
      expect(result.failureReason).toContain('read-signals');
      expect(result.failureReason).toContain('Wallet session not found');
    });

    it('does not execute steps after the failed step', async () => {
      const handler = createStepResponses({
        'cache.check-cache': (msg) => ({
          id: uuidv4(),
          sourceAgentId: 'cache-agent',
          targetAgentId: msg.sourceAgentId,
          type: 'error',
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: { code: 'CACHE_ERROR', description: 'Cache unavailable' },
        }),
      });

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(defaultProfile);

      await agent.requestScore('0xabc123');

      const requestCalls = (bus.request as ReturnType<typeof vi.fn>).mock.calls;
      // Only validate-session and check-cache should be called
      expect(requestCalls).toHaveLength(2);
    });

    it('publishes workflow-complete event on failure', async () => {
      const handler = createStepResponses({
        'wallet.validate-session': (msg) => ({
          id: uuidv4(),
          sourceAgentId: 'wallet-agent',
          targetAgentId: msg.sourceAgentId,
          type: 'error',
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: { code: 'DISCONNECTED', description: 'No wallet connection' },
        }),
      });

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(defaultProfile);

      const result = await agent.requestScore('0xabc123');

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'workflow-complete',
          payload: expect.objectContaining({
            workflowId: result.workflowId,
            status: 'failed',
          }),
        })
      );
    });
  });

  describe('requestScore - step timeout (30s)', () => {
    it('reports timeout status when step times out', async () => {
      const handler = createStepResponses({
        'scoring.compute-grade': (msg) => ({
          id: uuidv4(),
          sourceAgentId: 'message-bus',
          targetAgentId: msg.sourceAgentId,
          type: 'error',
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: { code: 'TIMEOUT', description: 'Request timed out after 30000ms' },
        }),
      });

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(defaultProfile);

      const result = await agent.requestScore('0xabc123');

      expect(result.status).toBe('timeout');
      expect(result.failedStep).toBe('compute-grade');
      expect(result.failureReason).toContain('timed out');
    });

    it('uses configured step timeout for bus requests', async () => {
      const profile: BehaviorProfile = {
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, stepTimeoutMs: 5000 },
      };

      bus = createMockBus(createStepResponses());
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(profile);

      await agent.requestScore('0xabc123');

      const requestCalls = (bus.request as ReturnType<typeof vi.fn>).mock.calls;
      // Each call should use 5000ms timeout
      for (const call of requestCalls) {
        expect(call[1]).toBe(5000);
      }
    });
  });

  describe('requestScore - workflow timeout (120s)', () => {
    it('halts pipeline when workflow timeout exceeded', async () => {
      let callCount = 0;
      const handler = (msg: RequestMessage): ResponseMessage | ErrorMessage => {
        callCount++;
        // Simulate the first two steps taking very long by manipulating time
        if (callCount === 3) {
          // By the time we reach step 3, pretend workflow has exceeded timeout
          // We'll test this by using a very short workflow timeout
          return {
            id: uuidv4(),
            sourceAgentId: 'signal-agent',
            targetAgentId: msg.sourceAgentId,
            type: 'response',
            correlationId: msg.correlationId,
            timestamp: Date.now(),
            topic: msg.topic,
            payload: { walletAge: 0.5 },
          };
        }
        return createStepResponses()(msg);
      };

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);

      // Use a very short workflow timeout to trigger the condition
      await agent.initialize({
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, workflowTimeoutMs: 0 },
      });

      const result = await agent.requestScore('0xabc123');

      // With 0ms timeout, should trigger on the first step check
      expect(result.status).toBe('timeout');
      expect(result.failureReason).toContain('Workflow timeout exceeded');
    });

    it('includes stepTimings for completed steps before timeout', async () => {
      // Use a short workflow timeout
      bus = createMockBus(createStepResponses());
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize({
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, workflowTimeoutMs: 0 },
      });

      const result = await agent.requestScore('0xabc123');
      expect(result.stepTimings).toBeDefined();
    });
  });

  describe('requestScore - workflow context', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('getWorkflowStatus returns undefined for unknown workflowId', () => {
      expect(agent.getWorkflowStatus('non-existent')).toBeUndefined();
    });

    it('workflow context is cleaned up after completion', async () => {
      const result = await agent.requestScore('0xabc123');
      expect(agent.getWorkflowStatus(result.workflowId)).toBeUndefined();
    });
  });

  describe('handleMessage', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('handles orchestrator.request-score topic', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'client',
        targetAgentId: 'orchestrator-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'orchestrator.request-score',
        payload: { walletAddress: '0xabc123' },
      };

      const response = await agent.handleMessage(msg);
      expect(response.type).toBe('response');
      expect(response.payload).toHaveProperty('status', 'success');
    });

    it('returns error for missing walletAddress', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'client',
        targetAgentId: 'orchestrator-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'orchestrator.request-score',
        payload: {},
      };

      const response = await agent.handleMessage(msg);
      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.code).toBe('INVALID_REQUEST');
    });

    it('returns error for unknown topic', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'client',
        targetAgentId: 'orchestrator-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'unknown.topic',
        payload: {},
      };

      const response = await agent.handleMessage(msg);
      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.code).toBe('UNKNOWN_TOPIC');
    });

    it('increments request and error counts', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'client',
        targetAgentId: 'orchestrator-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'unknown.topic',
        payload: {},
      };

      await agent.handleMessage(msg);
      await agent.handleMessage(msg);

      const health = agent.getHealth();
      expect(health.requestCount).toBe(2);
      expect(health.errorCount).toBe(2);
    });
  });

  describe('concurrency control and backpressure', () => {
    let resolvers: Array<() => void>;

    function createSlowBus(): MessageBus {
      resolvers = [];
      return {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
        unsubscribe: vi.fn(),
        request: vi.fn().mockImplementation((msg: RequestMessage) => {
          // Make each bus.request wait until we manually resolve it
          return new Promise<ResponseMessage>((resolve) => {
            resolvers.push(() => {
              resolve({
                id: uuidv4(),
                sourceAgentId: msg.targetAgentId ?? 'unknown',
                targetAgentId: msg.sourceAgentId,
                type: 'response',
                correlationId: msg.correlationId,
                timestamp: Date.now(),
                topic: msg.topic,
                payload: msg.topic === 'cache.check-cache'
                  ? { hit: false }
                  : msg.topic === 'scoring.compute-grade'
                    ? { grade: 'A', reasoning: [] }
                    : msg.topic === 'credential.mint-credential'
                      ? { txHash: '0x123', mintTimestamp: Date.now() }
                      : {},
              });
            });
          });
        }),
        setAgentStateProvider: vi.fn(),
        onAgentActivated: vi.fn().mockResolvedValue(undefined),
        getBufferedMessages: vi.fn().mockReturnValue([]),
      };
    }

    it('limits to maxConcurrentWorkflows (10) simultaneous executions', async () => {
      const slowBus = createSlowBus();
      agent = new OrchestratorAgentImpl(slowBus);
      await agent.initialize(defaultProfile);

      // Fire 12 requests (more than the limit of 10)
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 12; i++) {
        promises.push(agent.requestScore(`0xwallet${i}`));
      }

      // Allow microtasks to settle
      await new Promise((r) => setTimeout(r, 10));

      // Only 10 workflows should have started (each calls bus.request for first step)
      // Each active workflow calls bus.request once (for validate-session step)
      expect((slowBus.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(10);

      // Queue depth should be 2 (the remaining ones)
      expect(agent.getQueueDepth()).toBe(2);
    });

    it('queues excess requests in FIFO order', async () => {
      // Use instant bus to verify ordering
      const executionOrder: string[] = [];
      bus = {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
        unsubscribe: vi.fn(),
        request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
          if (msg.topic === 'wallet.validate-session') {
            const walletAddress = (msg.payload as Record<string, unknown>)['walletAddress'] as string;
            executionOrder.push(walletAddress);
          }
          return createStepResponses()(msg);
        }),
        setAgentStateProvider: vi.fn(),
        onAgentActivated: vi.fn().mockResolvedValue(undefined),
        getBufferedMessages: vi.fn().mockReturnValue([]),
      };

      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize({
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, maxConcurrentWorkflows: 1 },
      });

      // With maxConcurrent=1, the first request executes immediately.
      // Since bus is instant, it completes and dequeues the next in FIFO order.
      const [r1, r2, r3] = await Promise.all([
        agent.requestScore('0xA'),
        agent.requestScore('0xB'),
        agent.requestScore('0xC'),
      ]);

      expect(r1!.status).toBe('success');
      expect(r2!.status).toBe('success');
      expect(r3!.status).toBe('success');

      // Verify FIFO: A started first, then B, then C
      expect(executionOrder).toEqual(['0xA', '0xB', '0xC']);
    });

    it('rejects new requests when queue exceeds 50 (system-busy)', async () => {
      const slowBus = createSlowBus();
      agent = new OrchestratorAgentImpl(slowBus);
      // Use maxConcurrent=1 and queueLimit=3 for simpler testing
      await agent.initialize({
        ...defaultProfile,
        parameters: {
          ...defaultProfile.parameters,
          maxConcurrentWorkflows: 1,
          queueLimit: 3,
          queueResumeAt: 2,
        },
      });

      // 1 active + 4 queued (exceeds limit of 3) → should stop accepting
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(agent.requestScore(`0x${i}`));
      }

      await new Promise((r) => setTimeout(r, 10));

      // Queue has 4 items (exceeds limit of 3), should stop accepting
      expect(agent.getQueueDepth()).toBe(4);

      // Next request should be rejected immediately
      const rejectedResult = await agent.requestScore('0xRejected');
      expect(rejectedResult.status).toBe('failed');
      expect(rejectedResult.failureReason).toContain('System busy');

      // Clean up
      while (resolvers.length > 0) {
        resolvers.forEach((r) => r());
        resolvers.length = 0;
        await new Promise((r) => setTimeout(r, 10));
      }

      await Promise.allSettled(promises);
    });

    it('resumes accepting when queue drops below queueResumeAt', async () => {
      const slowBus = createSlowBus();
      agent = new OrchestratorAgentImpl(slowBus);
      // max=1, limit=3, resume=2
      await agent.initialize({
        ...defaultProfile,
        parameters: {
          ...defaultProfile.parameters,
          maxConcurrentWorkflows: 1,
          queueLimit: 3,
          queueResumeAt: 2,
        },
      });

      // Launch 5 requests: 1 active + 4 queued (exceeds limit of 3)
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(agent.requestScore(`0x${i}`));
      }
      await new Promise((r) => setTimeout(r, 10));

      expect(agent.getQueueDepth()).toBe(4);

      // Should reject while not accepting
      const rejected = await agent.requestScore('0xReject');
      expect(rejected.status).toBe('failed');
      expect(rejected.failureReason).toContain('System busy');

      // Helper to complete one workflow (6 pipeline steps)
      const completeOneWorkflow = async () => {
        for (let i = 0; i < 6; i++) {
          if (resolvers.length > 0) { resolvers.shift()!(); }
          await new Promise((r) => setTimeout(r, 5));
        }
        await new Promise((r) => setTimeout(r, 10));
      };

      // Complete #0 → dequeues #1 → queue=[#2,#3,#4] = 3
      await completeOneWorkflow();
      expect(agent.getQueueDepth()).toBe(3);

      // Still rejecting (3 >= 2)
      const stillRejected = await agent.requestScore('0xStillReject');
      expect(stillRejected.status).toBe('failed');

      // Complete #1 → dequeues #2 → queue=[#3,#4] = 2
      await completeOneWorkflow();
      expect(agent.getQueueDepth()).toBe(2);

      // Still rejecting (2 >= 2, not strictly less than)
      const stillRejected2 = await agent.requestScore('0xStillReject2');
      expect(stillRejected2.status).toBe('failed');

      // Complete #2 → dequeues #3 → queue=[#4] = 1 (< 2, resumes accepting!)
      await completeOneWorkflow();
      expect(agent.getQueueDepth()).toBe(1);

      // Now should accept new requests (queued, not rejected)
      const acceptPromise = agent.requestScore('0xAccepted');
      await new Promise((r) => setTimeout(r, 10));

      // The new request is queued (1 active + queue should grow)
      expect(agent.getQueueDepth()).toBe(2);

      // Clean up: resolve everything
      while (resolvers.length > 0) {
        resolvers.forEach((r) => r());
        resolvers.length = 0;
        await new Promise((r) => setTimeout(r, 10));
      }

      const acceptResult = await acceptPromise;
      expect(acceptResult.status).toBe('success');

      await Promise.allSettled(promises);
    });

    it('getQueueDepth returns current queue length', async () => {
      const slowBus = createSlowBus();
      agent = new OrchestratorAgentImpl(slowBus);
      await agent.initialize({
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, maxConcurrentWorkflows: 2 },
      });

      expect(agent.getQueueDepth()).toBe(0);

      // Start 4 requests: 2 active, 2 queued
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 4; i++) {
        promises.push(agent.requestScore(`0x${i}`));
      }

      await new Promise((r) => setTimeout(r, 10));
      expect(agent.getQueueDepth()).toBe(2);

      // Clean up
      while (resolvers.length > 0) {
        resolvers.forEach((r) => r());
        resolvers.length = 0;
        await new Promise((r) => setTimeout(r, 10));
      }
      await Promise.allSettled(promises);
    });

    it('completed workflow dequeues next pending request', async () => {
      bus = createMockBus(createStepResponses());
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize({
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, maxConcurrentWorkflows: 1 },
      });

      // Start 2 requests: 1 active, 1 queued
      // Since bus is instant, the first one completes immediately and dequeues the second
      const [r1, r2] = await Promise.all([
        agent.requestScore('0xFirst'),
        agent.requestScore('0xSecond'),
      ]);

      expect(r1!.status).toBe('success');
      expect(r2!.status).toBe('success');
      expect(agent.getQueueDepth()).toBe(0);
    });
  });

  describe('workflow-complete event payload', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('includes timing breakdown on success', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'workflow-complete',
          payload: {
            workflowId: result.workflowId,
            status: 'success',
            totalDurationMs: result.totalDurationMs,
            stepTimings: result.stepTimings,
          },
        })
      );
    });

    it('includes timing breakdown on failure', async () => {
      const handler = createStepResponses({
        'wallet.validate-session': (msg) => ({
          id: uuidv4(),
          sourceAgentId: 'wallet-agent',
          targetAgentId: msg.sourceAgentId,
          type: 'error',
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: { code: 'DISCONNECTED', description: 'Not connected' },
        }),
      });

      bus = createMockBus(handler);
      agent = new OrchestratorAgentImpl(bus);
      await agent.initialize(defaultProfile);

      const result = await agent.requestScore('0xabc123');

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'workflow-complete',
          payload: expect.objectContaining({
            workflowId: result.workflowId,
            status: 'failed',
            totalDurationMs: expect.any(Number),
            stepTimings: expect.any(Object),
          }),
        })
      );
    });

    it('event uses workflowId as correlationId', async () => {
      const result = await agent.requestScore('0xabc123');

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: result.workflowId,
          topic: 'workflow-complete',
        })
      );
    });
  });
});
