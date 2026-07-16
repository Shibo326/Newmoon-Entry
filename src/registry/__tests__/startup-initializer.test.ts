import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StartupInitializer } from '../startup-initializer.js';
import { AgentRegistryImpl } from '../agent-registry.js';
import { InMemoryBehaviorProfileStore } from '../../config/behavior-profile-store.js';
import { ConfigReloader } from '../../config/config-reloader.js';
import type { Agent, AgentCapability, AgentHealth } from '../../types/agent.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../../types/messages.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { JSONSchema } from '../../types/registry.js';

/**
 * Creates a mock Agent with all required methods.
 */
function createMockAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: `Agent ${id}`,
    handleMessage: vi.fn<(message: BusMessage) => Promise<ResponseMessage | ErrorMessage>>().mockResolvedValue({
      id: 'resp-1',
      sourceAgentId: id,
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
      { topic: `${id}.topic`, description: `${id} capability` },
    ]),
    initialize: vi.fn<(profile: BehaviorProfile) => Promise<void>>().mockResolvedValue(undefined),
    onActivate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onDeactivate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onConfigUpdate: vi.fn<(profile: BehaviorProfile) => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createDefaultProfile(agentId: string): BehaviorProfile {
  return {
    agentId,
    version: 1,
    parameters: { key: 'value' },
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

describe('StartupInitializer', () => {
  let registry: AgentRegistryImpl;
  let profileStore: InMemoryBehaviorProfileStore;
  let messageBus: MessageBus;
  let configReloader: ConfigReloader;
  let initializer: StartupInitializer;

  beforeEach(() => {
    messageBus = createMockMessageBus();
    registry = new AgentRegistryImpl(messageBus);
    profileStore = new InMemoryBehaviorProfileStore();
    configReloader = new ConfigReloader(
      profileStore,
      messageBus,
      (agentId) => registry.getAgent(agentId),
      (agentId) => registry.getAgentState(agentId),
    );
    initializer = new StartupInitializer({
      registry,
      profileStore,
      messageBus,
      configReloader,
    });
  });

  describe('initializeAll()', () => {
    it('should initialize agents with profiles from the store', async () => {
      const agent = createMockAgent('agent-1');
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      const result = await initializer.initializeAll(['agent-1']);

      expect(result.succeeded).toContain('agent-1');
      expect(result.failed).toHaveLength(0);
      expect(agent.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', parameters: { key: 'value' } })
      );
    });

    it('should leave agents in idle state when initialization succeeds', async () => {
      const agent = createMockAgent('agent-1');
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      await initializer.initializeAll(['agent-1']);

      expect(registry.getAgentState('agent-1')).toBe('idle');
    });

    it('should handle multiple agents successfully', async () => {
      const agent1 = createMockAgent('agent-1');
      const agent2 = createMockAgent('agent-2');
      const profile1 = createDefaultProfile('agent-1');
      const profile2 = createDefaultProfile('agent-2');

      await registry.register(agent1, profile1, defaultSchema);
      await registry.register(agent2, profile2, defaultSchema);
      await profileStore.save(profile1);
      await profileStore.save(profile2);

      const result = await initializer.initializeAll(['agent-1', 'agent-2']);

      expect(result.succeeded).toContain('agent-1');
      expect(result.succeeded).toContain('agent-2');
      expect(result.failed).toHaveLength(0);
    });

    it('should skip agents without profiles in the store (leave in idle)', async () => {
      const agent = createMockAgent('agent-1');
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      // Do NOT save profile to store — simulates missing profile

      const result = await initializer.initializeAll(['agent-1']);

      expect(result.succeeded).toContain('agent-1');
      expect(result.failed).toHaveLength(0);
      expect(registry.getAgentState('agent-1')).toBe('idle');
      // initialize should NOT have been called since no profile was loaded
      expect(agent.initialize).not.toHaveBeenCalled();
    });

    it('should set agent to error state when initialization fails', async () => {
      const agent = createMockAgent('agent-1', {
        initialize: vi.fn().mockRejectedValue(new Error('Init failed: connection refused')),
      });
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      const result = await initializer.initializeAll(['agent-1']);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.agentId).toBe('agent-1');
      expect(result.failed[0]!.reason).toBe('Init failed: connection refused');
      expect(registry.getAgentState('agent-1')).toBe('error');
    });

    it('should continue initializing remaining agents after one fails', async () => {
      const agent1 = createMockAgent('agent-1', {
        initialize: vi.fn().mockRejectedValue(new Error('Init failed')),
      });
      const agent2 = createMockAgent('agent-2');
      const profile1 = createDefaultProfile('agent-1');
      const profile2 = createDefaultProfile('agent-2');

      await registry.register(agent1, profile1, defaultSchema);
      await registry.register(agent2, profile2, defaultSchema);
      await profileStore.save(profile1);
      await profileStore.save(profile2);

      const result = await initializer.initializeAll(['agent-1', 'agent-2']);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.agentId).toBe('agent-1');
      expect(result.succeeded).toContain('agent-2');
      expect(registry.getAgentState('agent-1')).toBe('error');
      expect(registry.getAgentState('agent-2')).toBe('idle');
    });

    it('should register successfully initialized agents with config reloader', async () => {
      const agent = createMockAgent('agent-1');
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      const trackAgentSpy = vi.spyOn(configReloader, 'trackAgent');

      await initializer.initializeAll(['agent-1']);

      expect(trackAgentSpy).toHaveBeenCalledWith('agent-1', expect.any(Number));
    });

    it('should NOT register failed agents with config reloader', async () => {
      const agent = createMockAgent('agent-1', {
        initialize: vi.fn().mockRejectedValue(new Error('Init failed')),
      });
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      const trackAgentSpy = vi.spyOn(configReloader, 'trackAgent');

      await initializer.initializeAll(['agent-1']);

      expect(trackAgentSpy).not.toHaveBeenCalled();
    });

    it('should return totalDurationMs reflecting actual elapsed time', async () => {
      const agent = createMockAgent('agent-1', {
        initialize: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }),
      });
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      const result = await initializer.initializeAll(['agent-1']);

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(40);
    });

    it('should handle agent not found in registry gracefully', async () => {
      // Agent ID not registered in registry
      const result = await initializer.initializeAll(['non-existent-agent']);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.agentId).toBe('non-existent-agent');
      expect(result.failed[0]!.reason).toContain('not found in registry');
    });

    it('should complete initialization within 30 seconds for normal agents', async () => {
      const agents: Agent[] = [];
      const ids: string[] = [];

      for (let i = 0; i < 5; i++) {
        const id = `agent-${i}`;
        const agent = createMockAgent(id);
        const profile = createDefaultProfile(id);
        await registry.register(agent, profile, defaultSchema);
        await profileStore.save(profile);
        agents.push(agent);
        ids.push(id);
      }

      const result = await initializer.initializeAll(ids);

      expect(result.succeeded).toHaveLength(5);
      expect(result.totalDurationMs).toBeLessThan(30_000);
    });

    it('should handle empty agent list', async () => {
      const result = await initializer.initializeAll([]);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle initialization that throws non-Error objects', async () => {
      const agent = createMockAgent('agent-1', {
        initialize: vi.fn().mockRejectedValue('string error'),
      });
      const profile = createDefaultProfile('agent-1');

      await registry.register(agent, profile, defaultSchema);
      await profileStore.save(profile);

      const result = await initializer.initializeAll(['agent-1']);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.reason).toBe('string error');
      expect(registry.getAgentState('agent-1')).toBe('error');
    });
  });
});

