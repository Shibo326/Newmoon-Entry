/**
 * System bootstrap and initialization entry point for NightScore Adaptive Agents.
 *
 * Creates all infrastructure (Message Bus, Agent Registry, Behavior Profile Store,
 * Adaptation Log), registers all 8 core agents with their default profiles and schemas,
 * loads Level Gate configuration, activates appropriate agents, and wires the
 * Monitor Agent to all bus events.
 *
 * Validates: Requirements 1.6, 13.1
 */

import { InMemoryMessageBus } from './bus/message-bus.js';
import { AgentRegistryImpl } from './registry/agent-registry.js';
import { InMemoryBehaviorProfileStore } from './config/behavior-profile-store.js';
import InMemoryAdaptationLog from './log/adaptation-log.js';
import { ConfigReloader } from './config/config-reloader.js';
import { StartupInitializer } from './registry/startup-initializer.js';

import { WalletAgent } from './agents/wallet-agent.js';
import { SignalAgent } from './agents/signal-agent.js';
import { ScoringAgent } from './agents/scoring-agent.js';
import { CredentialAgent } from './agents/credential-agent.js';
import { VerificationAgent } from './agents/verification-agent.js';
import { CacheAgent } from './agents/cache-agent.js';
import { MonitorAgent } from './agents/monitor-agent.js';
import { OrchestratorAgentImpl } from './agents/orchestrator-agent.js';

import type { WalletConnector, SessionStorage } from './agents/wallet-agent.js';
import type { CompactWitness } from './agents/signal-agent.js';
import type { GroqClient } from './agents/scoring-agent.js';
import type { CompactContract } from './agents/credential-agent.js';
import type { VerificationContract } from './agents/verification-agent.js';
import type { CacheStore } from './agents/cache-agent.js';
import type { BehaviorProfile } from './types/config.js';
import type { JSONSchema, LevelGate } from './types/registry.js';

// ─── Stub/Noop External Service Implementations ────────────────────────────────

/**
 * Stub WalletConnector that simulates a no-op Lace Wallet connection.
 */
const stubWalletConnector: WalletConnector = {
  async connect(_timeoutMs: number) {
    return { address: 'stub-wallet-address' };
  },
  async disconnect() {},
  isConnected() { return false; },
  getAddress() { return null; },
  onDisconnect(_callback: () => void) {},
};

/**
 * Stub SessionStorage for the Wallet Agent (in-memory key-value).
 */
const stubSessionStorage: SessionStorage = (() => {
  const store = new Map<string, string>();
  return {
    get(key: string) { return store.get(key) ?? null; },
    set(key: string, value: string) { store.set(key, value); },
    remove(key: string) { store.delete(key); },
  };
})();

/**
 * Stub CompactWitness that returns default signal results.
 */
const stubCompactWitness: CompactWitness = {
  async readSignal(_walletAddress, _signalType) {
    return { value: 50, transactionCount: 5 };
  },
  async isWalletConnected(_walletAddress) {
    return true;
  },
};

/**
 * Stub GroqClient that returns a hardcoded scoring response.
 */
const stubGroqClient: GroqClient = {
  async createCompletion(_params: {
    model: string;
    temperature: number;
    messages: Array<{ role: string; content: string }>;
    timeoutMs: number;
  }) {
    return {
      content: JSON.stringify({
        grade: 'BBB',
        reasoning: [
          { signal: 'walletAge', direction: 'positive', weight: 0.2 },
          { signal: 'transactionFrequency', direction: 'positive', weight: 0.15 },
          { signal: 'defiInteractions', direction: 'positive', weight: 0.2 },
          { signal: 'repaymentHistory', direction: 'positive', weight: 0.25 },
          { signal: 'assetDiversity', direction: 'positive', weight: 0.1 },
          { signal: 'liquidationHistory', direction: 'negative', weight: 0.1 },
        ],
      }),
    };
  },
};

/**
 * Stub CompactContract for minting/revoking credentials.
 */
const stubCompactContract: CompactContract = {
  async mint(_params: { walletAddress: string; creditGrade: string; proofHash: string }) {
    return { txHash: 'stub-tx-hash-' + Date.now(), mintTimestamp: Date.now() };
  },
  async revoke(_walletAddress: string) {},
  async hasCredential(_walletAddress: string) { return false; },
};

/**
 * Stub VerificationContract for threshold queries.
 */
const stubVerificationContract: VerificationContract = {
  async getCredentialGrade(_walletAddress: string) { return null; },
  async isAvailable() { return true; },
};

/**
 * Stub CacheStore (in-memory) for the Cache Agent.
 */
