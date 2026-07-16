# Requirements Document

## Introduction

NIGHTSCORE is a private on-chain credit scoring system that combines AI-driven credit assessment with Zero-Knowledge proofs on the Midnight blockchain. The system enables DeFi users to obtain verifiable, privacy-preserving credit scores without exposing sensitive financial data. Users connect their Lace wallet, the system reads on-chain signals privately via a Compact witness, an AI model computes a credit grade, and a ZK credential NFT is minted on-chain containing only the grade. Lending protocols can then query threshold-based questions ("Is this wallet grade A or above?") without learning the actual score or underlying data.

The project follows the "New Moon to Full: Monthly Moonshots on Midnight" hackathon structure with six progressive levels from basic contract deployment through mainnet launch.

## Glossary

- **NIGHTSCORE_System**: The complete application encompassing frontend, AI scoring engine, ZK proof generation, and on-chain credential management
- **Compact_Contract**: A smart contract written in Midnight's Compact language that manages credential minting and threshold verification on-chain
- **Compact_Witness**: An off-chain computation module in the Compact language that privately reads wallet signals and provides inputs to the scoring engine without exposing raw data on-chain
- **Credit_Grade**: A categorical credit assessment with values AAA, AA, A, BBB, BB, or C, representing creditworthiness from highest to lowest
- **ZK_Credential**: A Zero-Knowledge proof-backed NFT minted on Midnight that attests to a wallet's credit grade without revealing underlying data
- **Lace_Wallet**: The Midnight-compatible browser wallet used for user authentication and transaction signing
- **Scoring_Engine**: The off-chain AI component (Groq API with Llama 3.3 70B) that computes credit grades based on wallet signals
- **Wallet_Signals**: On-chain data points including wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, and liquidation history
- **Threshold_Query**: A verification request asking whether a wallet's credit grade meets or exceeds a specified minimum grade
- **Verification_Portal**: The public-facing interface allowing lending protocols to query wallet creditworthiness via threshold queries
- **Proof_Hash**: A cryptographic hash of the scoring inputs combined with the resulting grade, stored on-chain to prove computation integrity
- **Midnight_Preprod**: The Midnight blockchain pre-production testnet environment used for development and testing (Levels 1-5)
- **Midnight_Mainnet**: The Midnight blockchain production environment used for final deployment (Level 6)
- **Bricktower_Server**: The community ZK proof server used for proof generation on the Midnight testnet
- **Request_Cache**: A Supabase PostgreSQL database layer that caches scoring requests to avoid redundant AI API calls

## Requirements

### Requirement 1: Wallet Connection and Authentication

**User Story:** As a DeFi user, I want to connect my Lace wallet to NIGHTSCORE, so that I can authenticate my identity and initiate credit scoring.

#### Acceptance Criteria

1. WHEN a user clicks the "Connect Wallet" button, THE NIGHTSCORE_System SHALL initiate the Lace_Wallet connection flow via the Midnight wallet API
2. WHEN the Lace_Wallet connection is established, THE NIGHTSCORE_System SHALL display the connected wallet address (truncated to first 6 and last 4 characters) in the dashboard header
3. IF the Lace_Wallet connection fails, is rejected by the user, or does not respond within 30 seconds, THEN THE NIGHTSCORE_System SHALL display an error message indicating the connection was unsuccessful and provide a retry option
4. WHEN the user disconnects the Lace_Wallet, THE NIGHTSCORE_System SHALL clear all session data and return to the unauthenticated landing page
5. THE NIGHTSCORE_System SHALL persist the wallet connection state across page refreshes within the same browser session
6. IF the Lace_Wallet browser extension is not detected, THEN THE NIGHTSCORE_System SHALL display a message directing the user to install the Lace wallet extension with a link to the official download page

### Requirement 2: Private Wallet Signal Reading

**User Story:** As a DeFi user, I want my wallet activity to be read privately, so that my financial data is never exposed publicly while still contributing to my credit score.

#### Acceptance Criteria

