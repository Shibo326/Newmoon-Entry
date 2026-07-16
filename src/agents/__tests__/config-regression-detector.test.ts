/**
 * Unit tests for the Config Regression Detector.
 * Validates: Requirements 11.6, 12.2, 12.3, 12.7, 12.8
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConfigRegressionDetector } from '../config-regression-detector.js';
import type { ConfigRegressionDetectorDeps, MetricsBaseline } from '../config-regression-detector.js';
import type { MessageBus, Subscription, MessageHandler } from '../../bus/message-bus.js';
import type { AdaptationLog, LogEntry, LogFilter, AgentChangeSummary } from '../../types/log.js';
import type { Agent, AgentHealth, AgentCapability } from '../../types/agent.js';
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
    async handleMessage(_msg: BusMessage): Promise<ResponseMessage | ErrorMessage> {
      throw new Error('Not implemented');
    },
    getHealth(): AgentHealth {
      return { state, uptimeSeconds: 100, requestCount: 10, errorCount: 2, avgResponseTimeMs: 50 };
    },
    getCapabilities(): AgentCapability[] {
      return [];
    },
    async initialize(_profile: BehaviorProfile): Promise<void> {},
    async onActivate(): Promise<void> {},
    async onDeactivate(): Promise<void> {},
    async onConfigUpdate(_profile: BehaviorProfile): Promise<void> {},
  };
}

// --- Test Setup ---

describe('ConfigRegressionDetector', () => {
  let mockBus: MockMessageBus;
  let mockLog: MockAdaptationLog;
  let mockAgents: Map<string, Agent>;
  let metricsSnapshots: Map<string, AgentMetricsSnapshot>;
  let detector: ConfigRegressionDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    mockBus = new MockMessageBus();
    mockLog = new MockAdaptationLog();
    mockAgents = new Map();
    metricsSnapshots = new Map();

    // Default metrics for test agent
    metricsSnapshots.set('scoring-agent', {
      agentId: 'scoring-agent',
      requestCount: 100,
      avgResponseTimeMs: 50,
      errorCount: 2,
      lifecycleState: 'active',
      lastUpdated: Date.now(),
    });

    const deps: ConfigRegressionDetectorDeps = {
      bus: mockBus,
      log: mockLog,
      agentProvider: (agentId: string) => mockAgents.get(agentId),
      getAgentMetrics: (agentId: string) => {
        const snapshot = metricsSnapshots.get(agentId);
        if (!snapshot) {
          throw new Error(`No metrics for agent ${agentId}`);
        }
        return snapshot;
      },
    };

    detector = new ConfigRegressionDetector(deps);
    mockAgents.set('scoring-agent', createMockAgent('scoring-agent'));
  });

  afterEach(() => {
    detector.stop();
    vi.useRealTimers();
  });

  // --- Requirement 12.2: Baseline recording ---

  describe('Baseline metrics snapshot recording', () => {
    it('should record baseline metrics snapshot within 5 seconds before profile change', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      const window = detector.getActiveWindow('scoring-agent');
      expect(window).toBeDefined();
      expect(window!.baseline.agentId).toBe('scoring-agent');
      expect(window!.baseline.responseTimeMs).toBe(50);
      expect(window!.baseline.errorRate).toBe(2);
      expect(window!.baseline.throughput).toBe(100);
      expect(window!.baseline.status).toBe('complete');
    });

    it('should write baseline to adaptation log', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1 });

      const baselineEntries = mockLog.entries.filter(
        (e) => e.payload.snapshotType === 'baseline'
      );
      expect(baselineEntries).toHaveLength(1);
      expect(baselineEntries[0]!.type).toBe('metric');
      expect(baselineEntries[0]!.agentId).toBe('scoring-agent');
      expect(baselineEntries[0]!.payload.responseTimeMs).toBe(50);
      expect(baselineEntries[0]!.payload.errorRate).toBe(2);
      expect(baselineEntries[0]!.payload.throughput).toBe(100);
      expect(baselineEntries[0]!.status).toBe('complete');
    });

    it('should store baseline with correlation ID linking to change', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1 });

      const window = detector.getActiveWindow('scoring-agent');
      expect(window).toBeDefined();

      const baseline = detector.getBaseline(window!.changeCorrelationId);
      expect(baseline).toBeDefined();
      expect(baseline!.changeCorrelationId).toBe(window!.changeCorrelationId);
    });
  });

  // --- Requirement 12.2: Comparison snapshot recording ---

  describe('Comparison snapshot recording (1 hour after change)', () => {
    it('should record comparison snapshot 1 hour after change', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1 });

      const window = detector.getActiveWindow('scoring-agent');
      expect(window).toBeDefined();

      // Update metrics to simulate different values after 1 hour
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 200,
        avgResponseTimeMs: 40,
        errorCount: 1,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      // Advance time by 1 hour
      vi.advanceTimersByTime(3_600_000);

      // Allow async callback to complete
      await vi.runAllTimersAsync();

      const comparison = detector.getComparison(window!.changeCorrelationId);
      expect(comparison).toBeDefined();
      expect(comparison!.responseTimeMs).toBe(40);
      expect(comparison!.errorRate).toBe(1);
      expect(comparison!.throughput).toBe(200);
      expect(comparison!.status).toBe('complete');
    });

    it('should write comparison snapshot to adaptation log', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1 });

      vi.advanceTimersByTime(3_600_000);
      await vi.runAllTimersAsync();

      const comparisonEntries = mockLog.entries.filter(
        (e) => e.payload.snapshotType === 'comparison'
      );
      expect(comparisonEntries).toHaveLength(1);
      expect(comparisonEntries[0]!.type).toBe('metric');
      expect(comparisonEntries[0]!.agentId).toBe('scoring-agent');
      expect(comparisonEntries[0]!.status).toBe('complete');
    });
  });

  // --- Requirement 12.3: Nested changes ---

  describe('Nested changes handling', () => {
    it('should close prior window when a new change arrives for the same agent', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      const firstWindow = detector.getActiveWindow('scoring-agent');
      const firstCorrelationId = firstWindow!.changeCorrelationId;

      // Second change within 1 hour
      vi.advanceTimersByTime(120_000); // 2 minutes
      await detector.onConfigChange('scoring-agent', { previousVersion: 2, newVersion: 3 });

      // First window should have a comparison recorded
      const firstComparison = detector.getComparison(firstCorrelationId);
      expect(firstComparison).toBeDefined();

      // New window should be active
      const newWindow = detector.getActiveWindow('scoring-agent');
      expect(newWindow).toBeDefined();
      expect(newWindow!.changeCorrelationId).not.toBe(firstCorrelationId);
    });

    it('should mark comparison as incomplete when less than 5 min elapsed', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      const firstWindow = detector.getActiveWindow('scoring-agent');
      const firstCorrelationId = firstWindow!.changeCorrelationId;

      // Second change after only 2 minutes (< 5 min)
      vi.advanceTimersByTime(120_000);
      await detector.onConfigChange('scoring-agent', { previousVersion: 2, newVersion: 3 });

      const firstComparison = detector.getComparison(firstCorrelationId);
      expect(firstComparison).toBeDefined();
      expect(firstComparison!.status).toBe('incomplete');
    });

    it('should mark comparison as complete when more than 5 min elapsed', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      const firstWindow = detector.getActiveWindow('scoring-agent');
      const firstCorrelationId = firstWindow!.changeCorrelationId;

      // Second change after 10 minutes (> 5 min)
      vi.advanceTimersByTime(600_000);
      await detector.onConfigChange('scoring-agent', { previousVersion: 2, newVersion: 3 });

      const firstComparison = detector.getComparison(firstCorrelationId);
      expect(firstComparison).toBeDefined();
      expect(firstComparison!.status).toBe('complete');
    });

    it('should start new baseline for the new change', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });
      vi.advanceTimersByTime(120_000);
      await detector.onConfigChange('scoring-agent', { previousVersion: 2, newVersion: 3 });

      const newWindow = detector.getActiveWindow('scoring-agent');
      expect(newWindow).toBeDefined();
      expect(newWindow!.baseline.agentId).toBe('scoring-agent');
      expect(newWindow!.baseline.status).toBe('complete');
    });
  });

  // --- Requirement 11.6: Regression detection ---

  describe('Regression detection (alert.config-regression)', () => {
    it('should publish alert.config-regression when error rate exceeds threshold within 5 min', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      // Simulate high error rate
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 10, // exceeds default threshold of 5
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      // Tick within 5 minutes
      vi.advanceTimersByTime(30_000);
      await detector.tick();

      const alerts = mockBus.published.filter((m) => m.topic === 'alert.config-regression');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.payload.agentId).toBe('scoring-agent');
      expect(alerts[0]!.payload.observedErrorRate).toBe(10);
      expect(alerts[0]!.payload.previousErrorRate).toBe(2);
      expect((alerts[0]!.payload.rollbackRecommendation as Record<string, unknown>).version).toBe(1);
    });

    it('should not publish regression alert when error rate is below threshold', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      // Error rate stays low
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 3, // below threshold of 5
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      vi.advanceTimersByTime(30_000);
      await detector.tick();

      const alerts = mockBus.published.filter((m) => m.topic === 'alert.config-regression');
      expect(alerts).toHaveLength(0);
    });

    it('should not publish regression alert after 5 minutes have passed', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      // Advance past the 5-minute window
      vi.advanceTimersByTime(301_000);

      // Now set high error rate
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 10,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.tick();

      const alerts = mockBus.published.filter((m) => m.topic === 'alert.config-regression');
      expect(alerts).toHaveLength(0);
    });

    it('should only publish one regression alert per window', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 10,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      vi.advanceTimersByTime(10_000);
      await detector.tick();
      vi.advanceTimersByTime(10_000);
      await detector.tick();

      const alerts = mockBus.published.filter((m) => m.topic === 'alert.config-regression');
      expect(alerts).toHaveLength(1);
    });
  });

  // --- Requirement 12.7: Improvement detection ---

  describe('Improvement detection (learning.improvement-detected)', () => {
    it('should publish learning.improvement-detected when error rate decreases 20%+ over 24h', async () => {
      // Baseline: errorRate = 10
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 10,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      // After 24 hours, error rate drops significantly (to 5 — a 50% decrease)
      vi.advanceTimersByTime(86_400_001);
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 200,
        avgResponseTimeMs: 40,
        errorCount: 5,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.tick();

      const improvements = mockBus.published.filter(
        (m) => m.topic === 'learning.improvement-detected'
      );
      expect(improvements).toHaveLength(1);
      expect(improvements[0]!.payload.agentId).toBe('scoring-agent');
      expect(improvements[0]!.payload.previousErrorRate).toBe(10);
      expect(improvements[0]!.payload.newErrorRate).toBe(5);
      expect(improvements[0]!.payload.improvement).toBe(50);
    });

    it('should not publish improvement when decrease is less than 20%', async () => {
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 10,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      // After 24 hours, error rate only drops 10% (to 9)
      vi.advanceTimersByTime(86_400_001);
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 200,
        avgResponseTimeMs: 40,
        errorCount: 9,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.tick();

      const improvements = mockBus.published.filter(
        (m) => m.topic === 'learning.improvement-detected'
      );
      expect(improvements).toHaveLength(0);
    });

    it('should not publish improvement before 24 hours', async () => {
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 10,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      // Only 12 hours elapsed
      vi.advanceTimersByTime(43_200_000);
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 200,
        avgResponseTimeMs: 40,
        errorCount: 2,
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.tick();

      const improvements = mockBus.published.filter(
        (m) => m.topic === 'learning.improvement-detected'
      );
      expect(improvements).toHaveLength(0);
    });

    it('should skip improvement detection when baseline error rate is 0', async () => {
      metricsSnapshots.set('scoring-agent', {
        agentId: 'scoring-agent',
        requestCount: 100,
        avgResponseTimeMs: 50,
        errorCount: 0, // zero baseline
        lifecycleState: 'active',
        lastUpdated: Date.now(),
      });

      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      vi.advanceTimersByTime(86_400_001);

      await detector.tick();

      const improvements = mockBus.published.filter(
        (m) => m.topic === 'learning.improvement-detected'
      );
      expect(improvements).toHaveLength(0);
    });
  });

  // --- Requirement 12.8: Incomplete entries ---

  describe('Incomplete entries on metrics collection failure', () => {
    it('should mark baseline as incomplete when metrics collection fails', async () => {
      // Remove metrics to cause failure
      metricsSnapshots.delete('scoring-agent');

      const deps: ConfigRegressionDetectorDeps = {
        bus: mockBus,
        log: mockLog,
        agentProvider: (agentId: string) => mockAgents.get(agentId),
        getAgentMetrics: (_agentId: string) => {
          throw new Error('Metrics unavailable');
        },
      };

      const failingDetector = new ConfigRegressionDetector(deps);
      await failingDetector.onConfigChange('scoring-agent', { previousVersion: 1 });

      const window = failingDetector.getActiveWindow('scoring-agent');
      expect(window).toBeDefined();
      expect(window!.baseline.status).toBe('incomplete');

      failingDetector.stop();
    });

    it('should mark baseline as incomplete when log write fails', async () => {
      mockLog.shouldFail = true;

      await detector.onConfigChange('scoring-agent', { previousVersion: 1 });

      const window = detector.getActiveWindow('scoring-agent');
      expect(window).toBeDefined();
      expect(window!.baseline.status).toBe('incomplete');
    });

    it('should mark comparison as incomplete when metrics collection fails at comparison time', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1 });

      const window = detector.getActiveWindow('scoring-agent');
      const correlationId = window!.changeCorrelationId;

      // Cause metrics failure before comparison
      metricsSnapshots.delete('scoring-agent');

      // Create new detector with failing metrics to test comparison capture
      const deps: ConfigRegressionDetectorDeps = {
        bus: mockBus,
        log: mockLog,
        agentProvider: (agentId: string) => mockAgents.get(agentId),
        getAgentMetrics: (_agentId: string) => {
          throw new Error('Metrics unavailable');
        },
      };

      // We can't easily swap the getAgentMetrics function, but we can test
      // via a nested change after removing the metrics
      const failDetector = new ConfigRegressionDetector(deps);
      await failDetector.onConfigChange('scoring-agent', { previousVersion: 1 });

      // Close window via nested change
      await failDetector.onConfigChange('scoring-agent', { previousVersion: 2 });

      const firstWindow = failDetector.getActiveWindow('scoring-agent');
      // The first window's comparison should be incomplete
      // We can't get the first correlation ID directly, but check log entries
      const incompleteEntries = mockLog.entries.filter(
        (e) => e.status === 'incomplete' && e.payload.snapshotType === 'comparison'
      );
      expect(incompleteEntries.length).toBeGreaterThanOrEqual(1);

      failDetector.stop();
    });

    it('should skip improvement detection for incomplete baseline entries', async () => {
      const deps: ConfigRegressionDetectorDeps = {
        bus: mockBus,
        log: mockLog,
        agentProvider: (agentId: string) => mockAgents.get(agentId),
        getAgentMetrics: (_agentId: string) => {
          throw new Error('Metrics unavailable');
        },
      };

      const failDetector = new ConfigRegressionDetector(deps);
      await failDetector.onConfigChange('scoring-agent', { previousVersion: 1 });

      // After 24 hours
      vi.advanceTimersByTime(86_400_001);

      // Restore metrics for tick
      const goodDeps: ConfigRegressionDetectorDeps = {
        ...deps,
        getAgentMetrics: (agentId: string) => ({
          agentId,
          requestCount: 200,
          avgResponseTimeMs: 40,
          errorCount: 0,
          lifecycleState: 'active',
          lastUpdated: Date.now(),
        }),
      };

      // The detector's baseline is still incomplete so improvement detection should be skipped
      await failDetector.tick();

      const improvements = mockBus.published.filter(
        (m) => m.topic === 'learning.improvement-detected'
      );
      expect(improvements).toHaveLength(0);

      failDetector.stop();
    });
  });

  // --- Cleanup ---

  describe('stop() cleanup', () => {
    it('should cancel all active timers and clear windows', async () => {
      await detector.onConfigChange('scoring-agent', { previousVersion: 1, newVersion: 2 });

      expect(detector.getActiveWindow('scoring-agent')).toBeDefined();

      detector.stop();

      expect(detector.getActiveWindow('scoring-agent')).toBeUndefined();
    });
  });
});