const stubCacheStore: CacheStore = (() => {
  const cache = new Map<string, {
    walletAddress: string;
    signalHash: string;
    creditGrade: string;
    reasoning: Record<string, unknown>[];
    computedAt: number;
  }>();
  return {
    async get(walletAddress: string, signalHash: string) {
      const key = `${walletAddress}:${signalHash}`;
      return cache.get(key) ?? null;
    },
    async set(entry: {
      walletAddress: string;
      signalHash: string;
      creditGrade: string;
      reasoning: Record<string, unknown>[];
      computedAt: number;
    }) {
      const key = `${entry.walletAddress}:${entry.signalHash}`;
      cache.set(key, entry);
    },
  };
})();

// ─── Default Behavior Profiles ─────────────────────────────────────────────────

const DEFAULT_PROFILES: Record<string, BehaviorProfile> = {
  'orchestrator-agent': {
    agentId: 'orchestrator-agent',
    version: 1,
    parameters: {
      maxConcurrentWorkflows: 10,
      queueLimit: 50,
      queueResumeAt: 40,
      workflowTimeoutMs: 120000,
      stepTimeoutMs: 30000,
    },
    lastModified: Date.now(),
  },
  'wallet-agent': {
    agentId: 'wallet-agent',
    version: 1,
    parameters: {
      connectionTimeoutMs: 30000,
      sessionStorageKey: 'ns_wallet_session',
    },
    lastModified: Date.now(),
  },
  'signal-agent': {
    agentId: 'signal-agent',
    version: 1,
    parameters: {
      readTimeoutMs: 5000,
      defaultSignalValue: 0.5,
      minTransactionsForSignal: 3,
    },
    lastModified: Date.now(),
  },
  'scoring-agent': {
    agentId: 'scoring-agent',
    version: 1,
    parameters: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      apiTimeoutMs: 5000,
      dailyRateLimit: 14400,
    },
    lastModified: Date.now(),
  },
  'credential-agent': {
    agentId: 'credential-agent',
    version: 1,
    parameters: {
      maxRetries: 3,
      backoffBaseMs: 1000,
      mintTimeoutMs: 60000,
    },
    lastModified: Date.now(),
  },
  'verification-agent': {
    agentId: 'verification-agent',
    version: 1,
    parameters: {
      queryTimeoutMs: 3000,
      contractTimeoutMs: 2000,
    },
    lastModified: Date.now(),
  },
  'cache-agent': {
    agentId: 'cache-agent',
    version: 1,
    parameters: {
      ttlMs: 86400000,
      maxRetries: 2,
      retryDelayMs: 500,
      connectionPoolSize: 5,
    },
    lastModified: Date.now(),
  },
  'monitor-agent': {
    agentId: 'monitor-agent',
    version: 1,
    parameters: {
      healthCheckIntervalMs: 30000,
      errorThreshold: 5,
      errorWindowMs: 600000,
      metricsUpdateIntervalMs: 10000,
      maxBufferedEntries: 500,
    },
    lastModified: Date.now(),
  },
};

// ─── Default JSON Schemas (permissive — accepts any parameters) ────────────────

const DEFAULT_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: true,
};

// ─── NightScore System Interface ───────────────────────────────────────────────

export interface NightScoreSystem {
  bus: InMemoryMessageBus;
  registry: AgentRegistryImpl;
  profileStore: InMemoryBehaviorProfileStore;
  adaptationLog: InMemoryAdaptationLog;
  configReloader: ConfigReloader;
}

