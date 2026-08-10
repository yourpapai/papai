<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0310: Archive the Pre-processing Classifier Plan — Do Not Implement as Written

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-03-22-preprocessing-classifier-implementation.md` is a
1,039-line Draft plan (still marked `**Status:** Draft`, line 14) that adds a
pre-processing classification step using the configured `small_model` to detect
behavioral instructions in user messages **before** the main LLM call. When an
instruction is detected it is extracted, persisted through the existing custom
instructions layer, and a transient system hint is injected so the main LLM can
acknowledge it. The plan scopes eight tasks across five target files:
`src/classifier.ts` (Create), `src/llm-orchestrator.ts` (Modify), and three test
files (`tests/classifier.test.ts`, `tests/llm-orchestrator-classifier.test.ts`,
`tests/classifier-integration.test.ts`). It explicitly states it **extends** an
approved design doc, `2026-03-22-custom-instructions-design.md`.

A codebase verification against the current tree (2026-08-07) found the plan
**not implemented** — 0 of its 5 target files exist: `src/classifier.ts` is
absent, `src/llm-orchestrator.ts` has no `runPreprocessingClassifier` /
`handleClassificationResult` / `classifyMessage` integration (a grep across
`src/` returned zero hits; the only `classifier` matches are in the unrelated
`src/analytics/intent/` modules), and none of the three test files exist. The
plan has been a Draft for ~4.5 months and was never started.

The prerequisite the plan depends on **is** present: `src/instructions.ts`
exposes `saveInstruction` / `listInstructions` / `deleteInstruction` with
exactly the result statuses the plan assumes (`saved` / `duplicate` /
`cap_reached` / `not_found`), the `user_instructions` table and migration
`012_user_instructions.ts` exist, the `small_model` config key exists, and the
explicit `save_instruction` tool is registered and wired into the system prompt.
So the feature's foundation is real — the problem is the plan's **integration
layer is stale**:

- **Task 2's config model was removed.** The plan's `runPreprocessingClassifier`
  reads `getConfig(contextId, 'llm_apikey' | 'llm_baseurl' | 'main_model' |
  'small_model')` and builds a model with `buildOpenAI(...)`. Those per-context
  config keys were actively deleted by migration
  `036_drop_user_llm_config.ts` and re-homed into the `llm_admin_roles` /
  multi-provider table by migration `067_multi_llm_providers.ts`
  (ADR-0230, ADR-0287). The model is no longer resolved per-context from flat
  keys; it is resolved from the multi-provider architecture. Task 2 as written
  would not compile or run against the current code.
- **Task 7's edit target moved.** The plan appends a `LEARNED PREFERENCES`
  block to `STATIC_RULES` in `src/llm-orchestrator.ts`. The instruction rule now
  lives in `src/system-prompt.ts` (`INSTRUCTIONS_RULE`, line 145), gated on
  `enabled.has('save_instruction')` — a separate module the plan does not
  reference.
- **The design doc it extends does not exist.** `2026-03-22-custom-instructions-design.md`
  appears nowhere under `docs/`. The custom-instructions *feature* was built
  (storage layer + tools + schema + migrations), but the design the plan claims
  to extend was never committed or has been pruned.
- **No OpenSpec counterpart.** The repo's mandatory planning workflow is now
  OpenSpec (`/opsx:explore` / `/opsx:propose`); this plan lives under the legacy
  `docs/superpowers/plans/` shelf and has no entry under `openspec/changes/`.

Executing the plan as written would thus require silently rewriting its core
deliverable (Task 2) against a different provider-resolution abstraction than
the one it specifies, and re-targeting Task 7 at a module it does not name.

## Decision Drivers

- **Foundation is real but the integration layer is stale.** The classifier
  module itself (Tasks 1, 3, 6) is still implementable as-written; the part
  that delivers value (Task 2: wiring it into `processMessage`) is built on a
  config model that no longer exists.
- **Architecture has diverged.** Provider/model resolution is the
  `llm_admin_roles` multi-provider layer (ADR-0230 / ADR-0287), not flat
  per-context keys. Re-introducing `getConfig(contextId, 'small_model')`-style
  reads would reverse a deliberate, migrated-to architecture.
- **Design dependency is missing.** The plan's stated basis
  (`2026-03-22-custom-instructions-design.md`) is absent, so the "extends an
  approved design" premise cannot be verified.
- **Feature value overlaps existing capability.** Implicit detection is a UX
  convenience on top of explicit capture that the live `save_instruction` tool
  + `INSTRUCTIONS_RULE` system-prompt guidance already provide. The marginal
  value does not justify resurrecting stale integration assumptions.
- **Plan rot and misleading shelf.** A Draft that has sat untouched for ~4.5
  months, with no checkboxes and no companion status doc, presents as
  actionable backlog while contradicting the real provider architecture.
- **Stale plans mislead.** Mirrors the rationale of ADR-0309: leaving an
  un-implementable plan on the active shelf invites future effort against a
  target that no longer matches the code.

## Considered Options

### Option 1 — Archive the plan; pursue implicit detection (if wanted) via a fresh OpenSpec proposal (chosen)

Mark the plan superseded and move it off the active plans shelf. If implicit
behavioral-instruction detection is still wanted, route it through
`/opsx:propose` grounded in the current multi-provider model-resolution layer
and the `src/system-prompt.ts` rule surface, rather than the removed flat-config
model. Keep the existing `src/instructions.ts` storage layer and the live
`save_instruction` tool as inputs.

- **Pros:** stops effort bleeding into an un-implementable integration target;
  removes the misleading shelf entry; preserves the legitimate UX need as a
  clean input for a grounded re-proposal; no reversal of the multi-provider
  architecture; the still-valid classifier module can be lifted into the new
  proposal with minimal rework.
- **Cons:** implicit instruction detection remains unavailable until a fresh
  proposal is written and executed; the eight tasks carry a one-time
  re-scoping cost (chiefly re-architecting Task 2's model resolution).

### Option 2 — Implement the plan as written (rejected)

Execute Tasks 1–8 against the plan's stated integration code.

- **Pros:** the plan is fully specified (1,039 lines, eight TDD-shaped tasks,
  risk matrix, dependency graph).
- **Cons:** Task 2's `getConfig(contextId, 'small_model' | 'llm_apikey' |
  'llm_baseurl')` calls reference keys that migrations 036 and 067 deleted; it
  cannot be implemented without silently rewriting the provider-resolution
  logic against `llm_admin_roles`. Task 7 targets a `STATIC_RULES` symbol in
  `src/llm-orchestrator.ts` that has moved to `src/system-prompt.ts`. The
  design doc it extends is missing. Net effect: "implementing the plan"
  actually means overriding its foundational assumptions — at which point the
  plan is not the plan. Effort high, worthiness low.

### Option 3 — Partial salvage: lift the classifier module now (rejected)

Extract the still-valid pieces (Tasks 1, 3, 6: `src/classifier.ts`,
`ClassificationSchema`, `CLASSIFIER_PROMPT`, the timeout guardrail, and the
schema/prompt tests) and land them without the `processMessage` integration.

- **Pros:** ships a small, self-contained, correct module ahead of the wiring.
- **Cons:** a classifier with no caller is inert. The whole point of the
  feature is the pre-`callLlm` step (Task 2); landing the module in isolation
  creates a dead-code maintenance surface and a false sense of progress.
  Better to scope the module together with its (re-architected) consumer in a
  fresh proposal than to land an orphan.

## Decision

**Archive the plan. Do not implement it as written.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`) so it no longer
   presents as actionable backlog.
