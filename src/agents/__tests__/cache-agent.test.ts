import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { CacheAgent } from '../cache-agent.js';
import type { CacheStore, CacheEntry } from '../cache-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage, ResponseMessage, ErrorMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

function createMockBus(): MessageBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ id: 'sub-1', topic: '', agentId: '' }),
    unsubscribe: vi.fn(),
    request: vi.fn().mockResolvedValue({} as any),
    setAgentStateProvider: vi.fn(),
    onAgentActivated: vi.fn().mockResolvedValue(undefined),
    getBufferedMessages: vi.fn().mockReturnValue([]),
  };
}

function createMockStore(entry: CacheEntry | null = null): CacheStore {
  return {
    get: vi.fn().mockResolvedValue(entry),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

function createCheckCacheRequest(overrides: Partial<Record<string, unknown>> = {}): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'cache-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'cache.check-cache',
    payload: {
      walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
      signalHash: 'abc123def456',
      ...overrides,
    },
  };
}

function createStoreResultRequest(overrides: Partial<Record<string, unknown>> = {}): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'cache-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'cache.store-result',
    payload: {
      walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
      signalHash: 'abc123def456',
      creditGrade: 'A',
      reasoning: [{ signal: 'wallet_age', direction: 'positive', weight: 0.3 }],
      timestamp: Date.now(),
      ...overrides,
    },
  };
}

function defaultProfile(): BehaviorProfile {
  return {
    agentId: 'cache-agent',
    version: 1,
    parameters: {
      ttlMs: 86_400_000,
      connectionPoolSize: 5,
      maxRetries: 2,
      retryDelayMs: 0, // Zero delay for fast tests
    },
    lastModified: Date.now(),
  };
}

