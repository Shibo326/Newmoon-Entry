/**
 * Workflow context and pipeline type definitions.
 */

export interface WorkflowContext {
  workflowId: string;
  walletAddress: string;
  currentStep: PipelineStep;
  startTimestamp: number;
  stepResults: Map<PipelineStep, StepResult>;
  stepTimings: Map<PipelineStep, { startMs: number; endMs: number }>;
}

export type PipelineStep =
  | 'validate-session'
  | 'check-cache'
  | 'read-signals'
  | 'compute-grade'
  | 'store-result'
  | 'mint-credential';

export interface StepResult {
  step: PipelineStep;
  status: 'success' | 'error' | 'skipped';
  data?: Record<string, unknown>;
  error?: { code: string; description: string };
}

export interface WorkflowResult {
  workflowId: string;
  status: 'success' | 'failed' | 'timeout';
  grade?: CreditGrade;
  reasoning?: SignalContribution[];
  credential?: { txHash: string; mintTimestamp: number };
  cachedResult?: boolean;
  failedStep?: PipelineStep;
  failureReason?: string;
  totalDurationMs: number;
  stepTimings: Record<PipelineStep, number>;
}

export type CreditGrade = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'C';

export interface SignalContribution {
  signal: string;
  direction: 'positive' | 'negative';
  weight: number;
}
