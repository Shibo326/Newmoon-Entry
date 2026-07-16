/**
 * In-memory implementation of the AdaptationLog interface.
 * Provides storage, querying, and retention management for adaptation entries.
 *
 * Validates: Requirements 12.1, 12.4, 12.5, 12.6
 */

import type {
  AdaptationLog,
  LogEntry,
  LogFilter,
  AgentChangeSummary,
} from '../types/log.js';

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB
const MAX_QUERY_RESULTS = 500;
const RETENTION_DAYS = 90;

/**
 * Calculates the byte size of a payload object by serializing to JSON.
 * Computes UTF-8 byte length without depending on Node/DOM globals.
 */
function getPayloadByteSize(payload: Record<string, unknown>): number {
  const json = JSON.stringify(payload);
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair — 4 bytes for the pair, skip next char
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Returns the Unix ms timestamp for the retention cutoff (90 days ago).
 */
function getRetentionCutoff(): number {
  return Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * In-memory AdaptationLog implementation.
 * Supabase integration will replace this in task 17.1.
 */
export default class InMemoryAdaptationLog implements AdaptationLog {
  private entries: LogEntry[] = [];

  /**
   * Write a log entry to the store.
   * Rejects if payload exceeds 64KB.
   */
  async write(entry: LogEntry): Promise<void> {
    const payloadSize = getPayloadByteSize(entry.payload);
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      throw new Error(
        `Payload size ${payloadSize} bytes exceeds maximum of ${MAX_PAYLOAD_BYTES} bytes (64KB)`
      );
    }

    this.entries.push({ ...entry });
  }

  /**
   * Query log entries with filtering.
   * Returns max 500 results ordered by timestamp descending.
   */
  async query(filter: LogFilter): Promise<LogEntry[]> {
    const results = this.entries.filter((entry) => {
      if (filter.agentId !== undefined && entry.agentId !== filter.agentId) {
        return false;
      }
      if (filter.type !== undefined && entry.type !== filter.type) {
        return false;
      }
      if (filter.startTime !== undefined && entry.timestamp < filter.startTime) {
        return false;
      }
      if (filter.endTime !== undefined && entry.timestamp > filter.endTime) {
        return false;
      }
      if (
        filter.correlationId !== undefined &&
        entry.correlationId !== filter.correlationId
      ) {
        return false;
      }
      return true;
    });

    // Order by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit (max 500)
    const limit = Math.min(filter.limit ?? MAX_QUERY_RESULTS, MAX_QUERY_RESULTS);
    return results.slice(0, limit);
  }

  /**
   * Get a summary of an agent's configuration changes and their impact.
   * Returns current parameters and the last 10 config-change entries with
   * before/after metrics correlated by correlation ID.
   */
  async getAgentSummary(agentId: string): Promise<AgentChangeSummary> {
    // Find all config-change entries for this agent, ordered by timestamp desc
    const configChanges = this.entries
      .filter((e) => e.agentId === agentId && e.type === 'config-change')
      .sort((a, b) => b.timestamp - a.timestamp);

    // Current parameters: latest config-change entry's payload parameters
    const latestChange = configChanges[0];
    const currentParameters: Record<string, unknown> = latestChange
      ? (latestChange.payload['parameters'] as Record<string, unknown>) ?? latestChange.payload
      : {};

    // Last 10 config-change entries
    const recentChanges = configChanges.slice(0, 10);

    // Build change history with before/after metrics
    const changeHistory = recentChanges.map((change, index) => {
      const version =
        (change.payload['version'] as number) ?? recentChanges.length - index;

      // Find metric entries correlated with this config change
      const correlatedMetrics = this.entries.filter(
        (e) =>
          e.agentId === agentId &&
          e.type === 'metric' &&
          e.correlationId === change.correlationId
      );

      // Separate before/after metrics based on timestamp relative to the change
      const metricsBefore = correlatedMetrics.filter(
        (m) => m.timestamp <= change.timestamp
      );
      const metricsAfter = correlatedMetrics.filter(
        (m) => m.timestamp > change.timestamp
      );

      const avgResponseTimeBefore = computeAvg(metricsBefore, 'avgResponseTimeMs');
      const avgResponseTimeAfter = computeAvg(metricsAfter, 'avgResponseTimeMs');
      const errorRateBefore = computeAvg(metricsBefore, 'errorRate');
      const errorRateAfter = computeAvg(metricsAfter, 'errorRate');

      return {
        version,
        changedAt: change.timestamp,
        avgResponseTimeBefore,
        avgResponseTimeAfter,
        errorRateBefore,
        errorRateAfter,
      };
    });

    return {
      currentParameters,
      changeHistory,
    };
  }

  /**
   * Remove entries older than the retention period (90 days).
   * Entries are never deleted before reaching 90 days old.
   */
  cleanup(): void {
    const cutoff = getRetentionCutoff();
    this.entries = this.entries.filter((entry) => entry.timestamp >= cutoff);
  }

  /**
   * Get current entry count (useful for testing/monitoring).
   */
  get size(): number {
    return this.entries.length;
  }
}

/**
 * Compute the average of a numeric payload field across metric entries.
 */
function computeAvg(
  metrics: LogEntry[],
  field: string
): number {
  if (metrics.length === 0) return 0;
  const sum = metrics.reduce((acc, m) => {
    const value = m.payload[field];
    return acc + (typeof value === 'number' ? value : 0);
  }, 0);
  return sum / metrics.length;
}
