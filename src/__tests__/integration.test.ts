/**
 * Integration tests for the full scoring workflow.
 * Uses real MessageBus and AgentRegistry with mocked external services.
 * Tests the orchestrator pipeline coordination through actual bus routing.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 13.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { InMemoryMessageBus } from '../bus/message-bus.js';
import { AgentRegistryImpl } from '../registry/agent-registry.js';
import { WalletAgent } from '../agents/wallet-agent.js';
import type { WalletConnector, SessionStorage } from '../agents/wallet-agent.js';
import { CacheAgent } from '../agents/cache-agent.js';
import type { CacheStore } from '../agents/cache-agent.js';
import { SignalAgent } from '../agents/signal-agent.js';
import type { CompactWitness } from '../agents/signal-agent.js';
import { ScoringAgent } from '../agents/scoring-agent.js';
import type { GroqClient } from '../agents/scoring-agent.js';
import { CredentialAgent } from '../agents/credential-agent.js';
import type { CompactContract } from '../agents/credential-agent.js';
import { OrchestratorAgentImpl } from '../agents/orchestrator-agent.js';
import { ConfigReloader } from '../config/config-reloader.js';
import { InMemoryBehaviorProfileStore } from '../config/behavior-profile-store.js';
import type { BehaviorProfile } from '../types/config.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { Subscription } from '../bus/message-bus.js';

// --- Mock Factories ---

function createMockWalletConnector(address = '0xTestWallet123'): WalletConnector {
  return {
    connect: vi.fn().mockResolvedValue({ address }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => true),
    getAddress: vi.fn(() => address),
    onDisconnect: vi.fn(),
  };
}

function createMockSessionStorage(): SessionStorage {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => store.get(key) ?? null),
    set: vi.fn((key: string, value: string) => { store.set(key, value); }),
    remove: vi.fn((key: string) => { store.delete(key); }),
  };
}

function createMockCacheStore(): CacheStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCompactWitness(): CompactWitness {
  return {
    readSignal: vi.fn().mockResolvedValue({ value: 50, transactionCount: 10 }),
    isWalletConnected: vi.fn().mockResolvedValue(true),
  };
}

function createMockGroqClient(): GroqClient {
  return {
    createCompletion: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        grade: 'AA',
        reasoning: [
          { signal: 'walletAge', direction: 'positive', weight: 0.2 },
          { signal: 'transactionFrequency', direction: 'positive', weight: 0.15 },
          { signal: 'defiInteractions', direction: 'positive', weight: 0.15 },
          { signal: 'repaymentHistory', direction: 'positive', weight: 0.25 },
          { signal: 'assetDiversity', direction: 'positive', weight: 0.15 },
          { signal: 'liquidationHistory', direction: 'negative', weight: 0.1 },
        ],
      }),
    }),
  };
}

function createMockCompactContract(): CompactContract {
  return {
    mint: vi.fn().mockResolvedValue({ txHash: '0xmint123', mintTimestamp: Date.now() }),
    revoke: vi.fn().mockResolvedValue(undefined),
    hasCredential: vi.fn().mockResolvedValue(false),
  };
}

// --- Default Profiles ---

const walletProfile: BehaviorProfile = {
  agentId: 'wallet-agent', version: 1, lastModified: Date.now(),
  parameters: { connectionTimeoutMs: 30000 },
};
const cacheProfile: BehaviorProfile = {
  agentId: 'cache-agent', version: 1, lastModified: Date.now(),
  parameters: { ttlMs: 86400000, maxRetries: 2, retryDelayMs: 500, connectionPoolSize: 5 },
};
const signalProfile: BehaviorProfile = {
  agentId: 'signal-agent', version: 1, lastModified: Date.now(),
  parameters: { minTransactionsForSignal: 3 },
};
const scoringProfile: BehaviorProfile = {
  agentId: 'scoring-agent', version: 1, lastModified: Date.now(),
  parameters: { model: 'llama-3.3-70b-versatile', temperature: 0, apiTimeoutMs: 5000, dailyRateLimit: 14400 },
};
const credentialProfile: BehaviorProfile = {
  agentId: 'credential-agent', version: 1, lastModified: Date.now(),
  parameters: { maxRetries: 3, backoffBaseMs: 1, mintTimeoutMs: 60000 },
};
const orchestratorProfile: BehaviorProfile = {
  agentId: 'orchestrator-agent', version: 1, lastModified: Date.now(),
  parameters: { stepTimeoutMs: 5000, workflowTimeoutMs: 30000, maxConcurrentWorkflows: 10, queueLimit: 50, queueResumeAt: 40 },
};

/**
 * Create agent response handlers that simulate agent behavior through the real bus.
 * This bridges the gap between what the orchestrator sends and what agents return,
 * testing the full bus routing + correlation mechanism.
 */
