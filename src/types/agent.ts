/**
 * Core Agent interface and related type definitions.
 */

import type { BusMessage, ResponseMessage, ErrorMessage } from './messages.js';
import type { BehaviorProfile } from './config.js';

export interface Agent {
  readonly id: string;
  readonly name: string;

  handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage>;
  getHealth(): AgentHealth;
  getCapabilities(): AgentCapability[];
  initialize(profile: BehaviorProfile): Promise<void>;

  onActivate(): Promise<void>;
  onDeactivate(): Promise<void>;
  onConfigUpdate(profile: BehaviorProfile): Promise<void>;

  dependencies?: string[];
}

export interface AgentHealth {
  state: AgentLifecycleState;
  uptimeSeconds: number;
  requestCount: number;
  errorCount: number;
  avgResponseTimeMs: number;
}

export interface AgentCapability {
  topic: string;
  description: string;
}

export type AgentLifecycleState = 'idle' | 'active' | 'error' | 'disabled';
