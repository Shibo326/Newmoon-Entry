/**
 * Mock Midnight Provider
 *
 * Replace with real @midnight-ntwrk/midnight-js-network-provider
 * and @midnight-ntwrk/dapp-connector-api packages when available.
 *
 * This mock simulates:
 * - Wallet connection (with a deterministic demo address)
 * - Wallet disconnection
 * - Connection state persistence in sessionStorage
 * - Circuit call simulation with realistic delay
 */

const STORAGE_KEY = 'nightscore_wallet_state';
const DEMO_ADDRESS = 'midnight1q9f3e7a2c4b8d6e5f1a0b3c7d9e2f4a6b8c0d1e3f5a7b9c2d4e6f8a0b1c3';

export interface WalletState {
  address: string;
  isConnected: boolean;
  connectedAt: number;
}

export interface CircuitResult {
  score: number;
  txHash: string;
  proofHash: string;
  timestamp: number;
}

/**
 * Simulates Lace wallet detection.
 * In production, check window.midnight?.mnLace
 */
export function isWalletInstalled(): boolean {
  // In demo mode, always return true
  return true;
}

/**
 * Simulates connecting to the Lace wallet via DApp Connector API.
 * Returns a wallet address on success.
 */
export async function connectWallet(): Promise<WalletState> {
  // Simulate connection handshake delay
  await delay(1200);

  // Simulate random rejection (5% chance for demo realism)
  if (Math.random() < 0.05) {
    throw new Error('USER_REJECTED');
  }

  const state: WalletState = {
    address: DEMO_ADDRESS,
    isConnected: true,
    connectedAt: Date.now(),
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

/**
 * Disconnects the wallet and clears session state.
 */
export function disconnectWallet(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Restores wallet state from sessionStorage.
 */
export function getStoredWalletState(): WalletState | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const state: WalletState = JSON.parse(raw);
    // Session expires after 30 minutes
    if (Date.now() - state.connectedAt > 30 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * Simulates calling the computeScore circuit.
 * In production, this would submit a ZK proof to the Midnight proof server
 * and broadcast the transaction.
 *
 * The private inputs are used to compute a weighted score locally (demo only).
 * In production, computation happens inside the ZK circuit — inputs never leave the device.
 */
export async function callComputeScore(inputs: {
  walletAge: number;
  txFrequency: number;
  defiInteractions: number;
  repaymentHistory: number;
  assetDiversity: number;
  liquidationHistory: number;
}): Promise<CircuitResult> {
  // Simulate ZK proof generation (3 seconds)
  await delay(3000);

  // Compute weighted score matching the Compact contract weights
  const score =
    inputs.walletAge * 20 +
    inputs.txFrequency * 15 +
    inputs.defiInteractions * 15 +
    inputs.repaymentHistory * 25 +
    inputs.assetDiversity * 15 +
    inputs.liquidationHistory * 10;

  // Generate deterministic-looking hashes for demo
  const txHash = generateHash('tx');
  const proofHash = generateHash('proof');

  return {
    score,
    txHash,
    proofHash,
    timestamp: Date.now(),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateHash(prefix: string): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${hash}`;
}
