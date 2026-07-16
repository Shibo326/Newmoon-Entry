/**
 * Agent Factory and Plugin Registration Utilities.
 *
 * Provides a factory for constructing agent instances with their dependencies injected,
 * and a utility for runtime plugin registration.
 *
 * Validates: Requirements 14.3, 14.4, 14.5
 */

import type { MessageBus } from '../bus/message-bus.js';
import type { Agent } from '../types/agent.js';
import type { BehaviorProfile } from '../types/config.js';
import type { AdaptationLog } from '../types/log.js';
import type { JSONSchema } from '../types/registry.js';
import type { AgentRegistryImpl } from '../registry/agent-registry.js';

import type { WalletConnector, SessionStorage } from './wallet-agent.js';
import type { CompactWitness } from './signal-agent.js';
import type { GroqClient } from './scoring-agent.js';
import type { CompactContract } from './credential-agent.js';
import type { VerificationContract } from './verification-agent.js';
import type { CacheStore } from './cache-agent.js';

import { WalletAgent } from './wallet-agent.js';
import { SignalAgent } from './signal-agent.js';
import { ScoringAgent } from './scoring-agent.js';
import { CredentialAgent } from './credential-agent.js';
import { VerificationAgent } from './verification-agent.js';
import { CacheAgent } from './cache-agent.js';
import { MonitorAgent } from './monitor-agent.js';
import { OrchestratorAgentImpl } from './orchestrator-agent.js';

/**
 * Dependencies required by the AgentFactory to construct agents.
 */
export interface AgentDependencies {
  bus: MessageBus;
  walletConnector?: WalletConnector;
  sessionStorage?: SessionStorage;
  compactWitness?: CompactWitness;
  groqClient?: GroqClient;
  compactContract?: CompactContract;
  verificationContract?: VerificationContract;
  cacheStore?: CacheStore;
  adaptationLog?: AdaptationLog;
  agentProvider?: (agentId: string) => Agent | undefined;
}

/**
 * Default permissive JSON schema for agents that don't specify one.
 */
const DEFAULT_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: true,
};

/**
 * Factory for creating agent instances with their dependencies injected.
 *
 * Encapsulates the construction logic for all 8 core agents, ensuring consistent
 * dependency injection and reducing boilerplate in system bootstrap code.
 */
export class AgentFactory {
  private readonly deps: AgentDependencies;

  constructor(deps: AgentDependencies) {
    this.deps = deps;
  }

  /**
   * Create a Wallet Agent instance.
   * Requires: bus, walletConnector, sessionStorage
   */
  createWalletAgent(): WalletAgent {
    if (!this.deps.walletConnector) {
      throw new Error('AgentFactory: walletConnector dependency is required to create WalletAgent');
    }
    if (!this.deps.sessionStorage) {
      throw new Error('AgentFactory: sessionStorage dependency is required to create WalletAgent');
    }
    return new WalletAgent(
      this.deps.bus,
      this.deps.walletConnector,
      this.deps.sessionStorage,
    );
  }

  /**
   * Create a Signal Agent instance.
   * Requires: bus, compactWitness
   */
  createSignalAgent(): SignalAgent {
    if (!this.deps.compactWitness) {
      throw new Error('AgentFactory: compactWitness dependency is required to create SignalAgent');
    }
    return new SignalAgent(
      this.deps.bus,
      this.deps.compactWitness,
    );
  }

  /**
   * Create a Scoring Agent instance.
   * Requires: bus, groqClient
   */
  createScoringAgent(): ScoringAgent {
    if (!this.deps.groqClient) {
      throw new Error('AgentFactory: groqClient dependency is required to create ScoringAgent');
    }
    return new ScoringAgent(
      this.deps.bus,
      this.deps.groqClient,
    );
  }

  /**
   * Create a Credential Agent instance.
   * Requires: bus, compactContract
   */
  createCredentialAgent(): CredentialAgent {
    if (!this.deps.compactContract) {
      throw new Error('AgentFactory: compactContract dependency is required to create CredentialAgent');
    }
    return new CredentialAgent(
      this.deps.bus,
      this.deps.compactContract,
    );
  }

  /**
   * Create a Verification Agent instance.
   * Requires: bus, verificationContract
   */
  createVerificationAgent(): VerificationAgent {
    if (!this.deps.verificationContract) {
      throw new Error('AgentFactory: verificationContract dependency is required to create VerificationAgent');
    }
    return new VerificationAgent(
      this.deps.bus,
      this.deps.verificationContract,
    );
  }

  /**
   * Create a Cache Agent instance.
   * Requires: bus, cacheStore
   */
  createCacheAgent(): CacheAgent {
    if (!this.deps.cacheStore) {
      throw new Error('AgentFactory: cacheStore dependency is required to create CacheAgent');
    }
    return new CacheAgent(
      this.deps.bus,
      this.deps.cacheStore,
    );
  }

  /**
   * Create a Monitor Agent instance.
   * Requires: bus, adaptationLog, agentProvider
   */
  createMonitorAgent(): MonitorAgent {
    if (!this.deps.adaptationLog) {
      throw new Error('AgentFactory: adaptationLog dependency is required to create MonitorAgent');
    }
    if (!this.deps.agentProvider) {
      throw new Error('AgentFactory: agentProvider dependency is required to create MonitorAgent');
    }
    return new MonitorAgent(
      this.deps.bus,
      this.deps.adaptationLog,
      this.deps.agentProvider,
    );
  }

  /**
   * Create an Orchestrator Agent instance.
   * Requires: bus
   */
  createOrchestratorAgent(): OrchestratorAgentImpl {
    return new OrchestratorAgentImpl(this.deps.bus);
  }
}

/**
 * Register a custom plugin agent at runtime.
 *
 * Registers the agent with the Agent Registry using the provided default profile
 * and optional JSON schema. The agent becomes available for message routing
 * within 5 seconds without requiring a system restart.
 *
 * Validates: Requirement 14.3 (registerable with module, default profile, and schema)
 * Validates: Requirement 14.5 (available for routing within 5 seconds)
 *
 * @param registry - The Agent Registry to register the plugin with
 * @param plugin - The agent implementing the Agent interface
 * @param defaultProfile - Default Behavior Profile for the agent
 * @param schema - Optional JSON schema defining valid profile parameters
 */
export async function registerPlugin(
  registry: AgentRegistryImpl,
  plugin: Agent,
  defaultProfile: BehaviorProfile,
  schema?: JSONSchema,
): Promise<void> {
  const profileSchema = schema ?? DEFAULT_SCHEMA;
  await registry.register(plugin, defaultProfile, profileSchema);
}
