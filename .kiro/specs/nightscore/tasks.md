# Implementation Plan: NIGHTSCORE

## Overview

This implementation plan builds the NIGHTSCORE privacy-preserving credit scoring system incrementally, starting with core types and utility functions, progressing through the scoring engine and caching layer, then on-chain contract integration, and finally the frontend dashboard and verification portal. Each task builds on previous steps, and all code is wired together by the final integration phase.

## Tasks

- [ ] 1. Set up project structure, core types, and utility functions
  - [ ] 1.1 Create NIGHTSCORE-specific type definitions and interfaces
    - Create `src/nightscore/types.ts` with interfaces: `NormalizedSignalVector`, `ScoringResult`, `SignalContribution`, `CreditGrade`, `CacheEntry`, `CachedResult`, `WalletConnection`, `ErrorResponse`, `ErrorCode`, `AppState`
    - Define the credit grade ordering enum: `{ AAA: 5, AA: 4, A: 3, BBB: 2, BB: 1, C: 0 }`
    - Include all type definitions from design document components section
    - _Requirements: 3.1, 5.2, 6.2_

  - [ ] 1.2 Implement address truncation utility
    - Create `src/nightscore/utils/truncate-address.ts`
    - Implement function that takes a wallet address string (≥10 chars) and returns `first6...last4` format
    - Handle edge cases: short addresses, empty strings
    - _Requirements: 1.2_

  - [ ]* 1.3 Write property test for address truncation
    - **Property 1: Address Truncation**
    - For any wallet address string of 10+ characters, verify output is first 6 chars + ellipsis + last 4 chars
    - Use fast-check with random hex strings of length 10-128
    - **Validates: Requirements 1.2**

  - [ ] 1.4 Implement grade-to-color mapping utility
    - Create `src/nightscore/utils/grade-color.ts`
    - Map AAA/AA/A → green, BBB → yellow, BB/C → red
    - Export `getGradeColor(grade: CreditGrade): 'green' | 'yellow' | 'red'`
    - _Requirements: 6.6_

  - [ ]* 1.5 Write property test for grade-to-color mapping
    - **Property 13: Grade-to-Color Mapping**
    - Verify green for {AAA, AA, A}, yellow for BBB, red for {BB, C}
    - Exhaustive test over all 6 grades + random invalid inputs
    - **Validates: Requirements 6.6**

  - [ ] 1.6 Implement proof hash computation utility
    - Create `src/nightscore/utils/proof-hash.ts`
    - Implement SHA-256 hash of normalized signal vector concatenated with grade string
    - Return hex-encoded 32-byte hash
    - _Requirements: 4.3_

  - [ ]* 1.7 Write property test for proof hash determinism
    - **Property 9: Proof Hash Determinism**
    - For any signal vector and grade pair, computing hash twice produces identical result
    - Use fast-check with random signal vectors × grades
    - **Validates: Requirements 4.3**

