/**
 * Monitor Agent — centralized monitoring across all agents.
 * Subscribes to all Message Bus events, records metrics in the Adaptation Log,
 * computes per-agent metrics, detects error thresholds, detects unresponsive agents,
 * and exposes system health status.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { AdaptationLog, LogEntry } from '../types/log.js';
import type { MessageBus, Subscription } from '../bus/message-bus.js';
import type { MonitorMetrics, AgentMetricsSnapshot, SystemHealthStatus } from '../types/monitor.js';

// Timer type declarations for environment-agnostic usage
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(id: number): void;

/**
 * Sensitive fields that must be stripped from log entries for privacy.
 * Raw signals, signal vectors, and credit grades are excluded.
 */
const SENSITIVE_FIELDS = new Set([
  'signals',
  'signalVector',
  'rawSignals',
  'creditGrade',
  'grade',
  'vectors',
  'normalizedSignals',
  'signalValues',
]);

/**
 * Tracked event for computing per-agent metrics.
 */
interface TrackedEvent {
  agentId: string;
  type: string;
  timestamp: number;
  duration?: number;
}

/**
 * Pending request tracked for duration computation via correlation ID matching.
 */
interface PendingRequest {
  sourceAgentId: string;
  timestamp: number;
}

// Default Behavior Profile parameters
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_ERROR_THRESHOLD = 5;
const DEFAULT_ERROR_WINDOW_MS = 600_000; // 10 minutes
const DEFAULT_METRICS_UPDATE_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFERED_ENTRIES = 500;
const METRICS_WINDOW_MS = 3_600_000; // 1 hour

/**
 * Strips sensitive data from a payload object for privacy compliance.
 * Only allows operation status, timestamps, agent IDs, hashes, and metrics.
 */
