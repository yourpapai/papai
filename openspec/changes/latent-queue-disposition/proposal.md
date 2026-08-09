<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Latent queue disposition

## Why

`superpowers-residue-cleanup` triaged two latent drafts in the frozen
`docs/superpowers/` tree but left disposition as a user gate (its design D4:
"adoption or retirement is a separate user-gated act"). Both have sat
undecided since. This change records the two dispositions as ADRs so the
queue stops carrying open "maybe" items, and acts on the retire side.

## What Changes

- **ADR-0380 (Deferred)** — `chat-provider-as-plugin`. Do not adopt now: the
  `plugin-core-separation` refactor + hermetic E2E harness (the in-flight
  "global refactoring" track, per the archived
  `2026-07-12-hermetic-full-stack-e2e-harness-design.md`) are actively
  reshaping the exact core/plugin boundary this draft targets. Acting now
  would collide and likely be redone. The draft stays frozen in the legacy
  tree as reachable thinking. Revisit trigger and the stale-branch warning
  are captured in the ADR.
- **ADR-0381 (Retired/Archived)** — `llm-rate-limiting-and-plans`. Retire
  from the live queue; `git mv` the 3-file cluster (note + phases companion
  - design spec) from `docs/superpowers/{notes,specs}/` to `docs/archive/`.
    When cost pressure arrives, start fresh research rather than resurrect —
    the 2026-05 grounding is stale enough that a clean redesign is cheaper
    than porting.
- **Index** — add rows for ADR-0380/0381 to `docs/adr/README.md`.

## Capabilities

### New Capabilities

None — pure docs/process change. `skip_specs: true` is set in
`.openspec.yaml`.

### Modified Capabilities

None. `openspec/specs/` is empty; no spec-level behavior changes.

## Non-goals

- No adoption of `chat-provider-as-plugin` — it is deferred, not ported into
  an OpenSpec change here.
- No re-design of rate limiting — the draft is archived as historical; future
  work starts fresh.
- No deletion of the `chat-provider-as-plugin` draft (deferred, not retired).
- No revival of the stale `chat-as-plugin` branch (last 2026-06-05,
  3883-file divergence) — the ADR records it as unusable as-is.
- No runtime code, no DB, no dependency, no scope-model or tool-gating
  impact. No platform/task instance or config-context scope impact
  (docs-only).

## Impact

- **Docs:** two new ADRs under `docs/adr/` (0380, 0381); three files moved
  `docs/superpowers/{notes,specs}/` → `docs/archive/`; two rows added to
  `docs/adr/README.md`.
- **Cross-references:** the rate-limit cluster's internal relative links
  (note ↔ phases ↔ design spec) stay valid post-move only if they move
  together; verified in tasks. No other docs reference the moved paths
  except the cleanup change's own (historical) findings.
- **OpenSpec tree:** this change only.
