/**
 * Adaptation Log type definitions.
 */

export interface AdaptationLog {
  write(entry: LogEntry): Promise<void>;
  query(filter: LogFilter): Promise<LogEntry[]>;
  getAgentSummary(agentId: string): Promise<AgentChangeSummary>;
}

export interface LogEntry {
  id: string;
  type: 'metric' | 'config-change' | 'feedback' | 'anomaly';
  agentId: string;
  timestamp: number;
  payload: Record<string, unknown>;
  correlationId: string;
  status?: 'complete' | 'incomplete';
}

export interface LogFilter {
  agentId?: string;
  type?: LogEntry['type'];
  startTime?: number;
  endTime?: number;
  correlationId?: string;
  limit?: number;
}

export interface AgentChangeSummary {
  currentParameters: Record<string, unknown>;
  changeHistory: Array<{
    version: number;
    changedAt: number;
    avgResponseTimeBefore: number;
    avgResponseTimeAfter: number;
    errorRateBefore: number;
    errorRateAfter: number;
  }>;
}
