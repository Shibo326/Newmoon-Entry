/**
 * Unit tests for AgentFactory and registerPlugin utility.
 *
 * Validates: Requirements 14.3, 14.4, 14.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentFactory, registerPlugin } from '../agent-factory.js';
import type { AgentDependencies } from '../agent-factory.js';
import type { WalletConnector, SessionStorage } from '../wallet-agent.js';
import type { CompactWitness } from '../signal-agent.js';
import type { GroqClient } from '../scoring-agent.js';
import type { CompactContract } from '../credential-agent.js';
import type { VerificationContract } from '../verification-agent.js';
import type { CacheStore } from '../cache-agent.js';
import type { AdaptationLog } from '../../types/log.js';
import type { Agent } from '../../types/agent.js';
import type { BehaviorProfile } from '../../types/config.js';
import { InMemoryMessageBus } from '../../bus/message-bus.js';
import { AgentRegistryImpl } from '../../registry/agent-registry.js';

// ─── Stub Dependencies ─────────────────────────────────────────────────────────

function createStubWalletConnector(): WalletConnector {
  return {
    async connect() { return { address: 'test-address' }; },
    async disconnect() {},
    isConnected() { return false; },
    getAddress() { return null; },
    onDisconnect() {},
  };
}

function createStubSessionStorage(): SessionStorage {
  const store = new Map<string, string>();
  return {
    get(key: string) { return store.get(key) ?? null; },
    set(key: string, value: string) { store.set(key, value); },
    remove(key: string) { store.delete(key); },
  };
}

function createStubCompactWitness(): CompactWitness {
  return {
    async readSignal() { return { value: 50, transactionCount: 5 }; },
    async isWalletConnected() { return true; },
  };
}

function createStubGroqClient(): GroqClient {
  return {
    async createCompletion() {
      return { content: JSON.stringify({ grade: 'BBB', reasoning: [] }) };
    },
  };
}

function createStubCompactContract(): CompactContract {
  return {
    async mint() { return { txHash: 'tx-123', mintTimestamp: Date.now() }; },
    async revoke() {},
    async hasCredential() { return false; },
  };
}

function createStubVerificationContract(): VerificationContract {
  return {
    async getCredentialGrade() { return null; },
    async isAvailable() { return true; },
  };
}

function createStubCacheStore(): CacheStore {
  return {
    async get() { return null; },
    async set() {},
  };
}

function createStubAdaptationLog(): AdaptationLog {
  return {
    async write() {},
    async query() { return []; },
    async getAgentSummary() {
      return { currentParameters: {}, changeHistory: [] };
    },
  };
}

function createFullDeps(): AgentDependencies {
  const bus = new InMemoryMessageBus();
  return {
    bus,
    walletConnector: createStubWalletConnector(),
    sessionStorage: createStubSessionStorage(),
    compactWitness: createStubCompactWitness(),
    groqClient: createStubGroqClient(),
    compactContract: createStubCompactContract(),
    verificationContract: createStubVerificationContract(),
    cacheStore: createStubCacheStore(),
    adaptationLog: createStubAdaptationLog(),
    agentProvider: () => undefined,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('AgentFactory', () => {
  let factory: AgentFactory;

  beforeEach(() => {
    factory = new AgentFactory(createFullDeps());
  });

  describe('createWalletAgent', () => {
    it('creates a WalletAgent with correct id', () => {
      const agent = factory.createWalletAgent();
      expect(agent.id).toBe('wallet-agent');
      expect(agent.name).toBe('Wallet Agent');
    });

    it('throws if walletConnector is missing', () => {
      const deps = createFullDeps();
      delete deps.walletConnector;
      const f = new AgentFactory(deps);
      expect(() => f.createWalletAgent()).toThrow('walletConnector');
    });

    it('throws if sessionStorage is missing', () => {
      const deps = createFullDeps();
      delete deps.sessionStorage;
      const f = new AgentFactory(deps);
      expect(() => f.createWalletAgent()).toThrow('sessionStorage');
    });
  });

  describe('createSignalAgent', () => {
    it('creates a SignalAgent with correct id', () => {
      const agent = factory.createSignalAgent();
      expect(agent.id).toBe('signal-agent');
    });

    it('throws if compactWitness is missing', () => {
      const deps = createFullDeps();
      delete deps.compactWitness;
      const f = new AgentFactory(deps);
      expect(() => f.createSignalAgent()).toThrow('compactWitness');
    });
  });

  describe('createScoringAgent', () => {
    it('creates a ScoringAgent with correct id', () => {
      const agent = factory.createScoringAgent();
      expect(agent.id).toBe('scoring-agent');
    });

    it('throws if groqClient is missing', () => {
      const deps = createFullDeps();
      delete deps.groqClient;
      const f = new AgentFactory(deps);
      expect(() => f.createScoringAgent()).toThrow('groqClient');
    });
  });

  describe('createCredentialAgent', () => {
    it('creates a CredentialAgent with correct id', () => {
      const agent = factory.createCredentialAgent();
      expect(agent.id).toBe('credential-agent');
    });

    it('throws if compactContract is missing', () => {
      const deps = createFullDeps();
      delete deps.compactContract;
      const f = new AgentFactory(deps);
      expect(() => f.createCredentialAgent()).toThrow('compactContract');
    });
  });

  describe('createVerificationAgent', () => {
    it('creates a VerificationAgent with correct id', () => {
      const agent = factory.createVerificationAgent();
      expect(agent.id).toBe('verification-agent');
    });

    it('throws if verificationContract is missing', () => {
      const deps = createFullDeps();
      delete deps.verificationContract;
      const f = new AgentFactory(deps);
      expect(() => f.createVerificationAgent()).toThrow('verificationContract');
    });
  });

  describe('createCacheAgent', () => {
    it('creates a CacheAgent with correct id', () => {
      const agent = factory.createCacheAgent();
      expect(agent.id).toBe('cache-agent');
    });

    it('throws if cacheStore is missing', () => {
      const deps = createFullDeps();
      delete deps.cacheStore;
      const f = new AgentFactory(deps);
      expect(() => f.createCacheAgent()).toThrow('cacheStore');
    });
  });

  describe('createMonitorAgent', () => {
    it('creates a MonitorAgent with correct id', () => {
      const agent = factory.createMonitorAgent();
      expect(agent.id).toBe('monitor-agent');
    });

    it('throws if adaptationLog is missing', () => {
      const deps = createFullDeps();
      delete deps.adaptationLog;
      const f = new AgentFactory(deps);
      expect(() => f.createMonitorAgent()).toThrow('adaptationLog');
    });

    it('throws if agentProvider is missing', () => {
      const deps = createFullDeps();
      delete deps.agentProvider;
      const f = new AgentFactory(deps);
      expect(() => f.createMonitorAgent()).toThrow('agentProvider');
    });
  });

  describe('createOrchestratorAgent', () => {
    it('creates an OrchestratorAgent with correct id', () => {
      const agent = factory.createOrchestratorAgent();
      expect(agent.id).toBe('orchestrator-agent');
    });

    it('works with only bus dependency', () => {
      const minimalDeps: AgentDependencies = { bus: new InMemoryMessageBus() };
      const f = new AgentFactory(minimalDeps);
      const agent = f.createOrchestratorAgent();
      expect(agent.id).toBe('orchestrator-agent');
    });
  });

  describe('creates agents that implement Agent interface', () => {
    it('all created agents have required methods', () => {
      const agents = [
        factory.createWalletAgent(),
        factory.createSignalAgent(),
        factory.createScoringAgent(),
        factory.createCredentialAgent(),
        factory.createVerificationAgent(),
        factory.createCacheAgent(),
        factory.createMonitorAgent(),
        factory.createOrchestratorAgent(),
      ];

      for (const agent of agents) {
        expect(typeof agent.handleMessage).toBe('function');
        expect(typeof agent.getHealth).toBe('function');
        expect(typeof agent.getCapabilities).toBe('function');
        expect(typeof agent.initialize).toBe('function');
        expect(typeof agent.onActivate).toBe('function');
        expect(typeof agent.onDeactivate).toBe('function');
        expect(typeof agent.onConfigUpdate).toBe('function');
      }
    });
  });
});

describe('registerPlugin', () => {
  let bus: InMemoryMessageBus;
  let registry: AgentRegistryImpl;

  beforeEach(() => {
    bus = new InMemoryMessageBus();
    registry = new AgentRegistryImpl(bus);
  });

  function createMockPlugin(id: string): Agent {
    return {
      id,
      name: `Plugin ${id}`,
      async handleMessage(msg) {
        return {
          id: 'resp-1',
          sourceAgentId: id,
          targetAgentId: msg.sourceAgentId,
          type: 'response' as const,
          correlationId: msg.correlationId,
          timestamp: Date.now(),
          topic: msg.topic,
          payload: {},
        };
      },
      getHealth() {
        return {
          state: 'idle' as const,
          uptimeSeconds: 0,
          requestCount: 0,
          errorCount: 0,
          avgResponseTimeMs: 0,
        };
      },
      getCapabilities() {
        return [{ topic: `plugin.${id}`, description: `Plugin ${id} capability` }];
      },
      async initialize() {},
      async onActivate() {},
      async onDeactivate() {},
      async onConfigUpdate() {},
    };
  }

  it('registers a plugin with the registry using default schema', async () => {
    const plugin = createMockPlugin('test-plugin');
    const profile: BehaviorProfile = {
      agentId: 'test-plugin',
      version: 1,
      parameters: { foo: 'bar' },
      lastModified: Date.now(),
    };

    await registerPlugin(registry, plugin, profile);

    const registered = registry.getAgent('test-plugin');
    expect(registered).toBe(plugin);
  });

  it('registers a plugin with a custom schema', async () => {
    const plugin = createMockPlugin('custom-plugin');
    const profile: BehaviorProfile = {
      agentId: 'custom-plugin',
      version: 1,
      parameters: { timeout: 5000 },
      lastModified: Date.now(),
    };
    const schema = {
      type: 'object',
      properties: { timeout: { type: 'number', minimum: 1000 } },
    };

    await registerPlugin(registry, plugin, profile, schema);

    const registered = registry.getAgent('custom-plugin');
    expect(registered).toBe(plugin);
  });

  it('makes the plugin available for message routing after registration', async () => {
    const plugin = createMockPlugin('router-plugin');
    const profile: BehaviorProfile = {
      agentId: 'router-plugin',
      version: 1,
      parameters: {},
      lastModified: Date.now(),
    };

    await registerPlugin(registry, plugin, profile);

    // Agent is registered and can be queried
    const agents = registry.queryAgents({ state: 'idle' });
    const found = agents.find((a) => a.id === 'router-plugin');
    expect(found).toBeDefined();
  });

  it('rejects registration for plugins missing required methods', async () => {
    const invalidPlugin = {
      id: 'bad-plugin',
      name: 'Bad Plugin',
      // Missing handleMessage, getHealth, getCapabilities, initialize
    } as unknown as Agent;

    const profile: BehaviorProfile = {
      agentId: 'bad-plugin',
      version: 1,
      parameters: {},
      lastModified: Date.now(),
    };

    await expect(registerPlugin(registry, invalidPlugin, profile)).rejects.toThrow(
      /missing required methods/
    );
  });

  it('emits state-change event on successful registration', async () => {
    const events: unknown[] = [];
    bus.subscribe('registry.state-change', async (msg) => {
      events.push(msg.payload);
    });

    const plugin = createMockPlugin('evented-plugin');
    const profile: BehaviorProfile = {
      agentId: 'evented-plugin',
      version: 1,
      parameters: {},
      lastModified: Date.now(),
    };

    await registerPlugin(registry, plugin, profile);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events[0] as Record<string, unknown>;
    expect(event['agentId']).toBe('evented-plugin');
    expect(event['newState']).toBe('idle');
  });
});
