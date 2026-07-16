# Requirements Document

## Introduction

The Adaptive Agents system is a modular agent architecture for NightScore that decomposes the credit scoring workflow into specialized, composable agents. Each agent handles a distinct responsibility (wallet connection, signal reading, scoring, credential minting, verification, caching, monitoring) and communicates through a unified message bus. The architecture supports runtime adaptability through configurable behavior profiles, feedback-driven parameter tuning, and a plugin registry that allows new agents to be added without modifying existing ones. As the project evolves from Level 1 through Level 6 of the hackathon, agents activate progressively based on the current deployment level.

## Glossary

- **Agent**: An autonomous software module with a defined input/output interface, a behavior profile, and a lifecycle (idle, active, error, disabled) that performs a specific responsibility within the NightScore workflow
- **Orchestrator_Agent**: The central coordination agent that receives workflow requests, determines which agents to invoke, routes messages between agents, and manages workflow state
- **Signal_Agent**: The agent responsible for invoking the Compact_Witness to read wallet signals and producing a normalized signal vector
- **Scoring_Agent**: The agent responsible for invoking the Groq API (Llama 3.3 70B) to compute a Credit_Grade from a normalized signal vector
- **Credential_Agent**: The agent responsible for invoking the Compact_Contract to mint, revoke, and manage ZK_Credential NFTs on Midnight
- **Verification_Agent**: The agent responsible for processing Threshold_Queries and returning boolean results through the Compact_Contract
- **Cache_Agent**: The agent responsible for managing the Supabase PostgreSQL Request_Cache, including storage, retrieval, and expiration of cached scoring results
- **Monitor_Agent**: The agent responsible for collecting metrics, logging events, detecting anomalies, and reporting system health across all agents
- **Wallet_Agent**: The agent responsible for managing Lace_Wallet connection state, session persistence, and wallet-related events
- **Agent_Registry**: A runtime catalog of all registered agents, their capabilities, health status, and configuration profiles
- **Message_Bus**: The internal communication layer through which agents exchange typed messages (requests, responses, events, errors)
- **Behavior_Profile**: A JSON configuration object defining an agent's parameters, thresholds, retry policies, and feature flags that can be updated at runtime without redeployment
- **Adaptation_Log**: A persistent record of configuration changes, performance metrics, and feedback events used by agents to inform parameter adjustments
- **Agent_Plugin**: A conformant module implementing the Agent interface that can be registered at runtime to extend system capabilities
- **Workflow_Context**: A shared state object passed through the agent pipeline containing request metadata, intermediate results, and execution history for the current workflow run
- **Level_Gate**: A configuration flag indicating the current hackathon deployment level (1-6) that determines which agents and capabilities are active

## Requirements

### Requirement 1: Agent Registry and Lifecycle Management

**User Story:** As a system developer, I want a central registry that manages all agents and their lifecycles, so that I can add, remove, or update agents without affecting the rest of the system.

#### Acceptance Criteria

1. THE Agent_Registry SHALL maintain a catalog of all registered agents, storing for each agent: a unique identifier, display name, capability description, current lifecycle state (idle, active, error, or disabled), Behavior_Profile reference, and registration timestamp
2. WHEN a new Agent_Plugin is registered, THE Agent_Registry SHALL validate that the plugin implements the required Agent interface (handleMessage, getHealth, getCapabilities methods) before adding it to the catalog
3. IF an Agent_Plugin registration fails validation, THEN THE Agent_Registry SHALL reject the registration and return an error specifying which interface methods are missing or do not conform to the expected method signatures
4. WHEN an agent transitions between lifecycle states, THE Agent_Registry SHALL emit a state-change event on the Message_Bus containing the agent identifier, previous state, new state, and transition timestamp
5. THE Agent_Registry SHALL expose a query interface that returns a filtered list of agents by lifecycle state, capability type, or Level_Gate availability, returning an empty list when no agents match the specified filter criteria
6. WHEN the system starts, THE Agent_Registry SHALL load all agent configurations from the Behavior_Profile store and initialize each agent to the idle state within 30 seconds before the Orchestrator_Agent accepts workflow requests
7. WHEN an agent is unregistered, THE Agent_Registry SHALL transition the agent to the disabled state, emit a state-change event on the Message_Bus, and remove the agent entry from the catalog
8. WHEN an agent's Behavior_Profile or capability description is updated, THE Agent_Registry SHALL validate the updated configuration, apply the changes to the catalog entry, and emit a state-change event on the Message_Bus without requiring the agent to be re-registered
9. IF an agent fails to initialize during system startup, THEN THE Agent_Registry SHALL set that agent's lifecycle state to error, log the failure reason, and continue initializing the remaining agents

