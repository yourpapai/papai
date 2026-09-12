# Design — afk-runner-operator-paper-cuts

Mirror of master's `cf8a53ac4` (four operator paper cuts on sdd-runner) into
afk-runner — three cuts port, one is N/A per the proposal. Source material:
`sdd-runner/src/{working-tree-guard,intake}.ts` + `.claude/commands/sdd-auto.md`
hunks of that commit (in this branch's history; the workspace was deleted at
R5). See proposal.md for the why; the specs carry the requirements. Design
rules: no scope-model impact (offline runner workspace, nothing keyed by any
context id); no DB, no new dependencies; not a chat tool surface — no
capability gating.

## Context

Constraints the decisions sit on: `agent-layer.ts` owns the guard in place
(`ALLOWED_PREFIX = 'openspec/changes/'`, module-private `guardWorkingTree`, one
caller `attemptStageAgent`) and `RunStageAgentOptions.changeName` is required —
every one of the 9 spawn call sites names its change; intake scaffolds
`openspec/changes/<changeName>` via `driver.newChange` (openspec validates the
slug) before the estimator spawns, so an empty or absent name cannot reach the
guard; agent scratch writes go to `<cwd>/.review-loop/` which is gitignored —
invisible to `git status --porcelain`, so tightening the prefix cannot trip on
them; `work/intake.ts` `runIntake` returns early on `depthOverride` before both
the prescreen (`:98`) and the estimator spawn — an override silently discards
both readings; `resolveDepth`'s `disagreement` feeds the optional depth-event
field (`event-schemas.ts:130`) and the `IntakeResult` return, with no consumer
anywhere; `PipelineWorkDeps` already carries the optional `stdout` sink used by
park lines; `cli.ts` parses `--depth` inline in `runStartCommand` — there is no
exported start-args parse seam to pin a doc against.

## Goals / Non-Goals

**Goals:** the guard answers "did the agent write only where it was told"
truthfully (own change folder only); the two dead/silent intake signals reach
the operator as `intake:` warn lines; the front-door doc's flag prose cannot
drift from the parser.

**Non-Goals:** the bin/shebang cut (afk's entry is the `afk-runner:start`
alias); oversize verdict / decomposition routing (declined with the plan
branch — 0 `plan` events in 14 runs; master's override-warn wording names that
verdict and is therefore not portable verbatim); estimator prompt/model
changes; TUI surfaces (U8 hold); any behavior change to routing, gates, or the
event grammar beyond the warns' text on stdout.

## Decisions

### D1 — Guard scoping with no coded fallback

The guard computes the allowed prefix from the spawn's own change:
``openspec/changes/${options.changeName}/``. No `changeName === undefined`
branch: the field is required on the seam, all 9 call sites pass it, and the
name is validated by construction (openspec `newChange` runs before any later
stage can spawn). Master's tree-wide fallback branch answered a caller that
cannot exist here — `guardWorkingTree` is module-private with a single caller,
so the branch would be unreachable code behind an untested path. The fallback
survives as this stated note instead: **if a spawn seam without a change name
ever emerges, re-widen explicitly in that seam's terms and re-pin the guard
tests — do not resurrect the silent tree-wide default.** The trailing slash in
the prefix is what makes a prefix-sharing sibling (`add-thing` vs
`add-thing-extra`) a violation; it is pinned by its own red-first test. The
violation error additionally names the allowed folder (master kept the generic
message; the message is the operator surface of this cut, so it earns the
folder). Guard stays in `agent-layer.ts` — master's extraction to a
`working-tree-guard.ts` module was driven by orchestrator max-lines pressure
that does not exist here (248 lines, no new module needed; the
one-level-down question: `agent-layer.ts` already covers this).

### D2 — `IntakeResult.disagreement` stays; the warn becomes its consumer

The return field is kept master-faithful: it is the asserted contract of an
exported, directly-tested function (`intake.test.ts` pins the full object), and
the original sin — a signal with no consumer anywhere — ends when the warn
reads `resolveDepth`'s output at the point of computation. Production callers
discard the whole result (`.then(() => undefined)`), so dropping only
`disagreement` while keeping `depth`/`changeName` would be arbitrary churn on
a pure function's tested shape. The depth **event** field stays untouched for
fold parity — legacy logs and the parity oracle are unaffected; analysis reads
events, never `IntakeResult`. Asymmetry with D1 is deliberate: D1 cuts a
behavior branch for a caller the types forbid; D2 keeps data on a return value
tests observe.

### D3 — Warn sink on the intake deps seam; wording carries afk's real costs