- [ ] 2. Implement signal normalization and validation
  - [ ] 2.1 Implement signal vector validation function
    - Create `src/nightscore/signals/validate-signals.ts`
    - Check all 6 required signals are present (walletAge, txFrequency, defiInteractions, repaymentHistory, assetDiversity, liquidationHistory)
    - Verify each value is within [0.0, 1.0] range
    - Return detailed error specifying which signals are missing or out of range
    - _Requirements: 3.7_

  - [ ]* 2.2 Write property test for signal vector validation
    - **Property 7: Signal Vector Validation**
    - For any vector with missing/out-of-range signals, validation rejects with specific errors
    - Use fast-check with random vectors with injected invalid values
    - **Validates: Requirements 3.7**

  - [ ] 2.3 Implement signal normalization with default assignment
    - Create `src/nightscore/signals/normalize-signals.ts`
    - Normalize raw signal values to [0.0, 1.0] range
    - Assign 0.5 for unavailable signals (fewer than 3 relevant transactions)
    - Flag estimated signals in metadata
    - _Requirements: 2.3, 2.4_

  - [ ]* 2.4 Write property test for default signal assignment
    - **Property 3: Default Signal Assignment**
    - For any subset of unavailable signals, verify 0.5 assigned and flagged as estimated
    - Use fast-check with random subsets of 6 signals marked unavailable
    - **Validates: Requirements 2.3**

  - [ ]* 2.5 Write property test for signal normalization range
    - **Property 4: Signal Normalization Range**
    - For any raw signal input, verify all outputs are in [0.0, 1.0]
    - Use fast-check with random numeric arrays including edge values
    - **Validates: Requirements 2.4**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement the Scoring Engine
  - [ ] 4.1 Implement Groq API integration for credit scoring
    - Create `src/nightscore/scoring/scoring-engine.ts`
    - Implement `computeGrade(signals: NormalizedSignalVector): Promise<ScoringResult>`
    - Configure Groq API with model `llama-3.3-70b-versatile`, temperature: 0, JSON response format
    - Build structured system prompt with deterministic scoring rubric
    - Parse response into `ScoringResult` with grade, reasoning array, and proof hash
    - Handle 5-second timeout with service-unavailable error
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 4.2 Write property test for scoring output structure
    - **Property 5: Scoring Output Structure**
    - For any valid signal vector, verify result contains valid grade and exactly 6 reasoning entries
    - Each entry must have valid direction and weight in [0.0, 1.0]
    - Use fast-check with random valid signal vectors
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 4.3 Write property test for scoring determinism
    - **Property 6: Scoring Determinism**
    - For any signal vector, running computeGrade twice produces same grade and reasoning
    - Use fast-check (may use mocked Groq for speed, verifying prompt construction is deterministic)
    - **Validates: Requirements 3.4**

  - [ ] 4.4 Implement rate limit tracking
    - Create `src/nightscore/scoring/rate-limiter.ts`
    - Track daily request count against 14,400 limit
    - Return rate-limit-exceeded error when limit hit
    - Integrate with Supabase `rate_limit_tracker` table
    - _Requirements: 3.8_

- [ ] 5. Implement Request Cache layer
  - [ ] 5.1 Create Supabase migration for scoring cache and verification log
    - Create `supabase/migrations/002_nightscore_tables.sql`
    - Define `scoring_cache` table with wallet_address, signal_vector_hash, grade, reasoning (JSONB), computed_at, expires_at
    - Define `verification_log` table with queried_wallet, querying_address, query_timestamp, min_grade_requested
    - Define `rate_limit_tracker` table
    - Add indexes and row-level security policies (service_role only)
    - _Requirements: 7.1, 7.4, 5.5, 9.5_

  - [ ] 5.2 Implement cache read/write service
    - Create `src/nightscore/cache/request-cache.ts`
    - Implement `get(walletAddress, signalHash): Promise<CachedResult | null>` — check expiry (24h)
    - Implement `set(entry: CacheEntry): Promise<void>` — store hashed signals only
    - Implement `invalidate(walletAddress): Promise<void>`
    - Handle cache unavailability gracefully (proceed without cache, log failure)
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 9.5_

  - [ ]* 5.3 Write property test for cache hit/miss correctness
    - **Property 8: Cache Hit/Miss Correctness**
    - For any request with wallet W and hash H: cache hit if matching entry < 24h old, miss otherwise
    - Use fast-check with random cache states × request combinations
    - **Validates: Requirements 3.6, 7.2, 7.3**

  - [ ]* 5.4 Write property test for cache storing only hashed signals
    - **Property 14: Cache Stores Only Hashed Signals**
    - For any cache write, verify stored entry contains hash but no raw signal values
    - Use fast-check with random signal vectors, inspect stored data structure
    - **Validates: Requirements 7.1, 9.5**

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement wallet connection and session management
  - [ ] 7.1 Implement wallet service for Lace connection
    - Create `src/nightscore/wallet/wallet-service.ts`
    - Implement `connect()`: initiate Lace wallet connection via Midnight DApp Connector API (CAIP-372)
    - Implement `disconnect()`: clear all session data, reset to unauthenticated state
    - Implement `getAddress()`, `isConnected()`, `signTransaction()`
    - Handle 30-second connection timeout
    - Detect missing Lace extension and provide install link
    - Persist connection state across page refreshes (sessionStorage)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 7.2 Write property test for session state clearing
    - **Property 2: Session State Clearing**
    - For any AppState with active session, disconnecting resets all fields to defaults
    - Use fast-check with random AppState objects
    - **Validates: Requirements 1.4**

  - [ ]* 7.3 Write unit tests for wallet connection flows
    - Test successful connection, user rejection, 30s timeout, extension not found
    - Test session persistence across simulated refresh
    - Test disconnect clears all data
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6_

