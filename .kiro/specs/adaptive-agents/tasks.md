# Implementation Plan: Adaptive Agents

## Overview

Decompose NightScore's credit scoring workflow into specialized, composable TypeScript agents communicating through an in-memory message bus. Implementation proceeds from core infrastructure (types, bus, registry) outward to individual agents, orchestration, configuration management, and monitoring — with property-based tests validating correctness properties throughout.

## Tasks

- [x] 1. Set up project structure and core type definitions
  - [x] 1.1 Create directory structure and install dependencies
    - Create `src/agents/`, `src/bus/`, `src/registry/`, `src/config/`, `src/log/`, `src/privacy/` directories
    - Install `fast-check`, `vitest`, `uuid` as dev/runtime dependencies
    - Configure Vitest for property and unit tests
    - Create `src/types/` directory with barrel exports
    - _Requirements: 14.4_

  - [x] 1.2 Define core Agent interface and type definitions
    - Create `src/types/agent.ts` with `Agent`, `AgentHealth`, `AgentCapability`, `AgentLifecycleState` interfaces
    - Create `src/types/messages.ts` with `BusMessage`, `RequestMessage`, `ResponseMessage`, `EventMessage`, `ErrorMessage`, `MessageBase` interfaces
    - Create `src/types/workflow.ts` with `WorkflowContext`, `PipelineStep`, `StepResult`, `WorkflowResult` interfaces
    - Create `src/types/config.ts` with `BehaviorProfile`, `BehaviorProfileStore`, `ValidationResult`, `ValidationError` interfaces
    - Create `src/types/log.ts` with `AdaptationLog`, `LogEntry`, `LogFilter`, `AgentChangeSummary` interfaces
    - Create `src/types/registry.ts` with `AgentRegistry`, `AgentFilter`, `AgentRegistryEntry`, `LevelGate` interfaces
    - Create `src/types/monitor.ts` with `MonitorMetrics`, `AgentMetricsSnapshot`, `SystemHealthStatus` interfaces
    - Create `src/types/index.ts` barrel export
    - _Requirements: 14.1, 14.2, 14.4_

- [x] 2. Implement Message Bus
  - [x] 2.1 Implement core Message Bus with pub/sub, schema validation, and topic routing
    - Create `src/bus/message-bus.ts` implementing `MessageBus` interface
    - Implement message schema validation (id, sourceAgentId, targetAgentId, type, correlationId, timestamp, topic, payload)
    - Implement `publish()` with validation and topic-based routing
    - Implement `subscribe()` and `unsubscribe()` for topic subscriptions
    - Implement `request()` with configurable timeout and correlation ID matching
    - Reject invalid messages with validation error, never deliver to subscribers
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [x] 2.2 Implement timeout handling and message persistence for inactive agents
    - Add timeout Error message delivery when no Response within configured timeout
    - Implement message buffering for agents in error/disabled state
    - Deliver buffered messages when agent transitions to active
    - Discard messages buffered longer than 1 hour
    - _Requirements: 2.5, 2.7_

  - [ ]* 2.3 Write property tests for Message Bus (Properties 4-7)
    - **Property 4: Message Schema Validation** — Generate random message objects with varied field presence/types, verify accept/reject behavior
    - **Property 5: Topic-Based Subscription Routing** — Generate random subscription sets × messages, verify delivery to exactly subscribed agents
    - **Property 6: Request Timeout Handling** — Generate random timeouts with no response, verify exactly one timeout Error with correct correlation ID
    - **Property 7: Message Persistence for Inactive Agents** — Generate random messages to inactive agents × state transitions, verify delivery on reactivation and discard after 1 hour
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7**

