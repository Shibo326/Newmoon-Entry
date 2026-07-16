/**
 * Property-based tests for Message Bus (Properties 4-7).
 *
 * Uses fast-check with minimum 100 iterations per property test and Vitest as the runner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import {
  InMemoryMessageBus,
  validateMessage,
  MessageBusValidationError,
} from '../message-bus.js';
import type { AgentStateProvider, BufferedMessage } from '../message-bus.js';
import type {
  BusMessage,
  RequestMessage,
  ResponseMessage,
  ErrorMessage,
} from '../../types/messages.js';
import type { AgentLifecycleState } from '../../types/agent.js';

// --- Arbitraries (generators) ---

/** Alphanumeric char arbitrary. */
const arbAlphaNumChar = fc.char().filter((c) => /^[a-zA-Z0-9]$/.test(c));

/** Generates a valid UUID v4 string. */
const arbUuid = fc.uuidV(4);

/** Generates a non-empty agent ID string. */
const arbAgentId = fc.stringOf(arbAlphaNumChar, { minLength: 1, maxLength: 20 });

/** Generates a valid message type. */
const arbMessageType = fc.constantFrom('request', 'response', 'event', 'error' as const);

/** Generates a valid topic string. */
const arbTopic = fc.stringOf(arbAlphaNumChar, { minLength: 1, maxLength: 30 }).map(
  (s) => `topic.${s}`
);

/** Generates a valid payload object (non-null, non-array). */
const arbPayload = fc.dictionary(
  fc.stringOf(arbAlphaNumChar, { minLength: 1, maxLength: 10 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean())
).filter((obj) => !Array.isArray(obj));

/** Generates a valid BusMessage. */
const arbValidMessage: fc.Arbitrary<BusMessage> = fc.record({
  id: arbUuid,
  sourceAgentId: arbAgentId,
  targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
  type: arbMessageType,
  correlationId: arbUuid,
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  topic: arbTopic,
  payload: arbPayload,
}) as unknown as fc.Arbitrary<BusMessage>;

/** Generates a valid RequestMessage. */
const arbValidRequest: fc.Arbitrary<RequestMessage> = fc.record({
  id: arbUuid,
  sourceAgentId: arbAgentId,
  targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
  type: fc.constant('request' as const),
  correlationId: arbUuid,
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  topic: arbTopic,
  payload: arbPayload,
}) as unknown as fc.Arbitrary<RequestMessage>;

/**
 * Generates a message object that is missing at least one required field or has
 * an invalid type for a field, ensuring schema validation rejects it.
 */
const arbInvalidMessage: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // Missing id
  fc.record({
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: arbPayload,
  }),
  // Non-string id
  fc.record({
    id: fc.integer(),
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: arbPayload,
  }),
  // Empty sourceAgentId
  fc.record({
    id: arbUuid,
    sourceAgentId: fc.constant(''),
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: arbPayload,
  }),
  // Invalid type field
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: fc.constantFrom('invalid', 'unknown', 'message', ''),
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: arbPayload,
  }),
  // Missing correlationId
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: arbPayload,
  }),
  // Non-number timestamp
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.string(),
    topic: arbTopic,
    payload: arbPayload,
  }),
  // Empty topic
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: fc.constant(''),
    payload: arbPayload,
  }),
  // Null payload
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: fc.constant(null),
  }),
  // Array payload
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    targetAgentId: fc.oneof(arbAgentId, fc.constant(null)),
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: fc.constant([1, 2, 3]),
  }),
  // Missing targetAgentId key entirely
  fc.record({
    id: arbUuid,
    sourceAgentId: arbAgentId,
    type: arbMessageType,
    correlationId: arbUuid,
    timestamp: fc.nat(),
    topic: arbTopic,
    payload: arbPayload,
  })
);

// --- Property 4: Message Schema Validation ---

