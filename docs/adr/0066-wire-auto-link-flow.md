<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0066: Wire Auto-Link Flow on First Group Interaction

## Status

Implemented

## Date

2026-04-12

## Context

ADR-0060 introduced the user identity mapping system with auto-link logic (`attemptAutoLink`) and identity tools (`set_my_identity`, `clear_my_identity`). The identity mapping CRUD, provider resolvers, NL detection, and tool integration were all wired. However, the auto-link function itself was never called from the message processing pipeline — it existed as dead code with knip exemptions.

Without wiring auto-link, users in group chats had no automatic identity resolution. The bot only learned a user's identity if they explicitly said something like "I'm jsmith" and the LLM invoked `set_my_identity`. The `resolveMeReference()` function in task tools would return `identity_required` for every "me" reference until the user manually claimed an identity.

The design doc (section 5) specified: "In group chats on first interaction, attempt auto-link." This wiring was the missing piece.

## Decision Drivers

- **Must call `attemptAutoLink` automatically** on first group interaction when no mapping exists
- **Must skip in DMs** — single user context is implicit
- **Must skip when mapping already exists** — avoid redundant API calls
- **Must skip when provider has no `identityResolver`** — not all providers support user search
- **Must not add latency to tool execution** — auto-link runs before tool assembly but after provider construction
- **Should remove knip dead-code exemptions** for the now-wired exports

## Considered Options

### Option 1: Wire in `callLlm` before tool creation (chosen)

Insert auto-link trigger in `src/llm-orchestrator.ts` between provider construction and tool assembly. Extracted into a dedicated `maybeAutoLinkIdentity` helper for testability.

**Pros:**

- Auto-link runs exactly once per `callLlm` invocation
- Provider is already built; identity resolver is available
- Clean separation from tool execution
- Natural placement — first message triggers auto-link before any tools run

**Cons:**

- Auto-link adds latency to first message (provider user search API call)
- Couples identity resolution timing to the orchestrator call path

### Option 2: Wire in `processMessage` before `callLlm`

Trigger auto-link earlier in the pipeline, before message history processing.

**Pros:**

- Even earlier in the pipeline

**Cons:**

- Provider not yet constructed at `processMessage` level — would need to build it twice or restructure
- Tighter coupling to message queueing logic

### Option 3: Wire in tool execution (lazy resolution)

Only attempt auto-link when a tool encounters a "me" reference and finds no mapping.

**Pros:**

- Zero overhead if user never says "me"

**Cons:**

- Inconsistent with design spec (first interaction, not first "me" reference)
- Adds latency to the specific tool call instead of a predictable upfront cost
- More complex — each tool would need its own auto-link logic

## Decision

Implement **Option 1**: Add `maybeAutoLinkIdentity()` helper in `llm-orchestrator.ts`, called in `callLlm` after provider construction and before tool creation.

The helper:

1. Returns immediately if `username` is null (DM) or provider lacks `identityResolver`
2. Checks for existing mapping via `getIdentityMapping()` — returns if found
3. Calls `attemptAutoLink()` with the chat username
4. Logs result (info on success, debug on no match)

## Rationale

The `callLlm` placement is the natural integration point because the provider is already constructed (via `buildProviderForUser`) and the function runs before any tool logic. This matches the design spec's "on first group interaction" requirement exactly — the first time `callLlm` runs for a group context with no existing mapping, auto-link fires.

The extracted helper avoids cluttering `callLlm` with identity logic and makes the auto-link trigger independently testable.

## Consequences

### Positive

- Users with matching usernames are automatically linked on first group message — no manual action needed
- `resolveMeReference()` in task tools finds the mapping on the same message's tool execution
- Knip exemptions removed — `attemptAutoLink` is no longer dead code
- "me" references work immediately in the first group interaction for matched users

### Negative

- First message in a group chat incurs an extra provider API call (user search) when no mapping exists
- Subsequent messages skip the check (mapping exists, whether `found` or `unmatched`)

### Risks

- **Latency on first message**: Provider user search adds round-trip time. Mitigation: only fires once per context+provider pair; `unmatched` state prevents retries.
- **False positives**: Exact username match could link wrong user for common names. Mitigation: exact match is conservative; design spec §5 requires confidence ≥ 80%.

## Implementation Notes

### File Structure

| File                       | Change                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `src/llm-orchestrator.ts`  | Added `maybeAutoLinkIdentity()` helper, imports, call in `callLlm` |
| `src/identity/resolver.ts` | Updated JSDoc to note wired status                                 |
| `knip.jsonc`               | Removed `ignoreIssues` for `resolver.ts` and `nl-detection.ts`     |

### Integration Point

In `callLlm()` at line 173 (`src/llm-orchestrator.ts`):

```typescript
const provider = deps.buildProviderForUser(configId)
await maybeAutoLinkIdentity(chatUserId, username, provider)
const tools = getOrCreateTools(contextId, chatUserId, provider, contextType)
```

## Verification

- `bun test` passes with no regressions
- `bun knip` reports no unused exports for `resolver.ts` or `nl-detection.ts`
- `bun typecheck` succeeds

## Related Decisions

- ADR-0060: User Identity Mapping for Group Chats (introduced the auto-link function)
- ADR-0058: Provider Capability Architecture (capability model that `identityResolver` follows)
- ADR-0059: Thread-Aware Group Chat (thread-scoped context IDs)

## References

- Plan: `docs/superpowers/plans/2026-04-12-wire-auto-link-flow.md`
- Design spec §5 (Auto-Link Flow): `docs/archive/user-identity-mapping-design-2026-04-10.md`
- Identity resolver: `src/identity/resolver.ts`
- Identity mapping: `src/identity/mapping.ts`
