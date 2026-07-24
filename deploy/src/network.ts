/**
 * Network configuration and state management for NightScore deployment.
 * Supports preprod and preview public testnets.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export type NetworkId = 'preprod' | 'preview';

export const NETWORK_IDS: readonly NetworkId[] = ['preprod', 'preview'] as const;

export interface NetworkConfig {
  networkId: NetworkId;
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  faucet: string;
}

export interface DeploymentRecord {
  address: string;
  deployedAt: string;
  deployer: string;
}

export interface NetworkState {
  version: 1;
  activeNetwork: NetworkId;
  wallets: Partial<Record<NetworkId, { seed: string; createdAt: string }>>;
  deployments: Partial<Record<NetworkId, DeploymentRecord>>;
}

export const STATE_FILE_NAME = '.midnight-state.json';
export const STATE_VERSION = 1 as const;

export const NETWORK_CONFIGS: Record<NetworkId, NetworkConfig> = {
  preview: {
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev',
  },
  preprod: {
    networkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev',
  },
};

export function isNetworkId(v: unknown): v is NetworkId {
  return typeof v === 'string' && (NETWORK_IDS as readonly string[]).includes(v);
}

export interface FsOptions {
  cwd?: string;
}

function statePath(opts: FsOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), STATE_FILE_NAME);
}

export function loadState(opts: FsOptions = {}): NetworkState | null {
  const p = statePath(opts);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse ${p}: ${(e as Error).message}. Delete the file and retry.`);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== STATE_VERSION
  ) {
    throw new Error(`Unsupported state-file version in ${p}. Delete and retry.`);
  }
  return parsed as NetworkState;
}

export function saveState(state: NetworkState, opts: FsOptions = {}): void {
  const p = statePath(opts);
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, p);
}

export function parseNetworkFlag(argv: string[]): NetworkId | null {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--network') {
      const v = argv[i + 1];
      if (v === undefined) throw new Error('--network requires a value');
      if (!isNetworkId(v)) {
        throw new Error(`Unknown network: ${v}. Supported: ${NETWORK_IDS.join(', ')}.`);
      }
      return v;
    }
    if (arg.startsWith('--network=')) {
      const v = arg.slice('--network='.length);
      if (!isNetworkId(v)) {
        throw new Error(`Unknown network: ${v}. Supported: ${NETWORK_IDS.join(', ')}.`);
      }
      return v;
    }
  }
  return null;
}

export interface ResolveResult {
  network: NetworkId;
  config: NetworkConfig;
}

export function resolveNetwork(argv?: string[]): ResolveResult {
  const args = argv ?? process.argv;
  const env = process.env;

  const flag = parseNetworkFlag(args);
  let network: NetworkId;

  if (flag) {
    network = flag;
  } else {
    const state = loadState();
    if (state && isNetworkId(state.activeNetwork)) {
      network = state.activeNetwork;
    } else {
      network = 'preprod';
    }
  }

  const config = { ...NETWORK_CONFIGS[network] };

  if (env.MIDNIGHT_INDEXER_URL) config.indexer = env.MIDNIGHT_INDEXER_URL;
  if (env.MIDNIGHT_INDEXER_WS_URL) config.indexerWS = env.MIDNIGHT_INDEXER_WS_URL;
  if (env.MIDNIGHT_NODE_URL) config.node = env.MIDNIGHT_NODE_URL;
  if (env.MIDNIGHT_PROOF_SERVER_URL) config.proofServer = env.MIDNIGHT_PROOF_SERVER_URL;
  if (env.MIDNIGHT_FAUCET_URL) config.faucet = env.MIDNIGHT_FAUCET_URL;

  return { network, config };
}

export function getOrCreateSeed(network: NetworkId): string {
  const fromEnv = process.env.MIDNIGHT_WALLET_SEED;
  if (fromEnv) return fromEnv;

  const existing = loadState();
  const persisted = existing?.wallets?.[network]?.seed;
  if (persisted) return persisted;

  const seed = crypto.randomBytes(32).toString('hex');
  const next: NetworkState = existing ?? {
    version: STATE_VERSION,
    activeNetwork: network,
    wallets: {},
    deployments: {},
  };
  next.activeNetwork = network;
  next.wallets = {
    ...next.wallets,
    [network]: { seed, createdAt: new Date().toISOString() },
  };
  saveState(next);
  return seed;
}

export function getDeployment(network: NetworkId): DeploymentRecord | null {
  const state = loadState();
  return state?.deployments?.[network] ?? null;
}

export function recordDeployment(network: NetworkId, address: string, deployer: string): void {
  const existing = loadState();
  const next: NetworkState = existing ?? {
    version: STATE_VERSION,
    activeNetwork: network,
    wallets: {},
    deployments: {},
  };
  next.deployments = {
    ...next.deployments,
    [network]: { address, deployer, deployedAt: new Date().toISOString() },
  };
  saveState(next);
}

export function setActiveNetwork(network: NetworkId): void {
  const existing = loadState();
  if (existing && existing.activeNetwork === network) return;
  const next: NetworkState = existing ?? {
    version: STATE_VERSION,
    activeNetwork: network,
    wallets: {},
    deployments: {},
  };
  next.activeNetwork = network;
  saveState(next);
}

// CLI entry point
function isMain(): boolean {
  try {
    const here = new URL(import.meta.url).pathname;
    const invoked = process.argv[1] && fs.realpathSync(process.argv[1]);
    return invoked === fs.realpathSync(here);
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    const r = resolveNetwork();
    const dep = getDeployment(r.network);
    process.stdout.write(`Active network: ${r.network}\n`);
    if (dep) process.stdout.write(`Last deploy: ${dep.address}\n`);
  } else {
    const candidate = args[0];
    if (!isNetworkId(candidate)) {
      process.stderr.write(`Unknown network: ${candidate}. Supported: ${NETWORK_IDS.join(', ')}.\n`);
      process.exit(1);
    }
    setActiveNetwork(candidate);
    process.stdout.write(`Active network is now: ${candidate}\n`);
  }
}