### Requirement 2: Message Bus Communication

**User Story:** As a system developer, I want agents to communicate through a typed message bus, so that agents remain decoupled and new agents can participate without modifying existing ones.

#### Acceptance Criteria

1. THE Message_Bus SHALL support four message types: Request (agent-to-agent invocation), Response (result of a request), Event (broadcast notification), and Error (failure indication with error code and description)
2. WHEN an agent publishes a message to the Message_Bus, THE Message_Bus SHALL route the message to all subscribed agents within 50 milliseconds under normal load (fewer than 100 concurrent messages)
3. THE Message_Bus SHALL enforce a typed message schema where each message contains: a unique message identifier, source agent identifier, target agent identifier (or broadcast flag), message type, payload conforming to the declared schema, correlation identifier for request-response pairing, and timestamp
4. IF a message fails schema validation, THEN THE Message_Bus SHALL reject the message, return a validation error to the sender, and not deliver it to any subscriber
5. WHEN a Request message is sent and no Response is received within the timeout specified in the sender's Behavior_Profile (default 30 seconds), THE Message_Bus SHALL deliver a timeout Error message to the requesting agent
6. THE Message_Bus SHALL support topic-based subscriptions where agents subscribe to specific message topics (e.g., "scoring.complete", "credential.minted") and receive only messages matching their subscriptions
7. THE Message_Bus SHALL persist undelivered messages for agents in error or disabled state, delivering them when the agent transitions back to active state, for a maximum retention period of 1 hour

### Requirement 3: Orchestrator Agent

**User Story:** As a DeFi user, I want a single entry point for credit scoring workflows, so that the complex multi-step process is handled automatically and reliably.

#### Acceptance Criteria

1. WHEN the Orchestrator_Agent receives a "request-score" workflow request, THE Orchestrator_Agent SHALL execute the following agent pipeline in sequence: Wallet_Agent (validate session) → Cache_Agent (check cache) → Signal_Agent (read signals) → Scoring_Agent (compute grade) → Credential_Agent (mint credential)
2. IF the Cache_Agent returns a cached result that has not exceeded its time-to-live, THEN THE Orchestrator_Agent SHALL skip the Signal_Agent, Scoring_Agent, and Credential_Agent steps and return the cached result directly
3. IF any agent in the pipeline does not respond within 30 seconds or returns an Error message, THEN THE Orchestrator_Agent SHALL halt the pipeline, record the failed step and reason (timeout or error details) in the Workflow_Context, and return a workflow-failed response indicating the failed step and failure reason
4. THE Orchestrator_Agent SHALL maintain a Workflow_Context object for each active workflow containing: workflow identifier, requesting wallet address, current pipeline step, intermediate results from completed steps, start timestamp, and step-level timing
5. WHEN a workflow completes (success or failure), THE Orchestrator_Agent SHALL publish a workflow-complete Event on the Message_Bus containing the workflow identifier, final status, total duration, and step-level timing breakdown
6. THE Orchestrator_Agent SHALL process a maximum of 10 concurrent workflows, queuing additional requests and processing them in FIFO order as capacity becomes available
7. IF the Orchestrator_Agent's workflow queue exceeds 50 pending requests, THEN THE Orchestrator_Agent SHALL reject new requests with a system-busy status until the queue drops below 40 pending requests
8. IF a workflow does not complete within 120 seconds from its start timestamp, THEN THE Orchestrator_Agent SHALL halt the pipeline at the current step, record a timeout failure in the Workflow_Context, and return a workflow-failed response indicating a workflow timeout

### Requirement 4: Wallet Agent

**User Story:** As a DeFi user, I want wallet connection managed by a dedicated agent, so that session state is handled consistently across all workflow steps.

#### Acceptance Criteria

