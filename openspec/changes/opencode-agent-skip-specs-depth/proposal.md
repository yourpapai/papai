## Why

`opencode-agent-openspec-compliance` (merged, pending archive) made the agent OpenSpec-native — real folder, CLI driver, archive door — but left three gaps this follow-up closes. First, the agent has **no `skip_specs` path**: a fix-class issue produces a zero-delta change folder, `openspec validate --strict` rejects it, and the driver's retry loop hands the complaint back to the model twice — pressuring it to invent deltas, which the instructions explicitly forbid — before the phase fails. Fix-class issues are the common case for an issue agent. Second, agent-captured proposals now flow into `openspec/specs/` through the merged-PR archive door with **no capability-granularity guidance**, so issue-sized micro-capabilities would pollute the corpus. Third, exploration depth is regulated only implicitly (clarify bias, budgets); nothing records the doctrine or watches the planning turn's growing deadline pressure.

## What Changes

- Triage's `capture` output gains a `skipSpecs: boolean` decision, governed by an explicit rule (a spec-level change is one a downstream observer of the system's contract would see as an added/changed/removed requirement) with **bias to `true` for fix-class issues**; a capture recommending skip must state the reason in the proposal's Capabilities section so the maintainer can veto at the `DESIGN_SPEC` park via `/changes`.
- The scaffold path writes `skip_specs: true` into the change's `.openspec.yaml` when triage decided it — metadata set from the validated structured output, never from freeform file writes.
- The planning drafter honors the flag: skip_specs changes compose design-or-skip + tasks without spec deltas, and validation passes with zero deltas.
- Capture and planning prompts gain capability-granularity guidance: feature-domain names (e.g. `user-profile-memory`), never issue-sized; new-capabilities-only while `openspec/specs/` has no archived corpus to modify.
- The depth doctrine is recorded in design.md: exploration is distributed across the clarify/revision loops rather than staged, `skipSpecs` doubles as the depth-lane signal (fix lane vs feature lane), and planning-turn deadline pressure is a named watch item.

## Capabilities

### New Capabilities

None — prompt/tooling tuning of `opencode-agent/`, matching the merged precedent (`opencode-agent-openspec-compliance`, `migrate-brainstorming-to-openspec`): `skip_specs: true` is set in this change's `.openspec.yaml`.

### Modified Capabilities

None. (`openspec/specs/` is empty; nothing to modify.)

## Non-goals

- No new pipeline stage, phase, or depth-profile machinery (S/M/L profiles belong to `sdd-runner`, not this agent).
- No changes to the shipped folder-is-truth model, capture gating, archive door, or driver protocol — this change extends them, it does not revisit them.
- No papai runtime impact: no platform/task instances, tools, or settings UI; config-context scope impact: none (no new persisted state keyed by any context id).
- No telemetry build-out for the watch item — the doctrine names the signal (planning-phase `INCOMPLETE` parks); instrumentation is a separate change if dogfooding warrants it.

## Impact

- **Code:** `opencode-agent/src/phases/triage.ts` (capture schema), `opencode-agent/src/openspec-driver.ts` (skip_specs write), `opencode-agent/src/phases/plan-draft.ts` (drafter honors the flag), `opencode-agent/src/prompts.ts` (decision rule + granularity guidance).
- **Tests:** `tests/opencode-agent/` (`openspec-driver.test.ts`, triage/plan suites per module convention).
- **Docs:** `opencode-agent/CLAUDE.md` (skip_specs posture), `docs/architecture/` — none (agent documented in-workspace).
- One probe task against the installed `@fission-ai/openspec` CLI version records `skip_specs` behavior; no dependency change.
