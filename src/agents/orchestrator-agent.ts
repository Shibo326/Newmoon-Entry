/**
 * Orchestrator Agent implementation.
 * Coordinates the credit scoring pipeline by sequentially executing
 * agent steps via the Message Bus, handling cache hits, timeouts,
 * and error conditions.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, RequestMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type {
  WorkflowContext,
  WorkflowResult,
  PipelineStep,
  StepResult,
  CreditGrade,
  SignalContribution,
} from '../types/workflow.js';
import type { MessageBus } from '../bus/message-bus.js';

const AGENT_ID = 'orchestrator-agent';
const AGENT_NAME = 'Orchestrator Agent';
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const DEFAULT_WORKFLOW_TIMEOUT_MS = 120_000;

const PIPELINE_STEPS: PipelineStep[] = [
  'validate-session',
  'check-cache',
  'read-signals',
  'compute-grade',
  'store-result',
  'mint-credential',
];

const STEP_TOPIC_MAP: Record<PipelineStep, string> = {
  'validate-session': 'wallet.validate-session',
  'check-cache': 'cache.check-cache',
  'read-signals': 'signal.read-signals',
  'compute-grade': 'scoring.compute-grade',
  'store-result': 'cache.store-result',
  'mint-credential': 'credential.mint-credential',
};

const STEP_TARGET_MAP: Record<PipelineStep, string> = {
  'validate-session': 'wallet-agent',
  'check-cache': 'cache-agent',
  'read-signals': 'signal-agent',
  'compute-grade': 'scoring-agent',
  'store-result': 'cache-agent',
  'mint-credential': 'credential-agent',
};

export interface OrchestratorAgent extends Agent {
  requestScore(walletAddress: string): Promise<WorkflowResult>;
  getWorkflowStatus(workflowId: string): WorkflowContext | undefined;
  getQueueDepth(): number;
}

export class OrchestratorAgentImpl implements OrchestratorAgent {
  readonly id = AGENT_ID;
  readonly name = AGENT_NAME;

  private state: AgentLifecycleState = 'idle';
  private activatedAt: number | null = null;
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;
  private stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS;
  private workflowTimeoutMs = DEFAULT_WORKFLOW_TIMEOUT_MS;
  private readonly activeWorkflows: Map<string, WorkflowContext> = new Map();

  // Concurrency control
  private activeCount = 0;
  private maxConcurrentWorkflows = 10;
  private queueLimit = 50;
  private queueResumeAt = 40;
  private accepting = true;
  private readonly queue: Array<{
    walletAddress: string;
    resolve: (result: WorkflowResult) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(private readonly bus: MessageBus) {}

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    const startTime = Date.now();
    this.requestCount++;

    try {
      if (message.topic === 'orchestrator.request-score') {
        const payload = message.payload as Record<string, unknown>;
        const walletAddress = payload['walletAddress'] as string | undefined;
        if (!walletAddress) {
          this.errorCount++;
          const elapsed = Date.now() - startTime;
          this.totalResponseTimeMs += elapsed;
          return this.createErrorResponse(message, 'INVALID_REQUEST', 'walletAddress is required');
        }

        const result = await this.requestScore(walletAddress);
        const elapsed = Date.now() - startTime;
        this.totalResponseTimeMs += elapsed;

        if (result.status === 'failed' || result.status === 'timeout') {
          this.errorCount++;
        }

        return this.createResponse(message, result as unknown as Record<string, unknown>);
      }

      this.errorCount++;
      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;
      return this.createErrorResponse(message, 'UNKNOWN_TOPIC', `Unknown topic: ${message.topic}`);
    } catch (_err: unknown) {
      this.errorCount++;
      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;
      const description = _err instanceof Error ? _err.message : 'Unknown internal error';
      return this.createErrorResponse(message, 'INTERNAL_ERROR', description);
    }
  }

  async requestScore(walletAddress: string): Promise<WorkflowResult> {
    // Check if we're accepting requests (backpressure)
    if (!this.accepting) {
      return {
        workflowId: uuidv4(),
        status: 'failed',
        failureReason: 'System busy: request queue full',
        totalDurationMs: 0,
        stepTimings: {} as Record<PipelineStep, number>,
      };
    }

    // If under concurrent limit, execute immediately
    if (this.activeCount < this.maxConcurrentWorkflows) {
      return this.executeWorkflow(walletAddress);
    }

    // Otherwise, queue the request (FIFO)
    return new Promise<WorkflowResult>((resolve, reject) => {
      this.queue.push({ walletAddress, resolve, reject });

      // Check queue limit — stop accepting when exceeds 50
      if (this.queue.length > this.queueLimit) {
        this.accepting = false;
      }
    });
  }

  getWorkflowStatus(workflowId: string): WorkflowContext | undefined {
    return this.activeWorkflows.get(workflowId);
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getHealth(): AgentHealth {
    const now = Date.now();
    const uptimeSeconds = this.activatedAt !== null
      ? Math.floor((now - this.activatedAt) / 1000)
      : 0;
    const avgResponseTimeMs = this.requestCount > 0
      ? this.totalResponseTimeMs / this.requestCount
      : 0;

    return {
      state: this.state,
      uptimeSeconds,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTimeMs,
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      { topic: 'orchestrator.request-score', description: 'Execute credit scoring workflow pipeline' },
    ];
  }

  async initialize(profile: BehaviorProfile): Promise<void> {
    if (profile.parameters['stepTimeoutMs'] !== undefined) {
      this.stepTimeoutMs = profile.parameters['stepTimeoutMs'] as number;
    }
    if (profile.parameters['workflowTimeoutMs'] !== undefined) {
      this.workflowTimeoutMs = profile.parameters['workflowTimeoutMs'] as number;
    }
    if (profile.parameters['maxConcurrentWorkflows'] !== undefined) {
      this.maxConcurrentWorkflows = profile.parameters['maxConcurrentWorkflows'] as number;
    }
    if (profile.parameters['queueLimit'] !== undefined) {
      this.queueLimit = profile.parameters['queueLimit'] as number;
    }
    if (profile.parameters['queueResumeAt'] !== undefined) {
      this.queueResumeAt = profile.parameters['queueResumeAt'] as number;
    }
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.activatedAt = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    if (profile.parameters['stepTimeoutMs'] !== undefined) {
      this.stepTimeoutMs = profile.parameters['stepTimeoutMs'] as number;
    }
    if (profile.parameters['workflowTimeoutMs'] !== undefined) {
      this.workflowTimeoutMs = profile.parameters['workflowTimeoutMs'] as number;
    }
    if (profile.parameters['maxConcurrentWorkflows'] !== undefined) {
      this.maxConcurrentWorkflows = profile.parameters['maxConcurrentWorkflows'] as number;
    }
    if (profile.parameters['queueLimit'] !== undefined) {
      this.queueLimit = profile.parameters['queueLimit'] as number;
    }
    if (profile.parameters['queueResumeAt'] !== undefined) {
      this.queueResumeAt = profile.parameters['queueResumeAt'] as number;
    }
  }

  // --- Private pipeline execution ---

  private async executeWorkflow(walletAddress: string): Promise<WorkflowResult> {
    this.activeCount++;

    const workflowId = uuidv4();
    const startTimestamp = Date.now();

    const context: WorkflowContext = {
      workflowId,
      walletAddress,
      currentStep: 'validate-session',
      startTimestamp,
      stepResults: new Map(),
      stepTimings: new Map(),
    };

    this.activeWorkflows.set(workflowId, context);

    try {
      const result = await this.executePipeline(context);
      return result;
    } finally {
      this.activeWorkflows.delete(workflowId);
      this.activeCount--;
      this.dequeueNext();
    }
  }

  private dequeueNext(): void {
    // Process next queued request if capacity available
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrentWorkflows) {
      const next = this.queue.shift()!;
      // Fire and forget — the promise resolve/reject is held by the queued caller
      this.executeWorkflow(next.walletAddress).then(next.resolve, next.reject);
    }

    // Resume accepting if queue dropped below the resume threshold
    if (!this.accepting && this.queue.length < this.queueResumeAt) {
      this.accepting = true;
    }
  }

  private async executePipeline(context: WorkflowContext): Promise<WorkflowResult> {
    const stepTimingsRecord: Record<string, number> = {};
    let grade: CreditGrade | undefined;
    let reasoning: SignalContribution[] | undefined;
    let credential: { txHash: string; mintTimestamp: number } | undefined;
    let cachedResult = false;
    let signals: Record<string, unknown> | undefined;

    for (const step of PIPELINE_STEPS) {
      // Check workflow timeout before executing step
      const elapsed = Date.now() - context.startTimestamp;
      if (elapsed >= this.workflowTimeoutMs) {
        // Mark current and remaining steps
        this.markRemainingStepsSkipped(context, step, stepTimingsRecord);

        const result: WorkflowResult = {
          workflowId: context.workflowId,
          status: 'timeout',
          failedStep: step,
          failureReason: `Workflow timeout exceeded (${this.workflowTimeoutMs}ms)`,
          totalDurationMs: Date.now() - context.startTimestamp,
          stepTimings: stepTimingsRecord as Record<PipelineStep, number>,
        };

        await this.publishWorkflowComplete(result);
        return result;
      }

      // Skip steps on cache hit
      if (cachedResult && (step === 'read-signals' || step === 'compute-grade' || step === 'store-result' || step === 'mint-credential')) {
        const skipResult: StepResult = { step, status: 'skipped' };
        context.stepResults.set(step, skipResult);
        stepTimingsRecord[step] = 0;
        continue;
      }

      context.currentStep = step;
      const stepStart = Date.now();

      // Build request payload for this step
      const payload = this.buildStepPayload(step, context, signals, grade, reasoning);

      const requestMsg: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: this.id,
        targetAgentId: STEP_TARGET_MAP[step],
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: STEP_TOPIC_MAP[step],
        payload,
      };

      // Execute step with step timeout
      const response = await this.bus.request(requestMsg, this.stepTimeoutMs);
      const stepEnd = Date.now();
      const stepDuration = stepEnd - stepStart;

      context.stepTimings.set(step, { startMs: stepStart, endMs: stepEnd });
      stepTimingsRecord[step] = stepDuration;

      // Handle error response (including timeout from bus)
      if (response.type === 'error') {
        const errPayload = response.payload as { code: string; description: string };
        const stepResult: StepResult = {
          step,
          status: 'error',
          error: { code: errPayload.code, description: errPayload.description },
        };
        context.stepResults.set(step, stepResult);

        // Mark remaining steps as skipped
        this.markRemainingStepsSkipped(context, step, stepTimingsRecord, true);

        const failureReason = errPayload.code === 'TIMEOUT'
          ? `Step '${step}' timed out after ${this.stepTimeoutMs}ms`
          : `Step '${step}' failed: ${errPayload.description}`;

        const result: WorkflowResult = {
          workflowId: context.workflowId,
          status: errPayload.code === 'TIMEOUT' ? 'timeout' : 'failed',
          failedStep: step,
          failureReason,
          totalDurationMs: Date.now() - context.startTimestamp,
          stepTimings: stepTimingsRecord as Record<PipelineStep, number>,
        };

        await this.publishWorkflowComplete(result);
        return result;
      }

      // Step succeeded
      const stepResult: StepResult = {
        step,
        status: 'success',
        data: response.payload,
      };
      context.stepResults.set(step, stepResult);

      // Process step-specific results
      if (step === 'check-cache' && response.payload['hit'] === true) {
        cachedResult = true;
        grade = response.payload['grade'] as CreditGrade;
        reasoning = response.payload['reasoning'] as SignalContribution[] | undefined;
      }

      if (step === 'read-signals') {
        signals = response.payload;
      }

      if (step === 'compute-grade') {
        grade = response.payload['grade'] as CreditGrade;
        reasoning = response.payload['reasoning'] as SignalContribution[] | undefined;
      }

      if (step === 'mint-credential') {
        credential = {
          txHash: response.payload['txHash'] as string,
          mintTimestamp: response.payload['mintTimestamp'] as number,
        };
      }
    }

    // Pipeline completed successfully
    const result: WorkflowResult = {
      workflowId: context.workflowId,
      status: 'success',
      grade,
      reasoning,
      credential,
      cachedResult: cachedResult || undefined,
      totalDurationMs: Date.now() - context.startTimestamp,
      stepTimings: stepTimingsRecord as Record<PipelineStep, number>,
    };

    await this.publishWorkflowComplete(result);
    return result;
  }

  private buildStepPayload(
    step: PipelineStep,
    context: WorkflowContext,
    signals: Record<string, unknown> | undefined,
    grade: CreditGrade | undefined,
    reasoning: SignalContribution[] | undefined,
  ): Record<string, unknown> {
    switch (step) {
      case 'validate-session':
        return { walletAddress: context.walletAddress };
      case 'check-cache':
        return { walletAddress: context.walletAddress };
      case 'read-signals':
        return { walletAddress: context.walletAddress };
      case 'compute-grade':
        return { signals: signals ?? {} };
      case 'store-result':
        return {
          walletAddress: context.walletAddress,
          creditGrade: grade,
          reasoning,
          timestamp: Date.now(),
        };
      case 'mint-credential':
        return {
          walletAddress: context.walletAddress,
          creditGrade: grade,
        };
    }
  }

  private markRemainingStepsSkipped(
    context: WorkflowContext,
    currentStep: PipelineStep,
    stepTimingsRecord: Record<string, number>,
    excludeCurrent = false,
  ): void {
    const startIndex = PIPELINE_STEPS.indexOf(currentStep);
    const skipFrom = excludeCurrent ? startIndex + 1 : startIndex;

    for (let i = skipFrom; i < PIPELINE_STEPS.length; i++) {
      const step = PIPELINE_STEPS[i]!;
      if (!context.stepResults.has(step)) {
        context.stepResults.set(step, { step, status: 'skipped' });
        stepTimingsRecord[step] = 0;
      }
    }
  }

  private async publishWorkflowComplete(result: WorkflowResult): Promise<void> {
    await this.bus.publish({
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: result.workflowId,
      timestamp: Date.now(),
      topic: 'workflow-complete',
      payload: {
        workflowId: result.workflowId,
        status: result.status,
        totalDurationMs: result.totalDurationMs,
        stepTimings: result.stepTimings,
      },
    });
  }

  // --- Helpers ---

  private createResponse(originalMessage: BusMessage, payload: Record<string, unknown>): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'response',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload,
    };
  }

  private createErrorResponse(originalMessage: BusMessage, code: string, description: string): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: originalMessage.sourceAgentId,
      type: 'error',
      correlationId: originalMessage.correlationId,
      timestamp: Date.now(),
      topic: originalMessage.topic,
      payload: { code, description },
    };
  }
}

export default OrchestratorAgentImpl;
