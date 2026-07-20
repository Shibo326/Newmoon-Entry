# NightScore — Product Proposal

## Category: Confidential Credentials

## Elevator Pitch
NightScore is a privacy-preserving credit scoring platform that lets DeFi users prove their creditworthiness without revealing their financial history. Using Midnight's zero-knowledge proofs, users get a credit grade (AAA to C) that can be verified on-chain while keeping all underlying wallet data completely private.

## Problem Statement
1. DeFi lending requires over-collateralization because there's no way to assess borrower risk privately
2. Existing on-chain reputation systems (DegenScore, Spectral, etc.) require full wallet transparency
3. Users risk phishing and malicious contract interactions with no pre-signing security analysis
4. There is no portable, privacy-preserving credit identity for DeFi

## Solution
NightScore combines three innovations on Midnight:

### 1. Zero-Knowledge Credit Scoring
- 6 wallet signals (wallet age, TX frequency, DeFi interactions, repayment history, asset diversity, liquidation events) are computed as private witness values in a Compact circuit
- An AI model (Groq, Llama 3.3 70B) grades the signals into a credit grade
- The grade is proven on-chain without revealing any raw signal data
- Verifiers can query "Does this wallet meet BBB threshold?" and receive only true/false

### 2. NightGuard AI Security
- Every transaction is screened by AI (Fireworks AI) before the user signs
- Detects: contract age risk, unlimited approvals, phishing, behavioral anomalies, high-value outliers
- Predicts how transactions might impact the user's NightScore
- Acts as an AI guardian layer over the Lace wallet connection

### 3. Confidential Credentials
- ZK credentials minted on Midnight attest to a user's credit grade
- Credentials are portable across protocols — mint once, use everywhere
- Credentials expire and must be refreshed (creates recurring engagement)
- Boolean-only verification: protocols never see the actual grade, just pass/fail

## Privacy Guarantees
### What an observer CAN see:
- That a wallet has been scored (walletRegistered flag)
- The total number of scorings performed (totalScored counter)
- A hash of the score (scoreHash — not reversible to the actual score)
- Whether a wallet passes a specific threshold (true/false boolean)

### What an observer CANNOT see:
- The actual credit score or grade
- Individual signal values (wallet age, TX frequency, etc.)
- The AI's reasoning or signal weights
- Any raw wallet transaction history or balances
- Which specific threshold was queried (only the result)

## Technical Architecture
- 9 adaptive agents communicating via in-memory message bus
- Midnight blockchain (Compact language for ZK circuits)
- Lace wallet integration (DApp Connector API)
- Dual AI: Groq for credit scoring, Fireworks AI for security screening
- Supabase for caching and configuration storage
- React frontend with Framer Motion animations

## Business Model
1. **Credential minting fees** — users pay per ZK credential mint/refresh
2. **Verification API** — DeFi protocols pay per threshold query
3. **Premium tiers** — advanced analytics, multi-chain signals, real-time updates
4. **Protocol integration fees** — one-time + subscription for embedded NightScore checks

## Competitive Advantage
- Only privacy-preserving credit score in DeFi (competitors expose wallet data)
- First mover on Midnight blockchain
- AI-powered grading adapts better than static formulas
- Dual AI (scoring + security) creates a complete privacy-first DeFi identity
- ZK credentials are cryptographically provable, not just badges

## Team
Built during the Midnight Network hackathon by Team PROGRAMME.

## Why Midnight?

Midnight is the only blockchain purpose-built for this use case. Here's why NightScore couldn't exist on any other chain:

1. **Native ZK with private state** — Midnight's Compact language has first-class private witnesses. The 6 wallet signals live entirely in private state — they never touch the public ledger. On Ethereum or Solana, you'd need complex off-chain ZK setups with no native private state support.

2. **Boolean-only verification** — Midnight's circuit model naturally supports returning only true/false from threshold checks. The verifier literally cannot extract more information than the boolean result. Other chains would require custom verifier contracts that are harder to audit.

3. **Shielded credentials** — Midnight's credential system allows ZK attestations that are portable across DApps. There's no equivalent on EVM chains without building an entire credential infrastructure from scratch.

4. **Lace wallet integration** — The DApp Connector API provides a clean, audited bridge between the user's private keys and our scoring pipeline. The user experience is seamless — connect once, score privately.

5. **Regulatory design** — Midnight's "selective disclosure" model (prove a fact without revealing underlying data) aligns perfectly with emerging DeFi compliance requirements. Regulators can verify solvency thresholds without accessing individual financial records.

## Mainnet Feasibility

NightScore is designed to be production-ready on Midnight mainnet:

### What's ready now:
- Compact contract deployed on Preview network (verified, tested)
- Full scoring pipeline: 6 signals → AI grade → ZK proof → credential mint
- 669 automated tests covering all agents, privacy guarantees, and edge cases
- CI/CD pipeline with automated testing on every push
- Frontend deployed on Vercel with Lace wallet integration

### Path to mainnet (estimated 4-6 weeks after mainnet launch):
1. **Week 1-2**: Redeploy contract to mainnet, update RPC endpoints, test with real tDUST
2. **Week 2-3**: Connect real on-chain signal reading (replace stubs with actual Compact Witness calls)
3. **Week 3-4**: Integrate Supabase production instance for caching and config
4. **Week 4-5**: Security audit of Compact contract + penetration testing of API
5. **Week 5-6**: Beta launch with limited users, monitor NightGuard AI accuracy

### What scales:
- Agent architecture is horizontally scalable (each agent is stateless, communicates via bus)
- Fireworks AI inference is <200ms per screening call
- Supabase cache prevents redundant scoring (TTL-based refresh)
- Credential minting is one TX per user per refresh period — minimal chain load
- Frontend is static (Vercel CDN) — handles unlimited concurrent users

### Dependencies for mainnet:
- Midnight mainnet stable release
- Lace wallet mainnet support (confirmed in roadmap)
- Proof server availability for local ZK proof generation

## Demo
- Live: https://newmoon-entry-projects.vercel.app
- Video: https://drive.google.com/drive/folders/1XGSac_jwkefbDrzCCsG440uhtcgLShX1?usp=sharing