1. WHEN a score request is initiated, THE Compact_Witness SHALL read the following Wallet_Signals from the connected wallet over the most recent 12 months of on-chain history: wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, and liquidation history
2. THE Compact_Witness SHALL process all Wallet_Signals off-chain without transmitting individual signal values, wallet addresses, or transaction details to any on-chain storage
3. IF the Compact_Witness cannot read one or more Wallet_Signals due to fewer than 3 relevant on-chain transactions for that signal category, THEN THE Compact_Witness SHALL assign a default value of 0.5 on a 0.0 to 1.0 normalized scale for each unavailable signal and flag those signals as estimated in the signal vector metadata
4. THE Compact_Witness SHALL produce a normalized signal vector with each signal value mapped to a 0.0 to 1.0 scale as input to the Scoring_Engine within 5 seconds of the score request initiation
5. IF the wallet connection becomes unavailable during signal reading, THEN THE Compact_Witness SHALL abort the score request and return an error indication specifying which signals were not retrieved

### Requirement 3: AI Credit Scoring

**User Story:** As a DeFi user, I want an AI-powered credit assessment, so that I receive a fair and explainable credit grade based on my on-chain activity.

#### Acceptance Criteria

1. WHEN the Compact_Witness provides a normalized signal vector, THE Scoring_Engine SHALL compute a Credit_Grade from the set {AAA, AA, A, BBB, BB, C}
2. WHEN the Scoring_Engine computes a Credit_Grade, THE Scoring_Engine SHALL produce a reasoning breakdown that lists each Wallet_Signal from the input vector along with its individual contribution direction (positive or negative) and relative weight toward the final Credit_Grade
3. THE Scoring_Engine SHALL complete the grade computation within 2 seconds of receiving the normalized signal vector
4. THE Scoring_Engine SHALL apply deterministic scoring thresholds so that identical signal vectors always produce the same Credit_Grade
5. IF the Groq API does not respond within 5 seconds or returns an error, THEN THE Scoring_Engine SHALL return a service-unavailable status to the user without assigning a default grade
6. WHEN a scoring request matches a cached result in the Request_Cache (same wallet address within the last 24 hours), THE Scoring_Engine SHALL return the cached Credit_Grade and reasoning without invoking the Groq API
7. IF the normalized signal vector is missing one or more required Wallet_Signals or contains values outside the expected normalized range (0.0 to 1.0), THEN THE Scoring_Engine SHALL reject the request and return an error indication specifying which signals are missing or out of range
8. IF the Groq API daily rate limit (14,400 requests per day) has been reached, THEN THE Scoring_Engine SHALL return a rate-limit-exceeded status to the user without assigning a default grade

### Requirement 4: ZK Credential Minting

**User Story:** As a DeFi user, I want my credit grade minted as a ZK credential NFT, so that I can prove my creditworthiness to lending protocols without revealing my financial details.

#### Acceptance Criteria

1. WHEN the Scoring_Engine produces a Credit_Grade, THE Compact_Contract SHALL mint a ZK_Credential NFT bound to the requesting wallet address on Midnight_Preprod
2. THE Compact_Contract SHALL store only the Credit_Grade and the Proof_Hash on-chain, with no raw Wallet_Signals or scoring details
3. THE Compact_Contract SHALL generate the Proof_Hash as a cryptographic hash of the normalized signal vector concatenated with the Credit_Grade
4. IF a ZK_Credential already exists for the requesting wallet, THEN THE Compact_Contract SHALL revoke the previous credential and mint a new one with the updated Credit_Grade
5. WHEN the ZK_Credential is minted, THE NIGHTSCORE_System SHALL display the credential details (grade, mint timestamp, transaction hash) in the user dashboard
6. IF the minting transaction fails due to network issues or insufficient funds, THEN THE NIGHTSCORE_System SHALL notify the user of the failure and provide a retry option with a maximum of 3 automatic retry attempts before requiring manual user action
7. IF the minting transaction does not confirm within 60 seconds, THEN THE NIGHTSCORE_System SHALL mark the minting as timed out and offer the user the option to retry or cancel
8. THE ZK_Credential SHALL be non-transferable (soulbound) and queryable only through the Compact_Contract's threshold verification interface

### Requirement 5: Threshold-Based Verification

**User Story:** As a lending protocol operator, I want to query whether a wallet meets a minimum credit grade, so that I can make lending decisions without accessing the borrower's full credit profile.

#### Acceptance Criteria

