# NightScore

![CI](https://github.com/Shibo326/Newmoon-Entry/actions/workflows/ci.yml/badge.svg)

> Privacy-preserving credit scoring on Midnight — prove your creditworthiness without revealing your financial activity. Protected by NightGuard AI security.

## Contract

**Compact Contract**: [`contracts/nightscore.compact`](contracts/nightscore.compact)

**Compiled Output (managed directory)**: [`managed/`](managed/)
- `managed/compiler/contract-info.json` — Compile metadata (compiler v0.31.1, runtime v0.16.0)
- `managed/contract/index.js` — Compiled contract module
- `managed/contract/index.d.ts` — TypeScript type definitions
- `managed/keys/` — Prover/verifier keys for `computeScore` and `verifyThreshold` circuits
- `managed/zkir/` — ZK intermediate representation files

**Deployed Contract Address**:

| Network | Contract Address |
|---------|-----------------|
| Local Devnet | `a3e01772c31935fc25719d878514b2bb1b64198c65b4862dd9fcb6888173af71` |

## Privacy Design — Private Witness vs. Public State Separation

The contract in [`contracts/nightscore.compact`](contracts/nightscore.compact) enforces strict separation:

### Public Ledger State (on-chain, visible to anyone):
```
export ledger score: Uint<16>;
export ledger registered: Boolean;
export ledger totalScored: Uint<32>;
```

### Private Witness Inputs (NEVER on-chain):
The 6 inputs to `computeScore` are private circuit arguments — they exist only in the ZK proof and never appear on the public ledger:
- `walletAge` — How long the wallet has existed
- `txFrequency` — Transaction frequency in scoring window
- `defiInteractions` — DeFi protocol interaction count
- `repaymentHistory` — Repayment success rate
- `assetDiversity` — Number of distinct asset types
- `liquidationHistory` — Number of liquidation events

### Threshold Verification (boolean-only disclosure):
The `verifyThreshold` circuit takes `actualScore` and `minimumScore` as private inputs, and discloses ONLY a boolean (`registered = disclose(actualScore >= minimumScore)`). The verifier receives only true/false — the actual score is never revealed.

**Privacy guarantee**: `disclose()` in Compact reveals only the computed result. Raw input signals are private witnesses that never touch the ledger.

## Test Suite

**669 tests** across 31 test suites using **Vitest + fast-check** (property-based testing).

```bash
npm test
```

Test files:
- `src/agents/__tests__/*.test.ts` — Agent unit tests
- `src/agents/__tests__/*.property.test.ts` — Property-based tests (fast-check)
- `src/bus/message-bus.test.ts` — Message Bus tests
- `src/config/__tests__/behavior-profile.property.test.ts` — Config tests
- `src/log/__tests__/adaptation-log.property.test.ts` — Adaptation Log tests
- `src/privacy/__tests__/` — Privacy guard tests
- `src/registry/__tests__/` — Registry tests
- `src/__tests__/integration.test.ts` — End-to-end integration test

## Live Demo

https://newmoon-entry-projects.vercel.app

## What Is NightScore?

NightScore is a **privacy-preserving credit scoring + AI security platform** on Midnight blockchain:

1. **ZK Credit Scoring** — 6 wallet signals computed in a ZK circuit, graded by AI. Your data never leaves your device.
2. **NightGuard AI** — Transaction security screening before you sign. Detects phishing, scam contracts, unlimited approvals.
3. **Confidential Credentials** — Mint ZK credentials that prove creditworthiness without revealing anything about your wallet.

## Architecture

```
src/
├── agents/           ← 9 agent implementations (one file per agent)
│   ├── orchestrator-agent.ts
│   ├── wallet-agent.ts
│   ├── signal-agent.ts
│   ├── scoring-agent.ts
│   ├── credential-agent.ts
│   ├── verification-agent.ts
│   ├── cache-agent.ts
│   ├── monitor-agent.ts
│   └── guard-agent.ts
├── bus/              ← Message Bus (pub/sub, topic routing)
├── registry/         ← Agent Registry + startup initialization
├── config/           ← Behavior Profile store + hot-reload
├── log/              ← Adaptation Log
├── privacy/          ← Privacy guard (strips sensitive data from events)
├── types/            ← TypeScript interfaces (barrel exported)
└── index.ts          ← System entry point

contracts/
└── nightscore.compact   ← Compact smart contract (ZK circuits)

managed/                  ← Compiled contract output
├── compiler/contract-info.json
├── contract/index.js
├── contract/index.d.ts
├── keys/                 ← Prover/verifier keys
└── zkir/                 ← ZK intermediate representation

frontend/
├── src/
│   ├── components/       ← React UI components
│   ├── context/          ← Midnight wallet context
│   ├── hooks/            ← useMidnight hook
│   └── services/         ← Lace DApp Connector + indexer integration
└── vite.config.ts
```

| Agent | Responsibility | AI Provider |
|-------|---------------|-------------|
| Orchestrator | Pipeline coordination | — |
| Wallet | Lace wallet connection | — |
| Signal | Read wallet signals from ZK Witness | — |
| Scoring | Credit grade computation | Groq (Llama 3.3 70B) |
| Credential | Mint/revoke ZK credentials | — |
| Verification | Threshold queries (boolean only) | — |
| Cache | Supabase request cache | — |
| Monitor | Metrics, alerting, health | — |
| Guard | Transaction security screening | Fireworks AI |

## Privacy Model

| What's PUBLIC (on-chain) | What's PRIVATE (never on-chain) |
|--------------------------|--------------------------------|
| Score hash | Actual credit score / grade |
| Wallet registered flag | Individual signal values |
| Total scored counter | AI reasoning / weights |
| Threshold boolean (true/false) | Raw wallet history |

## Credit Grades

| Grade | Numeric | Meaning |
|-------|---------|---------|
| AAA | 5 | Exceptional |
| AA | 4 | Excellent |
| A | 3 | Good |
| BBB | 2 | Adequate |
| BB | 1 | Below average |
| C | 0 | Minimal |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Midnight (Compact language, ZK circuits) |
| Wallet | Lace (DApp Connector API) |
| Credit AI | Groq API (Llama 3.3 70B) |
| Security AI | Fireworks AI (Llama 3.1 8B) |
| Backend | TypeScript, Node.js 22+ |
| Frontend | React 18, Vite, Tailwind CSS, Framer Motion |
| Testing | Vitest + fast-check (669 tests) |
| Cache | Supabase |
| CI/CD | GitHub Actions |
| Hosting | Vercel |

## Setup

```bash
# Clone
git clone https://github.com/Shibo326/Newmoon-Entry.git
cd Newmoon-Entry

# Install dependencies
npm install

# Create .env
cp .env.example .env

# Run tests (669 tests)
npm test

# Run frontend
cd frontend
npm install
npm run dev
```

## Environment Variables

```bash
FIREWORKS_API_KEY=    # Fireworks AI (NightGuard)
GROQ_API_KEY=        # Groq (Scoring Agent)
SUPABASE_URL=        # Supabase (Cache + Config)
SUPABASE_ANON_KEY=   # Supabase (Auth)
```

## Demo Video

https://drive.google.com/drive/folders/1XGSac_jwkefbDrzCCsG440uhtcgLShX1?usp=sharing

## Screenshots

### Test Output (669 tests passing)
![Test Output](src/test-output.png)

### Compact Compile Output
![Compile Output](src/compile-output.png)

### Contract Deployed
![Contract Deployed](src/contract-deployed.png)

## License

MIT