describe('CacheAgent', () => {
  let bus: MessageBus;
  let store: CacheStore;
  let agent: CacheAgent;

  beforeEach(async () => {
    bus = createMockBus();
    store = createMockStore();
    agent = new CacheAgent(bus, store);
    await agent.initialize(defaultProfile());
    await agent.onActivate();
  });

  describe('Agent interface conformance', () => {
    it('has correct id and name', () => {
      expect(agent.id).toBe('cache-agent');
      expect(agent.name).toBe('Cache Agent');
    });

    it('returns capabilities for check-cache and store-result topics', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(2);
      expect(caps.map((c) => c.topic)).toContain('cache.check-cache');
      expect(caps.map((c) => c.topic)).toContain('cache.store-result');
    });

    it('reports health status', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('active');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
    });

    it('transitions through lifecycle states', async () => {
      expect(agent.getHealth().state).toBe('active');
      await agent.onDeactivate();
      expect(agent.getHealth().state).toBe('idle');
      await agent.onActivate();
      expect(agent.getHealth().state).toBe('active');
    });
  });

  describe('check-cache handler', () => {
    it('returns cache hit when valid entry exists within TTL', async () => {
      const cachedEntry: CacheEntry = {
        walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
        signalHash: 'abc123def456',
        creditGrade: 'A',
        reasoning: [{ signal: 'wallet_age', direction: 'positive', weight: 0.3 }],
        computedAt: Date.now() - 1000, // 1 second ago (within 24h TTL)
      };
      store = createMockStore(cachedEntry);
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      const payload = (response as ResponseMessage).payload;
      expect(payload.hit).toBe(true);
      expect(payload.grade).toBe('A');
      expect(payload.reasoning).toEqual(cachedEntry.reasoning);
    });

    it('returns cache miss when no entry exists', async () => {
      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      const payload = (response as ResponseMessage).payload;
      expect(payload.hit).toBe(false);
      expect(payload.walletAddress).toBe('addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3');
      expect(payload.signalHash).toBe('abc123def456');
    });

    it('returns cache miss when entry exists but TTL expired', async () => {
      const expiredEntry: CacheEntry = {
        walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
        signalHash: 'abc123def456',
        creditGrade: 'BBB',
        reasoning: [{ signal: 'tx_freq', direction: 'negative', weight: 0.2 }],
        computedAt: Date.now() - 86_400_001, // Just past 24h TTL
      };
      store = createMockStore(expiredEntry);
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      const payload = (response as ResponseMessage).payload;
      expect(payload.hit).toBe(false);
      expect(payload.walletAddress).toBe('addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3');
      expect(payload.signalHash).toBe('abc123def456');
    });

    it('rejects request with missing walletAddress', async () => {
      const request = createCheckCacheRequest({ walletAddress: undefined });
      // Need to remove the key entirely
      delete (request.payload as Record<string, unknown>).walletAddress;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.code).toBe('validation-error');
    });

    it('rejects request with missing signalHash', async () => {
      const request = createCheckCacheRequest({ signalHash: undefined });
      delete (request.payload as Record<string, unknown>).signalHash;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.code).toBe('validation-error');
    });

    it('queries store with correct wallet and hash', async () => {
      const request = createCheckCacheRequest();
      await agent.handleMessage(request);

      expect(store.get).toHaveBeenCalledWith(
        'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
        'abc123def456'
      );
    });
  });

  describe('store-result handler', () => {
    it('stores a valid entry and returns stored: true', async () => {
      const request = createStoreResultRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.stored).toBe(true);
      expect(store.set).toHaveBeenCalled();
    });

    it('overwrites entries for the same wallet (calls store.set)', async () => {
      const request = createStoreResultRequest();
      await agent.handleMessage(request);
      await agent.handleMessage(request);

      expect(store.set).toHaveBeenCalledTimes(2);
    });

    it('rejects request with missing walletAddress', async () => {
      const request = createStoreResultRequest();
      delete (request.payload as Record<string, unknown>).walletAddress;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.description).toContain('walletAddress');
    });

    it('rejects request with missing signalHash', async () => {
      const request = createStoreResultRequest();
      delete (request.payload as Record<string, unknown>).signalHash;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.description).toContain('signalHash');
    });

    it('rejects request with missing creditGrade', async () => {
      const request = createStoreResultRequest();
      delete (request.payload as Record<string, unknown>).creditGrade;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.description).toContain('creditGrade');
    });

    it('rejects request with missing reasoning', async () => {
      const request = createStoreResultRequest();
      delete (request.payload as Record<string, unknown>).reasoning;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.description).toContain('reasoning');
    });

    it('rejects request with missing timestamp', async () => {
      const request = createStoreResultRequest();
      delete (request.payload as Record<string, unknown>).timestamp;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.description).toContain('timestamp');
    });

    it('rejects request with multiple missing fields', async () => {
      const request = createStoreResultRequest();
      delete (request.payload as Record<string, unknown>).walletAddress;
      delete (request.payload as Record<string, unknown>).creditGrade;
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      const desc = (response as ErrorMessage).payload.description;
      expect(desc).toContain('walletAddress');
      expect(desc).toContain('creditGrade');
    });

    it('rejects invalid creditGrade value', async () => {
      const request = createStoreResultRequest({ creditGrade: 'D' });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.description).toContain('Invalid creditGrade');
    });

    it.each(['AAA', 'AA', 'A', 'BBB', 'BB', 'C'])('accepts valid grade %s', async (grade) => {
      const request = createStoreResultRequest({ creditGrade: grade });
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.stored).toBe(true);
    });
  });

  describe('Retry logic and graceful degradation', () => {
    it('retries on cache read failure and succeeds on second attempt', async () => {
      const entry: CacheEntry = {
        walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
        signalHash: 'abc123def456',
        creditGrade: 'AA',
        reasoning: [],
        computedAt: Date.now() - 1000,
      };
      const mockGet = vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce(entry);

      store = { get: mockGet, set: vi.fn().mockResolvedValue(undefined) };
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.hit).toBe(true);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('returns cache-unavailable after all retries exhausted on read', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused'));

      store = { get: mockGet, set: vi.fn().mockResolvedValue(undefined) };
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.cacheAvailable).toBe(false);
      // 1 initial + 2 retries = 3 calls
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it('returns cache-unavailable after all retries exhausted on write', async () => {
      const mockSet = vi.fn().mockRejectedValue(new Error('Write failed'));

      store = { get: vi.fn().mockResolvedValue(null), set: mockSet };
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createStoreResultRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.cacheAvailable).toBe(false);
      // 1 initial + 2 retries = 3 calls
      expect(mockSet).toHaveBeenCalledTimes(3);
    });

    it('does NOT return an error type on persistent cache failures (graceful degradation)', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused'));
      store = { get: mockGet, set: vi.fn().mockResolvedValue(undefined) };
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      // Must be 'response', NOT 'error' — graceful degradation
      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.cacheAvailable).toBe(false);
    });

    it('publishes cache.failure event on persistent read failure', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused'));
      store = { get: mockGet, set: vi.fn().mockResolvedValue(undefined) };
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createCheckCacheRequest();
      await agent.handleMessage(request);

      const publishCalls = (bus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const failureEvent = publishCalls.find(
        (call: unknown[]) => (call[0] as any).topic === 'cache.failure'
      );

      expect(failureEvent).toBeDefined();
      const event = failureEvent![0] as any;
      expect(event.type).toBe('event');
      expect(event.payload.operation).toBe('read');
      expect(event.payload.timestamp).toBeTypeOf('number');
    });

    it('publishes cache.failure event on persistent write failure', async () => {
      const mockSet = vi.fn().mockRejectedValue(new Error('Write failed'));
      store = { get: vi.fn().mockResolvedValue(null), set: mockSet };
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      const request = createStoreResultRequest();
      await agent.handleMessage(request);

      const publishCalls = (bus.publish as ReturnType<typeof vi.fn>).mock.calls;
      const failureEvent = publishCalls.find(
        (call: unknown[]) => (call[0] as any).topic === 'cache.failure'
      );

      expect(failureEvent).toBeDefined();
      const event = failureEvent![0] as any;
      expect(event.payload.operation).toBe('write');
    });
  });

  describe('Behavior Profile configuration', () => {
    it('reads TTL from profile and uses it for cache hit determination', async () => {
      const shortTtlProfile: BehaviorProfile = {
        agentId: 'cache-agent',
        version: 2,
        parameters: {
          ttlMs: 5000, // 5 seconds
          connectionPoolSize: 5,
          maxRetries: 2,
          retryDelayMs: 0,
        },
        lastModified: Date.now(),
      };

      const entry: CacheEntry = {
        walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
        signalHash: 'abc123def456',
        creditGrade: 'BBB',
        reasoning: [],
        computedAt: Date.now() - 6000, // 6 seconds ago, exceeds 5s TTL
      };
      store = createMockStore(entry);
      agent = new CacheAgent(bus, store);
      await agent.initialize(shortTtlProfile);
      await agent.onActivate();

      const request = createCheckCacheRequest();
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('response');
      expect((response as ResponseMessage).payload.hit).toBe(false);
    });

    it('applies connectionPoolSize from profile (clamped to 1-20)', async () => {
      const profile: BehaviorProfile = {
        agentId: 'cache-agent',
        version: 1,
        parameters: {
          ttlMs: 86_400_000,
          connectionPoolSize: 10,
          maxRetries: 2,
          retryDelayMs: 0,
        },
        lastModified: Date.now(),
      };

      agent = new CacheAgent(bus, store);
      await agent.initialize(profile);

      expect(agent.connectionPoolSize).toBe(10);
    });

    it('ignores connectionPoolSize outside valid range (1-20)', async () => {
      const profile: BehaviorProfile = {
        agentId: 'cache-agent',
        version: 1,
        parameters: {
          ttlMs: 86_400_000,
          connectionPoolSize: 25,
          maxRetries: 2,
          retryDelayMs: 0,
        },
        lastModified: Date.now(),
      };

      agent = new CacheAgent(bus, store);
      await agent.initialize(profile);

      // Should remain at default (5)
      expect(agent.connectionPoolSize).toBe(5);
    });

    it('applies maxRetries from profile', async () => {
      const zeroRetriesProfile: BehaviorProfile = {
        agentId: 'cache-agent',
        version: 1,
        parameters: {
          ttlMs: 86_400_000,
          connectionPoolSize: 5,
          maxRetries: 0,
          retryDelayMs: 0,
        },
        lastModified: Date.now(),
      };

      const mockGet = vi.fn().mockRejectedValue(new Error('Fail'));
      store = { get: mockGet, set: vi.fn().mockResolvedValue(undefined) };
      agent = new CacheAgent(bus, store);
      await agent.initialize(zeroRetriesProfile);
      await agent.onActivate();

      const request = createCheckCacheRequest();
      await agent.handleMessage(request);

      // 0 retries means only 1 attempt
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('applies config update at runtime via onConfigUpdate', async () => {
      const entry: CacheEntry = {
        walletAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3',
        signalHash: 'abc123def456',
        creditGrade: 'AA',
        reasoning: [],
        computedAt: Date.now() - 2000, // 2 seconds ago
      };
      store = createMockStore(entry);
      agent = new CacheAgent(bus, store);
      await agent.initialize(defaultProfile());
      await agent.onActivate();

      // Initially entry is within 24h TTL → hit
      let request = createCheckCacheRequest();
      let response = await agent.handleMessage(request);
      expect((response as ResponseMessage).payload.hit).toBe(true);

      // Update TTL to 1 second → same entry now expired
      await agent.onConfigUpdate({
        agentId: 'cache-agent',
        version: 2,
        parameters: {
          ttlMs: 1000,
          connectionPoolSize: 5,
          maxRetries: 2,
          retryDelayMs: 0,
        },
        lastModified: Date.now(),
      });

      request = createCheckCacheRequest();
      response = await agent.handleMessage(request);
      expect((response as ResponseMessage).payload.hit).toBe(false);
    });
  });

  describe('Unsupported topics', () => {
    it('returns error for unsupported topic', async () => {
      const request: RequestMessage = {
        id: uuidv4(),
        sourceAgentId: 'test-caller',
        targetAgentId: 'cache-agent',
        type: 'request',
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'cache.unknown',
        payload: {},
      };
      const response = await agent.handleMessage(request);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.code).toBe('unsupported-topic');
    });

    it('returns error for non-request message types', async () => {
      const eventMessage = {
        id: uuidv4(),
        sourceAgentId: 'test-caller',
        targetAgentId: 'cache-agent',
        type: 'event' as const,
        correlationId: uuidv4(),
        timestamp: Date.now(),
        topic: 'cache.check-cache',
        payload: {},
      };
      const response = await agent.handleMessage(eventMessage);

      expect(response.type).toBe('error');
      expect((response as ErrorMessage).payload.code).toBe('unsupported-type');
    });
  });

  describe('Health metrics tracking', () => {
    it('increments request count on each call', async () => {
      const request = createCheckCacheRequest();
      await agent.handleMessage(request);
      await agent.handleMessage(request);

      expect(agent.getHealth().requestCount).toBe(2);
    });

    it('increments error count on validation failures', async () => {
      const badRequest = createCheckCacheRequest();
      delete (badRequest.payload as Record<string, unknown>).walletAddress;
      await agent.handleMessage(badRequest);

      expect(agent.getHealth().errorCount).toBe(1);
    });

    it('computes average response time', async () => {
      const request = createCheckCacheRequest();
      await agent.handleMessage(request);

      const health = agent.getHealth();
      expect(health.avgResponseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
