/**
 * Scoring Agent - Invokes Groq API (Llama 3.3 70B) to compute credit grades.
 * Isolated AI scoring agent that can be swapped without impacting the pipeline.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Agent, AgentHealth, AgentCapability, AgentLifecycleState } from '../types/agent.js';
import type { BusMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { BehaviorProfile } from '../types/config.js';
import type { CreditGrade, SignalContribution } from '../types/workflow.js';
import type { MessageBus } from '../bus/message-bus.js';

/**
 * Abstraction over the Groq API for testability.
 */
export interface GroqClient {
  createCompletion(params: {
    model: string;
    temperature: number;
    messages: Array<{ role: string; content: string }>;
    timeoutMs: number;
  }): Promise<GroqResponse>;
}

export interface GroqResponse {
  content: string;
}

const SIGNAL_NAMES = [
  'walletAge',
  'transactionFrequency',
  'defiInteractions',
  'repaymentHistory',
  'assetDiversity',
  'liquidationHistory',
] as const;

const VALID_GRADES: readonly CreditGrade[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'] as const;

const DEFAULT_PROMPT_TEMPLATE = `You are a credit scoring AI. Given the following normalized wallet signal vector (each value 0.0-1.0), compute a credit grade and reasoning.

Signals:
- walletAge: {{walletAge}}
- transactionFrequency: {{transactionFrequency}}
- defiInteractions: {{defiInteractions}}
- repaymentHistory: {{repaymentHistory}}
- assetDiversity: {{assetDiversity}}
- liquidationHistory: {{liquidationHistory}}

Respond in EXACTLY this JSON format:
{
  "grade": "<one of AAA, AA, A, BBB, BB, C>",
  "reasoning": [
    {"signal": "walletAge", "direction": "positive|negative", "weight": <0.0-1.0>},
    {"signal": "transactionFrequency", "direction": "positive|negative", "weight": <0.0-1.0>},
    {"signal": "defiInteractions", "direction": "positive|negative", "weight": <0.0-1.0>},
    {"signal": "repaymentHistory", "direction": "positive|negative", "weight": <0.0-1.0>},
    {"signal": "assetDiversity", "direction": "positive|negative", "weight": <0.0-1.0>},
    {"signal": "liquidationHistory", "direction": "positive|negative", "weight": <0.0-1.0>}
  ]
}`;

interface ScoringResult {
  grade: CreditGrade;
  reasoning: SignalContribution[];
}

/**
 * Scoring Agent responsible for invoking Groq API to compute credit grades.
 */
export class ScoringAgent implements Agent {
  readonly id = 'scoring-agent';
  readonly name = 'Scoring Agent';

  private state: AgentLifecycleState = 'idle';
  private activatedAt: number | null = null;
  private requestCount = 0;
  private errorCount = 0;
  private totalResponseTimeMs = 0;

  // Behavior Profile parameters
  private model = 'llama-3.3-70b-versatile';
  private temperature = 0;
  private apiTimeoutMs = 5000;
  private dailyRateLimit = 14400;
  private promptTemplate = DEFAULT_PROMPT_TEMPLATE;

  // Rate limit tracking
  private dailyRequestCount = 0;
  private currentDay: string = '';

  constructor(
    private readonly bus: MessageBus,
    private readonly groqClient: GroqClient
  ) {}

  async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
    if (message.type !== 'request' || message.topic !== 'compute-grade') {
      return this.createError(message, 'unsupported-topic', `Unsupported topic: ${message.topic}`);
    }

    const startTime = Date.now();

    try {
      const payload = message.payload as Record<string, unknown>;
      const signals = payload.signals as unknown;

      // Validate input signals
      const validationErrors = this.validateSignals(signals);
      if (validationErrors.length > 0) {
        this.errorCount++;
        return this.createError(message, 'validation-error', 'Invalid signal vector', {
          errors: validationErrors,
        });
      }

      // Check rate limit
      if (this.isRateLimited()) {
        this.errorCount++;
        await this.publishEvent('scoring.rate-limited', {
          dailyCount: this.dailyRequestCount,
          limit: this.dailyRateLimit,
        });
        return this.createError(
          message,
          'rate-limit-exceeded',
          `Daily rate limit of ${this.dailyRateLimit} requests exceeded`
        );
      }

      // Invoke Groq API
      const signalVector = signals as number[];
      const result = await this.invokeGroq(signalVector);

      this.requestCount++;
      this.dailyRequestCount++;
      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;

      return this.createResponse(message, {
        grade: result.grade,
        reasoning: result.reasoning,
      });
    } catch (error: unknown) {
      this.errorCount++;
      const elapsed = Date.now() - startTime;
      this.totalResponseTimeMs += elapsed;

      if (error instanceof ScoringTimeoutError) {
        return this.createError(message, 'service-unavailable', 'Groq API request timed out');
      }

      if (error instanceof ScoringParseError) {
        await this.publishEvent('scoring.parse-failed', {
          reason: error.message,
        });
        return this.createError(message, 'scoring-parse-error', error.message);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createError(message, 'internal-error', errorMessage);
    }
  }

  getHealth(): AgentHealth {
    const uptimeSeconds = this.activatedAt
      ? Math.floor((Date.now() - this.activatedAt) / 1000)
      : 0;
    const avgResponseTimeMs =
      this.requestCount > 0 ? this.totalResponseTimeMs / (this.requestCount + this.errorCount) : 0;

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
      {
        topic: 'compute-grade',
        description: 'Compute credit grade from normalized signal vector using Groq LLM',
      },
    ];
  }

  async initialize(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
  }

  async onActivate(): Promise<void> {
    this.state = 'active';
    this.activatedAt = Date.now();
  }

  async onDeactivate(): Promise<void> {
    this.state = 'idle';
  }

  async onConfigUpdate(profile: BehaviorProfile): Promise<void> {
    this.applyProfile(profile);
  }

  private applyProfile(profile: BehaviorProfile): void {
    const params = profile.parameters;
    if (typeof params.model === 'string') {
      this.model = params.model;
    }
    if (typeof params.temperature === 'number') {
      this.temperature = params.temperature;
    }
    if (typeof params.apiTimeoutMs === 'number') {
      this.apiTimeoutMs = params.apiTimeoutMs;
    }
    if (typeof params.dailyRateLimit === 'number') {
      this.dailyRateLimit = params.dailyRateLimit;
    }
    if (typeof params.promptTemplate === 'string') {
      this.promptTemplate = params.promptTemplate;
    }
  }

  /**
   * Validate the input signal vector: must be array of exactly 6 values in [0.0, 1.0].
   */
  private validateSignals(signals: unknown): Array<{ signal: string; error: string }> {
    const errors: Array<{ signal: string; error: string }> = [];

    if (!Array.isArray(signals)) {
      errors.push({ signal: 'signals', error: 'signals must be an array' });
      return errors;
    }

    if (signals.length !== 6) {
      errors.push({
        signal: 'signals',
        error: `Expected exactly 6 signals, got ${signals.length}`,
      });
      return errors;
    }

    for (let i = 0; i < 6; i++) {
      const value = signals[i] as unknown;
      const signalName = SIGNAL_NAMES[i]!;

      if (value === undefined || value === null) {
        errors.push({ signal: signalName, error: `${signalName} is missing` });
      } else if (typeof value !== 'number') {
        errors.push({ signal: signalName, error: `${signalName} must be a number` });
      } else if (!Number.isFinite(value)) {
        errors.push({ signal: signalName, error: `${signalName} must be a finite number` });
      } else if (value < 0.0 || value > 1.0) {
        errors.push({
          signal: signalName,
          error: `${signalName} must be in range [0.0, 1.0], got ${value}`,
        });
      }
    }

    return errors;
  }

  /**
   * Check if the daily rate limit has been reached. Resets on UTC day boundary.
   */
  private isRateLimited(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyRequestCount = 0;
    }
    return this.dailyRequestCount >= this.dailyRateLimit;
  }

  /**
   * Invoke the Groq API with the signal vector and parse the response.
   */
  private async invokeGroq(signals: number[]): Promise<ScoringResult> {
    const prompt = this.buildPrompt(signals);

    let response: GroqResponse;
    try {
      response = await this.groqClient.createCompletion({
        model: this.model,
        temperature: this.temperature,
        messages: [{ role: 'user', content: prompt }],
        timeoutMs: this.apiTimeoutMs,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new ScoringTimeoutError('Groq API request timed out');
      }
      throw error;
    }

    return this.parseResponse(response.content);
  }

  /**
   * Build the prompt string from the template and signal values.
   */
  private buildPrompt(signals: number[]): string {
    let prompt = this.promptTemplate;
    for (let i = 0; i < SIGNAL_NAMES.length; i++) {
      const name = SIGNAL_NAMES[i]!;
      prompt = prompt.replace(`{{${name}}}`, String(signals[i]));
    }
    return prompt;
  }

  /**
   * Parse the Groq API response into a ScoringResult.
   * Validates the grade and reasoning structure.
   */
  private parseResponse(content: string): ScoringResult {
    let parsed: unknown;
    try {
      // Try to extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new ScoringParseError('No JSON object found in response');
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error: unknown) {
      if (error instanceof ScoringParseError) throw error;
      throw new ScoringParseError(`Failed to parse response as JSON: ${content}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new ScoringParseError('Response is not an object');
    }

    const obj = parsed as Record<string, unknown>;

    // Validate grade
    const grade = obj.grade;
    if (typeof grade !== 'string' || !(VALID_GRADES as readonly string[]).includes(grade)) {
      throw new ScoringParseError(
        `Invalid grade: "${String(grade)}". Must be one of: ${VALID_GRADES.join(', ')}`
      );
    }

    // Validate reasoning
    const reasoning = obj.reasoning;
    if (!Array.isArray(reasoning) || reasoning.length !== 6) {
      throw new ScoringParseError('reasoning must be an array of exactly 6 entries');
    }

    const validatedReasoning: SignalContribution[] = [];
    for (let i = 0; i < 6; i++) {
      const entry = reasoning[i] as Record<string, unknown> | undefined;
      if (!entry || typeof entry !== 'object') {
        throw new ScoringParseError(`reasoning[${i}] must be an object`);
      }

      const signal = entry.signal;
      const direction = entry.direction;
      const weight = entry.weight;

      if (typeof signal !== 'string' || !(SIGNAL_NAMES as readonly string[]).includes(signal)) {
        throw new ScoringParseError(
          `reasoning[${i}].signal must be one of: ${SIGNAL_NAMES.join(', ')}`
        );
      }

      if (direction !== 'positive' && direction !== 'negative') {
        throw new ScoringParseError(
          `reasoning[${i}].direction must be "positive" or "negative"`
        );
      }

      if (typeof weight !== 'number' || weight < 0.0 || weight > 1.0) {
        throw new ScoringParseError(
          `reasoning[${i}].weight must be a number in [0.0, 1.0]`
        );
      }

      validatedReasoning.push({
        signal,
        direction,
        weight,
      });
    }

    return {
      grade: grade as CreditGrade,
      reasoning: validatedReasoning,
    };
  }

  /**
   * Publish an event on the message bus.
   */
  private async publishEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    await this.bus.publish({
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: null,
      type: 'event',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic,
      payload,
    });
  }

  private createResponse(
    original: BusMessage,
    payload: Record<string, unknown>
  ): ResponseMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: original.sourceAgentId,
      type: 'response',
      correlationId: original.correlationId,
      timestamp: Date.now(),
      topic: original.topic,
      payload,
    };
  }

  private createError(
    original: BusMessage,
    code: string,
    description: string,
    details?: Record<string, unknown>
  ): ErrorMessage {
    return {
      id: uuidv4(),
      sourceAgentId: this.id,
      targetAgentId: original.sourceAgentId,
      type: 'error',
      correlationId: original.correlationId,
      timestamp: Date.now(),
      topic: original.topic,
      payload: {
        code,
        description,
        ...(details ? { details } : {}),
      },
    };
  }
}

/**
 * Error indicating Groq API timeout.
 */
export class ScoringTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringTimeoutError';
  }
}

/**
 * Error indicating response parse failure.
 */
export class ScoringParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringParseError';
  }
}

export default ScoringAgent;
