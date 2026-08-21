<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See `proposal.md` — Why. Three facts from the code shape the approach.

`resolveChatParticipant` (`src/chat/participants/roster.ts`) is already fully injectable:
it takes a `ResolveUserLabelFn` as a parameter, and `createProductionRuntimeDeps` binds
it to `router.resolveUserLabel` at `src/runtime/production-deps.ts:152`. The story harness
consumes that same composition, so the resolver reaches stories with **no production
seam**.

`resolveUserLabel` is optional on `ChatProvider` (`src/chat/types.ts:275`, inside the
trailing `Partial<{…}>`), and `ScenarioChat` is `Omit<ChatProvider, 'onInteraction'> & …`.
The story fake omits it today, so `ChatRouter.resolveUserLabel` returns `null` and every
candidate falls back to username-or-userId. Adding it is type-additive.

Registration is gated at `src/tools/tools-builder.ts:270` and `:296` on
`contextType === 'group' && chatParticipantResolver !== undefined && contextId !== undefined`,
and the descriptor cache carries a `'with-resolver' | 'no-resolver'` scope segment
(`src/llm-orchestrator-descriptor-cache.ts:34`). Those two conjuncts are the denial
surfaces this change must cover separately.

## Goals / Non-Goals

**Goals:**

- Close `primary` and `authorization-routing` for `chat-participant-resolution` at T0.
- Add the smallest fixture capability that makes the label path real rather than
  always-fallback, following the existing `seedGroupAdmin` pattern.
- Leave the ledger rationale carrying the residue each closed dimension still does not
  prove.

**Non-Goals:**

- Asserting the descriptor cache key itself. The cache segment exists so a resolver-less
  and a resolver-bearing context do not share a descriptor; observing the *tool's*
  presence and absence proves the outcome, and asserting the key would couple a story to
  an implementation detail the refactor is entitled to move.
- Driving `ChatRouter.resolveUserLabel`'s p-limit fan-out. One label lookup per candidate
  through the real code path is what the dimension claims; the bound is unit-tested.

## Decisions

**The label seam is a `ScenarioChat` method, not a `given.*` env fixture.**
`ScenarioChat` already exposes `addGroupAdmin(groupId, userId)` for exactly this shape —
per-scenario provider state the fake owns — with `given.seedGroupAdmin` as the thin
fixture wrapper that throws when no chat instance is present. A new
`setUserLabel(userId, label)` plus `given.seedChatUserLabel(…)` mirrors it exactly.
Alternatives rejected: a constructor argument to `createScenarioChat` (forces every
existing call site to change, for a capability almost no scenario wants), and an env-var
seam (the harness guide steers configuration toward `given.*` fixtures precisely to keep
`process.env` clean at teardown).

**The capability id is added to `CORE_TOOL_CAPABILITIES` rather than worked around.**
The scripted model addresses a tool through `callCapability(capabilityId, …)`, which
resolves via `runtime.resolveToolCapability` against the catalog that
`registerOfferedCoreToolCapabilities` fills from `CORE_TOOL_CAPABILITIES`.
`resolve_chat_participant` had no entry there, so no story could call it. Since the map is
pinned as an exhaustive ordered list in `tests/tools/core-capabilities.test.ts`, the
absence was a gap rather than a signal to route around, and `tests/CLAUDE.md` names the
capability catalog as part of the frozen-harness seam API. Alternatives rejected: having
the harness special-case the wire name (puts a second, divergent naming authority in the
harness), and asserting on `model.inspections().availableTools` alone (proves
registration, but leaves ranking and mention population unprovable). This is the one
production edit in the change, discovered during apply and recorded back into the
proposal.

**Denial surfaces get one scenario each, not one combined negative.**
The gate is a conjunction, so a single "tool absent" scenario would pass if either
conjunct alone held — and a refactor that drops the `contextType === 'group'` check would
stay green behind the resolver check. This is the per-denial-surface bar the roadmap sets
for `authorization-routing`; it is the reason the bar exists.

**The DM denial scenario asserts the tool is absent from the offered tool set, not that a
call fails.** The scripted LLM chooses from what it is offered; a tool that was never
registered cannot be called, so "the model could not call it" is the only observable, and
it is the right one — registration, not runtime rejection, is what the behavior claims.

**Ranking is proven with one query against a seeded field, not with three scenarios.**
Exact > prefix > substring is a total order over a single candidate list; one query
returning a correctly ordered list proves the comparator. Splitting it three ways would
pay three frozen-input costs to re-prove one claim.

## Risks / Trade-offs

- **The fake's `resolveUserLabel` drifts from real provider semantics** (e.g. real
  providers return `null` for unknown users, throw on transport failure) → seed the fake
  to return `null` for unseeded ids, and cover the throw path, since `resolveChatParticipant`
  has an explicit `catch` that falls back. A fake that only ever succeeds would leave that
  `catch` unproven while the dimension reads closed.
- **`message_metadata` senders are thread-local by design** (`roster.ts` documents this:
  no group-level denormalized column) → the story must seed the sender in the *same*
  storage context id it later queries, or the union will silently be members-only and the
  scenario will pass for the wrong reason.
- **Baseline churn** → this is the accepted per-behavior cost of Phase 2, not a risk to
  mitigate. It is the reason Phase 2 and the refactor cannot overlap.

## Migration Plan

1. Land the harness fixture capability and the stories together on this branch; both are
   frozen inputs, so there is no ordering benefit to splitting them across PRs.
2. Merge to master.
3. Re-record the qualification baseline at the merge commit: run the five verification
   commands, then update `## Foundation baseline` in the roadmap design doc with the new
   `baselineSha`, `treeHash`, frozen-input count, and manifest scenario count.

Rollback is `git revert`; the retired baseline SHA stays cited in the supersession chain,
which is what that chain is for.

## Hook and TDD interactions

`bunfig.toml` excludes `tests/stories/**` from default discovery, so the Write/Edit TDD
hook cannot run a new story file — it will report that the path matched no tests. This is
a known harness limitation, not a signal. Verify manually, as `ledger-dimension-tiers`
did:

```
bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts <file>
```

Test-first order: fixture contract test (`tests/stories/harness/chat.test.ts`) → fixture
capability → catalog records → stories → ledger flip. The catalog is bidirectional, so a
story written before its record fails `bun test:stories:contracts`; write the record in
the same step as the story, not after.

## Open Questions

None. The one open item in this area — whether the `/stop` abort path removes the need
for a `ModelDecision` failure seam — belongs to `live-status`, not to this behavior.