1. WHEN the Wallet_Agent receives a "connect" request, THE Wallet_Agent SHALL initiate the Lace_Wallet connection via the Midnight wallet API and emit a "wallet.connected" event upon successful connection containing the wallet address within 30 seconds of the request
2. IF the Lace_Wallet connection attempt fails or does not complete within 30 seconds, THEN THE Wallet_Agent SHALL emit a "wallet.connection_failed" event containing an error indication describing the failure reason, and transition its state to idle
3. WHEN the Wallet_Agent receives a "validate-session" request, THE Wallet_Agent SHALL verify the Lace_Wallet connection is active and return the wallet address if valid, or return an error indicating whether the session has expired or been disconnected
4. IF the Lace_Wallet connection drops unexpectedly, THEN THE Wallet_Agent SHALL emit a "wallet.disconnected" event on the Message_Bus and transition its state to idle
5. THE Wallet_Agent SHALL persist wallet connection state in browser session storage so that upon page refresh the Wallet_Agent automatically re-establishes the Lace_Wallet connection without requiring a new user-initiated "connect" request
6. WHEN the Wallet_Agent receives a "disconnect" request, THE Wallet_Agent SHALL clear all session data from browser session storage, invoke the Lace_Wallet disconnect method, and emit a "wallet.disconnected" event

### Requirement 5: Signal Agent

**User Story:** As a system developer, I want signal reading encapsulated in a dedicated agent, so that changes to how signals are read do not affect scoring or minting logic.

#### Acceptance Criteria

1. WHEN the Signal_Agent receives a "read-signals" request with a wallet address, THE Signal_Agent SHALL invoke the Compact_Witness to read wallet signals and return a normalized signal vector containing exactly 6 signal values (wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, and liquidation history), each in the range 0.0 to 1.0, within 5 seconds
2. IF the Compact_Witness cannot read one or more signals due to insufficient on-chain data (fewer than 3 transactions for a signal category), THEN THE Signal_Agent SHALL assign a default value of 0.5 for each unavailable signal and include a flag array indicating which signals are estimated
3. IF the wallet connection becomes unavailable during signal reading, THEN THE Signal_Agent SHALL abort the operation, discard any partially-read signal data, and return an error specifying which signals were successfully retrieved and which were not
4. THE Signal_Agent SHALL normalize signals using the normalization parameters defined in its Behavior_Profile, allowing threshold adjustments without code changes
5. WHEN the Signal_Agent completes signal reading, THE Signal_Agent SHALL publish a "signals.read" event containing the signal vector hash (not the raw signals) for monitoring purposes
6. IF the Signal_Agent receives a "read-signals" request with a wallet address that does not correspond to a connected and active wallet session, THEN THE Signal_Agent SHALL reject the request with an invalid-wallet error without invoking the Compact_Witness

### Requirement 6: Scoring Agent

**User Story:** As a system developer, I want AI scoring isolated in its own agent, so that the model, provider, or scoring logic can be swapped without impacting the rest of the pipeline.

#### Acceptance Criteria

1. WHEN the Scoring_Agent receives a "compute-grade" request with a normalized signal vector, THE Scoring_Agent SHALL invoke the Groq API (Llama 3.3 70B) and return a Credit_Grade from the set {AAA, AA, A, BBB, BB, C} along with a reasoning breakdown listing each of the 6 Wallet_Signals (wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, liquidation history) with its contribution direction (positive or negative) and relative weight toward the final grade, within 2 seconds
2. IF the Groq API does not respond within the timeout specified in the Scoring_Agent's Behavior_Profile (default 5 seconds), THEN THE Scoring_Agent SHALL return a service-unavailable error without assigning a default grade
3. IF the Groq API daily rate limit (14,400 requests per UTC calendar day) has been reached, THEN THE Scoring_Agent SHALL return a rate-limit-exceeded error and publish a "scoring.rate-limited" event on the Message_Bus
4. THE Scoring_Agent SHALL read its model identifier, temperature, prompt template, and scoring thresholds from its Behavior_Profile, allowing model or provider changes through configuration updates without code redeployment
5. THE Scoring_Agent SHALL apply deterministic scoring by setting the LLM temperature parameter to 0 and applying numeric scoring thresholds from the Behavior_Profile to the model output, so that identical signal vectors always produce the same Credit_Grade regardless of when the request is processed
6. IF the normalized signal vector contains values outside the 0.0 to 1.0 range or is missing any of the 6 required Wallet_Signals (wallet age, transaction frequency, DeFi interactions, repayment history, asset diversity, liquidation history), THEN THE Scoring_Agent SHALL reject the request with a validation error specifying which signals are invalid or missing
7. IF the Groq API returns a response that cannot be parsed into a valid Credit_Grade from the set {AAA, AA, A, BBB, BB, C}, THEN THE Scoring_Agent SHALL discard the response, return a scoring-parse-error to the caller without assigning a default grade, and publish a "scoring.parse-failed" event on the Message_Bus