- [x] 3. Implement Agent Registry
  - [x] 3.1 Implement Agent Registry with registration, lifecycle, and query interface
    - Create `src/registry/agent-registry.ts` implementing `AgentRegistry` interface
    - Implement `register()` with interface validation (handleMessage, getHealth, getCapabilities, initialize)
    - Implement `unregister()` with state transition to disabled and event emission
    - Implement `queryAgents()` with filtering by state, capability, and level
    - Implement lifecycle state transitions with event emission on Message Bus
    - Emit state-change events containing agent ID, previous state, new state, and timestamp
    - Reject registration when required methods are missing, returning specific missing methods
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8_

  - [x] 3.2 Implement Level Gate and dependency management
    - Implement `setLevelGate()` activating/deactivating agents per level mapping (L1: Wallet+Credential, L2: +Orchestrator+StubScoring, L3: +Signal+FullScoring+Cache+Monitor, L4+: +Verification)
    - Implement dependency verification on activation (check declared capabilities are available)
    - Transition dependent agents to idle when dependency becomes unsatisfiable
    - Emit "registry.capability-override" event for overlapping capabilities
    - Route overlapping topics to most recently registered agent
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.6, 14.8, 14.9_

  - [x] 3.3 Implement startup initialization and profile loading
    - Load all agent configurations from Behavior Profile store on cold start
    - Initialize each agent to idle state within 30 seconds
    - Handle initialization failures (set to error, log reason, continue remaining)
    - Make registered plugins available for message routing within 5 seconds
    - _Requirements: 1.6, 1.9, 14.5, 14.7_

  - [ ]* 3.4 Write property tests for Agent Registry (Properties 1-3, 31-34)
    - **Property 1: Agent Interface Conformance Validation** — Generate objects with random subsets of required methods, verify accept/reject and error specificity
    - **Property 2: Lifecycle State-Change Event Integrity** — Generate random state transitions, verify exactly one event per transition with correct fields
    - **Property 3: Registry Query Filtering** — Generate random agent sets × filter combinations, verify exact match results
    - **Property 31: Level-Gated Agent Activation** — Test all 6 level values, verify correct agent activation sets
    - **Property 32: Disabled Agent Message Rejection** — Generate random messages to disabled agents, verify rejection with correct error
    - **Property 33: Dependency Verification on Activation** — Generate random dependency graphs × provider states, verify activation rules
    - **Property 34: Capability Override Routing** — Generate random registration order × overlapping capabilities, verify routing and events
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 13.2-13.5, 13.7, 14.6, 14.8, 14.9**

- [x] 4. Checkpoint - Core infrastructure complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Behavior Profile Store and Adaptation Log
  - [x] 5.1 Implement Behavior Profile Store with versioning and validation
    - Create `src/config/behavior-profile-store.ts` implementing `BehaviorProfileStore` interface
    - Implement `load()`, `save()` with Supabase persistence
    - Implement version retention (last 10 versions)
    - Implement `rollback()` creating new version entry with restored parameters
    - Implement `validate()` against agent-specific JSON schema returning field paths, constraints, and rejected values
    - Handle concurrent updates: apply latest timestamp, discard earlier, return conflict indication
    - Enforce max 50 keys per profile
    - _Requirements: 11.1, 11.3, 11.5, 11.8_

  - [x] 5.2 Implement hot-reload notification and config application
    - Implement polling/push notification for profile changes (notify within 5 seconds)
    - Apply new parameters to active agents without restart
    - Queue parameter application for idle/error/disabled agents (apply on next active transition)
    - Handle failed config application: retain previous params, transition to error, publish "config.apply-failed" event
    - _Requirements: 11.2, 11.7_

  - [x] 5.3 Implement Adaptation Log with storage, querying, and retention
    - Create `src/log/adaptation-log.ts` implementing `AdaptationLog` interface
    - Implement `write()` with entry type, agent ID, timestamp, payload (max 64KB), correlation ID, status
    - Implement `query()` with filtering by agent, type, time range, correlation ID (max 500 results, ordered by timestamp)
    - Implement `getAgentSummary()` returning current parameters, change history (last 10), before/after metrics
    - Enforce 90-day minimum retention
    - _Requirements: 12.1, 12.4, 12.5, 12.6_

  - [ ]* 5.4 Write property tests for Behavior Profile and Adaptation Log (Properties 25, 26, 28, 29, 30)
    - **Property 25: Behavior Profile Version Retention** — Generate random update sequences, verify last 10 versions retained, rollback creates new version
    - **Property 26: Profile Schema Validation** — Generate random profile objects vs schemas, verify validation and error detail
    - **Property 28: Failed Config Apply Retains Previous State** — Generate random failing applications, verify state retention and error events
    - **Property 29: Concurrent Profile Update Resolution** — Generate pairs of concurrent updates, verify latest-timestamp wins and conflict returned
    - **Property 30: Adaptation Log Query Filtering** — Generate random log entries × query filters, verify exact match results and max 500 limit
    - **Validates: Requirements 11.3, 11.5, 11.7, 11.8, 12.4**

