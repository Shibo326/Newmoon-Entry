/**
 * ConfigReloader monitors BehaviorProfile changes and applies them to agents.
 * It polls the BehaviorProfileStore for profile updates and notifies active agents
 * within 5 seconds. For idle/error/disabled agents, it queues parameter application
 * until the agent transitions to active state.
 */

import { v4 as uuidv4 } from 'uuid';
import type { BehaviorProfile, BehaviorProfileStore } from '../types/config.js';
import type { Agent, AgentLifecycleState } from '../types/agent.js';
import type { MessageBus } from '../bus/message-bus.js';
import type { EventMessage } from '../types/messages.js';

// Timer type declarations for environment-agnostic usage
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(id: number): void;

export interface ConfigReloaderOptions {
  pollIntervalMs?: number; // default 5000
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * ConfigReloader polls the BehaviorProfileStore for changes and applies
 * updated profiles to agents. Active agents receive updates immediately;
 * idle/error/disabled agents receive updates on their next activation.
 */
export class ConfigReloader {
  private readonly store: BehaviorProfileStore;
  private readonly bus: MessageBus;
  private readonly agentProvider: (agentId: string) => Agent | undefined;
  private readonly stateProvider: (agentId: string) => AgentLifecycleState | undefined;
  private readonly pollIntervalMs: number;

  /** Tracks the last-known lastModified timestamp per agent */
  private lastKnownModified: Map<string, number> = new Map();

  /** Queued profiles for agents that were not active at the time of change */
  private pendingProfiles: Map<string, BehaviorProfile> = new Map();

  /** Set of agent IDs being tracked (registered for monitoring) */
  private trackedAgents: Set<string> = new Set();

  /** Timer handle for polling */
  private pollTimer: number | null = null;

  constructor(
    store: BehaviorProfileStore,
    bus: MessageBus,
    agentProvider: (agentId: string) => Agent | undefined,
    stateProvider: (agentId: string) => AgentLifecycleState | undefined,
    options?: ConfigReloaderOptions
  ) {
    this.store = store;
    this.bus = bus;
    this.agentProvider = agentProvider;
    this.stateProvider = stateProvider;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Register an agent ID for config change monitoring.
   * Optionally provide the current lastModified to seed the baseline.
   */
  trackAgent(agentId: string, currentLastModified?: number): void {
    this.trackedAgents.add(agentId);
    if (currentLastModified !== undefined) {
      this.lastKnownModified.set(agentId, currentLastModified);
    }
  }

  /**
   * Remove an agent ID from config change monitoring.
   */
  untrackAgent(agentId: string): void {
    this.trackedAgents.delete(agentId);
    this.lastKnownModified.delete(agentId);
    this.pendingProfiles.delete(agentId);
  }

  /**
   * Start polling for profile changes.
   */
  start(): void {
    if (this.pollTimer !== null) return; // Already running
    this.pollTimer = setInterval(() => {
      void this.checkForUpdates();
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling for profile changes.
   */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Called when an agent transitions to active state.
   * Applies any queued profile that was pending for this agent.
   */
  async onAgentActivated(agentId: string): Promise<void> {
    const pending = this.pendingProfiles.get(agentId);
    if (!pending) return;

    this.pendingProfiles.delete(agentId);

    const agent = this.agentProvider(agentId);
    if (!agent) return;

    await this.applyProfile(agent, pending);
  }

  /**
   * Manually trigger a check for profile updates (useful for testing).
   */
  async checkForUpdates(): Promise<void> {
    for (const agentId of this.trackedAgents) {
      try {
        const profile = await this.store.load(agentId);
        const lastKnown = this.lastKnownModified.get(agentId);

        // No change detected
        if (lastKnown !== undefined && profile.lastModified <= lastKnown) {
          continue;
        }

        // Change detected
        const state = this.stateProvider(agentId);

        if (state === 'active') {
          const agent = this.agentProvider(agentId);
          if (agent) {
            await this.applyProfile(agent, profile);
          }
        } else {
          // Queue for idle, error, or disabled agents (or if state unknown)
          this.pendingProfiles.set(agentId, profile);
          // Update lastKnownModified so we don't re-queue on next poll
          this.lastKnownModified.set(agentId, profile.lastModified);
        }
      } catch (_error) {
        // If loading fails (e.g., ProfileNotFoundError), skip this agent
        continue;
      }
    }
  }

  /**
   * Get the pending profile queued for an agent (for testing/inspection).
   */
  getPendingProfile(agentId: string): BehaviorProfile | undefined {
    return this.pendingProfiles.get(agentId);
  }

  /**
   * Apply a profile to an agent. On failure, retains previous params,
   * publishes a "config.apply-failed" event, and returns false.
   * On success, updates the lastKnownModified tracker and returns true.
   */
  private async applyProfile(agent: Agent, profile: BehaviorProfile): Promise<boolean> {
    try {
      await agent.onConfigUpdate(profile);
      // Success: update the tracked timestamp
      this.lastKnownModified.set(agent.id, profile.lastModified);
      return true;
    } catch (error: unknown) {
      // Failed: retain previous parameters (don't update lastKnownModified beyond what was set)
      // Publish config.apply-failed event
      const reason = error instanceof Error ? error.message : String(error);

      const failedEvent: EventMessage = {
        id: uuidv4(),
        sourceAgentId: 'config-reloader',
        targetAgentId: null,
        type: 'event',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'config.apply-failed',
        payload: {
          agentId: agent.id,
          version: profile.version,
          reason,
        },
      };

      await this.bus.publish(failedEvent);
      return false;
    }
  }
}

export default ConfigReloader;
