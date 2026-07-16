/**
 * Agent Registry type definitions.
 */

import type { Agent, AgentCapability, AgentLifecycleState } from './agent.js';
import type { BehaviorProfile } from './config.js';

export interface AgentRegistry {
  register(plugin: Agent, defaultProfile: BehaviorProfile, schema: JSONSchema): Promise<void>;
  unregister(agentId: string): Promise<void>;
  getAgent(agentId: string): Agent | undefined;
  queryAgents(filter: AgentFilter): Agent[];
  getAgentState(agentId: string): AgentLifecycleState | undefined;
  updateProfile(agentId: string, profile: BehaviorProfile): Promise<void>;
  setLevelGate(level: LevelGate): Promise<void>;
  getLevelGate(): LevelGate;
}

export interface AgentFilter {
  state?: AgentLifecycleState;
  capability?: string;
  level?: LevelGate;
}

export interface AgentRegistryEntry {
  agent: Agent;
  id: string;
  name: string;
  capabilities: AgentCapability[];
  state: AgentLifecycleState;
  profileRef: string;
  registeredAt: number;
  profileSchema: JSONSchema;
}

export type LevelGate = 1 | 2 | 3 | 4 | 5 | 6;

export type JSONSchema = Record<string, unknown>;
