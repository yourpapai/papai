## Context

Baseline is the shipped pipeline (`opencode-agent-openspec-compliance`, PR #264): triage emits `clarify | capture | answer`; `capture` scaffolds a real change folder via `openspec-driver.ts` (`newChange` → `instructions('proposal')` → `scaffoldOnBranch`, commit #1 on `agent/issue-<n>`); PLANNING composes artifacts through a drafter loop with `validate --strict` and retry ≤2; a merged PR auto-archives the folder into `openspec/specs/`; `AGENT_STATE` remains the only issue block. The gaps this change closes were verified against the shipped source: no `skip_specs`/`skipSpecs` reference exists anywhere in `opencode-agent/src/`, and no prompt constrains capability granularity.

Constraints: the shipped design's own doctrine applies — TS drives the CLI protocol, the model composes content; metadata decisions belong in zod-validated structured output, not freeform file writes; the human parks (`DESIGN_SPEC`, `PLAN_REVIEW`) are the correction points for wrong automated calls.

## Goals / Non-Goals

**Goals:**

- Fix-class issues flow through the compliant pipeline without inventing spec deltas or failing validation.
- Every skip_specs call is visible to and correctable by the maintainer at the park.
- Agent-captured capabilities arrive at feature-domain granularity, protecting the archive door's corpus.
- The depth/effort doctrine is written down, with its one watch item named.

**Non-Goals:**

- No staged exploration phase, no S/M/L depth profiles, no telemetry instrumentation (the doctrine names the signal; building the instrument is a later change if dogfooding demands it).
- No re-litigation of the shipped D1–D13 decisions.

## Decisions

### 1. The skip_specs call is a triage output, ratified at the park

Triage's `capture` variant gains `skipSpecs: boolean`. The prompt carries the decision rule — a spec-level change is one where a downstream observer of the system's contract would see an added, changed or removed requirement; fixes restoring intended behavior, refactors, docs and tooling are not — with **bias to `true` for fix-class issues**. The bias is chosen by failure-mode asymmetry: a false capability pressures the model to invent deltas to satisfy `validate --strict` (a loud, corpus-polluting failure the retry loop makes worse), while a false `skip_specs` is quiet, visible and cheap to reverse — the proposal's Capabilities section must read "None — skip_specs proposed because ⟨reason⟩", and `/changes` at the `DESIGN_SPEC` park flips it. Alternatives rejected: fixed default without a model call (triage already judges issue class for clarify-vs-capture; the signal is free), and planner-side decision (too late — the folder is already scaffolded and the proposal already names capabilities).

### 2. Metadata is written from the validated output, not by the model

When `skipSpecs` is true, the scaffold path writes `skip_specs: true` into `.openspec.yaml` immediately after `newChange` — a deterministic TS patch of CLI-scaffolded metadata, fed by the zod-validated triage output. The model never edits `.openspec.yaml` by freeform write: the diff-guard grant stays scoped to artifact content, keeping the metadata channel single-sourced. The driver's contract grows this one write; everything else about the scaffold flow is untouched.

### 3. The drafter treats skip_specs as a planning-input, not an error

With the flag set, `plan-draft.ts` composes design-or-recorded-skip plus tasks and does not request spec deltas; validation passes because the metadata says so. The retry loop's complaint-driven repair is preserved for genuine validation failures. A probe task (tasks 1.1) records the installed CLI's exact `status`/`instructions`/`validate` behavior under `skip_specs: true` first, so the drafter change is built on observed behavior rather than assumed semantics.

**Probe 1.1 record** (installed `@fission-ai/openspec` 1.8.0; throwaway change `zz-probe-skip-specs`, flag written into its `.openspec.yaml` immediately after `openspec new change`):

- `openspec status --json`: the `specs` artifact answers `"status": "skipped"`, and the graph still gates `tasks` on it — `requires` keeps naming `specs`, but `missingDeps` drops it, so a skipped dependency counts as satisfied. With proposal + design + tasks written and zero spec deltas, `"isPlanningComplete": true`. The drafter's `readyArtifact` (status === `ready`) never sees `specs`, so the existing loop walks a skip_specs change without a code change of its own.
- `openspec instructions tasks --json`: resolves (exit 0) with `specs` still `blocked`-adjacent upstreams undone; the `dependencies` entry answers `{ "id": "specs", "done": true, "skipped": true }` — `done: true` carrying the skip.
- `openspec validate zz-probe-skip-specs --strict`: **`Change 'zz-probe-skip-specs' is valid` (exit 0)** with zero spec deltas. Contrast, same folder with the flag removed: exit 1 with `✗ [ERROR] file: Change must have at least one delta. … If this change intentionally modifies no specs (pure refactor, tooling, docs), set "skip_specs: true" in the change's .openspec.yaml instead.` — the CLI itself names the flag as the remedy, which is the failure the driver's retry loop used to hand the model twice.

Consequence for the drafter (shape of task 3.1): no local special-casing of the artifact list is needed — the CLI's own status graph skips `specs`, and `plan-draft.ts` only has to keep composing whatever `status` reports as `ready`. The probe folder was deleted after the record.

### 4. Capability granularity is prompt doctrine, enforced at the park

Capture/planning prompts gain: capabilities are named at **feature-domain granularity** (`user-profile-memory`, `sdd-automation`), never issue-sized; while `openspec/specs/` holds no archived corpus, proposals name **new capabilities only**. This is guidance, not a validator — the `DESIGN_SPEC` park remains the enforcement point, now with an explicit rule to cite. A programmatic granularity check was rejected: granularity is a judgment, and the repo's existing rules for proposals already live in `openspec/config.yaml`, which the CLI instructions channel carries to the planner for free.

### 5. Exploration depth is distributed, not staged — and `skipSpecs` is its signal

Recorded doctrine, resolving the "no explore stage" question the compliance change left implicit: the agent's explore loop is the clarify/revision cycle across jobs (the issue thread is the session; revisions are the living document), with deliberate shallowness at gate 1 (a ≤500-word scope contract) and depth at gate 2 (specs/design/tasks) — depth is gated behind human approval rather than front-loaded. Within that, `skipSpecs` doubles as the **depth-lane signal**: fix-class issues take the shallow lane (proposal-lite → design-skip → tasks), feature-class issues take the deep lane (capabilities research → full bundle). No new stage is added; the regulators stay the clarify bias, the per-issue token ceiling, per-turn deadlines, and the intent classifier.

### 6. Planning-turn deadline pressure is the named watch item

The compliance rework made the planning turn heavier (full skill documents inlined, drafter loop, multi-artifact composition). The signal to watch during dogfooding is `INCOMPLETE` parks out of `PLANNING` (and turn-deadline failures in triage/planning job logs); if they climb, the tuning knobs are splitting the drafter's per-artifact turns and trimming inlined skill prose — both prompt-level, neither touching the state machine. This change records the signal and the knobs; it does not build instrumentation.

## Risks / Trade-offs

- **Mis-classified skip_specs** → absorbed at the park by design (Decision 1); the cost of a wrong call is one `/changes` round, and the mandatory rationale makes the call auditable in the proposal itself.
- **CLI behavior under skip_specs differs from assumption** → mitigated by probe task 1.1 landing before any code task; if `status`/`instructions` mishandle the flag, task 3.2 adapts (worst case: the drafter skips the specs artifact locally regardless of CLI opinion, since validation is the only hard gate).
- **Prompt growth** → the rule, bias and granularity guidance add well under 1 KB to triage/planning prompts — noise against the already-inlined skill documents, and noted against the shipped D13 tuning budget.
- **Scope-model / capability-gating / DB impact:** none — dev tooling; no new persisted runtime state, no papai tool surface, no migrations.
- **New dependencies:** none — the installed `@fission-ai/openspec` CLI is reused.
- **Hook/TDD interactions:** all touched files are under `opencode-agent/src/**` and gated by the Write/Edit TDD hook; work is test-first against `tests/opencode-agent/**` (existing suites: `openspec-driver.test.ts`; triage/plan suites per module convention), with the probe task first because it has no code under test.