### Requirement 7: Credential Agent

**User Story:** As a DeFi user, I want credential minting managed by a dedicated agent, so that on-chain interactions are isolated and retryable independent of scoring logic.

#### Acceptance Criteria

1. WHEN the Credential_Agent receives a "mint-credential" request with a wallet address, Credit_Grade, and signal vector hash, THE Credential_Agent SHALL invoke the Compact_Contract to mint a ZK_Credential NFT on Midnight_Preprod
2. IF a ZK_Credential already exists for the wallet, THEN THE Credential_Agent SHALL revoke the existing credential before minting a new one; IF the revocation transaction fails after exhausting the retry policy defined in the Behavior_Profile (default 3 retries), THEN THE Credential_Agent SHALL abort the minting workflow and return a revocation-failed error without minting a new credential
3. THE Credential_Agent SHALL store only the Credit_Grade and Proof_Hash on-chain, transmitting no raw signal data to the contract
4. IF the minting transaction fails, THEN THE Credential_Agent SHALL retry up to the maximum retry count specified in its Behavior_Profile (default 3 retries) with exponential backoff (1 second, 2 seconds, 4 seconds) before returning a minting-failed error
5. IF the minting transaction does not confirm within 60 seconds, THEN THE Credential_Agent SHALL mark the operation as timed out and return a timeout error
6. WHEN minting succeeds, THE Credential_Agent SHALL publish a "credential.minted" event containing the transaction hash, Credit_Grade, and mint timestamp
7. IF the "mint-credential" request is missing the wallet address, Credit_Grade, or signal vector hash, or the Credit_Grade value is not in the set {AAA, AA, A, BBB, BB, C}, THEN THE Credential_Agent SHALL reject the request and return a validation error specifying which fields are missing or invalid without invoking the Compact_Contract

### Requirement 8: Verification Agent

**User Story:** As a lending protocol operator, I want threshold verification handled by a dedicated agent, so that verification logic is independent of the scoring pipeline and can be queried at any time.

#### Acceptance Criteria

