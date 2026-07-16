/**
 * Property-Based Tests: Scoring Agent (Properties 13, 14)
 *
 * Property 13: Scoring Output Structure and Validation
 * For any valid normalized signal vector (6 values in [0.0, 1.0]), the Scoring Agent
 * SHALL return a Credit Grade from {AAA, AA, A, BBB, BB, C} and a reasoning breakdown
 * of exactly 6 entries — one per signal — each with a direction ('positive' or 'negative')
 * and a weight in [0.0, 1.0]. For any invalid vector (out-of-range values or missing signals),
 * the Scoring Agent SHALL reject with a validation error specifying invalid signals.
 *
 * Property 14: Scoring Determinism
 * For any normalized signal vector, invoking the Scoring Agent multiple times with the same
 * input and the same Behavior Profile SHALL always produce the same Credit Grade and the
 * same reasoning breakdown.
 *
 * **Validates: Requirements 6.1, 6.5, 6.6**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { ScoringAgent } from '../scoring-agent.js';
import type { GroqClient } from '../scoring-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { CreditGrade } from '../../types/workflow.js';

// --- Constants ---

const VALID_GRADES: CreditGrade[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'];

const SIGNAL_NAMES = [
  'walletAge',
  'transactionFrequency',
  'defiInteractions',
  'repaymentHistory',
  'assetDiversity',
  'liquidationHistory',
] as const;

// --- Test Helpers ---

function createMockBus(): MessageBus {
  return {
    publish: async () => {},
    subscribe: () => ({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: () => {},
    request: async () => ({} as any),
    setAgentStateProvider: () => {},
    onAgentActivated: async () => {},
    getBufferedMessages: () => [],
  };
}

const defaultProfile: BehaviorProfile = {
  agentId: 'scoring-agent',
  version: 1,
  parameters: {
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    apiTimeoutMs: 5000,
    dailyRateLimit: 14400,
  },
  lastModified: Date.now(),
};

function createComputeGradeRequest(signals: unknown): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'scoring-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'compute-grade',
    payload: { signals },
  };
}

/**
 * Create a deterministic Groq client that returns a grade and reasoning
 * derived from the input signals. Uses a simple algorithm to produce
 * consistent results for the same input.
 *
 * Extracts signal values from the prompt using a regex that handles
 * scientific notation (e.g., 1.5e-323) as well as regular decimals.
 */
function createDeterministicGroqClient(): GroqClient {
  return {
    async createCompletion(params) {
      // Extract signal values from the prompt — handles scientific notation
      const content = params.messages[0]!.content;
      const values: number[] = [];
      for (const name of SIGNAL_NAMES) {
        const regex = new RegExp(`${name}:\\s*([\\d.eE+\\-]+)`);
        const match = content.match(regex);
        values.push(match ? parseFloat(match[1]!) : 0.5);
      }

      // Deterministic grade based on average signal value
      const avg = values.reduce((sum, v) => sum + v, 0) / 6;
      let grade: CreditGrade;
      if (avg >= 0.85) grade = 'AAA';
      else if (avg >= 0.7) grade = 'AA';
      else if (avg >= 0.55) grade = 'A';
      else if (avg >= 0.4) grade = 'BBB';
      else if (avg >= 0.25) grade = 'BB';
      else grade = 'C';

      // Deterministic reasoning: clamp weight to [0.0, 1.0]
      const reasoning = SIGNAL_NAMES.map((signal, i) => ({
        signal,
        direction: (values[i]! >= 0.5 ? 'positive' : 'negative') as 'positive' | 'negative',
        weight: Math.min(1.0, Math.max(0.0, Math.round(values[i]! * 100) / 100)),
      }));

      return {
        content: JSON.stringify({ grade, reasoning }),
      };
    },
  };
}

// --- Generators ---

/**
 * Generate a valid signal vector: exactly 6 values in [0.0, 1.0].
 */
const validSignalVectorArb = fc.tuple(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: 0, max: 1, noNaN: true })
).map(tuple => tuple as [number, number, number, number, number, number]);

/**
 * Generate an invalid signal vector with at least one out-of-range value.
 * Produces arrays of length 6 where at least one value is < 0 or > 1.
 */
const invalidOutOfRangeVectorArb = fc.tuple(
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true })
).filter(signals => signals.some(v => v < 0 || v > 1));

/**
 * Generate an invalid signal vector with wrong length (not 6).
 */
const wrongLengthVectorArb = fc.array(
  fc.double({ min: 0, max: 1, noNaN: true }),
  { minLength: 0, maxLength: 20 }
).filter(arr => arr.length !== 6);

// --- Property Tests ---

