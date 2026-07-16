import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { WalletAgent } from '../wallet-agent.js';
import type { WalletConnector, SessionStorage } from '../wallet-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { BusMessage, RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

// --- Test Helpers ---

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

function createMockConnector(overrides?: Partial<WalletConnector>): WalletConnector {
  return {
    connect: vi.fn().mockResolvedValue({ address: 'addr_test1qz...' }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(false),
    getAddress: vi.fn().mockReturnValue(null),
    onDisconnect: vi.fn(),
    ...overrides,
  };
}

function createMockStorage(initial?: Record<string, string>): SessionStorage {
  const store: Record<string, string> = { ...initial };
  return {
    get: vi.fn((key: string) => store[key] ?? null),
    set: vi.fn((key: string, value: string) => { store[key] = value; }),
    remove: vi.fn((key: string) => { delete store[key]; }),
  };
}

function createRequestMessage(topic: string, payload: Record<string, unknown> = {}): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'wallet-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic,
    payload,
  };
}

const defaultProfile: BehaviorProfile = {
  agentId: 'wallet-agent',
  version: 1,
  parameters: { connectionTimeoutMs: 30000, sessionStorageKey: 'ns_wallet_session' },
  lastModified: Date.now(),
};

// --- Tests ---

describe('WalletAgent', () => {
  let bus: MessageBus;
  let connector: WalletConnector;
  let storage: SessionStorage;
  let agent: WalletAgent;

  beforeEach(() => {
    bus = createMockBus();
    connector = createMockConnector();
    storage = createMockStorage();
    agent = new WalletAgent(bus, connector, storage);
  });

  describe('identity and interface', () => {
    it('has correct id and name', () => {
      expect(agent.id).toBe('wallet-agent');
      expect(agent.name).toBe('Wallet Agent');
    });

    it('returns wallet-related capabilities', () => {
      const caps = agent.getCapabilities();
      expect(caps).toHaveLength(3);
      expect(caps.map(c => c.topic)).toContain('wallet.connect');
      expect(caps.map(c => c.topic)).toContain('wallet.validate-session');
      expect(caps.map(c => c.topic)).toContain('wallet.disconnect');
    });

    it('returns initial health as idle with zero counts', () => {
      const health = agent.getHealth();
      expect(health.state).toBe('idle');
      expect(health.requestCount).toBe(0);
      expect(health.errorCount).toBe(0);
      expect(health.uptimeSeconds).toBe(0);
      expect(health.avgResponseTimeMs).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('onActivate sets state to active', async () => {
      await agent.onActivate();
      expect(agent.getHealth().state).toBe('active');
    });

    it('onDeactivate sets state to idle', async () => {
      await agent.onActivate();
      await agent.onDeactivate();
      expect(agent.getHealth().state).toBe('idle');
    });

    it('initialize registers onDisconnect callback', async () => {
      await agent.initialize(defaultProfile);
      expect(connector.onDisconnect).toHaveBeenCalledWith(expect.any(Function));
    });

    it('onConfigUpdate updates connectionTimeoutMs', async () => {
      await agent.initialize(defaultProfile);
      await agent.onConfigUpdate({
        ...defaultProfile,
        parameters: { connectionTimeoutMs: 5000 },
      });
      // We verify by connecting with the new timeout
      const msg = createRequestMessage('wallet.connect');
      await agent.handleMessage(msg);
      expect(connector.connect).toHaveBeenCalledWith(5000);
    });
  });

  describe('connect handler', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('successful connect returns address and emits wallet.connected event', async () => {
      const msg = createRequestMessage('wallet.connect');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
      expect(result.payload).toEqual({ address: 'addr_test1qz...', connected: true });

      // Check event was published
      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          topic: 'wallet.connected',
          payload: { address: 'addr_test1qz...' },
        })
      );
    });

    it('successful connect stores address in session storage', async () => {
      const msg = createRequestMessage('wallet.connect');
      await agent.handleMessage(msg);

      expect(storage.set).toHaveBeenCalledWith(
        'ns_wallet_session',
        expect.stringContaining('addr_test1qz...')
      );
    });

    it('connect calls connector.connect with configured timeout', async () => {
      const msg = createRequestMessage('wallet.connect');
      await agent.handleMessage(msg);

      expect(connector.connect).toHaveBeenCalledWith(30000);
    });

    it('failed connect emits wallet.connection_failed event', async () => {
      (connector.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Timeout'));

      const msg = createRequestMessage('wallet.connect');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(
        expect.objectContaining({ code: 'CONNECTION_FAILED', description: 'Timeout' })
      );

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          topic: 'wallet.connection_failed',
          payload: { reason: 'Timeout' },
        })
      );
    });

    it('failed connect transitions state to idle', async () => {
      await agent.onActivate();
      (connector.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Refused'));

      const msg = createRequestMessage('wallet.connect');
      await agent.handleMessage(msg);

      expect(agent.getHealth().state).toBe('idle');
    });
  });

  describe('validate-session handler', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('returns address when connector is connected', async () => {
      (connector.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (connector.getAddress as ReturnType<typeof vi.fn>).mockReturnValue('addr_test1qz...');

      const msg = createRequestMessage('wallet.validate-session');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
      expect(result.payload).toEqual({ address: 'addr_test1qz...', valid: true });
    });

    it('returns SESSION_EXPIRED when session storage exists but connector is disconnected', async () => {
      (connector.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (storage.get as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ address: 'addr_test1qz...', connectedAt: Date.now() - 60000 })
      );

      const msg = createRequestMessage('wallet.validate-session');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(
        expect.objectContaining({ code: 'SESSION_EXPIRED' })
      );
    });

    it('returns DISCONNECTED when no session and not connected', async () => {
      (connector.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (storage.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const msg = createRequestMessage('wallet.validate-session');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(
        expect.objectContaining({ code: 'DISCONNECTED' })
      );
    });
  });

  describe('disconnect handler', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('clears session storage, calls disconnect, emits event', async () => {
      const msg = createRequestMessage('wallet.disconnect');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('response');
      expect(result.payload).toEqual({ disconnected: true });

      expect(storage.remove).toHaveBeenCalledWith('ns_wallet_session');
      expect(connector.disconnect).toHaveBeenCalled();

      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          topic: 'wallet.disconnected',
          payload: {},
        })
      );
    });
  });

  describe('unexpected disconnect', () => {
    it('emits wallet.disconnected and transitions to idle on unexpected disconnect', async () => {
      let disconnectCallback: (() => void) | undefined;
      (connector.onDisconnect as ReturnType<typeof vi.fn>).mockImplementation((cb: () => void) => {
        disconnectCallback = cb;
      });

      await agent.initialize(defaultProfile);
      await agent.onActivate();

      expect(disconnectCallback).toBeDefined();

      // Simulate unexpected disconnect
      await disconnectCallback!();

      expect(agent.getHealth().state).toBe('idle');
      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          topic: 'wallet.disconnected',
          payload: { unexpected: true },
        })
      );
    });

    it('clears session storage on unexpected disconnect', async () => {
      let disconnectCallback: (() => void) | undefined;
      (connector.onDisconnect as ReturnType<typeof vi.fn>).mockImplementation((cb: () => void) => {
        disconnectCallback = cb;
      });

      await agent.initialize(defaultProfile);

      await disconnectCallback!();

      expect(storage.remove).toHaveBeenCalledWith('ns_wallet_session');
    });
  });

  describe('auto-reconnect on initialize', () => {
    it('attempts reconnect when session storage has data', async () => {
      (storage.get as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ address: 'addr_test1qz...', connectedAt: Date.now() })
      );

      await agent.initialize(defaultProfile);

      expect(connector.connect).toHaveBeenCalledWith(30000);
    });

    it('does not attempt reconnect when session storage is empty', async () => {
      (storage.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await agent.initialize(defaultProfile);

      expect(connector.connect).not.toHaveBeenCalled();
    });

    it('clears session storage if auto-reconnect fails', async () => {
      (storage.get as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ address: 'addr_test1qz...', connectedAt: Date.now() })
      );
      (connector.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Extension not found'));

      await agent.initialize(defaultProfile);

      expect(storage.remove).toHaveBeenCalledWith('ns_wallet_session');
    });

    it('updates session storage on successful auto-reconnect', async () => {
      (storage.get as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify({ address: 'addr_test1qz...', connectedAt: Date.now() - 60000 })
      );

      await agent.initialize(defaultProfile);

      expect(storage.set).toHaveBeenCalledWith(
        'ns_wallet_session',
        expect.stringContaining('addr_test1qz...')
      );
    });
  });

  describe('unknown topic handling', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('returns error for unknown topic', async () => {
      const msg = createRequestMessage('wallet.unknown');
      const result = await agent.handleMessage(msg);

      expect(result.type).toBe('error');
      expect(result.payload).toEqual(
        expect.objectContaining({ code: 'UNKNOWN_TOPIC' })
      );
    });
  });

  describe('health metrics tracking', () => {
    beforeEach(async () => {
      await agent.initialize(defaultProfile);
    });

    it('increments requestCount on each message', async () => {
      const msg = createRequestMessage('wallet.validate-session');
      await agent.handleMessage(msg);
      await agent.handleMessage(msg);

      expect(agent.getHealth().requestCount).toBe(2);
    });

    it('increments errorCount on error responses', async () => {
      (connector.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const msg = createRequestMessage('wallet.connect');
      await agent.handleMessage(msg);

      expect(agent.getHealth().errorCount).toBe(1);
    });

    it('tracks uptime after activation', async () => {
      const before = Date.now();
      await agent.onActivate();
      // Small delay to have non-zero uptime
      const health = agent.getHealth();
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('custom session storage key', () => {
    it('uses custom key when provided', async () => {
      const customAgent = new WalletAgent(bus, connector, storage, 'custom_key');
      await customAgent.initialize(defaultProfile);

      const msg = createRequestMessage('wallet.connect');
      await customAgent.handleMessage(msg);

      expect(storage.set).toHaveBeenCalledWith('custom_key', expect.any(String));
    });
  });
});
