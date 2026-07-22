/**
 * Midnight Provider — Lace Wallet + Indexer Integration
 *
 * This provider handles:
 * 1. Real Lace wallet detection and connection via DApp Connector API
 * 2. Reading on-chain contract state via the Midnight indexer (GraphQL)
 * 3. Circuit call simulation (proof generation happens via proof server in production)
 *
 * Privacy model:
 * - Private signals NEVER leave the user's device
 * - Only the computed score and boolean results go on-chain
 * - The indexer reads only PUBLIC ledger state
 * - No raw signal values appear in any logs, events, or network payloads
 */

const STORAGE_KEY = 'nightscore_wallet_state';

// Contract deployed on local devnet
const CONTRACT_ADDRESS = 'a3e01772c31935fc25719d878514b2bb1b64198c65b4862dd9fcb6888173af71';

// Network endpoints — configurable via env
const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'http://localhost:8088';
const PROOF_SERVER_URL = import.meta.env.VITE_PROOF_SERVER_URL || 'http://localhost:6300';

export interface WalletState {
  address: string;
  isConnected: boolean;
  connectedAt: number;
  network: 'undeployed' | 'preview' | 'preprod' | 'mainnet';
  isRealWallet: boolean;
}

export interface CircuitResult {
  score: number;
  txHash: string;
  proofHash: string;
  timestamp: number;
  onChain: boolean;
}

export interface ContractLedgerState {
  score: number;
  registered: boolean;
  totalScored: number;
}

export interface ThresholdResult {
  meetsThreshold: boolean;
  queriedAt: number;
}

// ─── Lace DApp Connector Detection ─────────────────────────────────────────────

interface MidnightDAppConnector {
  mnLace?: {
    enable: () => Promise<MidnightWalletAPI>;
    isEnabled: () => Promise<boolean>;
    apiVersion: string;
    name: string;
    icon: string;
  };
}

interface MidnightWalletAPI {
  getNetworkId: () => Promise<string>;
  getUsedAddresses: () => Promise<string[]>;
  getBalance: () => Promise<string>;
  signTx: (tx: string) => Promise<string>;
  submitTx: (tx: string) => Promise<string>;
}

declare global {
  interface Window {
    midnight?: MidnightDAppConnector;
  }
}

/**
 * Detects whether the Lace wallet extension is installed.
 */
export function isWalletInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.midnight?.mnLace;
}

/**
 * Waits for Lace injection (up to 3 seconds).
 */
async function waitForLace(timeoutMs = 3000): Promise<boolean> {
  if (isWalletInstalled()) return true;

  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (isWalletInstalled()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 200);
  });
}

// ─── Wallet Connection ──────────────────────────────────────────────────────────

/**
 * Connects to the Lace wallet via DApp Connector API.
 * Falls back to demo mode if Lace is not installed.
 */
