---
inclusion: always
---

# NightScore Adaptive Agents Architecture

## System Overview

NightScore is a privacy-preserving credit scoring system built on the Midnight blockchain. It uses an adaptive agent architecture where 8 specialized agents communicate through an in-memory message bus.

## Core Agents

| Agent | Responsibility | Key Topics |
|-------|---------------|------------|
| Orchestrator | Pipeline coordination, concurrency control | request-score |
| Wallet | Lace wallet connection, session management | wallet.connect, wallet.validate-session, wallet.disconnect |
| Signal | Read wallet signals from Compact Witness | read-signals |
| Scoring | Groq API (Llama 3.3 70B) credit grading | compute-grade |
| Credential | Mint/revoke ZK credentials on Midnight | mint-credential |
| Verification | Threshold queries (boolean only) | verify-threshold |
| Cache | Supabase request cache with TTL | cache.check-cache, cache.store-result |
| Monitor | Metrics, alerting, health checks | alert.*, learning.* |

## Architecture Rules

1. **All agents implement the Agent interface** (`src/types/agent.ts`): `handleMessage`, `getHealth`, `getCapabilities`, `initialize`, `onActivate`, `onDeactivate`, `onConfigUpdate`
2. **Agents communicate only via the Message Bus** — never direct imports between agents
3. **Privacy is paramount** — no raw signals, vectors, or grades in events/logs. Only hashes, timestamps, and performance metrics.
4. **Behavior Profiles** — all agent parameters (timeouts, retries, thresholds) come from JSON profiles stored in Supabase. No hardcoded magic numbers.
5. **Level-gated activation** — agents activate progressively: L1 (Wallet+Credential), L2 (+Orchestrator+StubScoring), L3 (+Signal+FullScoring+Cache+Monitor), L4+ (+Verification)
6. **Graceful degradation** — cache and monitoring failures must never halt the scoring pipeline

## File Organization

```
src/
├── agents/          ← Agent implementations (one file per agent)
├── bus/             ← Message Bus implementation
├── registry/        ← Agent Registry + startup initialization
├── config/          ← Behavior Profile store + config reloader
├── log/             ← Adaptation Log
├── privacy/         ← Privacy guard utilities
└── types/           ← All TypeScript interfaces (barrel exported from index.ts)
```

## Key Patterns

- **Message format**: All messages have `id`, `sourceAgentId`, `targetAgentId`, `type`, `correlationId`, `timestamp`, `topic`, `payload`
- **Error handling**: Return `ErrorMessage` with `code` and `description` — never throw from `handleMessage`
- **Testing**: Use Vitest + fast-check for property-based tests. Minimum 3 tests per agent.
- **External services** (Groq, Compact Witness, Compact Contract, Lace Wallet): Always abstracted behind interfaces for testability.

## Credit Grades

Valid grades ordered high to low: `AAA > AA > A > BBB > BB > C`

Numeric encoding: AAA=5, AA=4, A=3, BBB=2, BB=1, C=0
