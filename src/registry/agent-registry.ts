/**
 * Agent Registry implementation.
 * Manages agent registration, lifecycle state transitions, query filtering,
 * level-gated activation, dependency verification, and capability override routing.
 * Emits state-change events on the Message Bus for all lifecycle transitions.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentLifecycleState } from '../types/agent.js';
import type { BehaviorProfile } from '../types/config.js';
import type {
  AgentRegistry,
  AgentFilter,
  AgentRegistryEntry,
  JSONSchema,
  LevelGate,
} from '../types/registry.js';
import type { MessageBus } from '../bus/message-bus.js';
import type { EventMessage } from '../types/messages.js';

/**
 * Valid lifecycle state transitions based on the state machine.
 * Map of current state → set of valid next states.
 */
const VALID_TRANSITIONS: Record<AgentLifecycleState, Set<AgentLifecycleState>> = {
  idle: new Set(['active', 'disabled']),
  active: new Set(['idle', 'error']),
  error: new Set(['idle', 'disabled']),
  disabled: new Set(['idle']),
};

/**
 * Level Gate mapping: defines which agent IDs are active at each level.
 * Agents not in the allowed set for the current level are disabled.
 */
const LEVEL_GATE_MAP: Record<LevelGate, string[]> = {
  1: ['wallet-agent', 'credential-agent'],
  2: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent'],
  3: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent', 'signal-agent', 'cache-agent', 'monitor-agent'],
  4: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent', 'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent'],
  5: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent', 'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent'],
  6: ['wallet-agent', 'credential-agent', 'orchestrator-agent', 'scoring-agent', 'signal-agent', 'cache-agent', 'monitor-agent', 'verification-agent'],
};

/**
 * Required methods that an Agent plugin must implement for registration.
 */
const REQUIRED_METHODS = ['handleMessage', 'getHealth', 'getCapabilities', 'initialize'] as const;

/**
 * Error thrown when agent registration fails due to missing interface methods.
 */
export class RegistrationError extends Error {
  public readonly missingMethods: string[];

  constructor(missingMethods: string[]) {
    const message = `Agent registration failed: missing required methods: ${missingMethods.join(', ')}`;
    super(message);
    this.name = 'RegistrationError';
    this.missingMethods = missingMethods;
  }
}

/**
 * Error thrown when an invalid lifecycle state transition is attempted.
 */
