import { describe, it, expect, beforeEach } from 'vitest';
import InMemoryAdaptationLog from '../adaptation-log.js';
import type { LogEntry } from '../../types/log.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'entry-1',
    type: 'metric',
    agentId: 'agent-a',
    timestamp: Date.now(),
    payload: { avgResponseTimeMs: 100, errorRate: 0.02 },
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('InMemoryAdaptationLog', () => {
  let log: InMemoryAdaptationLog;

  beforeEach(() => {
    log = new InMemoryAdaptationLog();
  });

  describe('write()', () => {
    it('stores a valid entry', async () => {
      const entry = makeEntry();
      await log.write(entry);
      expect(log.size).toBe(1);
    });

    it('rejects payload exceeding 64KB', async () => {
      const largePayload: Record<string, unknown> = {};
      // Create a payload larger than 64KB
      for (let i = 0; i < 1000; i++) {
        largePayload[`key_${i}`] = 'x'.repeat(100);
      }
      const entry = makeEntry({ payload: largePayload });
      await expect(log.write(entry)).rejects.toThrow('exceeds maximum of 65536 bytes');
    });

    it('accepts payload at exactly 64KB boundary', async () => {
      // Build a payload that's close to 64KB but under
      const value = 'a'.repeat(63000);
      const entry = makeEntry({ payload: { data: value } });
      await log.write(entry);
      expect(log.size).toBe(1);
    });

    it('stores entries with all valid types', async () => {
      const types: LogEntry['type'][] = ['metric', 'config-change', 'feedback', 'anomaly'];
      for (const type of types) {
        await log.write(makeEntry({ id: `entry-${type}`, type }));
      }
      expect(log.size).toBe(4);
    });

    it('stores entry with status field', async () => {
      await log.write(makeEntry({ status: 'incomplete' }));
      const results = await log.query({});
      expect(results[0]?.status).toBe('incomplete');
    });
  });

  describe('query()', () => {
    it('returns all entries when no filter specified', async () => {
      await log.write(makeEntry({ id: '1', timestamp: 1000 }));
      await log.write(makeEntry({ id: '2', timestamp: 2000 }));
      const results = await log.query({});
      expect(results).toHaveLength(2);
    });

    it('orders results by timestamp descending', async () => {
      await log.write(makeEntry({ id: '1', timestamp: 1000 }));
      await log.write(makeEntry({ id: '2', timestamp: 3000 }));
      await log.write(makeEntry({ id: '3', timestamp: 2000 }));
      const results = await log.query({});
      expect(results.map((r) => r.id)).toEqual(['2', '3', '1']);
    });

    it('filters by agentId', async () => {
      await log.write(makeEntry({ id: '1', agentId: 'agent-a' }));
      await log.write(makeEntry({ id: '2', agentId: 'agent-b' }));
      const results = await log.query({ agentId: 'agent-a' });
      expect(results).toHaveLength(1);
      expect(results[0]?.agentId).toBe('agent-a');
    });

    it('filters by type', async () => {
      await log.write(makeEntry({ id: '1', type: 'metric' }));
      await log.write(makeEntry({ id: '2', type: 'config-change' }));
      const results = await log.query({ type: 'config-change' });
      expect(results).toHaveLength(1);
      expect(results[0]?.type).toBe('config-change');
    });

    it('filters by time range', async () => {
      await log.write(makeEntry({ id: '1', timestamp: 1000 }));
      await log.write(makeEntry({ id: '2', timestamp: 2000 }));
      await log.write(makeEntry({ id: '3', timestamp: 3000 }));
      const results = await log.query({ startTime: 1500, endTime: 2500 });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('2');
    });

    it('filters by correlationId', async () => {
      await log.write(makeEntry({ id: '1', correlationId: 'corr-1' }));
      await log.write(makeEntry({ id: '2', correlationId: 'corr-2' }));
      const results = await log.query({ correlationId: 'corr-2' });
      expect(results).toHaveLength(1);
      expect(results[0]?.correlationId).toBe('corr-2');
    });

    it('caps results at 500', async () => {
      for (let i = 0; i < 600; i++) {
        await log.write(makeEntry({ id: `entry-${i}`, timestamp: i }));
      }
      const results = await log.query({});
      expect(results).toHaveLength(500);
    });

    it('respects custom limit below 500', async () => {
      for (let i = 0; i < 20; i++) {
        await log.write(makeEntry({ id: `entry-${i}`, timestamp: i }));
      }
      const results = await log.query({ limit: 5 });
      expect(results).toHaveLength(5);
    });

    it('caps custom limit at 500 even if higher requested', async () => {
      for (let i = 0; i < 600; i++) {
        await log.write(makeEntry({ id: `entry-${i}`, timestamp: i }));
      }
      const results = await log.query({ limit: 1000 });
      expect(results).toHaveLength(500);
    });

    it('combines multiple filters', async () => {
      await log.write(makeEntry({ id: '1', agentId: 'a', type: 'metric', timestamp: 1000 }));
      await log.write(makeEntry({ id: '2', agentId: 'a', type: 'config-change', timestamp: 2000 }));
      await log.write(makeEntry({ id: '3', agentId: 'b', type: 'metric', timestamp: 3000 }));
      const results = await log.query({ agentId: 'a', type: 'metric' });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('1');
    });

    it('returns empty array when no matches', async () => {
      await log.write(makeEntry({ agentId: 'agent-a' }));
      const results = await log.query({ agentId: 'nonexistent' });
      expect(results).toHaveLength(0);
    });
  });

  describe('getAgentSummary()', () => {
    it('returns empty summary for unknown agent', async () => {
      const summary = await log.getAgentSummary('unknown');
      expect(summary.currentParameters).toEqual({});
      expect(summary.changeHistory).toEqual([]);
    });

    it('returns current parameters from latest config-change', async () => {
      await log.write(makeEntry({
        id: '1',
        type: 'config-change',
        agentId: 'agent-a',
        timestamp: 1000,
        payload: { parameters: { timeout: 5000 }, version: 1 },
        correlationId: 'corr-1',
      }));
      await log.write(makeEntry({
        id: '2',
        type: 'config-change',
        agentId: 'agent-a',
        timestamp: 2000,
        payload: { parameters: { timeout: 3000, retries: 3 }, version: 2 },
        correlationId: 'corr-2',
      }));

      const summary = await log.getAgentSummary('agent-a');
      expect(summary.currentParameters).toEqual({ timeout: 3000, retries: 3 });
    });

    it('returns last 10 config changes in history', async () => {
      for (let i = 0; i < 15; i++) {
        await log.write(makeEntry({
          id: `change-${i}`,
          type: 'config-change',
          agentId: 'agent-a',
          timestamp: 1000 + i * 1000,
          payload: { parameters: { step: i }, version: i + 1 },
          correlationId: `corr-${i}`,
        }));
      }

      const summary = await log.getAgentSummary('agent-a');
      expect(summary.changeHistory).toHaveLength(10);
    });

    it('computes before/after metrics from correlated entries', async () => {
      const correlationId = 'corr-change-1';

      // Metric before the config change
      await log.write(makeEntry({
        id: 'metric-before',
        type: 'metric',
        agentId: 'agent-a',
        timestamp: 900,
        payload: { avgResponseTimeMs: 200, errorRate: 0.05 },
        correlationId,
      }));

      // The config change
      await log.write(makeEntry({
        id: 'config-1',
        type: 'config-change',
        agentId: 'agent-a',
        timestamp: 1000,
        payload: { parameters: { timeout: 3000 }, version: 1 },
        correlationId,
      }));

      // Metric after the config change
      await log.write(makeEntry({
        id: 'metric-after',
        type: 'metric',
        agentId: 'agent-a',
        timestamp: 1100,
        payload: { avgResponseTimeMs: 150, errorRate: 0.02 },
        correlationId,
      }));

      const summary = await log.getAgentSummary('agent-a');
      expect(summary.changeHistory).toHaveLength(1);
      expect(summary.changeHistory[0]?.avgResponseTimeBefore).toBe(200);
      expect(summary.changeHistory[0]?.avgResponseTimeAfter).toBe(150);
      expect(summary.changeHistory[0]?.errorRateBefore).toBe(0.05);
      expect(summary.changeHistory[0]?.errorRateAfter).toBe(0.02);
    });
  });

  describe('cleanup()', () => {
    it('removes entries older than 90 days', async () => {
      const now = Date.now();
      const ninetyOneDaysAgo = now - 91 * 24 * 60 * 60 * 1000;

      await log.write(makeEntry({ id: 'old', timestamp: ninetyOneDaysAgo }));
      await log.write(makeEntry({ id: 'recent', timestamp: now }));

      expect(log.size).toBe(2);
      log.cleanup();
      expect(log.size).toBe(1);

      const results = await log.query({});
      expect(results[0]?.id).toBe('recent');
    });

    it('keeps entries exactly at 90 days', async () => {
      const now = Date.now();
      const exactlyNinetyDays = now - 90 * 24 * 60 * 60 * 1000;

      await log.write(makeEntry({ id: 'boundary', timestamp: exactlyNinetyDays }));
      log.cleanup();
      expect(log.size).toBe(1);
    });
  });
});
