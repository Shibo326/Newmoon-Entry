/**
 * Property-based tests for Adaptation Log.
 * Tests Property 30 from the design document.
 *
 * Validates: Requirements 12.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import InMemoryAdaptationLog from '../adaptation-log.js';
import type { LogEntry, LogFilter } from '../../types/log.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ENTRY_TYPES: LogEntry['type'][] = ['metric', 'config-change', 'feedback', 'anomaly'];
const AGENT_IDS = ['agent-a', 'agent-b', 'agent-c', 'agent-d'];
const CORRELATION_IDS = ['corr-1', 'corr-2', 'corr-3', 'corr-4', 'corr-5'];

/**
 * Arbitrary for a valid LogEntry.
 */
const arbLogEntry = (): fc.Arbitrary<LogEntry> =>
  fc.record({
    id: fc.uuid(),
    type: fc.constantFrom(...ENTRY_TYPES),
    agentId: fc.constantFrom(...AGENT_IDS),
    timestamp: fc.integer({ min: 1000, max: 2000000 }),
    payload: fc.record({
      avgResponseTimeMs: fc.integer({ min: 0, max: 5000 }),
      errorRate: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    correlationId: fc.constantFrom(...CORRELATION_IDS),
  }) as fc.Arbitrary<LogEntry>;

/**
 * Arbitrary for a LogFilter that selects from the same pools as entries.
 */
const arbFilter = (): fc.Arbitrary<LogFilter> =>
  fc.record({
    agentId: fc.option(fc.constantFrom(...AGENT_IDS), { nil: undefined }),
    type: fc.option(fc.constantFrom(...ENTRY_TYPES), { nil: undefined }),
    startTime: fc.option(fc.integer({ min: 0, max: 2000000 }), { nil: undefined }),
    endTime: fc.option(fc.integer({ min: 0, max: 2000000 }), { nil: undefined }),
    correlationId: fc.option(fc.constantFrom(...CORRELATION_IDS), { nil: undefined }),
    limit: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  }) as fc.Arbitrary<LogFilter>;

/**
 * Checks if a log entry matches a given filter (reference implementation).
 */
function entryMatchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.agentId !== undefined && entry.agentId !== filter.agentId) return false;
  if (filter.type !== undefined && entry.type !== filter.type) return false;
  if (filter.startTime !== undefined && entry.timestamp < filter.startTime) return false;
  if (filter.endTime !== undefined && entry.timestamp > filter.endTime) return false;
  if (filter.correlationId !== undefined && entry.correlationId !== filter.correlationId) return false;
  return true;
}

// ─── Property 30: Adaptation Log Query Filtering ────────────────────────────
/**
 * **Validates: Requirements 12.4**
 *
 * For any query over the Adaptation Log specifying agent, entry type,
 * time range, and/or correlation identifier, the system SHALL return
 * at most 500 matching entries ordered by timestamp descending. Results
 * SHALL contain only entries matching all specified filter criteria.
 */
describe('Property 30: Adaptation Log Query Filtering', () => {
  it('results contain only entries matching all filter criteria', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbLogEntry(), { minLength: 1, maxLength: 50 }),
        arbFilter(),
        async (entries, filter) => {
          const log = new InMemoryAdaptationLog();

          for (const entry of entries) {
            await log.write(entry);
          }

          const results = await log.query(filter);

          // Every result must match ALL specified filter criteria
          for (const result of results) {
            if (filter.agentId !== undefined) {
              expect(result.agentId).toBe(filter.agentId);
            }
            if (filter.type !== undefined) {
              expect(result.type).toBe(filter.type);
            }
            if (filter.startTime !== undefined) {
              expect(result.timestamp).toBeGreaterThanOrEqual(filter.startTime);
            }
            if (filter.endTime !== undefined) {
              expect(result.timestamp).toBeLessThanOrEqual(filter.endTime);
            }
            if (filter.correlationId !== undefined) {
              expect(result.correlationId).toBe(filter.correlationId);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('results are ordered by timestamp descending', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbLogEntry(), { minLength: 2, maxLength: 50 }),
        arbFilter(),
        async (entries, filter) => {
          const log = new InMemoryAdaptationLog();

          for (const entry of entries) {
            await log.write(entry);
          }

          const results = await log.query(filter);

          // Verify descending timestamp order
          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1]!.timestamp).toBeGreaterThanOrEqual(results[i]!.timestamp);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns at most 500 results regardless of matching entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 501, max: 600 }),
        async (numEntries) => {
          const log = new InMemoryAdaptationLog();

          // Write many entries that all match a broad filter
          for (let i = 0; i < numEntries; i++) {
            await log.write({
              id: `entry-${i}`,
              type: 'metric',
              agentId: 'agent-a',
              timestamp: 1000 + i,
              payload: { value: i },
              correlationId: 'corr-1',
            });
          }

          // Query with no filter (matches all)
          const results = await log.query({});
          expect(results.length).toBeLessThanOrEqual(500);
          expect(results.length).toBe(500);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('custom limit is capped at 500', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 501, max: 2000 }),
        async (requestedLimit) => {
          const log = new InMemoryAdaptationLog();

          // Write 550 entries
          for (let i = 0; i < 550; i++) {
            await log.write({
              id: `entry-${i}`,
              type: 'metric',
              agentId: 'agent-a',
              timestamp: 1000 + i,
              payload: { value: i },
              correlationId: 'corr-1',
            });
          }

          const results = await log.query({ limit: requestedLimit });
          expect(results.length).toBeLessThanOrEqual(500);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('query returns all matching entries up to the limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbLogEntry(), { minLength: 1, maxLength: 50 }),
        arbFilter(),
        async (entries, filter) => {
          const log = new InMemoryAdaptationLog();

          for (const entry of entries) {
            await log.write(entry);
          }

          const results = await log.query(filter);

          // Compute expected matching entries manually
          const expectedMatches = entries.filter(e => entryMatchesFilter(e, filter));
          const effectiveLimit = Math.min(filter.limit ?? 500, 500);
          const expectedCount = Math.min(expectedMatches.length, effectiveLimit);

          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty filter returns all entries (up to 500)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbLogEntry(), { minLength: 0, maxLength: 30 }),
        async (entries) => {
          const log = new InMemoryAdaptationLog();

          for (const entry of entries) {
            await log.write(entry);
          }

          const results = await log.query({});
          expect(results.length).toBe(Math.min(entries.length, 500));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('combined filters intersect correctly (all criteria must match)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbLogEntry(), { minLength: 5, maxLength: 40 }),
        fc.constantFrom(...ENTRY_TYPES),
        fc.constantFrom(...AGENT_IDS),
        async (entries, filterType, filterAgent) => {
          const log = new InMemoryAdaptationLog();

          for (const entry of entries) {
            await log.write(entry);
          }

          const combinedFilter: LogFilter = {
            agentId: filterAgent,
            type: filterType,
          };

          const results = await log.query(combinedFilter);

          // Manual count of entries matching both
          const expectedCount = entries.filter(
            e => e.agentId === filterAgent && e.type === filterType
          ).length;

          expect(results.length).toBe(Math.min(expectedCount, 500));

          // All results must match both criteria
          for (const r of results) {
            expect(r.agentId).toBe(filterAgent);
            expect(r.type).toBe(filterType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
