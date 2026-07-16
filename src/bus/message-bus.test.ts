import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  InMemoryMessageBus,
  validateMessage,
  MessageBusValidationError,
} from './message-bus.js';
import type { AgentStateProvider } from './message-bus.js';
import type { BusMessage, RequestMessage, ResponseMessage, ErrorMessage } from '../types/messages.js';
import type { AgentLifecycleState } from '../types/agent.js';

function createValidMessage(overrides: Partial<BusMessage> = {}): BusMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'agent-1',
    targetAgentId: null,
    type: 'event',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'test.topic',
    payload: { data: 'hello' },
    ...overrides,
  } as BusMessage;
}

function createRequestMessage(overrides: Partial<RequestMessage> = {}): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'agent-1',
    targetAgentId: 'agent-2',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'test.request',
    payload: { action: 'doSomething' },
    ...overrides,
  };
}

describe('validateMessage', () => {
  it('accepts a valid message with all required fields', () => {
    const msg = createValidMessage();
    const errors = validateMessage(msg);
    expect(errors).toHaveLength(0);
  });

  it('rejects null message', () => {
    const errors = validateMessage(null);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.field).toBe('message');
  });

  it('rejects non-object message', () => {
    const errors = validateMessage('not an object');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects message with missing id', () => {
    const msg = createValidMessage();
    const { id: _, ...noId } = msg;
    const errors = validateMessage(noId);
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('rejects message with non-UUID id', () => {
    const msg = createValidMessage({ id: 'not-a-uuid' } as unknown as Partial<BusMessage>);
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('rejects message with missing sourceAgentId', () => {
    const msg = createValidMessage();
    const { sourceAgentId: _, ...noSource } = msg;
    const errors = validateMessage(noSource);
    expect(errors.some((e) => e.field === 'sourceAgentId')).toBe(true);
  });

  it('rejects message with empty sourceAgentId', () => {
    const msg = createValidMessage({ sourceAgentId: '' });
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'sourceAgentId')).toBe(true);
  });

  it('rejects message with missing targetAgentId field entirely', () => {
    const msg = createValidMessage();
    const { targetAgentId: _, ...noTarget } = msg;
    const errors = validateMessage(noTarget);
    expect(errors.some((e) => e.field === 'targetAgentId')).toBe(true);
  });

  it('accepts message with null targetAgentId (broadcast)', () => {
    const msg = createValidMessage({ targetAgentId: null });
    const errors = validateMessage(msg);
    expect(errors).toHaveLength(0);
  });

  it('rejects message with invalid type', () => {
    const msg = createValidMessage({ type: 'invalid' } as unknown as Partial<BusMessage>);
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('rejects message with missing correlationId', () => {
    const msg = createValidMessage();
    const { correlationId: _, ...noCorrId } = msg;
    const errors = validateMessage(noCorrId);
    expect(errors.some((e) => e.field === 'correlationId')).toBe(true);
  });

  it('rejects message with non-number timestamp', () => {
    const msg = createValidMessage({ timestamp: 'now' } as unknown as Partial<BusMessage>);
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'timestamp')).toBe(true);
  });

  it('rejects message with empty topic', () => {
    const msg = createValidMessage({ topic: '' });
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'topic')).toBe(true);
  });

  it('rejects message with null payload', () => {
    const msg = createValidMessage({ payload: null } as unknown as Partial<BusMessage>);
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'payload')).toBe(true);
  });

  it('rejects message with array payload', () => {
    const msg = createValidMessage({ payload: [] } as unknown as Partial<BusMessage>);
    const errors = validateMessage(msg);
    expect(errors.some((e) => e.field === 'payload')).toBe(true);
  });

  it('reports multiple validation errors at once', () => {
    const errors = validateMessage({ id: 123, type: 'bad' });
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('InMemoryMessageBus', () => {
  describe('publish', () => {
    it('delivers a valid message to topic subscribers', async () => {
      const bus = new InMemoryMessageBus();
      const received: BusMessage[] = [];

      bus.subscribe('test.topic', async (msg) => {
        received.push(msg);
      });

      const message = createValidMessage();
      await bus.publish(message);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(message);
    });

    it('delivers to multiple subscribers on the same topic', async () => {
      const bus = new InMemoryMessageBus();
      const received1: BusMessage[] = [];
      const received2: BusMessage[] = [];

      bus.subscribe('test.topic', async (msg) => { received1.push(msg); });
      bus.subscribe('test.topic', async (msg) => { received2.push(msg); });

      await bus.publish(createValidMessage());

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('does not deliver to subscribers of different topics', async () => {
      const bus = new InMemoryMessageBus();
      const received: BusMessage[] = [];

      bus.subscribe('other.topic', async (msg) => { received.push(msg); });

      await bus.publish(createValidMessage({ topic: 'test.topic' }));

      expect(received).toHaveLength(0);
    });

    it('throws MessageBusValidationError for invalid messages', async () => {
      const bus = new InMemoryMessageBus();
      const invalidMsg = { id: 'bad' } as unknown as BusMessage;

      await expect(bus.publish(invalidMsg)).rejects.toThrow(MessageBusValidationError);
    });

    it('does not deliver invalid messages to subscribers', async () => {
      const bus = new InMemoryMessageBus();
      const received: BusMessage[] = [];

      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const invalidMsg = { topic: 'test.topic' } as unknown as BusMessage;
      await expect(bus.publish(invalidMsg)).rejects.toThrow();

      expect(received).toHaveLength(0);
    });
  });

  describe('subscribe and unsubscribe', () => {
    it('returns a subscription with unique ID and correct topic', () => {
      const bus = new InMemoryMessageBus();
      const sub = bus.subscribe('my.topic', async () => {});

      expect(sub.id).toBeDefined();
      expect(sub.topic).toBe('my.topic');
    });

    it('stops delivering messages after unsubscribe', async () => {
      const bus = new InMemoryMessageBus();
      const received: BusMessage[] = [];

      const sub = bus.subscribe('test.topic', async (msg) => { received.push(msg); });
      await bus.publish(createValidMessage());
      expect(received).toHaveLength(1);

      bus.unsubscribe(sub);
      await bus.publish(createValidMessage());
      expect(received).toHaveLength(1); // no new deliveries
    });

    it('unsubscribing one does not affect others on same topic', async () => {
      const bus = new InMemoryMessageBus();
      const received1: BusMessage[] = [];
      const received2: BusMessage[] = [];

      const sub1 = bus.subscribe('test.topic', async (msg) => { received1.push(msg); });
      bus.subscribe('test.topic', async (msg) => { received2.push(msg); });

      bus.unsubscribe(sub1);
      await bus.publish(createValidMessage());

      expect(received1).toHaveLength(0);
      expect(received2).toHaveLength(1);
    });

    it('sets agentId on subscription when provided', () => {
      const bus = new InMemoryMessageBus();
      const sub = bus.subscribe('my.topic', async () => {}, 'agent-x');
      expect(sub.agentId).toBe('agent-x');
    });
  });

  describe('request', () => {
    it('resolves with response when correlated response arrives', async () => {
      const bus = new InMemoryMessageBus();
      const reqMsg = createRequestMessage();

      // Simulate a responder
      bus.subscribe('test.request', async (msg) => {
        if (msg.type === 'request') {
          const response: ResponseMessage = {
            id: uuidv4(),
            sourceAgentId: 'agent-2',
            targetAgentId: msg.sourceAgentId,
            type: 'response',
            correlationId: msg.correlationId,
            timestamp: Date.now(),
            topic: msg.topic,
            payload: { result: 'done' },
          };
          await bus.publish(response);
        }
      });

      const result = await bus.request(reqMsg, 5000);
      expect(result.type).toBe('response');
      expect(result.correlationId).toBe(reqMsg.correlationId);
      expect(result.payload).toEqual({ result: 'done' });
    });

    it('resolves with timeout error when no response arrives', async () => {
      vi.useFakeTimers();
      const bus = new InMemoryMessageBus();
      const reqMsg = createRequestMessage();

      const resultPromise = bus.request(reqMsg, 100);

      vi.advanceTimersByTime(101);

      const result = await resultPromise;
      expect(result.type).toBe('error');
      expect((result as ErrorMessage).payload.code).toBe('TIMEOUT');
      expect(result.correlationId).toBe(reqMsg.correlationId);

      vi.useRealTimers();
    });

    it('uses correct correlation ID in timeout error', async () => {
      vi.useFakeTimers();
      const bus = new InMemoryMessageBus();
      const correlationId = uuidv4();
      const reqMsg = createRequestMessage({ correlationId });

      const resultPromise = bus.request(reqMsg, 50);
      vi.advanceTimersByTime(51);

      const result = await resultPromise;
      expect(result.correlationId).toBe(correlationId);

      vi.useRealTimers();
    });

    it('throws validation error for invalid request message', async () => {
      const bus = new InMemoryMessageBus();
      const invalidReq = { type: 'request' } as unknown as RequestMessage;

      await expect(bus.request(invalidReq)).rejects.toThrow(MessageBusValidationError);
    });

    it('ignores responses with non-matching correlation IDs', async () => {
      vi.useFakeTimers();
      const bus = new InMemoryMessageBus();
      const reqMsg = createRequestMessage();

      // Responder sends a response with a different correlationId
      bus.subscribe('test.request', async (msg) => {
        if (msg.type === 'request') {
          const wrongResponse: ResponseMessage = {
            id: uuidv4(),
            sourceAgentId: 'agent-2',
            targetAgentId: msg.sourceAgentId,
            type: 'response',
            correlationId: uuidv4(), // different correlation ID
            timestamp: Date.now(),
            topic: msg.topic,
            payload: { result: 'wrong' },
          };
          await bus.publish(wrongResponse);
        }
      });

      const resultPromise = bus.request(reqMsg, 100);
      vi.advanceTimersByTime(101);

      const result = await resultPromise;
      expect(result.type).toBe('error');
      expect((result as ErrorMessage).payload.code).toBe('TIMEOUT');

      vi.useRealTimers();
    });

    it('defaults to 30s timeout', async () => {
      vi.useFakeTimers();
      const bus = new InMemoryMessageBus();
      const reqMsg = createRequestMessage();

      const resultPromise = bus.request(reqMsg);

      // Not timed out at 29s
      vi.advanceTimersByTime(29_000);
      // Should still be pending

      // Timed out at 30s
      vi.advanceTimersByTime(1_001);
      const result = await resultPromise;
      expect(result.type).toBe('error');
      expect((result as ErrorMessage).payload.code).toBe('TIMEOUT');
      expect((result as ErrorMessage).payload.description).toContain('30000ms');

      vi.useRealTimers();
    });
  });
});


describe('InMemoryMessageBus - Message Buffering for Inactive Agents', () => {
  let bus: InMemoryMessageBus;
  const agentStates: Map<string, AgentLifecycleState> = new Map();

  beforeEach(() => {
    bus = new InMemoryMessageBus();
    agentStates.clear();
    const stateProvider: AgentStateProvider = (agentId) => agentStates.get(agentId);
    bus.setAgentStateProvider(stateProvider);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTargetedMessage(targetAgentId: string, topic = 'test.topic'): BusMessage {
    return {
      id: uuidv4(),
      sourceAgentId: 'sender-agent',
      targetAgentId,
      type: 'request',
      correlationId: uuidv4(),
      timestamp: Date.now(),
      topic,
      payload: { data: 'test' },
    } as BusMessage;
  }

  describe('setAgentStateProvider', () => {
    it('accepts a state provider function', () => {
      // Should not throw
      bus.setAgentStateProvider((id) => id === 'x' ? 'active' : undefined);
    });
  });

  describe('publish with buffering', () => {
    it('buffers messages targeted at agent in error state', async () => {
      agentStates.set('agent-error', 'error');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const message = createTargetedMessage('agent-error');
      await bus.publish(message);

      expect(received).toHaveLength(0);
      expect(bus.getBufferedMessages('agent-error')).toHaveLength(1);
      expect(bus.getBufferedMessages('agent-error')[0]!.message).toEqual(message);
    });

    it('buffers messages targeted at agent in disabled state', async () => {
      agentStates.set('agent-disabled', 'disabled');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const message = createTargetedMessage('agent-disabled');
      await bus.publish(message);

      expect(received).toHaveLength(0);
      expect(bus.getBufferedMessages('agent-disabled')).toHaveLength(1);
    });

    it('delivers messages targeted at agent in active state normally', async () => {
      agentStates.set('agent-active', 'active');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const message = createTargetedMessage('agent-active');
      await bus.publish(message);

      expect(received).toHaveLength(1);
      expect(bus.getBufferedMessages('agent-active')).toHaveLength(0);
    });

    it('delivers messages targeted at agent in idle state normally', async () => {
      agentStates.set('agent-idle', 'idle');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const message = createTargetedMessage('agent-idle');
      await bus.publish(message);

      expect(received).toHaveLength(1);
      expect(bus.getBufferedMessages('agent-idle')).toHaveLength(0);
    });

    it('never buffers broadcast messages (targetAgentId === null)', async () => {
      agentStates.set('agent-error', 'error');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const broadcastMsg: BusMessage = {
        id: uuidv4(),
        sourceAgentId: 'sender-agent',
        targetAgentId: null,
        type: 'event',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'test.topic',
        payload: { data: 'broadcast' },
      };
      await bus.publish(broadcastMsg);

      expect(received).toHaveLength(1);
    });

    it('delivers normally when no state provider is set', async () => {
      const busNoProvider = new InMemoryMessageBus();
      const received: BusMessage[] = [];
      busNoProvider.subscribe('test.topic', async (msg) => { received.push(msg); });

      const message = createTargetedMessage('some-agent');
      await busNoProvider.publish(message);

      expect(received).toHaveLength(1);
    });

    it('delivers normally when state provider returns undefined for agent', async () => {
      // agent not registered — provider returns undefined
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const message = createTargetedMessage('unknown-agent');
      await bus.publish(message);

      expect(received).toHaveLength(1);
    });

    it('buffers multiple messages for the same agent', async () => {
      agentStates.set('agent-error', 'error');

      await bus.publish(createTargetedMessage('agent-error'));
      await bus.publish(createTargetedMessage('agent-error'));
      await bus.publish(createTargetedMessage('agent-error'));

      expect(bus.getBufferedMessages('agent-error')).toHaveLength(3);
    });
  });

  describe('onAgentActivated', () => {
    it('delivers all buffered messages when agent transitions to active', async () => {
      agentStates.set('agent-err', 'error');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const msg1 = createTargetedMessage('agent-err');
      const msg2 = createTargetedMessage('agent-err');
      await bus.publish(msg1);
      await bus.publish(msg2);
      expect(received).toHaveLength(0);

      // Transition to active
      agentStates.set('agent-err', 'active');
      await bus.onAgentActivated('agent-err');

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual(msg1);
      expect(received[1]).toEqual(msg2);
    });

    it('clears the buffer after delivery', async () => {
      agentStates.set('agent-err', 'error');
      bus.subscribe('test.topic', async () => {});

      await bus.publish(createTargetedMessage('agent-err'));
      expect(bus.getBufferedMessages('agent-err')).toHaveLength(1);

      agentStates.set('agent-err', 'active');
      await bus.onAgentActivated('agent-err');

      expect(bus.getBufferedMessages('agent-err')).toHaveLength(0);
    });

    it('does nothing if agent has no buffered messages', async () => {
      // Should not throw
      await bus.onAgentActivated('no-buffer-agent');
    });

    it('discards messages buffered longer than 1 hour', async () => {
      vi.useFakeTimers();
      agentStates.set('agent-err', 'error');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      // Publish a message
      const oldMsg = createTargetedMessage('agent-err');
      await bus.publish(oldMsg);

      // Advance time by more than 1 hour
      vi.advanceTimersByTime(3_600_001);

      // Publish a recent message
      const newMsg = createTargetedMessage('agent-err');
      await bus.publish(newMsg);

      // Activate the agent
      agentStates.set('agent-err', 'active');
      await bus.onAgentActivated('agent-err');

      // Only the recent message should be delivered
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(newMsg);
    });

    it('delivers messages buffered exactly at the 1 hour boundary', async () => {
      vi.useFakeTimers();
      agentStates.set('agent-err', 'error');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      const msg = createTargetedMessage('agent-err');
      await bus.publish(msg);

      // Advance time to exactly 1 hour (not over)
      vi.advanceTimersByTime(3_599_999);

      agentStates.set('agent-err', 'active');
      await bus.onAgentActivated('agent-err');

      // Should still be delivered (< 1 hour)
      expect(received).toHaveLength(1);
    });

    it('discards all buffered messages if all are expired', async () => {
      vi.useFakeTimers();
      agentStates.set('agent-err', 'error');
      const received: BusMessage[] = [];
      bus.subscribe('test.topic', async (msg) => { received.push(msg); });

      await bus.publish(createTargetedMessage('agent-err'));
      await bus.publish(createTargetedMessage('agent-err'));

      // Advance time past 1 hour
      vi.advanceTimersByTime(3_700_000);

      agentStates.set('agent-err', 'active');
      await bus.onAgentActivated('agent-err');

      expect(received).toHaveLength(0);
      expect(bus.getBufferedMessages('agent-err')).toHaveLength(0);
    });
  });

  describe('buffer expiry on publish', () => {
    it('purges expired messages from buffer when new message is added', async () => {
      vi.useFakeTimers();
      agentStates.set('agent-err', 'error');

      // Buffer a message
      await bus.publish(createTargetedMessage('agent-err'));
      expect(bus.getBufferedMessages('agent-err')).toHaveLength(1);

      // Advance past 1 hour
      vi.advanceTimersByTime(3_600_001);

      // Buffer another message — this should purge the expired one
      await bus.publish(createTargetedMessage('agent-err'));
      expect(bus.getBufferedMessages('agent-err')).toHaveLength(1);
    });
  });
});
