/**
 * Property-Based Tests: Orchestrator Agent (Properties 8-11)
 *
 * Property 8: Cache-Hit Pipeline Short-Circuit
 * Property 9: Pipeline Halt on Agent Failure
 * Property 10: Workflow Context Accumulation
 * Property 11: Concurrency and Backpressure
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { OrchestratorAgentImpl } from '../orchestrator-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type {
  RequestMessage, ResponseMessage, ErrorMessage,
} from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';
import type {
  CreditGrade, SignalContribution, PipelineStep,
} from '../../types/workflow.js';

// --- Arbitraries ---

const CREDIT_GRADES: CreditGrade[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'];
const arbCreditGrade = fc.constantFrom(...CREDIT_GRADES);
const arbWalletAddress = fc.hexaString({ minLength: 8, maxLength: 42 })
  .map(s => `0x${s}`);

const arbReasoning: fc.Arbitrary<SignalContribution[]> = fc.tuple(
  fc.constantFrom('positive' as const, 'negative' as const),
  fc.double({ min: 0, max: 1, noNaN: true }),
).map(([dir, w]) => [
  { signal: 'walletAge', direction: dir, weight: w },
  { signal: 'transactionFrequency', direction: dir, weight: w },
  { signal: 'defiInteractions', direction: dir, weight: w },
  { signal: 'repaymentHistory', direction: dir, weight: w },
  { signal: 'assetDiversity', direction: dir, weight: w },
  { signal: 'liquidationHistory', direction: dir, weight: w },
]);

const PIPELINE_STEPS: PipelineStep[] = [
  'validate-session', 'check-cache', 'read-signals',
  'compute-grade', 'store-result', 'mint-credential',
];

const SKIPPED_ON_CACHE_HIT: PipelineStep[] = [
  'read-signals', 'compute-grade', 'store-result', 'mint-credential',
];

const FAILABLE_STEPS: PipelineStep[] = [
  'validate-session', 'check-cache', 'read-signals',
  'compute-grade', 'store-result', 'mint-credential',
];

const arbErrorCode = fc.constantFrom(
  'TIMEOUT', 'WALLET_INVALID', 'CACHE_ERROR', 'SIGNAL_FAILED',
  'SCORING_ERROR', 'MINT_FAILED', 'INTERNAL_ERROR',
);
const arbErrorDescription = fc.string({ minLength: 1, maxLength: 100 });


// --- Mock Bus Factory ---

const STEP_TOPIC_MAP: Record<PipelineStep, string> = {
  'validate-session': 'wallet.validate-session',
  'check-cache': 'cache.check-cache',
  'read-signals': 'signal.read-signals',
  'compute-grade': 'scoring.compute-grade',
  'store-result': 'cache.store-result',
  'mint-credential': 'credential.mint-credential',
};

const TOPIC_TO_STEP: Record<string, PipelineStep> = Object.fromEntries(
  Object.entries(STEP_TOPIC_MAP).map(([step, topic]) => [topic, step as PipelineStep])
) as Record<string, PipelineStep>;

interface MockBusOptions {
  cacheHit?: { grade: CreditGrade; reasoning: SignalContribution[] };
  failAtStep?: PipelineStep;
  failError?: { code: string; description: string };
  signals?: Record<string, number>;
  grade?: CreditGrade;
  reasoning?: SignalContribution[];
}

function createMockBus(options: MockBusOptions = {}): MessageBus & {
  requestCalls: RequestMessage[];
} {
  const requestCalls: RequestMessage[] = [];
  const bus: MessageBus & { requestCalls: RequestMessage[] } = {
    requestCalls,
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
      requestCalls.push(msg);
      const step = TOPIC_TO_STEP[msg.topic];
      if (options.failAtStep && step === options.failAtStep) {
        const err = options.failError ?? { code: 'TIMEOUT', description: 'Timed out' };
        return {
          id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
          targetAgentId: msg.sourceAgentId, type: 'error',
          correlationId: msg.correlationId, timestamp: Date.now(),
          topic: msg.topic, payload: err,
        } as ErrorMessage;
      }
      const payload = buildStepResponse(step, options);
      return {
        id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
        targetAgentId: msg.sourceAgentId, type: 'response',
        correlationId: msg.correlationId, timestamp: Date.now(),
        topic: msg.topic, payload,
      } as ResponseMessage;
    }),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
  return bus;
}

function buildStepResponse(
  step: PipelineStep | undefined,
  options: MockBusOptions,
): Record<string, unknown> {
  switch (step) {
    case 'validate-session':
      return { address: '0xvalidated', valid: true };
    case 'check-cache':
      if (options.cacheHit) {
        return { hit: true, grade: options.cacheHit.grade, reasoning: options.cacheHit.reasoning };
      }
      return { hit: false, walletAddress: '0xtest' };
    case 'read-signals':
      return options.signals ?? {
        walletAge: 0.8, transactionFrequency: 0.7, defiInteractions: 0.6,
        repaymentHistory: 0.9, assetDiversity: 0.5, liquidationHistory: 0.1,
      };
    case 'compute-grade':
      return {
        grade: options.grade ?? 'AA',
        reasoning: options.reasoning ?? [
          { signal: 'walletAge', direction: 'positive', weight: 0.2 },
          { signal: 'transactionFrequency', direction: 'positive', weight: 0.15 },
          { signal: 'defiInteractions', direction: 'positive', weight: 0.15 },
          { signal: 'repaymentHistory', direction: 'positive', weight: 0.25 },
          { signal: 'assetDiversity', direction: 'positive', weight: 0.15 },
          { signal: 'liquidationHistory', direction: 'negative', weight: 0.1 },
        ],
      };
    case 'store-result':
      return { stored: true };
    case 'mint-credential':
      return { txHash: '0xtx' + Date.now(), mintTimestamp: Date.now() };
    default:
      return {};
  }
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

// =============================================================================
// Property 8: Cache-Hit Pipeline Short-Circuit
// **Validates: Requirements 3.2**
// =============================================================================

describe('Property 8: Cache-Hit Pipeline Short-Circuit', { tags: ['Feature: adaptive-agents', 'Property 8: Cache-Hit Pipeline Short-Circuit'] }, () => {
  it('skips Signal, Scoring, and Credential steps when cache returns a hit', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbCreditGrade,
        arbReasoning,
        async (walletAddress, grade, reasoning) => {
          const bus = createMockBus({ cacheHit: { grade, reasoning } });
          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const result = await agent.requestScore(walletAddress);

          expect(result.status).toBe('success');
          expect(result.cachedResult).toBe(true);
          expect(result.grade).toBe(grade);

          const calledTopics = bus.requestCalls.map(c => c.topic);
          expect(calledTopics).toContain('wallet.validate-session');
          expect(calledTopics).toContain('cache.check-cache');
          expect(calledTopics).not.toContain('signal.read-signals');
          expect(calledTopics).not.toContain('scoring.compute-grade');
          expect(calledTopics).not.toContain('credential.mint-credential');

          for (const skipped of SKIPPED_ON_CACHE_HIT) {
            expect(result.stepTimings[skipped]).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 9: Pipeline Halt on Agent Failure
// **Validates: Requirements 3.3, 3.8**
// =============================================================================

describe('Property 9: Pipeline Halt on Agent Failure', { tags: ['Feature: adaptive-agents', 'Property 9: Pipeline Halt on Agent Failure'] }, () => {
  it('halts pipeline and records failure when any step returns an error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        fc.constantFrom(...FAILABLE_STEPS),
        arbErrorCode,
        arbErrorDescription,
        async (walletAddress, failStep, errorCode, errorDescription) => {
          const bus = createMockBus({
            failAtStep: failStep,
            failError: { code: errorCode, description: errorDescription },
          });
          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const result = await agent.requestScore(walletAddress);

          if (errorCode === 'TIMEOUT') {
            expect(result.status).toBe('timeout');
          } else {
            expect(result.status).toBe('failed');
          }

          expect(result.failedStep).toBe(failStep);
          expect(result.failureReason).toBeDefined();
          expect(result.failureReason!.length).toBeGreaterThan(0);

          const failIndex = PIPELINE_STEPS.indexOf(failStep);
          const calledTopics = bus.requestCalls.map(c => c.topic);
          for (let i = failIndex + 1; i < PIPELINE_STEPS.length; i++) {
            const laterStep = PIPELINE_STEPS[i]!;
            expect(calledTopics).not.toContain(STEP_TOPIC_MAP[laterStep]);
          }

          expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('halts pipeline on timeout and records correct failure type', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        fc.constantFrom(...FAILABLE_STEPS),
        async (walletAddress, failStep) => {
          const bus = createMockBus({
            failAtStep: failStep,
            failError: { code: 'TIMEOUT', description: 'Timed out after 30000ms' },
          });
          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const result = await agent.requestScore(walletAddress);

          expect(result.status).toBe('timeout');
          expect(result.failedStep).toBe(failStep);
          expect(result.failureReason).toContain('timed out');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 10: Workflow Context Accumulation
// **Validates: Requirements 3.4, 3.5**
// =============================================================================

describe('Property 10: Workflow Context Accumulation', { tags: ['Feature: adaptive-agents', 'Property 10: Workflow Context Accumulation'] }, () => {
  it('accumulates correct workflow ID, step results, and timings', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbCreditGrade,
        arbReasoning,
        async (walletAddress, grade, reasoning) => {
          const requestCalls: RequestMessage[] = [];
          const bus: MessageBus & { requestCalls: RequestMessage[] } = {
            requestCalls,
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
            unsubscribe: vi.fn(),
            request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
              requestCalls.push(msg);
              const step = TOPIC_TO_STEP[msg.topic];
              const payload = buildStepResponse(step, { grade, reasoning });
              return {
                id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
                targetAgentId: msg.sourceAgentId, type: 'response',
                correlationId: msg.correlationId, timestamp: Date.now(),
                topic: msg.topic, payload,
              } as ResponseMessage;
            }),
            setAgentStateProvider: vi.fn(),
            onAgentActivated: vi.fn().mockResolvedValue(undefined),
            getBufferedMessages: vi.fn().mockReturnValue([]),
          };

          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);
          const result = await agent.requestScore(walletAddress);

          expect(result.status).toBe('success');
          expect(result.workflowId).toBeDefined();
          expect(result.workflowId.length).toBeGreaterThan(0);
          expect(result.grade).toBe(grade);
          expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

          for (const step of PIPELINE_STEPS) {
            expect(result.stepTimings[step]).toBeDefined();
            expect(result.stepTimings[step]).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('publishes workflow-complete event with correct metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        arbCreditGrade,
        async (walletAddress, grade) => {
          const bus = createMockBus({ grade });
          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const result = await agent.requestScore(walletAddress);
          expect(result.status).toBe('success');

          const publishCalls = (bus.publish as ReturnType<typeof vi.fn>).mock.calls;
          expect(publishCalls.length).toBeGreaterThan(0);

          const completeEvent = publishCalls.find(
            (call: unknown[]) => (call[0] as { topic: string }).topic === 'workflow-complete'
          );
          expect(completeEvent).toBeDefined();

          const evt = completeEvent![0] as { payload: Record<string, unknown> };
          expect(evt.payload['workflowId']).toBe(result.workflowId);
          expect(evt.payload['status']).toBe('success');
          expect(evt.payload['totalDurationMs']).toBeGreaterThanOrEqual(0);
          expect(evt.payload['stepTimings']).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves pipeline step execution order', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbWalletAddress,
        async (walletAddress) => {
          const requestCalls: RequestMessage[] = [];
          const bus: MessageBus & { requestCalls: RequestMessage[] } = {
            requestCalls,
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
            unsubscribe: vi.fn(),
            request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
              requestCalls.push(msg);
              const step = TOPIC_TO_STEP[msg.topic];
              const payload = buildStepResponse(step, {});
              return {
                id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
                targetAgentId: msg.sourceAgentId, type: 'response',
                correlationId: msg.correlationId, timestamp: Date.now(),
                topic: msg.topic, payload,
              } as ResponseMessage;
            }),
            setAgentStateProvider: vi.fn(),
            onAgentActivated: vi.fn().mockResolvedValue(undefined),
            getBufferedMessages: vi.fn().mockReturnValue([]),
          };

          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);
          await agent.requestScore(walletAddress);

          const calledSteps = requestCalls.map(c => TOPIC_TO_STEP[c.topic]);
          let lastIdx = -1;
          for (const step of PIPELINE_STEPS) {
            const idx = calledSteps.indexOf(step);
            expect(idx).toBeGreaterThan(lastIdx);
            lastIdx = idx;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 11: Concurrency and Backpressure
// **Validates: Requirements 3.6, 3.7**
// =============================================================================

describe('Property 11: Concurrency and Backpressure', { tags: ['Feature: adaptive-agents', 'Property 11: Concurrency and Backpressure'] }, () => {
  it('enforces maximum 10 concurrent workflows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 11, max: 20 }),
        async (numRequests) => {
          let concurrentCount = 0;
          let maxConcurrentObserved = 0;

          const bus: MessageBus & { requestCalls: RequestMessage[] } = {
            requestCalls: [],
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
            unsubscribe: vi.fn(),
            request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
              const step = TOPIC_TO_STEP[msg.topic];
              if (step === 'validate-session') {
                concurrentCount++;
                maxConcurrentObserved = Math.max(maxConcurrentObserved, concurrentCount);
                await new Promise(resolve => globalThis.setTimeout(resolve, 5));
                concurrentCount--;
              }
              const payload = buildStepResponse(step, {});
              return {
                id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
                targetAgentId: msg.sourceAgentId, type: 'response',
                correlationId: msg.correlationId, timestamp: Date.now(),
                topic: msg.topic, payload,
              } as ResponseMessage;
            }),
            setAgentStateProvider: vi.fn(),
            onAgentActivated: vi.fn().mockResolvedValue(undefined),
            getBufferedMessages: vi.fn().mockReturnValue([]),
          };

          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const wallets = Array.from(
            { length: numRequests }, (_, i) => `0x${i.toString(16).padStart(8, '0')}`
          );
          const results = await Promise.all(wallets.map(w => agent.requestScore(w)));

          for (const r of results) {
            expect(r.status).toBe('success');
          }
          expect(maxConcurrentObserved).toBeLessThanOrEqual(10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('queues excess requests in FIFO order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 12, max: 18 }),
        async (numRequests) => {
          const completionOrder: string[] = [];
          let resolveGate: (() => void) | null = null;
          const gatePromise = new Promise<void>(r => { resolveGate = r; });
          let gateOpened = false;

          const bus: MessageBus & { requestCalls: RequestMessage[] } = {
            requestCalls: [],
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
            unsubscribe: vi.fn(),
            request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
              const step = TOPIC_TO_STEP[msg.topic];
              if (step === 'validate-session' && !gateOpened) {
                await gatePromise;
              }
              if (step === 'mint-credential') {
                const addr = (msg.payload as Record<string, unknown>)['walletAddress'] as string;
                if (addr) completionOrder.push(addr);
              }
              const payload = buildStepResponse(step, {});
              return {
                id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
                targetAgentId: msg.sourceAgentId, type: 'response',
                correlationId: msg.correlationId, timestamp: Date.now(),
                topic: msg.topic, payload,
              } as ResponseMessage;
            }),
            setAgentStateProvider: vi.fn(),
            onAgentActivated: vi.fn().mockResolvedValue(undefined),
            getBufferedMessages: vi.fn().mockReturnValue([]),
          };

          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const wallets = Array.from(
            { length: numRequests }, (_, i) => `0xfifo${i.toString(16).padStart(4, '0')}`
          );
          const promises = wallets.map(w => agent.requestScore(w));
          await new Promise(r => globalThis.setTimeout(r, 20));

          gateOpened = true;
          resolveGate!();
          const results = await Promise.all(promises);

          for (const r of results) {
            expect(r.status).toBe('success');
          }

          if (numRequests > 10) {
            const queuedWallets = wallets.slice(10);
            const queuedCompletions = completionOrder.filter(w => queuedWallets.includes(w));
            for (let i = 1; i < queuedCompletions.length; i++) {
              const prevIdx = queuedWallets.indexOf(queuedCompletions[i - 1]!);
              const currIdx = queuedWallets.indexOf(queuedCompletions[i]!);
              expect(currIdx).toBeGreaterThan(prevIdx);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects new requests when queue exceeds 50 and resumes at 40', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 52, max: 62 }),
        async (numRequests) => {
          let resolveGate: (() => void) | null = null;
          const gatePromise = new Promise<void>(r => { resolveGate = r; });

          const bus: MessageBus & { requestCalls: RequestMessage[] } = {
            requestCalls: [],
            publish: vi.fn().mockResolvedValue(undefined),
            subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
            unsubscribe: vi.fn(),
            request: vi.fn().mockImplementation(async (msg: RequestMessage) => {
              const step = TOPIC_TO_STEP[msg.topic];
              if (step === 'validate-session') {
                await gatePromise;
              }
              const payload = buildStepResponse(step, {});
              return {
                id: uuidv4(), sourceAgentId: msg.targetAgentId ?? 'unknown',
                targetAgentId: msg.sourceAgentId, type: 'response',
                correlationId: msg.correlationId, timestamp: Date.now(),
                topic: msg.topic, payload,
              } as ResponseMessage;
            }),
            setAgentStateProvider: vi.fn(),
            onAgentActivated: vi.fn().mockResolvedValue(undefined),
            getBufferedMessages: vi.fn().mockReturnValue([]),
          };

          const agent = new OrchestratorAgentImpl(bus);
          await agent.initialize(defaultProfile);

          const wallets = Array.from(
            { length: numRequests }, (_, i) => `0xbp${i.toString(16).padStart(4, '0')}`
          );

          // Fire all requests (don't await yet)
          const promises = wallets.map(w => agent.requestScore(w));
          await new Promise(r => globalThis.setTimeout(r, 20));

          // Queue depth = numRequests - 10 (since 10 are active)
          const queueDepth = agent.getQueueDepth();

          // If queue > 50, new requests should be rejected
          if (queueDepth > 50) {
            const rejectResult = await agent.requestScore('0xrejected');
            expect(rejectResult.status).toBe('failed');
            expect(rejectResult.failureReason).toContain('busy');
          }

          // Release gate
          resolveGate!();
          await Promise.all(promises);

          // After draining, should accept again
          expect(agent.getQueueDepth()).toBe(0);
          const postResult = await agent.requestScore('0xafter');
          expect(postResult.status).toBe('success');
        },
      ),
      { numRuns: 100 },
    );
  });
});
