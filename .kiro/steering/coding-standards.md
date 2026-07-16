---
inclusion: fileMatch
fileMatchPattern: "src/agents/*.ts"
---

# Agent Implementation Standards

## When writing or modifying agent files:

1. **Always implement the full Agent interface** — `handleMessage`, `getHealth`, `getCapabilities`, `initialize`, `onActivate`, `onDeactivate`, `onConfigUpdate`
2. **Never import other agents directly** — all inter-agent communication goes through the MessageBus
3. **Extract external dependencies as constructor-injected interfaces** — for testability (e.g., `CacheStore`, `CompactWitness`, `WalletConnector`)
4. **Use `uuidv4()` for all message IDs and correlation IDs**
5. **Return ErrorMessage on failure, never throw** from `handleMessage`
6. **Read all thresholds/timeouts from BehaviorProfile** — no inline magic numbers
7. **Privacy**: Never include raw signals, signal vectors, or credit grades in published events. Only hashes, timestamps, and metrics.
8. **Validate inputs before external calls** — reject with specific field-level errors
9. **Graceful degradation** — cache/monitoring failures return non-halting responses

## Message Response Pattern

```typescript
// Always return typed responses
async handleMessage(message: BusMessage): Promise<ResponseMessage | ErrorMessage> {
  // 1. Validate input
  // 2. Execute logic
  // 3. Return response or error (never throw)
}
```

## Testing Pattern

Each agent must have at minimum:
- Circuit/logic correctness test
- State transition test  
- Privacy test (verify no sensitive data leaks in events/responses)
