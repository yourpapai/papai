<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier-0 runtime flows — Phase 3 follow-up design

Date: 2026-07-29
Status: approved

## Problem

The Phase 3 catalog foundation has five pending, `executable-as-is` Tier-0-ready
records with no literal executable-story mapping:

- `SCN-queue-coalescing`
- `SCN-queue-group-serialization`
- `SCN-message-cache-persistence`
- `SCN-usage-accounting`
- `SCN-plugin-deny-gating`

They are all runtime behaviors, but they do not share one runtime dependency or
one behavior boundary. A single broad story would obscure the catalog's
one-behavior-per-id contract.

## Goals

- Promote exactly the five listed catalog IDs through deterministic Tier-0
  scenarios.
- Preserve distinct queue batching and group/thread serialization claims.
- Keep cache persistence separate from usage accounting.
- Prove plugin denial before a plugin tool can execute and prove that no
  privileged provider call is reachable through a denied facade.
- Reuse existing scenario/database/plugin lifecycle seams only.

## Non-goals

- Production behavior changes or new runtime seams.
- New fixtures, platform adapters, network access, or LLM-script dependencies.
- Promoting any other Phase 3 catalog record.
- Treating a shared file, scenario database, or plugin lifecycle as evidence that
  two catalog behaviors are the same.

## Story-family shape

Use three independently reviewable Tier-0 story files:

1. `tests/stories/runtime/queue.story.test.ts` contains the two queue records.
   They share queue-item/reply builders and deferred-handler control, but have
   separate literal scenarios and assertions.
2. `tests/stories/runtime/persistence-and-usage.story.test.ts` contains separate
   cache and usage scenarios. The real scenario database is only a file-level
   convenience: each scenario seeds and asserts independent tables and state.
3. `tests/stories/integrations/plugins/eligibility.story.test.ts` gains the
   plugin-denial scenario beside the existing approved synthetic-plugin lifecycle
   setup.

This is preferable to one broad "runtime flows" story, which would couple
independent timing, persistence, accounting, and capability behavior. Five files
would provide no material additional isolation beyond the queue pair, while
duplicating harness setup.

## Runtime entry points and assertions

### `SCN-queue-coalescing`

Enter at `MessageQueue.enqueue`, enqueue two items from the same actor in one
group thread, then call `forceFlush`. Do not route through chat transport or an
LLM.

Assert exactly one coalesced item, stable input text order and attachment order,
thread mention formatting, and the last item's reply handle. This scenario does
not introduce another actor and does not assert concurrent-handler behavior.

### `SCN-queue-group-serialization`

Enter at `MessageQueue.enqueue` with a handler whose first turn waits on a
deferred promise. Enqueue Alice, then Bob; Bob's actor transition must flush
Alice. Release the second turn's debounce through normal queue progression only
after controlling Alice's completion.

Assert that Alice starts and ends before Bob starts and that maximum active
handlers is one. If Alice rejects, assert the terminal error path occurs and
Bob's turn still runs; the handler chain must not remain blocked.

Queue tests use `forceFlush`, deferred promises, and `waitFor` for observable
state transitions. They do not use fixed debounce-duration sleeps.

### `SCN-message-cache-persistence`

Write through public `cacheMessage`, wait for the scheduled microtask write to
drain through observable persistence state, then read using `getMessageContext`
and `buildReplyChain` against the real scenario SQLite database.

Seed eligible messages in two contexts, with a reply chain in the permitted
context and equivalent message IDs in the other. Assert persistence, root-to-leaf
chain order, correct context/scope retrieval, and the absence of the
foreign-context target or chain. An incomplete chain must retain its existing
incomplete/broken state rather than fabricate a reply link.

This scenario neither emits usage events nor reads usage tables. It does not
cover persistence-retry timing unless an existing deterministic failure seam can
exercise it without a new fixture.

### `SCN-usage-accounting`

Initialize the real usage-event subscriber, emit `llm:end` and
`tool:execute_end` through the event bus, then query with `listSubjects` and
inspect the persisted event rows where necessary. Use fixed timestamps and
identical event identity inputs for duplicate delivery. For bounded-window reads,
capture `Date.now()` once and place events well inside and outside the window.

Assert that repeated identical LLM and tool events produce one row per event
identity; distinct request/tool events persist expected model totals and tool
counts; and bounded queries include only the intended recent subject while the
all-time query retains old rows. Malformed or non-user events must produce no row
and must not disrupt subscribers.

This is accounting behavior, not message history persistence: it does not use
the message cache or infer accounting from cache rows.

### `SCN-plugin-deny-gating`

Reuse the existing approved/enabled synthetic-plugin lifecycle. Configure a
plugin with an unavailable required capability, start the scenario world, and
build providerless tool descriptors. Assert that its namespaced tool is absent
before an LLM or tool-execution call can be attempted.

In addition, construct the permission-gated runtime facade with a provider spy
and attempt the denied operation. Assert that it throws the permission denial and
the provider spy remains uncalled. This demonstrates that activation, contextual
enablement, or a retained callback cannot supply a privileged raw-provider escape
path.

## Catalog promotion

The eventual implementation moves only these five records from `AUDIT_RECORDS`
to `EXECUTABLE_STORY_MAPPINGS`, each with one literal Tier-0 scenario ID and an
implementation verification date. All other Phase 3 records remain pending.

## Failure handling

- Queue handler failures are contained by the existing queue chain and reported
  as terminal error events; later queued work still progresses.
- Cache writes retain existing error logging/requeue semantics. The story asserts
  successful deterministic persistence and boundary behavior, not a timed retry.
- Usage recorder failures are non-fatal to the event bus; invalid payloads are
  ignored.
- Plugin denial fails closed: a missing capability removes the tool before
  execution, and a denied facade throws before delegating to the provider.

## Verification

The eventual implementation runs:

```sh
bun test:stories:contracts
bun test:stories
bun test:stories:stress
bun run test -- tests/message-queue tests/message-cache tests/usage tests/plugins
```

For frozen-input/refactor qualification, it additionally runs:

```sh
BASE_REF=<approved-baseline-sha> bun test:stories:compat --manifest-only
BASE_REF=<approved-baseline-sha> bun test:stories:compat
```