export class InvalidTransitionError extends Error {
  constructor(agentId: string, fromState: AgentLifecycleState, toState: AgentLifecycleState) {
    super(
      `Invalid state transition for agent "${agentId}": ${fromState} → ${toState}`
    );
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Error thrown when dependency verification fails during agent activation.
 */
export class DependencyUnsatisfiedError extends Error {
  public readonly agentId: string;
  public readonly missingCapabilities: string[];

  constructor(agentId: string, missingCapabilities: string[]) {
    super(
      `Cannot activate agent "${agentId}": unsatisfied dependencies: ${missingCapabilities.join(', ')}`
    );
    this.name = 'DependencyUnsatisfiedError';
    this.agentId = agentId;
    this.missingCapabilities = missingCapabilities;
  }
}

/**
 * In-memory Agent Registry with lifecycle management, level-gated activation,
 * dependency verification, capability override routing, and message bus integration.
 */
export class AgentRegistryImpl implements AgentRegistry {
  private catalog: Map<string, AgentRegistryEntry> = new Map();
  private registrationOrderMap: Map<string, number> = new Map();
  private levelGate: LevelGate = 1;
  private readonly messageBus: MessageBus;
  private registrationOrder = 0;

  constructor(messageBus: MessageBus) {
    this.messageBus = messageBus;
  }

  /**
   * Register a new agent plugin.
   * Validates that the plugin implements all required Agent interface methods.
   * Detects capability overlaps and emits override events.
   * Stores the agent entry and emits a state-change event.
   */
  async register(plugin: Agent, defaultProfile: BehaviorProfile, schema: JSONSchema): Promise<void> {
    const missingMethods = this.validateAgentInterface(plugin);
    if (missingMethods.length > 0) {
      throw new RegistrationError(missingMethods);
    }

    const newCapabilities = plugin.getCapabilities();

    // Detect capability overlaps with existing agents
    const overlaps = this.detectCapabilityOverlaps(plugin.id, newCapabilities);

    const entry: AgentRegistryEntry = {
      agent: plugin,
      id: plugin.id,
      name: plugin.name,
      capabilities: newCapabilities,
      state: 'idle',
      profileRef: defaultProfile.agentId,
      registeredAt: Date.now(),
      profileSchema: schema,
    };

    this.catalog.set(plugin.id, entry);
    this.registrationOrderMap.set(plugin.id, ++this.registrationOrder);

    // Emit capability-override events for each overlapping topic
    for (const overlap of overlaps) {
      await this.emitCapabilityOverrideEvent(overlap.topic, overlap.previousAgentId, plugin.id);
    }

    await this.emitStateChangeEvent(plugin.id, undefined, 'idle');
  }

  /**
   * Unregister an agent by ID.
   * Transitions to disabled state, emits event, then removes from catalog.
   * Also checks if any active agents depended on capabilities this agent provided.
   */
  async unregister(agentId: string): Promise<void> {
    const entry = this.catalog.get(agentId);
    if (!entry) return;

    const previousState = entry.state;
    entry.state = 'disabled';

    await this.emitStateChangeEvent(agentId, previousState, 'disabled');

    this.catalog.delete(agentId);
    this.registrationOrderMap.delete(agentId);
    await this.handleDependencyLoss(agentId, entry.capabilities.map(c => c.topic));
  }

  /**
   * Get a registered agent by ID.
   */
  getAgent(agentId: string): Agent | undefined {
    return this.catalog.get(agentId)?.agent;
  }

  /**
   * Query agents with filtering by state, capability topic, and level gate.
   * Returns agents matching ALL specified filter criteria.
   */
  queryAgents(filter: AgentFilter): Agent[] {
    const results: Agent[] = [];

    for (const entry of this.catalog.values()) {
      if (filter.state !== undefined && entry.state !== filter.state) {
        continue;
      }

      if (filter.capability !== undefined) {
        const hasCapability = entry.capabilities.some(
          (cap) => cap.topic === filter.capability
        );
        if (!hasCapability) {
          continue;
        }
      }

      if (filter.level !== undefined && filter.level > this.levelGate) {
        continue;
      }

      results.push(entry.agent);
    }

    return results;
  }

  /**
   * Get the lifecycle state of a registered agent.
   */
  getAgentState(agentId: string): AgentLifecycleState | undefined {
    return this.catalog.get(agentId)?.state;
  }

  /**
   * Update the behavior profile for a registered agent.
   * Emits a state-change event to notify observers of the update.
   */
  async updateProfile(agentId: string, profile: BehaviorProfile): Promise<void> {
    const entry = this.catalog.get(agentId);
    if (!entry) return;

    entry.profileRef = profile.agentId;

    await this.emitStateChangeEvent(agentId, entry.state, entry.state);
  }

  /**
   * Set the current level gate for the system.
   * Activates/deactivates agents based on the level gate mapping.
   * Agents now included in the level are transitioned from disabled to idle.
   * Agents no longer included are transitioned from idle/active to disabled.
   * Emits state-change events for each affected agent.
   */
  async setLevelGate(level: LevelGate): Promise<void> {
    const previousLevel = this.levelGate;
    this.levelGate = level;

    const allowedAgents = new Set(LEVEL_GATE_MAP[level]);
    const previousAllowed = new Set(LEVEL_GATE_MAP[previousLevel]);

    for (const entry of this.catalog.values()) {
      const isNowAllowed = allowedAgents.has(entry.id);
      const wasPreviouslyAllowed = previousAllowed.has(entry.id);

      if (isNowAllowed && !wasPreviouslyAllowed) {
        // Agent is now included: transition from disabled to idle
        if (entry.state === 'disabled') {
          const previousState = entry.state;
          entry.state = 'idle';
          await this.emitStateChangeEvent(entry.id, previousState, 'idle');
        }
      } else if (!isNowAllowed && wasPreviouslyAllowed) {
        // Agent is no longer included: transition to disabled
        if (entry.state === 'idle' || entry.state === 'active') {
          const previousState = entry.state;
          entry.state = 'disabled';
          await this.emitStateChangeEvent(entry.id, previousState, 'disabled');

          // Check dependent agents when an agent is disabled by level gate
          await this.handleDependencyLoss(entry.id, entry.capabilities.map(c => c.topic));
        }
      }
    }
  }

  /**
   * Get the current level gate.
   */
  getLevelGate(): LevelGate {
    return this.levelGate;
  }

  /**
   * Get the list of agent IDs that are active/allowed at a given level.
   * Useful for testing the level gate mapping.
   */
  getActiveAgentsForLevel(level: LevelGate): string[] {
    return [...(LEVEL_GATE_MAP[level] ?? [])];
  }

  /**
   * Force an agent into a specific lifecycle state, bypassing normal transition validation.
   * Used during startup initialization when an agent fails to initialize (idle→error
   * is not a valid normal transition, but is needed for initialization failure handling).
   * Emits a state-change event.
   */
  async forceState(agentId: string, newState: AgentLifecycleState): Promise<void> {
    const entry = this.catalog.get(agentId);
    if (!entry) return;

    const previousState = entry.state;
    entry.state = newState;

    await this.emitStateChangeEvent(agentId, previousState, newState);
  }

  /**
   * Transition an agent to a new lifecycle state.
   * Validates the transition against the state machine.
   * When transitioning to 'active', verifies dependencies are satisfiable.
   * When transitioning away from active/idle, checks dependent agents.
   * Emits a state-change event.
   */
  async transitionState(agentId: string, newState: AgentLifecycleState): Promise<void> {
    const entry = this.catalog.get(agentId);
    if (!entry) return;

    const currentState = entry.state;

    const validNext = VALID_TRANSITIONS[currentState];
    if (!validNext || !validNext.has(newState)) {
      throw new InvalidTransitionError(agentId, currentState, newState);
    }

    // Dependency verification when activating
    if (newState === 'active') {
      const unsatisfied = this.verifyDependencies(entry);
      if (unsatisfied.length > 0) {
        throw new DependencyUnsatisfiedError(agentId, unsatisfied);
      }
    }

    const previousState = entry.state;
    entry.state = newState;

    await this.emitStateChangeEvent(agentId, previousState, newState);

    // If an agent transitions away from active state, check dependent agents
    if (previousState === 'active' && (newState === 'error' || newState === 'idle')) {
      await this.handleDependencyLoss(agentId, entry.capabilities.map(c => c.topic));
    }
  }

  /**
   * Resolve which agent should handle a given capability topic.
   * Routes to the most recently registered agent when overlapping capabilities exist.
   */
  resolveCapability(topic: string): Agent | undefined {
    let latestEntry: AgentRegistryEntry | undefined;
    let latestOrder = -1;

    for (const entry of this.catalog.values()) {
      if (entry.state !== 'active' && entry.state !== 'idle') continue;
      const hasCapability = entry.capabilities.some(cap => cap.topic === topic);
      if (hasCapability) {
        const order = this.registrationOrderMap.get(entry.id) ?? 0;
        if (order > latestOrder) {
          latestOrder = order;
          latestEntry = entry;
        }
      }
    }

    return latestEntry?.agent;
  }

  /**
   * Validate that a plugin object implements all required Agent interface methods.
   * Returns an array of missing method names.
   */
  private validateAgentInterface(plugin: unknown): string[] {
    const missing: string[] = [];
    const obj = plugin as Record<string, unknown>;

    for (const method of REQUIRED_METHODS) {
      if (typeof obj[method] !== 'function') {
        missing.push(method);
      }
    }

    return missing;
  }

  /**
   * Detect capability overlaps between a new agent's capabilities and existing agents.
   * Returns an array of overlaps with the topic and the ID of the previously registered agent.
   */
  private detectCapabilityOverlaps(
    newAgentId: string,
    newCapabilities: { topic: string }[]
  ): { topic: string; previousAgentId: string }[] {
    const overlaps: { topic: string; previousAgentId: string }[] = [];

    for (const cap of newCapabilities) {
      for (const entry of this.catalog.values()) {
        if (entry.id === newAgentId) continue;
        const hasOverlap = entry.capabilities.some(c => c.topic === cap.topic);
        if (hasOverlap) {
          overlaps.push({ topic: cap.topic, previousAgentId: entry.id });
        }
      }
    }

    return overlaps;
  }

  /**
   * Verify that all declared dependencies of an agent are satisfiable.
   * A dependency is satisfied if at least one agent in active or idle state
   * exposes the required capability topic.
   * Returns the list of unsatisfied capability IDs.
   */
  private verifyDependencies(entry: AgentRegistryEntry): string[] {
    const dependencies = entry.agent.dependencies;
    if (!dependencies || dependencies.length === 0) return [];

    const unsatisfied: string[] = [];

    for (const requiredCapability of dependencies) {
      let found = false;
      for (const otherEntry of this.catalog.values()) {
        if (otherEntry.id === entry.id) continue;
        if (otherEntry.state !== 'active' && otherEntry.state !== 'idle') continue;
        const providesCapability = otherEntry.capabilities.some(
          cap => cap.topic === requiredCapability
        );
        if (providesCapability) {
          found = true;
          break;
        }
      }
      if (!found) {
        unsatisfied.push(requiredCapability);
      }
    }

    return unsatisfied;
  }

  /**
   * Handle the loss of capabilities provided by an agent.
   * When an agent is disabled/unregistered/errored, any active agents that depend
   * on its capabilities are transitioned to idle.
   */
  private async handleDependencyLoss(lostAgentId: string, lostCapabilities: string[]): Promise<void> {
    if (lostCapabilities.length === 0) return;

    for (const entry of this.catalog.values()) {
      if (entry.id === lostAgentId) continue;
      if (entry.state !== 'active') continue;

      const deps = entry.agent.dependencies;
      if (!deps || deps.length === 0) continue;

      // Check if any of this agent's dependencies are now unsatisfied
      for (const dep of deps) {
        if (!lostCapabilities.includes(dep)) continue;

        // Verify if the dependency is still satisfiable by another agent
        const stillProvided = this.isCapabilityProvided(dep, entry.id, lostAgentId);
        if (!stillProvided) {
          // Transition dependent agent to idle
          const previousState = entry.state;
          entry.state = 'idle';
          await this.emitStateChangeEvent(entry.id, previousState, 'idle');
          await this.emitDependencyUnavailableEvent(entry.id, dep, lostAgentId);
          break; // Only need to transition once
        }
      }
    }
  }

  /**
   * Check if a capability is provided by any agent other than the excluded ones.
   */
  private isCapabilityProvided(capability: string, excludeAgentId: string, lostAgentId: string): boolean {
    for (const entry of this.catalog.values()) {
      if (entry.id === excludeAgentId || entry.id === lostAgentId) continue;
      if (entry.state !== 'active' && entry.state !== 'idle') continue;
      const provides = entry.capabilities.some(cap => cap.topic === capability);
      if (provides) return true;
    }
    return false;
  }

  /**
   * Emit a state-change event on the message bus.
   */
  private async emitStateChangeEvent(
    agentId: string,
    previousState: AgentLifecycleState | undefined,
    newState: AgentLifecycleState
  ): Promise<void> {
    const event: EventMessage = {
      id: uuidv4(),
      sourceAgentId: 'agent-registry',
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic: 'registry.state-change',
      payload: {
        agentId,
        previousState: previousState ?? null,
        newState,
        timestamp: Date.now(),
      },
    };

    await this.messageBus.publish(event);
  }

  /**
   * Emit a capability-override event when a newly registered agent
   * provides capabilities that overlap with an existing agent.
   */
  private async emitCapabilityOverrideEvent(
    topic: string,
    previousAgentId: string,
    newAgentId: string
  ): Promise<void> {
    const event: EventMessage = {
      id: uuidv4(),
      sourceAgentId: 'agent-registry',
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic: 'registry.capability-override',
      payload: {
        topic,
        previousAgentId,
        newAgentId,
      },
    };

    await this.messageBus.publish(event);
  }

  /**
   * Emit an alert.dependency-unavailable event when a dependency becomes unsatisfiable.
   */
  private async emitDependencyUnavailableEvent(
    dependentAgentId: string,
    capability: string,
    lostAgentId: string
  ): Promise<void> {
    const event: EventMessage = {
      id: uuidv4(),
      sourceAgentId: 'agent-registry',
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic: 'alert.dependency-unavailable',
      payload: {
        dependentAgentId,
        capability,
        lostAgentId,
        timestamp: Date.now(),
      },
    };

    await this.messageBus.publish(event);
  }
}

export default AgentRegistryImpl;
