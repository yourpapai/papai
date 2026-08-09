<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Superpowers residue cleanup

## Why

The Lane 0 drain emptied `docs/superpowers/plans/` and `remaining/`, but the
tree still mixes three natures under one "frozen historical record" banner:
living operational docs (the e2e planning workflow + test-plan template,
actively referenced by `tests/CLAUDE.md`), dead code (a pi-coding-agent
extension whose runtime was removed in `ec6cd43df`), and genuine history
(notes/, specs/). The workflow doc's canonical tier-taxonomy reference
points at a spec the drain moved to `docs/archive/`, and its residency
under the freeze banner misleads every agent sent there.

## What Changes

- **Retire** `docs/superpowers/extensions/compact-tools.ts` — orphaned
  pi-coding-agent extension; `.pi/extensions/` was deleted and pi wiring
  removed in `ec6cd43df`; `@mariozechner/pi-coding-agent` is not a
  dependency. Nothing loads this file.
- **Move** `e2e-planning-workflow.md` → `docs/operations/e2e-planning-workflow.md`
  and `templates/e2e-test-plan-template.md` →
  `docs/operations/templates/e2e-test-plan-template.md` (operational docs
  beside the migration/analytics runbooks).
- **Tier canon inversion (ADR-0324 follow-through):** the workflow doc's
  mirrored Realism Tiers table becomes the canonical definition; the
  archived `2026-07-23-tier-expansion-roadmap-design.md` becomes purely
  historical. Fixes the dangling "Canonical definition" pointer.
- **Update pointers:** `tests/CLAUDE.md` (workflow/template location),
  the workflow doc's own "Starting Point" path, `docs/superpowers/README.md`
  (the freeze carve-out for these files disappears), `CLAUDE.md` doc index
  if warranted.
- **Triage two latent items** in the frozen residue:
  `notes/llm-rate-limiting-and-plans.md` (draft; billing-plans side possibly
  unshipped) and `specs/2026-05-23-chat-provider-as-plugin-design.md`
  (draft; providers are still not plugins) — code check per the migration
  runbook's signals; dispositions are user decisions (Lane 1 adopt / Lane 3
  retire / leave frozen).

## Capabilities

### New Capabilities

None — pure docs/process change. `skip_specs: true` is set in
`.openspec.yaml`.

### Modified Capabilities

None. No spec-level behavior changes.

## Non-goals

- No relocation of `notes/` or the 31 frozen `specs/` — the freeze and the
  lazy Lane 2 seed model stand (D1 of the migration design).
- No wholesale move of `docs/superpowers/` into `docs/archive/` — ~94 ADR
  files reference its paths; churn without functional gain.
- No adoption of the triaged latent items in this change — the triage
  output is a recommendation, adoption is a separate user-gated Lane 1.
- No runtime code, no DB, no dependency, no scope-model or tool-gating
  impact.

## Impact

- **Docs:** two files moved within `docs/`; pointer edits in
  `tests/CLAUDE.md`, `docs/superpowers/README.md`, the moved workflow doc;
  `docs/superpowers/extensions/` removed.
- **OpenSpec tree:** this change only.
- **References:** `docs/adr/0324` names the tier-canon relationship this
  change inverts; the ADR itself is historical and is not edited.
