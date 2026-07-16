/**
 * Property-Based Tests: Monitor Agent (Properties 23, 24, 27)
 *
 * Property 23: System Health Status Determination
 * Property 24: Error Threshold Alerting
 * Property 27: Config Regression Detection
 *
 * **Validates: Requirements 10.3, 10.5, 11.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { MonitorAgent } from '../monitor-agent.js';
import { ConfigRegressionDetector } from '../config-regression-detector.js';
import type { MessageBus, Subscription, MessageHandler } from '../../bus/message-bus.js';
import type { AdaptationLog, LogEntry, LogFilter, AgentChangeSummary } from '../../types/log.js';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../../types/agent.js';
import type { BusMessage, RequestMessage, ResponseMessage, ErrorMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { AgentMetricsSnapshot } from '../../types/monitor.js';

// --- Mock Implementations ---

class MockMessageBus implements MessageBus {
  published: BusMessage[] = [];
  handlers: Map<string, MessageHandler[]> = new Map();
  subCounter = 0;

  async publish(message: BusMessage): Promise<void> {
    this.published.push(message);
  }

  subscribe(topic: string, handler: MessageHandler, _agentId?: string): Subscription {
    const existing = this.handlers.get(topic) ?? [];
    existing.push(handler);
    this.handlers.set(topic, existing);
    this.subCounter++;
    return { id: `sub-${this.subCounter}`, topic, agentId: _agentId ?? '' };
  }

  unsubscribe(_subscription: Subscription): void {}
  async request(_msg: RequestMessage, _t?: number): Promise<ResponseMessage | ErrorMessage> {
    throw new Error('Not implemented');
  }
  setAgentStateProvider(): void {}
  async onAgentActivated(): Promise<void> {}
  getBufferedMessages(): { message: BusMessage; bufferedAt: number }[] { return []; }
}

class MockAdaptationLog implements AdaptationLog {
  entries: LogEntry[] = [];
  shouldFail = false;

  async write(entry: LogEntry): Promise<void> {
    if (this.shouldFail) throw new Error('Log unavailable');
    this.entries.push(entry);
  }
  async query(_filter: LogFilter): Promise<LogEntry[]> { return this.entries; }
  async getAgentSummary(_agentId: string): Promise<AgentChangeSummary> {
    return { currentParameters: {}, changeHistory: [] };
  }
}

function createMockAgent(
  id: string,
  state: AgentLifecycleState = 'active'
): Agent {
  return {
    id,
    name: `Agent ${id}`,
    async handleMessage(msg: BusMessage): Promise<ResponseMessage | ErrorMessage> {
      return {
        id: uuidv4(), sourceAgentId: id, targetAgentId: msg.sourceAgentId,
        type: 'response', correlationId: msg.correlationId,
        timestamp: Date.now(), topic: msg.topic, payload: {},
      };
    },
    getHealth(): AgentHealth {
      return { state, uptimeSeconds: 100, requestCount: 0, errorCount: 0, avgResponseTimeMs: 0 };
    },
    getCapabilities(): AgentCapability[] { return []; },
    async initialize(_profile: BehaviorProfile): Promise<void> {},
    async onActivate(): Promise<void> {},
    async onDeactivate(): Promise<void> {},
    async onConfigUpdate(_profile: BehaviorProfile): Promise<void> {},
  };
}

function defaultProfile(overrides: Record<string, unknown> = {}): BehaviorProfile {
  return {
    agentId: 'monitor-agent',
    version: 1,
    parameters: {
      healthCheckIntervalMs: 30000,
      errorThreshold: 5,
      errorWindowMs: 600000,
      metricsUpdateIntervalMs: 10000,
      maxBufferedEntries: 500,
      ...overrides,
    },
    lastModified: Date.now(),
  };
}

function createErrorMessage(sourceAgentId: string): BusMessage {
  return {
    id: uuidv4(),
    sourceAgentId,
    targetAgentId: null,
    type: 'error',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'agent.error',
    payload: { code: 'ERR', description: 'test error' },
  } as unknown as BusMessage;
}

function createBusMessage(overrides: Partial<BusMessage> = {}): BusMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'test-agent',
    targetAgentId: null,
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'test.topic',
    payload: {},
    ...overrides,
  } as BusMessage;
}

// --- Generators ---

/** Valid agent lifecycle states */
const lifecycleStateArb = fc.constantFrom<AgentLifecycleState>(
  'idle', 'active', 'error', 'disabled'
);