- [ ] 6. Implement Wallet Agent
  - [-] 6.1 Implement Wallet Agent with connection, session, and disconnect handling
    - Create `src/agents/wallet-agent.ts` implementing `Agent` interface
    - Implement "connect" handler: initiate Lace Wallet connection, emit "wallet.connected" within 30s or "wallet.connection_failed"
    - Implement "validate-session" handler: verify active connection, return wallet address or session error
    - Implement "disconnect" handler: clear session storage, invoke disconnect, emit "wallet.disconnected"
    - Implement unexpected disconnect detection: emit "wallet.disconnected", transition to idle
    - Persist connection state in browser session storage for auto-reconnect on refresh
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 6.2 Write unit tests for Wallet Agent
    - Test connect success/failure/timeout flows
    - Test validate-session with active/expired/disconnected states
    - Test disconnect cleanup
    - Test session persistence and auto-reconnect
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 7. Implement Signal Agent
  - [-] 7.1 Implement Signal Agent with normalization and validation
    - Create `src/agents/signal-agent.ts` implementing `Agent` interface
    - Implement "read-signals" handler: invoke Compact Witness, produce 6-value normalized vector in [0.0, 1.0]
    - Apply normalization parameters from Behavior Profile
    - Assign 0.5 default for signals with insufficient data (< threshold transactions), set estimated flags
    - Abort on wallet connection loss, discard partial data, report which signals succeeded/failed
    - Reject requests for disconnected wallets with invalid-wallet error
    - Publish "signals.read" event with signal vector hash (not raw signals)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 7.2 Write property test for Signal Agent (Property 12)
    - **Property 12: Signal Normalization** — Generate random raw signals × availability patterns, verify exactly 6 values in [0.0, 1.0], default 0.5 with estimated flag for unavailable signals
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [ ] 8. Implement Scoring Agent
  - [-] 8.1 Implement Scoring Agent with Groq integration and validation
    - Create `src/agents/scoring-agent.ts` implementing `Agent` interface
    - Implement "compute-grade" handler: invoke Groq API (Llama 3.3 70B) with temperature=0
    - Return Credit Grade from {AAA, AA, A, BBB, BB, C} with 6-entry reasoning breakdown (direction + weight)
    - Read model ID, temperature, prompt template, scoring thresholds from Behavior Profile
    - Validate input signal vector (6 values in [0.0, 1.0]), reject invalid with specific field errors
    - Handle API timeout (5s default), rate limit (14,400/day), and parse errors
    - Publish "scoring.rate-limited" and "scoring.parse-failed" events as appropriate
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 8.2 Write property tests for Scoring Agent (Properties 13, 14)
    - **Property 13: Scoring Output Structure and Validation** — Generate random valid/invalid signal vectors, verify grade set membership, 6-entry reasoning, and rejection specifics
    - **Property 14: Scoring Determinism** — Generate random vectors, invoke multiple times with same profile, verify identical output
    - **Validates: Requirements 6.1, 6.5, 6.6**

- [ ] 9. Implement Credential Agent
  - [-] 9.1 Implement Credential Agent with minting, revocation, and retry logic
    - Create `src/agents/credential-agent.ts` implementing `Agent` interface
    - Implement "mint-credential" handler: invoke Compact Contract to mint ZK Credential NFT
    - Validate request fields (wallet address, Credit Grade, signal vector hash) before contract call
    - Revoke existing credential before re-minting; abort if revocation fails after profile-configured retries
    - Implement exponential backoff retry (1s, 2s, 4s) for minting failures
    - Handle 60s mint timeout
    - Store only Credit Grade and Proof Hash on-chain (no raw signals)
    - Publish "credential.minted" event on success
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 9.2 Write property tests for Credential Agent (Properties 15, 16)
    - **Property 15: Credential Request Validation** — Generate random request objects with varied field presence, verify rejection and field-specific errors
    - **Property 16: Credential Revocation Before Re-Mint** — Generate random credential states × failure patterns, verify revocation-first logic and abort on failure
    - **Validates: Requirements 7.2, 7.7**

- [ ] 10. Implement Verification Agent
  - [-] 10.1 Implement Verification Agent with threshold logic, privacy, and input validation
    - Create `src/agents/verification-agent.ts` implementing `Agent` interface
    - Implement "verify-threshold" handler: invoke Compact Contract, return boolean based on grade ordering (AAA=5 > AA=4 > A=3 > BBB=2 > BB=1 > C=0)
    - Disclose only boolean result — never actual grade or signals
    - Validate minimum grade is in valid set (reject with invalid-grade error)
    - Validate wallet address format (reject with invalid-address error)
    - Handle contract unavailable within 2s (temporary-unavailable error)
    - Return "no credential found" for wallets without active credential
    - Publish "verification.queried" event with timestamp and querying address only
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 10.2 Write property tests for Verification Agent (Properties 17-19)
    - **Property 17: Threshold Comparison Correctness** — Test all 36 grade pair combinations plus random extras, verify boolean correctness per numeric encoding
    - **Property 18: Verification Input Validation** — Generate random invalid grades + malformed addresses, verify rejection without contract call
    - **Property 19: Verification Privacy** — Generate random queries, inspect response and event fields for absence of grade/signals/wallet info
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.8**