1. WHEN the Verification_Agent receives a "verify-threshold" request with a wallet address and minimum Credit_Grade, THE Verification_Agent SHALL invoke the Compact_Contract and return a boolean result (YES if the wallet's current Credit_Grade is equal to or higher than the minimum Credit_Grade per the grade ordering, NO otherwise) within 3 seconds measured from request receipt to response delivery
2. THE Verification_Agent SHALL evaluate thresholds using the grade ordering from highest to lowest: AAA > AA > A > BBB > BB > C, where YES is returned if and only if the wallet's Credit_Grade is at the same position or a higher position than the requested minimum
3. THE Verification_Agent SHALL disclose only the boolean result, revealing neither the actual Credit_Grade nor any wallet signals to the querying party
4. IF the queried wallet has no ZK_Credential or its credential has been revoked, THEN THE Verification_Agent SHALL return a "no credential found" response without indicating whether a credential previously existed
5. IF the minimum Credit_Grade value is not in the set {AAA, AA, A, BBB, BB, C}, THEN THE Verification_Agent SHALL reject the query with an invalid-grade error
6. IF the wallet address is empty or does not conform to the expected address format, THEN THE Verification_Agent SHALL reject the query with an invalid-address error without invoking the Compact_Contract
7. IF the Compact_Contract is unreachable or fails to respond within 2 seconds, THEN THE Verification_Agent SHALL return a temporary-unavailable error to the querying party and SHALL NOT cache or assume any grade result
8. WHEN a threshold query is processed, THE Verification_Agent SHALL publish a "verification.queried" event containing the query timestamp in ISO 8601 format and querying address (but not the result or the queried wallet address) for audit purposes

### Requirement 9: Cache Agent

**User Story:** As a system operator, I want caching managed by a dedicated agent, so that cache strategy can be tuned independently and cache failures do not break the scoring workflow.

#### Acceptance Criteria

1. WHEN the Cache_Agent receives a "check-cache" request with a wallet address and signal vector hash, THE Cache_Agent SHALL query the Request_Cache in Supabase and return the cached Credit_Grade and reasoning if a valid entry exists (matching hash, computation timestamp less than the TTL specified in its Behavior_Profile, default 24 hours), ignoring any expired entries as if they do not exist
2. IF no valid cache entry exists for the given wallet address and signal vector hash, THEN THE Cache_Agent SHALL return a cache-miss response containing the original wallet address and signal vector hash so the Orchestrator_Agent can proceed with the full scoring workflow
3. WHEN the Cache_Agent receives a "store-result" request containing a wallet address, signal vector hash, Credit_Grade, reasoning breakdown, and computation timestamp, THE Cache_Agent SHALL write the entry to the Request_Cache, overwriting any existing entry for the same wallet address
4. IF a "store-result" request is missing any required field (wallet address, signal vector hash, Credit_Grade, reasoning breakdown, or computation timestamp), THEN THE Cache_Agent SHALL reject the request and return a validation error specifying which fields are missing
5. IF the Request_Cache is unreachable or a read/write operation fails after the maximum retry attempts specified in the Behavior_Profile (default 2 retries with 500 millisecond delay between attempts), THEN THE Cache_Agent SHALL return a cache-unavailable response (not an error that halts the workflow) and publish a "cache.failure" event on the Message_Bus containing the operation type (read or write) and failure timestamp
6. THE Cache_Agent SHALL read its TTL duration, connection pool size (between 1 and 20 connections), maximum retry attempts, and retry delay from its Behavior_Profile, allowing cache strategy changes without code redeployment
7. THE Cache_Agent SHALL enforce row-level security so that only the NIGHTSCORE service role can read or write cache entries

### Requirement 10: Monitor Agent

**User Story:** As a system operator, I want centralized monitoring across all agents, so that I can detect issues, track performance, and understand system behavior over time.

#### Acceptance Criteria

1. THE Monitor_Agent SHALL subscribe to all events on the Message_Bus and record each event's type, source agent, timestamp, and duration (computed from the elapsed time between a Request message and its correlated Response message) in the Adaptation_Log
2. THE Monitor_Agent SHALL compute and expose via a queryable metrics interface the following metrics per agent, updated at least every 10 seconds: request count (last 1 hour), average response time in milliseconds (last 1 hour), error count (last 1 hour), and current lifecycle state
3. WHEN an agent's error count exceeds the threshold specified in the Monitor_Agent's Behavior_Profile (default 5 errors in 10 minutes), THE Monitor_Agent SHALL publish an "alert.agent-degraded" event identifying the affected agent, the error count, and the time window in which the errors occurred
4. WHEN the Monitor_Agent detects that an agent has not responded to health checks for 3 consecutive intervals (each interval defined in Behavior_Profile, default 30 seconds), THE Monitor_Agent SHALL publish an "alert.agent-unresponsive" event and request the Orchestrator_Agent to route around the unresponsive agent
5. THE Monitor_Agent SHALL expose a health-check endpoint returning the aggregate system status determined by the following rules: "healthy" when all active agents are in the active lifecycle state with no unresolved alerts, "degraded" when at least one agent has an active "alert.agent-degraded" event or is in error state but the Orchestrator_Agent remains active, and "unhealthy" when the Orchestrator_Agent is in error or unresponsive state or more than half of the active agents are in error state
6. THE Monitor_Agent SHALL exclude raw wallet signals, signal vectors, and Credit_Grade values from all log entries, logging only operation status, timestamps, agent identifiers, and performance metrics
7. IF the Adaptation_Log is unreachable or a write operation fails, THEN THE Monitor_Agent SHALL continue monitoring and publishing alert events on the Message_Bus, buffer up to 500 log entries in memory, and publish a "monitor.log-unavailable" event for operator awareness

### Requirement 11: Behavior Profile and Adaptive Configuration

**User Story:** As a system developer, I want agents to adapt their behavior through configuration profiles, so that the system can be tuned, evolved, and improved without code changes.

#### Acceptance Criteria

1. THE NIGHTSCORE_System SHALL store each agent's Behavior_Profile as a JSON document in the Supabase database, containing: agent identifier, version number, parameter map (key-value pairs for thresholds, timeouts, retry counts, feature flags, with a maximum of 50 keys per profile), and last-modified timestamp
2. WHEN a Behavior_Profile is updated in the database, THE Agent_Registry SHALL notify the affected agent within 5 seconds; IF the agent is in active state, THEN THE agent SHALL apply the new parameters without requiring a restart or redeployment; IF the agent is in idle, error, or disabled state, THEN THE agent SHALL apply the new parameters upon its next transition to active state
3. THE NIGHTSCORE_System SHALL version each Behavior_Profile update, retaining the previous 10 versions so that a rollback can be performed by setting the active version to any retained version; WHEN a rollback is performed, THE NIGHTSCORE_System SHALL treat the rollback as a new version entry referencing the restored version's parameters
4. WHEN a Behavior_Profile change is applied, THE Monitor_Agent SHALL record the change in the Adaptation_Log with: agent identifier, previous parameter values, new parameter values, change timestamp, and change reason (provided by the operator)
5. THE NIGHTSCORE_System SHALL validate Behavior_Profile updates against a JSON schema specific to each agent before applying them; IF a validation failure occurs, THEN THE NIGHTSCORE_System SHALL reject the update and return an error containing: the field path(s) that failed validation, the constraint violated for each field, and the rejected value(s)
6. IF a Behavior_Profile update causes an agent's error rate to exceed the degraded threshold (as defined in the Monitor_Agent's Behavior_Profile, default 5 errors in 10 minutes) within 5 minutes of application, THEN THE Monitor_Agent SHALL publish an "alert.config-regression" event containing the agent identifier, the change details, the observed error rate, and a rollback recommendation referencing the previous version number
7. IF an agent receives a valid Behavior_Profile update but fails to apply the new parameters (due to internal initialization error or constraint conflict), THEN THE agent SHALL retain its previous parameters, transition to error state, and publish a "config.apply-failed" event on the Message_Bus containing the agent identifier, the rejected profile version, and the failure reason
8. IF two or more Behavior_Profile updates are submitted for the same agent concurrently, THEN THE NIGHTSCORE_System SHALL apply only the update with the latest timestamp, discarding earlier concurrent updates, and SHALL return a conflict indication to the discarded update's submitter

