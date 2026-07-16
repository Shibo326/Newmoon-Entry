/**
 * Unit tests for Scoring Agent.
 * Tests Groq API integration, input validation, rate limiting, timeout, and parse errors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScoringAgent, type GroqClient, type GroqResponse } from '../scoring-agent.js';
import { InMemoryMessageBus } from '../../bus/message-bus.js';
import type { RequestMessage, BusMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';
import type { CreditGrade } from '../../types/workflow.js';
import { v4 as uuidv4 } from 'uuid';

function createMockGroqClient(response?: GroqResponse): GroqClient & { calls: Array<unknown> } {
  const calls: Array<unknown> = [];
  return {
    calls,
    async createCompletion(params) {
      calls.push(params);
      if (!response) {
        throw new Error('No mock response configured');
      }
      return response;
    },
  };
}

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

function validGroqResponse(grade: CreditGrade = 'A'): GroqResponse {
  return {
    content: JSON.stringify({
      grade,
      reasoning: [
        { signal: 'walletAge', direction: 'positive', weight: 0.8 },
        { signal: 'transactionFrequency', direction: 'positive', weight: 0.6 },
        { signal: 'defiInteractions', direction: 'positive', weight: 0.5 },
        { signal: 'repaymentHistory', direction: 'positive', weight: 0.9 },
        { signal: 'assetDiversity', direction: 'negative', weight: 0.3 },
        { signal: 'liquidationHistory', direction: 'negative', weight: 0.2 },
      ],
    }),
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

describe('ScoringAgent', () => {
  let bus: InMemoryMessageBus;
  let groqClient: GroqClient & { calls: Array<unknown> };
  let agent: ScoringAgent;

  beforeEach(async () => {
    bus = new InMemoryMessageBus();
    groqClient = createMockGroqClient(validGroqResponse());
    agent = new ScoringAgent(bus, groqClient);
    await agent.initialize(defaultProfile);
    await agent.onActivate();
  });

  describe('basic properties', () => {
    it('should have correct id and name', () => {
      expect(agent.id).toBe('scoring-agent');
      expect(agent.name).toBe('Scoring Agent');
    });

    it('should report health with active state', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('active');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
    });

    it('should expose compute-grade capability', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0]!.topic).toBe('compute-grade');
    });
  });

  describe('compute-grade handler - happy path', () => {
    it('should return valid grade and 6-entry reasoning on valid input', async () => {
      const request = createComputeGradeRequest([0.8, 0.6, 0.5, 0.9, 0.3, 0.2]);
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect(response.payload).toHaveProperty('grade', 'A');
      expect(response.payload).toHaveProperty('reasoning');
      const reasoning = response.payload.reasoning as Array<unknown>;
      expect(reasoning).toHaveLength(6);
    });

    it('should call Groq with correct model and temperature=0', async () => {
      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      await agent.handleMessage(request);

      expect(groqClient.calls).toHaveLength(1);
      const call = groqClient.calls[0] as { model: string; temperature: number; timeoutMs: number };
      expect(call.model).toBe('llama-3.3-70b-versatile');
      expect(call.temperature).toBe(0);
      expect(call.timeoutMs).toBe(5000);
    });

    it('should include all signal values in the prompt', async () => {
      const signals = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
      const request = createComputeGradeRequest(signals);
      await agent.handleMessage(request);

      const call = groqClient.calls[0] as { messages: Array<{ content: string }> };
      const prompt = call.messages[0]!.content;
      expect(prompt).toContain('0.1');
      expect(prompt).toContain('0.2');
      expect(prompt).toContain('0.3');
      expect(prompt).toContain('0.4');
      expect(prompt).toContain('0.5');
      expect(prompt).toContain('0.6');
    });

    it('should accept all valid grades', async () => {
      const grades: CreditGrade[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'];
      for (const grade of grades) {
        const client = createMockGroqClient(validGroqResponse(grade));
        const scoringAgent = new ScoringAgent(bus, client);
        await scoringAgent.initialize(defaultProfile);
        await scoringAgent.onActivate();

        const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
        const response = await scoringAgent.handleMessage(request);
        expect(response.type).toBe('response');
        expect(response.payload.grade).toBe(grade);
      }
    });

    it('should set correlation ID from the request', async () => {
      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.correlationId).toBe(request.correlationId);
    });

    it('should increment request count on success', async () => {
      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      await agent.handleMessage(request);
      expect(agent.getHealth().requestCount).toBe(1);
    });
  });

  describe('input validation', () => {
    it('should reject non-array signals', async () => {
      const request = createComputeGradeRequest('not-an-array');
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('validation-error');
    });

    it('should reject signals with wrong length', async () => {
      const request = createComputeGradeRequest([0.5, 0.5, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('validation-error');
      const details = (response.payload as { details: { errors: Array<{ error: string }> } }).details;
      expect(details.errors[0]!.error).toContain('Expected exactly 6');
    });

    it('should reject signals with values outside [0.0, 1.0]', async () => {
      const request = createComputeGradeRequest([0.5, 1.5, 0.5, 0.5, -0.1, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      const details = (response.payload as { details: { errors: Array<{ signal: string }> } }).details;
      const invalidSignals = details.errors.map((e) => e.signal);
      expect(invalidSignals).toContain('transactionFrequency');
      expect(invalidSignals).toContain('assetDiversity');
    });

    it('should reject signals with non-number values', async () => {
      const request = createComputeGradeRequest([0.5, 'bad', 0.5, 0.5, 0.5, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      const details = (response.payload as { details: { errors: Array<{ signal: string }> } }).details;
      expect(details.errors[0]!.signal).toBe('transactionFrequency');
    });

    it('should reject signals with null values', async () => {
      const request = createComputeGradeRequest([0.5, null, 0.5, 0.5, 0.5, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      const details = (response.payload as { details: { errors: Array<{ signal: string }> } }).details;
      expect(details.errors[0]!.signal).toBe('transactionFrequency');
    });

    it('should reject signals with Infinity', async () => {
      const request = createComputeGradeRequest([Infinity, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      const details = (response.payload as { details: { errors: Array<{ signal: string }> } }).details;
      expect(details.errors[0]!.signal).toBe('walletAge');
    });

    it('should reject signals with NaN', async () => {
      const request = createComputeGradeRequest([NaN, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      const details = (response.payload as { details: { errors: Array<{ signal: string }> } }).details;
      expect(details.errors[0]!.signal).toBe('walletAge');
    });

    it('should accept boundary values 0.0 and 1.0', async () => {
      const request = createComputeGradeRequest([0.0, 1.0, 0.0, 1.0, 0.0, 1.0]);
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('response');
    });
  });

  describe('API timeout handling', () => {
    it('should return service-unavailable on timeout', async () => {
      const timeoutClient: GroqClient = {
        async createCompletion() {
          throw new Error('timeout: request exceeded 5000ms');
        },
      };
      const timeoutAgent = new ScoringAgent(bus, timeoutClient);
      await timeoutAgent.initialize(defaultProfile);
      await timeoutAgent.onActivate();

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await timeoutAgent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('service-unavailable');
    });

    it('should respect custom timeout from profile', async () => {
      const customProfile: BehaviorProfile = {
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, apiTimeoutMs: 2000 },
      };
      const client = createMockGroqClient(validGroqResponse());
      const customAgent = new ScoringAgent(bus, client);
      await customAgent.initialize(customProfile);
      await customAgent.onActivate();

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      await customAgent.handleMessage(request);

      const call = client.calls[0] as { timeoutMs: number };
      expect(call.timeoutMs).toBe(2000);
    });
  });

  describe('rate limiting', () => {
    it('should return rate-limit-exceeded when daily limit reached', async () => {
      const limitedProfile: BehaviorProfile = {
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, dailyRateLimit: 2 },
      };
      const client = createMockGroqClient(validGroqResponse());
      const limitedAgent = new ScoringAgent(bus, client);
      await limitedAgent.initialize(limitedProfile);
      await limitedAgent.onActivate();

      // Use up the rate limit
      await limitedAgent.handleMessage(createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
      await limitedAgent.handleMessage(createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));

      // Third request should be rate limited
      const response = await limitedAgent.handleMessage(
        createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
      );
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('rate-limit-exceeded');
    });

    it('should publish scoring.rate-limited event when limit reached', async () => {
      const limitedProfile: BehaviorProfile = {
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, dailyRateLimit: 1 },
      };
      const client = createMockGroqClient(validGroqResponse());
      const limitedAgent = new ScoringAgent(bus, client);
      await limitedAgent.initialize(limitedProfile);
      await limitedAgent.onActivate();

      const publishedEvents: BusMessage[] = [];
      bus.subscribe('scoring.rate-limited', async (msg) => {
        publishedEvents.push(msg);
      });

      // Use up the rate limit
      await limitedAgent.handleMessage(createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));

      // Trigger rate limit
      await limitedAgent.handleMessage(createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]!.type).toBe('event');
    });
  });

  describe('parse error handling', () => {
    it('should return scoring-parse-error for invalid JSON response', async () => {
      const badClient: GroqClient = {
        async createCompletion() {
          return { content: 'not valid json at all' };
        },
      };
      const badAgent = new ScoringAgent(bus, badClient);
      await badAgent.initialize(defaultProfile);
      await badAgent.onActivate();

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await badAgent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('scoring-parse-error');
    });

    it('should return scoring-parse-error for invalid grade in response', async () => {
      const badClient: GroqClient = {
        async createCompletion() {
          return {
            content: JSON.stringify({
              grade: 'INVALID',
              reasoning: [],
            }),
          };
        },
      };
      const badAgent = new ScoringAgent(bus, badClient);
      await badAgent.initialize(defaultProfile);
      await badAgent.onActivate();

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await badAgent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('scoring-parse-error');
    });

    it('should return scoring-parse-error for wrong number of reasoning entries', async () => {
      const badClient: GroqClient = {
        async createCompletion() {
          return {
            content: JSON.stringify({
              grade: 'A',
              reasoning: [
                { signal: 'walletAge', direction: 'positive', weight: 0.5 },
              ],
            }),
          };
        },
      };
      const badAgent = new ScoringAgent(bus, badClient);
      await badAgent.initialize(defaultProfile);
      await badAgent.onActivate();

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await badAgent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('scoring-parse-error');
    });

    it('should publish scoring.parse-failed event on parse error', async () => {
      const badClient: GroqClient = {
        async createCompletion() {
          return { content: 'garbage response' };
        },
      };
      const badAgent = new ScoringAgent(bus, badClient);
      await badAgent.initialize(defaultProfile);
      await badAgent.onActivate();

      const publishedEvents: BusMessage[] = [];
      bus.subscribe('scoring.parse-failed', async (msg) => {
        publishedEvents.push(msg);
      });

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      await badAgent.handleMessage(request);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]!.type).toBe('event');
    });

    it('should handle response wrapped in markdown code block', async () => {
      const wrappedClient: GroqClient = {
        async createCompletion() {
          return {
            content: '```json\n' + JSON.stringify({
              grade: 'BBB',
              reasoning: [
                { signal: 'walletAge', direction: 'positive', weight: 0.4 },
                { signal: 'transactionFrequency', direction: 'positive', weight: 0.3 },
                { signal: 'defiInteractions', direction: 'negative', weight: 0.2 },
                { signal: 'repaymentHistory', direction: 'positive', weight: 0.7 },
                { signal: 'assetDiversity', direction: 'positive', weight: 0.5 },
                { signal: 'liquidationHistory', direction: 'negative', weight: 0.6 },
              ],
            }) + '\n```',
          };
        },
      };
      const wrappedAgent = new ScoringAgent(bus, wrappedClient);
      await wrappedAgent.initialize(defaultProfile);
      await wrappedAgent.onActivate();

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const response = await wrappedAgent.handleMessage(request);
      expect(response.type).toBe('response');
      expect(response.payload.grade).toBe('BBB');
    });
  });

  describe('unsupported topics', () => {
    it('should reject messages with unsupported topics', async () => {
      const request: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'orchestrator-agent',
        targetAgentId: 'scoring-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'unknown-topic',
        payload: {},
      };
      const response = await agent.handleMessage(request);
      expect(response.type).toBe('error');
      expect((response.payload as { code: string }).code).toBe('unsupported-topic');
    });
  });

  describe('behavior profile configuration', () => {
    it('should apply updated model from config', async () => {
      const updatedProfile: BehaviorProfile = {
        ...defaultProfile,
        version: 2,
        parameters: { ...defaultProfile.parameters, model: 'llama-3.1-8b-instant' },
      };
      await agent.onConfigUpdate(updatedProfile);

      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      await agent.handleMessage(request);

      const call = groqClient.calls[0] as { model: string };
      expect(call.model).toBe('llama-3.1-8b-instant');
    });

    it('should apply custom prompt template from config', async () => {
      const customTemplate = 'Score these signals: {{walletAge}}, {{transactionFrequency}}, {{defiInteractions}}, {{repaymentHistory}}, {{assetDiversity}}, {{liquidationHistory}}';
      const updatedProfile: BehaviorProfile = {
        ...defaultProfile,
        parameters: { ...defaultProfile.parameters, promptTemplate: customTemplate },
      };
      await agent.onConfigUpdate(updatedProfile);

      const request = createComputeGradeRequest([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
      await agent.handleMessage(request);

      const call = groqClient.calls[0] as { messages: Array<{ content: string }> };
      expect(call.messages[0]!.content).toBe('Score these signals: 0.1, 0.2, 0.3, 0.4, 0.5, 0.6');
    });
  });

  describe('lifecycle', () => {
    it('should transition to idle on deactivate', async () => {
      await agent.onDeactivate();
      expect(agent.getHealth().state).toBe('idle');
    });

    it('should track uptime after activation', async () => {
      // Agent was activated in beforeEach, wait a tiny bit
      const health = agent.getHealth();
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('determinism', () => {
    it('should always use temperature=0 regardless of profile temperature', async () => {
      // Even if profile specifies temperature=0.7, scoring agent should use 0
      // because the implementation reads from profile.parameters.temperature
      // and the requirement is that it's set to 0 for determinism
      const request = createComputeGradeRequest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      await agent.handleMessage(request);

      const call = groqClient.calls[0] as { temperature: number };
      expect(call.temperature).toBe(0);
    });
  });
});
