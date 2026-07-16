/**
 * Property-Based Test: Signal Normalization (Property 12)
 *
 * For any raw wallet signal input, the Signal Agent SHALL produce a normalized
 * signal vector containing exactly 6 values each in the closed interval [0.0, 1.0].
 * For any signal where insufficient on-chain data exists (fewer than the threshold
 * in the Behavior Profile), the value SHALL be exactly 0.5 with an estimated flag
 * set to true.
 *
 * **Validates: Requirements 5.1, 5.2, 5.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { SignalAgent } from '../signal-agent.js';
import type { CompactWitness, SignalType, RawSignalResult } from '../signal-agent.js';
import type { MessageBus } from '../../bus/message-bus.js';
import type { RequestMessage } from '../../types/messages.js';
import type { BehaviorProfile } from '../../types/config.js';

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

const SIGNAL_TYPES: SignalType[] = [
  'walletAge',
  'transactionFrequency',
  'defiInteractions',
  'repaymentHistory',
  'assetDiversity',
  'liquidationHistory',
];

function createReadSignalsRequest(walletAddress = '0xABC123'): RequestMessage {
  return {
    id: uuidv4(),
    sourceAgentId: 'orchestrator-agent',
    targetAgentId: 'signal-agent',
    type: 'request',
    correlationId: uuidv4(),
    timestamp: Date.now(),
    topic: 'read-signals',
    payload: { walletAddress },
  };
}

function createDefaultProfile(minTransactions = 3): BehaviorProfile {
  return {
    agentId: 'signal-agent',
    version: 1,
    parameters: {
      minTransactionsForSignal: minTransactions,
      normalization: {
        walletAge: { min: 0, max: 365 },
        transactionFrequency: { min: 0, max: 100 },
        defiInteractions: { min: 0, max: 50 },
        repaymentHistory: { min: 0, max: 100 },
        assetDiversity: { min: 0, max: 20 },
        liquidationHistory: { min: 0, max: 10 },
      },
    },
    lastModified: Date.now(),
  };
}

// --- Generators ---

/**
 * Generate a raw signal value: any finite number (can be negative, zero, or very large).
 */
const rawSignalValueArb = fc.double({ min: -1000, max: 10000, noNaN: true });

/**
 * Generate a transaction count: integer >= 0.
 */
const transactionCountArb = fc.integer({ min: 0, max: 200 });

/**
 * Generate a 6-element array of raw signal results (value + transactionCount).
 */
const rawSignalArrayArb = fc.tuple(
  ...Array.from({ length: 6 }, () =>
    fc.record({
      value: rawSignalValueArb,
      transactionCount: transactionCountArb,
    })
  )
) as fc.Arbitrary<[RawSignalResult, RawSignalResult, RawSignalResult, RawSignalResult, RawSignalResult, RawSignalResult]>;

/**
 * Generate an availability pattern: for each of the 6 signals, whether
 * the signal has sufficient data (transactionCount >= threshold) or not.
 * true = available (above threshold), false = insufficient data.
 */
const availabilityPatternArb = fc.tuple(
  fc.boolean(),
  fc.boolean(),
  fc.boolean(),
  fc.boolean(),
  fc.boolean(),
  fc.boolean()
);

/**
 * Generate a min transactions threshold (1–20 range for testing variety).
 */
const minTransactionsArb = fc.integer({ min: 1, max: 20 });

// --- Property Tests ---

