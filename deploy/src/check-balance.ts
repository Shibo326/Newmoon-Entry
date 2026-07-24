/**
 * Check wallet balance on the active network.
 */
import { resolveNetwork, getOrCreateSeed } from './network.js';
import { createWallet, persistWalletState, unshieldedToken } from './wallet.js';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

async function main() {
  console.log(`\n  Network: ${network}\n`);
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });

  console.log('  Syncing...');
  const state = await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());

  console.log(`\n  Wallet:  ${address}`);
  console.log(`  tNIGHT:  ${tNight.toLocaleString()}`);
  console.log(`  DUST:    ${dust.toLocaleString()}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
