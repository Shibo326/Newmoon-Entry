# NightScore
![CI](https://github.com/Shibo326/Newmoon-Entry/actions/workflows/ci.yml/badge.svg)
> Privacy-preserving credit scoring on Midnight — prove your creditworthiness without revealing your financial activity.

## Live Demo
https://newmoon-entry-projects.vercel.app

## Contract Address
| Network | Address |
|---------|---------|
| Preview | a3e01772c31935fc25719d878514b2bb1b64198c65b4862dd9fcb6888173af71 |
| Preprod | [DEPLOYING — will update when Preprod sync completes] |

## What This Does
NightScore computes a DeFi credit grade from 6 wallet signals (wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, liquidation history) using zero-knowledge proofs on Midnight. The user's raw financial data never leaves their device — only a hash of their score goes on-chain.

A lending protocol can verify "does this wallet have at least a BBB credit grade?" and get a yes/no answer without ever seeing the actual grade or the underlying signals.

## Privacy Model
- **PUBLIC** (on-chain, visible to anyone): Score hash, wallet registered flag, total scored counter, threshold verification boolean (YES/NO)
- **PRIVATE** (private witness, never on-chain): Wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, liquidation history, actual credit score
- **PROVED without revealing**: "My credit grade meets your minimum threshold" — the verifier sees true/false, never the actual grade or raw signals

## Privacy Claim
An on-chain observer can see that a wallet has been scored and whether it meets a specific threshold. They CANNOT see the actual credit score, the individual signal values, or any wallet activity data. The zero-knowledge proof guarantees the computation is correct without revealing inputs.

## Tech Stack
- Midnight network (Compact language, ZK circuits)
- React + Vite + TypeScript (frontend)
- Tailwind CSS + Framer Motion (UI/animations)
- Vitest + fast-check (testing)
- Vercel (frontend deployment)
- GitHub Actions (CI/CD)

## Prerequisites
- Node.js v22+
- Lace wallet (browser extension)
- Docker (for proof server, local development)

## Setup & Run Locally
```bash
git clone https://github.com/Shibo326/Newmoon-Entry.git
cd Newmoon-Entry
npm install

# Run tests
npm test

# Run frontend locally
cd frontend
npm install
npm run dev
```

## Run Tests
```bash
npm test
```
14 tests across 4 suites: circuit logic, state transitions, privacy guarantees, threshold verification.

## CI/CD
GitHub Actions pipeline runs on every push to main/dev1:
- Installs dependencies
- Runs full test suite (14 tests)
- Builds frontend (TypeScript check + Vite build)

## Demo Video
https://drive.google.com/drive/folders/1XGSac_jwkefbDrzCCsG440uhtcgLShX1?usp=sharing

## Product Proposal
See PROPOSAL.md — NightScore implements **Confidential Credentials**: prove a credit credential is valid (meets minimum threshold) without disclosing the actual grade or underlying financial data.

## Screenshots
### Compile Output
![Compile Output](src/compile-output.png)

### Contract Deployed
![Contract Deployed](src/contract-deployed.png)
