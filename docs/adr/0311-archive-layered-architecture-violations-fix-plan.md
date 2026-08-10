<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0311: Archive the Layered Architecture Violations Fix Plan — Do Not Implement as Written

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-03-26-layered-architecture-violations-fix.md` is a
1,340-line development plan that scopes 12 tasks across 10 phases to "verify and
fix all layered architecture violations identified in ADR-0008," then produce a
new `docs/adr/0035-layered-architecture-verification-guidelines.md` plus an
automated `scripts/check-architecture.sh` guard. Its central premise is a
`src/providers/factory.ts` exposing `buildProviderForUser`, and it assumes a
four-layer architecture in which `llm-orchestrator.ts` is the single LLM
model-building entry point, `scheduler.ts` builds providers locally, and
`commands/context.ts` is the only commands-layer file importing the `ai` SDK.

A codebase verification against the current tree (2026-08-07) found the plan
**not implemented** — 0/12 tasks completed, recorded in
`docs/superpowers/notes/provider-abstraction-architecture-plugin-execution-order.md`
("❌ Not implemented | 0/12 tasks completed"). Concretely:

- **The central target does not exist.** `src/providers/factory.ts` is absent,
  and `buildProviderForUser` is defined nowhere in `src/`. Providers are now
  resolved through the plugin-contributed registry (`src/providers/registry.ts`,
  `resolver.ts`, `auto-provision.ts`; ADR-0123 / ADR-0129 / ADR-0130–0133).
- **None of the plan's file deliverables exist.** No `src/recurring-missed.ts`
  (Task 5); no `src/tools/deferred/` (Task 10 — `src/deferred-prompts/tools.ts`
  is still in place); no `docs/adr/0035-*.md`, no
  `scripts/check-architecture.sh`, no `check:architecture` script in
  `package.json` (Task 12).
- **The plan's foundational ADR references do not resolve.** ADR-0008 in this
  repo is titled "DDD Tactical Patterns," not "Layered Architecture Current State
  and Violations" (the layered-architecture work is ADR-0007); ADR-0008's source
  file was pruned with the 0001–0100 batch, and ADR-0035 does not exist.
- **The plan's working directory is a different checkout** — every command reads
  `cd /Users/ki/Projects/experiments/papai`, not this repository.

Most importantly, the plan's highest-value targets were **superseded by a
different design** rather than merely left undone:

- Duplicate LLM model building was eliminated, but by introducing
  `src/llm-model-builder.ts` (`getOpenAICompatibleProvider`, `buildChatModel`)
  that both `llm-orchestrator.ts` and `src/deferred-prompts/proactive-llm.ts`
  import — not by extending `llm-orchestrator.ts` with `buildModel` /
  `persistFactsFromResults` as the plan prescribes.
- `src/scheduler.ts` no longer contains `buildProviderForUser`,
  `createProvider`, or `TASK_PROVIDER`; provider construction moved entirely
  into the registry/resolver layer (Task 4's goal, achieved another way).
- `src/llm-orchestrator.ts` no longer imports `KaneoClassifiedError` /
  `YouTrackClassifiedError` (Task 8's goal, already satisfied).

What remains are low-severity, isolated violations that still hold verbatim
against the current tree:

- `src/history.ts:10` and `src/memory.ts:11` still `import { getDrizzleDb }`
  (Tasks 2, 3) — cache-layer delete delegation not added.
- `src/tools/resume-recurring-task.ts:14` still imports `createMissedTasks` from
  `../scheduler.js` (Task 5) — a Tools → Infrastructure → Presentation transitive
  dependency.
- `src/commands/context.ts`, `context-collector.ts`, and
  `context-tool-resolution.ts` import from `'ai'` (Task 9) — the violation count
  grew from one file to three.
- Tool definitions remain outside `src/tools/` (Task 10).

Executing the plan as written would thus require first re-scoping half its tasks
(4, 5, 6, 8) against the current registry/resolver design, renumbering both ADR
references, and re-grounding every path — at which point it is a new plan, not an
execution of this one. The legacy-migration-runbook already triages this entry as
"no created files → Lane 0 or 3" (`docs/operations/legacy-migration-runbook.md`).

## Decision Drivers

- **Foundation does not exist.** The plan's central artifact
  (`src/providers/factory.ts`, `buildProviderForUser`) was never built; providers
  are plugin-registered. Half the tasks cannot be executed as specified.
- **High-value work is already done — by another design.** Duplicate model
  building, scheduler provider duplication, and orchestrator provider-specific
  imports are resolved via `llm-model-builder.ts` and the registry layer. The
  plan would re-derive an inferior version of completed work.
- **Reference rot.** ADR-0008 (mismatched title, pruned file) and ADR-0035
  (nonexistent) underpin the plan's framing; ADR-0007 is the real
  layered-architecture record. Wrong repo path in every command.
- **Remaining violations are low-severity and isolated.** Cache-layer delete
  delegation in two files, one transitive tool import, three `ai`-type imports,
  one tool-file relocation — all real but low-impact; several the codebase has
  tolerated and grown.
- **Stale plans mislead.** Leaving an un-implementable, premise-broken plan on
  the active `docs/superpowers/plans/` shelf invites future effort against a
  target that no longer matches the code.

## Considered Options

### Option 1 — Archive the plan; re-track residual violations via a fresh OpenSpec change (chosen)

Mark the plan superseded and relocate it off the active plans shelf. Capture the
still-valid violations (history/memory cache delegation, the
`resume-recurring-task.ts → scheduler.ts` transitive import, commands-layer `ai`
imports, deferred tool co-location) as a fresh, correctly-scoped OpenSpec change
entered through `/opsx:propose` and grounded in the current
registry/resolver/`llm-model-builder.ts` design — not the assumed `factory.ts`
stack. Independently lift out the one high-value standalone deliverable,
`scripts/check-architecture.sh`, if a regression guard is wanted now.

- **Pros:** stops effort bleeding into an un-implementable target; removes the
  misleading shelf entry; preserves the legitimate residual debt as clean input
  for a grounded re-proposal; no parallel provider/model abstraction.
- **Cons:** the residual layering violations remain until a fresh proposal lands;
  the re-tracking carries a one-time re-scoping cost.

### Option 2 — Implement the plan as written (rejected)

Execute Tasks 1–12 against the assumed `factory.ts` architecture and ADR-0008.

- **Pros:** the plan is already fully specified (12 tasks, verification commands,
  ADR template).
- **Cons:** requires first re-scoping Tasks 4/5/6/8 against the registry/resolver
  design, renumbering both ADR references, and re-grounding paths — net a
  rewrite. Re-introduces `factory.ts`-style duplication the codebase already
  removed. Tasks 4, 6, 8 are moot (their goals are already met). Effort medium,
  worthiness low.

### Option 3 — Partial salvage: extract the still-valid fixes now (rejected)

Pull out only the architecture-independent pieces (Tasks 2, 3, 5, 9, 10) and
land them incrementally without addressing the premise gap.

- **Pros:** ships small, correct increments (cache delete delegation, the
  cross-layer extraction, the tool-file move) with no commitment to the full
  plan.
- **Cons:** without the accompanying `check-architecture.sh` guard and a grounded
  layering ADR, the fixes are un-anchored one-offs; doing them under a stale
  plan's task numbers inherits its broken references and mis-attributes the
  work. Better to scope these together with their regression guard in a fresh
  proposal than to land orphan edits.

## Decision

**Archive the plan. Do not implement it as written.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), with a superseded
   marker and a pointer to this ADR, so it no longer presents as actionable
   backlog. Update or retire the companion note in
   `docs/superpowers/notes/provider-abstraction-architecture-plugin-execution-order.md`
   to match.
2. **Do not build `src/providers/factory.ts` or resurrect
   `buildProviderForUser`.** Provider construction stays in the
   registry/resolver layer (ADR-0129 / ADR-0130–0133); model building stays in
   `src/llm-model-builder.ts`.
3. **Re-route the residual violations if still wanted.** Any future work on
   history/memory cache delegation, the `resume-recurring-task.ts → scheduler.ts`
   transitive import, commands-layer `ai` imports, or deferred tool co-location
   enters through `/opsx:explore` / `/opsx:propose` against the current
   architecture — treating this plan's task descriptions as input, not as a
   contract on the old `factory.ts` file structure.
4. **Do not allocate the `0035` ADR slot for this plan's verification
   guidelines.** Any future layering verification ADR is numbered from the
   current baseline (0309+) and grounded in ADR-0007, not the nonexistent
   ADR-0008.
5. **Optionally lift out `scripts/check-architecture.sh` independently** if a
   regression guard is wanted before the residual violations are re-scoped; its
   grep checks should be re-derived against the current module layout, not the
   plan's.

## Consequences

### Positive

- A medium-effort, low-worthiness rewrite of an obsolete plan is removed from
  the actionable backlog.
- The active plans shelf no longer carries a target whose central artifact does
  not exist.
- The legitimate residual layering debt is preserved as a re-scoping input rather
  than lost; a future proposal starts from the actual code.
- No second provider/model-building abstraction is introduced.

### Negative

- The residual violations (history/memory direct DB access, one transitive tool
  import, commands-layer `ai` type imports, deferred tool co-location) remain
  until a fresh proposal is written and executed.
- The regression guard (`check:architecture`) this plan would have added is not
  in place unless independently lifted out.

### Risks

- **Residual layering debt accrues.** The `commands/*.ts → 'ai'` import count
  has already grown from one to three since the plan was written.
  Mitigation: this is the trigger to open the fresh OpenSpec proposal above; the
  task descriptions are preserved in the archived plan as input.
- **Future agents rediscover the stale plan and treat it as actionable.**
  Mitigation: the plan's relocated copy and this ADR both carry the superseded
  marker and a pointer here; the companion note is updated to match.
- **Re-proposal re-derives similar structure** (cache delete delegation, a
  cross-layer extraction). Acceptable, because it will be grounded in the real
  registry/`llm-model-builder.ts` design rather than the assumed `factory.ts`
  stack.

## Related Decisions

- **ADR-0007** — Layered Architecture Enforcement: the real layered-architecture
  record this plan intended to extend. (Source file pruned with the 0001–0100
  batch; listed in `docs/adr/README.md`.)
- **ADR-0123** — Trusted-Local Plugin System: introduced the plugin-contributed
  provider registry that replaced the `factory.ts` / `buildProviderForUser`
  pattern this plan assumes.
- **ADR-0129** — Multi-Provider Router (Unified Design), and **ADR-0130–0133**
  — Task-Provider-as-Plugin Phases: established the current
  registry/resolver/auto-provision provider construction layer.
- **ADR-0309** — Archive the Phase 10 Notification Controls Plan: the
  precedent for archiving a premise-broken, superseded plan with an ADR rather
  than executing it.

## References

- Plan: `docs/superpowers/plans/2026-03-26-layered-architecture-violations-fix.md`
- Companion status note:
  `docs/superpowers/notes/provider-abstraction-architecture-plugin-execution-order.md`
  ("❌ Not implemented | 0/12 tasks completed").
- Triage: `docs/operations/legacy-migration-runbook.md` ("no created files →
  Lane 0 or 3").
- Codebase verification (2026-08-07): `src/providers/factory.ts` absent;
  `buildProviderForUser` defined nowhere; `src/llm-model-builder.ts` is the
  consolidated model builder; `src/scheduler.ts` has no provider-construction
  code; `src/llm-orchestrator.ts` imports no provider-specific error classes;
  `src/history.ts:10` and `src/memory.ts:11` still import `getDrizzleDb`;
  `src/tools/resume-recurring-task.ts:14` still imports `../scheduler.js`;
  `src/commands/context.ts`, `context-collector.ts`, `context-tool-resolution.ts`
  import from `'ai'`; ADR-0008 is titled "DDD Tactical Patterns" (not the plan's
  claimed title) and its source file is pruned.
