/**
 * Quick utility to derive and print the wallet address for the preprod seed.
 * Does NOT require Docker or proof server.
 */
import { Buffer } from 'buffer';
import { HDWallet, Roles, createKeystore } from '@midnight-ntwrk/wallet-sdk';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const network = process.argv[2] || 'preprod';
setNetworkId(network);

// Use env var or fall back to the seed from mn-demo/.midnight-state.json
const seed = process.env.MIDNIGHT_WALLET_SEED || '0dc3e67beb326f86b76abf0d768c3e9a2e01d8b5edc18849c43eb3070d729a23';

const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hdWallet.type !== 'seedOk') {
  console.error('Invalid seed');
  process.exit(1);
}

const result = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);

if (result.type !== 'keysDerived') {
  console.error('Key derivation failed');
  process.exit(1);
}

hdWallet.hdWallet.clear();
const keystore = createKeystore(result.keys[Roles.NightExternal], getNetworkId());
const address = keystore.getBech32Address().toString();

console.log(`\nNetwork: ${network}`);
console.log(`Address: ${address}`);
console.log(`\nFund this address at the faucet:`);
console.log(`  https://midnight-tmnight-${network}.nethermind.dev\n`);
