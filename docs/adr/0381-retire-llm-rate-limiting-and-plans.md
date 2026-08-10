<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0381: Retire llm-rate-limiting-and-plans — archive the draft, restart fresh later

## Status

Retired

## Date

2026-08-09

## Context

`llm-rate-limiting-and-plans` is a 3-file draft cluster proposing
admin-managed **plans** with multi-dimensional **quotas** for LLM usage, tool
execution, web fetches, and attachment storage, enforced before each
chargeable operation and reconciled with the existing usage event stream. The
cluster comprises:

- `docs/superpowers/notes/llm-rate-limiting-and-plans.md` (high-level design),
- `docs/superpowers/notes/llm-rate-limiting-and-plans-phases.md` (phase
  decomposition), and
- `docs/superpowers/specs/2026-05-21-llm-rate-limiting-and-plans-design.md`
  (design spec).

The `superpowers-residue-cleanup` change triaged this cluster report-only
(its design D4; finding in commit `f2af3d2c4`) and left disposition as a user
gate. Verified current state as of this decision:

- **Unshipped.** There is no `src/quota/` module, no `plans` / `plan_limits`
  / `subject_plan` / `quota_counter` / `plan_audit` tables, and no
  enforcement layer. Only the spec's verified-context base exists
  (`src/usage/recorder.ts`, `llm_usage_events`, the fixed-window
  `web_rate_limit` quota, the Billing panel, the deferred-prompts path).
- **~2.8 months old.** Grounded as of 2026-05-20; the verified-context
  pointers (orchestrator config shape, deferred-prompts internals,
  attachment/S3 paths, `model_role` handling) have had time to drift.
- **No current cost pressure.** The existing per-minute web-fetch quota
  covers the one resource with a hard external cost; there is no active
  multi-user/BYOK spend driver forcing the (large) v1 scope now.
- **The v1 scope is large.** Five new tables, a new `src/quota/` module with
  atomic `reserve`/`commit` SQL for two algorithms (fixed-window + token-bucket),
  orchestrator + tool-wrapper integration, a deferred-prompt fallback chain
  (§7.4, the most novel/risky part), an admin dashboard, two tools, two slash
  commands, admin commands, and HTTP routes.

## Decision Drivers

- **Close the open "maybe," but keep the reference value.** The draft's
  failure modes, algorithm survey, and data-model reasoning remain useful
  reference for a future attempt even though its grounding is stale.
- **Do not port stale grounding.** At ~2.8 months, re-verifying every code
  pointer and porting the design is costlier than a clean redesign when
  actual cost pressure arrives.
- **No forcing function now.** Without active cost pressure, the large v1
  scope is not justified; keeping it in the live queue perpetuates an open
  question.

## Considered Options

### Option 1 — Retire; archive the cluster to `docs/archive/` (chosen)

Move the 3-file cluster to `docs/archive/` as historical record; record this
ADR; future work starts fresh.

- **Pros:** closes the queue item; preserves the design as readable history
  for the fresh research; `docs/archive/` is the established home for
  historical-but-readable design docs (precedent: the tier roadmap and the
  hermetic-harness design live there).
- **Cons:** future agents must not mistake the archive for current direction.

### Option 2 — Defer in place like chat-provider (rejected)

Leave in `docs/superpowers/` with a revisit trigger.

- **Pros:** keeps the draft in the live tree.
- **Cons:** the disposition is retire, not defer; leaving it in the live
  legacy tree keeps a "maybe" alive that retire explicitly closes.

### Option 3 — Delete outright (rejected)

Remove the cluster entirely.

- **Pros:** minimal tree.
- **Cons:** loses the reference value (algorithm survey, failure-mode
  reasoning, data model) that would inform a future fresh design.

### Option 4 — Adopt / port into an OpenSpec change now (rejected)

Port the draft and implement.

- **Pros:** ships the capability.
- **Cons:** large v1 scope with no current cost pressure to justify it;
  grounding is stale enough that porting is costlier than redesigning.

## Decision

Adopt Option 1. The cluster is **retired** from the live queue and moved to
`docs/archive/` as historical record. When cost pressure actually arrives
(multi-user / BYOK spend, a need for per-subject token/request caps beyond
the existing web-fetch quota), start **fresh** research and design rather
than resurrecting this draft — the 2026-05 grounding will be cheaper to
rederive against then-current code than to port and re-verify.

The archived cluster is **reference, not direction.** A future attempt may
reuse the algorithm survey (fixed-window vs token-bucket tradeoffs), the
subject-identity reasoning (decoupling `subject_id` from
`storage_context_id` to avoid per-thread plans), and the reservation/reconciliation
shape — but must re-ground them against the codebase at that time.

## Consequences

### Positive

- The queue stops carrying an undecided large-scope item.
- The design content survives as readable history for the eventual fresh
  attempt.
- The web-fetch quota (the one resource with a hard external cost today)
  continues to enforce independently; retiring this draft changes no runtime
  behavior.

### Negative

- If cost pressure arrives sooner than expected, some re-derivation work
  repeats. Accepted: the 2026-05 grounding was already drifting, so
  porting would have repeated much of that work anyway.

### Risks

- A future agent mistakes the archived draft for current direction.
  **Mitigation:** `docs/archive/` is the established historical location, and
  this ADR's Retired status makes the "historical, supersede-by-fresh-research"
  posture explicit.

## Related Decisions

- `superpowers-residue-cleanup` (the report-only triage, design D4; finding
  in commit `f2af3d2c4) — the antecedent that left this as a user gate.
- ADR-0380 — the companion disposition (defer, not retire) for
  chat-provider-as-plugin; unrelated domains, recorded separately by design.

## References

- Archived cluster (post-decision): `docs/archive/llm-rate-limiting-and-plans.md`,
  `docs/archive/llm-rate-limiting-and-plans-phases.md`,
  `docs/archive/2026-05-21-llm-rate-limiting-and-plans-design.md`
- Triage change: `openspec/changes/superpowers-residue-cleanup/`
- Disposition change: `openspec/changes/latent-queue-disposition/`
