# Design: sdd-runner autonomy

## Context

`sdd-runner` is a Bun workspace of local developer tooling (not papai runtime). Its
pipeline halts at two human-gate points per run: the early (cap-hit) gate and the final
gate. All gate flow funnels through three seams that this design reuses rather than
extends sideways:

- **Gate presentation** — `gate-digest.ts presentGateAt` (called from
  `orchestrator.ts runPostReviewToGate`, `extend-round.ts`, and
  `post-review-tail.ts`) writes `runs/<id>/gate-<n>.md`, bumps the version, and sets
  `state.gate` pending. Every human gate in the system passes through this one function.
- **Gate settlement** — `extend-round.ts runGateResume` collects a decision via three
  already-parallel paths (`desugarFlags` → `runGateSession` interactive → hand-edited
  file), all converging on `settleAnswers` in `gate-session.ts`, which renders
  `gate-<n>.md` via `renderGateAnswers` and self-checks with a write-then-parse round
  trip against `parseGateResponse` in `gate-model.ts`.
- **Signals** — everything the rules need already exists: `ReviewLoopResult`
  (open BLOCKERs/MATERIALs, rounds), the per-round trajectory rows from
  `sdd-runner-cap-hit-fidelity` (folded in `replay.ts`), cumulative cost in
  `usage-aggregate.ts` / `live-renderer.ts totals`, assumption sidecars consumed by
  `gatherAssumptions` (`gate-digest.ts`), and `state.roundCap` (`run-state.ts`).

Constraints that shape the design: strict TS with `.js` import extensions; no
lint-disable/type-ignore comments; the event schema is a zod discriminated union in
`events.ts` where every line must parse (`readEvents` throws on the first bad line), so
any new event type must be added to both `EVENT_VARIANTS` and `SddEventSchema`; the
non-TTY `LineRenderer` byte contract is frozen by CI golden tests; the Write/Edit TDD
hook gates `sdd-runner/src/**` (test-first), resolved via `.hooks/tdd/test-resolver.mjs`.
The pending `openspec/changes/shared-tui-renderer/` change is a prerequisite runway —
it extracts the duplicated ANSI block engine into a `tui-renderer` workspace; this
design consumes it as-is and never forks it. See `proposal.md` for motivation and
`specs/sdd-runner-autonomy/spec.md` / `specs/sdd-runner-output/spec.md` for the
requirement-level contract.

## Goals / Non-Goals

**Goals:**

- A single, pure, deterministic **policy module** that turns existing pipeline signals
  into gate decisions, invoked at exactly the two seams above — no second gate flow.
- `observe` (default) is byte-identical in behavior and CI output; its only writes are
  additive (`### Auto-decision preview` block, `auto-policy.jsonl`, `auto_decision`
  events).
- Auto-decided gates remain first-class audit anchors: they write `gate-<n>.md`,
  consume a version, emit events, and stay overturnable — since a settled gate has no
  pending `state.gate`, overturn goes through the new `sdd-runner gate reopen` verb
  (D9), which re-presents the settled gate version so the existing veto/abort/resume
  mechanics apply.
- Tier 0 output polish lands entirely in the dynamic renderer + gate files; the frozen
  non-TTY contract gains only the done-line model id.
- The clack and Ink adoptions are front-end swaps behind existing seams (`Prompter`,
  event replay), not rewrites of session or renderer logic.

**Non-Goals** (design-level; proposal Non-goals cover scope):

- No probabilistic or LLM-in-the-loop policy — the ladder is deterministic arithmetic
  over recorded artifacts (ponytail: lazy about attention, never about evidence).
- No scheduler/daemon: `watch` and queued steering are pull-based reads of files the
  running CLI process already writes; nothing polls while no run is active.
- No change to `review-loop` or `mutation-improve` — they keep their own renderers and
  gain nothing here beyond what `shared-tui-renderer` already consolidates.
- No DB, drizzle migration, papai tool surface, or scope-model state (see the
  Project-rules impact section in Decisions, D12).

## Decisions

### D1 — Policy engine is one pure module: `sdd-runner/src/auto-policy.ts`

New module exporting:

```ts
export type AutonomyLevel = 'observe' | 'assist' | 'auto'
export interface PolicySignals {
  readonly reviewResult: ReviewLoopResult
  readonly trajectory: readonly DigestRecord[]        // from replay.ts perRound
  readonly assumptions: readonly ClassifiedAssumption[] // R3 output
  readonly spentUsd: number                            // cumulative run cost
  readonly costKnown: boolean                          // from costAndDuration (gate-digest.ts)
  readonly autoExtendsUsed: number
  readonly deadlineExpired: boolean                    // false everywhere except the D11 waiter's expiry re-run
  readonly config: AutonomyConfig                      // D2
}
export interface PolicyDecision {
  readonly rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  readonly action: 'approve' | 'extend' | 'accept-items' | 'gate'  // 'gate' = decline to decide
  readonly evidenceDigest: string
  readonly permittedAt: AutonomyLevel                  // minimum level at which action may fire
}
export function evaluateFinalGate(signals: PolicySignals): PolicyDecision
export function evaluateCapHit(signals: PolicySignals): PolicyDecision
export function classifyAssumptions(...): readonly ClassifiedAssumption[]   // R3, pure arithmetic
```

`costKnown` comes from the existing `costAndDuration` (`gate-digest.ts`), which already
returns it — the design consumes the signal, it does not compute it. When
`costKnown === false` (unmetered/fallback-priced models in the log), `spentUsd` is a
partial figure and R4 must fail closed: every evaluator returns `action: 'gate'`
regardless of any other predicate (see D3 prelude step 0 and the R4 requirement).

`classifyAssumptions` contract (R3 thresholds, explicit so tests are table-driven): an
assumption is **low-blast** iff *all* of the following hold over recorded run artifacts
— (a) every file it references is inside the change folder or the run dir, (b) it
touches no spec delta file (`specs/**/spec.md`), (c) it touches no `tasks.md` checkbox
line. Anything else is **high-blast** (classify-everything-else-high-blast default; no
neutral tier). The agent-emitted `blast_radius` string on `GateAssumption` is
**display-only**: it is rendered in the gate file for the human but never consulted by
the classifier, because it is free text from the agent and cannot be cross-checked
arithmetically.

