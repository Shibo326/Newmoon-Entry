/**
 * Monitor Agent metrics type definitions.
 */

import type { AgentLifecycleState } from './agent.js';

export interface MonitorMetrics {
  getAgentMetrics(agentId: string): AgentMetricsSnapshot;
  getSystemHealth(): SystemHealthStatus;
  getAllMetrics(): Map<string, AgentMetricsSnapshot>;
}

export interface AgentMetricsSnapshot {
  agentId: string;
  requestCount: number;
  avgResponseTimeMs: number;
  errorCount: number;
  lifecycleState: AgentLifecycleState;
  lastUpdated: number;
}

export type SystemHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