describe('Property 13: Scoring Output Structure and Validation', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = createMockBus();
  });

  it('SHALL return a Credit Grade from {AAA, AA, A, BBB, BB, C} and 6-entry reasoning for any valid signal vector', async () => {
    await fc.assert(
      fc.asyncProperty(validSignalVectorArb, async (signals) => {
        const groqClient = createDeterministicGroqClient();
        const agent = new ScoringAgent(bus, groqClient);
        await agent.initialize(defaultProfile);
        await agent.onActivate();

        const request = createComputeGradeRequest(signals);
        const response = await agent.handleMessage(request);

        // Must be a successful response
        expect(response.type).toBe('response');

        const payload = response.payload as {
          grade: string;
          reasoning: Array<{ signal: string; direction: string; weight: number }>;
        };

        // Grade must be in the valid set
        expect(VALID_GRADES).toContain(payload.grade);

        // Reasoning must have exactly 6 entries
        expect(payload.reasoning).toHaveLength(6);

        // Each reasoning entry must have correct structure
        for (const entry of payload.reasoning) {
          // Signal name must be a valid signal
          expect(SIGNAL_NAMES).toContain(entry.signal);

          // Direction must be 'positive' or 'negative'
          expect(['positive', 'negative']).toContain(entry.direction);

          // Weight must be in [0.0, 1.0]
          expect(entry.weight).toBeGreaterThanOrEqual(0.0);
          expect(entry.weight).toBeLessThanOrEqual(1.0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('SHALL reject with validation error specifying invalid signals for out-of-range values', async () => {
    await fc.assert(
      fc.asyncProperty(invalidOutOfRangeVectorArb, async (signals) => {
        const groqClient = createDeterministicGroqClient();
        const agent = new ScoringAgent(bus, groqClient);
        await agent.initialize(defaultProfile);
        await agent.onActivate();

        const request = createComputeGradeRequest(signals);
        const response = await agent.handleMessage(request);

        // Must be an error response
        expect(response.type).toBe('error');

        const payload = response.payload as {
          code: string;
          description: string;
          details?: { errors: Array<{ signal: string; error: string }> };
        };

        // Error code must be 'validation-error'
        expect(payload.code).toBe('validation-error');

        // Details must list which signals are invalid
        expect(payload.details).toBeDefined();
        expect(payload.details!.errors.length).toBeGreaterThan(0);

        // Each error entry references a valid signal name
        for (const err of payload.details!.errors) {
          expect(SIGNAL_NAMES).toContain(err.signal);
        }

        // The reported invalid signals must correspond to actually invalid values
        const reportedSignals = payload.details!.errors.map(e => e.signal);
        for (let i = 0; i < 6; i++) {
          const value = signals[i]!;
          const signalName = SIGNAL_NAMES[i]!;
          if (value < 0 || value > 1) {
            expect(reportedSignals).toContain(signalName);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('SHALL reject with validation error for wrong-length signal vectors', async () => {
    await fc.assert(
      fc.asyncProperty(wrongLengthVectorArb, async (signals) => {
        const groqClient = createDeterministicGroqClient();
        const agent = new ScoringAgent(bus, groqClient);
        await agent.initialize(defaultProfile);
        await agent.onActivate();

        const request = createComputeGradeRequest(signals);
        const response = await agent.handleMessage(request);

        // Must be an error response
        expect(response.type).toBe('error');

        const payload = response.payload as {
          code: string;
          description: string;
        };

        expect(payload.code).toBe('validation-error');
      }),
      { numRuns: 100 }
    );
  });

  it('SHALL reject with validation error for non-array input', async () => {
    const nonArrayInputArb = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.object()
    );

    await fc.assert(
      fc.asyncProperty(nonArrayInputArb, async (input) => {
        const groqClient = createDeterministicGroqClient();
        const agent = new ScoringAgent(bus, groqClient);
        await agent.initialize(defaultProfile);
        await agent.onActivate();

        const request = createComputeGradeRequest(input);
        const response = await agent.handleMessage(request);

        expect(response.type).toBe('error');
        const payload = response.payload as { code: string };
        expect(payload.code).toBe('validation-error');
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 14: Scoring Determinism', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = createMockBus();
  });

  it('SHALL produce identical output when invoked multiple times with the same input and profile', async () => {
    await fc.assert(
      fc.asyncProperty(validSignalVectorArb, async (signals) => {
        const groqClient = createDeterministicGroqClient();
        const agent = new ScoringAgent(bus, groqClient);
        await agent.initialize(defaultProfile);
        await agent.onActivate();

        // Invoke 3 times with the same input
        const results: Array<{ grade: string; reasoning: unknown }> = [];
        for (let i = 0; i < 3; i++) {
          const request = createComputeGradeRequest(signals);
          const response = await agent.handleMessage(request);
          expect(response.type).toBe('response');
          const payload = response.payload as { grade: string; reasoning: unknown };
          results.push({ grade: payload.grade, reasoning: payload.reasoning });
        }

        // All results must be identical
        const firstResult = results[0]!;
        for (let i = 1; i < results.length; i++) {
          expect(results[i]!.grade).toBe(firstResult.grade);
          expect(results[i]!.reasoning).toEqual(firstResult.reasoning);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('SHALL produce identical output across separate agent instances with the same profile', async () => {
    await fc.assert(
      fc.asyncProperty(validSignalVectorArb, async (signals) => {
        // Create two separate agent instances with the same profile and deterministic client
        const groqClient1 = createDeterministicGroqClient();
        const groqClient2 = createDeterministicGroqClient();

        const agent1 = new ScoringAgent(bus, groqClient1);
        await agent1.initialize(defaultProfile);
        await agent1.onActivate();

        const agent2 = new ScoringAgent(bus, groqClient2);
        await agent2.initialize(defaultProfile);
        await agent2.onActivate();

        const request1 = createComputeGradeRequest(signals);
        const request2 = createComputeGradeRequest(signals);

        const response1 = await agent1.handleMessage(request1);
        const response2 = await agent2.handleMessage(request2);

        expect(response1.type).toBe('response');
        expect(response2.type).toBe('response');

        const payload1 = response1.payload as { grade: string; reasoning: unknown };
        const payload2 = response2.payload as { grade: string; reasoning: unknown };

        expect(payload1.grade).toBe(payload2.grade);
        expect(payload1.reasoning).toEqual(payload2.reasoning);
      }),
      { numRuns: 100 }
    );
  });
});