Evidence source for (a)–(c), pinned because nothing records per-assumption file
references today (`GateAssumption` is exactly `{ id, text, blast_radius }`): the
resolver output contract (`review-model.ts ResolverOutputSchema`, mirrored in
`agent-layer.ts AssumptionRecordSchema`) gains a required per-assumption
`evidence: { files: readonly string[] }` field — the file paths the assumption
references — which the gate seam cross-checks against `artifact`/`materialize` events
(paths the pipeline itself recorded, not agent free text) before classification. The
classifier does arithmetic over this recorded list only. **Missing or unverifiable
evidence fails closed**: an assumption whose sidecar entry lacks the `evidence` field,
carries an empty or un-cross-checkable file list, or comes from a sidecar that fails to
parse is classified **high-blast** — never vacuously low-blast — so R1 cannot
auto-approve on absent evidence. The proposal Impact code list and the D12 test plan
cover both schema modules.

Each evaluator walks the ladder D1–D5 from the proposal in order and returns the first
applicable decision, or `{ rule: …, action: 'gate' }` when the ladder cannot decide.
Pure functions in, data out — no I/O, no clock, no config-file reads; the module never
writes the policy-debt ledger itself. All I/O (reading sidecars, trajectory, usage;
writing previews/events) stays in the orchestrator/gate seams that call the module —
including the ledger append for an undecidable outcome, which the calling seam performs
at gate time (single writer; see D9).

**Alternatives rejected:**

- *Rules inlined into `orchestrator.ts` / `extend-round.ts`* — the rules need to be
  evaluated twice per gate (once for the `observe` preview, once for the real decision
  at `assist`/`auto`), which demands a shared pure core; inlining would duplicate the
  ladder and make the counterfactual shadow impossible to keep honest.
- *Agent-judgment rung between D4 and D5* — the proposal's ladder has "bounded agent
  judgment" as a rung in the abstract, but every concrete rule (R1–R5) is deterministic,
  and ponytail's whole point is that the mechanical surfaces never needed judgment.
  Adding an agent rung now would create an unauditable decision class with no consumer;
  the policy-debt ledger (D9) is the mechanism that earns new *deterministic* rules
  from data. Deferred, not rejected forever.

### D2 — Autonomy resolution: CLI > config > default, zod-typed in `config.ts`

`RunnerConfigSchema` gains:

```ts
autonomy: z.object({
  level: z.enum(['observe', 'assist', 'auto']).default('observe'),
  costCeilingUsd: z.number().positive().default(5.0),
  autoExtendMax: z.number().int().nonnegative().default(1),
  deadlineMinutes: z.number().positive().optional(),   // off when absent
  rules: z.partialRecord(z.enum(['R1','R2','R3','R4','R5']), z.boolean()).default({}),
}).default({ level: 'observe', costCeilingUsd: 5.0, autoExtendMax: 1, rules: {} })
```

CLI `--autonomy <level>` (and `--auto-deadline <minutes>`) on `start`/`resume`/`continue`
(per-command, like `--verbosity` in D10 — a run started with `--autonomy auto` and later
continued must not silently revert to the config level mid-run)
overrides the parsed config for that process only; the override rides on
`OrchestratorDeps` as a resolved `AutonomyConfig`, so `auto-policy.ts` never sees the
CLI. Rule toggles: a rule is enabled unless `rules.Rx === false`. R4 (budget guard) and
R5 (reversibility) ignore the toggle map — they are never-cut invariants, not opt-in
rules; the zod schema still accepts the keys so a config that names them parses, and
the policy module treats them as always-on. Interaction with the top-level
`budgetUsd`: that key is today **parsed but unenforced** — no consumer or spend check
exists anywhere in `sdd-runner/src` — so the normalization below is the *first*
enforcement of a previously inert config key, not an interaction with an existing
guard; the R4 fixtures must cover that `budgetUsd` alone never gated anything before
this change. The two knobs govern different things: `budgetUsd` bounds total run spend
(pipeline-level), `autonomy.costCeilingUsd` bounds what the *policy*
may auto-decide. The policy's effective ceiling is
`min(budgetUsd ?? +∞, costCeilingUsd)`: R4 fires when projected spend crosses either,
so a stricter top-level budget can only make auto-decisions more conservative, never
looser. No config rejection is needed; the min() normalization is stated here and
tested in the R4 fixtures. **Why zod here:** config is already zod-parsed in
`loadRunnerConfig`; a hand-rolled validator would fork the error-report path
(`runner config invalid at …`). `config.example.json` gains the block with the safe
defaults.

### D3 — The ladder intercepts at `presentGateAt`, not beside it

All gate presentation (early and final, start and resume paths) flows through
`gate-digest.ts presentGateAt`. The design inserts a **policy prelude** inside the
three call sites that own a decision (`runPostReviewToGate` for the initial early/final
routing, `post-review-tail.ts` for the final gate, and `extend-round.ts runExtendRound`
for the post-extension early gate), structured as follows. `extend-round.ts` has a
second `presentGateAt` call site — `settleVeto`'s re-presentation after a human veto —
which deliberately gets **no** policy prelude: a gate a human just vetoed is never
auto-decided in the same breath; it is re-presented to the human. The prelude:

0. **Never-cut pre-checks, before any rule evaluation.** If the gate situation
   includes an open BLOCKER, skip the ladder entirely and present the human gate
   (invariant 1) — no rule, including R2, is ever evaluated against an open BLOCKER.
   If `costKnown === false` (unmetered spend, D1), also present the human gate — R4
   fails closed on unknown cost. Immediately before any auto-settle in step 4, check
   `steer.md` once more (D6): a queued `abort` or `veto` that arrived after the last
   round boundary takes precedence over the pending auto-decision. "Check `steer.md`"
   here means both the raw file **and the persisted staged set** (`steer.staged.json`,
   D6): a directive already consumed at the final round boundary has been renamed away
   from `steer.md` but still lives in the staged set, and it takes the same precedence.
1. Build `PolicySignals` from sidecars/replay/usage — exactly once per gate, so the
   observe preview and the real decision can never see different inputs. These inputs
   are agent-writable (the run dir is the agents' cwd; the D6 trust-boundary analysis
   applies to R1/R2 signals just as it does to `steer.md`), so the seam applies two
   deterministic integrity cross-checks while assembling signals, before evaluation:
   (i) a resolver sidecar that fails `ResolverOutputSchema.parse` yields an **unknown**
   review result — fail closed, present the human gate — never today's silent
   empty-open-lists fallback (which would satisfy R1's zero-finding predicates on a
   parse error); (ii) R1 additionally requires the replay-folded open-finding counts
   from `events.ndjson` to agree with the sidecar counts, so a buggy resolver that
   under-reports open findings produces a mismatch (human gate), not an auto-approve.
   Both checks are arithmetic over recorded artifacts, not agent judgment.
