<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0380: Defer chat-provider-as-plugin until the core/plugin-separation refactor lands

## Status

Deferred

## Date

2026-08-09

## Context

`docs/superpowers/specs/2026-05-23-chat-provider-as-plugin-design.md` is a
draft that migrates the three hardcoded chat providers (Telegram, Mattermost,
Discord) out of `src/chat/{telegram,mattermost,discord}/` into
`plugins/chat-provider-*/` via the existing plugin system (a new
`provider.chat` permission, a `chatProviderTypes` contribution slot, an
auto-approval seed, and a startup reorder so plugin factories register before
`ChatRouter` construction).

The `superpowers-residue-cleanup` change triaged this draft report-only (its
design D4; finding recorded in commit `f2af3d2c4`) and left disposition as a
user gate. Verified current state as of this decision:

- **Unshipped.** Chat providers are still hardcoded in `src/chat/registry.ts`;
  `plugins/` contains task-provider plugins (kaneo, youtrack) but no
  chat-provider plugins.
- **The stated blocker has cleared.** The draft was written when the
  Multi-Provider Router was not yet implemented; `ChatRouter`
  (`src/chat/router.ts`) and `platform_instances` have since shipped, and the
  sibling `task-provider-as-plugin` spec landed (ADRs 0130–0133). The draft
  is therefore unblocked, not waiting on prerequisites.
- **The "global refactoring" track is now actively reshaping the exact
  boundary this draft targets.** Per the archived
  `docs/archive/2026-07-12-hermetic-full-stack-e2e-harness-design.md`,
  papai is undergoing "a parallel global refactoring and architecture-change
  track": the `plugin-core-separation` refactor, proven before/after by the
  hermetic full-stack E2E harness (which must "run the same scenario sources
  and assertions unchanged" across the refactor). This is the live effort
  behind the in-progress changes `plugin-core-separation-toolgate`,
  `trusted-module-hermetic-qualification`, and `hermetic-e2e-core-separation-proof`.
- **A stale prior attempt exists.** A `chat-as-plugin` worktree/branch (last
  touched 2026-06-05) carries a `feat(plugins): migrate chat providers to
  plugin system` commit but has diverged 3883 files / −583k lines from master.
  It is unusable as-is.

## Decision Drivers

- **Do not collide with active refactoring.** Adopting now would build
  against an architecture the `plugin-core-separation` track is mid-rewrite
  of; the work would likely be redone or restructured.
- **Keep the thinking reachable.** The draft's design (lifecycle contracts,
  startup ordering, identity-facade decision, migration layout) is the input
  the post-refactor re-evaluation needs — it must not be deleted or buried.
- **A deferral must be a real trigger, not a perpetual "maybe."** The revisit
  condition has to be concrete and evaluable by a future agent, or "defer"
  silently becomes a non-decision.

## Considered Options

### Option 1 — Defer in place; revisit after the refactor lands (chosen)

Leave the draft in `docs/superpowers/specs/`; record this ADR with an explicit
revisit trigger.

- **Pros:** zero collision with the refactor; the draft stays exactly where
  reachable thinking lives; the ADR's revisit trigger converts the open
  "maybe" into a tracked, evaluable condition.
- **Cons:** the ~2.8-month-old grounding drifts further while deferred;
  revisit is conditional on the refactor actually completing.

### Option 2 — Adopt now, port into an OpenSpec change (rejected)

Port the draft into `openspec/changes/chat-provider-as-plugin/` and implement.

- **Pros:** unblocked; sibling landed; would close the core/transport fork.
- **Cons:** collides with the `plugin-core-separation` refactor that is
  reshaping exactly the core/plugin boundary this draft targets — the central
  reason for deferral.

### Option 3 — Retire / archive to `docs/archive/` (rejected)

Treat as historical and move to `docs/archive/`.

- **Pros:** closes the queue item decisively.
- **Cons:** wrong signal for a deferred item whose re-evaluation is pending
  and may still yield adoption; `docs/archive/` implies "historical/done".

### Option 4 — Revive the stale `chat-as-plugin` branch (rejected)

Continue from the existing branch.

- **Pros:** prior work to build on.
- **Cons:** 3883-file divergence from master makes it unusable as-is;
  restarting fresh post-refactor is cheaper than reconciling.

## Decision

Adopt Option 1. The draft is **deferred**, not retired. It stays in
`docs/superpowers/specs/` unchanged. It is not ported into an OpenSpec change
now, and the stale `chat-as-plugin` branch is not revived.

**Revisit trigger.** After the `plugin-core-separation` refactor **and** its
hermetic full-stack E2E proof harness have landed, re-evaluate:

1. Does the refactor's resulting architecture **supersede** this draft
   (probable — it is reshaping exactly the core/plugin boundary the draft
   targets)? If so, retire the draft and record the supersession.
2. If not fully superseded, does a **focused** chat-provider migration still
   add value on the post-refactor architecture? If so, port a refreshed
   proposal then — grounding it against the post-refactor code, not the
   2026-05-23 baseline.

Either branch starts **fresh**; the stale `chat-as-plugin` branch is not a
starting point.

## Consequences

### Positive

- No collision with the active `plugin-core-separation` refactor.
- The draft remains reachable as input to the post-refactor re-evaluation.
- The decision and its revisit trigger are first-class and indexed, so the
  item stops being a perpetually-open "maybe".

### Negative

- The draft's 2026-05-23 grounding drifts further while deferred; any future
  adoption must re-verify every code pointer.
- The core/transport fork (task providers as plugins, chat providers
  hardcoded) persists until the refactor + revisit resolve it.

### Risks

- A future contributor mistakes the stale `chat-as-plugin` branch for a
  usable starting point. **Mitigation:** this ADR records its unusable
  divergence explicitly; do not revive it.
- The refactor stalls and the deferral becomes effectively permanent.
  **Mitigation:** the revisit trigger is tied to a concrete, tracked
  landing; if the refactor is abandoned, that is itself a decision to record
  (retire the draft at that point).

## Related Decisions

- `superpowers-residue-cleanup` (the report-only triage, design D4; finding
  in commit `f2af3d2c4) — the antecedent that left this as a user gate.
- ADR-0379 lineage: the hermetic-harness / `plugin-core-separation` track is
  the refactor whose landing is this decision's revisit trigger.

## References

- Draft: `docs/superpowers/specs/2026-05-23-chat-provider-as-plugin-design.md`
- Refactor framing:
  `docs/archive/2026-07-12-hermetic-full-stack-e2e-harness-design.md`
- Triage change: `openspec/changes/superpowers-residue-cleanup/`
- Disposition change: `openspec/changes/latent-queue-disposition/`
