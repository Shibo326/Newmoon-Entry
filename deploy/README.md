# NightScore — Deploy to Preprod/Preview

Deploy the NightScore Compact contract (`contracts/nightscore.compact`) to Midnight's public testnets.

## Prerequisites

- Node.js 22+
- Docker Desktop running (for local proof server)
- Compact compiler 0.31.x installed (only if you need to recompile)

## Quick Start

```bash
cd deploy
npm install
npm run setup -- --network preprod
```

This will:
1. Start the proof server (Docker)
2. Generate a wallet (or reuse existing)
3. Print wallet address + faucet URL
4. Wait for you to fund the wallet via the faucet
5. Register for DUST, wait for DUST generation
6. Deploy NightScore contract
7. Save contract address to `.midnight-state.json`

## Step-by-Step

### 1. Install dependencies

```bash
npm install
```

### 2. Start proof server

```bash
docker compose up -d
```

### 3. Deploy

```bash
npm run deploy -- --network preprod
```

The script will:
- Print your wallet address
- Print the faucet URL: `https://midnight-tmnight-preprod.nethermind.dev`
- Poll for funding every 10s (10 min timeout, configurable via `MIDNIGHT_FAUCET_TIMEOUT_MS`)

Open the faucet in your browser, paste the address, and request tNIGHT.

### 4. Check the result

After deployment, the contract address is saved in `.midnight-state.json`:

```bash
npm run network
# Prints: Active network: preprod
#         Last deploy: <contract_address>
```

## Networks

| Network | Faucet | When to Use |
|---------|--------|-------------|
| `preprod` | https://midnight-tmnight-preprod.nethermind.dev | Final testing, challenge submission |
| `preview` | https://midnight-tmnight-preview.nethermind.dev | Experimental testing |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | One-shot: proof server + deploy |
| `npm run deploy` | Deploy only (proof server must be running) |
| `npm run check-balance` | Print wallet tNIGHT and DUST balances |
| `npm run network` | Show/switch active network |
| `npm run proof-server:start` | Start proof server only |
| `npm run proof-server:stop` | Stop proof server |

## Environment Variables

| Variable | Effect |
|----------|--------|
| `MIDNIGHT_WALLET_SEED` | Use a specific seed instead of auto-generating |
| `MIDNIGHT_PROOF_SERVER_URL` | Override proof server URL |
| `MIDNIGHT_FAUCET_TIMEOUT_MS` | Faucet poll timeout (default: 600000 = 10 min) |

## Contract Info

The compiled contract at `../managed/` contains:
- `computeScore` — ZK circuit for credit scoring (6 private inputs, 1 public score)
- `verifyThreshold` — ZK circuit for boolean-only threshold verification
- Prover/verifier keys for both circuits
- ZKIR intermediate representation

## After Deployment

Update the root README.md with the contract address from `.midnight-state.json`.
The contract is then verifiable on the Midnight block explorer.