- [ ] 8. Implement Compact Contract and ZK credential operations
  - [ ] 8.1 Write the Compact contract for credential management
    - Create `compact/nightscore.compact` (or equivalent Compact source file)
    - Implement ledger with `credentials: Map<Address, Credential>`
    - Implement `mintCredential` circuit: verify caller, revoke existing credential if present, store new credential
    - Implement `thresholdCheck` circuit: compare stored grade >= minGrade, disclose boolean only
    - Implement `setGrade` for Level 1 manual grade setting (integer 0-100)
    - Credential is soulbound (non-transferable)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.8, 5.1, 5.2, 5.3, 5.4, 8.1_

  - [ ]* 8.2 Write property test for credential revocation on re-mint
    - **Property 10: Credential Revocation on Re-Mint**
    - For any wallet with existing credential, minting new one results in exactly one active credential
    - Use fast-check with random mint sequences for same wallet
    - **Validates: Requirements 4.4**

  - [ ]* 8.3 Write property test for threshold comparison correctness
    - **Property 11: Threshold Comparison Correctness**
    - For all 36 combinations of stored grade × query grade, verify boolean result matches numeric comparison
    - Use grade ordering C(0) < BB(1) < BBB(2) < A(3) < AA(4) < AAA(5)
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 8.4 Write property test for invalid grade rejection
    - **Property 12: Invalid Grade Rejection**
    - For any grade value not in {AAA, AA, A, BBB, BB, C}, verify rejection with error
    - Use fast-check with random strings not in valid grade set
    - **Validates: Requirements 5.6**

  - [ ] 8.5 Implement credential minting orchestration (off-chain)
    - Create `src/nightscore/credential/mint-credential.ts`
    - Orchestrate: compute proof hash → call Compact contract mint → handle retries (max 3, exponential backoff)
    - Handle 60-second minting timeout
    - Revoke previous credential before minting new one
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7_

- [ ] 9. Implement logging and privacy guard
  - [ ] 9.1 Implement log sanitization middleware
    - Create `src/nightscore/logging/log-sanitizer.ts`
    - Ensure no raw wallet signals, normalized vectors, or credit grades appear in logs
    - Only allow: operation status, timestamps, and wallet address hashes
    - Integrate with existing logging infrastructure
    - _Requirements: 9.7_

  - [ ]* 9.2 Write property test for log sanitization
    - **Property 15: Log Sanitization**
    - For any scoring payload, log output contains no signal values, vectors, or grades
    - Use fast-check with random scoring payloads, inspect log output
    - **Validates: Requirements 9.7**

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement Backend API routes
  - [ ] 11.1 Implement scoring request API endpoint
    - Create `src/nightscore/api/score-request.ts`
    - POST `/api/score/request`: validate authenticated session → check cache → read signals via witness → compute grade → mint credential → return result
    - Wire together: wallet service, cache, scoring engine, credential minting
    - Require valid Lace wallet session (reject unauthenticated with access-denied)
    - _Requirements: 2.1, 3.1, 3.6, 4.1, 7.2, 9.6_

  - [ ] 11.2 Implement threshold verification API endpoint
    - Create `src/nightscore/api/verify-threshold.ts`
    - POST `/api/verify/threshold`: accept wallet address + min grade → call Compact contract → return boolean
    - Validate grade input (reject invalid grades)
    - Log query timestamp and querying address (not the result) to verification_log
    - Return "no credential found" for wallets without active credential
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 11.3 Implement wallet session API endpoint
    - Create `src/nightscore/api/wallet-session.ts`
    - POST `/api/wallet/session`: validate wallet connection, create/destroy session
    - Enforce HTTPS + TLS 1.2+ requirement
    - _Requirements: 1.1, 9.3, 9.6_

  - [ ]* 11.4 Write unit tests for API endpoints
    - Test scoring request: cache hit path, cache miss path, unauthenticated rejection
    - Test threshold verification: valid query, invalid grade, no credential
    - Test wallet session: create, destroy, validation
    - _Requirements: 3.5, 3.6, 3.8, 5.4, 5.6, 9.6_

