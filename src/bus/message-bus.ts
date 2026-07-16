/**
 * In-memory Message Bus implementation for inter-agent communication.
 * Provides typed pub/sub messaging with schema validation, topic-based routing,
 * and request/response patterns with configurable timeouts.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  BusMessage,
  RequestMessage,
  ResponseMessage,
  ErrorMessage,
} from '../types/messages.js';
import type { AgentLifecycleState } from '../types/agent.js';

// Timer type declarations for environment-agnostic usage
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

export type MessageHandler = (message: BusMessage) => Promise<void>;

export type AgentStateProvider = (agentId: string) => AgentLifecycleState | undefined;

export interface BufferedMessage {
  message: BusMessage;
  bufferedAt: number;
}

export interface Subscription {
  id: string;
  topic: string;
  agentId: string;
}

export interface MessageBus {
  publish(message: BusMessage): Promise<void>;
  subscribe(topic: string, handler: MessageHandler, agentId?: string): Subscription;
  unsubscribe(subscription: Subscription): void;
  request(message: RequestMessage, timeoutMs?: number): Promise<ResponseMessage | ErrorMessage>;
  setAgentStateProvider(provider: AgentStateProvider): void;
  onAgentActivated(agentId: string): Promise<void>;
  getBufferedMessages(agentId: string): BufferedMessage[];
}

interface SubscriptionEntry {
  subscription: Subscription;
  handler: MessageHandler;
}

export interface MessageValidationError {
  field: string;
  message: string;
}

const VALID_MESSAGE_TYPES = ['request', 'response', 'event', 'error'] as const;

/**
 * UUID v4 format regex for validation.
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates a message against the required schema.
 * Returns an array of validation errors, empty if message is valid.
 */
export function validateMessage(message: unknown): MessageValidationError[] {
  const errors: MessageValidationError[] = [];

  if (message === null || message === undefined || typeof message !== 'object') {
    errors.push({ field: 'message', message: 'Message must be a non-null object' });
    return errors;
  }

  const msg = message as Record<string, unknown>;

  // id: required, string, UUID format
  if (msg.id === undefined || msg.id === null) {
    errors.push({ field: 'id', message: 'id is required' });
  } else if (typeof msg.id !== 'string') {
    errors.push({ field: 'id', message: 'id must be a string' });
  } else if (!UUID_V4_REGEX.test(msg.id)) {
    errors.push({ field: 'id', message: 'id must be a valid UUID v4' });
  }

  // sourceAgentId: required, non-empty string
  if (msg.sourceAgentId === undefined || msg.sourceAgentId === null) {
    errors.push({ field: 'sourceAgentId', message: 'sourceAgentId is required' });
  } else if (typeof msg.sourceAgentId !== 'string') {
    errors.push({ field: 'sourceAgentId', message: 'sourceAgentId must be a string' });
  } else if (msg.sourceAgentId.length === 0) {
    errors.push({ field: 'sourceAgentId', message: 'sourceAgentId must not be empty' });
  }

  // targetAgentId: required field, but may be null (broadcast) or string
  if (!('targetAgentId' in msg)) {
    errors.push({ field: 'targetAgentId', message: 'targetAgentId is required (use null for broadcast)' });
  } else if (msg.targetAgentId !== null && typeof msg.targetAgentId !== 'string') {
    errors.push({ field: 'targetAgentId', message: 'targetAgentId must be a string or null' });
  }

  // type: required, must be one of the valid types
  if (msg.type === undefined || msg.type === null) {
    errors.push({ field: 'type', message: 'type is required' });
  } else if (typeof msg.type !== 'string') {
    errors.push({ field: 'type', message: 'type must be a string' });
  } else if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(msg.type)) {
    errors.push({ field: 'type', message: `type must be one of: ${VALID_MESSAGE_TYPES.join(', ')}` });
  }

  // correlationId: required, non-empty string
  if (msg.correlationId === undefined || msg.correlationId === null) {
    errors.push({ field: 'correlationId', message: 'correlationId is required' });
  } else if (typeof msg.correlationId !== 'string') {
    errors.push({ field: 'correlationId', message: 'correlationId must be a string' });
  } else if (msg.correlationId.length === 0) {
    errors.push({ field: 'correlationId', message: 'correlationId must not be empty' });
  }

  // timestamp: required, number
  if (msg.timestamp === undefined || msg.timestamp === null) {
    errors.push({ field: 'timestamp', message: 'timestamp is required' });
  } else if (typeof msg.timestamp !== 'number') {
    errors.push({ field: 'timestamp', message: 'timestamp must be a number' });
  } else if (!Number.isFinite(msg.timestamp)) {
    errors.push({ field: 'timestamp', message: 'timestamp must be a finite number' });
  }

  // topic: required, non-empty string
  if (msg.topic === undefined || msg.topic === null) {
    errors.push({ field: 'topic', message: 'topic is required' });
  } else if (typeof msg.topic !== 'string') {
    errors.push({ field: 'topic', message: 'topic must be a string' });
  } else if (msg.topic.length === 0) {
    errors.push({ field: 'topic', message: 'topic must not be empty' });
  }

  // payload: required, object (non-null)
  if (msg.payload === undefined || msg.payload === null) {
    errors.push({ field: 'payload', message: 'payload is required' });
  } else if (typeof msg.payload !== 'object' || Array.isArray(msg.payload)) {
    errors.push({ field: 'payload', message: 'payload must be a non-null object' });
  }

  return errors;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_BUFFER_RETENTION_MS = 3_600_000; // 1 hour