- [ ] 11. Implement Cache Agent
  - [~] 11.1 Implement Cache Agent with TTL, graceful degradation, and RLS
    - Create `src/agents/cache-agent.ts` implementing `Agent` interface
    - Implement "check-cache" handler: query Supabase, return cached grade+reasoning if valid (matching hash, within TTL)
    - Return cache-miss with wallet address and hash when no valid entry
    - Implement "store-result" handler: write to Request Cache, overwrite existing entries for same wallet
    - Validate store-result fields (wallet address, signal hash, Credit Grade, reasoning, timestamp)
    - Implement retry (2 retries, 500ms delay) with graceful degradation (cache-unavailable response, not pipeline-halting error)
    - Publish "cache.failure" event on persistent failures
    - Read TTL, pool size, retries, retry delay from Behavior Profile
    - Enforce row-level security (NIGHTSCORE service role only)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 11.2 Write property tests for Cache Agent (Properties 20, 21)
    - **Property 20: Cache Hit/Miss Correctness** — Generate random cache states × TTL × hash combinations, verify hit/miss behavior
    - **Property 21: Cache Graceful Degradation** — Generate random failure patterns after retry exhaustion, verify non-halting response and event publication
    - **Validates: Requirements 9.1, 9.2, 9.5**

- [~] 12. Checkpoint - All individual agents implemented
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement Monitor Agent
  - [~] 13.1 Implement Monitor Agent with metrics, alerting, and health determination
    - Create `src/agents/monitor-agent.ts` implementing `Agent` interface and `MonitorMetrics` interface
    - Subscribe to all Message Bus events, record type/source/timestamp/duration in Adaptation Log
    - Compute per-agent metrics (request count, avg response time, error count, lifecycle state) updated every 10 seconds
    - Implement error threshold alerting: publish "alert.agent-degraded" when error count exceeds threshold in time window
    - Implement unresponsive detection: publish "alert.agent-unresponsive" after 3 missed health checks
    - Implement system health computation: healthy/degraded/unhealthy per defined rules
    - Exclude raw signals, vectors, and grades from all log entries
    - Buffer up to 500 entries when Adaptation Log unavailable, publish "monitor.log-unavailable" event
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [~] 13.2 Implement config regression detection and baseline/comparison snapshots
    - Record baseline metrics snapshot within 5 seconds before profile change
    - Record comparison snapshot 1 hour after change (average of final 5 minutes)
    - Handle nested changes: close prior window, start new baseline
    - Publish "alert.config-regression" when error rate exceeds threshold within 5 minutes of change
    - Publish "learning.improvement-detected" when error rate decreases 20%+ over 24 hours post-change
    - Mark entries "incomplete" when metrics collection fails
    - _Requirements: 11.6, 12.2, 12.3, 12.7, 12.8_

  - [ ]* 13.3 Write property tests for Monitor Agent (Properties 23, 24, 27)
    - **Property 23: System Health Status Determination** — Generate random agent state + alert combinations, verify correct health classification
    - **Property 24: Error Threshold Alerting** — Generate random error sequences within time windows, verify exactly one alert when threshold exceeded
    - **Property 27: Config Regression Detection** — Generate random config changes × error rate patterns, verify regression alert with correct details
    - **Validates: Requirements 10.3, 10.5, 11.6**

- [ ] 14. Implement Orchestrator Agent
  - [~] 14.1 Implement Orchestrator Agent pipeline execution
    - Create `src/agents/orchestrator-agent.ts` implementing `OrchestratorAgent` interface
    - Implement `requestScore()`: execute pipeline (validate-session → check-cache → read-signals → compute-grade → store-result → mint-credential)
    - Implement cache-hit short-circuit: skip Signal, Scoring, Credential steps on valid cached result
    - Halt pipeline on agent error or 30s step timeout, record failed step and reason in Workflow Context
    - Implement 120s workflow timeout
    - Publish "workflow-complete" event with timing breakdown on completion
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8_

  - [~] 14.2 Implement concurrency control and backpressure
    - Limit to 10 concurrent workflows
    - Queue excess requests in FIFO order
    - Reject new requests when queue exceeds 50 pending (system-busy)
    - Resume accepting when queue drops below 40
    - _Requirements: 3.6, 3.7_

  - [ ]* 14.3 Write property tests for Orchestrator Agent (Properties 8-11)
    - **Property 8: Cache-Hit Pipeline Short-Circuit** — Generate random cache hit scenarios, verify Signal/Scoring/Credential not invoked
    - **Property 9: Pipeline Halt on Agent Failure** — Inject random failures at each step, verify halt and correct failure recording
    - **Property 10: Workflow Context Accumulation** — Generate random step result sequences, verify context accuracy
    - **Property 11: Concurrency and Backpressure** — Generate random request arrival patterns, verify 10 concurrent limit, FIFO queuing, 50/40 thresholds
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

