/**
 * Property-Based Tests: Cache Agent (Properties 20, 21)
 *
 * Property 20: Cache Hit/Miss Correctness
 * For any check-cache request with wallet address W and signal hash H, the Cache Agent
 * SHALL return the cached grade and reasoning if an entry exists with matching hash and
 * computation timestamp less than the configured TTL. Otherwise it SHALL return a
 * cache-miss response containing W and H.
 *
 * Property 21: Cache Graceful Degradation
 * For any cache read or write failure (after exhausting retries from the Behavior Profile),
 * the Cache Agent SHALL return a cache-unavailable response (not an error that halts the
 * pipeline) and publish a "cache.failure" event.
 *
 * **Validates: Requirements 9.1, 9.2, 9.5**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { CacheAgent } from '../cache-agent.js';
import type { CacheStore, CacheEntry } from '../cache-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage, ResponseMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

// --- Test Helpers ---

function createMockBus(): MessageBus & { publishCalls: any[] } {
  const publishCalls: any[] = [];
  return {
    publishCalls,
    publish: async (msg: any) => { publishCalls.push(msg); },
    subscribe: () => ({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: () => {},
    request: async () => ({} as any),
    setAgentStateProvider: () => {},
    onAgentActivated: async () => {},
    getBufferedMessages: () => [],
  };
}

function createCheckCacheRequest(walletAddress: string, signalHash: string): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'cache-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'cache.check-cache',
    payload: { walletAddress, signalHash },
  };
}

function createStoreResultRequest(
  walletAddress: string,
  signalHash: string,
  creditGrade: string,
  reasoning: Record<string, unknown>[],
  timestamp: number
): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'cache-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'cache.store-result',
    payload: { walletAddress, signalHash, creditGrade, reasoning, timestamp },
  };
}

function createProfile(ttlMs: number, maxRetries = 2, retryDelayMs = 0): BehaviorProfile {
  return {
    agentId: 'cache-agent',
    version: 1,
    parameters: {
      ttlMs,
      connectionPoolSize: 5,
      maxRetries,
      retryDelayMs,
    },
    lastModified: Date.now(),
  };
}

// --- Generators ---

const VALID_GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'C'] as const;

/** Generate a valid wallet address string. */
const walletAddressArb = fc.stringMatching(/^addr_test1[a-z0-9]{10,50}$/);

/** Generate a valid signal hash string. */
const signalHashArb = fc.stringMatching(/^[a-f0-9]{8,64}$/);

/** Generate a valid credit grade. */
const creditGradeArb = fc.constantFrom(...VALID_GRADES);