2. **Do not reintroduce flat per-context LLM config keys.** Provider/model
   resolution stays on the `llm_admin_roles` multi-provider architecture
   (ADR-0230 / ADR-0287). Any pre-processing classifier must obtain its model
   from that layer, not from `getConfig(contextId, 'small_model')`.
3. **Re-route implicit detection if still wanted.** Any future work enters
   through `/opsx:explore` / `/opsx:propose` against the current
   model-resolution and `src/system-prompt.ts` surfaces, treating
   `src/instructions.ts` and the live `save_instruction` tool as inputs rather
   than as consequences of a missing design doc.
4. **Keep the existing storage layer and explicit tool.** `src/instructions.ts`
   and the `save_instruction` / `list_instructions` / `delete_instruction`
   tools are valid independent of this plan and remain the canonical
   instruction-capture path.
5. **A fresh proposal may reuse the classifier module design.** Tasks 1, 3, and
   6 (the `classifyMessage` function, Zod schema, prompt, and timeout
   guardrail) are sound and transferable; only their consumer must be
   re-authored against the real provider layer.

## Consequences

### Positive

- A high-effort, low-worthiness integration task (rewriting Task 2 against a
  removed config model) is removed from the actionable backlog.
- The active plans shelf no longer carries a target that contradicts the real
  multi-provider architecture.
