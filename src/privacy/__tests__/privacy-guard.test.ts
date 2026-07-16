/**
 * Unit tests for the Privacy Guard utility module.
 * Validates: Requirements 5.5, 7.3, 10.6
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizePayload,
  detectSensitiveData,
  isSignalVector,
} from '../privacy-guard.js';

describe('isSignalVector', () => {
  it('should return true for an array of exactly 6 numbers in [0, 1]', () => {
    expect(isSignalVector([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])).toBe(true);
  });

  it('should return true for boundary values (all zeros)', () => {
    expect(isSignalVector([0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it('should return true for boundary values (all ones)', () => {
    expect(isSignalVector([1, 1, 1, 1, 1, 1])).toBe(true);
  });

  it('should return false for an array with fewer than 6 numbers', () => {
    expect(isSignalVector([0.1, 0.2, 0.3])).toBe(false);
  });

  it('should return false for an array with more than 6 numbers', () => {
    expect(isSignalVector([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7])).toBe(false);
  });

  it('should return false for an array with values outside [0, 1]', () => {
    expect(isSignalVector([0.1, 0.2, 1.5, 0.4, 0.5, 0.6])).toBe(false);
    expect(isSignalVector([-0.1, 0.2, 0.3, 0.4, 0.5, 0.6])).toBe(false);
  });

  it('should return false for non-array values', () => {
    expect(isSignalVector('hello')).toBe(false);
    expect(isSignalVector(42)).toBe(false);
    expect(isSignalVector(null)).toBe(false);
    expect(isSignalVector(undefined)).toBe(false);
    expect(isSignalVector({})).toBe(false);
  });

  it('should return false for an array with non-number elements', () => {
    expect(isSignalVector([0.1, 'a', 0.3, 0.4, 0.5, 0.6])).toBe(false);
  });
});

describe('sanitizePayload', () => {
  it('should remove sensitive field names from the payload', () => {
    const payload = {
      agentId: 'signal-agent',
      signals: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      signalVector: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
      rawSignals: { walletAge: 100 },
      normalizedSignals: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      signalValues: { txFreq: 0.8 },
      creditGrade: 'AAA',
      grade: 'BBB',
      vectors: [[0.1, 0.2]],
      timestamp: 1234567890,
    };

    const result = sanitizePayload(payload);

    expect(result).toHaveProperty('agentId', 'signal-agent');
    expect(result).toHaveProperty('timestamp', 1234567890);
    expect(result).not.toHaveProperty('signals');
    expect(result).not.toHaveProperty('signalVector');
    expect(result).not.toHaveProperty('rawSignals');
    expect(result).not.toHaveProperty('normalizedSignals');
    expect(result).not.toHaveProperty('signalValues');
    expect(result).not.toHaveProperty('creditGrade');
    expect(result).not.toHaveProperty('grade');
    expect(result).not.toHaveProperty('vectors');
  });

  it('should redact values that are credit grade strings', () => {
    const payload = {
      status: 'success',
      result: 'AAA',
      otherField: 'BB',
    };

    const result = sanitizePayload(payload);

    expect(result.status).toBe('success');
    expect(result.result).toBe('[REDACTED]');
    expect(result.otherField).toBe('[REDACTED]');
  });

  it('should redact values that look like signal vectors (6 numbers in [0,1])', () => {
    const payload = {
      agentId: 'test',
      data: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    };

    const result = sanitizePayload(payload);

    expect(result.agentId).toBe('test');
    expect(result.data).toBe('[REDACTED]');
  });

  it('should not redact arrays that are not signal vectors', () => {
    const payload = {
      agentId: 'test',
      ids: ['a', 'b', 'c'],
      counts: [1, 2, 3, 4, 5, 6, 7],
    };

    const result = sanitizePayload(payload);

    expect(result.ids).toEqual(['a', 'b', 'c']);
    expect(result.counts).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('should recursively sanitize nested objects', () => {
    const payload = {
      agentId: 'test',
      nested: {
        signalVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        status: 'ok',
        deep: {
          grade: 'A',
          timestamp: 9999,
        },
      },
    };

    const result = sanitizePayload(payload);

    expect(result.agentId).toBe('test');
    const nested = result.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty('signalVector');
    expect(nested.status).toBe('ok');
    const deep = nested.deep as Record<string, unknown>;
    expect(deep).not.toHaveProperty('grade');
    expect(deep.timestamp).toBe(9999);
  });

  it('should handle arrays with nested objects containing sensitive data', () => {
    const payload = {
      entries: [
        { agentId: 'a', grade: 'AA' },
        { agentId: 'b', status: 'ok' },
      ],
    };

    const result = sanitizePayload(payload);
    const entries = result.entries as Record<string, unknown>[];

    expect(entries[0]).not.toHaveProperty('grade');
    expect(entries[0]).toHaveProperty('agentId', 'a');
    expect(entries[1]).toHaveProperty('agentId', 'b');
    expect(entries[1]).toHaveProperty('status', 'ok');
  });

  it('should handle empty objects', () => {
    expect(sanitizePayload({})).toEqual({});
  });

  it('should not modify non-sensitive string values', () => {
    const payload = {
      status: 'success',
      operation: 'compute',
      reason: 'timeout',
    };

    const result = sanitizePayload(payload);
    expect(result).toEqual(payload);
  });

  describe('strict mode', () => {
    it('should only allow whitelisted fields in strict mode', () => {
      const payload = {
        agentId: 'test-agent',
        timestamp: 123456,
        status: 'active',
        unknownField: 'should-be-removed',
        customData: { a: 1 },
      };

      const result = sanitizePayload(payload, { strict: true });

      expect(result).toHaveProperty('agentId', 'test-agent');
      expect(result).toHaveProperty('timestamp', 123456);
      expect(result).toHaveProperty('status', 'active');
      expect(result).not.toHaveProperty('unknownField');
      expect(result).not.toHaveProperty('customData');
    });

    it('should still remove sensitive fields in strict mode', () => {
      const payload = {
        agentId: 'test',
        signals: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        status: 'ok',
      };

      const result = sanitizePayload(payload, { strict: true });

      expect(result).toHaveProperty('agentId', 'test');
      expect(result).toHaveProperty('status', 'ok');
      expect(result).not.toHaveProperty('signals');
    });
  });

  it('should not mutate the original payload', () => {
    const payload = {
      agentId: 'test',
      signals: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      creditGrade: 'AAA',
    };

    const original = { ...payload };
    sanitizePayload(payload);

    expect(payload).toEqual(original);
  });

  it('should redact credit grade values inside arrays', () => {
    const payload = {
      grades: ['AAA', 'BB', 'unknown'],
    };

    const result = sanitizePayload(payload);
    expect(result.grades).toEqual(['[REDACTED]', '[REDACTED]', 'unknown']);
  });
});

describe('detectSensitiveData', () => {
  it('should return empty array for clean payloads', () => {
    const payload = {
      agentId: 'test',
      timestamp: 123456,
      status: 'active',
    };

    expect(detectSensitiveData(payload)).toEqual([]);
  });

  it('should detect sensitive field names', () => {
    const payload = {
      agentId: 'test',
      signals: [0.1, 0.2, 0.3],
      creditGrade: 'AAA',
    };

    const paths = detectSensitiveData(payload);

    expect(paths).toContain('signals');
    expect(paths).toContain('creditGrade');
  });

  it('should detect credit grade values in non-sensitive fields', () => {
    const payload = {
      result: 'AAA',
      other: 'BB',
    };

    const paths = detectSensitiveData(payload);

    expect(paths).toContain('result');
    expect(paths).toContain('other');
  });

  it('should detect signal vectors', () => {
    const payload = {
      data: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    };

    const paths = detectSensitiveData(payload);

    expect(paths).toContain('data');
  });

  it('should detect sensitive data in nested objects', () => {
    const payload = {
      nested: {
        deep: {
          grade: 'A',
        },
      },
    };

    const paths = detectSensitiveData(payload);

    expect(paths).toContain('nested.deep.grade');
  });

  it('should detect sensitive data in arrays', () => {
    const payload = {
      items: [
        { signals: [1, 2, 3] },
        { status: 'ok' },
      ],
    };

    const paths = detectSensitiveData(payload);

    expect(paths).toContain('items[0].signals');
  });

  it('should detect credit grade values in arrays', () => {
    const payload = {
      values: ['ok', 'AAA', 'test'],
    };

    const paths = detectSensitiveData(payload);

    expect(paths).toContain('values[1]');
  });
});
