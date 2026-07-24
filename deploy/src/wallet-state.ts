/**
 * Wallet sync-state persistence for NightScore deployment.
 * Saves/restores wallet state to avoid re-syncing from genesis on each run.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NetworkId } from './network.js';

export const WALLET_STATE_DIR = '.midnight-wallet-state';
export const WALLET_STATE_VERSION = 1 as const;

export type ChildKind = 'shielded' | 'unshielded' | 'dust';
export const CHILD_KINDS: readonly ChildKind[] = ['shielded', 'unshielded', 'dust'] as const;

export interface PersistedWalletState {
  shielded?: unknown;
  unshielded?: unknown;
  dust?: string;
}

export interface FsOptions {
  cwd?: string;
}

function networkDir(network: NetworkId, opts: FsOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), WALLET_STATE_DIR, network);
}

function walletStatePath(network: NetworkId, kind: ChildKind, opts: FsOptions = {}): string {
  return path.join(networkDir(network, opts), `${kind}.json`);
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

interface VersionedState<T> {
  version: typeof WALLET_STATE_VERSION;
  state: T;
}

function readVersionedState<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as VersionedState<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== WALLET_STATE_VERSION) {
      return undefined;
    }
    return parsed.state;
  } catch {
    return undefined;
  }
}

function writeVersionedState<T>(file: string, state: T): void {
  const payload: VersionedState<T> = { version: WALLET_STATE_VERSION, state };
  atomicWrite(file, `${JSON.stringify(payload)}\n`);
}

export function loadWalletState(network: NetworkId, opts: FsOptions = {}): PersistedWalletState {
  return {
    shielded: readVersionedState(walletStatePath(network, 'shielded', opts)),
    unshielded: readVersionedState(walletStatePath(network, 'unshielded', opts)),
    dust: readVersionedState<string>(walletStatePath(network, 'dust', opts)),
  };
}

export function saveWalletState(
  network: NetworkId,
  state: PersistedWalletState,
  opts: FsOptions = {},
): void {
  if (state.shielded !== undefined) writeVersionedState(walletStatePath(network, 'shielded', opts), state.shielded);
  if (state.unshielded !== undefined) writeVersionedState(walletStatePath(network, 'unshielded', opts), state.unshielded);
  if (state.dust !== undefined) writeVersionedState(walletStatePath(network, 'dust', opts), state.dust);
}

export function clearWalletState(network: NetworkId, opts: FsOptions = {}): void {
  const dir = networkDir(network, opts);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
