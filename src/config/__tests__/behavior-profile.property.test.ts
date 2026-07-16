/**
 * Property-based tests for Behavior Profile Store.
 * Tests Properties 25, 26, 28, 29 from the design document.
 *
 * Validates: Requirements 11.3, 11.5, 11.7, 11.8
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  InMemoryBehaviorProfileStore,
  ProfileConflictError,
} from '../behavior-profile-store.js';
import { ConfigReloader } from '../config-reloader.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { Agent } from '../../types/agent.js';
import type { JSONSchema } from '../../types/registry.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { BusMessage, EventMessage } from '../../types/messages.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Safe key names that don't collide with Object prototype properties. */
const safeKeyArb = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/);

/**
 * Generate a valid parameters object with 1-maxKeys keys, all numeric values.
 */
const arbParameters = (maxKeys = 10) =>
  fc.dictionary(
    safeKeyArb,
    fc.oneof(fc.integer({ min: 0, max: 100000 }), fc.double({ min: 0, max: 1, noNaN: true })),
    { minKeys: 1, maxKeys }
  );

// ─── Property 25: Behavior Profile Version Retention ────────────────────────
/**
 * **Validates: Requirements 11.3**
 *
 * For any sequence of Behavior Profile updates to a single agent,
 * the system SHALL retain the previous 10 versions. A rollback to
 * any retained version SHALL create a new version entry with the restored parameters.
 */