### Requirement 12: Adaptation Log and Learning from Changes

**User Story:** As a system developer, I want agents to track their performance history relative to configuration changes, so that the system can identify which parameter combinations produce better outcomes.

#### Acceptance Criteria

1. THE Adaptation_Log SHALL store for each entry: entry type (metric, config-change, feedback, anomaly), agent identifier, timestamp, payload data (metrics snapshot or change details) with a maximum payload size of 64 KB per entry, and correlation identifier linking related entries
2. WHEN a Behavior_Profile change is applied, THE Monitor_Agent SHALL record a baseline metrics snapshot (response time, error rate, throughput) for the affected agent within 5 seconds before the change is applied, and a comparison snapshot exactly 1 hour after the change, where "comparison snapshot" is the average of metrics collected during the final 5 minutes of the 1-hour window
3. IF a subsequent Behavior_Profile change is applied to the same agent within 1 hour of a prior change, THEN THE Monitor_Agent SHALL close the prior comparison window immediately, record the comparison snapshot at that point, and start a new baseline and comparison window for the subsequent change
4. THE NIGHTSCORE_System SHALL provide a query interface over the Adaptation_Log that filters by agent, entry type, time range, and correlation identifier, returning a maximum of 500 results per query ordered by timestamp
5. WHEN an operator queries the Adaptation_Log for a specific agent, THE NIGHTSCORE_System SHALL return a summary showing: current parameters, parameter change history (last 10 changes), and for each change the average response time and error rate during the 1 hour before and 1 hour after the change
6. THE Adaptation_Log SHALL retain entries for a minimum of 90 days before eligible for archival or deletion
7. WHEN the Monitor_Agent detects that an agent's error rate has decreased by 20% or more, measured as the average error rate over the full 24 hours following a config change compared to the average error rate over the 1 hour immediately before the change, THE Monitor_Agent SHALL publish a "learning.improvement-detected" event containing the change details and performance delta
8. IF metrics collection fails or is incomplete during a comparison window, THEN THE Monitor_Agent SHALL record the entry in the Adaptation_Log with a status of "incomplete", include the partial metrics collected, and omit the entry from improvement detection evaluation

