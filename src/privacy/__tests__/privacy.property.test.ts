/**
 * Property-based tests for Privacy Guard.
 * Tests Property 22 from the design document.
 *
 * **Validates: Requirements 5.5, 7.3, 10.6**
 *
 * Property 22: Privacy in Events and Logs
 * For any event published on the Message Bus or entry written to the
 * Adaptation Log during scoring operations, the payload SHALL NOT contain
 * raw wallet signal values, normalized signal vector values, or Credit Grade
 * values — only operation status, timestamps, agent identifiers, hashes,
 * and performance metrics.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  sanitizePayload,
  detectSensitiveData,
  isSignalVector,
} from '../privacy-guard.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Valid Credit Grades that must never appear in sanitized output. */
const CREDIT_GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'] as const;

/** Arbitrary for a random signal vector: exactly 6 floats in [0.0, 1.0]. */
const arbSignalVector = (): fc.Arbitrary<number[]> =>
  fc.tuple(
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
  ).map(([a, b, c, d, e, f]) => [a, b, c, d, e, f]);

/** Arbitrary for a random Credit Grade. */
const arbCreditGrade = (): fc.Arbitrary<string> =>
  fc.constantFrom(...CREDIT_GRADES);

/** Arbitrary for a random agent ID. */
const arbAgentId = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    'orchestrator-agent',
    'wallet-agent',
    'signal-agent',
    'scoring-agent',
    'credential-agent',
    'verification-agent',
    'cache-agent',
    'monitor-agent'
  );

/**
 * Arbitrary for a scoring event payload that contains sensitive data.
 * Simulates payloads that agents would produce before privacy filtering.
 */
const arbScoringPayload = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    agentId: arbAgentId(),
    timestamp: fc.integer({ min: 1000000, max: 9999999 }),
    status: fc.constantFrom('success', 'error', 'timeout', 'processing'),
    signalVector: arbSignalVector(),
    creditGrade: arbCreditGrade(),
    signals: arbSignalVector(),
    hash: fc.hexaString({ minLength: 16, maxLength: 64 }),
    durationMs: fc.integer({ min: 1, max: 30000 }),
  });

/**
 * Arbitrary for a nested scoring payload with sensitive data at various depths.
 */
const arbNestedPayload = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    agentId: arbAgentId(),
    timestamp: fc.integer({ min: 1000000, max: 9999999 }),
    status: fc.constantFrom('success', 'error'),
    result: fc.record({
      grade: arbCreditGrade(),
      normalizedSignals: arbSignalVector(),
      signalHash: fc.hexaString({ minLength: 16, maxLength: 64 }),
    }),
    rawSignals: fc.record({
      walletAge: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      txFrequency: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    }),
    correlationId: fc.uuid(),
  });

/**
 * Arbitrary for a log entry payload that might contain sensitive data
 * alongside allowed metrics.
 */
const arbLogEntryPayload = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    agentId: arbAgentId(),
    timestamp: fc.integer({ min: 1000000, max: 9999999 }),
    requestCount: fc.integer({ min: 0, max: 1000 }),
    avgResponseTimeMs: fc.integer({ min: 0, max: 5000 }),
    errorCount: fc.integer({ min: 0, max: 100 }),
    signalValues: arbSignalVector(),
    vectors: fc.array(arbSignalVector(), { minLength: 1, maxLength: 3 }),
    creditGrade: arbCreditGrade(),
  });

/**
 * Recursively check if any value in the output contains raw signal vector values.
 */
function containsSignalVector(obj: unknown): boolean {
  if (isSignalVector(obj)) return true;
  if (Array.isArray(obj)) {
    return obj.some((item) => containsSignalVector(item));
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.values(obj).some((val) => containsSignalVector(val));
  }
  return false;
}

/**
 * Recursively check if any string value matches a Credit Grade.
 */
function containsCreditGrade(obj: unknown): boolean {
  if (typeof obj === 'string' && new Set(CREDIT_GRADES).has(obj as typeof CREDIT_GRADES[number])) return true;
  if (Array.isArray(obj)) {
    return obj.some((item) => containsCreditGrade(item));
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.values(obj).some((val) => containsCreditGrade(val));
  }
  return false;
}

// ─── Property 22: Privacy in Events and Logs ────────────────────────────────