function createPipelineHandlers(bus: InMemoryMessageBus, options?: {
  walletConnected?: boolean;
  cacheHit?: boolean;
  signalError?: boolean;
  scoringError?: boolean;
  credentialError?: boolean;
}): Subscription[] {
  const opts = { walletConnected: true, cacheHit: false, signalError: false, scoringError: false, credentialError: false, ...options };
  const subs: Subscription[] = [];

  // Wallet Agent handler
  subs.push(bus.subscribe('wallet.validate-session', async (msg: BusMessage) => {
    if (msg.type !== 'request' || msg.targetAgentId !== 'wallet-agent') return;
    const response: ResponseMessage | ErrorMessage = opts.walletConnected
      ? { id: uuidv4(), sourceAgentId: 'wallet-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { address: '0xTestWallet123', valid: true } }
      : { id: uuidv4(), sourceAgentId: 'wallet-agent', targetAgentId: msg.sourceAgentId, type: 'error', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { code: 'DISCONNECTED', description: 'No active wallet connection' } };
    await bus.publish(response);
  }, 'wallet-agent'));

  // Cache Agent handler
  subs.push(bus.subscribe('cache.check-cache', async (msg: BusMessage) => {
    if (msg.type !== 'request' || msg.targetAgentId !== 'cache-agent') return;
    const payload = msg.payload as Record<string, unknown>;
    const response: ResponseMessage = opts.cacheHit
      ? { id: uuidv4(), sourceAgentId: 'cache-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { hit: true, grade: 'A', reasoning: [{ signal: 'walletAge', direction: 'positive', weight: 0.3 }] } }
      : { id: uuidv4(), sourceAgentId: 'cache-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { hit: false, walletAddress: payload.walletAddress } };
    await bus.publish(response);
  }, 'cache-agent'));

  return subs;
}

function createSignalAndScoringHandlers(bus: InMemoryMessageBus, options?: {
  signalError?: boolean;
  scoringError?: boolean;
  credentialError?: boolean;
}): Subscription[] {
  const opts = { signalError: false, scoringError: false, credentialError: false, ...options };
  const subs: Subscription[] = [];

  // Signal Agent handler
  subs.push(bus.subscribe('signal.read-signals', async (msg: BusMessage) => {
    if (msg.type !== 'request' || msg.targetAgentId !== 'signal-agent') return;
    if (opts.signalError) {
      const err: ErrorMessage = { id: uuidv4(), sourceAgentId: 'signal-agent', targetAgentId: msg.sourceAgentId, type: 'error', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { code: 'invalid-wallet', description: 'Wallet is not connected' } };
      await bus.publish(err);
      return;
    }
    const response: ResponseMessage = { id: uuidv4(), sourceAgentId: 'signal-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { walletAge: 0.8, transactionFrequency: 0.7, defiInteractions: 0.6, repaymentHistory: 0.9, assetDiversity: 0.5, liquidationHistory: 0.1 } };
    await bus.publish(response);
  }, 'signal-agent'));

  // Scoring Agent handler
  subs.push(bus.subscribe('scoring.compute-grade', async (msg: BusMessage) => {
    if (msg.type !== 'request' || msg.targetAgentId !== 'scoring-agent') return;
    if (opts.scoringError) {
      const err: ErrorMessage = { id: uuidv4(), sourceAgentId: 'scoring-agent', targetAgentId: msg.sourceAgentId, type: 'error', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { code: 'scoring-parse-error', description: 'Failed to parse scoring response' } };
      await bus.publish(err);
      return;
    }
    const response: ResponseMessage = { id: uuidv4(), sourceAgentId: 'scoring-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { grade: 'AA', reasoning: [{ signal: 'walletAge', direction: 'positive', weight: 0.2 }, { signal: 'transactionFrequency', direction: 'positive', weight: 0.15 }, { signal: 'defiInteractions', direction: 'positive', weight: 0.15 }, { signal: 'repaymentHistory', direction: 'positive', weight: 0.25 }, { signal: 'assetDiversity', direction: 'positive', weight: 0.15 }, { signal: 'liquidationHistory', direction: 'negative', weight: 0.1 }] } };
    await bus.publish(response);
  }, 'scoring-agent'));

  // Store-result handler (cache write)
  subs.push(bus.subscribe('cache.store-result', async (msg: BusMessage) => {
    if (msg.type !== 'request' || msg.targetAgentId !== 'cache-agent') return;
    const response: ResponseMessage = { id: uuidv4(), sourceAgentId: 'cache-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { stored: true } };
    await bus.publish(response);
  }, 'cache-agent'));

  // Credential Agent handler
  subs.push(bus.subscribe('credential.mint-credential', async (msg: BusMessage) => {
    if (msg.type !== 'request' || msg.targetAgentId !== 'credential-agent') return;
    if (opts.credentialError) {
      const err: ErrorMessage = { id: uuidv4(), sourceAgentId: 'credential-agent', targetAgentId: msg.sourceAgentId, type: 'error', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { code: 'minting-failed', description: 'Minting failed after retries' } };
      await bus.publish(err);
      return;
    }
    const response: ResponseMessage = { id: uuidv4(), sourceAgentId: 'credential-agent', targetAgentId: msg.sourceAgentId, type: 'response', correlationId: msg.correlationId, timestamp: Date.now(), topic: msg.topic, payload: { txHash: '0xmint123', mintTimestamp: Date.now() } };
    await bus.publish(response);
  }, 'credential-agent'));

  return subs;
}

// --- Integration Tests ---

describe('Integration: Full Scoring Workflow', () => {
  let bus: InMemoryMessageBus;
  let orchestrator: OrchestratorAgentImpl;
  let subscriptions: Subscription[];

  beforeEach(async () => {
    bus = new InMemoryMessageBus();
    orchestrator = new OrchestratorAgentImpl(bus);
    await orchestrator.initialize(orchestratorProfile);
    await orchestrator.onActivate();
    subscriptions = [];
  });

  afterEach(() => {
    subscriptions.forEach((sub) => bus.unsubscribe(sub));
  });

  describe('Happy path: full pipeline (Req 3.1)', () => {
    beforeEach(() => {
      subscriptions.push(
        ...createPipelineHandlers(bus),
        ...createSignalAndScoringHandlers(bus),
      );
    });

    it('executes Wallet → Cache → Signal → Scoring → Credential pipeline', async () => {
      const result = await orchestrator.requestScore('0xTestWallet123');

      expect(result.status).toBe('success');
      expect(result.grade).toBe('AA');
      expect(result.credential).toBeDefined();
      expect(result.credential!.txHash).toBe('0xmint123');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.stepTimings).toBeDefined();
    });

    it('publishes workflow-complete event with timing data', async () => {
      const events: BusMessage[] = [];
      bus.subscribe('workflow-complete', async (msg) => { events.push(msg); });

      await orchestrator.requestScore('0xTestWallet123');

      expect(events.length).toBe(1);
      const payload = events[0]!.payload as Record<string, unknown>;
      expect(payload.status).toBe('success');
      expect(payload.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(payload.stepTimings).toBeDefined();
    });

    it('processes multiple sequential workflows', async () => {
      const r1 = await orchestrator.requestScore('0xWallet1');
      const r2 = await orchestrator.requestScore('0xWallet2');

      expect(r1.status).toBe('success');
      expect(r2.status).toBe('success');
    });
  });

  describe('Cache-hit short-circuit (Req 3.2)', () => {
    beforeEach(() => {
      subscriptions.push(
        ...createPipelineHandlers(bus, { cacheHit: true }),
        ...createSignalAndScoringHandlers(bus),
      );
    });

    it('returns cached result without invoking signal/scoring/credential', async () => {
      const result = await orchestrator.requestScore('0xTestWallet123');

      expect(result.status).toBe('success');
      expect(result.cachedResult).toBe(true);
      expect(result.grade).toBe('A');
    });

    it('skips Signal, Scoring, Store, and Credential steps', async () => {
      const result = await orchestrator.requestScore('0xTestWallet123');

      // Step timings for skipped steps should be 0
      expect(result.stepTimings['read-signals']).toBe(0);
      expect(result.stepTimings['compute-grade']).toBe(0);
      expect(result.stepTimings['store-result']).toBe(0);
      expect(result.stepTimings['mint-credential']).toBe(0);
    });
  });

  describe('Pipeline failure and halt (Req 3.3)', () => {
    it('halts when wallet validation fails', async () => {
      subscriptions.push(
        ...createPipelineHandlers(bus, { walletConnected: false }),
        ...createSignalAndScoringHandlers(bus),
      );

      const result = await orchestrator.requestScore('0xTestWallet123');

      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe('validate-session');
      expect(result.failureReason).toContain('No active wallet connection');
    });

    it('halts when signal reading fails', async () => {
      subscriptions.push(
        ...createPipelineHandlers(bus),
        ...createSignalAndScoringHandlers(bus, { signalError: true }),
      );

      const result = await orchestrator.requestScore('0xTestWallet123');

      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe('read-signals');
    });

    it('halts when scoring fails', async () => {
      subscriptions.push(
        ...createPipelineHandlers(bus),
        ...createSignalAndScoringHandlers(bus, { scoringError: true }),
      );

      const result = await orchestrator.requestScore('0xTestWallet123');

      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe('compute-grade');
    });

    it('halts when credential minting fails', async () => {
      subscriptions.push(
        ...createPipelineHandlers(bus),
        ...createSignalAndScoringHandlers(bus, { credentialError: true }),
      );

      const result = await orchestrator.requestScore('0xTestWallet123');

      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe('mint-credential');
    });

    it('publishes workflow-complete event on failure', async () => {
      subscriptions.push(
        ...createPipelineHandlers(bus, { walletConnected: false }),
        ...createSignalAndScoringHandlers(bus),
      );

      const events: BusMessage[] = [];
      bus.subscribe('workflow-complete', async (msg) => { events.push(msg); });

      await orchestrator.requestScore('0xTestWallet123');

      expect(events.length).toBe(1);
      expect((events[0]!.payload as Record<string, unknown>).status).toBe('failed');
    });
  });

  describe('Level-gate changes triggering activation/deactivation (Req 13.6)', () => {
    let registry: AgentRegistryImpl;
    let walletAgent: WalletAgent;
    let cacheAgent: CacheAgent;
    let signalAgent: SignalAgent;
    let scoringAgent: ScoringAgent;
    let credentialAgent: CredentialAgent;

    beforeEach(async () => {
      registry = new AgentRegistryImpl(bus);
      const mockConnector = createMockWalletConnector();
      const mockStorage = createMockSessionStorage();
      const mockCacheStore = createMockCacheStore();
      const mockWitness = createMockCompactWitness();
      const mockGroq = createMockGroqClient();
      const mockContract = createMockCompactContract();

      walletAgent = new WalletAgent(bus, mockConnector, mockStorage);
      cacheAgent = new CacheAgent(bus, mockCacheStore);
      signalAgent = new SignalAgent(bus, mockWitness);
      scoringAgent = new ScoringAgent(bus, mockGroq);
      credentialAgent = new CredentialAgent(bus, mockContract);

      await walletAgent.initialize(walletProfile);
      await cacheAgent.initialize(cacheProfile);
      await signalAgent.initialize(signalProfile);
      await scoringAgent.initialize(scoringProfile);
      await credentialAgent.initialize(credentialProfile);

      const schema = {};
      await registry.register(walletAgent, walletProfile, schema);
      await registry.register(credentialAgent, credentialProfile, schema);
      await registry.register(orchestrator, orchestratorProfile, schema);
      await registry.register(scoringAgent, scoringProfile, schema);
      await registry.register(signalAgent, signalProfile, schema);
      await registry.register(cacheAgent, cacheProfile, schema);
    });

    it('L1: only wallet and credential agents are idle', async () => {
      // Start at L3 (all agents idle), then drop to L1
      await registry.setLevelGate(3);
      await registry.setLevelGate(1);

      expect(registry.getAgentState('wallet-agent')).toBe('idle');
      expect(registry.getAgentState('credential-agent')).toBe('idle');
      expect(registry.getAgentState('orchestrator-agent')).toBe('disabled');
      expect(registry.getAgentState('scoring-agent')).toBe('disabled');
      expect(registry.getAgentState('signal-agent')).toBe('disabled');
      expect(registry.getAgentState('cache-agent')).toBe('disabled');
    });

    it('L2: adds orchestrator and scoring agents', async () => {
      // Start at L3, drop to L1, then go to L2
      await registry.setLevelGate(3);
      await registry.setLevelGate(1);
      await registry.setLevelGate(2);

      expect(registry.getAgentState('wallet-agent')).toBe('idle');
      expect(registry.getAgentState('credential-agent')).toBe('idle');
      expect(registry.getAgentState('orchestrator-agent')).toBe('idle');
      expect(registry.getAgentState('scoring-agent')).toBe('idle');
      expect(registry.getAgentState('signal-agent')).toBe('disabled');
      expect(registry.getAgentState('cache-agent')).toBe('disabled');
    });

    it('L3: adds signal, cache, and monitor agents', async () => {
      await registry.setLevelGate(3);

      expect(registry.getAgentState('wallet-agent')).toBe('idle');
      expect(registry.getAgentState('credential-agent')).toBe('idle');
      expect(registry.getAgentState('orchestrator-agent')).toBe('idle');
      expect(registry.getAgentState('scoring-agent')).toBe('idle');
      expect(registry.getAgentState('signal-agent')).toBe('idle');
      expect(registry.getAgentState('cache-agent')).toBe('idle');
    });

    it('emits state-change events when level increases', async () => {
      // First disable agents by going to L3 then back to L1
      await registry.setLevelGate(3);
      await registry.setLevelGate(1);

      const events: BusMessage[] = [];
      bus.subscribe('registry.state-change', async (msg) => { events.push(msg); });

      // Now increase level: L1 → L3 should re-enable disabled agents
      await registry.setLevelGate(3);

      const activated = events.filter(
        (e) => (e.payload as Record<string, unknown>).newState === 'idle'
      );
      expect(activated.length).toBeGreaterThan(0);
    });

    it('disables agents when level decreases', async () => {
      await registry.setLevelGate(3);
      expect(registry.getAgentState('signal-agent')).toBe('idle');

      await registry.setLevelGate(1);
      expect(registry.getAgentState('signal-agent')).toBe('disabled');
      expect(registry.getAgentState('cache-agent')).toBe('disabled');
      expect(registry.getAgentState('orchestrator-agent')).toBe('disabled');
    });
  });

  describe('Behavior Profile hot-reload', () => {
    it('applies updated profile to active agent via ConfigReloader', async () => {
      const profileStore = new InMemoryBehaviorProfileStore();
      await profileStore.save(orchestratorProfile);

      const reloader = new ConfigReloader(
        profileStore,
        bus,
        (agentId) => agentId === 'orchestrator-agent' ? orchestrator : undefined,
        (agentId) => agentId === 'orchestrator-agent' ? 'active' : undefined,
        { pollIntervalMs: 100 }
      );

      reloader.trackAgent('orchestrator-agent', orchestratorProfile.lastModified);

      const updatedProfile: BehaviorProfile = {
        ...orchestratorProfile,
        version: 2,
        lastModified: Date.now() + 1000,
        parameters: { ...orchestratorProfile.parameters, stepTimeoutMs: 10000 },
      };
      await profileStore.save(updatedProfile);

      // Should apply without error
      await reloader.checkForUpdates();

      // Verify no pending profile (it was applied immediately)
      expect(reloader.getPendingProfile('orchestrator-agent')).toBeUndefined();
    });

    it('queues profile for non-active agent, applies on activation', async () => {
      const profileStore = new InMemoryBehaviorProfileStore();
      await profileStore.save(orchestratorProfile);

      await orchestrator.onDeactivate();

      const reloader = new ConfigReloader(
        profileStore,
        bus,
        (agentId) => agentId === 'orchestrator-agent' ? orchestrator : undefined,
        (agentId) => agentId === 'orchestrator-agent' ? 'idle' : undefined,
        { pollIntervalMs: 100 }
      );

      reloader.trackAgent('orchestrator-agent', orchestratorProfile.lastModified);

      const updatedProfile: BehaviorProfile = {
        ...orchestratorProfile,
        version: 2,
        lastModified: Date.now() + 1000,
        parameters: { ...orchestratorProfile.parameters, stepTimeoutMs: 15000 },
      };
      await profileStore.save(updatedProfile);

      await reloader.checkForUpdates();
      expect(reloader.getPendingProfile('orchestrator-agent')).toBeDefined();

      // Simulate activation
      await reloader.onAgentActivated('orchestrator-agent');
      expect(reloader.getPendingProfile('orchestrator-agent')).toBeUndefined();
    });

    it('publishes config.apply-failed when onConfigUpdate throws', async () => {
      const profileStore = new InMemoryBehaviorProfileStore();
      await profileStore.save(walletProfile);

      const failingAgent = {
        id: 'wallet-agent',
        onConfigUpdate: vi.fn().mockRejectedValue(new Error('Config rejected')),
      };

      const reloader = new ConfigReloader(
        profileStore,
        bus,
        (agentId) => agentId === 'wallet-agent' ? failingAgent as unknown as WalletAgent : undefined,
        (agentId) => agentId === 'wallet-agent' ? 'active' : undefined,
        { pollIntervalMs: 100 }
      );

      reloader.trackAgent('wallet-agent', walletProfile.lastModified);

      const updatedProfile: BehaviorProfile = {
        ...walletProfile,
        version: 2,
        lastModified: Date.now() + 1000,
        parameters: { connectionTimeoutMs: -1 },
      };
      await profileStore.save(updatedProfile);

      const events: BusMessage[] = [];
      bus.subscribe('config.apply-failed', async (msg) => { events.push(msg); });

      await reloader.checkForUpdates();

      expect(events.length).toBe(1);
      const payload = events[0]!.payload as Record<string, unknown>;
      expect(payload.agentId).toBe('wallet-agent');
      expect(payload.reason).toBeDefined();
    });
  });
});