describe('Property 4: Message Schema Validation', () => {
  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any message object, the Message Bus SHALL accept the message if and only if it
   * contains all required fields (id, sourceAgentId, targetAgentId, type, correlationId,
   * timestamp, topic, payload) with correct types. Invalid messages SHALL be rejected
   * with a validation error and SHALL NOT be delivered to any subscriber.
   */

  it('accepts all valid messages with correct schema fields', () => {
    fc.assert(
      fc.property(arbValidMessage, (message) => {
        const errors = validateMessage(message);
        expect(errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects all invalid messages (missing or malformed fields)', () => {
    fc.assert(
      fc.property(arbInvalidMessage, (invalidMsg) => {
        const errors = validateMessage(invalidMsg);
        expect(errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('valid messages are published successfully to subscribers', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidMessage, async (message) => {
        const bus = new InMemoryMessageBus();
        const received: BusMessage[] = [];
        bus.subscribe(message.topic, async (msg) => { received.push(msg); });

        await bus.publish(message);
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(message);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid messages are never delivered to any subscriber', async () => {
    await fc.assert(
      fc.asyncProperty(arbInvalidMessage, arbTopic, async (invalidMsg, topic) => {
        const bus = new InMemoryMessageBus();
        const received: BusMessage[] = [];
        bus.subscribe(topic, async (msg) => { received.push(msg); });

        try {
          await bus.publish(invalidMsg as unknown as BusMessage);
        } catch (e) {
          expect(e).toBeInstanceOf(MessageBusValidationError);
        }

        expect(received).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 5: Topic-Based Subscription Routing ---

describe('Property 5: Topic-Based Subscription Routing', () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any set of agent subscriptions to specific topics, and for any published message
   * with a given topic, the Message Bus SHALL deliver the message to exactly those agents
   * subscribed to that topic and to no others.
   */

  /** Generates a set of unique topics for subscription routing tests. */
  const arbTopicSet = fc.uniqueArray(arbTopic, { minLength: 1, maxLength: 5 });

  it('delivers messages to exactly the agents subscribed to the matching topic', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTopicSet,
        fc.integer({ min: 1, max: 5 }),
        arbValidMessage,
        async (topics, numAgents, baseMessage) => {
          const bus = new InMemoryMessageBus();
          const deliveries: Map<string, BusMessage[]> = new Map();

          // Subscribe each "agent" to a random subset of available topics
          const agentSubscriptions: Map<string, string[]> = new Map();
          for (let i = 0; i < numAgents; i++) {
            const agentId = `agent-${i}`;
            deliveries.set(agentId, []);
            // Each agent subscribes to at least one random topic
            const subscribedTopics = topics.filter((_, idx) => (i + idx) % 2 === 0);
            if (subscribedTopics.length === 0) subscribedTopics.push(topics[0]!);
            agentSubscriptions.set(agentId, subscribedTopics);

            for (const t of subscribedTopics) {
              bus.subscribe(t, async (msg) => {
                deliveries.get(agentId)!.push(msg);
              }, agentId);
            }
          }

          // Pick a random topic from our set to publish on
          const publishTopic = topics[0]!;
          const message: BusMessage = {
            ...baseMessage,
            topic: publishTopic,
          };

          await bus.publish(message);

          // Verify: only agents subscribed to publishTopic received the message
          for (let i = 0; i < numAgents; i++) {
            const agentId = `agent-${i}`;
            const subscribedTopics = agentSubscriptions.get(agentId)!;
            const agentDeliveries = deliveries.get(agentId)!;

            if (subscribedTopics.includes(publishTopic)) {
              expect(agentDeliveries.length).toBeGreaterThanOrEqual(1);
              expect(agentDeliveries.every((m) => m.topic === publishTopic)).toBe(true);
            } else {
              expect(agentDeliveries).toHaveLength(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('delivers to no agents when no subscription matches the message topic', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidMessage, arbTopic, async (baseMessage, unusedTopic) => {
        const bus = new InMemoryMessageBus();
        const received: BusMessage[] = [];

        // Subscribe only to unusedTopic
        bus.subscribe(unusedTopic, async (msg) => { received.push(msg); });

        // Publish on a different topic (prepend to ensure it's different)
        const differentTopic = `other.${baseMessage.topic}`;
        const message: BusMessage = { ...baseMessage, topic: differentTopic };

        await bus.publish(message);

        expect(received).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('unsubscribed agents stop receiving messages for their former topic', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidMessage, async (baseMessage) => {
        const bus = new InMemoryMessageBus();
        const received: BusMessage[] = [];

        const sub = bus.subscribe(baseMessage.topic, async (msg) => {
          received.push(msg);
        });

        // Deliver once
        await bus.publish(baseMessage);
        expect(received).toHaveLength(1);

        // Unsubscribe and publish again
        bus.unsubscribe(sub);
        await bus.publish(baseMessage);

        // Should not receive the second message
        expect(received).toHaveLength(1);
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 6: Request Timeout Handling ---

describe('Property 6: Request Timeout Handling', () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * For any Request message where no Response is received within the sender's configured
   * timeout, the Message Bus SHALL deliver exactly one timeout Error message to the
   * requesting agent with the correct correlation identifier linking it to the original request.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces exactly one timeout error with correct correlationId when no response arrives', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidRequest,
        fc.integer({ min: 10, max: 5000 }),
        async (request, timeoutMs) => {
          const bus = new InMemoryMessageBus();

          // No responder registered — timeout is guaranteed
          const resultPromise = bus.request(request, timeoutMs);

          // Advance past the timeout
          vi.advanceTimersByTime(timeoutMs + 1);

          const result = await resultPromise;

          // Exactly one error response
          expect(result.type).toBe('error');
          // Correct correlation ID
          expect(result.correlationId).toBe(request.correlationId);
          // TIMEOUT code
          expect((result as ErrorMessage).payload.code).toBe('TIMEOUT');
          // Targeted at the requesting agent
          expect(result.targetAgentId).toBe(request.sourceAgentId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not produce a timeout error when a correlated response arrives before timeout', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidRequest,
        fc.integer({ min: 100, max: 5000 }),
        async (request, timeoutMs) => {
          const bus = new InMemoryMessageBus();

          // Set up responder that replies immediately
          bus.subscribe(request.topic, async (msg) => {
            if (msg.type === 'request' && msg.correlationId === request.correlationId) {
              const response: ResponseMessage = {
                id: uuidv4(),
                sourceAgentId: 'responder',
                targetAgentId: msg.sourceAgentId,
                type: 'response',
                correlationId: msg.correlationId,
                timestamp: Date.now(),
                topic: msg.topic,
                payload: { ok: true },
              };
              await bus.publish(response);
            }
          });

          const resultPromise = bus.request(request, timeoutMs);

          // Allow microtasks to resolve (response is synchronous in this test)
          await vi.advanceTimersByTimeAsync(1);

          const result = await resultPromise;

          expect(result.type).toBe('response');
          expect(result.correlationId).toBe(request.correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('timeout error description includes the timeout duration', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidRequest,
        fc.integer({ min: 10, max: 10000 }),
        async (request, timeoutMs) => {
          const bus = new InMemoryMessageBus();

          const resultPromise = bus.request(request, timeoutMs);
          vi.advanceTimersByTime(timeoutMs + 1);

          const result = await resultPromise;

          expect(result.type).toBe('error');
          const errorPayload = (result as ErrorMessage).payload;
          expect(errorPayload.description).toContain(`${timeoutMs}ms`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 7: Message Persistence for Inactive Agents ---

describe('Property 7: Message Persistence for Inactive Agents', () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * For any message targeted at an agent in error or disabled state, the Message Bus
   * SHALL buffer the message and deliver it when the agent transitions to active state.
   * Messages buffered longer than 1 hour SHALL be discarded and not delivered.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Generates an inactive state (error or disabled). */
  const arbInactiveState: fc.Arbitrary<AgentLifecycleState> = fc.constantFrom('error', 'disabled');

  it('buffers messages for agents in error or disabled state and delivers on activation', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInactiveState,
        fc.integer({ min: 1, max: 5 }),
        async (inactiveState, messageCount) => {
          const bus = new InMemoryMessageBus();
          const agentStates = new Map<string, AgentLifecycleState>();
          const targetAgentId = 'target-agent';

          agentStates.set(targetAgentId, inactiveState);
          bus.setAgentStateProvider((id) => agentStates.get(id));

          const received: BusMessage[] = [];
          const messages: BusMessage[] = [];

          // Generate messages
          for (let i = 0; i < messageCount; i++) {
            messages.push({
              id: uuidv4(),
              sourceAgentId: `sender-${i}`,
              targetAgentId,
              type: 'request',
              correlationId: uuidv4(),
              timestamp: Date.now(),
              topic: 'test.topic',
              payload: { index: i },
            } as BusMessage);
          }

          // Subscribe to the topic (simulates a handler for the agent)
          bus.subscribe('test.topic', async (msg) => { received.push(msg); });

          // Publish messages — should be buffered
          for (const msg of messages) {
            await bus.publish(msg);
          }
          expect(received).toHaveLength(0);
          expect(bus.getBufferedMessages(targetAgentId)).toHaveLength(messageCount);

          // Activate the agent
          agentStates.set(targetAgentId, 'active');
          await bus.onAgentActivated(targetAgentId);

          // All messages should now be delivered
          expect(received).toHaveLength(messageCount);
          for (let i = 0; i < messageCount; i++) {
            expect(received[i]).toEqual(messages[i]);
          }

          // Buffer should be cleared
          expect(bus.getBufferedMessages(targetAgentId)).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('discards messages buffered longer than 1 hour on activation', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInactiveState,
        fc.integer({ min: 3_600_001, max: 7_200_000 }),
        async (inactiveState, elapsedMs) => {
          const bus = new InMemoryMessageBus();
          const agentStates = new Map<string, AgentLifecycleState>();
          const targetAgentId = 'target-agent';

          agentStates.set(targetAgentId, inactiveState);
          bus.setAgentStateProvider((id) => agentStates.get(id));

          const received: BusMessage[] = [];
          bus.subscribe('test.topic', async (msg) => { received.push(msg); });

          // Publish a message
          const oldMessage: BusMessage = {
            id: uuidv4(),
            sourceAgentId: 'sender',
            targetAgentId,
            type: 'request',
            correlationId: uuidv4(),
            timestamp: Date.now(),
            topic: 'test.topic',
            payload: { old: true },
          } as BusMessage;
          await bus.publish(oldMessage);

          // Advance past 1 hour
          vi.advanceTimersByTime(elapsedMs);

          // Activate the agent
          agentStates.set(targetAgentId, 'active');
          await bus.onAgentActivated(targetAgentId);

          // Old message should be discarded
          expect(received).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('delivers recent messages but discards expired ones on activation', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInactiveState,
        async (inactiveState) => {
          const bus = new InMemoryMessageBus();
          const agentStates = new Map<string, AgentLifecycleState>();
          const targetAgentId = 'target-agent';

          agentStates.set(targetAgentId, inactiveState);
          bus.setAgentStateProvider((id) => agentStates.get(id));

          const received: BusMessage[] = [];
          bus.subscribe('test.topic', async (msg) => { received.push(msg); });

          // Publish old message
          const oldMessage: BusMessage = {
            id: uuidv4(),
            sourceAgentId: 'sender-old',
            targetAgentId,
            type: 'request',
            correlationId: uuidv4(),
            timestamp: Date.now(),
            topic: 'test.topic',
            payload: { age: 'old' },
          } as BusMessage;
          await bus.publish(oldMessage);

          // Advance past 1 hour
          vi.advanceTimersByTime(3_600_001);

          // Publish recent message
          const recentMessage: BusMessage = {
            id: uuidv4(),
            sourceAgentId: 'sender-recent',
            targetAgentId,
            type: 'request',
            correlationId: uuidv4(),
            timestamp: Date.now(),
            topic: 'test.topic',
            payload: { age: 'recent' },
          } as BusMessage;
          await bus.publish(recentMessage);

          // Activate the agent
          agentStates.set(targetAgentId, 'active');
          await bus.onAgentActivated(targetAgentId);

          // Only the recent message should be delivered
          expect(received).toHaveLength(1);
          expect(received[0]).toEqual(recentMessage);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not buffer broadcast messages even when target agents are inactive', async () => {
    await fc.assert(
      fc.asyncProperty(arbInactiveState, arbValidMessage, async (inactiveState, baseMessage) => {
        const bus = new InMemoryMessageBus();
        const agentStates = new Map<string, AgentLifecycleState>();

        agentStates.set('some-agent', inactiveState);
        bus.setAgentStateProvider((id) => agentStates.get(id));

        const received: BusMessage[] = [];
        bus.subscribe(baseMessage.topic, async (msg) => { received.push(msg); });

        // Broadcast message (targetAgentId = null)
        const broadcastMsg: BusMessage = { ...baseMessage, targetAgentId: null };
        await bus.publish(broadcastMsg);

        // Should be delivered immediately, never buffered
        expect(received).toHaveLength(1);
        expect(bus.getBufferedMessages('some-agent')).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