/** Non-disabled states (agents that count for health assessment) */
const activeStateArb = fc.constantFrom<AgentLifecycleState>(
  'idle', 'active', 'error'
);

/** Generate a random agent ID (short alphanumeric + "-agent" suffix) */
const agentIdArb = fc.stringMatching(/^[a-z]{3,8}-agent$/).filter(s => s.length >= 9);

/** Generate an error threshold between 1 and 20 */
const errorThresholdArb = fc.integer({ min: 1, max: 20 });

/** Generate an error window in ms (1 min to 30 min) */
const errorWindowArb = fc.integer({ min: 60000, max: 1800000 });

/** Generate a count of errors to send (0 to 30) */
const errorCountArb = fc.integer({ min: 0, max: 30 });

/** Generate a number of non-orchestrator agents (1–8) */
const agentCountArb = fc.integer({ min: 1, max: 8 });

// --- Property 23: System Health Status Determination ---

describe('Property 23: System Health Status Determination', () => {
  let bus: MockMessageBus;
  let log: MockAdaptationLog;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MockMessageBus();
    log = new MockAdaptationLog();
  });

  it('SHALL return "unhealthy" when Orchestrator is in error state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(activeStateArb, { minLength: 1, maxLength: 8 }),
        async (otherStates) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();

          // Orchestrator in error
          agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'error'));

          // Other agents with random states
          for (let i = 0; i < otherStates.length; i++) {
            const id = `agent-${i}`;
            agents.set(id, createMockAgent(id, otherStates[i]!));
          }

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile());
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          for (const agentId of agents.keys()) {
            await handler(createBusMessage({ sourceAgentId: agentId }));
          }

          expect(monitor.getSystemHealth()).toBe('unhealthy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return "unhealthy" when more than half of active agents are in error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (totalAgents) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();

          // Orchestrator stays active so we test the >50% rule
          agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));

          // The health check counts ALL non-disabled agents including orchestrator.
          // Total active count = 1 (orch) + totalAgents
          // We need errorCount > (1 + totalAgents) / 2
          // So errorCount must be strictly more than half of (totalAgents + 1)
          const totalActive = totalAgents + 1; // including orchestrator
          const errorCount = Math.floor(totalActive / 2) + 1;
          // Ensure we don't exceed totalAgents for error slots
          const actualErrors = Math.min(errorCount, totalAgents);

          for (let i = 0; i < totalAgents; i++) {
            const id = `agent-${i}`;
            const state: AgentLifecycleState = i < actualErrors ? 'error' : 'active';
            agents.set(id, createMockAgent(id, state));
          }

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile());
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          for (const agentId of agents.keys()) {
            await handler(createBusMessage({ sourceAgentId: agentId }));
          }

          expect(monitor.getSystemHealth()).toBe('unhealthy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return "degraded" when at least one agent is in error but Orchestrator is active and <=50% in error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 8 }),
        async (totalAgents) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();

          // Orchestrator active
          agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));

          // Exactly 1 in error, rest active — always <=50% for totalAgents >= 3
          for (let i = 0; i < totalAgents; i++) {
            const id = `agent-${i}`;
            const state: AgentLifecycleState = i === 0 ? 'error' : 'active';
            agents.set(id, createMockAgent(id, state));
          }

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile());
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          for (const agentId of agents.keys()) {
            await handler(createBusMessage({ sourceAgentId: agentId }));
          }

          expect(monitor.getSystemHealth()).toBe('degraded');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return "healthy" when all active agents are in active state with no alerts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        async (totalAgents) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();

          agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));

          for (let i = 0; i < totalAgents; i++) {
            const id = `agent-${i}`;
            agents.set(id, createMockAgent(id, 'active'));
          }

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile());
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          for (const agentId of agents.keys()) {
            await handler(createBusMessage({ sourceAgentId: agentId }));
          }

          expect(monitor.getSystemHealth()).toBe('healthy');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return "degraded" when a degraded alert exists but Orchestrator is active', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        async (totalAgents) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();

          agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));

          const targetId = 'degraded-target';
          agents.set(targetId, createMockAgent(targetId, 'active'));
          for (let i = 1; i < totalAgents; i++) {
            const id = `other-${i}`;
            agents.set(id, createMockAgent(id, 'active'));
          }

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile({ errorThreshold: 2 }));
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          for (const agentId of agents.keys()) {
            await handler(createBusMessage({ sourceAgentId: agentId }));
          }

          // Trigger degraded alert by exceeding threshold (3 > 2)
          for (let i = 0; i < 3; i++) {
            await handler(createErrorMessage(targetId));
          }

          expect(monitor.getSystemHealth()).toBe('degraded');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 24: Error Threshold Alerting ---