1. WHEN a Threshold_Query is submitted with a wallet address and a minimum Credit_Grade, THE Compact_Contract SHALL return a boolean response (YES or NO) indicating whether the wallet's ZK_Credential meets or exceeds the specified grade within 3 seconds of query submission
2. THE Compact_Contract SHALL evaluate the Threshold_Query using the grade ordering: AAA > AA > A > BBB > BB > C
3. THE Compact_Contract SHALL disclose only the boolean result to the querying party, revealing neither the actual Credit_Grade nor any Wallet_Signals
4. IF the queried wallet does not have a ZK_Credential or its ZK_Credential has been revoked and not yet replaced, THEN THE Compact_Contract SHALL return a "no credential found" response without indicating whether a credential previously existed
5. WHEN a Threshold_Query is processed, THE Verification_Portal SHALL log the query timestamp and querying address (but not the result) for audit purposes, retaining logs for a minimum of 90 days
6. IF a Threshold_Query is submitted with a minimum Credit_Grade value not in the set {AAA, AA, A, BBB, BB, C}, THEN THE Compact_Contract SHALL reject the query and return an error response indicating an invalid grade was specified

### Requirement 6: Frontend Dashboard

**User Story:** As a DeFi user, I want an intuitive dashboard, so that I can request scores, view my credentials, and understand my credit profile at a glance.

#### Acceptance Criteria

1. THE NIGHTSCORE_System SHALL display a landing page with project description, "Connect Wallet" button, and navigation to the Verification_Portal
2. WHILE the user is authenticated, THE NIGHTSCORE_System SHALL display a dashboard containing: a "Request Score" button, current Credit_Grade (if exists) or a placeholder indicating no score has been generated yet, credential status (one of: not minted, minting in progress, minted, or expired), and scoring reasoning breakdown
3. WHEN the user clicks "Request Score", THE NIGHTSCORE_System SHALL initiate the scoring workflow and display a progress indicator showing the current step (reading signals, computing grade, minting credential)
4. WHEN the scoring workflow completes successfully, THE NIGHTSCORE_System SHALL dismiss the progress indicator and display the updated Credit_Grade, credential status, and scoring reasoning breakdown on the dashboard
5. IF the scoring workflow fails at any step, THEN THE NIGHTSCORE_System SHALL dismiss the progress indicator, display an error message indicating which step failed, and retain any previously displayed Credit_Grade and credential status
6. THE NIGHTSCORE_System SHALL render the Credit_Grade using a visual indicator (color-coded badge) where AAA-A grades use green tones, BBB uses yellow, and BB-C use red tones
7. THE NIGHTSCORE_System SHALL be deployed on Vercel and accessible via HTTPS

### Requirement 7: Request Caching

**User Story:** As a system operator, I want scoring requests cached, so that the system conserves Groq API quota and provides faster responses for repeat requests.

#### Acceptance Criteria

1. WHEN a Credit_Grade is computed for a wallet, THE Request_Cache SHALL store the wallet address, normalized signal vector hash, Credit_Grade, reasoning breakdown, and computation timestamp
2. IF a scoring request is received for a wallet address with a cached entry whose normalized signal vector hash matches the current request and whose computation timestamp is less than 24 hours old, THEN THE NIGHTSCORE_System SHALL return the cached Credit_Grade and reasoning breakdown without invoking the Scoring_Engine
3. IF a scoring request is received for a wallet address with no cached entry, or whose cached entry has a non-matching signal vector hash, or whose computation timestamp is 24 hours old or older, THEN THE NIGHTSCORE_System SHALL treat the request as new and invoke the full scoring workflow
4. THE Request_Cache SHALL store data in Supabase PostgreSQL with row-level security ensuring only the NIGHTSCORE_System service role can read or write cache entries
5. IF the Request_Cache is unreachable or a cache read/write operation fails, THEN THE NIGHTSCORE_System SHALL proceed with the full scoring workflow as if no cache entry exists and SHALL log the cache failure for operational monitoring

### Requirement 8: Progressive Level Deployment

**User Story:** As a hackathon participant, I want the system to be built incrementally across levels, so that each submission meets the specific level requirements and demonstrates meaningful progress.

#### Acceptance Criteria

