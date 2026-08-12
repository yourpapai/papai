## Context

See `proposal.md` — Why. Four consumers (the spec example at spec.md:57, the dead `renderBurndown`, the live `formatEvent(convergence)`, and `materializeReview`'s round header) currently use three format strings; the live one omits `resolved`/`dismissed` and is non-compliant with `sdd-automation` spec:57. Two forward-compat surfaces (`renderGateScreen`, `--wait`) sit dormant with no consumer.

The current `ReplayState` (`events.ts:217`) already carries a partial digest record as `lastVerdict: { round, verdict, counts }` — set by `foldEvent` on `convergence` events. The `resolved`/`dismissed` counts are derivable from the `finding` events (which carry `action: 'resolved' | 'dismissed'`) but the reducer doesn't track them. So the data is already in `events.ndjson` per spec:32's "rebuild by replay" property; only the reducer and formatters are missing.

`cap-hit-fidelity` (next change in the stack) needs a trajectory block at the gate file. Rather than write a bespoke formatter there that this change would immediately refactor, establish the canonical shape here.

## Goals / Non-Goals

**Goals:**

- G1. Close the spec:57 burndown gap — the live scroll region shows `resolved` and `dismissed` counts in addition to class counts and verdict.
- G2. One digest shape, consumed by all four formatters (live burndown, gate-file trajectory block, `materializeReview` round header, `report`).
- G3. Delete dormant forward-compat (`renderGateScreen`, `--wait`) that has zero current consumers — recover the signal that those surfaces don't exist, so the next reader doesn't infer a live-watching mode that isn't there.
- G4. Ship `formatTrajectoryBlock` so `cap-hit-fidelity` consumes it without re-opening this module.

**Non-Goals:**

- N1. No gate-file enrichment (open MATERIAL checkboxes, T1 ack, trajectory block wired into `writeGateDigest`). That's `cap-hit-fidelity`.
- N2. No `--wait` re-implementation or live gate screen restoration. Deleted here; restored together when a real consumer (e.g. `/sdd:auto`) pulls it.
- N3. No change to the convergence predicate (`evaluateConvergence`) or the convergence event schema — the events already carry the data; the reducer and formatters are what's missing.
- N4. No `/sdd:auto` implementation. The doc reference at `docs/architecture/sdd-pipeline.md:62` stays; only the `--wait` flag it implied is removed.

## Decisions

### D1. `DigestRecord` shape

```ts
export interface DigestRecord {
  readonly round: number
  readonly counts: FindingCounts       // { blocker, material, nitpick }
  readonly resolved: number
  readonly dismissed: number
  readonly verdict: 'converged' | 'open'
}
```

**Why these five fields.** They are exactly what spec:57 mandates ("findings by class, resolutions, dismissals, and the convergence verdict") plus `round` for ordering. Nothing else. `FindingCounts` (already in `events.ts:31`) is reused verbatim — no newTuple type.

**Why not extend `lastVerdict`.** `ReplayState.lastVerdict` (events.ts:221) is a strict subset of `DigestRecord` (it lacks `resolved`/`dismissed`). Replacing it with a `perRound: DigestRecord[]` and providing `lastVerdict` as a derived view (`perRound[perRound.length - 1]` or `null`) unifies the two concepts and removes the duplication. Call sites that read `state.lastVerdict` keep working via the derived accessor.

**Alternatives considered.**

- *Extend the `convergence` event schema with `resolved`/`dismissed`.* Rejected: duplicates data already carried by `finding` events and violates the "rebuild by replay" principle by making the convergence event self-sufficient when the event stream is supposed to be.
- *Make `DigestRecord` carry per-finding detail (id, gap, outcome).* Rejected: that's the gate-file surface, not the burndown. `cap-hit-fidelity` adds open-MATERIAL detail to its own digest input; `DigestRecord` stays per-round aggregate.

### D2. Reducer placement: `ReplayState.perRound: readonly DigestRecord[]`

**Decision.** The `foldEvent` reducer (events.ts:273) accumulates per-round `{ resolved, dismissed }` counts from `finding` events keyed by `event.round`, and flushes a `DigestRecord` to `perRound` when it sees the matching `convergence` event. `ReplayState` gains:

```ts
export interface ReplayState {
  // ...existing fields...
  readonly perRound: readonly DigestRecord[]
  readonly lastVerdict: DigestRecord | null    // now full record, derived from perRound
}
```

**Why reducer-side, not renderer-side.** The renderer is a pure function of `ReplayState` (passed to `renderState`) plus the live event (passed to `renderEvent`). If the per-round accumulator lived in the renderer's closure, `replayEvents` (events.ts:294) couldn't reproduce it from `events.ndjson` alone — violating spec:32 ("reproduces the round burndown from `events.ndjson`"). Keeping the records in `ReplayState` makes the reducer the single source of truth; the renderer reads from `state.perRound`.

**Flush trigger.** Flush on `convergence` (the existing `lastVerdict` trigger), not on `round_close`. `convergence` carries the verdict; `round_close` is just a marker. The burndown line is the *content* of the convergence decision; the close marker is bookkeeping. (The renderer may choose to print the line at the `round_close` event boundary for visual rhythm, but reading from `state.perRound[last]` is the same either way.)

**Edge cases.**

- *Convergence with zero prior findings* (the resolver dismissed everything before classification, or the reviewer raised nothing): `resolved=0, dismissed=0`, still a valid record.
- *Out-of-order or missing convergence* (a round that hit cap without a convergence event — currently impossible because `runRound` always emits convergence before returning, but defensive): the per-round accumulator entry stays orphaned; `perRound` simply doesn't get that round's record. No exception.

### D3. Formatter home: `renderer.ts`

**Decision.** `formatBurndownLine(record: DigestRecord): string` and `formatTrajectoryBlock(records: readonly DigestRecord[]): string` live in `renderer.ts`, alongside `formatEvent` and `renderPipelineMap`. No new file.

**Rationale.** `renderer.ts` already owns the "format the digest for a surface" functions. A separate `digest.ts` would split one cohesive responsibility across two files for ~60 lines of code. The deletion of `renderBurndown` and `renderGateScreen` frees roughly the space the two new formatters occupy.

### D4. Delete `renderGateScreen` and `--wait` (L1-X)

**Decision.** Remove:

- `renderGateScreen` from `renderer.ts:78` + its describe block in `tests/sdd-runner/renderer.test.ts:121`
- `--wait` parse from `cli.ts:59-65`, the `wait: boolean` field from `StartOptions` (`orchestrator.ts:41`), the `wait` thread through `cli.ts:22`, and the `--wait` mention in the index.ts help string (`index.ts:29`)

**Rationale.** The exploration surfaced that *no current consumer* exercises these surfaces — not even `/sdd:auto`, which is a doc reference at `docs/architecture/sdd-pipeline.md:62`, not code. `renderGateScreen` is exported + tested + never called; `--wait` is parsed + plumbed + never read. Both were placed for a live-watching TUI future that didn't ship.

Keeping dormant forward-compat carries real cost: it misleads the next reader into inferring a live-watching mode that doesn't exist, and `shared-tui-renderer`'s design (proposal:10, design:110) currently *preserves* `renderGateScreen` as if it were live code — propagating the misconception. Deleting forces the prose correction (task 6.1).

**Restoration cost is low.** `renderGateScreen` was 12 lines + 10 test lines; `--wait` is ~5 lines across three files. Re-adding them together when a real consumer materializes (most likely `/sdd:auto`) is cheaper than maintaining the dormant surface and explaining it to every future reader.

**Alternatives considered.**

- *Defer with intent (L1-Y): leave code, add a "known dead" comment.* Rejected: the comment doesn't fix `shared-tui-renderer`'s misconception, and "known dead" code tends to accumulate. Delete is more honest.
- *Wire minimally (L1-Z): print the gate screen in `--wait` mode.* Rejected: wires a surface with zero consumers, validated against nothing. The whole point of deleting is that the consumer-driven design loop never ran; re-adding when a consumer pulls ensures it runs.

### D5. `formatTrajectoryBlock` ships without an immediate consumer

**Decision.** Ship the formatter here even though its first consumer (`cap-hit-fidelity`'s gate-file trajectory block) is the next change.

**Rationale.** The alternative — deferring the formatter to `cap-hit-fidelity` — blurs the change boundary: `cap-hit-fidelity` would re-open `renderer.ts` to add a function that's pure digest formatting, contradicting its "gate-file enrichment" scope. The "speculative API" period is one change, after which the function has a real consumer.

**Shape.**

```ts
export function formatTrajectoryBlock(records: readonly DigestRecord[]): string
```

Renders one `formatBurndownLine(record)` per record, prefixed with a `### Cap-hit trajectory` heading when non-empty. `cap-hit-fidelity`'s `writeGateDigest` will call this and splice the result into the gate file. The heading is part of the block so the gate renderer doesn't have to know the format.

### D6. `materializeReview` round header alignment (SQ3)

**Decision.** Refactor `materialize.ts:63`'s verdict line to format from a `DigestRecord` rather than recomputing `resolved`/`dismissed` inline. The line currently reads:

```
**Verdict**: open — 0b 6m 3n · 8 resolved · 1 dismissed
```

After alignment it reuses `formatBurndownLine` (or a sibling markdown-aware variant) so the field set matches spec:57 exactly. The `**Verdict**:` markdown prefix stays (it's a review.md convention, not a digest-shape concern); only the body is shared.

**Rationale.** Defining a canonical shape and then letting one consumer keep its own format defeats the point. The cost is one formatter swap; the benefit is that the "canonical" claim is honest — all four consumers (live burndown, trajectory block, review.md header, future `report`) read from the same function.

### D7. Burndown line format string

**Decision.** `formatBurndownLine` produces:

```
round <k>: <B>b <M>m <N>n · <R> resolved · <D> dismissed · <verdict>
```

Matching the spec example's field set and ordering. (Spec:57's example uses uppercase `B/M/N` for the *example*; the binding requirement is the field set, not the case. The lowercase form is consistent with `materializeReview`'s existing output and with `renderBurndown`'s tested behavior, minimizing review.md diff churn.)

**Why trailing verdict.** The spec example puts the verdict last (`· converged`). The live `formatEvent(convergence)` currently puts it first (`round k: converged (counts)`). Trailing matches spec; trailing it is.

## Risks / Trade-offs

- **[Speculative API]** `formatTrajectoryBlock` ships without a consumer → *Mitigation*: `cap-hit-fidelity` is the immediate next change; if its design shifts the trajectory shape, revisit then. The function is ~10 lines; revision cost is low.
- **[Deletion reversal cost]** Restoring `renderGateScreen` + `--wait` later → *Mitigation*: 12 lines + 10 test lines + ~5 parse lines; re-adding is cheaper than maintaining dormant. The restoration happens consumer-driven, so the design loop actually runs.
- **[Cross-change prose drift]** `shared-tui-renderer`'s proposal:10 and design:110 reference `renderGateScreen` as preserved domain logic that this change deletes → *Mitigation*: task 6.1 updates those references directly. Without that task, the prose would be cleaned up at archive anyway, but the explicit update prevents the next reader of `shared-tui-renderer` from being misled.
- **[Stack ordering]** Three changes now stack: `canonical-digest` → `cap-hit-fidelity` → `shared-tui-renderer` (for clean renderer.ts merge). None have hard code dependencies today, but merge conflicts in `renderer.ts` increase if they land in the wrong order → *Mitigation*: `canonical-digest` lands first (touches renderer.ts most invasively); `cap-hit-fidelity` consumes the new API; `shared-tui-renderer` lands last (its renderer.ts edits are the smallest — only the middle-dot and `RendererStream` import changes — and benefit from `renderBurndown`/`renderGateScreen` already being gone).
- **[Reducer state growth]** `ReplayState.perRound` grows with round count → *Mitigation*: bounded by depth profile (S:1, M:3, L:4). Trivially small.

## Migration Plan

No data migration. `sdd-runner` run state is gitignored and per-run; existing `events.ndjson` files replay correctly because the reducer derives `perRound` from `finding` events that were always emitted. Old runs without recent `finding` events still produce correct `DigestRecord`s (resolved/dismissed default to 0 if no finding events fire). Rollback: `git revert`. No deployed artifacts, no production state.

## Open Questions

- **OQ1.** Should `formatBurndownLine` and the `materializeReview` header share a single helper, or stay two functions that happen to produce the same field set? *Deferrable*: doesn't change the shape or task breakdown; answer when implementing D6 (the markdown prefix is the only structural difference).
- **OQ2.** When `formatTrajectoryBlock`'s heading (`### Cap-hit trajectory`) is spliced into the gate file by `cap-hit-fidelity`, should the heading be conditional on cap-hit (early gate only) or always present when records exist? *Deferrable*: this change ships the formatter; `cap-hit-fidelity`'s `writeGateDigest` decides when to call it. Captured here only so the formatter signature is stable.