2. `decision = evaluateCapHit(signals)` or `evaluateFinalGate(signals)`.
3. **observe**: call `presentGateAt` exactly as today, then append the
   `### Auto-decision preview` block to the written `gate-<n>.md`, append one line to
   `auto-policy.jsonl`, emit the `auto_decision` event with `decision: 'preview'`.
   The preview block is **parse-inert by construction**: every line is prefixed with
   `> ` (blockquote), so it contains no `- [x]`/`ABORT`/leading-`→` line for
   `parseGateResponse` to act on, and `resumeGate` parses the file unchanged. As a
   second layer, `parseGateResponse` strips the `### Auto-decision preview` section
   (from its header to the next `## `/`### ` header or EOF) before processing, so even
   a hand-mangled preview cannot become gate input. Write order for the additive
   record is gate file → `auto-policy.jsonl` → `auto_decision` event → state save;
   the event log is the source of truth and the sidecar is derived (D5), so a crash
   mid-sequence is reconciled by replay: a preview line without its event is ignored,
   an event without its sidecar line is rebuilt by `audit`'s cross-check.
4. **assist/auto, rule permitted at this level**: write the gate file with pre-checked
   boxes and `decided-by: policy Rx` annotations (D4) **and its
   `gate-hashes-<version>.json` sidecar** — the same artifact hash set `presentGate`
   records (`gate.ts:84`), computed over the settled artifacts at settle time, so the
   mandated integrity verification below hard-reads a real sidecar rather than
   crashing ENOENT — emit `auto_decision` with the
   real decision, and **settle immediately** through the *same integrity primitives*
   the human path uses, not a private copy: `settleApprovedGate` (`extend-round.ts`)
   is exported and invoked for R1/approve (decompose/atomicity tail or
   `finalizeGate completed`), and the artifact-hash verification, drift check, and
   `human_edits` emission that `resumeGate` (`gate.ts:104-137`) performs on every
   human-approved gate are run identically on the policy-settled gate (extracted into
   a shared `verifyGateIntegrity` helper both paths call). R2/extend routes into
   `runExtendRound`. The policy-settle path **emits the L2 `gate presented` / `gate
   answered` event pair** just as the human path does (the answered event carries the
   `decided-by` attribution), because replay, `deriveResumePoint`, and the D9 dwell
   estimate / `human gates: M` count all key on that pair — an auto-settled gate must
   be indistinguishable from a human-settled one in the log. Write order: gate file +
   `gate-hashes-<version>.json` sidecar → `gate presented` event → integrity
   verification + settle tail → `gate answered` event → `auto_decision` event → state
   save. The **`gate answered` event is the settle commit record** (D5): an
   `auto_decision` approve/extend without its paired `gate answered` is treated as
   not-decided on resume. No `state.gate` pending entry is left behind. Because the gate
   is settled, the existing `runGateResume` cannot overturn it (it throws on
   `state.gate === null`) — overturn goes through the new `gate reopen` verb (D9).
5. **ladder cannot decide, or rule not permitted at this level**: today's flow,
   unchanged, plus the preview block (so even at `assist`/`auto` a presented gate
   carries the "why this wasn't auto-decided" line). The seam emits an
   `auto_decision` event with `decision: 'gate'` — `rule` naming the
   matched-but-unpermitted rule, or `'none'` when no predicate matched — so replay,
   `watch`, and the report gains filter (D9) observe the undecidable outcome from
   the log alone, and the seam appends the policy-debt ledger entry at this point
   (D9 — the seam is the single writer).

R3 accept-items specifics: R3 **never settles a whole gate** — a gate's answer surface
includes blocker answers and the required ack, which no rule produces, so an immediate
whole-gate settle of a mixed gate would fail `parseGateResponse`'s required-ack /
open-blocker checks. When R3 fires on a gate that also contains items no rule can
decide (high-blast assumptions, open MATERIAL findings, unanswered blockers, the T1
required ack), the prelude writes the gate file with the low-blast items pre-checked
and annotated `decided-by: policy R3`, emits the `auto_decision` event with
`decision: 'accept-items'`, and **presents the gate to the human** for the remaining
items. Because a human gate was in fact presented, an `accept-items` decision is never
counted as an intervention avoided; the D9 gains block reports auto-accepted items as a
separate per-rule "items auto-accepted" figure instead.

R2 specifics: evaluated only after the step-0 pre-checks pass (0 open BLOCKERs — an
open BLOCKER never reaches R2; at least one open MATERIAL — a cap-hit with nothing
open is not an extend candidate). The trajectory check reads
`replayEvents(logPath).perRound`, requires `len ≥ k` (k=2) with strictly decreasing
open-findings totals over the last k rows, `autoExtendsUsed < autoExtendMax` (tracked
in `RunState` as `autoExtendsUsed`, default 0, persisted by `saveRunState`), projected
spend (`spentUsd + median per-round cost < effective ceiling`, D2), and
`costKnown === true`. `autoExtendsUsed` is incremented and persisted **before** the
extended round starts spending (not after it returns), so a crash mid-extended-round
still consumes the bound; resume after such a crash treats the extend as used and
falls through to the normal early gate if the trajectory predicate no longer holds.
It then calls the **existing** `runExtendRound` unmodified — one decision still binds
exactly one round of spend; the Shape-B semantics already present in
`extend-round.ts` (from the pending `openspec/changes/sdd-runner-extend-round/`
change, a sequencing dependency of this one) are reused, not reimplemented.

**Alternatives rejected:**

- *A wrapper that swallows the gate after presentation* — auto-deciding after
  `presentGateAt` would still write `state.gate` pending and require un-pending it,
  creating a window where `resume` reports a phantom gate. Pre-deciding keeps the
  state machine clean.
- *Settling via synthetic `GateAnswers` through `desugarFlags`* — that path exists to
  desugar human CLI flags; routing policy through it would force policy decisions to
  impersonate flag input and would bypass the `decided-by` annotation. Policy calls the
  settle primitives directly.

### D4 — Gate grammar extension: one optional annotation, parser-tolerant