/** Generate a reasoning breakdown (only hashes and metrics, no raw signals). */
const reasoningArb = fc.array(
  fc.record({
    signal: fc.constantFrom('wallet_age', 'tx_freq', 'defi', 'repayment', 'diversity', 'liquidation'),
    direction: fc.constantFrom('positive', 'negative'),
    weight: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  { minLength: 1, maxLength: 6 }
);

/** Generate a TTL value in milliseconds (1 second to 48 hours). */
const ttlMsArb = fc.integer({ min: 1000, max: 172_800_000 });

/**
 * Generate a timestamp offset relative to "now" indicating how long ago an entry was cached.
 * Range: 0 ms ago to 96 hours ago.
 */
const ageOffsetMsArb = fc.integer({ min: 0, max: 345_600_000 });

/** Generate a retry count (0–5). */
const maxRetriesArb = fc.integer({ min: 0, max: 5 });

// --- Property Tests ---

describe('Property 20: Cache Hit/Miss Correctness', () => {
  let bus: MessageBus & { publishCalls: any[] };

  beforeEach(() => {
    bus = createMockBus();
  });

  it('SHALL return cached grade and reasoning when entry exists with matching hash and within TTL', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        creditGradeArb,
        reasoningArb,
        ttlMsArb,
        async (walletAddress, signalHash, grade, reasoning, ttlMs) => {
          // Entry was cached recently — well within TTL
          const computedAt = Date.now() - Math.floor(ttlMs / 2);

          const entry: CacheEntry = {
            walletAddress,
            signalHash,
            creditGrade: grade,
            reasoning: reasoning as Record<string, unknown>[],
            computedAt,
          };

          const store: CacheStore = {
            get: async () => entry,
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(ttlMs));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          const response = await agent.handleMessage(request);

          // Must be a cache hit response
          expect(response.type).toBe('response');
          const payload = (response as ResponseMessage).payload;
          expect(payload.hit).toBe(true);
          expect(payload.grade).toBe(grade);
          expect(payload.reasoning).toEqual(reasoning);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return cache-miss when no entry exists for the wallet/hash combination', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        ttlMsArb,
        async (walletAddress, signalHash, ttlMs) => {
          // Store returns null — no entry
          const store: CacheStore = {
            get: async () => null,
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(ttlMs));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          const response = await agent.handleMessage(request);

          expect(response.type).toBe('response');
          const payload = (response as ResponseMessage).payload;
          expect(payload.hit).toBe(false);
          expect(payload.walletAddress).toBe(walletAddress);
          expect(payload.signalHash).toBe(signalHash);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return cache-miss when entry exists but TTL has expired', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        creditGradeArb,
        reasoningArb,
        ttlMsArb,
        async (walletAddress, signalHash, grade, reasoning, ttlMs) => {
          // Entry was cached longer ago than the TTL allows
          const computedAt = Date.now() - ttlMs - 1;

          const entry: CacheEntry = {
            walletAddress,
            signalHash,
            creditGrade: grade,
            reasoning: reasoning as Record<string, unknown>[],
            computedAt,
          };

          const store: CacheStore = {
            get: async () => entry,
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(ttlMs));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          const response = await agent.handleMessage(request);

          // Must be a cache miss — TTL expired
          expect(response.type).toBe('response');
          const payload = (response as ResponseMessage).payload;
          expect(payload.hit).toBe(false);
          expect(payload.walletAddress).toBe(walletAddress);
          expect(payload.signalHash).toBe(signalHash);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL correctly distinguish hit vs miss based on TTL boundary', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        creditGradeArb,
        reasoningArb,
        ttlMsArb,
        ageOffsetMsArb,
        async (walletAddress, signalHash, grade, reasoning, ttlMs, ageOffsetMs) => {
          const computedAt = Date.now() - ageOffsetMs;
          const isWithinTtl = ageOffsetMs < ttlMs;

          const entry: CacheEntry = {
            walletAddress,
            signalHash,
            creditGrade: grade,
            reasoning: reasoning as Record<string, unknown>[],
            computedAt,
          };

          const store: CacheStore = {
            get: async () => entry,
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(ttlMs));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          const response = await agent.handleMessage(request);

          expect(response.type).toBe('response');
          const payload = (response as ResponseMessage).payload;

          if (isWithinTtl) {
            // Entry within TTL → cache hit
            expect(payload.hit).toBe(true);
            expect(payload.grade).toBe(grade);
            expect(payload.reasoning).toEqual(reasoning);
          } else {
            // Entry expired → cache miss
            expect(payload.hit).toBe(false);
            expect(payload.walletAddress).toBe(walletAddress);
            expect(payload.signalHash).toBe(signalHash);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 21: Cache Graceful Degradation', () => {
  let bus: MessageBus & { publishCalls: any[] };

  beforeEach(() => {
    bus = createMockBus();
  });

  it('SHALL return cache-unavailable (not error) on read failure after retry exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        maxRetriesArb,
        async (walletAddress, signalHash, maxRetries) => {
          bus = createMockBus();

          // Store always fails
          const store: CacheStore = {
            get: async () => { throw new Error('Connection refused'); },
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(86_400_000, maxRetries, 0));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          const response = await agent.handleMessage(request);

          // Must be a response, NOT an error — graceful degradation
          expect(response.type).toBe('response');
          const payload = (response as ResponseMessage).payload;
          expect(payload.cacheAvailable).toBe(false);

          // Must NOT be 'error' type (would halt pipeline)
          expect(response.type).not.toBe('error');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL return cache-unavailable (not error) on write failure after retry exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        creditGradeArb,
        reasoningArb,
        maxRetriesArb,
        async (walletAddress, signalHash, grade, reasoning, maxRetries) => {
          bus = createMockBus();

          // Store writes always fail
          const store: CacheStore = {
            get: async () => null,
            set: async () => { throw new Error('Write failed'); },
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(86_400_000, maxRetries, 0));
          await agent.onActivate();

          const request = createStoreResultRequest(
            walletAddress,
            signalHash,
            grade,
            reasoning as Record<string, unknown>[],
            Date.now()
          );
          const response = await agent.handleMessage(request);

          // Must be a response, NOT an error — graceful degradation
          expect(response.type).toBe('response');
          const payload = (response as ResponseMessage).payload;
          expect(payload.cacheAvailable).toBe(false);
          expect(response.type).not.toBe('error');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL publish "cache.failure" event on read failure after retry exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        maxRetriesArb,
        async (walletAddress, signalHash, maxRetries) => {
          bus = createMockBus();

          const store: CacheStore = {
            get: async () => { throw new Error('Connection timeout'); },
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(86_400_000, maxRetries, 0));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          await agent.handleMessage(request);

          // Must have published a "cache.failure" event
          const failureEvent = bus.publishCalls.find(
            (msg: any) => msg.topic === 'cache.failure'
          );
          expect(failureEvent).toBeDefined();
          expect(failureEvent.type).toBe('event');
          expect(failureEvent.payload.operation).toBe('read');
          expect(typeof failureEvent.payload.timestamp).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL publish "cache.failure" event on write failure after retry exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        creditGradeArb,
        reasoningArb,
        maxRetriesArb,
        async (walletAddress, signalHash, grade, reasoning, maxRetries) => {
          bus = createMockBus();

          const store: CacheStore = {
            get: async () => null,
            set: async () => { throw new Error('Write failed'); },
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(86_400_000, maxRetries, 0));
          await agent.onActivate();

          const request = createStoreResultRequest(
            walletAddress,
            signalHash,
            grade,
            reasoning as Record<string, unknown>[],
            Date.now()
          );
          await agent.handleMessage(request);

          // Must have published a "cache.failure" event
          const failureEvent = bus.publishCalls.find(
            (msg: any) => msg.topic === 'cache.failure'
          );
          expect(failureEvent).toBeDefined();
          expect(failureEvent.type).toBe('event');
          expect(failureEvent.payload.operation).toBe('write');
          expect(typeof failureEvent.payload.timestamp).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL retry exactly maxRetries times before degrading gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        walletAddressArb,
        signalHashArb,
        maxRetriesArb,
        async (walletAddress, signalHash, maxRetries) => {
          bus = createMockBus();
          let callCount = 0;

          const store: CacheStore = {
            get: async () => { callCount++; throw new Error('Fail'); },
            set: async () => {},
          };

          const agent = new CacheAgent(bus, store);
          await agent.initialize(createProfile(86_400_000, maxRetries, 0));
          await agent.onActivate();

          const request = createCheckCacheRequest(walletAddress, signalHash);
          await agent.handleMessage(request);

          // 1 initial attempt + maxRetries retries
          expect(callCount).toBe(1 + maxRetries);
        }
      ),
      { numRuns: 100 }
    );
  });
});
