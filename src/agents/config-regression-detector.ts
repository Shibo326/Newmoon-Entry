/**
 * Config Regression Detector — detects performance regressions and improvements
 * after Behavior Profile changes.
 *
 * Validates: Requirements 11.6, 12.2, 12.3, 12.7, 12.8
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent } from '../types/agent.js';
import type { AdaptationLog, LogEntry } from '../types/log.js';
import type { MessageBus } from '../bus/message-bus.js';
import type { AgentMetricsSnapshot } from '../types/monitor.js';

// Timer type declarations for environment-agnostic usage
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

/**
 * Dependencies for the ConfigRegressionDetector.
 */
export interface ConfigRegressionDetectorDeps {
  bus: MessageBus;
  log: AdaptationLog;
  agentProvider: (agentId: string) => Agent | undefined;
  getAgentMetrics: (agentId: string) => AgentMetricsSnapshot;
}

/**
 * A metrics baseline snapshot captured before or after a config change.
 */
export interface MetricsBaseline {
  agentId: string;
  changeCorrelationId: string;
  recordedAt: number;
  responseTimeMs: number;
  errorRate: number;
  throughput: number;
  status: 'complete' | 'incomplete';
}

/**
 * Tracks an active comparison window for a config change.
 */
interface ComparisonWindow {
  agentId: string;
  changeCorrelationId: string;
  changeDetails: Record<string, unknown>;
  baseline: MetricsBaseline;
  changeAppliedAt: number;
  comparisonTimerId: number | null;
  previousVersion: number;
  regressionAlerted: boolean;
  improvementDetected: boolean;
}

/** 1 hour in ms */
const COMPARISON_WINDOW_MS = 3_600_000;
/** 5 minutes in ms */
const REGRESSION_DETECTION_WINDOW_MS = 300_000;
/** 24 hours in ms */
const IMPROVEMENT_DETECTION_WINDOW_MS = 86_400_000;
/** Final 5 minutes of comparison window */
const COMPARISON_SAMPLE_WINDOW_MS = 300_000;
/** Default error threshold (5 errors in 10 min) */
const DEFAULT_ERROR_THRESHOLD = 5;
/** Improvement threshold: 20% decrease */
const IMPROVEMENT_THRESHOLD = 0.20;

/**
 * Detects performance regressions and improvements after Behavior Profile changes.
 * Works alongside the Monitor Agent to track config changes and their impact.
 */
export class ConfigRegressionDetector {
  private readonly bus: MessageBus;
  private readonly log: AdaptationLog;
  private readonly agentProvider: (agentId: string) => Agent | undefined;
  private readonly getAgentMetrics: (agentId: string) => AgentMetricsSnapshot;

  /** Active comparison windows indexed by agentId */
  private activeWindows: Map<string, ComparisonWindow> = new Map();

  /** Recorded baselines for lookup */
  private baselines: Map<string, MetricsBaseline> = new Map();

  /** Recorded comparison snapshots */
  private comparisons: Map<string, MetricsBaseline> = new Map();

  constructor(deps: ConfigRegressionDetectorDeps) {
    this.bus = deps.bus;
    this.log = deps.log;
    this.agentProvider = deps.agentProvider;
    this.getAgentMetrics = deps.getAgentMetrics;
  }

  /**
   * Called when a config change is detected for an agent.
   * Records baseline, schedules comparison window.
   */
  async onConfigChange(agentId: string, changeDetails: Record<string, unknown>): Promise<void> {
    const correlationId = uuidv4();
    const now = Date.now();

    // Handle nested changes: close prior window if one exists
    const existingWindow = this.activeWindows.get(agentId);
    if (existingWindow) {
      await this.closeWindow(existingWindow, 'nested-change');
    }

    // Record baseline metrics snapshot immediately (within 5 seconds before change)
    const baseline = this.captureBaseline(agentId, correlationId, now);

    // Write baseline to adaptation log
    await this.writeBaselineToLog(baseline);

    // Extract previous version from change details
    const previousVersion = typeof changeDetails.previousVersion === 'number'
      ? changeDetails.previousVersion
      : 0;

    // Start comparison window timer (1 hour)
    const timerId = setTimeout(() => {
      void this.onComparisonWindowComplete(agentId);
    }, COMPARISON_WINDOW_MS);

    const window: ComparisonWindow = {
      agentId,
      changeCorrelationId: correlationId,
      changeDetails,
      baseline,
      changeAppliedAt: now,
      comparisonTimerId: timerId,
      previousVersion,
      regressionAlerted: false,
      improvementDetected: false,
    };

    this.activeWindows.set(agentId, window);
    this.baselines.set(correlationId, baseline);
  }