/**
 * In-memory message bus with topic-based pub/sub, schema validation,
 * request/response correlation, and message buffering for inactive agents.
 */
export class InMemoryMessageBus implements MessageBus {
  private subscriptions: Map<string, SubscriptionEntry[]> = new Map();
  private agentStateProvider: AgentStateProvider | undefined;
  private messageBuffer: Map<string, BufferedMessage[]> = new Map();

  /**
   * Set a provider function that returns an agent's lifecycle state.
   * Used to determine whether to buffer messages for inactive agents.
   */
  setAgentStateProvider(provider: AgentStateProvider): void {
    this.agentStateProvider = provider;
  }

  /**
   * Get the currently buffered messages for an agent (for testing/inspection).
   */
  getBufferedMessages(agentId: string): BufferedMessage[] {
    return this.messageBuffer.get(agentId) ?? [];
  }

  /**
   * Deliver all buffered messages for an agent that has transitioned to active.
   * Discards messages buffered longer than 1 hour.
   */
  async onAgentActivated(agentId: string): Promise<void> {
    const buffered = this.messageBuffer.get(agentId);
    if (!buffered || buffered.length === 0) return;

    const now = Date.now();
    const validMessages = buffered.filter(
      (entry) => now - entry.bufferedAt < MAX_BUFFER_RETENTION_MS
    );

    // Clear the buffer for this agent
    this.messageBuffer.delete(agentId);

    // Deliver valid buffered messages
    for (const entry of validMessages) {
      const topicSubscribers = this.subscriptions.get(entry.message.topic) ?? [];
      const deliveryPromises = topicSubscribers.map((sub) => sub.handler(entry.message));
      await Promise.all(deliveryPromises);
    }
  }

  /**
   * Publish a message to all subscribers of the message's topic.
   * Validates the message schema before delivery.
   * If the message targets a specific agent that is in error/disabled state,
   * buffers the message instead of delivering it.
   * Broadcast messages (targetAgentId === null) are never buffered.
   * Throws if the message fails validation.
   */
  async publish(message: BusMessage): Promise<void> {
    const validationErrors = validateMessage(message);
    if (validationErrors.length > 0) {
      throw new MessageBusValidationError(validationErrors);
    }

    // Check if message should be buffered for an inactive target agent
    if (message.targetAgentId !== null && this.agentStateProvider) {
      const targetState = this.agentStateProvider(message.targetAgentId);
      if (targetState === 'error' || targetState === 'disabled') {
        this.bufferMessage(message.targetAgentId, message);
        return;
      }
    }

    const topicSubscribers = this.subscriptions.get(message.topic) ?? [];

    const deliveryPromises = topicSubscribers.map((entry) => entry.handler(message));
    await Promise.all(deliveryPromises);
  }