describe('AgentRegistryImpl.forceState()', () => {
  let registry: AgentRegistryImpl;
  let messageBus: MessageBus;

  beforeEach(() => {
    messageBus = createMockMessageBus();
    registry = new AgentRegistryImpl(messageBus);
  });

  it('should force an agent from idle to error (bypassing transition validation)', async () => {
    const agent = createMockAgent('agent-1');
    await registry.register(agent, createDefaultProfile('agent-1'), defaultSchema);

    // idle→error is NOT valid via transitionState, but forceState should allow it
    await registry.forceState('agent-1', 'error');

    expect(registry.getAgentState('agent-1')).toBe('error');
  });

  it('should emit a state-change event when forcing state', async () => {
    const agent = createMockAgent('agent-1');
    await registry.register(agent, createDefaultProfile('agent-1'), defaultSchema);
    (messageBus.publish as ReturnType<typeof vi.fn>).mockClear();

    await registry.forceState('agent-1', 'error');

    expect(messageBus.publish).toHaveBeenCalledTimes(1);
    const publishedMessage = (messageBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BusMessage;
    expect(publishedMessage.topic).toBe('registry.state-change');
    expect((publishedMessage.payload as Record<string, unknown>).agentId).toBe('agent-1');
    expect((publishedMessage.payload as Record<string, unknown>).previousState).toBe('idle');
    expect((publishedMessage.payload as Record<string, unknown>).newState).toBe('error');
  });

  it('should do nothing for non-existent agents', async () => {
    await registry.forceState('non-existent', 'error');
    expect(messageBus.publish).not.toHaveBeenCalled();
  });

  it('should allow any state transition regardless of the state machine', async () => {
    const agent = createMockAgent('agent-1');
    await registry.register(agent, createDefaultProfile('agent-1'), defaultSchema);

    // disabled→active is not valid normally
    await registry.forceState('agent-1', 'disabled');
    await registry.forceState('agent-1', 'active');

    expect(registry.getAgentState('agent-1')).toBe('active');
  });
});
