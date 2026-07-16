import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistryImpl, RegistrationError, InvalidTransitionError, DependencyUnsatisfiedError } from '../agent-registry.js';
import type { Agent, AgentCapability, AgentHealth, AgentLifecycleState } from '../../types/agent.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../../types/messages.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { JSONSchema, LevelGate } from '../../types/registry.js';

/**
 * Creates a mock Agent with all required methods.
 */
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent-1',
    name: 'Test Agent',
    handleMessage: vi.fn<(message: BusMessage) => Promise<ResponseMessage | ErrorMessage>>().mockResolvedValue({
      id: 'resp-1',
      sourceAgentId: 'test-agent-1',
      targetAgentId: null,
      type: 'response',
      correlationId: 'corr-1',
      timestamp: Date.now(),
      topic: 'test',
      payload: {},
    }),
    getHealth: vi.fn<() => AgentHealth>().mockReturnValue({
      state: 'idle',
      uptimeSeconds: 0,
      requestCount: 0,
      errorCount: 0,
      avgResponseTimeMs: 0,
    }),
    getCapabilities: vi.fn<() => AgentCapability[]>().mockReturnValue([
      { topic: 'scoring.compute-grade', description: 'Compute credit grade' },
    ]),
    initialize: vi.fn<(profile: BehaviorProfile) => Promise<void>>().mockResolvedValue(undefined),
    onActivate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onDeactivate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onConfigUpdate: vi.fn<(profile: BehaviorProfile) => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createDefaultProfile(agentId = 'test-agent-1'): BehaviorProfile {
  return {
    agentId,
    version: 1,
    parameters: {},
    lastModified: Date.now(),
  };
}