`gate-answers.ts renderGateAnswers` (the function that renders the answered
`- [x] id text` checkbox lines and the `## Gate response` header — not
`gate-render.ts`, which renders gate-file *sections* such as the change digest) gains
an optional trailing annotation on answered lines:
`- [x] A1 text · decided-by: policy R1` (and a `## Gate response` header variant
carrying `decided-by: policy R1` on its own line for decision-level annotations).
`gate-model.ts parseGateResponse` already ignores non-structural trailing text on
checkbox lines; the extension makes the `decided-by:` suffix *explicitly* recognized
and stripped before comparison, so `renderGateAnswers` + `parseGateResponse` round-trip
keeps holding. The `settleAnswers` write-then-parse self-check (`gate-session.ts:251-263`)
is extended to accept an optional `decidedBy` field on `GateAnswers` and assert it
survives the round trip. Hand-edited files without the annotation parse exactly as
today — the extension is additive and optional, per proposal Non-goal "no replacement
of the gate file protocol".

**Alternative rejected:** a separate `gate-<n>.auto.md` sidecar — splits the audit
anchor across two files; the proposal's invariant 4 requires the gate file itself to
stay the hash/audit anchor.

### D5 — Event schema: one new L2 variant, replay folds it

`events.ts` gains:

```ts
const AutoDecisionEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('auto_decision'),
  rule: z.enum(['R1', 'R2', 'R3', 'R4', 'R5', 'none']),
  decision: z.enum(['preview', 'approve', 'extend', 'accept-items', 'gate']),
  evidenceDigest: z.string(),
  gateVersion: z.number().int().positive(),
})
```

added to both `EVENT_VARIANTS` and `SddEventSchema` (mandatory — `readEvents` throws on
unparseable lines, and old runs without the new type still parse because the union only
grows). `replay.ts foldEvent` folds `auto_decision` into a new
`ReplayState.autoDecisions: readonly AutoDecisionRecord[]`, which is what lets replay
alone rebuild the `observe` previews (proposal invariant 5) and what `watch` (D8)
renders. Old code reading new logs: not a supported direction (the runner is
version-locked with its runs dir), consistent with how `convergence`/`human_edits`
were added previously.

`auto-policy.jsonl` (observe counterfactual sidecar) is a plain append-only file in the
run dir, one JSON object per line: `{ ts, gateVersion, rule, decision, evidenceDigest }`.
It is *derived* data — the event log is the source of truth; the sidecar exists for
grep-ability during `observe` roll-out and is not read back by any code path except
`audit` as a cross-check. Crash consistency across the four artifacts a gate touches
(gate file, sidecar, `events.ndjson`, `state.json`) follows the write order in D3
step 3: the `auto_decision` event is the commit record. A sidecar/gate-file preview
without its event is inert (replays ignore it); an event without its sidecar line is
rebuilt by `audit`'s cross-check; `state.json` is saved last, so a crash before the
save re-presents the gate on resume — idempotent because every write in the sequence
is either a fresh versioned file or an append.

The step-4 auto-settle path gets the same analysis with a different commit record: the
**`gate answered` event** (emitted after the settle tail completes, per the D3 step-4
write order) is the settle commit record. A crash between the `auto_decision` event
and the `gate answered` event leaves status `running`, `state.gate` null, and an
uncommitted decision — `deriveResumePoint` would re-enter the tail and re-present the
gate. On resume, an `auto_decision` approve/extend **without** its paired `gate
answered` is therefore treated as **not-decided**: the prelude re-runs idempotently
(signals rebuilt, rule re-evaluated, gate written and settled from scratch), and the
report gains block counts only `auto_decision` events paired with a subsequent `gate
answered` fold, so a phantom approve is never reported as an intervention avoided and
the decompose/atomicity tail is never double-spent on a settled gate.

### D6 — Queued steering: `steer.md` consumed at round boundaries

A run dir file `runs/<id>/steer.md` accepts line directives: `extend`,
`veto <id>=<redirect>`, `abort`. The review loop (`review-loop.ts`) checks for the file
at each round boundary (cheap `existsSync` + read at the same point it evaluates the
round cap), consumes it by renaming to `steer.consumed.<n>.md` (append-only audit —
never delete), and translates directives into the same structures the gate paths
produce: `abort` short-circuits to `finalizeGate aborted` at the next gate; `extend`
bumps `state.roundCap` with the same mechanics as the R2 path (roundCap bump + loop
re-entry) but does **not** consume `autoExtendsUsed` — steering is itself the human
intervention R2 exists to avoid, so a human-steered extend never eats the auto-extend
allowance and cannot circumvent R2's bound (the bound applies only to policy-decided
extends); `veto` entries are staged into the
next presented gate as pre-filled vetoes. At `observe`/`assist`, blocking gates remain
the default — steering is the non-blocking *alternative*, not a replacement.

**Staged directives are persisted, not held in memory.** Between round-boundary
consumption and gate presentation, staged-but-unapplied directives live in
`runs/<id>/steer.staged.json`, written in the same boundary tick *before* the rename to
`steer.consumed.<n>.md` completes (so a crash mid-tick re-consumes idempotently, never
loses). The gate seam reads the staged set when building the next presented gate,
clears an entry when its target gate settles or the directive is orphaned (veto
orphaning below), and resume-after-crash reloads the staged set — an operator's queued
abort/veto survives a crash between boundary and gate. The D3 step-0 pre-settle check
consults this staged set in addition to the raw `steer.md`.

Three mechanics are pinned because the naive reading is inert or unsafe:

- **Extend visibility.** `runReviewLoop` currently binds `cap` once at entry and
  threads it through the `runRound` recursion, so mutating `state.roundCap` mid-flight
  changes nothing. The round-boundary check is changed to re-read the persisted
  `state.roundCap` at each boundary (the same read the steer consumer already does),
  so a steered `extend` takes effect at the next boundary — the same re-entry shape
  `runExtendRound` uses, not a mid-flight mutation.
- **Veto validation and orphaning.** Staged veto ids are validated against the
  assumption/finding ids of the gate they are staged into; an unknown veto id is
  logged and skipped exactly like an unknown directive (never fatal). If the target
  gate is auto-decided before the staged veto is consumed, the veto is recorded as an
  orphaned steer line on the renderer and dropped — the operator's recourse is the
  `gate reopen` overturn path (D9), not retroactive injection into a settled gate.
