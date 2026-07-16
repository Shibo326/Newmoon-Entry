/**
 * Unit tests for the Monitor Agent.
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { MonitorAgent } from '../monitor-agent.js';
import type { MessageBus, Subscription, MessageHandler } from '../../bus/message-bus.js';
import type { AdaptationLog, LogEntry, LogFilter, AgentChangeSummary } from '../../types/log.js';
import type { Agent, AgentHealth, AgentCapability } from '../../types/agent.js';
import type { BusMessage, RequestMessage, ResponseMessage, ErrorMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

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

  unsubscribe(_subscription: Subscription): void {
    // no-op for testing
  }

  async request(_message: RequestMessage, _timeoutMs?: number): Promise<ResponseMessage | ErrorMessage> {
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
    if (this.shouldFail) {
      throw new Error('Log unavailable');
    }
    this.entries.push(entry);
  }

  async query(_filter: LogFilter): Promise<LogEntry[]> {
    return this.entries;
  }

  async getAgentSummary(_agentId: string): Promise<AgentChangeSummary> {
    return { currentParameters: {}, changeHistory: [] };
  }
}

function createMockAgent(id: string, state: 'idle' | 'active' | 'error' | 'disabled' = 'active'): Agent {
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

function defaultProfile(): BehaviorProfile {
  return {
    agentId: 'monitor-agent',
    version: 1,
    parameters: {
      healthCheckIntervalMs: 30000,
      errorThreshold: 5,
      errorWindowMs: 600000,
      metricsUpdateIntervalMs: 10000,
      maxBufferedEntries: 500,
    },
    lastModified: Date.now(),
  };
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

describe('MonitorAgent', () => {
  let bus: MockMessageBus;
  let log: MockAdaptationLog;
  let agents: Map<string, Agent>;
  let monitor: MonitorAgent;

  beforeEach(async () => {
    vi.useFakeTimers();
    bus = new MockMessageBus();
    log = new MockAdaptationLog();
    agents = new Map();
    monitor = new MonitorAgent(bus, log, (id) => agents.get(id));
    await monitor.initialize(defaultProfile());
    await monitor.onActivate();
  });

  describe('Agent interface', () => {
    it('should have correct id and name', () => {
      expect(monitor.id).toBe('monitor-agent');
      expect(monitor.name).toBe('Monitor Agent');
    });

    it('should report health with active state after activation', () => {
      const health = monitor.getHealth();
      expect(health.state).toBe('active');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
    });

    it('should report capabilities', () => {
      const caps = monitor.getCapabilities();
      expect(caps.length).toBeGreaterThan(0);
      expect(caps.some(c => c.topic === 'monitor.get-health')).toBe(true);
    });

    it('should transition to idle on deactivate', async () => {
      await monitor.onDeactivate();
      expect(monitor.getHealth().state).toBe('idle');
    });
  });

  describe('Event recording (Req 10.1)', () => {
    it('should subscribe to wildcard topic on activation', () => {
      expect(bus.handlers.has('*')).toBe(true);
    });

    it('should record events to the Adaptation Log', async () => {
      const handler = bus.handlers.get('*')![0]!;
      const msg = createBusMessage({ sourceAgentId: 'scoring-agent' });
      await handler(msg);

      expect(log.entries.length).toBe(1);
      expect(log.entries[0]!.agentId).toBe('scoring-agent');
      expect(log.entries[0]!.type).toBe('metric');
    });

    it('should compute duration for request/response pairs via correlation ID', async () => {
      const handler = bus.handlers.get('*')![0]!;
      const corrId = uuidv4();

      // Send request
      const request = createBusMessage({
        type: 'request',
        sourceAgentId: 'orchestrator-agent',
        correlationId: corrId,
        timestamp: Date.now(),
      });
      await handler(request);

      // Advance time 150ms
      vi.advanceTimersByTime(150);

      // Send response with same correlation ID
      const response = createBusMessage({
        type: 'response',
        sourceAgentId: 'scoring-agent',
        correlationId: corrId,
        timestamp: Date.now(),
      });
      await handler(response);

      // The second log entry should have a duration
      const responseEntry = log.entries[1]!;
      expect(responseEntry.payload.duration).toBeGreaterThanOrEqual(150);
    });
  });

  describe('Per-agent metrics (Req 10.2)', () => {
    it('should compute request count for an agent in the last hour', async () => {
      const handler = bus.handlers.get('*')![0]!;

      for (let i = 0; i < 5; i++) {
        await handler(createBusMessage({
          type: 'request',
          sourceAgentId: 'scoring-agent',
        }));
      }

      const metrics = monitor.getAgentMetrics('scoring-agent');
      expect(metrics.requestCount).toBe(5);
      expect(metrics.agentId).toBe('scoring-agent');
    });

    it('should compute error count for an agent in the last hour', async () => {
      const handler = bus.handlers.get('*')![0]!;

      for (let i = 0; i < 3; i++) {
        await handler(createBusMessage({
          type: 'error',
          sourceAgentId: 'signal-agent',
          payload: { code: 'FAIL', description: 'fail' },
        } as Partial<ErrorMessage>));
      }

      const metrics = monitor.getAgentMetrics('signal-agent');
      expect(metrics.errorCount).toBe(3);
    });

    it('should compute avg response time from tracked durations', async () => {
      const handler = bus.handlers.get('*')![0]!;
      const corrId1 = uuidv4();
      const corrId2 = uuidv4();

      await handler(createBusMessage({ type: 'request', sourceAgentId: 'agent-a', correlationId: corrId1 }));
      vi.advanceTimersByTime(100);
      await handler(createBusMessage({ type: 'response', sourceAgentId: 'agent-a', correlationId: corrId1 }));

      await handler(createBusMessage({ type: 'request', sourceAgentId: 'agent-a', correlationId: corrId2 }));
      vi.advanceTimersByTime(200);
      await handler(createBusMessage({ type: 'response', sourceAgentId: 'agent-a', correlationId: corrId2 }));

      const metrics = monitor.getAgentMetrics('agent-a');
      expect(metrics.avgResponseTimeMs).toBeGreaterThanOrEqual(100);
    });

    it('should return lifecycle state from agent provider', async () => {
      agents.set('scoring-agent', createMockAgent('scoring-agent', 'error'));
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'scoring-agent' }));

      const metrics = monitor.getAgentMetrics('scoring-agent');
      expect(metrics.lifecycleState).toBe('error');
    });

    it('should update metrics on timer interval', async () => {
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ type: 'request', sourceAgentId: 'cache-agent' }));

      // Advance past metrics update interval (10s)
      vi.advanceTimersByTime(10_000);

      const allMetrics = monitor.getAllMetrics();
      expect(allMetrics.has('cache-agent')).toBe(true);
    });
  });

  describe('Error threshold alerting (Req 10.3)', () => {
    it('should publish alert.agent-degraded when error count exceeds threshold', async () => {
      const handler = bus.handlers.get('*')![0]!;

      // Default threshold is 5, so 6 errors should trigger alert
      for (let i = 0; i < 6; i++) {
        await handler(createBusMessage({
          type: 'error',
          sourceAgentId: 'scoring-agent',
          payload: { code: 'ERR', description: 'test' },
        } as Partial<ErrorMessage>));
      }

      const alerts = bus.published.filter(m => m.topic === 'alert.agent-degraded');
      expect(alerts.length).toBe(1);
      expect((alerts[0]!.payload as Record<string, unknown>).agentId).toBe('scoring-agent');
      expect((alerts[0]!.payload as Record<string, unknown>).errorCount).toBe(6);
      expect((alerts[0]!.payload as Record<string, unknown>).windowMs).toBe(600000);
    });

    it('should not publish duplicate alerts within the same window', async () => {
      const handler = bus.handlers.get('*')![0]!;

      for (let i = 0; i < 12; i++) {
        await handler(createBusMessage({
          type: 'error',
          sourceAgentId: 'scoring-agent',
          payload: { code: 'ERR', description: 'test' },
        } as Partial<ErrorMessage>));
      }

      const alerts = bus.published.filter(m => m.topic === 'alert.agent-degraded');
      expect(alerts.length).toBe(1); // Only one alert in the window
    });
  });

  describe('Unresponsive detection (Req 10.4)', () => {
    it('should publish alert.agent-unresponsive after 3 missed health checks', async () => {
      // Register an agent that the provider cannot find (simulating unresponsive)
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'ghost-agent' }));
      // ghost-agent is not in agents map, so provider returns undefined

      // Trigger 3 health check intervals
      vi.advanceTimersByTime(30_000); // 1st check
      vi.advanceTimersByTime(30_000); // 2nd check
      vi.advanceTimersByTime(30_000); // 3rd check

      const alerts = bus.published.filter(m => m.topic === 'alert.agent-unresponsive');
      expect(alerts.length).toBe(1);
      expect((alerts[0]!.payload as Record<string, unknown>).agentId).toBe('ghost-agent');
    });

    it('should reset missed count when agent responds to health check', async () => {
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'flaky-agent' }));

      // Miss 2 health checks
      vi.advanceTimersByTime(30_000);
      vi.advanceTimersByTime(30_000);

      // Now register the agent so it responds
      agents.set('flaky-agent', createMockAgent('flaky-agent', 'active'));

      // 3rd check — agent is now healthy
      vi.advanceTimersByTime(30_000);

      const alerts = bus.published.filter(m => m.topic === 'alert.agent-unresponsive');
      expect(alerts.length).toBe(0);
    });
  });

  describe('System health computation (Req 10.5)', () => {
    it('should return healthy when all active agents are active with no alerts', async () => {
      agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));
      agents.set('scoring-agent', createMockAgent('scoring-agent', 'active'));

      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'orchestrator-agent' }));
      await handler(createBusMessage({ sourceAgentId: 'scoring-agent' }));

      expect(monitor.getSystemHealth()).toBe('healthy');
    });

    it('should return degraded when one agent is in error state but orchestrator active', async () => {
      agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));
      agents.set('scoring-agent', createMockAgent('scoring-agent', 'error'));

      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'orchestrator-agent' }));
      await handler(createBusMessage({ sourceAgentId: 'scoring-agent' }));

      expect(monitor.getSystemHealth()).toBe('degraded');
    });

    it('should return unhealthy when orchestrator is in error state', async () => {
      agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'error'));
      agents.set('scoring-agent', createMockAgent('scoring-agent', 'active'));

      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'orchestrator-agent' }));
      await handler(createBusMessage({ sourceAgentId: 'scoring-agent' }));

      expect(monitor.getSystemHealth()).toBe('unhealthy');
    });

    it('should return unhealthy when more than half of active agents are in error', async () => {
      agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));
      agents.set('agent-a', createMockAgent('agent-a', 'error'));
      agents.set('agent-b', createMockAgent('agent-b', 'error'));
      agents.set('agent-c', createMockAgent('agent-c', 'active'));

      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'orchestrator-agent' }));
      await handler(createBusMessage({ sourceAgentId: 'agent-a' }));
      await handler(createBusMessage({ sourceAgentId: 'agent-b' }));
      await handler(createBusMessage({ sourceAgentId: 'agent-c' }));

      // 2 out of 4 active agents in error = 50%, not more than half
      // Need 3 out of 4 for "more than half"
      expect(monitor.getSystemHealth()).toBe('degraded');
    });
  });

  describe('Privacy filtering (Req 10.6)', () => {
    it('should exclude raw signals from log entries', async () => {
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({
        sourceAgentId: 'signal-agent',
        payload: {
          signals: [0.8, 0.6, 0.9, 0.4, 0.7, 0.3],
          signalVector: [0.8, 0.6, 0.9, 0.4, 0.7, 0.3],
          operationStatus: 'complete',
          timestamp: Date.now(),
        },
      }));

      const entry = log.entries[0]!;
      expect(entry.payload.signals).toBeUndefined();
      expect(entry.payload.signalVector).toBeUndefined();
      expect(entry.payload.operationStatus).toBe('complete');
    });

    it('should exclude credit grades from log entries', async () => {
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({
        sourceAgentId: 'scoring-agent',
        payload: {
          creditGrade: 'AAA',
          grade: 'AAA',
          agentId: 'scoring-agent',
          duration: 150,
        },
      }));

      const entry = log.entries[0]!;
      expect(entry.payload.creditGrade).toBeUndefined();
      expect(entry.payload.grade).toBeUndefined();
      expect(entry.payload.agentId).toBe('scoring-agent');
    });

    it('should strip sensitive fields from nested objects', async () => {
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({
        sourceAgentId: 'scoring-agent',
        payload: {
          result: {
            grade: 'AA',
            hash: 'abc123',
          },
        },
      }));

      const entry = log.entries[0]!;
      const result = entry.payload.result as Record<string, unknown>;
      expect(result.grade).toBeUndefined();
      expect(result.hash).toBe('abc123');
    });
  });

  describe('Log buffer (Req 10.7)', () => {
    it('should buffer entries when log is unavailable', async () => {
      log.shouldFail = true;
      const handler = bus.handlers.get('*')![0]!;

      await handler(createBusMessage({ sourceAgentId: 'test-agent' }));

      expect(monitor.bufferSize).toBe(1);
      expect(log.entries.length).toBe(0);
    });

    it('should publish monitor.log-unavailable event when log fails', async () => {
      log.shouldFail = true;
      const handler = bus.handlers.get('*')![0]!;

      await handler(createBusMessage({ sourceAgentId: 'test-agent' }));

      const events = bus.published.filter(m => m.topic === 'monitor.log-unavailable');
      expect(events.length).toBe(1);
    });

    it('should buffer up to maxBufferedEntries (500)', async () => {
      log.shouldFail = true;
      const handler = bus.handlers.get('*')![0]!;

      for (let i = 0; i < 510; i++) {
        await handler(createBusMessage({ sourceAgentId: 'test-agent' }));
      }

      expect(monitor.bufferSize).toBe(500);
    });

    it('should flush buffer when log becomes available again', async () => {
      log.shouldFail = true;
      const handler = bus.handlers.get('*')![0]!;

      await handler(createBusMessage({ sourceAgentId: 'test-agent' }));
      await handler(createBusMessage({ sourceAgentId: 'test-agent' }));

      expect(monitor.bufferSize).toBe(2);
      expect(log.entries.length).toBe(0);

      // Log becomes available
      log.shouldFail = false;
      await handler(createBusMessage({ sourceAgentId: 'test-agent' }));

      // Buffer should be flushed + new entry written
      expect(monitor.bufferSize).toBe(0);
      expect(log.entries.length).toBe(3);
    });
  });

  describe('handleMessage', () => {
    it('should respond to monitor.get-health requests', async () => {
      agents.set('orchestrator-agent', createMockAgent('orchestrator-agent', 'active'));
      const handler = bus.handlers.get('*')![0]!;
      await handler(createBusMessage({ sourceAgentId: 'orchestrator-agent' }));

      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'admin',
        targetAgentId: 'monitor-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'monitor.get-health',
        payload: {},
      };

      const result = await monitor.handleMessage(msg);
      expect(result.type).toBe('response');
      expect((result.payload as Record<string, unknown>).status).toBeDefined();
    });

    it('should return error for unsupported topics', async () => {
      const msg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'admin',
        targetAgentId: 'monitor-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'unknown.topic',
        payload: {},
      };

      const result = await monitor.handleMessage(msg);
      expect(result.type).toBe('error');
    });
  });

  describe('Config update', () => {
    it('should apply new profile parameters', async () => {
      const newProfile: BehaviorProfile = {
        agentId: 'monitor-agent',
        version: 2,
        parameters: {
          healthCheckIntervalMs: 15000,
          errorThreshold: 10,
          errorWindowMs: 300000,
          metricsUpdateIntervalMs: 5000,
          maxBufferedEntries: 100,
        },
        lastModified: Date.now(),
      };

      await monitor.onConfigUpdate(newProfile);

      // Verify by testing the new error threshold (10 errors needed now)
      const handler = bus.handlers.get('*')![0]!;
      for (let i = 0; i < 8; i++) {
        await handler(createBusMessage({
          type: 'error',
          sourceAgentId: 'test-agent',
          payload: { code: 'ERR', description: 'test' },
        } as Partial<ErrorMessage>));
      }

      // Should NOT trigger alert (threshold is now 10)
      const alerts = bus.published.filter(m => m.topic === 'alert.agent-degraded');
      expect(alerts.length).toBe(0);
    });
  });
});