  /**
   * Called periodically (every 10s from the monitor) to check for regressions.
   */
  async tick(): Promise<void> {
    const now = Date.now();

    for (const [_agentId, window] of this.activeWindows) {
      // Regression detection: within 5 minutes of change
      if (!window.regressionAlerted) {
        const elapsed = now - window.changeAppliedAt;
        if (elapsed <= REGRESSION_DETECTION_WINDOW_MS) {
          await this.checkRegression(window);
        }
      }

      // Improvement detection: after 24 hours post-change
      if (!window.improvementDetected) {
        const elapsed = now - window.changeAppliedAt;
        if (elapsed >= IMPROVEMENT_DETECTION_WINDOW_MS) {
          await this.checkImprovement(window);
        }
      }
    }
  }

  /**
   * Stop all active timers and clean up.
   */
  stop(): void {
    for (const [_agentId, window] of this.activeWindows) {
      if (window.comparisonTimerId !== null) {
        clearTimeout(window.comparisonTimerId);
        window.comparisonTimerId = null;
      }
    }
    this.activeWindows.clear();
  }

  /**
   * Get the active window for an agent (exposed for testing).
   */
  getActiveWindow(agentId: string): ComparisonWindow | undefined {
    return this.activeWindows.get(agentId);
  }

  /**
   * Get recorded baselines (exposed for testing).
   */
  getBaseline(correlationId: string): MetricsBaseline | undefined {
    return this.baselines.get(correlationId);
  }

  /**
   * Get recorded comparisons (exposed for testing).
   */
  getComparison(correlationId: string): MetricsBaseline | undefined {
    return this.comparisons.get(correlationId);
  }

  // ----- Private Methods -----

  /**
   * Capture a baseline metrics snapshot for an agent.
   */
  private captureBaseline(agentId: string, correlationId: string, timestamp: number): MetricsBaseline {
    try {
      const metrics = this.getAgentMetrics(agentId);
      return {
        agentId,
        changeCorrelationId: correlationId,
        recordedAt: timestamp,
        responseTimeMs: metrics.avgResponseTimeMs,
        errorRate: metrics.errorCount,
        throughput: metrics.requestCount,
        status: 'complete',
      };
    } catch {
      // Metrics collection failed — mark incomplete
      return {
        agentId,
        changeCorrelationId: correlationId,
        recordedAt: timestamp,
        responseTimeMs: 0,
        errorRate: 0,
        throughput: 0,
        status: 'incomplete',
      };
    }
  }

  /**
   * Called when the 1-hour comparison window completes.
   * Records the comparison snapshot (average of final 5 minutes).
   */
  private async onComparisonWindowComplete(agentId: string): Promise<void> {
    const window = this.activeWindows.get(agentId);
    if (!window) return;

    const comparison = this.captureComparison(window);
    this.comparisons.set(window.changeCorrelationId, comparison);

    // Write comparison to adaptation log
    await this.writeComparisonToLog(comparison, window);

    // Clean up the timer reference
    window.comparisonTimerId = null;

    // Don't remove the window yet — we still need it for improvement detection (24h)
  }

  /**
   * Capture a comparison snapshot for an active window.
   */
  private captureComparison(window: ComparisonWindow): MetricsBaseline {
    try {
      const metrics = this.getAgentMetrics(window.agentId);
      return {
        agentId: window.agentId,
        changeCorrelationId: window.changeCorrelationId,
        recordedAt: Date.now(),
        responseTimeMs: metrics.avgResponseTimeMs,
        errorRate: metrics.errorCount,
        throughput: metrics.requestCount,
        status: 'complete',
      };
    } catch {
      return {
        agentId: window.agentId,
        changeCorrelationId: window.changeCorrelationId,
        recordedAt: Date.now(),
        responseTimeMs: 0,
        errorRate: 0,
        throughput: 0,
        status: 'incomplete',
      };
    }
  }

  /**
   * Close an existing window early (due to nested change).
   * Records comparison as 'incomplete' if less than 5 min elapsed.
   */
  private async closeWindow(window: ComparisonWindow, reason: string): Promise<void> {
    // Cancel the timer
    if (window.comparisonTimerId !== null) {
      clearTimeout(window.comparisonTimerId);
      window.comparisonTimerId = null;
    }

    const elapsed = Date.now() - window.changeAppliedAt;
    const comparison = this.captureComparison(window);

    // Mark incomplete if less than the comparison sample window elapsed
    if (elapsed < COMPARISON_SAMPLE_WINDOW_MS) {
      comparison.status = 'incomplete';
    }

    this.comparisons.set(window.changeCorrelationId, comparison);

    // Write to log
    await this.writeComparisonToLog(comparison, window, reason);

    // Remove from active windows
    this.activeWindows.delete(window.agentId);
  }