describe('Property 22: Privacy in Events and Logs', () => {
  it('sanitized event payloads never contain raw signal vectors', () => {
    fc.assert(
      fc.property(arbScoringPayload(), (payload) => {
        const sanitized = sanitizePayload(payload);

        // The sanitized output must not contain any signal vector
        expect(containsSignalVector(sanitized)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('sanitized event payloads never contain Credit Grade values', () => {
    fc.assert(
      fc.property(arbScoringPayload(), (payload) => {
        const sanitized = sanitizePayload(payload);

        // The sanitized output must not contain any credit grade string
        expect(containsCreditGrade(sanitized)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('sanitized nested payloads never contain sensitive data at any depth', () => {
    fc.assert(
      fc.property(arbNestedPayload(), (payload) => {
        const sanitized = sanitizePayload(payload);

        expect(containsSignalVector(sanitized)).toBe(false);
        expect(containsCreditGrade(sanitized)).toBe(false);
        expect(detectSensitiveData(sanitized as Record<string, unknown>)).toEqual(
          []
        );
      }),
      { numRuns: 100 }
    );
  });

  it('sanitized log entry payloads never contain signal values or grades', () => {
    fc.assert(
      fc.property(arbLogEntryPayload(), (payload) => {
        const sanitized = sanitizePayload(payload);

        expect(containsSignalVector(sanitized)).toBe(false);
        expect(containsCreditGrade(sanitized)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('sanitized output in strict mode retains only allowed fields (status, timestamps, agent IDs, hashes, metrics)', () => {
    const ALLOWED_KEYS = new Set([
      'timestamp',
      'agentId',
      'hash',
      'signalHash',
      'proofHash',
      'status',
      'state',
      'previousState',
      'newState',
      'operation',
      'operationStatus',
      'topic',
      'code',
      'description',
      'reason',
      'duration',
      'durationMs',
      'requestCount',
      'errorCount',
      'avgResponseTimeMs',
      'txHash',
      'mintTimestamp',
      'version',
      'windowMs',
      'correlationId',
      'queryingAddress',
      'errorRate',
      'throughput',
      'responseTimeMs',
      'improvement',
      'previousErrorRate',
      'newErrorRate',
      'dailyCount',
      'limit',
      'snapshotType',
      'changeDetails',
      'rollbackRecommendation',
      'observedErrorRate',
      'previousVersion',
      'newVersion',
      'eventType',
      'source',
      'id',
      'type',
      'sourceAgentId',
      'targetAgentId',
    ]);

    fc.assert(
      fc.property(arbScoringPayload(), (payload) => {
        const sanitized = sanitizePayload(payload, { strict: true });

        // Detect no sensitive data remains
        const sensitiveFields = detectSensitiveData(
          sanitized as Record<string, unknown>
        );
        expect(sensitiveFields).toEqual([]);

        // All remaining keys should be from the allowed set
        for (const key of Object.keys(sanitized)) {
          expect(ALLOWED_KEYS.has(key)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('privacy guard detects sensitive data before sanitization and cleans after', () => {
    fc.assert(
      fc.property(
        arbSignalVector(),
        arbCreditGrade(),
        arbAgentId(),
        (signals, grade, agentId) => {
          // Build a payload with sensitive data
          const rawPayload: Record<string, unknown> = {
            agentId,
            timestamp: Date.now(),
            signalVector: signals,
            creditGrade: grade,
            status: 'complete',
            hash: 'abc123def456',
          };

          // Detection should find the sensitive fields
          const detected = detectSensitiveData(rawPayload);
          expect(detected.length).toBeGreaterThan(0);
          expect(detected).toContain('signalVector');
          expect(detected).toContain('creditGrade');

          // After sanitization, no sensitive data should remain
          const sanitized = sanitizePayload(rawPayload);
          const afterDetect = detectSensitiveData(
            sanitized as Record<string, unknown>
          );
          expect(afterDetect).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('random payloads with mixed sensitive and safe data never leak after sanitization', () => {
    fc.assert(
      fc.property(
        fc.record({
          agentId: arbAgentId(),
          timestamp: fc.integer({ min: 1000000, max: 9999999 }),
          status: fc.constantFrom('success', 'error', 'pending'),
          durationMs: fc.integer({ min: 0, max: 60000 }),
          hash: fc.hexaString({ minLength: 8, maxLength: 64 }),
          // Sensitive data injected under known sensitive field names
          signals: arbSignalVector(),
          normalizedSignals: arbSignalVector(),
          grade: arbCreditGrade(),
          vectors: fc.array(arbSignalVector(), { minLength: 1, maxLength: 2 }),
        }),
        (payload) => {
          const sanitized = sanitizePayload(payload as Record<string, unknown>);

          // No signal vectors should remain
          expect(containsSignalVector(sanitized)).toBe(false);

          // No credit grade should remain
          expect(containsCreditGrade(sanitized)).toBe(false);

          // Sensitive field names should be stripped
          expect(sanitized).not.toHaveProperty('signals');
          expect(sanitized).not.toHaveProperty('normalizedSignals');
          expect(sanitized).not.toHaveProperty('grade');
          expect(sanitized).not.toHaveProperty('vectors');

          // Safe fields should remain
          expect(sanitized).toHaveProperty('agentId');
          expect(sanitized).toHaveProperty('timestamp');
          expect(sanitized).toHaveProperty('status');
          expect(sanitized).toHaveProperty('durationMs');
          expect(sanitized).toHaveProperty('hash');
        }
      ),
      { numRuns: 100 }
    );
  });
});