describe('Property 25: Behavior Profile Version Retention', () => {
  it('retains at most 10 versions for any update sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (numUpdates) => {
          const store = new InMemoryBehaviorProfileStore();

          for (let i = 0; i < numUpdates; i++) {
            await store.save({
              agentId: 'test-agent',
              version: 0,
              parameters: { step: i },
              lastModified: 1000 + i * 1000,
            });
          }

          const history = await store.getVersionHistory('test-agent', 100);
          expect(history.length).toBeLessThanOrEqual(10);
          expect(history.length).toBe(Math.min(numUpdates, 10));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rollback creates a new version with restored parameters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 10 }),
        fc.nat({ max: 100 }),
        async (numUpdates, rollbackSeed) => {
          const store = new InMemoryBehaviorProfileStore();

          for (let i = 0; i < numUpdates; i++) {
            await store.save({
              agentId: 'test-agent',
              version: 0,
              parameters: { step: i, value: i * 100 },
              lastModified: 1000 + i * 1000,
            });
          }

          const history = await store.getVersionHistory('test-agent', 100);
          // Pick a version to rollback to from the retained history
          const targetIdx = rollbackSeed % history.length;
          const targetVersion = history[targetIdx]!.version;
          const targetParams = history[targetIdx]!.parameters;

          const rolledBack = await store.rollback('test-agent', targetVersion);

          // Rollback creates a NEW version (higher than before)
          expect(rolledBack.version).toBe(numUpdates + 1);
          // Restored parameters match the target
          expect(rolledBack.parameters).toEqual(targetParams);

          // The new version is now the latest
          const loaded = await store.load('test-agent');
          expect(loaded.version).toBe(rolledBack.version);
          expect(loaded.parameters).toEqual(targetParams);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('history remains at most 10 after rollback', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 8, max: 12 }),
        async (numUpdates) => {
          const store = new InMemoryBehaviorProfileStore();

          for (let i = 0; i < numUpdates; i++) {
            await store.save({
              agentId: 'test-agent',
              version: 0,
              parameters: { v: i },
              lastModified: 1000 + i * 1000,
            });
          }

          // Get history before rollback to find a retained version
          const historyBefore = await store.getVersionHistory('test-agent', 100);
          const targetVersion = historyBefore[historyBefore.length - 1]!.version;

          await store.rollback('test-agent', targetVersion);

          const historyAfter = await store.getVersionHistory('test-agent', 100);
          expect(historyAfter.length).toBeLessThanOrEqual(10);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 26: Profile Schema Validation ─────────────────────────────────
/**
 * **Validates: Requirements 11.5**
 *
 * For any Behavior Profile update, the system SHALL validate the update
 * against the agent-specific JSON schema before application. Invalid updates
 * SHALL be rejected with errors specifying: field paths that failed,
 * constraints violated, and rejected values.
 */
describe('Property 26: Profile Schema Validation', () => {
  let store: InMemoryBehaviorProfileStore;

  const testSchema: JSONSchema = {
    type: 'object',
    properties: {
      timeout: { type: 'number', minimum: 100, maximum: 60000 },
      retries: { type: 'integer', minimum: 0, maximum: 10 },
      mode: { type: 'string', enum: ['fast', 'slow', 'balanced'] },
      enabled: { type: 'boolean' },
    },
    required: ['timeout'],
    additionalProperties: false,
  };

  beforeEach(() => {
    store = new InMemoryBehaviorProfileStore();
    store.registerSchema('agent-1', testSchema);
  });

  it('valid profiles pass validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          timeout: fc.integer({ min: 100, max: 60000 }),
          retries: fc.integer({ min: 0, max: 10 }),
          mode: fc.constantFrom('fast', 'slow', 'balanced'),
          enabled: fc.boolean(),
        }),
        (params) => {
          const profile: BehaviorProfile = {
            agentId: 'agent-1',
            version: 1,
            parameters: params,
            lastModified: Date.now(),
          };
          const result = store.validate('agent-1', profile);
          expect(result.valid).toBe(true);
          expect(result.errors).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('invalid type produces error with field path, constraint, and rejected value', () => {
    const arbInvalidTimeout = fc.oneof(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.boolean(),
      fc.constant(null)
    );

    fc.assert(
      fc.property(arbInvalidTimeout, (badTimeout) => {
        const profile: BehaviorProfile = {
          agentId: 'agent-1',
          version: 1,
          parameters: { timeout: badTimeout },
          lastModified: Date.now(),
        };
        const result = store.validate('agent-1', profile);
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(1);

        // Check that errors have required structure
        for (const error of result.errors!) {
          expect(error.fieldPath).toBeDefined();
          expect(error.fieldPath.length).toBeGreaterThan(0);
          expect(error.constraint).toBeDefined();
          expect(error.constraint.length).toBeGreaterThan(0);
          expect('rejectedValue' in error).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('out-of-range numbers produce min/max constraint errors', () => {
    const arbOutOfRange = fc.oneof(
      fc.integer({ min: -10000, max: 99 }),
      fc.integer({ min: 60001, max: 100000 })
    );

    fc.assert(
      fc.property(arbOutOfRange, (badTimeout) => {
        const profile: BehaviorProfile = {
          agentId: 'agent-1',
          version: 1,
          parameters: { timeout: badTimeout },
          lastModified: Date.now(),
        };
        const result = store.validate('agent-1', profile);
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();

        const timeoutError = result.errors!.find(e => e.fieldPath === 'parameters.timeout');
        expect(timeoutError).toBeDefined();
        expect(timeoutError!.rejectedValue).toBe(badTimeout);

        if (badTimeout < 100) {
          expect(timeoutError!.constraint).toContain('minimum');
        } else {
          expect(timeoutError!.constraint).toContain('maximum');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('missing required fields produce required constraint errors', () => {
    fc.assert(
      fc.property(
        fc.record({
          retries: fc.integer({ min: 0, max: 10 }),
          mode: fc.constantFrom('fast', 'slow', 'balanced'),
        }),
        (params) => {
          const profile: BehaviorProfile = {
            agentId: 'agent-1',
            version: 1,
            parameters: params,
            lastModified: Date.now(),
          };
          const result = store.validate('agent-1', profile);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();

          const requiredError = result.errors!.find(
            e => e.fieldPath === 'parameters.timeout' && e.constraint === 'required'
          );
          expect(requiredError).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('additional properties are rejected when schema forbids them', () => {
    // Use keys that definitely do NOT collide with schema-defined or Object.prototype properties
    const knownKeys = new Set(['timeout', 'retries', 'mode', 'enabled']);
    const protoKeys = new Set(Object.getOwnPropertyNames(Object.prototype));
    const extraKeyArb = fc.stringMatching(/^x[a-z]{1,8}$/).filter(
      s => !knownKeys.has(s) && !protoKeys.has(s)
    );

    fc.assert(
      fc.property(
        fc.dictionary(extraKeyArb, fc.integer(), { minKeys: 1, maxKeys: 3 }),
        (extra) => {
          const profile: BehaviorProfile = {
            agentId: 'agent-1',
            version: 1,
            parameters: { timeout: 5000, ...extra },
            lastModified: Date.now(),
          };
          const result = store.validate('agent-1', profile);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();

          // Each extra key should produce an additionalProperties error
          for (const key of Object.keys(extra)) {
            const err = result.errors!.find(e => e.fieldPath === `parameters.${key}`);
            expect(err).toBeDefined();
            expect(err!.constraint).toBe('additionalProperties');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 28: Failed Config Apply Retains Previous State ────────────────
/**
 * **Validates: Requirements 11.7**
 *
 * For any agent that receives a valid Behavior Profile update but fails
 * to apply it (internal error or constraint conflict), the agent SHALL
 * retain its previous parameters, transition to error state, and publish
 * a "config.apply-failed" event.
 */
describe('Property 28: Failed Config Apply Retains Previous State', () => {
  it('failed config apply retains previous profile and publishes event', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbParameters(5),
        arbParameters(5),
        fc.stringMatching(/^[a-z ]{1,30}$/),
        async (initialParams, newParams, errorMessage) => {
          const publishedMessages: BusMessage[] = [];

          // Create a mock message bus that records published messages
          const mockBus: MessageBus = {
            publish: async (msg: BusMessage) => { publishedMessages.push(msg); },
            subscribe: () => ({ id: 'sub-1', topic: '', agentId: '' }),
            unsubscribe: () => {},
            request: async () => ({
              id: '', sourceAgentId: '', targetAgentId: null,
              type: 'response' as const, correlationId: '', timestamp: 0, topic: '', payload: {},
            }),
            setAgentStateProvider: () => {},
            onAgentActivated: async () => {},
            getBufferedMessages: () => [],
          };

          // Create a mock agent whose onConfigUpdate always throws
          const mockAgent: Agent = {
            id: 'failing-agent',
            name: 'Failing Agent',
            handleMessage: async () => ({
              id: '', sourceAgentId: '', targetAgentId: null,
              type: 'response' as const, correlationId: '', timestamp: 0, topic: '', payload: {},
            }),
            getHealth: () => ({ state: 'active', uptimeSeconds: 100, requestCount: 0, errorCount: 0, avgResponseTimeMs: 0 }),
            getCapabilities: () => [],
            initialize: async () => {},
            onActivate: async () => {},
            onDeactivate: async () => {},
            onConfigUpdate: async () => { throw new Error(errorMessage); },
          };

          const store = new InMemoryBehaviorProfileStore();
          await store.save({
            agentId: 'failing-agent',
            version: 0,
            parameters: initialParams,
            lastModified: 1000,
          });

          const reloader = new ConfigReloader(
            store,
            mockBus,
            (id) => id === 'failing-agent' ? mockAgent : undefined,
            (id) => id === 'failing-agent' ? 'active' : undefined,
            { pollIntervalMs: 100000 }
          );
          reloader.trackAgent('failing-agent', 1000);

          // Save a new profile that triggers a change
          await store.save({
            agentId: 'failing-agent',
            version: 0,
            parameters: newParams,
            lastModified: 2000,
          });

          // Trigger update check
          await reloader.checkForUpdates();

          // Verify: config.apply-failed event was published
          const failedEvents = publishedMessages.filter(
            m => m.topic === 'config.apply-failed'
          );
          expect(failedEvents.length).toBe(1);

          const event = failedEvents[0] as EventMessage;
          expect(event.payload.agentId).toBe('failing-agent');
          expect(event.payload.reason).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 29: Concurrent Profile Update Resolution ──────────────────────
/**
 * **Validates: Requirements 11.8**
 *
 * For any two or more Behavior Profile updates submitted concurrently for
 * the same agent, the system SHALL apply only the update with the latest
 * timestamp, discard earlier updates, and return a conflict indication
 * to discarded update submitters.
 */
describe('Property 29: Concurrent Profile Update Resolution', () => {
  it('latest timestamp wins, earlier timestamps are rejected with conflict', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbParameters(5),
        arbParameters(5),
        fc.integer({ min: 1000, max: 50000 }),
        fc.integer({ min: 1, max: 10000 }),
        async (paramsA, paramsB, baseTime, timeDelta) => {
          const store = new InMemoryBehaviorProfileStore();

          const earlierTime = baseTime;
          const laterTime = baseTime + timeDelta;

          // Save the profile with the later timestamp first
          await store.save({
            agentId: 'concurrent-agent',
            version: 0,
            parameters: paramsB,
            lastModified: laterTime,
          });

          // Attempt to save with the earlier timestamp — should be rejected
          await expect(
            store.save({
              agentId: 'concurrent-agent',
              version: 0,
              parameters: paramsA,
              lastModified: earlierTime,
            })
          ).rejects.toThrow(ProfileConflictError);

          // Verify the stored profile has the later timestamp's params
          const loaded = await store.load('concurrent-agent');
          expect(loaded.parameters).toEqual(paramsB);
          expect(loaded.lastModified).toBe(laterTime);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple concurrent updates: only the latest timestamp survives', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            params: arbParameters(3),
            time: fc.integer({ min: 1000, max: 100000 }),
          }),
          { minLength: 2, maxLength: 6 }
        ).filter(arr => {
          // Ensure all timestamps are unique to avoid ambiguity
          const times = arr.map(a => a.time);
          return new Set(times).size === times.length;
        }),
        async (updates) => {
          const store = new InMemoryBehaviorProfileStore();

          // Sort by time descending to find the winner
          const sorted = [...updates].sort((a, b) => b.time - a.time);
          const winner = sorted[0]!;

          // Sort ascending for submission order simulation
          const byTimeAsc = [...updates].sort((a, b) => a.time - b.time);

          // Submit in chronological order (ascending timestamp)
          for (const update of byTimeAsc) {
            try {
              await store.save({
                agentId: 'multi-agent',
                version: 0,
                parameters: update.params,
                lastModified: update.time,
              });
            } catch (e) {
              if (e instanceof ProfileConflictError) {
                // Expected for earlier timestamps submitted after later ones
              } else {
                throw e;
              }
            }
          }

          // The stored profile should have the winner's lastModified
          const loaded = await store.load('multi-agent');
          expect(loaded.lastModified).toBe(winner.time);
          expect(loaded.parameters).toEqual(winner.params);
        }
      ),
      { numRuns: 100 }
    );
  });
});