- [ ] 12. Implement Frontend React components
  - [ ] 12.1 Create landing page and wallet connector components
    - Create `src/nightscore/frontend/components/LandingPage.tsx`
    - Create `src/nightscore/frontend/components/WalletConnector.tsx`
    - Landing page: project description, "Connect Wallet" button, navigation to Verification Portal
    - WalletConnector: initiate connection, show truncated address on success, handle errors (timeout, rejection, extension not found)
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 6.1_

  - [ ] 12.2 Create dashboard and score request flow components
    - Create `src/nightscore/frontend/components/Dashboard.tsx`
    - Create `src/nightscore/frontend/components/ScoreRequestFlow.tsx`
    - Create `src/nightscore/frontend/components/GradeBadge.tsx`
    - Dashboard: display current grade (or placeholder), credential status, reasoning breakdown
    - ScoreRequestFlow: progress indicator showing current step (reading signals → computing grade → minting credential)
    - GradeBadge: color-coded badge using grade-to-color utility
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 12.3 Create Verification Portal component
    - Create `src/nightscore/frontend/components/VerificationPortal.tsx`
    - Public interface: input wallet address + minimum grade → submit threshold query → display boolean result
    - Handle error states: invalid grade, no credential found
    - _Requirements: 5.1, 5.3, 6.1_

  - [ ] 12.4 Implement frontend state management
    - Create `src/nightscore/frontend/state/app-state.ts`
    - Implement AppState as defined in design: wallet state, scoring state, credential state
    - Wire state transitions: idle → reading_signals → computing_grade → minting → complete/error
    - Persist wallet connection state in sessionStorage
    - _Requirements: 1.5, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 12.5 Write unit tests for frontend components
    - Test landing page renders correctly with connect button
    - Test dashboard shows grade, credential status, reasoning
    - Test progress indicator step transitions
    - Test error display and retry behavior
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Integration wiring and deployment configuration
  - [ ] 14.1 Wire end-to-end scoring workflow
    - Create `src/nightscore/workflow/scoring-workflow.ts`
    - Orchestrate full flow: authenticate → check cache → read signals (Compact witness) → validate → score (Groq) → mint credential → return result
    - Implement graceful degradation: cache down → proceed without; Groq down → service unavailable; partial signals → default 0.5
    - Ensure signal vector discarded from memory after grade computation
    - _Requirements: 2.1, 2.2, 2.5, 3.1, 3.5, 3.6, 4.1, 7.5, 9.1_

  - [ ] 14.2 Configure Vercel deployment and environment
    - Create `vercel.json` with API routes configuration
    - Set up environment variables: GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MIDNIGHT_RPC_URL
    - Configure HTTPS enforcement
    - _Requirements: 6.7, 8.2, 9.3_

  - [ ] 14.3 Set up GitHub Actions CI/CD pipeline
    - Create `.github/workflows/ci.yml`
    - Pipeline stages: lint + type check → unit tests + property tests → integration tests → build + deploy
    - Configure Vitest with fast-check for property tests
    - Minimum one end-to-end test in pipeline
    - _Requirements: 8.3_

  - [ ] 14.4 Create README and documentation
    - Create comprehensive README with: project overview, architecture diagram (Mermaid), setup instructions (< 15 min), deployment guide (Vercel + Midnight Preprod)
    - Add inline documentation to all Compact contract functions (purpose, parameters, privacy implications)
    - Create CHANGELOG with Level 1 entry
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript with Vitest for testing and fast-check for property-based testing
- Compact contract code uses the Midnight Compact language (not TypeScript) but orchestration is in TypeScript
- Supabase PostgreSQL is used for caching with row-level security
- Frontend deploys to Vercel; on-chain components deploy to Midnight Preprod (Levels 1-5) then Mainnet (Level 6)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.7", "2.1", "2.3"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.5", "4.1", "5.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "5.2"] },
    { "id": 5, "tasks": ["5.3", "5.4", "7.1", "8.1", "9.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "8.2", "8.3", "8.4", "8.5", "9.2"] },
    { "id": 7, "tasks": ["11.1", "11.2", "11.3", "12.1", "12.4"] },
    { "id": 8, "tasks": ["11.4", "12.2", "12.3"] },
    { "id": 9, "tasks": ["12.5", "14.1"] },
    { "id": 10, "tasks": ["14.2", "14.3", "14.4"] }
  ]
}
```