describe('Property 24: Error Threshold Alerting', () => {
  let bus: MockMessageBus;
  let log: MockAdaptationLog;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MockMessageBus();
    log = new MockAdaptationLog();
  });

  it('SHALL publish exactly one "alert.agent-degraded" when error count exceeds threshold within window', async () => {
    await fc.assert(
      fc.asyncProperty(
        errorThresholdArb,
        fc.integer({ min: 1, max: 10 }),
        async (threshold, extra) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'error-prone-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile({ errorThreshold: threshold }));
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          await handler(createBusMessage({ sourceAgentId: targetId }));

          // Send threshold + extra errors (exceeds threshold)
          const errCount = threshold + extra;
          for (let i = 0; i < errCount; i++) {
            await handler(createErrorMessage(targetId));
          }

          const alerts = bus.published.filter(
            m => m.topic === 'alert.agent-degraded' &&
              (m.payload as Record<string, unknown>).agentId === targetId
          );

          // Exactly one alert (deduplication within window)
          expect(alerts.length).toBe(1);

          // Alert payload contains required fields
          const payload = alerts[0]!.payload as Record<string, unknown>;
          expect(payload.agentId).toBe(targetId);
          expect(payload.errorCount).toBeGreaterThan(threshold);
          expect(payload.windowMs).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL NOT publish alert when error count does not exceed threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        errorThresholdArb,
        async (threshold) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'below-threshold-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile({ errorThreshold: threshold }));
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          await handler(createBusMessage({ sourceAgentId: targetId }));

          // Send exactly threshold errors (not exceeding)
          for (let i = 0; i < threshold; i++) {
            await handler(createErrorMessage(targetId));
          }

          const alerts = bus.published.filter(
            m => m.topic === 'alert.agent-degraded' &&
              (m.payload as Record<string, unknown>).agentId === targetId
          );

          expect(alerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL not re-alert for the same agent within the same time window', async () => {
    await fc.assert(
      fc.asyncProperty(
        errorThresholdArb,
        fc.integer({ min: 2, max: 5 }),
        async (threshold, waves) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'repeat-error-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
          await monitor.initialize(defaultProfile({ errorThreshold: threshold }));
          await monitor.onActivate();

          const handler = bus.handlers.get('*')![0]!;
          await handler(createBusMessage({ sourceAgentId: targetId }));

          // Send multiple waves of errors exceeding threshold
          for (let w = 0; w < waves; w++) {
            for (let i = 0; i < threshold + 1; i++) {
              await handler(createErrorMessage(targetId));
            }
          }

          const alerts = bus.published.filter(
            m => m.topic === 'alert.agent-degraded' &&
              (m.payload as Record<string, unknown>).agentId === targetId
          );

          // Still only one alert within the same window
          expect(alerts.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 27: Config Regression Detection ---

describe('Property 27: Config Regression Detection', () => {
  let bus: MockMessageBus;
  let log: MockAdaptationLog;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MockMessageBus();
    log = new MockAdaptationLog();
  });

  it('SHALL publish "alert.config-regression" when error rate exceeds threshold within 5 min of config change', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 6, max: 30 }),
        fc.integer({ min: 1, max: 5 }),
        async (errorRate, previousVersion) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'regression-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const metricsProvider = (agentId: string): AgentMetricsSnapshot => ({
            agentId,
            requestCount: 100,
            avgResponseTimeMs: 50,
            errorCount: errorRate,
            lifecycleState: 'active',
            lastUpdated: Date.now(),
          });

          const detector = new ConfigRegressionDetector({
            bus,
            log,
            agentProvider: (id) => agents.get(id),
            getAgentMetrics: metricsProvider,
          });

          await detector.onConfigChange(targetId, {
            previousVersion,
            param: 'timeout',
            oldValue: 5000,
            newValue: 1000,
          });

          // Tick within 5 minutes to trigger regression check
          await detector.tick();

          const alerts = bus.published.filter(
            m => m.topic === 'alert.config-regression'
          );

          // errorRate > 5 (DEFAULT_ERROR_THRESHOLD) → alert published
          expect(alerts.length).toBe(1);
          const payload = alerts[0]!.payload as Record<string, unknown>;
          expect(payload.agentId).toBe(targetId);
          expect(payload.changeDetails).toBeDefined();
          expect(payload.observedErrorRate).toBe(errorRate);
          expect(payload.rollbackRecommendation).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL NOT publish regression alert when error rate is at or below threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (errorRate) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'stable-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const metricsProvider = (agentId: string): AgentMetricsSnapshot => ({
            agentId,
            requestCount: 100,
            avgResponseTimeMs: 50,
            errorCount: errorRate,
            lifecycleState: 'active',
            lastUpdated: Date.now(),
          });

          const detector = new ConfigRegressionDetector({
            bus,
            log,
            agentProvider: (id) => agents.get(id),
            getAgentMetrics: metricsProvider,
          });

          await detector.onConfigChange(targetId, {
            previousVersion: 1,
            param: 'retries',
            oldValue: 3,
            newValue: 5,
          });

          await detector.tick();

          const alerts = bus.published.filter(
            m => m.topic === 'alert.config-regression'
          );

          // errorRate <= 5 → no regression alert
          expect(alerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL NOT publish regression alert after the 5-minute detection window expires', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 6, max: 20 }),
        async (errorRate) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'late-error-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const metricsProvider = (agentId: string): AgentMetricsSnapshot => ({
            agentId,
            requestCount: 100,
            avgResponseTimeMs: 50,
            errorCount: errorRate,
            lifecycleState: 'active',
            lastUpdated: Date.now(),
          });

          // Set system time to a known base point
          const baseTime = Date.now();
          vi.setSystemTime(baseTime - 400_000);

          const detector = new ConfigRegressionDetector({
            bus,
            log,
            agentProvider: (id) => agents.get(id),
            getAgentMetrics: metricsProvider,
          });

          // Config change happened 400s (>5min) ago
          await detector.onConfigChange(targetId, {
            previousVersion: 1,
            param: 'timeout',
            oldValue: 5000,
            newValue: 2000,
          });

          // Stop timer to prevent async callback issues
          detector.stop();

          // Restore to "now" — elapsed > 300,000ms
          vi.setSystemTime(baseTime);

          await detector.tick();

          const alerts = bus.published.filter(
            m => m.topic === 'alert.config-regression'
          );

          // Past the 5-min window → no alert
          expect(alerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL include rollback recommendation referencing the previous version', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 6, max: 25 }),
        fc.integer({ min: 1, max: 100 }),
        async (errorRate, previousVersion) => {
          bus = new MockMessageBus();
          log = new MockAdaptationLog();
          const agents = new Map<string, Agent>();
          const targetId = 'rollback-agent';
          agents.set(targetId, createMockAgent(targetId, 'active'));

          const metricsProvider = (agentId: string): AgentMetricsSnapshot => ({
            agentId,
            requestCount: 100,
            avgResponseTimeMs: 50,
            errorCount: errorRate,
            lifecycleState: 'active',
            lastUpdated: Date.now(),
          });

          const detector = new ConfigRegressionDetector({
            bus,
            log,
            agentProvider: (id) => agents.get(id),
            getAgentMetrics: metricsProvider,
          });

          await detector.onConfigChange(targetId, {
            previousVersion,
            param: 'poolSize',
            oldValue: 5,
            newValue: 20,
          });

          await detector.tick();

          const alerts = bus.published.filter(
            m => m.topic === 'alert.config-regression'
          );

          expect(alerts.length).toBe(1);
          const payload = alerts[0]!.payload as Record<string, unknown>;
          const recommendation = payload.rollbackRecommendation as Record<string, unknown>;
          expect(recommendation.version).toBe(previousVersion);
        }
      ),
      { numRuns: 100 }
    );
  });
});
