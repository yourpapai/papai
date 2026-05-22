<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0047: Session-Level Mutation Testing via OpenCode Plugin Events

## Status

Rejected (Research Error)

## Date

2026-04-04

## Context

Mutation testing with StrykerJS (ADR-0017) adds significant overhead when integrated into TDD enforcement hooks. The initial implementation ran mutation testing per-file-edit (before and after each write), adding 60-240 seconds of overhead per edit. A plan was drafted to move mutation testing to session boundaries—running once at session start to establish a baseline, and once at session end to verify no new mutants survived.

The plan assumed OpenCode Plugin API provided `session.start` and `session.stop` lifecycle hooks for this purpose.

## Decision Drivers

- Per-edit mutation testing overhead (60-240s) severely impacts development velocity
- Session-level testing would reduce overhead to 30-120s once per session
- Mutation coverage enforcement must still be maintained
- Must use official OpenCode Plugin API (no workarounds)

## Research Error

The plan incorrectly assumed the OpenCode Plugin API provides `session.start` and `session.stop` hooks. Upon verification of `@opencode-ai/plugin@1.3.14`, these hooks **do not exist**.

### Available Plugin Hooks

The actual `Hooks` interface provides:

| Hook                     | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `event`                  | General event handler for all system events |
| `tool.execute.before`    | Before tool execution                       |
| `tool.execute.after`     | After tool execution                        |
| `chat.message`           | New message received                        |
| `chat.params`            | Modify LLM parameters                       |
| `command.execute.before` | Before command execution                    |
| `shell.env`              | Modify shell environment                    |
| `experimental.*`         | Experimental features                       |

### Session Lifecycle Events (via `event` hook)

The API emits these session-related event types:

- `session.created` - New session created
- `session.updated` - Session updated
- `session.deleted` - Session deleted
- `session.compacted` - Session compacted
- `session.diff` - Session diff available
- `session.error` - Session error occurred
- `session.status` - Session status changed
- `session.idle` - Session became idle

## Considered Options

### Option 1: Use `event` Hook with `session.created`/`session.deleted` (Not Pursued)

- **Pros**: Uses actual available API; `session.created` fires at session start; `session.deleted` fires at session end
- **Cons**: Session deletion event may fire after session cleanup; no guarantee mutation testing can complete and report results; `session.deleted` timing is implementation-dependent and may not allow blocking/reporting

### Option 2: Keep Current Disabled State (Chosen)

- **Pros**: No false assumptions about API; no partial/broken implementation; codebase already has modular infrastructure in place for future activation
- **Cons**: Mutation testing remains disabled; no enforcement of mutation coverage in TDD pipeline

### Option 3: Revert to Per-Edit with `TDD_MUTATION` Toggle (Explicitly Rejected)

- **Pros**: Would work with available hooks; provides enforcement
- **Cons**: Re-introduces 60-240s overhead per edit; unacceptable impact on development velocity; already disabled for this reason

## Decision

**Reject the plan as written.** The architectural assumption (`session.start`/`session.stop` hooks) is false. The plan cannot be implemented as specified.

Keep mutation testing **disabled** in the TDD enforcement pipeline. The infrastructure (`session-mutation.mjs`, `SessionState` methods) remains in place but inactive. Future re-activation requires:

1. Verification of OpenCode Plugin API documentation for appropriate session lifecycle hooks
2. Confirmation that chosen hooks support blocking/synchronous reporting
3. Updated implementation plan based on actual API surface

## Rationale

The primary goal (reducing mutation testing overhead) is valid, but the implementation path assumed in the plan does not exist. The OpenCode Plugin API uses an event-based model (`event` hook with `Event` types) rather than lifecycle hooks (`session.start`/`session.stop`).

The `event` hook approach has critical limitations:

- Events are fire-and-forget; no blocking capability
- `session.deleted` timing is uncertain (may fire during cleanup)
- No mechanism to surface mutation reports to the user synchronously

Attempting to force session-level mutation testing through the `event` hook would result in:

- Reports that may not reach the user (session already closed)
- Race conditions between mutation testing and session cleanup
- Unreliable enforcement (no guarantee verification completes)

## Consequences

### Positive

- Avoided building on false API assumptions
- No broken/partial implementation in codebase
- Clear documentation of why session-level approach is blocked
- Infrastructure preserved for future re-activation when API supports it

### Negative

- Mutation testing remains disabled in TDD pipeline
- No automated enforcement of mutation coverage during development
- Mutation score may regress without CI-only enforcement (if CI job still runs)

### Risks

- **Coverage regression**: Without per-edit enforcement, developers may not write mutation-killing tests
- **Mitigation**: CI mutation testing job (if still configured) provides post-hoc enforcement

## Related Code

The following infrastructure exists but is **not integrated** into the active plugin:

- `.hooks/tdd/session-mutation.mjs` - `captureSessionMutationBaseline()` and `verifySessionMutationBaseline()` functions
- `.hooks/tdd/session-state.mjs` - `setSessionMutationBaseline()` and `getSessionMutationBaseline()` methods
- `SessionStateData.sessionMutationBaseline` property (typed but unused at runtime)

These modules are technically functional but have no call sites in the active code path.

## Related Decisions

- ADR-0017: Mutation Testing with StrykerJS - Established mutation testing as quality gate
- ADR-0043: TDD Hooks Integration for Multi-Platform AI Enforcement - Current TDD pipeline implementation

## References

- Original (incorrect) plan: `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-04-04-optimize-mutation-testing.md`
- OpenCode Plugin API types: `@opencode-ai/plugin@1.3.14/dist/index.d.ts`
- OpenCode SDK Event types: `@opencode-ai/sdk/dist/gen/types.gen.d.ts`

## Lessons Learned

1. **Verify API surface before planning** - Always check actual type definitions rather than assuming hook names
2. **Event-based != Lifecycle hooks** - The `event` hook pattern is fundamentally different from `session.start`/`session.stop` lifecycle hooks
3. **Document research errors explicitly** - Rejecting a plan due to incorrect assumptions is valuable documentation