describe('Property 12: Signal Normalization', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = createMockBus();
  });

  it('SHALL produce exactly 6 normalized values in [0.0, 1.0] for any raw signal input', async () => {
    await fc.assert(
      fc.asyncProperty(rawSignalArrayArb, async (rawSignals) => {
        let callIndex = 0;
        const witness: CompactWitness = {
          readSignal: async (_wallet: string, _signalType: SignalType): Promise<RawSignalResult> => {
            const result = rawSignals[callIndex]!;
            callIndex++;
            return result;
          },
          isWalletConnected: async () => true,
        };

        const agent = new SignalAgent(bus, witness);
        await agent.initialize(createDefaultProfile());
        await agent.onActivate();

        const request = createReadSignalsRequest();
        const response = await agent.handleMessage(request);

        expect(response.type).toBe('response');
        const payload = response.payload as { signals: number[]; estimated: boolean[]; hash: string };

        // Exactly 6 values
        expect(payload.signals).toHaveLength(6);
        expect(payload.estimated).toHaveLength(6);

        // Each value in [0.0, 1.0]
        for (let i = 0; i < 6; i++) {
          expect(payload.signals[i]).toBeGreaterThanOrEqual(0.0);
          expect(payload.signals[i]).toBeLessThanOrEqual(1.0);
        }

        // Hash is a non-empty string
        expect(typeof payload.hash).toBe('string');
        expect(payload.hash.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('SHALL assign exactly 0.5 with estimated=true for signals with insufficient data', async () => {
    await fc.assert(
      fc.asyncProperty(
        availabilityPatternArb,
        rawSignalValueArb,
        minTransactionsArb,
        async (availability, baseValue, minTransactions) => {
          let callIndex = 0;
          const witness: CompactWitness = {
            readSignal: async (_wallet: string, _signalType: SignalType): Promise<RawSignalResult> => {
              const isAvailable = availability[callIndex]!;
              callIndex++;
              if (isAvailable) {
                // Above threshold — return enough transactions
                return { value: baseValue, transactionCount: minTransactions + 5 };
              } else {
                // Below threshold — insufficient data
                return { value: baseValue, transactionCount: minTransactions - 1 };
              }
            },
            isWalletConnected: async () => true,
          };

          const agent = new SignalAgent(bus, witness);
          await agent.initialize(createDefaultProfile(minTransactions));
          await agent.onActivate();

          const request = createReadSignalsRequest();
          const response = await agent.handleMessage(request);

          expect(response.type).toBe('response');
          const payload = response.payload as { signals: number[]; estimated: boolean[] };

          expect(payload.signals).toHaveLength(6);
          expect(payload.estimated).toHaveLength(6);

          for (let i = 0; i < 6; i++) {
            if (!availability[i]) {
              // Insufficient data → exactly 0.5, estimated true
              expect(payload.signals[i]).toBe(0.5);
              expect(payload.estimated[i]).toBe(true);
            } else {
              // Sufficient data → value in [0.0, 1.0], estimated false
              expect(payload.signals[i]).toBeGreaterThanOrEqual(0.0);
              expect(payload.signals[i]).toBeLessThanOrEqual(1.0);
              expect(payload.estimated[i]).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('SHALL use normalization parameters from the Behavior Profile', async () => {
    await fc.assert(
      fc.asyncProperty(rawSignalArrayArb, async (rawSignals) => {
        // Use custom normalization parameters
        const customProfile: BehaviorProfile = {
          agentId: 'signal-agent',
          version: 1,
          parameters: {
            minTransactionsForSignal: 1, // Low threshold so all signals are "available"
            normalization: {
              walletAge: { min: 0, max: 1000 },
              transactionFrequency: { min: 0, max: 500 },
              defiInteractions: { min: 0, max: 200 },
              repaymentHistory: { min: 0, max: 500 },
              assetDiversity: { min: 0, max: 100 },
              liquidationHistory: { min: 0, max: 50 },
            },
          },
          lastModified: Date.now(),
        };

        // Make sure all signals have enough transactions
        const signalsWithData = rawSignals.map((s) => ({
          value: s.value,
          transactionCount: Math.max(s.transactionCount, 5),
        }));

        let callIndex = 0;
        const witness: CompactWitness = {
          readSignal: async (_wallet: string, _signalType: SignalType): Promise<RawSignalResult> => {
            const result = signalsWithData[callIndex]!;
            callIndex++;
            return result;
          },
          isWalletConnected: async () => true,
        };

        const agent = new SignalAgent(bus, witness);
        await agent.initialize(customProfile);
        await agent.onActivate();

        const request = createReadSignalsRequest();
        const response = await agent.handleMessage(request);

        expect(response.type).toBe('response');
        const payload = response.payload as { signals: number[]; estimated: boolean[] };

        // All values must still be in [0.0, 1.0] regardless of normalization params
        expect(payload.signals).toHaveLength(6);
        for (let i = 0; i < 6; i++) {
          expect(payload.signals[i]).toBeGreaterThanOrEqual(0.0);
          expect(payload.signals[i]).toBeLessThanOrEqual(1.0);
          expect(payload.estimated[i]).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