1. WHILE at Level 1 (New Moon), THE Compact_Contract SHALL support manual grade setting (integer values from 0 to 100) and wallet connection (connect and disconnect via Lace_Wallet) on Midnight_Preprod
2. WHILE at Level 2 (Waxing Crescent), THE NIGHTSCORE_System SHALL provide the React frontend deployed on Vercel with Lace_Wallet connection, display of the connected wallet address, and a "Request Score" button that returns a score (hardcoded values are acceptable at this level)
3. WHILE at Level 3 (First Quarter), THE NIGHTSCORE_System SHALL implement dynamic AI scoring via the Scoring_Engine (producing scores derived from input data rather than hardcoded values), Compact_Witness-based private signal reading, and automated tests with a minimum of one passing end-to-end test executed via GitHub Actions CI/CD pipeline
4. WHILE at Level 4 (Waxing Gibbous), THE NIGHTSCORE_System SHALL provide an integrated deployment on Midnight_Preprod where a user can request a score, view the resulting credential, and verify the credential through the Verification_Portal without manual intervention
5. WHILE at Level 5 (Full Moon), THE NIGHTSCORE_System SHALL support onboarding of at least 50 Preprod users, each completing the onboarding flow and receiving a credential, with a feedback collection form capturing at least one response per user, and an analytics dashboard displaying total users onboarded, scores issued, and credentials verified
6. WHILE at Level 6 (Supermoon), THE NIGHTSCORE_System SHALL be deployed to Midnight_Mainnet with at least 20 distinct non-team-member users each holding at least one minted credential
7. IF a level submission is made without all preceding levels' acceptance criteria being met, THEN THE NIGHTSCORE_System submission SHALL be considered ineligible for that level's evaluation
8. IF the system is submitted for Level 5 or Level 6 evaluation, THEN THE NIGHTSCORE_System SHALL include evidence of a completed Mentor & Market Fit Checkpoint (documented mentor sign-off or review record)

### Requirement 9: Security and Privacy

**User Story:** As a DeFi user, I want my financial data protected at every layer, so that my privacy is preserved throughout the scoring and verification process.

#### Acceptance Criteria

1. THE NIGHTSCORE_System SHALL transmit no raw Wallet_Signals from the Compact_Witness to any external service other than the Scoring_Engine computation context, and THE Scoring_Engine SHALL discard the normalized signal vector from memory upon completion of grade computation
2. WHEN a Threshold_Query is processed, THE Compact_Contract SHALL use Midnight's disclose() model to reveal only the boolean query result (YES or NO), withholding the actual Credit_Grade, Proof_Hash internals, and all Wallet_Signals from the querying party
3. THE NIGHTSCORE_System SHALL communicate between the frontend and backend exclusively over HTTPS with TLS 1.2 or higher
4. IF an unauthorized party attempts to query the Compact_Contract directly (bypassing the Verification_Portal), THEN THE Compact_Contract SHALL disclose only the boolean threshold result and withhold the actual Credit_Grade and all Wallet_Signals, identical to portal-based queries
5. THE Request_Cache SHALL store only hashed signal vectors, never raw Wallet_Signals, in the Supabase database
6. THE NIGHTSCORE_System SHALL require a valid authenticated session (connected Lace_Wallet) before accepting any scoring request on backend API endpoints, rejecting unauthenticated requests with an access-denied response
7. THE NIGHTSCORE_System SHALL exclude raw Wallet_Signals, normalized signal vectors, and Credit_Grade values from all application logs, limiting log entries to operation status, timestamps, and wallet address hashes

### Requirement 10: Documentation and Ecosystem Fit

**User Story:** As a hackathon judge, I want comprehensive documentation demonstrating how NIGHTSCORE fills a gap in the Midnight ecosystem, so that I can evaluate the project's technical quality and relevance.

#### Acceptance Criteria

1. THE NIGHTSCORE_System SHALL include a README with project overview, architecture diagram (visual or Mermaid syntax), setup instructions that enable a new developer to run the project locally within 15 minutes, and a deployment guide covering Vercel and Midnight Preprod
2. THE NIGHTSCORE_System SHALL include inline code documentation for all Compact contracts and witness functions, with each exported function containing a description of its purpose, parameters, and privacy implications
3. THE NIGHTSCORE_System SHALL frame its functionality as "private credential issuance" and "ZK identity verification" aligned with Midnight's ecosystem problem list, with explicit references in the README and any pitch materials
4. THE NIGHTSCORE_System SHALL maintain a CHANGELOG documenting the evolution from Level 1 through the current level, with each entry specifying the level number, date, and summary of changes made