### Requirement 13: Level-Gated Agent Activation

**User Story:** As a hackathon participant, I want agents to activate progressively based on the current deployment level, so that each level submission includes only the functionality required.

#### Acceptance Criteria

1. THE Agent_Registry SHALL read the current Level_Gate value (1 through 6) from the system Behavior_Profile at startup and after any Level_Gate configuration update
2. WHILE the Level_Gate is set to 1, THE Agent_Registry SHALL activate only the Wallet_Agent and Credential_Agent (with manual grade-setting capability)
3. WHILE the Level_Gate is set to 2, THE Agent_Registry SHALL activate the Wallet_Agent, Credential_Agent, Orchestrator_Agent, and a stub Scoring_Agent that returns hardcoded grades
4. WHILE the Level_Gate is set to 3, THE Agent_Registry SHALL activate all agents from Level 2 plus the Signal_Agent, the full Scoring_Agent (Groq API integration), Cache_Agent, and Monitor_Agent
5. WHILE the Level_Gate is set to 4 or higher, THE Agent_Registry SHALL activate all agents including the Verification_Agent
6. WHEN the Level_Gate value is updated, THE Agent_Registry SHALL activate or deactivate agents accordingly within 10 seconds, emitting state-change events for each affected agent
7. IF an agent receives a message while in the disabled state (due to Level_Gate restriction), THEN THE agent SHALL reject the message with a "not-available-at-current-level" error

### Requirement 14: Agent Plugin Interface

**User Story:** As a system developer, I want a standardized plugin interface, so that new agents can be created and integrated into the system without modifying the core architecture.

#### Acceptance Criteria

1. THE Agent interface SHALL define the following required methods: handleMessage (accepts a typed message conforming to the Message_Bus schema and returns a Response or Error message within 30 seconds), getHealth (returns current lifecycle state, uptime in seconds, request count, error count, and average response time in milliseconds for the last 1 hour), getCapabilities (returns a list of message topics the agent can handle), and initialize (accepts a Behavior_Profile and prepares the agent for operation within 10 seconds)
2. THE Agent interface SHALL define the following lifecycle hooks: onActivate (called when the agent transitions to active, must complete within 5 seconds), onDeactivate (called when the agent transitions to disabled or idle, must complete within 5 seconds), and onConfigUpdate (called when the Behavior_Profile changes, must complete within 5 seconds)
3. WHEN a new Agent_Plugin is developed, THE Agent_Plugin SHALL be registerable with the Agent_Registry by providing: a module implementing the Agent interface, a default Behavior_Profile JSON document, and a JSON schema defining valid Behavior_Profile parameters for that agent
4. THE NIGHTSCORE_System SHALL provide a TypeScript type definition package (@nightscore/agent-types) that exports the Agent interface, message types, Behavior_Profile schema, and utility types for agent development
5. WHEN an Agent_Plugin is registered at runtime, THE Agent_Registry SHALL make the plugin available for message routing within 5 seconds without requiring a system restart
6. THE Agent interface SHALL support an optional "dependencies" declaration listing other agent capabilities required for operation, and WHEN the Agent_Registry activates an agent with declared dependencies, THE Agent_Registry SHALL verify that each declared capability is provided by at least one agent currently in active or idle state before transitioning the dependent agent to active
7. IF an Agent_Plugin's initialize method throws an error or does not complete within 10 seconds, THEN THE Agent_Registry SHALL reject the registration, transition the plugin to the error lifecycle state, and emit a state-change event on the Message_Bus indicating the initialization failure reason
8. IF a new Agent_Plugin declares capabilities that overlap with an already-registered agent's capabilities, THEN THE Agent_Registry SHALL accept the registration and route messages for the overlapping topics to the most recently registered agent, emitting a "registry.capability-override" event identifying the overridden agent and affected topics
9. IF a dependency declared by an active agent becomes unsatisfiable (the providing agent transitions to error or disabled state), THEN THE Agent_Registry SHALL publish an "alert.dependency-unavailable" event and transition the dependent agent to idle state until the dependency is restored