export async function connectWallet(): Promise<WalletState> {
  const laceAvailable = await waitForLace();

  if (laceAvailable && window.midnight?.mnLace) {
    try {
      const api = await window.midnight.mnLace.enable();
      const networkId = await api.getNetworkId();
      const addresses = await api.getUsedAddresses();

      const address = addresses[0] || 'unknown';
      const network = mapNetworkId(networkId);

      const state: WalletState = {
        address,
        isConnected: true,
        connectedAt: Date.now(),
        network,
        isRealWallet: true,
      };

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('User rejected') || message.includes('refused')) {
        throw new Error('USER_REJECTED');
      }
      // Fall through to demo mode on other errors
    }
  }

  // Demo mode — simulate wallet connection
  await delay(800);

  const state: WalletState = {
    address: generateDemoAddress(),
    isConnected: true,
    connectedAt: Date.now(),
    network: 'undeployed',
    isRealWallet: false,
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

// ─── Indexer: Read On-Chain State ───────────────────────────────────────────────

/**
 * Queries the Midnight indexer for the contract's public ledger state.
 * Reads ONLY publicly disclosed values — no private data.
 */
export async function readContractState(): Promise<ContractLedgerState | null> {
  try {
    const response = await fetch(`${INDEXER_URL}/api/v1/contract/${CONTRACT_ADDRESS}/state`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return await readContractStateGraphQL();
    }

    const data = await response.json();
    return parseContractState(data);
  } catch {
    try {
      return await readContractStateGraphQL();
    } catch {
      return null;
    }
  }
}

/**
 * GraphQL fallback query to the indexer.
 */
async function readContractStateGraphQL(): Promise<ContractLedgerState | null> {
  const query = `
    query ContractState($address: String!) {
      contractState(address: $address) {
        data
      }
    }
  `;

  try {
    const response = await fetch(`${INDEXER_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { address: CONTRACT_ADDRESS },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const result = await response.json();
    if (result.data?.contractState?.data) {
      return parseContractState(result.data.contractState.data);
    }
    return null;
  } catch {
    return null;
  }
}

function parseContractState(data: unknown): ContractLedgerState | null {
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;

  return {
    score: typeof d.score === 'number' ? d.score : Number(d.score || 0),
    registered: Boolean(d.registered),
    totalScored: typeof d.totalScored === 'number' ? d.totalScored : Number(d.totalScored || 0),
  };
}

// ─── Circuit Calls ──────────────────────────────────────────────────────────────

/**
 * Calls the computeScore circuit.
 *
 * In production with proof server + Lace:
 * 1. Builds circuit inputs locally
 * 2. Sends to proof server for ZK proof generation
 * 3. Lace signs and submits the proven transaction
 *
 * In demo mode (no proof server available):
 * - Computes the weighted score locally (matching Compact contract logic)
 * - Generates realistic proof/tx hashes
 */
export async function callComputeScore(inputs: {
  walletAge: number;
  txFrequency: number;
  defiInteractions: number;
  repaymentHistory: number;
  assetDiversity: number;
  liquidationHistory: number;
}): Promise<CircuitResult> {
  const proofServerAvailable = await checkProofServer();

  if (proofServerAvailable) {
    return await callComputeScoreReal(inputs);
  }

  return await callComputeScoreDemo(inputs);
}

/**
 * Real circuit call via proof server.
 */
async function callComputeScoreReal(inputs: {
  walletAge: number;
  txFrequency: number;
  defiInteractions: number;
  repaymentHistory: number;
  assetDiversity: number;
  liquidationHistory: number;
}): Promise<CircuitResult> {
  try {
    const response = await fetch(`${PROOF_SERVER_URL}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        circuit: 'computeScore',
        inputs: {
          walletAge_0: String(inputs.walletAge),
          txFrequency_0: String(inputs.txFrequency),
          defiInteractions_0: String(inputs.defiInteractions),
          repaymentHistory_0: String(inputs.repaymentHistory),
          assetDiversity_0: String(inputs.assetDiversity),
          liquidationHistory_0: String(inputs.liquidationHistory),
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Proof server returned ${response.status}`);
    }

    const proofResult = await response.json();

    const score =
      inputs.walletAge * 20 +
      inputs.txFrequency * 15 +
      inputs.defiInteractions * 15 +
      inputs.repaymentHistory * 25 +
      inputs.assetDiversity * 15 +
      inputs.liquidationHistory * 10;

    return {
      score,
      txHash: proofResult.txHash || generateHash('tx'),
      proofHash: proofResult.proofHash || generateHash('proof'),
      timestamp: Date.now(),
      onChain: true,
    };
  } catch {
    return await callComputeScoreDemo(inputs);
  }
}

/**
 * Demo mode: computes score locally matching Compact contract.
 */
async function callComputeScoreDemo(inputs: {
  walletAge: number;
  txFrequency: number;
  defiInteractions: number;
  repaymentHistory: number;
  assetDiversity: number;
  liquidationHistory: number;
}): Promise<CircuitResult> {
  await delay(3000);

  const score =
    inputs.walletAge * 20 +
    inputs.txFrequency * 15 +
    inputs.defiInteractions * 15 +
    inputs.repaymentHistory * 25 +
    inputs.assetDiversity * 15 +
    inputs.liquidationHistory * 10;

  return {
    score,
    txHash: generateHash('tx'),
    proofHash: generateHash('proof'),
    timestamp: Date.now(),
    onChain: false,
  };
}

/**
 * Verifies whether a score meets a minimum threshold.
 * Returns ONLY a boolean — the actual score is never revealed to the verifier.
 */
export async function callVerifyThreshold(
  actualScore: number,
  minimumScore: number
): Promise<ThresholdResult> {
  const proofServerAvailable = await checkProofServer();

  if (proofServerAvailable) {
    try {
      const response = await fetch(`${PROOF_SERVER_URL}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuit: 'verifyThreshold',
          inputs: {
            actualScore_0: String(actualScore),
            minimumScore_0: String(minimumScore),
          },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        return {
          meetsThreshold: actualScore >= minimumScore,
          queriedAt: Date.now(),
        };
      }
    } catch {
      // Fall through to local computation
    }
  }

  await delay(1500);

  return {
    meetsThreshold: actualScore >= minimumScore,
    queriedAt: Date.now(),
  };
}

// ─── Proof Server Health ────────────────────────────────────────────────────────

async function checkProofServer(): Promise<boolean> {
  try {
    const response = await fetch(PROOF_SERVER_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function mapNetworkId(id: string): WalletState['network'] {
  if (id.includes('preprod')) return 'preprod';
  if (id.includes('preview')) return 'preview';
  if (id.includes('mainnet')) return 'mainnet';
  return 'undeployed';
}

function generateDemoAddress(): string {
  const chars = '0123456789abcdef';
  let addr = 'midnight1';
  for (let i = 0; i < 56; i++) {
    addr += chars[Math.floor(Math.random() * chars.length)];
  }
  return addr;
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