`IntakeDeps` gains `readonly stdout?: (line: string) => void` — omitted means
silent (tests, embedders), mirroring `RunDeps.stdout`. The `intake:` prefix is
added at the wiring site (`pipeline-work.ts` `intakeModule`:
``stdout: (line) => deps.stdout?.(`intake: ${line}`)``), matching master and
the steer/park-line seams. Wording, master's skeleton with afk's enumerated
costs (the override discards both readings — the early return precedes the
prescreen too — and the forced profile sizes exactly two things:
`ROUND_CAPS` `S:1 M:3 L:4`, and the tail via `runsAtomicity = depth !== 'S'`):

- override, S: `--depth S skips scope estimation — the forced profile sets the review round cap (S: 1) and skips the atomicity stage (decompose presents the final gate)`
- override, M/L: `--depth M skips scope estimation — the forced profile sets the review round cap (M: 3)`
- disagreement: `depth readings disagree by two levels (estimator L, prescreen S) — taking the higher`

The tail clause is conditional because a static "(S skips atomicity)" note on
an M/L override would claim a consequence that run does not get; the cap
number is interpolated because a number beats a noun for operator judgment.
Both clauses reuse the umbrella spec's own tail language ("a depth-S run SHALL
skip the atomicity stage, with decomposition presenting the final gate") so
warn, spec, and docs stay one vocabulary. Warns fire on the depth-reading
paths of every intake execution: a mid-intake crash resumed with the same
override present re-enters the branch and warns again — accepted, one warn per
execution, each invocation re-stating its own override cost; the alternative
(persisting "already warned") is durable state bought for silence.

### D4 — Doc pin via an extracted `parseStartArgs`

`runStartCommand`'s inline parsing (`args.indexOf('--depth')` + `parseDepth`)
is extracted verbatim into an exported pure `parseStartArgs(args)` returning
`{ taskFile, depthOverride }` or the usage error — the seam master's
`parseSddArgs` played for its pin. The pin test extracts every `--<flag>`
token the doc names and runs each through `parseStartArgs` with its documented
value form; any doc drift into an unknown or renamed flag fails the test. The
tripwire is demonstrated red once by pinning against a doctored doc fixture
(a bogus `--wait` flag in-test, never committed to the real doc). Scope note:
the doc's flag prose is start-verb prose today (`--depth` only); if the doc
later documents another verb's flag, the pin forces the conscious choice —
extend the pin to that verb's parse seam or keep the doc silent — which is the
drift protection working, not brittleness to apologize for.

## Hook / TDD interaction

All edits gate through the Write/Edit TDD hook pipeline (`afk-runner/src/**` is
a gated impl root). Red-first order: guard pins in
`tests/afk-runner/work/agent-layer.test.ts` (sibling violation,
sibling-prefix violation, message names the folder — the existing own-folder
green test stays green untouched) → intake warn assertions in
`tests/afk-runner/work/intake.test.ts` (override S-form, override M-form,
disagreement form, absent-sink silence) → wiring assertion in
`tests/afk-runner/drive/loop.test.ts` (a driven intake surfaces the prefixed
line on `RunDeps.stdout`) → `parseStartArgs` extraction pins + the doc-pin
test in `tests/afk-runner/cli.test.ts` → docs. No new source files except
none — all changes land in existing modules, so no fresh gate precedents.

## Risks / Trade-offs

- [Pre-existing dirty files outside the change folder are invisible to the
  guard] → out of scope, unchanged by this delta; the guard compares
  before/after snapshots, and that contract is not this cut.
- [Warn wording drifts from spec tail language over time] → both derive from
  the umbrella spec's stage-sequence requirement; a rename there fails the
  warn tests' substring assertions, not silent prose.
- [Resume re-entry with the same `--depth` re-warns] → accepted (D3): each
  `start` invocation re-states its own override cost; the warn is cheap and
  the alternative (persisting "already warned") is state for silence.
- [Doc-pin regex over-matches markdown] → the extractor matches the doc's
  flag-in-backticks forms (`--depth S|M|L`), pinned against the current doc
  content; a doc prose change that breaks extraction is itself drift the pin
  should surface.
- [Sibling-prefix correctness rests on the trailing slash] → pinned by its
  own red-first scenario (`add-thing` vs `add-thing-extra`), the exact shape
  master called out.

## Migration Plan

Additive: one guard tightening (behavior-visible only to agents that already
violated the intent), two warn lines on stdout, one exported pure function, one
pin test. No event, schema, config, or memo changes; fold, parity oracle, and
legacy logs untouched. Deploy = merge; rollback = revert the commit.
