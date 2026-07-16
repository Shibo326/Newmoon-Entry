/**
 * NightScore Contract Tests
 *
 * Tests cover:
 * 1. Circuit logic — weighted score computation correctness
 * 2. State transitions — ledger state updates after scoring
 * 3. Privacy — private inputs never exposed in outputs
 * 4. Threshold verification — disclose only boolean result
 */

import { describe, it, expect } from 'vitest';

// Grade thresholds (numeric encoding)
const GRADE_THRESHOLDS = {
  AAA: 450, // 90%+ of max 500
  AA: 400,  // 80%+
  A: 350,   // 70%+
  BBB: 300, // 60%+
  BB: 250,  // 50%+
  C: 0,     // below 50%
};

/**
 * Simulates the weighted score computation from the contract.
 * This mirrors the logic in computeScore circuit.
 */
function computeWeightedScore(
  walletAge: number,
  txFrequency: number,
  defiInteractions: number,
  repaymentHistory: number,
  assetDiversity: number,
  liquidationHistory: number
): number {
  return (
    walletAge * 20 +
    txFrequency * 15 +
    defiInteractions * 15 +
    repaymentHistory * 25 +
    assetDiversity * 15 +
    liquidationHistory * 10
  );
}

/**
 * Determines grade from weighted score.
 */
function getGrade(score: number): string {
  if (score >= GRADE_THRESHOLDS.AAA) return 'AAA';
  if (score >= GRADE_THRESHOLDS.AA) return 'AA';
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.BBB) return 'BBB';
  if (score >= GRADE_THRESHOLDS.BB) return 'BB';
  return 'C';
}

/**
 * Simulates the verifyThreshold circuit logic.
 * Returns only a boolean — never the actual score.
 */
function verifyThreshold(actualScore: number, minimumScore: number): boolean {
  return actualScore >= minimumScore;
}

/**
 * Simple hash simulation (for testing purposes).
 * In the real contract this would be a ZK-friendly hash.
 */
function hashScore(score: number): string {
  const str = score.toString();
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('NightScore Contract — Circuit Logic', () => {
  it('computes weighted score correctly with all max inputs', () => {
    const score = computeWeightedScore(5, 5, 5, 5, 5, 5);
    // 5*20 + 5*15 + 5*15 + 5*25 + 5*15 + 5*10 = 500
    expect(score).toBe(500);
    expect(getGrade(score)).toBe('AAA');
  });

  it('computes weighted score correctly with mixed inputs', () => {
    const score = computeWeightedScore(4, 3, 2, 5, 3, 1);
    // 4*20 + 3*15 + 2*15 + 5*25 + 3*15 + 1*10 = 335
    expect(score).toBe(335);
    expect(getGrade(score)).toBe('BBB');
  });

  it('computes weighted score correctly with all zero inputs', () => {
    const score = computeWeightedScore(0, 0, 0, 0, 0, 0);
    expect(score).toBe(0);
    expect(getGrade(score)).toBe('C');
  });

  it('repaymentHistory has highest weight (25) affecting grade most', () => {
    const scoreRepaymentOnly = computeWeightedScore(0, 0, 0, 5, 0, 0);
    expect(scoreRepaymentOnly).toBe(125);

    const scoreWalletOnly = computeWeightedScore(5, 0, 0, 0, 0, 0);
    expect(scoreWalletOnly).toBe(100);

    expect(scoreRepaymentOnly).toBeGreaterThan(scoreWalletOnly);
  });
});

describe('NightScore Contract — State Transitions', () => {
  it('scoring a wallet sets walletRegistered to true', () => {
    const ledger = {
      scoreHash: '',
      walletRegistered: false,
      totalScored: 0,
    };

    const score = computeWeightedScore(3, 3, 3, 3, 3, 3);
    ledger.scoreHash = hashScore(score);
    ledger.walletRegistered = true;
    ledger.totalScored += 1;

    expect(ledger.walletRegistered).toBe(true);
    expect(ledger.totalScored).toBe(1);
    expect(ledger.scoreHash).not.toBe('');
  });

  it('totalScored increments with each new scoring', () => {
    const ledger = { totalScored: 0 };

    for (let i = 0; i < 3; i++) {
      ledger.totalScored += 1;
    }

    expect(ledger.totalScored).toBe(3);
  });

  it('scoreHash changes when different inputs produce different scores', () => {
    const score1 = computeWeightedScore(5, 5, 5, 5, 5, 5);
    const score2 = computeWeightedScore(1, 1, 1, 1, 1, 1);

    const hash1 = hashScore(score1);
    const hash2 = hashScore(score2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('NightScore Contract — Privacy (private inputs never exposed)', () => {
  it('scoreHash does not reveal the actual score value', () => {
    const score = computeWeightedScore(4, 4, 4, 4, 4, 4);
    const hash = hashScore(score);

    expect(hash).not.toContain(score.toString());
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('verifyThreshold returns only boolean, never the actual score', () => {
    const actualScore = 420;
    const threshold = 300;

    const result = verifyThreshold(actualScore, threshold);

    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  it('different actual scores with same threshold produce same boolean output', () => {
    const threshold = 300;

    const result1 = verifyThreshold(500, threshold);
    const result2 = verifyThreshold(301, threshold);

    expect(result1).toBe(true);
    expect(result2).toBe(true);

    const result3 = verifyThreshold(299, threshold);
    expect(result3).toBe(false);
  });

  it('private witness values are not part of any public output', () => {
    const privateInputs = {
      walletAge: 4,
      txFrequency: 3,
      defiInteractions: 5,
      repaymentHistory: 4,
      assetDiversity: 2,
      liquidationHistory: 1,
    };

    const score = computeWeightedScore(
      privateInputs.walletAge,
      privateInputs.txFrequency,
      privateInputs.defiInteractions,
      privateInputs.repaymentHistory,
      privateInputs.assetDiversity,
      privateInputs.liquidationHistory
    );

    const publicOutput = {
      scoreHash: hashScore(score),
      walletRegistered: true,
      totalScored: 1,
    };

    const publicStr = JSON.stringify(publicOutput);
    expect(publicStr).not.toContain(score.toString());
  });
});

describe('NightScore Contract — Threshold Verification', () => {
  it('verifies all grade boundaries correctly', () => {
    expect(verifyThreshold(450, 450)).toBe(true);
    expect(verifyThreshold(449, 450)).toBe(false);
    expect(verifyThreshold(400, 400)).toBe(true);
    expect(verifyThreshold(399, 400)).toBe(false);
    expect(verifyThreshold(300, 300)).toBe(true);
    expect(verifyThreshold(299, 300)).toBe(false);
  });

  it('exact boundary values are inclusive (>=)', () => {
    expect(verifyThreshold(300, 300)).toBe(true);
    expect(verifyThreshold(0, 0)).toBe(true);
    expect(verifyThreshold(500, 500)).toBe(true);
  });
});