- [ ] 15. Implement Privacy Guard and cross-cutting event privacy
  - [~] 15.1 Implement privacy filter for events and logs
    - Create `src/privacy/privacy-guard.ts` with utilities to strip sensitive data from event payloads
    - Ensure no raw signal values, signal vectors, or Credit Grade values leak into Message Bus events or Adaptation Log entries
    - Only allow operation status, timestamps, agent IDs, hashes, and performance metrics in logs/events
    - Integrate privacy guard into all agent event publishing paths
    - _Requirements: 5.5, 7.3, 10.6_

  - [ ]* 15.2 Write property test for privacy (Property 22)
    - **Property 22: Privacy in Events and Logs** — Generate random scoring payloads through all agents, inspect every published event and log entry for absence of raw signals, vectors, and grades
    - **Validates: Requirements 5.5, 7.3, 10.6**

- [~] 16. Checkpoint - All agents and privacy guard complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Create Supabase database schema and migrations
  - [~] 17.1 Create database migration files for agent tables
    - Create migration for `behavior_profiles` table with 50-key constraint, indexes, and RLS
    - Create migration for `adaptation_log` table with 64KB payload constraint, indexes, and RLS
    - Create migration for `level_gate_config` singleton table with RLS
    - Create migration for `agent_registry_state` persistence table with RLS
    - Create `jsonb_object_keys_count` function
    - Apply service-role-only RLS policies on all tables
    - _Requirements: 9.7, 11.1, 12.1, 12.6_

- [ ] 18. Wire components together and integration
  - [~] 18.1 Create system bootstrap and initialization
    - Create `src/index.ts` as the system entry point
    - Instantiate Message Bus, Agent Registry, Behavior Profile Store, Adaptation Log
    - Register all 8 core agents with their default profiles and schemas
    - Load Level Gate configuration and activate appropriate agents
    - Ensure initialization completes within 30 seconds
    - Wire Monitor Agent subscriptions to all bus events
    - _Requirements: 1.6, 13.1_

  - [~] 18.2 Create agent factory and plugin registration utilities
    - Create `src/agents/agent-factory.ts` for constructing agents with their dependencies
    - Create utility for runtime plugin registration
    - Expose `@nightscore/agent-types` type definitions from `src/types/`
    - _Requirements: 14.3, 14.4, 14.5_

  - [ ]* 18.3 Write integration tests for full scoring workflow
    - Test full pipeline: Wallet → Cache → Signal → Scoring → Credential (happy path)
    - Test cache-hit short-circuit
    - Test pipeline failure and halt
    - Test level-gate changes triggering agent activation/deactivation
    - Test Behavior Profile hot-reload
    - _Requirements: 3.1, 3.2, 3.3, 13.6_

- [~] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check with minimum 100 iterations
- Unit tests validate specific examples and edge cases using Vitest
- All code is TypeScript targeting Vercel serverless/edge runtime
- External services (Groq, Compact Witness, Compact Contract, Lace Wallet) should be abstracted behind interfaces for testability
- Supabase interactions use the service role with RLS enforcement

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "5.3"] },
    { "id": 3, "tasks": ["2.2", "5.1"] },
    { "id": 4, "tasks": ["2.3", "3.1", "5.2", "5.4"] },
    { "id": 5, "tasks": ["3.2", "3.3"] },
    { "id": 6, "tasks": ["3.4", "6.1", "7.1", "8.1", "9.1", "10.1", "11.1"] },
    { "id": 7, "tasks": ["6.2", "7.2", "8.2", "9.2", "10.2", "11.2", "17.1"] },
    { "id": 8, "tasks": ["13.1"] },
    { "id": 9, "tasks": ["13.2", "13.3", "14.1"] },
    { "id": 10, "tasks": ["14.2"] },
    { "id": 11, "tasks": ["14.3", "15.1"] },
    { "id": 12, "tasks": ["15.2"] },
    { "id": 13, "tasks": ["18.1"] },
    { "id": 14, "tasks": ["18.2"] },
    { "id": 15, "tasks": ["18.3"] }
  ]
}
```