function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_FIELDS.has(key)) {
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizePayload(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Monitor Agent implementation.
 * Implements both the Agent interface and MonitorMetrics interface.
 */
export class MonitorAgent implements Agent, MonitorMetrics {
  readonly id = 'monitor-agent';
  readonly name = 'Monitor Agent';

  private state: AgentLifecycleState = 'idle';
  private startTime: number = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;

  // Behavior Profile parameters
  private healthCheckIntervalMs: number = DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  private errorThreshold: number = DEFAULT_ERROR_THRESHOLD;
  private errorWindowMs: number = DEFAULT_ERROR_WINDOW_MS;
  private metricsUpdateIntervalMs: number = DEFAULT_METRICS_UPDATE_INTERVAL_MS;
  private maxBufferedEntries: number = DEFAULT_MAX_BUFFERED_ENTRIES;

  // Internal state
  private trackedEvents: TrackedEvent[] = [];
  private pendingRequests: Map<string, PendingRequest> = new Map(); // correlationId -> PendingRequest
  private subscriptions: Subscription[] = [];
  private metricsCache: Map<string, AgentMetricsSnapshot> = new Map();
  private metricsUpdateTimer: number | null = null;
  private healthCheckTimer: number | null = null;

  // Alert deduplication: agentId -> last alert timestamp (prevents spam within window)
  private degradedAlerts: Map<string, number> = new Map();
  private unresponsiveAlerts: Map<string, boolean> = new Map();

  // Health check tracking: agentId -> consecutive missed count
  private missedHealthChecks: Map<string, number> = new Map();

  // Log buffer for when Adaptation Log is unavailable
  private logBuffer: LogEntry[] = [];
  private logUnavailable = false;

  constructor(
    private readonly bus: MessageBus,
    private readonly log: AdaptationLog,
    private readonly agentProvider: (agentId: string) => Agent | undefined
  ) {}

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startMs = Date.now();
    this.requestCount++;

    let result: ResponseMessage | ErrorMessage;

    if (message.type === 'request' && message.topic === 'monitor.get-health') {
      result = this.createResponse(message, {
        status: this.getSystemHealth(),
        metrics: Object.fromEntries(this.getAllMetrics()),
      });
    } else if (message.type === 'request' && message.topic === 'monitor.get-agent-metrics') {
      const agentId = (message.payload as Record<string, unknown>).agentId as string;
      if (!agentId) {
        this.errorCount++;
        result = this.createErrorResponse(message, 'validation-error', 'agentId is required');
      } else {
        result = this.createResponse(message, this.getAgentMetrics(agentId) as unknown as Record<string, unknown>);
      }
    } else {
      this.errorCount++;
      result = this.createErrorResponse(message, 'unsupported-topic', `Unsupported topic: ${message.topic}`);
    }

    const elapsed = Date.now() - startMs;
    this.totalResponseTimeMs += elapsed;
    return result;
  }

  getHealth(): AgentHealth {
    return {
      state: this.state,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTimeMs: this.requestCount > 0
        ? Math.round(this.totalResponseTimeMs / this.requestCount)
        : 0,
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      { topic: 'monitor.get-health', description: 'Get aggregate system health status' },
      { topic: 'monitor.get-agent-metrics', description: 'Get metrics for a specific agent' },
    ];
  }

  async initialize(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
    this.state = 'idle';
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.startTime = Date.now();
    this.subscribeToAllEvents();
    this.startMetricsUpdateTimer();
    this.startHealthCheckTimer();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
    this.stopTimers();
    this.unsubscribeAll();
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
    // Restart timers with new intervals
    this.stopTimers();
    if (this.state === 'active') {
      this.startMetricsUpdateTimer();
      this.startHealthCheckTimer();
    }
  }

  // ----- MonitorMetrics Interface -----

  getAgentMetrics(agentId: string): AgentMetricsSnapshot {
    const cached = this.metricsCache.get(agentId);
    if (cached) {
      return cached;
    }
    return this.computeAgentMetrics(agentId);
  }

  getSystemHealth(): SystemHealthStatus {
    return this.computeSystemHealth();
  }

  getAllMetrics(): Map<string, AgentMetricsSnapshot> {
    return new Map(this.metricsCache);
  }

  // ----- Event Subscription & Recording -----

  /**
   * Subscribe to wildcard topic '*' to capture all bus events.
   */
  private subscribeToAllEvents(): void {
    const subscription = this.bus.subscribe('*', async (message: BusMessage) => {
      await this.recordEvent(message);
    }, this.id);
    this.subscriptions.push(subscription);
  }

  /**
   * Record an event from the bus: extract type, source, timestamp, duration.
   * Duration is computed for request/response pairs via correlation ID matching.
   * Privacy: strip raw signals, vectors, grades from log entries.
   */
  private async recordEvent(message: BusMessage): Promise<void> {
    const now = Date.now();
    let duration: number | undefined;

    // Track request/response pairs for duration computation
    if (message.type === 'request') {
      this.pendingRequests.set(message.correlationId, {
        sourceAgentId: message.sourceAgentId,
        timestamp: message.timestamp,
      });
    } else if (message.type === 'response' || message.type === 'error') {
      const pending = this.pendingRequests.get(message.correlationId);
      if (pending) {
        duration = now - pending.timestamp;
        this.pendingRequests.delete(message.correlationId);
      }
    }

    // Record tracked event for metrics
    const trackedEvent: TrackedEvent = {
      agentId: message.sourceAgentId,
      type: message.type,
      timestamp: now,
      duration,
    };
    this.trackedEvents.push(trackedEvent);

    // Check error threshold alerting
    if (message.type === 'error') {
      this.checkErrorThreshold(message.sourceAgentId);
    }

    // Write to Adaptation Log with privacy filtering
    const sanitizedPayload = sanitizePayload(message.payload as Record<string, unknown>);
    const logEntry: LogEntry = {
      id: uuidv4(),
      type: 'metric',
      agentId: message.sourceAgentId,
      timestamp: now,
      payload: {
        eventType: message.type,
        source: message.sourceAgentId,
        topic: message.topic,
        duration,
        ...sanitizedPayload,
      },
      correlationId: message.correlationId,
    };

    await this.writeToLog(logEntry);
  }

  // ----- Per-Agent Metrics Computation -----

  private computeAgentMetrics(agentId: string): AgentMetricsSnapshot {
    const now = Date.now();
    const windowStart = now - METRICS_WINDOW_MS;

    // Filter events within the last hour for this agent
    const recentEvents = this.trackedEvents.filter(
      (e) => e.agentId === agentId && e.timestamp >= windowStart
    );

    const requestEvents = recentEvents.filter((e) => e.type === 'request');
    const errorEvents = recentEvents.filter((e) => e.type === 'error');
    const eventsWithDuration = recentEvents.filter((e) => e.duration !== undefined);

    const avgResponseTimeMs = eventsWithDuration.length > 0
      ? eventsWithDuration.reduce((sum, e) => sum + (e.duration ?? 0), 0) / eventsWithDuration.length
      : 0;

    // Get lifecycle state from agent provider
    const agent = this.agentProvider(agentId);
    const lifecycleState: AgentLifecycleState = agent
      ? agent.getHealth().state
      : 'idle';

    const snapshot: AgentMetricsSnapshot = {
      agentId,
      requestCount: requestEvents.length,
      avgResponseTimeMs: Math.round(avgResponseTimeMs),
      errorCount: errorEvents.length,
      lifecycleState,
      lastUpdated: now,
    };

    this.metricsCache.set(agentId, snapshot);
    return snapshot;
  }

  /**
   * Update metrics for all known agents.
   */
  updateAllMetrics(): void {
    const agentIds = new Set<string>();
    for (const event of this.trackedEvents) {
      agentIds.add(event.agentId);
    }
    for (const agentId of agentIds) {
      this.computeAgentMetrics(agentId);
    }
  }

  // ----- Error Threshold Alerting -----

  private checkErrorThreshold(agentId: string): void {
    const now = Date.now();
    const windowStart = now - this.errorWindowMs;

    // Count errors in the time window
    const errorsInWindow = this.trackedEvents.filter(
      (e) => e.agentId === agentId && e.type === 'error' && e.timestamp >= windowStart
    ).length;

    if (errorsInWindow > this.errorThreshold) {
      // Check if we already alerted for this agent in this window
      const lastAlert = this.degradedAlerts.get(agentId);
      if (lastAlert && (now - lastAlert) < this.errorWindowMs) {
        return; // Don't spam alerts
      }

      this.degradedAlerts.set(agentId, now);
      void this.publishAlert('alert.agent-degraded', {
        agentId,
        errorCount: errorsInWindow,
        windowMs: this.errorWindowMs,
      });
    }
  }

  // ----- Unresponsive Detection -----

  private startHealthCheckTimer(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckIntervalMs);
  }

  private performHealthChecks(): void {
    // Get all known agent IDs from tracked events and metrics cache
    const agentIds = new Set<string>();
    for (const [id] of this.metricsCache) {
      agentIds.add(id);
    }
    for (const event of this.trackedEvents) {
      agentIds.add(event.agentId);
    }

    // Don't check ourselves
    agentIds.delete(this.id);

    for (const agentId of agentIds) {
      const agent = this.agentProvider(agentId);
      if (!agent) {
        // Agent not found — increment missed count
        this.incrementMissedHealthCheck(agentId);
        continue;
      }

      try {
        const health = agent.getHealth();
        if (health.state === 'active' || health.state === 'idle') {
          // Agent responded — reset missed count
          this.missedHealthChecks.set(agentId, 0);
          this.unresponsiveAlerts.delete(agentId);
        } else {
          this.incrementMissedHealthCheck(agentId);
        }
      } catch {
        // getHealth() threw — agent is unresponsive
        this.incrementMissedHealthCheck(agentId);
      }
    }
  }

  private incrementMissedHealthCheck(agentId: string): void {
    const current = this.missedHealthChecks.get(agentId) ?? 0;
    const newCount = current + 1;
    this.missedHealthChecks.set(agentId, newCount);

    if (newCount >= 3 && !this.unresponsiveAlerts.get(agentId)) {
      this.unresponsiveAlerts.set(agentId, true);
      void this.publishAlert('alert.agent-unresponsive', { agentId });
    }
  }

  // ----- System Health Computation -----

  private computeSystemHealth(): SystemHealthStatus {
    const agentIds = new Set<string>();
    for (const [id] of this.metricsCache) {
      agentIds.add(id);
    }
    for (const event of this.trackedEvents) {
      agentIds.add(event.agentId);
    }
    agentIds.delete(this.id);

    if (agentIds.size === 0) {
      return 'healthy';
    }

    // Check Orchestrator status
    const orchestrator = this.agentProvider('orchestrator-agent');
    if (orchestrator) {
      const orchHealth = orchestrator.getHealth();
      if (orchHealth.state === 'error') {
        return 'unhealthy';
      }
    }

    // Check if orchestrator is unresponsive
    if (this.unresponsiveAlerts.get('orchestrator-agent')) {
      return 'unhealthy';
    }

    // Count agents in error state
    let activeCount = 0;
    let errorCount = 0;
    let hasDegradedAlert = false;

    for (const agentId of agentIds) {
      const agent = this.agentProvider(agentId);
      if (!agent) continue;

      const health = agent.getHealth();
      if (health.state === 'disabled') continue; // Skip disabled agents

      activeCount++;
      if (health.state === 'error') {
        errorCount++;
      }

      // Check if agent has a degraded alert
      if (this.degradedAlerts.has(agentId)) {
        hasDegradedAlert = true;
      }
    }

    // unhealthy: more than half of active agents in error
    if (activeCount > 0 && errorCount > activeCount / 2) {
      return 'unhealthy';
    }

    // degraded: at least one agent has degraded alert or is in error state
    if (hasDegradedAlert || errorCount > 0) {
      return 'degraded';
    }

    return 'healthy';
  }

  // ----- Adaptation Log Writing with Buffer -----

  private async writeToLog(entry: LogEntry): Promise<void> {
    try {
      await this.log.write(entry);

      // If log was previously unavailable, flush buffer
      if (this.logUnavailable) {
        this.logUnavailable = false;
        await this.flushBuffer();
      }
    } catch {
      // Log unavailable — buffer the entry
      if (!this.logUnavailable) {
        this.logUnavailable = true;
        void this.publishEvent('monitor.log-unavailable', {
          timestamp: Date.now(),
          reason: 'Adaptation Log write failed',
        });
      }

      if (this.logBuffer.length < this.maxBufferedEntries) {
        this.logBuffer.push(entry);
      }
      // Drop entries beyond max buffer size
    }
  }

  private async flushBuffer(): Promise<void> {
    const buffered = [...this.logBuffer];
    this.logBuffer = [];

    for (const entry of buffered) {
      try {
        await this.log.write(entry);
      } catch {
        // If flushing fails, re-buffer remaining entries
        this.logUnavailable = true;
        this.logBuffer.push(entry);
        // Stop trying to flush
        break;
      }
    }
  }

  // ----- Timers -----

  private startMetricsUpdateTimer(): void {
    this.metricsUpdateTimer = setInterval(() => {
      this.updateAllMetrics();
      this.pruneOldEvents();
    }, this.metricsUpdateIntervalMs);
  }

  private stopTimers(): void {
    if (this.metricsUpdateTimer !== null) {
      clearInterval(this.metricsUpdateTimer);
      this.metricsUpdateTimer = null;
    }
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Remove tracked events older than the metrics window (1 hour).
   */
  private pruneOldEvents(): void {
    const cutoff = Date.now() - METRICS_WINDOW_MS;
    this.trackedEvents = this.trackedEvents.filter((e) => e.timestamp >= cutoff);

    // Also prune pending requests older than 5 minutes (abandoned)
    const requestCutoff = Date.now() - 300_000;
    for (const [corrId, pending] of this.pendingRequests) {
      if (pending.timestamp < requestCutoff) {
        this.pendingRequests.delete(corrId);
      }
    }
  }

  // ----- Publishing Helpers -----

  private async publishAlert(topic: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.bus.publish({
        id: uuidv4(),
        sourceAgentId: this.id,
        targetAgentId: null,
        type: 'event',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic,
        payload,
      });
    } catch {
      // Alert publishing should not throw
    }
  }

  private async publishEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.bus.publish({
        id: uuidv4(),
        sourceAgentId: this.id,
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

  // ----- Profile Management -----

  private applyProfile(profile: BehaviorProfile): void {
    const healthCheckInterval = profile.parameters.healthCheckIntervalMs;
    if (typeof healthCheckInterval === 'number' && healthCheckInterval > 0) {
      this.healthCheckIntervalMs = healthCheckInterval;
    }

    const errorThreshold = profile.parameters.errorThreshold;
    if (typeof errorThreshold === 'number' && errorThreshold > 0) {
      this.errorThreshold = errorThreshold;
    }

    const errorWindow = profile.parameters.errorWindowMs;
    if (typeof errorWindow === 'number' && errorWindow > 0) {
      this.errorWindowMs = errorWindow;
    }

    const metricsUpdate = profile.parameters.metricsUpdateIntervalMs;
    if (typeof metricsUpdate === 'number' && metricsUpdate > 0) {
      this.metricsUpdateIntervalMs = metricsUpdate;
    }

    const maxBuffered = profile.parameters.maxBufferedEntries;
    if (typeof maxBuffered === 'number' && maxBuffered > 0) {
      this.maxBufferedEntries = maxBuffered;
    }
  }

  // ----- Helpers -----

  private unsubscribeAll(): void {
    for (const sub of this.subscriptions) {
      this.bus.unsubscribe(sub);
    }
    this.subscriptions = [];
  }

  private createResponse(message: BusMessage, payload: Record<string, unknown>): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: message.sourceAgentId,
      type: 'response',
      correlationId: message.correlationId,
      timestamp: Date.now(),
      topic: message.topic,
      payload,
    };
  }

  private createErrorResponse(message: BusMessage, code: string, description: string): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: message.sourceAgentId,
      type: 'error',
      correlationId: message.correlationId,
      timestamp: Date.now(),
      topic: message.topic,
      payload: { code, description },
    };
  }

  // ----- Testing Helpers -----

  /**
   * Get current buffer size (for testing).
   */
  get bufferSize(): number {
    return this.logBuffer.length;
  }

  /**
   * Get tracked events count (for testing).
   */
  get trackedEventCount(): number {
    return this.trackedEvents.length;
  }
}

export default MonitorAgent;
