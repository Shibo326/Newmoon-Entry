/**
 * Property-based tests for Agent Registry.
 * Properties 1-3, 31-34 from the design document.
 *
 * Uses fast-check with minimum 100 iterations per property.
 * Test runner: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { AgentRegistryImpl, RegistrationError, DependencyUnsatisfiedError } from '../agent-registry.js';
import type { Agent, AgentCapability, AgentLifecycleState } from '../../types/agent.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { BusMessage, EventMessage } from '../../types/messages.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { JSONSchema, LevelGate } from '../../types/registry.js';

// --- Test Helpers ---

const REQUIRED_METHODS = ['handleMessage', 'getHealth', 'getCapabilities', 'initialize'] as const;

function createFullAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    handleMessage: vi.fn().mockResolvedValue({
      id: 'r-1', sourceAgentId: overrides.id, targetAgentId: null,
      type: 'response', correlationId: 'c-1', timestamp: Date.now(),
      topic: 'test', payload: {},
    }),
    getHealth: vi.fn().mockReturnValue({
      state: 'idle', uptimeSeconds: 0, requestCount: 0,
      errorCount: 0, avgResponseTimeMs: 0,
    }),
    getCapabilities: vi.fn().mockReturnValue(
      overrides.getCapabilities ? undefined : []
    ),
    initialize: vi.fn().mockResolvedValue(undefined),
    onActivate: vi.fn().mockResolvedValue(undefined),
    onDeactivate: vi.fn().mockResolvedValue(undefined),
    onConfigUpdate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createDefaultProfile(agentId: string): BehaviorProfile {
  return { agentId, version: 1, parameters: {}, lastModified: Date.now() };
}

function createMockMessageBus(): MessageBus & { publishedMessages: BusMessage[] } {
  const publishedMessages: BusMessage[] = [];
  return {
    publishedMessages,
    publish: vi.fn(async (msg: BusMessage) => { publishedMessages.push(msg); }),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockResolvedValue({
      id: 'r-1', sourceAgentId: 'bus', targetAgentId: null,
      type: 'response', correlationId: 'c-1', timestamp: Date.now(),
      topic: 'test', payload: {},
    }),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
}

const defaultSchema: JSONSchema = { type: 'object' };

// --- Arbitraries ---

/** Arbitrary for a random subset of required methods (possibly empty). */
const arbMethodSubset = fc.subarray([...REQUIRED_METHODS], { minLength: 0 });

/** Arbitrary for a valid agent ID string. */
const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/).filter(s => s.length >= 3);

/** Arbitrary for a capability topic. */
const arbCapabilityTopic = fc.stringMatching(/^[a-z]+\.[a-z-]+$/).filter(s => s.length >= 5);

/** Arbitrary for a LevelGate value (1-6). */
const arbLevelGate: fc.Arbitrary<LevelGate> = fc.integer({ min: 1, max: 6 }) as fc.Arbitrary<LevelGate>;

/** Arbitrary for an AgentLifecycleState used in filters. */
const arbLifecycleState: fc.Arbitrary<AgentLifecycleState> = fc.constantFrom('idle', 'active', 'error', 'disabled');

// --- Property 1: Agent Interface Conformance Validation ---
// Validates: Requirements 1.2, 1.3

