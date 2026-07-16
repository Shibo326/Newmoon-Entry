/**
 * Privacy Guard — utility module to strip sensitive data from event payloads
 * and log entries. Ensures no raw signal values, signal vectors, or Credit Grade
 * values leak into Message Bus events or Adaptation Log entries.
 *
 * Only allows: operation status, timestamps, agent IDs, hashes, and performance metrics.
 *
 * Validates: Requirements 5.5, 7.3, 10.6
 */

/**
 * Fields that contain sensitive data that must NEVER appear in events or logs.
 * These are stripped regardless of nesting level.
 */
const SENSITIVE_FIELD_NAMES = new Set([
  'signals',
  'signalVector',
  'rawSignals',
  'normalizedSignals',
  'signalValues',
  'creditGrade',
  'grade',
  'vectors',
]);

/**
 * Credit Grade values that should be detected and redacted from payloads.
 */
const CREDIT_GRADE_VALUES = new Set(['AAA', 'AA', 'A', 'BBB', 'BB', 'C']);

/**
 * Fields that are ALLOWED in event/log payloads (whitelist).
 * In strict mode, only these fields pass through.
 */
const ALLOWED_FIELDS = new Set([
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

export interface PrivacyGuardOptions {
  /** Whether to use strict mode (block anything not in whitelist). Default: false */
  strict?: boolean;
}

/**
 * Check if a value looks like raw signal data (array of exactly 6 numbers in [0,1]).
 */
export function isSignalVector(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length !== 6) {
    return false;
  }
  return value.every(
    (item) => typeof item === 'number' && item >= 0.0 && item <= 1.0
  );
}

/**
 * Check if a string value is a Credit Grade.
 */
function isCreditGradeValue(value: unknown): boolean {
  return typeof value === 'string' && CREDIT_GRADE_VALUES.has(value);
}

/**
 * Strip sensitive data from a payload object.
 * Removes fields by name (SENSITIVE_FIELD_NAMES), detects credit grade values,
 * and detects signal vectors (arrays of 6 numbers in [0,1]).
 * Returns a new sanitized object.
 */
export function sanitizePayload(
  payload: Record<string, unknown>,
  options?: PrivacyGuardOptions
): Record<string, unknown> {
  const strict = options?.strict ?? false;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    // Always remove sensitive field names
    if (SENSITIVE_FIELD_NAMES.has(key)) {
      continue;
    }

    // In strict mode, only allow whitelisted fields
    if (strict && !ALLOWED_FIELDS.has(key)) {
      continue;
    }

    // Redact values that are credit grades
    if (isCreditGradeValue(value)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Redact values that look like signal vectors
    if (isSignalVector(value)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizePayload(value as Record<string, unknown>, options);
      continue;
    }

    // Recursively check arrays for nested objects
    if (Array.isArray(value)) {
      sanitized[key] = sanitizeArray(value, options);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Sanitize an array, checking for nested objects and sensitive values.
 */
function sanitizeArray(arr: unknown[], options?: PrivacyGuardOptions): unknown[] {
  return arr.map((item) => {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      return sanitizePayload(item as Record<string, unknown>, options);
    }
    if (Array.isArray(item)) {
      // Check if the nested array is itself a signal vector
      if (isSignalVector(item)) {
        return '[REDACTED]';
      }
      return sanitizeArray(item, options);
    }
    if (isCreditGradeValue(item)) {
      return '[REDACTED]';
    }
    return item;
  });
}

/**
 * Check if a payload contains any sensitive data.
 * Returns field paths that contain sensitive information.
 */
export function detectSensitiveData(payload: Record<string, unknown>): string[] {
  const paths: string[] = [];
  detectSensitiveDataRecursive(payload, '', paths);
  return paths;
}

/**
 * Recursively detect sensitive data in a payload.
 */
function detectSensitiveDataRecursive(
  obj: Record<string, unknown>,
  prefix: string,
  paths: string[]
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    // Check if field name is sensitive
    if (SENSITIVE_FIELD_NAMES.has(key)) {
      paths.push(path);
      continue;
    }

    // Check if value is a credit grade
    if (isCreditGradeValue(value)) {
      paths.push(path);
      continue;
    }

    // Check if value is a signal vector
    if (isSignalVector(value)) {
      paths.push(path);
      continue;
    }

    // Recurse into nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      detectSensitiveDataRecursive(value as Record<string, unknown>, path, paths);
      continue;
    }

    // Check arrays for sensitive data
    if (Array.isArray(value)) {
      detectSensitiveInArray(value, path, paths);
    }
  }
}

/**
 * Detect sensitive data within arrays.
 */
function detectSensitiveInArray(
  arr: unknown[],
  prefix: string,
  paths: string[]
): void {
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const path = `${prefix}[${i}]`;

    if (isCreditGradeValue(item)) {
      paths.push(path);
    } else if (isSignalVector(item)) {
      paths.push(path);
    } else if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      detectSensitiveDataRecursive(item as Record<string, unknown>, path, paths);
    } else if (Array.isArray(item)) {
      detectSensitiveInArray(item, path, paths);
    }
  }
}
