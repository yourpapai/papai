<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See proposal.md — Why. What the approach has to work around, on each backend:

**claude.** `decodeClaudeLine` (`claude-contract.ts:259`) reads the `result`
line's top-level `usage` and publishes one `ClaudeUsage`. Two callers consume
it: `claude-spend.ts:64` (the run's account and the token ceiling) and
`claude-progress.ts:63` (the live log line). The `result` line is also the line
that *ends a turn* — `claude-adapter.ts:188` keeps it for its text, session id
and error flag — so `resultLineSchema` is load-bearing for turn completion, not
just for money. Anything added to that schema must be incapable of failing it.

**opencode.** `usage(sessionId)` (`opencode-connect.ts:124`) is one
`session.get` decoded by `decodeSessionUsage`, which deliberately returns
`null` rather than throwing: a budget is a guardrail on the work, not part of
it. A `task` sub-agent runs in a **child session**, whose tokens never reach
the parent's totals. The pinned `@opencode-ai/sdk@1.18.23` exposes
`session.children` at `/session/{id}/children`, typed `Array<Session>` — but
its generated `Session` (`types.gen.d.ts:465`) declares no `tokens` or `cost`
at all, while the live server demonstrably returns both on `session.get`. The
generated types trail the server; that gap is a constraint on what the children
read may be trusted to carry.

Both accounting paths feed the same downstream ladder (`run-spend.ts`) and the
same token ceiling (`token-budget.ts`), neither of which changes here.

## Goals / Non-Goals

**Goals:**

- One definition of "what this turn used" per backend, complete by
  construction at the point of decode, so every consumer (ceiling, reprice, log)
  reads the same figure.
- **Monotonicity**: no run's reported tokens or cost can go *down* as a result
  of this change, under any partial-decode or degraded-read path.
- Degradation that costs the added detail and never the surrounding fact — a
  `modelUsage` entry that will not decode must not cost the turn; a children
  read that fails must not cost the parent's usage or the phase.

**Non-Goals:**

- Per-model repricing. The ladder still reprices one bucket set through one
  `modelRef` (proposal — Assumptions); the split is decoded so it can be built
  on, not consumed by the price.
- Backfilling or restating spend already recorded by past runs.
- Granting the opencode `task` tool. `permissions.ts` still denies `*` and the
  child-session sum stays defensive (proposal — Assumptions).

## Decisions

### D1. Fold at the decoder, not at the accumulator

`decodeClaudeLine` publishes a `usage` that already covers every model the line
named, plus a `models` split beside it. The alternative — leave `usage`
partial and fold in `claude-spend.recordLine`, as the proposal's file list
sketches — was rejected because there are *two* readers of `line.usage` and
only one of them is the accumulator: folding at the accumulator leaves
`claude-progress.ts` logging a number that disagrees with the run's own total,
which is the class of bug this change exists to remove. Consequence worth
stating plainly: `claude-spend.ts` needs **no arithmetic change** — its
behaviour changes because its input got complete. Its edit is the doc comment
that says so.

### D2. The published figure is the per-bucket maximum of the two readings

Per bucket: `max(topLevel, Σ decoded modelUsage entries)`; `total` is the four
published buckets summed.

Pure `Σ modelUsage` (falling back to top-level only when the map is absent or
empty) was the obvious rule and is rejected: under D3's tolerant decoding, one
entry that fails to decode makes the sum **smaller** than today's top-level
figure, so a shape drift would silently *reduce* a run's recorded spend — the
exact failure mode of the bug being fixed, with a new cause. The maximum makes
the Goals' monotonicity property structural rather than something the tests
have to keep watch over: on the recorded corpus the two rules are
indistinguishable (`Σ ≥ topLevel` holds on every fixture), and they diverge
only on the partial-decode path, where the maximum is the safe answer for a
figure that is a *ceiling* input.

Against `native-success-turn.ndjson` this publishes 90,547 (was 89,624) with
the haiku tokens in the repriceable buckets. Against `success-turn.ndjson` and
`resume-turn.ndjson` (single-model maps) and `auth-error-turn.ndjson` /
`native-auth-error.ndjson` (`modelUsage: {}`) it publishes exactly today's
numbers, including the `sawUsage === false` → `unpriced` distinction, which
`recordLine` and `spendOf` continue to decide unchanged.

### D3. `modelUsage` degrades per entry, and can never fail the result line

`z.record(z.string(), entrySchema.optional().catch(undefined))`, itself
`.optional().catch(undefined)` — the `ModelEntrySchema` / `unifiedWindows`
doctrine this file already records for the rate-limit line, carried to the one
place where the stakes are higher: a strict `modelUsage` on `resultLineSchema`
would, on a CLI that renamed a field, fail the whole `result` line, and the
adapter would then see a turn that never produced a result at all. An
unrecognised entry costs that entry; an unrecognised map costs the split. Each
entry decodes `inputTokens`, `outputTokens`, `cacheCreationInputTokens`,
`cacheReadInputTokens` and optional `costUSD`; the CLI's `contextWindow`,
`provider`, `canonicalModel` and friends stay unnamed, per the file's rule that
the schema names only what the pipeline reads.

### D4. The split gets exactly one consumer: the existing progress log line

`claude-progress.ts:63` already logs `{ tokens }` on the result line; it gains
the per-model split. This is deliberate rather than incidental — a `models`
field with no reader is unexercised API surface, which the TDD pipeline's
`verify-no-new-surface` check is right to block, and which nothing in this
change could pin. Rejected alternative: a `perModel` map accumulated on
`ClaudeAccounting` for a future per-model reprice — speculative state for a
non-goal.

### D5. On opencode, children give ids; usage comes from the recorded `get`

`usage(sessionId)` walks the session tree and sums `decodeSessionUsage` over
every node. The children read decodes **only** `id` from each entry — the one
field the pinned generated types actually declare — and each node's spend is
then read through `session.get`, the path already recorded against a live
server. Reading `tokens`/`cost` straight off the `/children` payload would save
a round trip per child and is rejected today: the generated `Session` declares
neither field, so that payload's shape is a guess, and this workspace's rule is
recorded rather than assumed. Traversal is breadth-first with a visited set and
a depth/node cap, because the endpoint's own doc ("a session's children") does
not say whether it returns direct children or all descendants — the guard makes
both readings correct and neither double-counts.

New decode/sum helpers live in `sdk-contract.ts` beside `decodeSessionUsage`
(what the SDK says) and the traversal in `opencode-connect.ts` (how the SDK is
addressed) — the seam those two files already document. No new module: nothing
existing covers "sum a session tree", and neither file needs splitting for it.

### D6. Summing keeps an absent cache bucket absent

`SessionUsage.cacheRead` / `cacheWrite` are optional because "the server did
not say" and "the server said none" price differently, and `run-spend.priceable`
refuses to reprice a bucket set with a hole in it. The sum inherits that:
absence is contagious — if any session in the tree omits a bucket, the summed
reading omits it and the run reports unpriced. Defaulting the hole to `0`
during summation would under-charge a cache-heavy sub-agent while looking
exact, which is the failure `sdk-contract.ts` documents that field to avoid.
`tokens` and `cost` sum straight across.

### D7. Degradation is logged, so `connectSdk` takes a Logger

A children read that throws, times out or decodes as unrecognised yields the
parent-only figure and warns — same doctrine as `decodeSessionUsage` returning
`null`. `connectSdk(directory, openai)` has no logger today, so it gains one;
`opencode-adapter.ts:96` already holds `options.log` at the only call site.
Rejected alternative: a `partial: true` marker on `SessionUsage` for the
adapter to warn about — that puts a degradation flag into the money type, where
every downstream reader must then decide what to do with it, to say something
that belongs in a log line. The whole walk is bounded by a deadline
(`withDeadline`, as `probeAlive` already does) and degrades to parent-only on
expiry: this read sits on the budget path after every prompt, and a wedged
server must not hold a phase open.

### D8. No new dependency, no new persisted state, no gating change

Zod covers the tolerant decoding; the pinned SDK already exposes
`session.children`; the arithmetic is addition. Nothing here needs the AI SDK,
Grammy, discord.js or drizzle. **Scope model**: no new persisted state, so
nothing new is keyed by storage context, config context, platform instance or
user — the run's spend continues to reach the ledger and the run comment
through the existing path under the existing keys, carrying a corrected number.
**DB**: no schema change, so no drizzle migration and no backfill (see
Migration Plan for why no backfill is attempted). **Capability / tool-prefs
gating**: no new tool surface, so no capability entry and no tool-prefs key;
`permissions.ts` is untouched and the opencode `task` tool stays denied.

## Risks / Trade-offs

- **A run's reported tokens jump, so the token ceiling trips sooner.** A claude
  run near its ceiling may now end a phase where it previously continued. This
  is the intended correction — the ceiling was bounding an under-count — but it
  is the one behaviour change a maintainer can feel. → Named in the change's
  own notes; nothing in the ladder's ordering, the unpriced state, the
  rate-limit windows or the comment rendering moves with it, so the jump is
  attributable to exactly one cause.
- **Historical figures become incomparable across the merge.** Runs before and
  after price the same work differently. → No backfill is possible (the
  per-model detail was never persisted); the discontinuity is a single dated
  commit rather than a drift.
- **D2's maximum could mask a real CLI regression** in which top-level `usage`
  legitimately shrinks. → Accepted: over-reporting a ceiling input is the safe
  direction, and the corpus re-recording procedure (`claude-live`, on a pin
  move) is what catches shape changes.
- **N+1 loopback round trips per usage read on opencode**, on the budget path.
  → Bounded by D7's deadline and the node cap; zero extra calls beyond the
  children probe when a session has no children, which is every run today.
- **A child session priced at `0` by opencode's catalogue drags the summed
  `cost` toward under-reporting.** → Pre-existing semantics of that field
  (`run-spend.ts` treats `0` as no answer at the backend rung); summing does not
  make it worse, and the token figure — the one the guardrail uses — is exact.
- **The opencode leg is unobservable today** (no profile grants `task`), so its
  tests are stubs rather than recordings. → Accepted and stated in the
  proposal; the stub pins the arithmetic and the degradation, and the first
  profile that grants `task` inherits a correct reading rather than a bug.

## Migration Plan

No schema, config or deploy step: the change ships as an ordinary merge and
takes effect on the next run. Rollback is reverting the commit — figures return
to today's under-count with no residue, because nothing new is persisted and no
stored row changes shape. Recorded runs are deliberately **not** backfilled:
the per-model split that would be needed to restate them was never stored, so
any restatement would be an estimate wearing a measurement's clothes.

Test-first order, against the hook pipeline that gates every Write/Edit
(`enforce-tdd`, `verify-test-import`, `verify-no-new-surface`,
`enforce-write-policy`, and the mutation ratchet the repo already carries):

1. `tests/opencode-agent/claude-contract.test.ts` — fixture assertions for the
   fold, the single-model and empty-map fixtures, and a hand-built line with one
   corrupt entry (D2/D3).
2. `opencode-agent/src/claude-contract.ts` — schema and fold.
3. `tests/opencode-agent/claude-adapter.test.ts` — the run's account and the
   `unpriced` outcome over the same corpus; then `claude-spend.ts`'s doc and
   `claude-progress.ts`'s log field (D1/D4).
4. `tests/opencode-agent/adapters.test.ts` — stubbed `session.children`: the sum,
   the nested/cyclic guard, absent-bucket contagion, and the throwing read that
   warns and yields the parent figure.
5. `opencode-agent/src/sdk-contract.ts`, then `opencode-connect.ts` (D5–D7).

Each gated impl file is written only after its test exists and fails. Assertions
are exact totals (90,547, not "greater than 89,624") — a comparison assertion
survives the arithmetic mutants the ratchet scores, and this change is entirely
arithmetic. `enforce-write-policy` forbids inline suppressions, so the tolerant
schemas must typecheck on their own.

## Open Questions

- Does `/session/{id}/children` return direct children only or the whole
  subtree? D5's visited-set traversal is correct either way; the answer only
  removes a redundant call, and needs a live recording to settle.
- Does the live `/children` payload carry `tokens`/`cost` like `session.get`
  does? If a recording shows it does, D5's per-child `get` collapses into the
  one children read. A performance refinement behind the same decoder.