export interface BootstrapOptions {
  levelGate?: LevelGate;
  walletConnector?: WalletConnector;
  sessionStorage?: SessionStorage;
  compactWitness?: CompactWitness;
  groqClient?: GroqClient;
  compactContract?: CompactContract;
  verificationContract?: VerificationContract;
  cacheStore?: CacheStore;
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Bootstrap the NightScore adaptive agents system.
 *
 * Creates all infrastructure, registers all 8 core agents with default profiles,
 * initializes agents, sets the level gate, activates appropriate agents, and
 * wires the Monitor Agent's subscriptions to all bus events.
 *
 * Initialization completes within 30 seconds (enforced by StartupInitializer).
 */
export async function bootstrap(options?: BootstrapOptions): Promise<NightScoreSystem> {
  const opts = options ?? {};

  // 1. Create infrastructure
  const bus = new InMemoryMessageBus();
  const registry = new AgentRegistryImpl(bus);
  const profileStore = new InMemoryBehaviorProfileStore();
  const adaptationLog = new InMemoryAdaptationLog();

  const configReloader = new ConfigReloader(
    profileStore,
    bus,
    (id) => registry.getAgent(id),
    (id) => registry.getAgentState(id),
  );

  // 2. Wire bus agent state provider for message buffering
  bus.setAgentStateProvider((id) => registry.getAgentState(id));

  // 3. Create all 8 core agents with provided or stub dependencies
  const walletAgent = new WalletAgent(
    bus,
    opts.walletConnector ?? stubWalletConnector,
    opts.sessionStorage ?? stubSessionStorage,
  );

  const signalAgent = new SignalAgent(
    bus,
    opts.compactWitness ?? stubCompactWitness,
  );

  const scoringAgent = new ScoringAgent(
    bus,
    opts.groqClient ?? stubGroqClient,
  );

  const credentialAgent = new CredentialAgent(
    bus,
    opts.compactContract ?? stubCompactContract,
  );

  const verificationAgent = new VerificationAgent(
    bus,
    opts.verificationContract ?? stubVerificationContract,
  );

  const cacheAgent = new CacheAgent(
    bus,
    opts.cacheStore ?? stubCacheStore,
  );

  const monitorAgent = new MonitorAgent(
    bus,
    adaptationLog,
    (id) => registry.getAgent(id),
  );

  const orchestratorAgent = new OrchestratorAgentImpl(bus);

  // 4. Seed default profiles into the profile store and register schemas
  const agents = [
    walletAgent,
    signalAgent,
    scoringAgent,
    credentialAgent,
    verificationAgent,
    cacheAgent,
    monitorAgent,
    orchestratorAgent,
  ];

  for (const agent of agents) {
    const profile = DEFAULT_PROFILES[agent.id]!;
    await profileStore.save(profile);
    profileStore.registerSchema(agent.id, DEFAULT_SCHEMA);
  }

  // 5. Register all 8 agents with the registry
  for (const agent of agents) {
    const profile = DEFAULT_PROFILES[agent.id]!;
    await registry.register(agent, profile, DEFAULT_SCHEMA);
  }

  // 6. Initialize all agents via StartupInitializer (enforces 30s timeout)
  const initializer = new StartupInitializer({
    registry,
    profileStore,
    messageBus: bus,
    configReloader,
  });

  const agentIds = agents.map((a) => a.id);
  await initializer.initializeAll(agentIds);

  // 7. Set level gate and activate appropriate agents
  const level = opts.levelGate ?? 1;
  await registry.setLevelGate(level);

  // Activate agents that are allowed at this level (transition idle → active)
  const allowedAgents = registry.getActiveAgentsForLevel(level);
  for (const agentId of allowedAgents) {
    const state = registry.getAgentState(agentId);
    if (state === 'idle') {
      await registry.transitionState(agentId, 'active');
      // Apply any pending config that was queued during initialization
      await configReloader.onAgentActivated(agentId);
    }
  }

  // 8. Wire Monitor Agent subscriptions to all bus events
  //    The MonitorAgent subscribes during onActivate(), but if it wasn't activated
  //    at the current level, we still need its event subscription wired.
  const monitorState = registry.getAgentState('monitor-agent');
  if (monitorState !== 'active') {
    // Even if monitor-agent isn't at the current level gate, initialize its
    // bus subscription so it can record events when later activated.
    await monitorAgent.initialize(DEFAULT_PROFILES['monitor-agent']!);
  }

  // 9. Start config reloader for hot-reload polling
  configReloader.start();

  return { bus, registry, profileStore, adaptationLog, configReloader };
}

// ─── Re-exports ────────────────────────────────────────────────────────────────

export { InMemoryMessageBus } from './bus/message-bus.js';
export { AgentRegistryImpl } from './registry/agent-registry.js';
export { InMemoryBehaviorProfileStore } from './config/behavior-profile-store.js';
export { default as InMemoryAdaptationLog } from './log/adaptation-log.js';
export { ConfigReloader } from './config/config-reloader.js';
export { StartupInitializer } from './registry/startup-initializer.js';
export { WalletAgent } from './agents/wallet-agent.js';
export { SignalAgent } from './agents/signal-agent.js';
export { ScoringAgent } from './agents/scoring-agent.js';
export { CredentialAgent } from './agents/credential-agent.js';
export { VerificationAgent } from './agents/verification-agent.js';
export { CacheAgent } from './agents/cache-agent.js';
export { MonitorAgent } from './agents/monitor-agent.js';
export { OrchestratorAgentImpl } from './agents/orchestrator-agent.js';
export { DEFAULT_PROFILES };
