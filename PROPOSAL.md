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

## Demo
- Live: https://newmoon-entry-projects.vercel.app
- Video: https://drive.google.com/drive/folders/1XGSac_jwkefbDrzCCsG440uhtcgLShX1?usp=sharing
