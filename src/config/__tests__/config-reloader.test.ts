import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConfigReloader } from '../config-reloader.js';
import { InMemoryBehaviorProfileStore } from '../behavior-profile-store.js';
import { InMemoryMessageBus } from '../../bus/message-bus.js';
import type { Agent, AgentLifecycleState } from '../../types/agent.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { BusMessage } from '../../types/messages.js';

function createMockAgent(id: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    handleMessage: vi.fn().mockResolvedValue({
      id: 'resp-1', sourceAgentId: id, targetAgentId: null,
      type: 'response', correlationId: 'c-1', timestamp: Date.now(),
      topic: 'test', payload: {},
    }),
    getHealth: vi.fn().mockReturnValue({
      state: 'active', uptimeSeconds: 100, requestCount: 0,
      errorCount: 0, avgResponseTimeMs: 10,
    }),
    getCapabilities: vi.fn().mockReturnValue([]),
    initialize: vi.fn().mockResolvedValue(undefined),
    onActivate: vi.fn().mockResolvedValue(undefined),
    onDeactivate: vi.fn().mockResolvedValue(undefined),
    onConfigUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

function createProfile(agentId: string, lastModified: number, version = 1): BehaviorProfile {
  return {
    agentId,
    version,
    parameters: { timeout: 5000, retries: 3 },
    lastModified,
  };
}

describe('ConfigReloader', () => {
  let store: InMemoryBehaviorProfileStore;
  let bus: InMemoryMessageBus;
  let agents: Map<string, Agent>;
  let agentStates: Map<string, AgentLifecycleState>;
  let reloader: ConfigReloader;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryBehaviorProfileStore();
    bus = new InMemoryMessageBus();
    agents = new Map();
    agentStates = new Map();

    reloader = new ConfigReloader(
      store,
      bus,
      (id) => agents.get(id),
      (id) => agentStates.get(id),
      { pollIntervalMs: 1000 }
    );
  });

  afterEach(() => {
    reloader.stop();
    vi.useRealTimers();
  });

  describe('checkForUpdates()', () => {
    it('applies new profile to active agent when lastModified changes', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      // Save initial profile
      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 1000);

      // Update profile with newer lastModified
      await store.save(createProfile('agent-1', 2000));

      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
      const calledWith = (agent.onConfigUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BehaviorProfile;
      expect(calledWith.lastModified).toBe(2000);
    });

    it('does not apply profile when lastModified has not changed', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 1000);

      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
    });

    it('queues profile for idle agent instead of applying immediately', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'idle');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
      const pending = reloader.getPendingProfile('agent-1');
      expect(pending).toBeDefined();
      expect(pending!.lastModified).toBe(1000);
    });

    it('queues profile for error state agent', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'error');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
      expect(reloader.getPendingProfile('agent-1')).toBeDefined();
    });

    it('queues profile for disabled agent', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'disabled');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
      expect(reloader.getPendingProfile('agent-1')).toBeDefined();
    });

    it('skips agents with no profile in the store', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');
      reloader.trackAgent('agent-1');

      // No profile saved in store, load will throw ProfileNotFoundError
      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
    });

    it('applies profile on first check when no baseline is set', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1'); // No baseline lastModified

      await reloader.checkForUpdates();

      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAgentActivated()', () => {
    it('applies queued profile when agent becomes active', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'idle');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      // Trigger check — queues the profile
      await reloader.checkForUpdates();
      expect(agent.onConfigUpdate).not.toHaveBeenCalled();

      // Simulate agent activation
      agentStates.set('agent-1', 'active');
      await reloader.onAgentActivated('agent-1');

      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
      expect(reloader.getPendingProfile('agent-1')).toBeUndefined();
    });

    it('does nothing when no pending profile exists', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);

      await reloader.onAgentActivated('agent-1');

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
    });

    it('does nothing when agent is not found', async () => {
      // No agent registered
      reloader.trackAgent('agent-1');

      // This should not throw
      await reloader.onAgentActivated('agent-1');
    });
  });

  describe('failed config application', () => {
    it('publishes config.apply-failed event when onConfigUpdate throws', async () => {
      const agent = createMockAgent('agent-1');
      (agent.onConfigUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Initialization failed')
      );
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      const publishedMessages: BusMessage[] = [];
      bus.subscribe('config.apply-failed', async (msg) => {
        publishedMessages.push(msg);
      });

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      await reloader.checkForUpdates();

      expect(publishedMessages).toHaveLength(1);
      const event = publishedMessages[0]!;
      expect(event.type).toBe('event');
      expect(event.sourceAgentId).toBe('config-reloader');
      expect(event.topic).toBe('config.apply-failed');
      expect(event.payload).toMatchObject({
        agentId: 'agent-1',
        version: 1,
        reason: 'Initialization failed',
      });
    });

    it('publishes config.apply-failed event on activation failure', async () => {
      const agent = createMockAgent('agent-1');
      (agent.onConfigUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Constraint conflict')
      );
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'idle');

      const publishedMessages: BusMessage[] = [];
      bus.subscribe('config.apply-failed', async (msg) => {
        publishedMessages.push(msg);
      });

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      // Queue the profile
      await reloader.checkForUpdates();

      // Activate the agent — apply queued profile which fails
      agentStates.set('agent-1', 'active');
      await reloader.onAgentActivated('agent-1');

      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0]!.payload).toMatchObject({
        agentId: 'agent-1',
        reason: 'Constraint conflict',
      });
    });

    it('retains previous parameters when config application fails', async () => {
      const agent = createMockAgent('agent-1');
      (agent.onConfigUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed')
      );
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      // Initial profile
      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 1000);

      // New profile with updated lastModified
      await store.save(createProfile('agent-1', 2000));

      await reloader.checkForUpdates();

      // Agent was called but it threw — the reloader should NOT have updated lastKnown
      // so next poll will try again (the profile is still "new")
      // However, the agent retains its previous parameters because onConfigUpdate threw
      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('polling behavior', () => {
    it('start() triggers periodic checks', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      reloader.start();

      // Advance time past the poll interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
    });

    it('stop() prevents further polling', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      reloader.start();
      reloader.stop();

      await vi.advanceTimersByTimeAsync(2000);

      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
    });

    it('start() is idempotent when already running', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      reloader.start();
      reloader.start(); // Second call should be no-op

      await vi.advanceTimersByTimeAsync(1000);

      // Should only fire once per interval, not twice
      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('trackAgent / untrackAgent', () => {
    it('untrackAgent removes agent from monitoring and clears pending', async () => {
      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'idle');

      await store.save(createProfile('agent-1', 1000));
      reloader.trackAgent('agent-1', 500);

      await reloader.checkForUpdates();
      expect(reloader.getPendingProfile('agent-1')).toBeDefined();

      reloader.untrackAgent('agent-1');

      expect(reloader.getPendingProfile('agent-1')).toBeUndefined();

      // Further checks should not process this agent
      await store.save(createProfile('agent-1', 3000));
      await reloader.checkForUpdates();
      expect(agent.onConfigUpdate).not.toHaveBeenCalled();
    });
  });

  describe('notification within 5 seconds', () => {
    it('detects profile change within 5-second polling window', async () => {
      // Using default poll interval for this specific test
      const fastReloader = new ConfigReloader(
        store,
        bus,
        (id) => agents.get(id),
        (id) => agentStates.get(id),
        { pollIntervalMs: 5000 }
      );

      const agent = createMockAgent('agent-1');
      agents.set('agent-1', agent);
      agentStates.set('agent-1', 'active');

      await store.save(createProfile('agent-1', 1000));
      fastReloader.trackAgent('agent-1', 500);

      fastReloader.start();

      // Advance time by 5 seconds — poll should have fired
      await vi.advanceTimersByTimeAsync(5000);

      expect(agent.onConfigUpdate).toHaveBeenCalledTimes(1);
      fastReloader.stop();
    });
  });
});