- **Trust boundary.** The run dir is agent-writable (stage agents run with cwd
  `repoRoot` and write sidecars under it), so `steer.md` is treated as an *untrusted
  operator-hint channel*: directives are parsed line-by-line against a fixed grammar,
  validated, and never interpolated into shell commands, file paths, or prompts. The
  three verbs are safe-by-construction under injection — `abort` and `extend` only
  move the run along paths the human gate already offers, and staged `veto`s are
  re-presented to a human (or orphaned) rather than executed. An agent scribbling
  `abort` into `steer.md` can stop its own run — a denial-of-work the agent already
  has by failing — and cannot gain any capability.

Unknown directives (and unknown veto ids) are surfaced as a plain warn line through
the renderer's normal output path (the same channel `presentGateAt` uses for its
stdout hints) and skipped, never fatal — deliberately **not** a new `events.ndjson`
variant, which would have to be added to both event unions for a message with no
replay value. The policy prelude also checks `steer.md` immediately before any
auto-settle (D3 step 0), closing the gap between the last round boundary and
settlement.

**Alternative rejected:** watching `steer.md` continuously (fs.watch) — nondeterministic
timing mid-round; round-boundary consumption is the same "next tool-step boundary"
semantics the repo already uses for mid-run steering in papai, and is trivially
testable.

### D7 — clack as a `Prompter` implementation, session untouched

`gate-session.ts` already depends only on the two-method `Prompter` interface
(`prompter.ts`), with `readlinePrompter` and `scriptedPrompter` as the existing
implementations and behavior fully covered via `scriptedPrompter`. The clack adoption
is therefore one new file, `sdd-runner/src/clack-prompter.ts`, exporting
`clackPrompter(): Prompter` that adapts `@clack/prompts` (`confirm`/`select`/`text`/
`spinner`) to `ask`/`say`, translating clack's cancel symbol to `null` (the existing
abandon signal). The selection lives behind the existing composition seam: the
composition root's `makePrompter` (`index.ts`) returns `clackPrompter()` when
interactive, so `extend-round.ts collectGateDecision` keeps its
`deps.makePrompter?.() ?? readlinePrompter(...)` shape untouched; `node:readline` stays
as the non-clack fallback (e.g. `SDD_NO_CLACK=1` or non-UTF8 terminals — the check
lives inside `makePrompter`) and remains the
non-TTY power path. Session walkthrough logic, consequence lines, the decision menu,
and the flag/hand-edit paths are untouched; the existing parity tests
(clack/flag/hand-edit produce identical `GateResponse`s) are extended to drive the
clack adapter with a mocked `@clack/prompts` rather than rewritten.