- No reversal of the migrated-to `llm_admin_roles` provider layer.
- The legitimate UX need (implicit instruction detection) is preserved as a
  re-scoping input rather than lost; a future proposal starts from the actual
  code, and the still-valid classifier module is available to lift.
- Mirrors and reinforces the precedent set by ADR-0309 for retiring stale
  `docs/superpowers/plans/` entries.

### Negative

- Implicit instruction detection (auto-capture of "always…", "never…", "from
  now on…" messages without an explicit tool call) remains unavailable until a
  fresh proposal is written and executed.
- Users continue to rely on the LLM spontaneously invoking
  `save_instruction`, which the plan was specifically designed to supplement.
- One-time cost to re-scope the eight tasks against the current architecture
  (chiefly Task 2's model resolution and Task 7's prompt location).

### Risks

- **The underlying UX need goes unmet.** Behavioral preferences that users
  phrase conversationally may not be captured unless the main LLM decides to
  call the tool. Mitigation: the `INSTRUCTIONS_RULE` prompt guidance already
  nudges the model toward `save_instruction`; if capture-rate pain resurfaces,
  that is the trigger to open the fresh OpenSpec proposal referenced above.
- **Future agents rediscover the stale plan and treat it as actionable.**
  Mitigation: the plan's relocated copy and this ADR both carry the superseded
  marker and a pointer here.
- **Re-proposal re-derives similar design.** Some structure (the
  classification enum, the revocation word-overlap matcher, the graceful
  fallback) is likely to recur; that is acceptable because it will be grounded
  in the real provider-resolution path rather than assumed.

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan: the direct
  precedent for retiring a stale, un-implementable `docs/superpowers/plans/`
  entry whose dependency stack was superseded. Same decision shape; this ADR
  mirrors its structure.
- **ADR-0287** — Multi LLM Providers Backend: documents the `llm_admin_roles`
  multi-provider architecture that replaced the flat per-context LLM config
  keys this plan's Task 2 reads from.
- **ADR-0230** — Phase 4a Multi-Provider: the broader provider-abstraction
  redesign that made the plan's `getConfig(contextId, 'small_model')` model
  obsolete.
- **ADR-0237** — Phase 4d Model Selection: current model-selection surface any
  future classifier must obtain its `small_model` from.

## References

- Plan: `docs/superpowers/plans/2026-03-22-preprocessing-classifier-implementation.md`
  (`**Status:** Draft`, line 14; 1,039 lines; eight tasks; no checkboxes).
- Missing design dependency: `2026-03-22-custom-instructions-design.md`
  (referenced in the plan body; absent from `docs/`).
- Codebase verification (2026-08-07): `src/classifier.ts` and the three target
  test files absent; `src/llm-orchestrator.ts` has no classifier integration
  (grep for `classifyMessage` / `runPreprocessingClassifier` in `src/`
  returned zero hits; the only `classifier` matches are in unrelated
  `src/analytics/intent/` modules).
- Valid prerequisite: `src/instructions.ts` exposes
  `saveInstruction` / `listInstructions` / `deleteInstruction` with the
  statuses the plan assumes (`saved` / `duplicate` / `cap_reached` /
  `not_found`); `user_instructions` table + migration `012_user_instructions.ts`
  present; `save_instruction` tool registered and wired into
  `src/system-prompt.ts:145` (`INSTRUCTIONS_RULE`).
- Staleness evidence: migrations `036_drop_user_llm_config.ts` and
  `067_multi_llm_providers.ts` removed the `llm_apikey` / `llm_baseurl` /
  `main_model` / `small_model` keys Task 2 depends on; `STATIC_RULES` target
  for Task 7 moved to `src/system-prompt.ts`.