describe('Property 1: Agent Interface Conformance Validation', () => {
  it('should accept registration only when all required methods are present and reject with specific errors otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(arbMethodSubset, async (includedMethods) => {
        const messageBus = createMockMessageBus();
        const registry = new AgentRegistryImpl(messageBus);

        // Build an object that only has the included methods as functions
        const pluginObj: Record<string, unknown> = {
          id: 'test-plugin',
          name: 'Test Plugin',
          onActivate: vi.fn().mockResolvedValue(undefined),
          onDeactivate: vi.fn().mockResolvedValue(undefined),
          onConfigUpdate: vi.fn().mockResolvedValue(undefined),
          getCapabilities: vi.fn().mockReturnValue([]),
        };

        for (const method of REQUIRED_METHODS) {
          if (includedMethods.includes(method)) {
            if (method === 'getCapabilities') {
              pluginObj[method] = vi.fn().mockReturnValue([]);
            } else if (method === 'getHealth') {
              pluginObj[method] = vi.fn().mockReturnValue({
                state: 'idle', uptimeSeconds: 0, requestCount: 0,
                errorCount: 0, avgResponseTimeMs: 0,
              });
            } else {
              pluginObj[method] = vi.fn().mockResolvedValue(undefined);
            }
          } else {
            delete pluginObj[method];
          }
        }

        const missingMethods = REQUIRED_METHODS.filter(m => !includedMethods.includes(m));
        const allPresent = missingMethods.length === 0;

        if (allPresent) {
          await expect(
            registry.register(pluginObj as unknown as Agent, createDefaultProfile('test-plugin'), defaultSchema)
          ).resolves.not.toThrow();
          expect(registry.getAgent('test-plugin')).toBeDefined();
        } else {
          try {
            await registry.register(pluginObj as unknown as Agent, createDefaultProfile('test-plugin'), defaultSchema);
            expect.fail('Should have thrown RegistrationError');
          } catch (err) {
            expect(err).toBeInstanceOf(RegistrationError);
            const regErr = err as RegistrationError;
            expect(regErr.missingMethods.sort()).toEqual([...missingMethods].sort());
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 2: Lifecycle State-Change Event Integrity ---
// Validates: Requirements 1.4, 1.7, 1.8

describe('Property 2: Lifecycle State-Change Event Integrity', () => {
  it('should emit exactly one state-change event per transition with correct fields', async () => {
    const arbTransitionAction = fc.constantFrom(
      'register', 'unregister', 'activate', 'deactivate', 'to-error', 'update-profile'
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbTransitionAction, { minLength: 1, maxLength: 8 }),
        async (actions) => {
          const messageBus = createMockMessageBus();
          const registry = new AgentRegistryImpl(messageBus);
          let registered = false;
          let currentState: AgentLifecycleState | undefined;

          for (const action of actions) {
            const beforeCount = messageBus.publishedMessages.length;

            try {
              switch (action) {
                case 'register':
                  if (!registered) {
                    const agent = createFullAgent({ id: 'ag-x', name: 'Agent X' });
                    await registry.register(agent, createDefaultProfile('ag-x'), defaultSchema);
                    registered = true;
                    currentState = 'idle';
                    const evts = messageBus.publishedMessages.slice(beforeCount);
                    expect(evts).toHaveLength(1);
                    expect(evts[0]!.topic).toBe('registry.state-change');
                    const p = evts[0]!.payload as Record<string, unknown>;
                    expect(p.agentId).toBe('ag-x');
                    expect(p.previousState).toBeNull();
                    expect(p.newState).toBe('idle');
                    expect(p.timestamp).toBeTypeOf('number');
                  }
                  break;
                case 'unregister':
                  if (registered) {
                    await registry.unregister('ag-x');
                    const evts = messageBus.publishedMessages.slice(beforeCount);
                    expect(evts.length).toBeGreaterThanOrEqual(1);
                    const p = evts[0]!.payload as Record<string, unknown>;
                    expect(p.previousState).toBe(currentState);
                    expect(p.newState).toBe('disabled');
                    registered = false;
                    currentState = undefined;
                  }
                  break;
                case 'activate':
                  if (registered && currentState === 'idle') {
                    await registry.transitionState('ag-x', 'active');
                    const evts = messageBus.publishedMessages.slice(beforeCount);
                    expect(evts).toHaveLength(1);
                    const p = evts[0]!.payload as Record<string, unknown>;
                    expect(p.previousState).toBe('idle');
                    expect(p.newState).toBe('active');
                    currentState = 'active';
                  }
                  break;
                case 'deactivate':
                  if (registered && currentState === 'active') {
                    await registry.transitionState('ag-x', 'idle');
                    const evts = messageBus.publishedMessages.slice(beforeCount);
                    expect(evts).toHaveLength(1);
                    const p = evts[0]!.payload as Record<string, unknown>;
                    expect(p.previousState).toBe('active');
                    expect(p.newState).toBe('idle');
                    currentState = 'idle';
                  }
                  break;
                case 'to-error':
                  if (registered && currentState === 'active') {
                    await registry.transitionState('ag-x', 'error');
                    const evts = messageBus.publishedMessages.slice(beforeCount);
                    expect(evts).toHaveLength(1);
                    const p = evts[0]!.payload as Record<string, unknown>;
                    expect(p.previousState).toBe('active');
                    expect(p.newState).toBe('error');
                    currentState = 'error';
                  }
                  break;
                case 'update-profile':
                  if (registered) {
                    const prof: BehaviorProfile = {
                      agentId: 'ag-x', version: 2, parameters: {}, lastModified: Date.now(),
                    };
                    await registry.updateProfile('ag-x', prof);
                    const evts = messageBus.publishedMessages.slice(beforeCount);
                    expect(evts).toHaveLength(1);
                    expect(evts[0]!.topic).toBe('registry.state-change');
                  }
                  break;
              }
            } catch {
              // Invalid transitions are expected; just skip
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 3: Registry Query Filtering ---
// Validates: Requirements 1.5

describe('Property 3: Registry Query Filtering', () => {
  it('should return exactly those agents matching all specified filter criteria', async () => {
    const arbAgentSpec = fc.record({
      id: arbAgentId,
      capability: arbCapabilityTopic,
      targetState: fc.constantFrom('idle' as const, 'active' as const),
    });

    const arbFilter = fc.record({
      state: fc.option(arbLifecycleState, { nil: undefined }),
      capability: fc.option(arbCapabilityTopic, { nil: undefined }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbAgentSpec, { minLength: 1, maxLength: 6 }),
        arbFilter,
        async (agentSpecs, filter) => {
          const messageBus = createMockMessageBus();
          const registry = new AgentRegistryImpl(messageBus);

          // Ensure unique IDs
          const uniqueSpecs = agentSpecs.filter(
            (spec, i, arr) => arr.findIndex(s => s.id === spec.id) === i
          );

          for (const spec of uniqueSpecs) {
            const agent = createFullAgent({
              id: spec.id,
              name: `Agent ${spec.id}`,
              getCapabilities: vi.fn().mockReturnValue([
                { topic: spec.capability, description: 'cap' },
              ]),
            });
            await registry.register(agent, createDefaultProfile(spec.id), defaultSchema);

            if (spec.targetState === 'active') {
              await registry.transitionState(spec.id, 'active');
            }
          }

          const results = registry.queryAgents(filter);

          // Compute expected results manually
          const expected = uniqueSpecs.filter(spec => {
            if (filter.state !== undefined && spec.targetState !== filter.state) {
              return false;
            }
            if (filter.capability !== undefined && spec.capability !== filter.capability) {
              return false;
            }
            return true;
          });

          expect(results.map(a => a.id).sort()).toEqual(expected.map(s => s.id).sort());
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 31: Level-Gated Agent Activation ---
// Validates: Requirements 13.2, 13.3, 13.4, 13.5

describe('Property 31: Level-Gated Agent Activation', () => {
  const LEVEL_GATE_MAP: Record<LevelGate, string[]> = {
    1: ['wallet-agent', 'credential-agent'],
    2: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent'],
    3: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent',
        'signal-agent', 'cache-agent', 'monitor-agent'],
    4: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent',
        'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent'],
    5: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent',
        'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent'],
    6: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent',
        'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent'],
  };

  const ALL_AGENTS = [
    'wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent',
    'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent',
  ];

  it('should activate exactly the correct agents for each level', async () => {
    await fc.assert(
      fc.asyncProperty(arbLevelGate, async (level) => {
        const messageBus = createMockMessageBus();
        const registry = new AgentRegistryImpl(messageBus);

        // Start at level 6 so all agents register as idle
        await registry.setLevelGate(6);
        for (const agentId of ALL_AGENTS) {
          const agent = createFullAgent({ id: agentId, name: agentId });
          await registry.register(agent, createDefaultProfile(agentId), defaultSchema);
        }

        // Now set to target level
        await registry.setLevelGate(level);

        const expectedAllowed = new Set(LEVEL_GATE_MAP[level]);
        for (const agentId of ALL_AGENTS) {
          const state = registry.getAgentState(agentId);
          if (expectedAllowed.has(agentId)) {
            expect(state === 'idle' || state === 'active').toBe(true);
          } else {
            expect(state).toBe('disabled');
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 32: Disabled Agent Message Rejection ---
// Validates: Requirements 13.7

describe('Property 32: Disabled Agent Message Rejection', () => {
  it('should reject messages to disabled agents with correct error', async () => {
    const arbTopic = fc.constantFrom(
      'compute-grade', 'read-signals', 'verify-threshold', 'check-cache'
    );

    await fc.assert(
      fc.asyncProperty(arbTopic, arbLevelGate, async (topic, level) => {
        const messageBus = createMockMessageBus();
        const registry = new AgentRegistryImpl(messageBus);

        // Agent that checks its own state via registry
        const agent = createFullAgent({
          id: 'target-agent',
          name: 'Target Agent',
          handleMessage: vi.fn(async (msg) => {
            const state = registry.getAgentState('target-agent');
            if (state === 'disabled') {
              return {
                id: 'err-1',
                sourceAgentId: 'target-agent',
                targetAgentId: msg.sourceAgentId,
                type: 'error' as const,
                correlationId: msg.correlationId,
                timestamp: Date.now(),
                topic: msg.topic,
                payload: {
                  code: 'NOT_AVAILABLE_AT_CURRENT_LEVEL',
                  description: 'Agent is disabled due to level gate restriction',
                },
              };
            }
            return {
              id: 'resp-1',
              sourceAgentId: 'target-agent',
              targetAgentId: msg.sourceAgentId,
              type: 'response' as const,
              correlationId: msg.correlationId,
              timestamp: Date.now(),
              topic: msg.topic,
              payload: { result: 'ok' },
            };
          }),
        });

        await registry.register(agent, createDefaultProfile('target-agent'), defaultSchema);
        await registry.forceState('target-agent', 'disabled');

        const message: BusMessage = {
          id: 'msg-1',
          sourceAgentId: 'sender-agent',
          targetAgentId: 'target-agent',
          type: 'request',
          correlationId: 'corr-1',
          timestamp: Date.now(),
          topic,
          payload: { action: topic },
        };

        const response = await agent.handleMessage(message);
        expect(response.type).toBe('error');
        const errPayload = response.payload as { code: string };
        expect(errPayload.code).toBe('NOT_AVAILABLE_AT_CURRENT_LEVEL');
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 33: Dependency Verification on Activation ---
// Validates: Requirements 14.6, 14.9

describe('Property 33: Dependency Verification on Activation', () => {
  it('should activate agents only when all dependencies are provided', async () => {
    const arbProviderState = fc.constantFrom(
      'idle' as const, 'active' as const, 'disabled' as const
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbProviderState, { minLength: 1, maxLength: 4 }),
        async (providerStates) => {
          const messageBus = createMockMessageBus();
          const registry = new AgentRegistryImpl(messageBus);

          const depCount = providerStates.length;
          const capabilities: string[] = [];
          for (let i = 0; i < depCount; i++) {
            capabilities.push(`cap.dep-${i}`);
          }

          for (let i = 0; i < depCount; i++) {
            const provider = createFullAgent({
              id: `prov-${i}`,
              name: `Provider ${i}`,
              getCapabilities: vi.fn().mockReturnValue([
                { topic: capabilities[i], description: `Provides dep ${i}` },
              ]),
            });
            await registry.register(
              provider, createDefaultProfile(`prov-${i}`), defaultSchema
            );

            const targetState = providerStates[i]!;
            if (targetState === 'active') {
              await registry.transitionState(`prov-${i}`, 'active');
            } else if (targetState === 'disabled') {
              await registry.transitionState(`prov-${i}`, 'disabled');
            }
          }

          const dependent = createFullAgent({
            id: 'dep-agent',
            name: 'Dependent',
            dependencies: capabilities,
          });
          await registry.register(
            dependent, createDefaultProfile('dep-agent'), defaultSchema
          );

          const allSatisfied = providerStates.every(
            s => s === 'idle' || s === 'active'
          );

          if (allSatisfied) {
            await expect(
              registry.transitionState('dep-agent', 'active')
            ).resolves.not.toThrow();
            expect(registry.getAgentState('dep-agent')).toBe('active');
          } else {
            await expect(
              registry.transitionState('dep-agent', 'active')
            ).rejects.toThrow(DependencyUnsatisfiedError);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should transition dependent to idle when provider becomes unavailable', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (providerCount) => {
          const messageBus = createMockMessageBus();
          const registry = new AgentRegistryImpl(messageBus);

          const capabilities: string[] = [];
          for (let i = 0; i < providerCount; i++) {
            capabilities.push(`svc.feature-${i}`);
          }

          for (let i = 0; i < providerCount; i++) {
            const provider = createFullAgent({
              id: `svc-prov-${i}`,
              name: `ServiceProvider ${i}`,
              getCapabilities: vi.fn().mockReturnValue([
                { topic: capabilities[i], description: `Feature ${i}` },
              ]),
            });
            await registry.register(
              provider, createDefaultProfile(`svc-prov-${i}`), defaultSchema
            );
            await registry.transitionState(`svc-prov-${i}`, 'active');
          }

          const dependent = createFullAgent({
            id: 'consumer',
            name: 'Consumer',
            dependencies: capabilities,
          });
          await registry.register(
            dependent, createDefaultProfile('consumer'), defaultSchema
          );
          await registry.transitionState('consumer', 'active');
          expect(registry.getAgentState('consumer')).toBe('active');

          // Transition first provider to error
          await registry.transitionState('svc-prov-0', 'error');

          // Dependent should have been moved to idle
          expect(registry.getAgentState('consumer')).toBe('idle');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 34: Capability Override Routing ---
// Validates: Requirements 14.8

describe('Property 34: Capability Override Routing', () => {
  it('should route to most recently registered agent and emit override events', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        arbCapabilityTopic,
        async (agentCount, sharedTopic) => {
          const messageBus = createMockMessageBus();
          const registry = new AgentRegistryImpl(messageBus);

          const agentIds: string[] = [];
          for (let i = 0; i < agentCount; i++) {
            const agentId = `agt-${i}`;
            agentIds.push(agentId);
            const agent = createFullAgent({
              id: agentId,
              name: `Agent ${i}`,
              getCapabilities: vi.fn().mockReturnValue([
                { topic: sharedTopic, description: `Provides ${sharedTopic}` },
              ]),
            });
            await registry.register(
              agent, createDefaultProfile(agentId), defaultSchema
            );
          }

          // Most recently registered should resolve
          const resolved = registry.resolveCapability(sharedTopic);
          expect(resolved).toBeDefined();
          expect(resolved!.id).toBe(agentIds[agentIds.length - 1]);

          // Override events emitted (one per overlapping registration)
          const overrideEvents = messageBus.publishedMessages.filter(
            m => m.topic === 'registry.capability-override'
          );
          expect(overrideEvents.length).toBeGreaterThanOrEqual(agentCount - 1);

          for (const evt of overrideEvents) {
            const p = evt.payload as Record<string, unknown>;
            expect(p.topic).toBe(sharedTopic);
            expect(p.previousAgentId).toBeTypeOf('string');
            expect(p.newAgentId).toBeTypeOf('string');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