  /**
   * Check if a regression has occurred within 5 minutes of change.
   * Publishes "alert.config-regression" when error rate exceeds threshold.
   */
  private async checkRegression(window: ComparisonWindow): Promise<void> {
    try {
      const currentMetrics = this.getAgentMetrics(window.agentId);
      const currentErrorRate = currentMetrics.errorCount;
      const baselineErrorRate = window.baseline.errorRate;

      // If current error rate exceeds the threshold, publish regression alert
      if (currentErrorRate > DEFAULT_ERROR_THRESHOLD) {
        window.regressionAlerted = true;

        await this.publishEvent('alert.config-regression', {
          agentId: window.agentId,
          changeDetails: window.changeDetails,
          observedErrorRate: currentErrorRate,
          previousErrorRate: baselineErrorRate,
          rollbackRecommendation: {
            version: window.previousVersion,
          },
        });
      }
    } catch {
      // Metrics collection failed during regression check — skip silently
    }
  }

  /**
   * Check if an improvement has been detected (20%+ error rate decrease over 24h).
   * Publishes "learning.improvement-detected" when threshold is met.
   */
  private async checkImprovement(window: ComparisonWindow): Promise<void> {
    // Skip if baseline was incomplete
    if (window.baseline.status === 'incomplete') {
      window.improvementDetected = true;
      return;
    }

    // Skip if comparison was incomplete
    const comparison = this.comparisons.get(window.changeCorrelationId);
    if (comparison && comparison.status === 'incomplete') {
      window.improvementDetected = true;
      return;
    }

    // Skip if agent no longer exists
    const agent = this.agentProvider(window.agentId);
    if (!agent) {
      window.improvementDetected = true;
      return;
    }

    try {
      const currentMetrics = this.getAgentMetrics(window.agentId);
      const currentErrorRate = currentMetrics.errorCount;
      const baselineErrorRate = window.baseline.errorRate;

      // Avoid division by zero: if baseline was 0, can't compute improvement
      if (baselineErrorRate === 0) {
        window.improvementDetected = true;
        return;
      }

      const decrease = (baselineErrorRate - currentErrorRate) / baselineErrorRate;

      if (decrease >= IMPROVEMENT_THRESHOLD) {
        window.improvementDetected = true;

        await this.publishEvent('learning.improvement-detected', {
          agentId: window.agentId,
          changeDetails: window.changeDetails,
          previousErrorRate: baselineErrorRate,
          newErrorRate: currentErrorRate,
          improvement: Math.round(decrease * 100),
        });
      }
    } catch {
      // Metrics collection failed — mark window as done to avoid retry loops
      window.improvementDetected = true;
    }
  }

  /**
   * Write a baseline snapshot to the Adaptation Log.
   */
  private async writeBaselineToLog(baseline: MetricsBaseline): Promise<void> {
    const entry: LogEntry = {
      id: uuidv4(),
      type: 'metric',
      agentId: baseline.agentId,
      timestamp: baseline.recordedAt,
      payload: {
        snapshotType: 'baseline',
        responseTimeMs: baseline.responseTimeMs,
        errorRate: baseline.errorRate,
        throughput: baseline.throughput,
      },
      correlationId: baseline.changeCorrelationId,
      status: baseline.status,
    };

    try {
      await this.log.write(entry);
    } catch {
      // If log write fails, mark the baseline as incomplete
      baseline.status = 'incomplete';
    }
  }

  /**
   * Write a comparison snapshot to the Adaptation Log.
   */
  private async writeComparisonToLog(
    comparison: MetricsBaseline,
    window: ComparisonWindow,
    reason?: string
  ): Promise<void> {
    const entry: LogEntry = {
      id: uuidv4(),
      type: 'metric',
      agentId: comparison.agentId,
      timestamp: comparison.recordedAt,
      payload: {
        snapshotType: 'comparison',
        responseTimeMs: comparison.responseTimeMs,
        errorRate: comparison.errorRate,
        throughput: comparison.throughput,
        changeDetails: window.changeDetails,
        ...(reason ? { closeReason: reason } : {}),
      },
      correlationId: comparison.changeCorrelationId,
      status: comparison.status,
    };

    try {
      await this.log.write(entry);
    } catch {
      // If log write fails, mark the comparison as incomplete
      comparison.status = 'incomplete';
    }
  }

  /**
   * Publish an event on the message bus.
   */
  private async publishEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.bus.publish({
        id: uuidv4(),
        sourceAgentId: 'monitor-agent',
        targetAgentId: null,
        type: 'event',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic,
        payload,
      });
    } catch {
      // Event publishing should not throw
    }
  }
}