**Why not the alternatives:** rewriting the session natively on clack would destroy the
`scriptedPrompter` test seam and couple decision logic to a UI library; keeping
readline only would forfeit the interaction polish (select menus, validated multiselect)
that is the entire point of Workstream B. Justification for a new dependency: the
existing stack (Vercel AI SDK, Grammy, discord.js, zod, drizzle) contains no terminal
prompt kit — Grammy/discord.js are chat-platform SDKs, drizzle is DB, zod validates.
`p-limit` and `zod` (sdd-runner's only deps) do not render prompts. clack is small and
focused (~116KB unpacked plus `@clack/core`, per registry metadata — not the ~2KB the
task brief's research table claims; the adoption rationale stands on API fit, not
byte count), ESM, TS-native, MIT, and workspace-local to `sdd-runner/package.json` per
the task constraints.

### D8 — `sdd-runner watch <runId>`: replay-then-tail over the event log, Ink render

New verb wired in `cli.ts` (`VALID_SUBCOMMANDS`, `CliCommand` union, harness method).
The run-id argument resolves through the same `resolveRunId` unique-prefix resolver
`gate resume` uses (`run-state.ts`) — existing run dir or unambiguous prefix; anything
else, including input containing path separators, fails the resolver's directory
membership check and is rejected rather than joined into the runs path.
Implementation: `watch.ts` replays `events.ndjson` via `createReplayFolder` to catch
up, records the byte offset the replay consumed, then tails by polling `fs.stat`
mtime/size on a 500ms interval, folding only bytes past the recorded offset through
the same folder — the offset handoff means an event appended between replay and the
first poll is folded exactly once, never missed or doubled. **Not** `fs.watch`, which
is flaky on macOS for append-only files and unnecessary at this cadence. Rendering is
an Ink 7 app
(`watch-view.tsx` — or `.ts` with `React.createElement` if the repo's tsconfig doesn't
already allow JSX in sdd-runner; decide at task time, default to no-JSX to avoid
tsconfig churn) with four regions: pipeline map + stage times, scrollable findings
list (from folded `finding` events), live burndown + `autoDecisions` list, and
**per-agent slots** folded from `spawned`/`retrying`/`done` events into the same slot
model `live-renderer.ts` maintains (required by the spec's Watch verb). Watch exits
when the run status reaches a terminal state (`completed`/`aborted`/`failed`) — the
status is read by polling `state.json` (read-only) on the same 500ms interval, since
no terminal run-status event exists in the event log — or after 60s with no new
events on an already-terminal log, printing an idle-exit
notice; it also exits on q/Ctrl-C as any Ink app. Exit restores cursor explicitly
(known Bun/macOS cosmetic bug oven-sh/bun#26642).

`DynamicRenderer` is **not** migrated to Ink in this change: Tier 0 keeps the
hand-rolled block (consolidated via `shared-tui-renderer`), and Ink is introduced only
for the new scrollable/interactive surface where hand-rolled ANSI genuinely cannot go
(resize, scroll regions). This is the proposal's ladder step 6 — the least adoption
that pays. `ink` + `react` land as sdd-runner-local deps, `ink-testing-library` as a
devDep for string-snapshot tests of the watch view. Justification, same shape as D7:
nothing in the installed stack provides a terminal reconciler; the hand-rolled engine
has no scroll-region or resize model, and building one is strictly more code than the
Ink dependency.

### D9 — `audit` verb, gains block, and the policy-debt ledger share one source: `auto_decision` events

- `sdd-runner/src/audit.ts`: resolves the run id through the same `resolveRunId`
  unique-prefix resolver as `gate resume` (path-traversal-safe, D8), then
  `readEvents` → filter `auto_decision` → group by rule →
  render the reconsider list: per decision, rule id, evidence digest, and the
  copy-pasteable overturn command. The reconsider list applies the **same
  real-decisions filter as the gains block**: only `decision ∈ {approve, extend,
  accept-items}` records get an overturn command — `preview` records (observe mode,
  nothing was auto-decided) and `gate`/`none` records (undecidable, human-presented)
  are excluded, so an observe run yields no reconsider entries.
  Because an auto-settled gate has no pending
  `state.gate` entry, the existing `gate resume --veto/--abort` cannot overturn it;
  this change adds **`sdd-runner gate reopen <runId> --gate <n>`**, which re-presents
  the settled gate version `n` as pending (bumping to a fresh version, setting
  `state.gate`) so the *existing* veto/abort resume mechanics apply unchanged. Reopen
  does **not** copy the answered file forward verbatim — a verbatim copy parses as
  fully answered, so a no-flag resume would instantly re-settle the very decision
  being overturned. Instead reopen **re-renders the gate at the fresh version as an
  unanswered digest** (answered `## Gate response` section cleared, boxes unchecked,
  digest sections carried over) and writes a fresh `gate-hashes-<freshVersion>.json`
  sidecar computed over the current artifacts — copying the *old* version's hashes
  forward would false-positive `detectHandEdits` and the drift check on any artifact
  touched after settlement. Audit therefore prints
  `sdd-runner gate reopen <runId> --gate <n> && sdd-runner gate resume <runId> --confirm-all --veto <id>=<redirect>`
  (or `--abort`) — runnable as-is against an auto-decided run. The `--confirm-all` is
  load-bearing: `desugarFlags` rejects veto-only input, and confirm-all-plus-veto is
  exactly "keep every auto-accepted item except this one". Reopen is a human
  command only; no rule ever invokes it (R5-adjacent: it changes a settled decision).
  **Reopen preconditions and post-conditions** (pinned because the existing mechanics
  only apply unchanged to the latest gate of a still-running run): reopen **refuses**
  (a) when `state.gate` is already pending — the pending slot is single-valued and
  clobbering it would orphan the live gate (its file would keep influencing
  `nextGateVersion` while nothing points at it); (b) when `gate-<n>.md` does not exist,
  names the currently pending version, or was never settled; and (c) when `<n>` is not
  the **latest settled gate** of the run — settling a stale reopened gate would apply
  `updateAssumptionsFromVetoes` to the *current* round's sidecars with stale veto ids
  and re-run the decompose/atomicity tail out of order. Reopening the final gate of a
  run in a terminal status (`completed`) reverts `state.status` to the pre-settle
  stage state, so the subsequent resume re-drives the normal settle/tail path; a later
  `--abort` on the reopened gate is the defined un-complete path and leaves
  already-produced artifacts in place (run dir + change folder — R5's reversible write
  set). Reopen also clears any persisted deadline fields (D11), so the overturn is
  never silently re-auto-settled by the deadline machinery being overturned.
  Policy-debt ledger: the **single writer is the policy-prelude seam** (D3 step 5),
  which appends every undecidable outcome to `<workDir>/policy-debt.jsonl` (workDir is
  configurable, default `.sdd-runner`; workdir-level, not run-level — the ledger
  aggregates across runs) at gate time, so the ledger is complete even if `audit`
  never runs. `audit` only *reads* the ledger and reports it, applying the dedupe key
  `(rule, hash(evidenceDigest))` with a count at read time — no write path in `audit`,
  so double-counting is impossible and the "records every decision" requirement holds
  at decision time, not audit time.
- `report.ts buildReport` gains the gains block as a new section computed by the same
  fold, **filtered to real, committed decisions only**: `auto_decision` events with
  `decision ∈ {approve, extend}` **paired with a subsequent `gate answered` fold** (D5 —
  an unpaired event is a crash-orphaned, not-committed decision) count as interventions
  avoided; `decision: 'accept-items'` (D3 partial pre-check-and-present — a human gate
  was still presented) never counts and is reported separately as per-rule "items
  auto-accepted";
  `decision: 'preview'` (observe counterfactuals) and `decision: 'gate'` /
  `rule: 'none'` (undecidable) are excluded from N and shown, if at all, as separate
  preview/policy-debt counts. Output: `interventions avoided: N · human gates: M ·
  ~wall-time saved` per rule id.
  Wall-time saved is estimated as `N × median human-gate dwell` where dwell is measured
  from `gate presented` → `gate answered` event timestamps in historical runs, with a
  fixed conservative constant (5 min) when no history exists. The estimate is labeled
  `~` and the formula lives in one helper so it can be corrected in one place.

**Alternative rejected:** sourcing gains from `auto-policy.jsonl` — the sidecar only
exists in `observe`; the event log spans all levels and is already the replay source
of truth.

### D10 — Tier 0 polish is confined to the dynamic path + gate files

All Tier 0 items (per-stage wall/cost on `renderPipelineMap`, active-stage elapsed
marker, wide-char-aware truncation, retry badges, model id on done lines, ETA +
reasoning tokens, sparkline, terminal title, `--verbosity quiet`) land in
`renderer.ts` (pure format functions — the natural home for snapshot-testable text),
`live-renderer.ts DynamicRenderer` (state tracking: per-stage timestamps from
`stage_enter`/`stage_exit` folds, retry state from `retrying` events), and
`gate-render.ts` (trajectory sparkline beside existing per-round counts). The single
sanctioned non-TTY change — the done-line model id — is a one-field addition to
`formatEvent`'s `done` branch (`renderer.ts`), pinned by the golden-byte test.
Wide-char-safe truncation uses a small `wcwidth`-style table kept local to
`renderer.ts` (a dependency for ~80 lines of range checks is rejected per the
ponytail ladder; `Intl.Segmenter` + range arithmetic covers emoji/CJK).
`--verbosity quiet` is parsed in `cli.ts` (`VERBOSITY_VALUES`) and short-circuits
`LineRenderer`/`DynamicRenderer` to the final summary only **plus the operational
lines a suppressed run must not lose**: the gate-pending path and
`Next: sdd-runner gate resume <runId>` hint `presentGateAt` prints, deadline
bell/notification lines (D11), steering warn lines (D6), and — when a run halts at a
gate and therefore has no final summary — a one-line halt record
(`halted at gate <n>: <path>`). Quiet suppresses the *stream*, never the *way out of
the run*. Verbosity is a **per-command flag**, parsed on `resume`/`continue`/`gate`
exactly as on `start` (today only `start` accepts it), and is not persisted in
`RunState` — each invocation chooses its own noise level, so a quiet start does not
force a quiet resume. The sanctioned non-TTY done-line addition is
`<agent> done · <model> · …` **when the `done` event carries a model id**; historical
or unmetered `done` events without one keep the pre-change line exactly (the model
segment is omitted, never rendered as a placeholder), so the golden-byte delta is
strictly additive. Terminal title sequences
are written only on TTY streams and restored best-effort: a `process.on('exit')` hook
plus `SIGINT`/`SIGTERM` handlers registered by `DynamicRenderer`'s owner (`index.ts`),
never by the renderer itself. Restoration cannot survive `SIGKILL`, and terminals that
don't support title query get a fixed default restore string — both limits are
documented in the requirement; the spec language is best-effort, not unconditional.

### D11 — The `--auto-deadline` deadline is persisted and waited on cross-process

`auto` + `deadlineMinutes`: when a gate is presented (ladder couldn't decide), the
presenting process records `gateDeadlineAt` (ISO timestamp) on `RunState` via
`saveRunState`, prints the terminal bell + notification line, and exits as it does
today — it does **not** block on `runGateResume` (start/resume reach `process.exit`
after `presentGateAt`; the gate wait is a separate later command). The deadline is
therefore evaluated by an explicit **foreground waiter**: `sdd-runner gate resume
<runId> --wait-deadline`. The waiter is also the default for flagless `gate resume`
**on a non-TTY** when `gateDeadlineAt` is set; on a TTY, flagless `gate resume` keeps
today's behavior and enters the interactive session (the session header shows the
pending deadline), because the interactive session and the hand-edited file are the
only two human answer paths and neither may be locked out by a deadline. A `--no-wait`
flag forces the immediate hand-edit/interactive path on a deadline-pending gate. The
waiter polls `state.json` and the current
`gate-<n>.md` on a 1s interval **without caching `RunState`** — every tick reloads
from disk, so a gate settled by another process (a second `gate resume` with flags,
a hand-edited file, or a consumed steer directive)
is observed as done and the waiter exits cleanly instead of expiring. **Hand-edits
are honored by the waiter itself:** each tick it parses the polled `gate-<n>.md`, and
when the file parses as human-answered (its answered section differs from the
presented digest) **and has been stable — mtime and content hash unchanged — for 3
consecutive ticks (~3s)**, the waiter settles it through the normal `resumeGate` path —
integrity check included — and exits; the spec's hand-edited-file scenario therefore
holds unchanged under a pending deadline. The stability guard exists because
`parseGateResponse` treats an unchecked box as a veto, so a non-atomic editor write or
a two-step edit (check-all save, then uncheck-the-veto save) parses as a valid but
unintended outcome — the waiter must never settle a file mid-edit. The waiter
also polls `steer.md` during the wait (the round-boundary-only consumption of D6
does not run while the run sits at a gate), consuming it with the **same rename
protocol** as D6 (`steer.consumed.<n>.md`, append-only, never delete) so a re-armed
deadline never re-applies a consumed directive, and translating a landing `abort` to
the `--abort` outcome and a landing `veto <id>=<redirect>` to the
`--confirm-all --veto <id>=<redirect>` outcome — veto-only is a rejected flag
combination (`desugarFlags`), and confirm-all-plus-veto is the defined flag
equivalent: veto the named items, accept the rest. A landing `extend` translates to
the extend outcome at an **early** gate (the same routing as the `--extend` flag into
`runExtendRound`, consuming no `autoExtendsUsed` per D6); `parseGateResponse` rejects
`→ RUN 1 MORE` at final gates, so a landing `extend` during a final-gate wait is
surfaced as a warn line and skipped like any invalid directive — never silently
rename-consumed without effect.

At expiry the waiter **reloads state immediately before any write** and re-runs the
ladder with `deadlineExpired: true` (a `PolicySignals` field, D1), which permits only
the rules' conservative
branches: approve only if R1 would have fired, else extend if R2-eligible, else the
gate stays pending and the deadline re-arms exactly once (a dead-man expiry with no
safe decision never auto-aborts and never loops). Mutual exclusion between concurrent
waiters is explicit, not incidental: before any expiry write the waiter **claims the
gate** by exclusive-creating `runs/<id>/gate-<n>.expiry-claim` (`wx` — create fails if
the file exists) after the reload and before the ladder re-run; a waiter that loses the
claim treats the gate as settled-or-claimed by another process and exits. The claim is
the single-writer guarantee for the `auto_decision` event, the policy-debt ledger
append, and the settle writes — `appendEvent` computes seq by counting lines with no
inter-process coordination, so without the claim two same-tick expiries would emit
duplicate seq values and double-settle (including two `runExtendRound` invocations).
The claim file is left in place as an append-only audit artifact. Re-arm consumption
is persisted:
`RunState` gains `gateDeadlineReArmed: boolean` (default false), set via
`saveRunState` **before** the re-armed deadline is written, so a restarted waiter —
or any later `gate resume --wait-deadline` process, all of which reload from disk —
distinguishes a first expiry (re-arm permitted) from a second (stay pending forever).
A second expiry with still no safe
decision leaves the gate pending indefinitely — the human path. If the presenting
process exits or is killed before expiry, nothing is lost: `gateDeadlineAt` is on
disk and any later `gate resume --wait-deadline` (or the next operator command)
evaluates it; an already-passed deadline is processed on first observation.
After-the-fact veto of a deadline-settled gate goes through `gate reopen` (D9), like
any auto-settled gate. The terminal bell + notification line is written at
presentation and again at expiry by whichever process performs the expiry.

Deadline field lifecycle, pinned so no stale deadline survives its gate:
`gateDeadlineAt` and `gateDeadlineReArmed` are **cleared on any settle** (human,
policy, or waiter) and **cleared by `gate reopen`** (D9) — a reopened gate never
inherits the deadline machinery being overturned, so a flagless non-TTY `gate resume`
after reopen enters the normal answer path rather than the waiter. Every gate
presentation **overwrites** `gateDeadlineAt` when `deadlineMinutes` is set and
**clears** both fields when it is not, so a stale deadline from an earlier gate never
leaks into a later presentation, and an already-passed deadline is expiry-processed
only while its own gate is still pending.

### D12 — Project-rules impact statements

- **Capability/tool-prefs gating:** none. sdd-runner is local developer tooling; it
  adds no papai tool surface, no `tool_prefs` entries, no LLM tool-calling path.
- **Scope model:** none. All new persisted state (`auto-policy.jsonl`,
  `policy-debt.jsonl`, `steer*.md`, `steer.staged.json`,
  `RunState.autoExtendsUsed`/`gateDeadlineAt`/`gateDeadlineReArmed`) is keyed by run id
  under `.sdd-runner/runs/<id>/` or the runner workdir — no storage-context,
  config-context, platform-instance, or user ids exist in this workspace.
- **DB / drizzle:** none; no migration, no backfill.
- **New dependencies:** `@clack/prompts` (D7), `ink` + `react` + dev `ink-testing-library`
  (D8) — justified per-decision above; all workspace-local to `sdd-runner/package.json`.
- **Hook/TDD interactions:** every new/changed file under `sdd-runner/src/**` is gated
  by the Write/Edit TDD hook pipeline. Test-first order of work: (1) `events.ts` +
  `replay.ts` schema/fold tests → implement; (2) `auto-policy.ts` rule tests (pure,
  table-driven per rule R1–R5 incl. R4 exceedance and inert-`budgetUsd` first
  enforcement, R2 flat-vs-decreasing fixtures, and R3 evidence fail-closed:
  missing/empty/un-cross-checkable `evidence.files` → high-blast)
  → implement; (3) gate grammar + self-check tests (`gate-render.ts`, `gate-model.ts`,
  `gate-answers.ts`) → implement; (4) orchestrator/extend-round integration fixtures
  (observe byte-identity, assist zero-prompt completion, BLOCKER-still-gates) →
  implement; (5) `audit.ts`/`report.ts` output tests; (6) renderer snapshot + non-TTY
  golden-byte tests → Tier 0; (7) clack parity tests → `clack-prompter.ts`; (8)
  ink-testing-library snapshots → `watch`. New modules (`auto-policy.ts`, `audit.ts`,
  `watch.ts`, `clack-prompter.ts`, steering reader in `review-loop.ts`) each land with
  their test file in the same change.

## Risks / Trade-offs

- **Agent-writable policy inputs (threat model)** → every R1/R2/R3 input lives in the
  agent-writable run dir (resolver sidecars, appendable event log). R3 was already
  hardened (`blast_radius` display-only); D3 step 1 extends the same posture to R1/R2:
  resolver-sidecar parse failure is unknown (fail closed), never empty open lists, and
  R1 requires replay-folded finding counts to agree with sidecar counts. A buggy
  resolver that under-reports open findings therefore yields a human gate, not an
  auto-approve. This is a stated-bug-tolerance model, not an adversarial-security
  boundary — an agent with filesystem write access can already fail its own run; the
  cross-checks keep such failures from silently satisfying auto-decision predicates.
- **Counterfactual drift (observe previews ≠ assist behavior)** → previews and real
  decisions are produced by the *same* pure evaluators (D1) over the same signals;
  drift is only possible if signals are assembled differently at the three call sites,
  which the D3 prelude prevents by building `PolicySignals` once per gate.
- **R2 auto-extend burns budget on a run that never converges** → hard bounds:
  `autoExtendMax` (default 1) auto-extends per run, R4 ceiling check with projected
  spend, and a flat/worsening trajectory on the extended round falls through to the
  normal early gate (the strictly-decreasing predicate fails on the next evaluation).
- **Gate grammar extension breaks hand-edited-file parsing** → the `decided-by:` line
  is optional and the parser strips it before comparison; the extended write-then-parse
  self-check (D4) plus the existing hand-edit parity tests pin both directions.
- **`readEvents` strictness means a malformed `auto_decision` line poisons the whole
  log** → the event is zod-validated at append time (`appendEvent` parses before
  writing), so only a bit-rotted file can fail — same blast radius as every existing
  event type.
- **clack cancel/EOF semantics differ from readline** → the adapter maps clack's cancel
  symbol to the existing `null` abandon signal; parity tests drive both adapters
  through identical scripts.
- **Ink + react add ~MB-scale deps to a dev tool** → contained to the `watch` verb via
  dynamic import, so `start`/`resume`/`gate` startup cost is unchanged; deferred
  entirely if Tier 0 suffices (proposal ladder step 6).
- **Deadline auto-proceed on a dead-man deadline could approve something a human would
  have vetoed** → expiry only re-runs the deterministic ladder (no new decision class),
  never auto-aborts, re-arms once when nothing is safe, state is reloaded from disk
  immediately before any expiry write, and after-the-fact veto via `gate reopen` (D9)
  remains available.
- **Steering directives consumed at round boundaries can arrive too late to matter** →
  accepted trade-off: documented as "next round boundary" semantics, matching papai's
  mid-run steering model; the blocking gate remains for urgent stops.

## Migration Plan

1. Land `shared-tui-renderer` first (runway; byte-identical, independent).
2. Ship `observe` (D1, D2, D4, D5 schema + previews + sidecar): zero behavior change,
   rollback = delete config key / set `level: "observe"`. **Binary downgrade is only
   safe for runs whose `events.ndjson` contains no `auto_decision` lines** — the old
   binary's `readEvents` throws on the first unparseable line (D5), so rolling the
   binary back under runs that already carry the new event requires either stripping
   those lines first or keeping the newer binary for replay/audit of those runs.
3. Ship `assist` (R1, R3, R4 wiring + RunState field) behind config opt-in; rollback =
   `level: "observe"` — no data migration needed since `RunState.autoExtendsUsed` is
   additive with a default.
4. Ship R2 + `auto` + deadline; ship `audit`/gains/steering.
5. Ship Tier 0 + clack front-end (flag parity proven first).
6. Ship `watch` last — it depends on nothing but the event log and can be dropped from
   the change without invalidating any earlier step.

Rollback at every step is config-level (`autonomy.level: "observe"` restores today's
behavior byte-for-byte); no destructive migration exists to reverse. Binary (not
config) downgrade is the one exception, qualified in step 2: safe only for runs
without `auto_decision` lines, per D5's strict-parse constraint.

## Open Questions

None that affect the specs or task breakdown. Two implementation-time choices are
deliberately deferred and safe: (a) JSX vs `React.createElement` for the watch view
(D8 — defaults to no-JSX to avoid tsconfig churn); (b) the exact wcwidth range table
source (D10 — any standard table satisfies the snapshot tests). Neither changes a
requirement, a module boundary, or the order of work.