  /**
   * Buffer a message for later delivery when the target agent becomes active.
   */
  private bufferMessage(agentId: string, message: BusMessage): void {
    const existing = this.messageBuffer.get(agentId) ?? [];
    // Purge expired entries while adding new ones
    const now = Date.now();
    const validEntries = existing.filter(
      (entry) => now - entry.bufferedAt < MAX_BUFFER_RETENTION_MS
    );
    validEntries.push({ message, bufferedAt: now });
    this.messageBuffer.set(agentId, validEntries);
  }

  /**
   * Subscribe a handler to a specific topic.
   * Returns a Subscription object that can be used to unsubscribe.
   */
  subscribe(topic: string, handler: MessageHandler, agentId?: string): Subscription {
    const subscription: Subscription = {
      id: uuidv4(),
      topic,
      agentId: agentId ?? '',
    };

    const entry: SubscriptionEntry = { subscription, handler };

    const existing = this.subscriptions.get(topic);
    if (existing) {
      existing.push(entry);
    } else {
      this.subscriptions.set(topic, [entry]);
    }

    return subscription;
  }

  /**
   * Remove a subscription, stopping message delivery for that handler.
   */
  unsubscribe(subscription: Subscription): void {
    const topicSubscribers = this.subscriptions.get(subscription.topic);
    if (!topicSubscribers) return;

    const filtered = topicSubscribers.filter(
      (entry) => entry.subscription.id !== subscription.id
    );

    if (filtered.length === 0) {
      this.subscriptions.delete(subscription.topic);
    } else {
      this.subscriptions.set(subscription.topic, filtered);
    }
  }

  /**
   * Send a request message and wait for a correlated response.
   * Uses correlation ID matching to pair request with response.
   * Times out with an ErrorMessage if no response arrives within timeoutMs (default 30s).
   */
  async request(
    message: RequestMessage,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<ResponseMessage | ErrorMessage> {
    const validationErrors = validateMessage(message);
    if (validationErrors.length > 0) {
      throw new MessageBusValidationError(validationErrors);
    }

    return new Promise<ResponseMessage | ErrorMessage>((resolve) => {
      let settled = false;

      // Subscribe to the response topic to catch correlated responses
      const responseTopic = message.topic;
      const responseSubscription = this.subscribe(
        responseTopic,
        async (responseMsg: BusMessage) => {
          if (settled) return;
          if (
            responseMsg.correlationId === message.correlationId &&
            (responseMsg.type === 'response' || responseMsg.type === 'error')
          ) {
            settled = true;
            clearTimeout(timer);
            this.unsubscribe(responseSubscription);
            resolve(responseMsg as ResponseMessage | ErrorMessage);
          }
        },
        message.sourceAgentId
      );

      // Set up timeout
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.unsubscribe(responseSubscription);

        const timeoutError: ErrorMessage = {
          id: uuidv4(),
          sourceAgentId: 'message-bus',
          targetAgentId: message.sourceAgentId,
          type: 'error',
          correlationId: message.correlationId,
          timestamp: Date.now(),
          topic: message.topic,
          payload: {
            code: 'TIMEOUT',
            description: `Request timed out after ${timeoutMs}ms`,
          },
        };
        resolve(timeoutError);
      }, timeoutMs);

      // Publish the request to route it to subscribers
      void this.publish(message).catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.unsubscribe(responseSubscription);

        const publishError: ErrorMessage = {
          id: uuidv4(),
          sourceAgentId: 'message-bus',
          targetAgentId: message.sourceAgentId,
          type: 'error',
          correlationId: message.correlationId,
          timestamp: Date.now(),
          topic: message.topic,
          payload: {
            code: 'PUBLISH_FAILED',
            description: 'Failed to publish request message',
          },
        };
        resolve(publishError);
      });
    });
  }
}

/**
 * Error thrown when a message fails schema validation.
 */
export class MessageBusValidationError extends Error {
  public readonly validationErrors: MessageValidationError[];

  constructor(errors: MessageValidationError[]) {
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    super(`Message validation failed: ${summary}`);
    this.name = 'MessageBusValidationError';
    this.validationErrors = errors;
  }
}

export default InMemoryMessageBus;