function createMockMessageBus(): MessageBus {
  return {
    publish: vi.fn<(message: BusMessage) => Promise<void>>().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockResolvedValue({
      id: 'resp-1',
      sourceAgentId: 'bus',
      targetAgentId: null,
      type: 'response',
      correlationId: 'corr-1',
      timestamp: Date.now(),
      topic: 'test',
      payload: {},
    }),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn<(agentId: string) => Promise<void>>().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
}

const defaultSchema: JSONSchema = { type: 'object' };

describe('AgentRegistryImpl', () => {
  let registry: AgentRegistryImpl;
  let messageBus: MessageBus;

  beforeEach(() => {
    messageBus = createMockMessageBus();
    registry = new AgentRegistryImpl(messageBus);
  });

  describe('register()', () => {
    it('should register a valid agent and store it in the catalog', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      expect(registry.getAgent('test-agent-1')).toBe(agent);
    });

    it('should set initial state to idle on registration', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      expect(registry.getAgentState('test-agent-1')).toBe('idle');
    });

    it('should emit a state-change event on successful registration', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      expect(messageBus.publish).toHaveBeenCalledTimes(1);
      const publishedMessage = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BusMessage;
      expect(publishedMessage.topic).toBe('registry.state-change');
      expect(publishedMessage.type).toBe('event');
      expect((publishedMessage.payload as Record<string, unknown>).agentId).toBe('test-agent-1');
      expect((publishedMessage.payload as Record<string, unknown>).previousState).toBeNull();
      expect((publishedMessage.payload as Record<string, unknown>).newState).toBe('idle');
    });

    it('should reject registration when handleMessage is missing', async () => {
      const agent = createMockAgent();
      // Remove required method
      (agent as Record<string, unknown>).handleMessage = undefined;

      await expect(
        registry.register(agent, createDefaultProfile(), defaultSchema)
      ).rejects.toThrow(RegistrationError);

      await expect(
        registry.register(agent, createDefaultProfile(), defaultSchema)
      ).rejects.toThrow('handleMessage');
    });

    it('should reject registration when getHealth is missing', async () => {
      const agent = createMockAgent();
      (agent as Record<string, unknown>).getHealth = 'not-a-function';

      await expect(
        registry.register(agent, createDefaultProfile(), defaultSchema)
      ).rejects.toThrow(RegistrationError);
    });

    it('should reject registration when getCapabilities is missing', async () => {
      const agent = createMockAgent();
      (agent as Record<string, unknown>).getCapabilities = undefined;

      await expect(
        registry.register(agent, createDefaultProfile(), defaultSchema)
      ).rejects.toThrow(RegistrationError);
    });

    it('should reject registration when initialize is missing', async () => {
      const agent = createMockAgent();
      (agent as Record<string, unknown>).initialize = undefined;

      await expect(
        registry.register(agent, createDefaultProfile(), defaultSchema)
      ).rejects.toThrow(RegistrationError);
    });

    it('should list all missing methods in the RegistrationError', async () => {
      const agent = {
        id: 'bad-agent',
        name: 'Bad Agent',
        onActivate: vi.fn(),
        onDeactivate: vi.fn(),
        onConfigUpdate: vi.fn(),
      };

      try {
        await registry.register(agent as unknown as Agent, createDefaultProfile(), defaultSchema);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RegistrationError);
        const regErr = err as RegistrationError;
        expect(regErr.missingMethods).toContain('handleMessage');
        expect(regErr.missingMethods).toContain('getHealth');
        expect(regErr.missingMethods).toContain('getCapabilities');
        expect(regErr.missingMethods).toContain('initialize');
        expect(regErr.missingMethods).toHaveLength(4);
      }
    });

    it('should not emit an event when registration fails', async () => {
      const agent = createMockAgent();
      (agent as Record<string, unknown>).handleMessage = undefined;

      await expect(
        registry.register(agent, createDefaultProfile(), defaultSchema)
      ).rejects.toThrow();

      expect(messageBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('unregister()', () => {
    it('should remove the agent from the catalog', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.unregister('test-agent-1');

      expect(registry.getAgent('test-agent-1')).toBeUndefined();
    });

    it('should emit a state-change event with disabled state', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      await registry.unregister('test-agent-1');

      expect(messageBus.publish).toHaveBeenCalledTimes(1);
      const publishedMessage = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BusMessage;
      expect(publishedMessage.topic).toBe('registry.state-change');
      expect((publishedMessage.payload as Record<string, unknown>).agentId).toBe('test-agent-1');
      expect((publishedMessage.payload as Record<string, unknown>).previousState).toBe('idle');
      expect((publishedMessage.payload as Record<string, unknown>).newState).toBe('disabled');
    });

    it('should do nothing when unregistering a non-existent agent', async () => {
      await registry.unregister('non-existent');
      expect(messageBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('getAgent()', () => {
    it('should return the agent if registered', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      expect(registry.getAgent('test-agent-1')).toBe(agent);
    });

    it('should return undefined for unregistered agents', () => {
      expect(registry.getAgent('unknown')).toBeUndefined();
    });
  });

  describe('getAgentState()', () => {
    it('should return the current lifecycle state', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      expect(registry.getAgentState('test-agent-1')).toBe('idle');
    });

    it('should return undefined for non-existent agents', () => {
      expect(registry.getAgentState('unknown')).toBeUndefined();
    });
  });

  describe('queryAgents()', () => {
    it('should return all agents when filter is empty', async () => {
      const agent1 = createMockAgent({ id: 'agent-1', name: 'Agent 1' });
      const agent2 = createMockAgent({ id: 'agent-2', name: 'Agent 2' });
      await registry.register(agent1, createDefaultProfile('agent-1'), defaultSchema);
      await registry.register(agent2, createDefaultProfile('agent-2'), defaultSchema);

      const results = registry.queryAgents({});
      expect(results).toHaveLength(2);
    });

    it('should filter by state', async () => {
      const agent1 = createMockAgent({ id: 'agent-1', name: 'Agent 1' });
      const agent2 = createMockAgent({ id: 'agent-2', name: 'Agent 2' });
      await registry.register(agent1, createDefaultProfile('agent-1'), defaultSchema);
      await registry.register(agent2, createDefaultProfile('agent-2'), defaultSchema);

      // Transition agent-1 to active
      await registry.transitionState('agent-1', 'active');

      const results = registry.queryAgents({ state: 'active' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('agent-1');
    });

    it('should filter by capability topic', async () => {
      const agent1 = createMockAgent({
        id: 'agent-1',
        name: 'Scoring Agent',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade' },
        ]),
      });
      const agent2 = createMockAgent({
        id: 'agent-2',
        name: 'Wallet Agent',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'wallet.validate-session', description: 'Validate session' },
        ]),
      });
      await registry.register(agent1, createDefaultProfile('agent-1'), defaultSchema);
      await registry.register(agent2, createDefaultProfile('agent-2'), defaultSchema);

      const results = registry.queryAgents({ capability: 'scoring.compute-grade' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('agent-1');
    });

    it('should filter by level gate', async () => {
      const agent1 = createMockAgent({ id: 'agent-1', name: 'Agent 1' });
      await registry.register(agent1, createDefaultProfile('agent-1'), defaultSchema);

      // Level gate is 1 by default; filter for level 2 should exclude agents
      const results = registry.queryAgents({ level: 2 });
      expect(results).toHaveLength(0);

      // Raise the level gate
      await registry.setLevelGate(3);
      const results2 = registry.queryAgents({ level: 2 });
      expect(results2).toHaveLength(1);
    });

    it('should return empty array when no agents match', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      const results = registry.queryAgents({ state: 'error' });
      expect(results).toHaveLength(0);
    });

    it('should apply all filter criteria (AND logic)', async () => {
      const agent1 = createMockAgent({
        id: 'agent-1',
        name: 'Agent 1',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade' },
        ]),
      });
      const agent2 = createMockAgent({
        id: 'agent-2',
        name: 'Agent 2',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade' },
        ]),
      });
      await registry.register(agent1, createDefaultProfile('agent-1'), defaultSchema);
      await registry.register(agent2, createDefaultProfile('agent-2'), defaultSchema);

      // Transition agent-1 to active
      await registry.transitionState('agent-1', 'active');

      // Filter by state=active AND capability=scoring.compute-grade
      const results = registry.queryAgents({
        state: 'active',
        capability: 'scoring.compute-grade',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('agent-1');
    });
  });

  describe('transitionState()', () => {
    it('should transition from idle to active', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'active');

      expect(registry.getAgentState('test-agent-1')).toBe('active');
    });

    it('should transition from active to idle', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'active');
      await registry.transitionState('test-agent-1', 'idle');

      expect(registry.getAgentState('test-agent-1')).toBe('idle');
    });

    it('should transition from active to error', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'active');
      await registry.transitionState('test-agent-1', 'error');

      expect(registry.getAgentState('test-agent-1')).toBe('error');
    });

    it('should transition from error to idle', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'active');
      await registry.transitionState('test-agent-1', 'error');
      await registry.transitionState('test-agent-1', 'idle');

      expect(registry.getAgentState('test-agent-1')).toBe('idle');
    });

    it('should transition from idle to disabled', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'disabled');

      expect(registry.getAgentState('test-agent-1')).toBe('disabled');
    });

    it('should transition from disabled to idle', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'disabled');
      await registry.transitionState('test-agent-1', 'idle');

      expect(registry.getAgentState('test-agent-1')).toBe('idle');
    });

    it('should transition from error to disabled', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'active');
      await registry.transitionState('test-agent-1', 'error');
      await registry.transitionState('test-agent-1', 'disabled');

      expect(registry.getAgentState('test-agent-1')).toBe('disabled');
    });

    it('should reject invalid transition from disabled to active', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'disabled');

      await expect(
        registry.transitionState('test-agent-1', 'active')
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('should reject invalid transition from disabled to error', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      await registry.transitionState('test-agent-1', 'disabled');

      await expect(
        registry.transitionState('test-agent-1', 'error')
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('should reject invalid transition from idle to error', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);

      await expect(
        registry.transitionState('test-agent-1', 'error')
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('should emit a state-change event on valid transitions', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      await registry.transitionState('test-agent-1', 'active');

      expect(messageBus.publish).toHaveBeenCalledTimes(1);
      const publishedMessage = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BusMessage;
      expect(publishedMessage.topic).toBe('registry.state-change');
      expect((publishedMessage.payload as Record<string, unknown>).agentId).toBe('test-agent-1');
      expect((publishedMessage.payload as Record<string, unknown>).previousState).toBe('idle');
      expect((publishedMessage.payload as Record<string, unknown>).newState).toBe('active');
      expect((publishedMessage.payload as Record<string, unknown>).timestamp).toBeTypeOf('number');
    });

    it('should do nothing for non-existent agents', async () => {
      await registry.transitionState('non-existent', 'active');
      expect(messageBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile()', () => {
    it('should update the profile ref and emit a state-change event', async () => {
      const agent = createMockAgent();
      await registry.register(agent, createDefaultProfile(), defaultSchema);
      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      const newProfile: BehaviorProfile = {
        agentId: 'updated-profile-ref',
        version: 2,
        parameters: { temperature: 0 },
        lastModified: Date.now(),
      };

      await registry.updateProfile('test-agent-1', newProfile);

      expect(messageBus.publish).toHaveBeenCalledTimes(1);
      const publishedMessage = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BusMessage;
      expect(publishedMessage.topic).toBe('registry.state-change');
    });

    it('should do nothing for non-existent agents', async () => {
      const newProfile: BehaviorProfile = {
        agentId: 'some-profile',
        version: 1,
        parameters: {},
        lastModified: Date.now(),
      };

      await registry.updateProfile('non-existent', newProfile);
      expect(messageBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('setLevelGate() / getLevelGate()', () => {
    it('should default to level 1', () => {
      expect(registry.getLevelGate()).toBe(1);
    });

    it('should update the level gate', async () => {
      await registry.setLevelGate(4);
      expect(registry.getLevelGate()).toBe(4);
    });

    it('should activate agents when level is raised (disabled → idle)', async () => {
      // Register an orchestrator agent and disable it (simulating level 1)
      const orchestrator = createMockAgent({ id: 'orchestrator-agent', name: 'Orchestrator' });
      await registry.register(orchestrator, createDefaultProfile('orchestrator-agent'), defaultSchema);

      // At level 1, orchestrator should not be allowed — manually disable
      await registry.transitionState('orchestrator-agent', 'disabled');
      expect(registry.getAgentState('orchestrator-agent')).toBe('disabled');

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      // Raise to level 2 where orchestrator-agent is allowed
      await registry.setLevelGate(2);

      expect(registry.getAgentState('orchestrator-agent')).toBe('idle');
      // Should have emitted a state-change event
      const calls = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const stateChangeEvent = calls.find(
        (c: [BusMessage]) => (c[0].payload as Record<string, unknown>).agentId === 'orchestrator-agent'
      );
      expect(stateChangeEvent).toBeDefined();
      expect((stateChangeEvent![0].payload as Record<string, unknown>).previousState).toBe('disabled');
      expect((stateChangeEvent![0].payload as Record<string, unknown>).newState).toBe('idle');
    });

    it('should deactivate agents when level is lowered (idle → disabled)', async () => {
      // Set up at level 3 first
      await registry.setLevelGate(3);

      const signalAgent = createMockAgent({ id: 'signal-agent', name: 'Signal Agent' });
      await registry.register(signalAgent, createDefaultProfile('signal-agent'), defaultSchema);
      expect(registry.getAgentState('signal-agent')).toBe('idle');

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      // Lower to level 2 where signal-agent is NOT allowed
      await registry.setLevelGate(2);

      expect(registry.getAgentState('signal-agent')).toBe('disabled');
      const calls = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const stateChangeEvent = calls.find(
        (c: [BusMessage]) => (c[0].payload as Record<string, unknown>).agentId === 'signal-agent'
      );
      expect(stateChangeEvent).toBeDefined();
      expect((stateChangeEvent![0].payload as Record<string, unknown>).previousState).toBe('idle');
      expect((stateChangeEvent![0].payload as Record<string, unknown>).newState).toBe('disabled');
    });

    it('should deactivate active agents when level is lowered (active → disabled)', async () => {
      await registry.setLevelGate(3);

      const cacheAgent = createMockAgent({ id: 'cache-agent', name: 'Cache Agent' });
      await registry.register(cacheAgent, createDefaultProfile('cache-agent'), defaultSchema);
      await registry.transitionState('cache-agent', 'active');
      expect(registry.getAgentState('cache-agent')).toBe('active');

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      // Lower to level 2 where cache-agent is NOT allowed
      await registry.setLevelGate(2);

      expect(registry.getAgentState('cache-agent')).toBe('disabled');
    });

    it('should not affect agents already in the correct state', async () => {
      const wallet = createMockAgent({ id: 'wallet-agent', name: 'Wallet Agent' });
      await registry.register(wallet, createDefaultProfile('wallet-agent'), defaultSchema);

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      // wallet-agent is allowed at both level 1 and 2, no state change expected
      await registry.setLevelGate(2);

      // Check that no state-change event was emitted for wallet-agent
      const calls = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const walletEvents = calls.filter(
        (c: [BusMessage]) => (c[0].payload as Record<string, unknown>).agentId === 'wallet-agent'
      );
      expect(walletEvents).toHaveLength(0);
    });
  });

  describe('getActiveAgentsForLevel()', () => {
    it('should return wallet-agent and credential-agent for level 1', () => {
      const agents = registry.getActiveAgentsForLevel(1);
      expect(agents).toContain('wallet-agent');
      expect(agents).toContain('credential-agent');
      expect(agents).toHaveLength(2);
    });

    it('should return level 1 agents plus orchestrator and scoring for level 2', () => {
      const agents = registry.getActiveAgentsForLevel(2);
      expect(agents).toContain('wallet-agent');
      expect(agents).toContain('credential-agent');
      expect(agents).toContain('orchestrator-agent');
      expect(agents).toContain('scoring-agent');
      expect(agents).toHaveLength(4);
    });

    it('should return level 2 agents plus signal, cache, monitor for level 3', () => {
      const agents = registry.getActiveAgentsForLevel(3);
      expect(agents).toContain('signal-agent');
      expect(agents).toContain('cache-agent');
      expect(agents).toContain('monitor-agent');
      expect(agents).toHaveLength(7);
    });

    it('should return all agents including verification for level 4+', () => {
      const agents4 = registry.getActiveAgentsForLevel(4);
      expect(agents4).toContain('verification-agent');
      expect(agents4).toHaveLength(8);

      const agents5 = registry.getActiveAgentsForLevel(5);
      expect(agents5).toHaveLength(8);

      const agents6 = registry.getActiveAgentsForLevel(6);
      expect(agents6).toHaveLength(8);
    });
  });

  describe('Dependency verification', () => {
    it('should allow activation when all dependencies are satisfied', async () => {
      // Register a provider agent with a capability
      const provider = createMockAgent({
        id: 'provider-agent',
        name: 'Provider',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'signals.read', description: 'Read signals' },
        ]),
      });
      await registry.register(provider, createDefaultProfile('provider-agent'), defaultSchema);

      // Register a dependent agent
      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['signals.read'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);

      // Should succeed because provider is in idle state (satisfies dependency)
      await expect(
        registry.transitionState('dependent-agent', 'active')
      ).resolves.not.toThrow();

      expect(registry.getAgentState('dependent-agent')).toBe('active');
    });

    it('should reject activation when dependencies are not satisfied', async () => {
      // Register a dependent agent with no provider available
      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['signals.read'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);

      await expect(
        registry.transitionState('dependent-agent', 'active')
      ).rejects.toThrow(DependencyUnsatisfiedError);
    });

    it('should reject activation when provider is in disabled state', async () => {
      const provider = createMockAgent({
        id: 'provider-agent',
        name: 'Provider',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'signals.read', description: 'Read signals' },
        ]),
      });
      await registry.register(provider, createDefaultProfile('provider-agent'), defaultSchema);
      await registry.transitionState('provider-agent', 'disabled');

      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['signals.read'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);

      await expect(
        registry.transitionState('dependent-agent', 'active')
      ).rejects.toThrow(DependencyUnsatisfiedError);
    });

    it('should allow activation when agent has no dependencies', async () => {
      const agent = createMockAgent({
        id: 'no-deps-agent',
        name: 'No Dependencies',
        dependencies: undefined,
      });
      await registry.register(agent, createDefaultProfile('no-deps-agent'), defaultSchema);

      await expect(
        registry.transitionState('no-deps-agent', 'active')
      ).resolves.not.toThrow();
    });

    it('should allow activation when agent has empty dependencies array', async () => {
      const agent = createMockAgent({
        id: 'empty-deps-agent',
        name: 'Empty Dependencies',
        dependencies: [],
      });
      await registry.register(agent, createDefaultProfile('empty-deps-agent'), defaultSchema);

      await expect(
        registry.transitionState('empty-deps-agent', 'active')
      ).resolves.not.toThrow();
    });

    it('should list all unsatisfied dependencies in the error', async () => {
      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['signals.read', 'scoring.compute-grade', 'cache.check'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);

      try {
        await registry.transitionState('dependent-agent', 'active');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DependencyUnsatisfiedError);
        const depErr = err as DependencyUnsatisfiedError;
        expect(depErr.missingCapabilities).toContain('signals.read');
        expect(depErr.missingCapabilities).toContain('scoring.compute-grade');
        expect(depErr.missingCapabilities).toContain('cache.check');
        expect(depErr.missingCapabilities).toHaveLength(3);
      }
    });
  });

  describe('Dependency loss handling', () => {
    it('should transition dependent agent to idle when dependency provider goes to error', async () => {
      const provider = createMockAgent({
        id: 'provider-agent',
        name: 'Provider',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'signals.read', description: 'Read signals' },
        ]),
      });
      await registry.register(provider, createDefaultProfile('provider-agent'), defaultSchema);
      await registry.transitionState('provider-agent', 'active');

      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['signals.read'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);
      await registry.transitionState('dependent-agent', 'active');

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      // Provider goes to error
      await registry.transitionState('provider-agent', 'error');

      expect(registry.getAgentState('dependent-agent')).toBe('idle');

      // Should have emitted a dependency-unavailable event
      const calls = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const depEvent = calls.find(
        (c: [BusMessage]) => c[0].topic === 'alert.dependency-unavailable'
      );
      expect(depEvent).toBeDefined();
      expect((depEvent![0].payload as Record<string, unknown>).dependentAgentId).toBe('dependent-agent');
      expect((depEvent![0].payload as Record<string, unknown>).capability).toBe('signals.read');
    });

    it('should transition dependent agent to idle when dependency provider is unregistered', async () => {
      const provider = createMockAgent({
        id: 'provider-agent',
        name: 'Provider',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'wallet.validate-session', description: 'Validate session' },
        ]),
      });
      await registry.register(provider, createDefaultProfile('provider-agent'), defaultSchema);
      await registry.transitionState('provider-agent', 'active');

      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['wallet.validate-session'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);
      await registry.transitionState('dependent-agent', 'active');

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      await registry.unregister('provider-agent');

      expect(registry.getAgentState('dependent-agent')).toBe('idle');
    });

    it('should not transition dependent agent if another provider still satisfies the dependency', async () => {
      const provider1 = createMockAgent({
        id: 'provider-1',
        name: 'Provider 1',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'signals.read', description: 'Read signals' },
        ]),
      });
      const provider2 = createMockAgent({
        id: 'provider-2',
        name: 'Provider 2',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'signals.read', description: 'Read signals alt' },
        ]),
      });
      await registry.register(provider1, createDefaultProfile('provider-1'), defaultSchema);
      await registry.register(provider2, createDefaultProfile('provider-2'), defaultSchema);
      await registry.transitionState('provider-1', 'active');

      const dependent = createMockAgent({
        id: 'dependent-agent',
        name: 'Dependent',
        dependencies: ['signals.read'],
      });
      await registry.register(dependent, createDefaultProfile('dependent-agent'), defaultSchema);
      await registry.transitionState('dependent-agent', 'active');

      // Provider 1 goes to error, but provider 2 is still in idle (satisfies)
      await registry.transitionState('provider-1', 'error');

      // Dependent should remain active
      expect(registry.getAgentState('dependent-agent')).toBe('active');
    });

    it('should transition dependent to idle when level gate disables provider', async () => {
      await registry.setLevelGate(3);

      const signalAgent = createMockAgent({
        id: 'signal-agent',
        name: 'Signal Agent',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'signals.read', description: 'Read signals' },
        ]),
      });
      await registry.register(signalAgent, createDefaultProfile('signal-agent'), defaultSchema);
      await registry.transitionState('signal-agent', 'active');

      const dependent = createMockAgent({
        id: 'scoring-agent',
        name: 'Scoring Agent',
        dependencies: ['signals.read'],
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade' },
        ]),
      });
      await registry.register(dependent, createDefaultProfile('scoring-agent'), defaultSchema);
      await registry.transitionState('scoring-agent', 'active');

      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      // Lower level to 2 — signal-agent is no longer allowed
      await registry.setLevelGate(2);

      expect(registry.getAgentState('signal-agent')).toBe('disabled');
      expect(registry.getAgentState('scoring-agent')).toBe('idle');
    });
  });

  describe('Capability override', () => {
    it('should emit capability-override event when registering agent with overlapping capabilities', async () => {
      const agent1 = createMockAgent({
        id: 'scoring-agent-v1',
        name: 'Scoring V1',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade v1' },
        ]),
      });
      await registry.register(agent1, createDefaultProfile('scoring-agent-v1'), defaultSchema);
      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      const agent2 = createMockAgent({
        id: 'scoring-agent-v2',
        name: 'Scoring V2',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade v2' },
        ]),
      });
      await registry.register(agent2, createDefaultProfile('scoring-agent-v2'), defaultSchema);

      // Should have emitted a capability-override event before the state-change event
      const calls = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const overrideEvent = calls.find(
        (c: [BusMessage]) => c[0].topic === 'registry.capability-override'
      );
      expect(overrideEvent).toBeDefined();
      expect((overrideEvent![0].payload as Record<string, unknown>).topic).toBe('scoring.compute-grade');
      expect((overrideEvent![0].payload as Record<string, unknown>).previousAgentId).toBe('scoring-agent-v1');
      expect((overrideEvent![0].payload as Record<string, unknown>).newAgentId).toBe('scoring-agent-v2');
    });

    it('should not emit capability-override event when no overlap exists', async () => {
      const agent1 = createMockAgent({
        id: 'agent-1',
        name: 'Agent 1',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'wallet.validate-session', description: 'Validate session' },
        ]),
      });
      await registry.register(agent1, createDefaultProfile('agent-1'), defaultSchema);
      (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

      const agent2 = createMockAgent({
        id: 'agent-2',
        name: 'Agent 2',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade' },
        ]),
      });
      await registry.register(agent2, createDefaultProfile('agent-2'), defaultSchema);

      const calls = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const overrideEvents = calls.filter(
        (c: [BusMessage]) => c[0].topic === 'registry.capability-override'
      );
      expect(overrideEvents).toHaveLength(0);
    });

    it('should route overlapping topic to the most recently registered agent', async () => {
      const agent1 = createMockAgent({
        id: 'scoring-old',
        name: 'Old Scorer',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade old' },
        ]),
      });
      const agent2 = createMockAgent({
        id: 'scoring-new',
        name: 'New Scorer',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade new' },
        ]),
      });

      await registry.register(agent1, createDefaultProfile('scoring-old'), defaultSchema);
      await registry.register(agent2, createDefaultProfile('scoring-new'), defaultSchema);

      const resolved = registry.resolveCapability('scoring.compute-grade');
      expect(resolved).toBeDefined();
      expect(resolved!.id).toBe('scoring-new');
    });

    it('should not resolve capability from disabled agents', async () => {
      const agent = createMockAgent({
        id: 'disabled-agent',
        name: 'Disabled Agent',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'scoring.compute-grade', description: 'Compute grade' },
        ]),
      });
      await registry.register(agent, createDefaultProfile('disabled-agent'), defaultSchema);
      await registry.transitionState('disabled-agent', 'disabled');

      const resolved = registry.resolveCapability('scoring.compute-grade');
      expect(resolved).toBeUndefined();
    });

    it('should resolve capability from idle agents', async () => {
      const agent = createMockAgent({
        id: 'idle-agent',
        name: 'Idle Agent',
        getCapabilities: vi.fn().mockReturnValue([
          { topic: 'cache.check', description: 'Check cache' },
        ]),
      });
      await registry.register(agent, createDefaultProfile('idle-agent'), defaultSchema);

      const resolved = registry.resolveCapability('cache.check');
      expect(resolved).toBeDefined();
      expect(resolved!.id).toBe('idle-agent');
    });
  });
});
