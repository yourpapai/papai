# opencode-agent Workspace

## Purpose

`opencode-agent/` is a standalone Bun workspace holding a **spike**: an
event-driven GitHub Actions coding agent built on the OpenCode SDK and
obra/superpowers skills. It is not a papai runtime dependency and nothing under
`src/` imports it. Full behaviour, configuration and setup: `README.md`. Open
findings: `ROADMAP.md`.

## Shape

- One CI job = one call to `runCli`. State lives in hidden blocks on the
  conversation, not on disk: `AGENT_STATE` for the machine, `AGENT_REPORT` /
  `AGENT_HANDOFF` for the report and the wall-clock handoff. On the issue until
  a pull request exists and on the pull request after that, with `readThread`
  reading both — see the surface rule below. The design spec and the plan used
  to travel here too (`AGENT_SPEC` / `AGENT_PLAN`); under the OpenSpec rework
  (design D1 — the folder is truth, comments are renders) they live in
  `openspec/changes/<name>/` on `agent/issue-<n>`, and the human parks review
  rendered digests of that folder. `AGENT_STATUS` is the odd one out — it is not
  state but a **position**: the point in a reply where the bookkeeping starts, so
  `renderThread` can cut the body there. A run makes exactly one comment, at the
  end, carrying every phase's report as a section above that marker and the run
  detail and every block below it.
- An event is parsed before it is judged: `src/trigger-events.ts` says what a raw
  payload **is** and `src/guardrails.ts` whether the pipeline may act on it. That
  split is not tidiness — it is what lets `src/pr-trigger.ts` finish a parse
  without importing the policy layer that will judge the finished event, which
  would be a cycle. There are **four** doors, not three: an issue event, a red CI
  run, a comment typed on a pull request (the one `parseTriggerEvent` cannot
  finish alone — `src/github-pulls.ts` reads the head that names its issue), and
  a merged pull request (`pull_request.closed(merged)`, the archive door D7 —
  `src/phases/archive.ts` runs `openspec archive` as a follow-up commit on the
  base branch).
  `src/agent-handle.ts` holds the memoized OpenCode session `index.ts` used to
  own, which also ends `deps.ts` importing back from the module it was split from.
- `src/triggers.ts` decides _whether and where_ an event moves the state — it
  keeps the slash commands and the dispatch — with the red-CI half in
  `src/ci-trigger.ts`, the plain-comment half in `src/comment-intent.ts`, and the
  shared outcome shape plus `moveOrSkip` in `src/trigger-outcome.ts`;
  `src/orchestrator.ts` drives the phase cascade once that decision is made;
  `src/token-budget.ts` and `src/time-budget.ts` each decide whether the cascade
  may afford another step — one in tokens, one in wall clock, deliberately the
  same shape, and asked in that order because tokens span jobs and a fresh clock
  does not; `src/turn-stop.ts` is the _other_ wall-clock stop, the one reached
  from inside a running turn, with `src/salvage.ts` holding the git half of it;
  `src/transitions.ts` holds the state machine itself (the table,
  `canTransition`, `transition`) while `src/state-manager.ts` keeps only the block
  channel that restores it from the issue, `src/phase-names.ts` holds what a phase is
  **called** — the enum, the retired names and the migration that maps them, split
  from `types.ts` and re-exported by it so callers keep naming one module for the
  vocabulary; and `src/phase-failure.ts` decides what
  a run that broke is left looking like.
  Phase handlers in `src/phases/` return a `TransitionSignal`, a comment body and
  optional artefact blocks, and never write state or decide the next phase
  themselves. `src/phases/implement.ts` is the one that delegates: `src/plan-steps.ts`
  says what a step is, `src/phases/implement-steps.ts` walks them,
  `src/phases/implement-commit.ts` is what making one of them durable costs — the
  commit, the repair rounds `src/commit-repair.ts` drives, and the push — and
  `src/implement-prompts.ts` holds the three things said to the model inside that phase
  — the standing instructions, one step, and the wrap-up asked for when a turn is cut
  off — split from `prompts.ts` because they are the only prompts that arrive in
  sequence within one phase, one session, one system prompt and one envelope. `src/phases/review.ts` is the `review-loop/` workspace as a phase
  of its own, entered from `COMPLETE` on `/review`; `src/pull-request-body.ts`
  renders the one pull request body both it and `handleDeliver` present, and
  takes the report as **text** because a handler cannot read its own block back —
  `postAndAppend` runs in the orchestrator after the handler returns.
  What the pipeline _says_ and what it _posts_ are two modules: `src/run-report.ts`
  renders (a failure, a park, a refusal, a closing) and `src/run-post.ts` holds the
  two writes — `postAndAppend`, the only durable one and the only place a state
  block is appended, and `postAnswer`, the one comment deliberately not a record.
  A renderer changes when the wording does; a write changes when the answer to
  "which page, and does it carry the record" does. The same split one layer down in
  git: `src/git-commit.ts` decides what a commit about to be made may contain and
  enforces it by unstaging, while `src/git-revert.ts` is that rule arriving too late
  — for the review loop's already-merged commits, where the only move left is a
  further commit.
- Feedback on the issue that is not a comment lives apart from the machine that
  causes it: `src/presentation.ts` owns the one phase glyph/label/headline table
  every renderer reads and `src/outcomes.ts` the second vocabulary beside it — the
  outcome glyphs, which are keyed by how a run _ended_ rather than by which phase
  it is in, which is why they are not one table; `src/feedback.ts` the reaction channel over `src/github-reactions.ts`'s
  endpoints, `src/labels.ts` the
  label reconcile over `src/github-labels.ts`'s endpoints, and
  `src/reply-buffer.ts` the run's one comment over the body
  `src/reply-comment.ts` renders — with the run's own account of itself (the
  progress table, the job and branch lines, the budget) split into
  `src/run-detail.ts`. Each channel has exactly one function that
  talks to GitHub, because "best-effort" has to be a property of one function
  rather than a convention at each call site. The reply carries an
  `AGENT_STATUS` block and, unlike the live status comment it replaced, the
  run's `AGENT_STATE` too: with one comment per run there is no second comment
  for the restore scan to choose between, and `readBlock` already returns the
  _last_ block of a marker in a body while `locateLatestBlock` walks comments
  newest-first, so newest-wins is unchanged. `prompt-budget.ts` cuts each body
  at the `AGENT_STATUS` marker rather than dropping the comment, which it can no
  longer do — the answer, the design digest and the plan all live there now.
  Cut by **marker**, never filter by author: the agent writes the spec, the plan
  and every report too.
  `src/state-persist.ts` is the same shape for a write that is not feedback at
  all: rewriting the state block in place, so a run that posts nothing can still
  record what it spent. `src/budget-notices.ts` holds what a run says when a
  **ceiling** stopped it and nothing broke, along the seam `presentation.ts` had
  already drawn: ❌ means the work broke, ⛔ means a bound was reached in a run
  where nothing did — with the **wall-clock** three in `src/time-notices.ts`,
  split off when a third of them would not fit beside the counter ceilings.
- Config is read in two halves and discovered in a third. `src/config-values.ts`
  reads and refuses one value out of the environment — every range-checked scalar, and
  `AGENT_CHECKS`, its one non-scalar — `src/config.ts` says which values a run needs, and `src/config-discovery.ts` holds the two settings
  that are **asked for** rather than read — the review command, from whether the
  checkout has a `review-loop/`, and the base branch, from the event payload and
  then `origin/HEAD`. Both take their probe as an argument, so both ladders are
  testable without a filesystem or a remote, and neither has a literal fallback:
  a baked-in review path reported every run outside this repository as
  permanently red, and a `main` default killed every run inside it.
- The OpenCode boundary is three files, split by what changes them.
  `src/sdk-contract.ts` is what the SDK **says** — the shapes, recorded;
  `src/opencode-connect.ts` is how it is **started and addressed** — a spawned
  process, a port, a base URL; `src/opencode-adapter.ts` is the **session** the
  pipeline holds — an id, a lifetime, a teardown. `src/turn-run.ts` is the fourth
  and the newest: one **turn**, which is the thing with a clock, a heartbeat and
  four ways to end (answered, deadlined, stalled, dead server). It owns the
  bounds, the heartbeat and the failure
  classification, and it never imports back from the adapter — `TurnBounds` and
  `TurnConnection` are narrow slices that `OpenCodeAgentOptions` and
  `OpenCodeConnection` extend, so each states what running a turn actually needs
  rather than restating what an agent is.
- Every external boundary is an injected interface (`GitHubApi`, `Git`,
  `CheckRunner`, `RunReview`, `OpenCodeAgent`, `ReadSkillFile`).

## Local rules

- **Never scrape prose to recover an artefact.** Spec, plan, report and the
  wall-clock handoff travel in hidden blocks via `blocks.ts` / `artifacts.ts`.
  Heading-and-trailer scraping silently truncated specs at their first `---` rule;
  do not reintroduce it. The design spec and the plan **used to** travel in
  `AGENT_SPEC` / `AGENT_PLAN` blocks; under the OpenSpec rework (design D1) they
  live in `openspec/changes/<name>/` on the branch, the human parks review
  rendered digests (`renderDigest` in `artifacts.ts`), and `REVIEW_AND_MUTATE`
  walks `tasks.md` checkboxes as the step source (D5). The retired block names
  and their revision counters (`specRevision`) are gone; no legacy restore path
  exists, and in-flight issues restart under the `STATE_VERSION` bump (D12).
- **`ensureBranch` comes before the first read of the folder, in every phase that
  reads one.** The workflow's `actions/checkout` names no ref and must not grow
  one — `ARCHIVE` commits to the base branch, capture cuts a branch that does not
  exist yet, and a checkout pinned to `agent/issue-<n>` fails outright on the
  first event of an issue. So a job's workspace **starts on the base branch**, and
  `openspec/changes/<name>/` — scaffolded and pushed by whichever earlier job
  captured the issue — is not in it until `deps.git.ensureBranch` switches
  branches. Every phase after capture runs in a different job by construction:
  capture parks at `DESIGN_SPEC` and the `/approve` that enters `PLANNING` arrives
  whenever a maintainer types it. `PLANNING`, `REVIEW_AND_MUTATE` and
  `CODE_REVIEW` each read the folder one line **before** that call and each died
  the same way — `openspec status` exit 1, "Change '<name>' not found", followed by
  a list of the base branch's changes that reads like the folder was never
  scaffolded. Issue #331 is the fourth reader: `handleAnswer`'s
  `artifactUnderReview` grounded `/ask` and question-classified comments in the
  folder the same way, so every answer past capture died before the model turn on
  the same exit 1 — the call sits inside `artifactUnderReview`, ahead of the
  `instructions` ask, and only there (a `changeName === null` state has no folder
  to read and no branch to switch to). The ordering is not visible to a stub
  whose driver answers the same
  on any branch, which is how three handlers acquired the same defect; the fake in
  `phases.test.ts` refuses every driver call and every `readFile` until
  `ensureBranch` has been called, so a phase that reads too early fails the test
  the way it failed the run. The same call **refuses a dependency-drifted branch**
  (`git-drift.ts`): the workflow installs from the base checkout and no second
  install follows the branch switch, so a branch whose `bun.lock` / `package.json`
  manifests differ from base runs every check against a `node_modules` that cannot
  serve it — run 32507905723 paid for a full PLANNING turn and then died in the
  pre-commit hook on `TS2307` for an import base had stopped carrying. The refusal
  (`dependencyDriftError`) names `/sync` and the hand-merge as the remedies and
  never a bare `/retry`; `/sync` passes `allowDependencyDrift` because a drifted
  branch is the condition it exists to repair, and the guard must not block its
  own way out. Issue #323 is the incident that shaped the failure's bookkeeping:
  a drift park is by construction pre-delivery, so the `/sync` the message
  prescribes must be reachable from the issue (see the `/sync` rule below), the
  refusal carries `attempts` rather than spending one (it fires before any
  work — the over-budget stop's doctrine, held in `failRun` behind
  `isDependencyDrift`), and the failure footer does not invite a bare `/retry`
  over a message that says retry cannot change it (`isRetryFutile` in
  `errors.ts`; the settings-gated `PR_FORBIDDEN` is the other member). A branch
  that _intentionally_ changed dependencies is out of reach
  by design — the job cannot install from the agent branch — and the message says
  so; revisit only with a security answer for model-influenced install scripts.
- **An artifact's output path is not always a file, and a pattern is judged
  rather than written.** Three of the `spec-driven` schema's four artifacts
  resolve to a path the drafter can hand to `writeFile`; `specs` does not. A
  change carries one delta spec per capability, so `openspec instructions specs`
  answers with `<changeDir>/specs/**/*.md` — a **pattern** — and only the
  proposal knows how many files that is. `phases/plan.ts` wrote it verbatim and
  run 31664928683 died at PLANNING on `ENOENT … /specs/**/*.md`, after paying for
  the turn that composed the content. So a glob artifact takes the second reply
  shape in `phases/plan-draft.ts` (`{"files":[{"path","content"}]}`, paths
  relative to the change folder, which is how the artifact instruction the model
  is reading spells them) and `glob-output.ts` judges each path before anything
  is written. Three things not to undo. A refused path is a **complaint**, not a
  throw: it rides the retry that already exists for the `validate --strict`
  verdict, because "you wrote outside `specs/`" is exactly what a second ask
  fixes and failing outright discards a paid-for turn over a filename. The
  judging is **containment plus the pattern's extension**, not a `**` matcher —
  what protects the tree is that the file lands under the directory the pattern
  collects from, and a hand-rolled picomatch would add no refusal. And it is
  **all or nothing**: one bad path in a reply discards the whole reply, or
  `validate --strict` would judge a half-written folder and the retry's complaint
  would be about files that had already landed. `deps.writeFile` creates parent
  directories for the same reason the pattern broke — `openspec new change`
  scaffolds a folder holding `.openspec.yaml` and nothing else, so
  `specs/<capability-path>/spec.md` is the first thing in its directory.
- **A change that already exists is adopted, not recreated.** A job checks out
  the base branch, so the only folder a capture can collide with is one the base
  branch already carries — a change somebody proposed and never implemented.
  Issue #281 asked for "the most valuable unimplemented spec", triage answered
  `prompt-injection-defense`, and run 31929516607 died at `INIT_OR_CLARIFY`
  because `openspec new change` exits 1 on a name that is taken and the driver
  turns that into a throw. So capture asks `openspec list --changes --json`
  first (`listChangeNames`) and creates only when the name is free. Three parts
  of the adoption are decisions rather than details. The **proposal is kept**:
  it is what a human wrote when they proposed the change and what every other
  artifact in that folder was drafted against, while this turn's spec is a
  reading of one issue — it is overwritten only when the folder has no proposal
  (a scaffold interrupted before drafting) or when a maintainer's `/changes`
  asked for a rewrite. The **missing artifacts are not drafted here**: PLANNING
  already loops `status` → `instructions` → compose → `validate --strict` over
  every artifact that is not `done`, so an adopted half-drafted change reaches
  the same place a new one does, and capture only _names_ what is pending so
  `/approve` is a known quantity. And the **commit says `adopt`, not
  `scaffold`** — an adopted folder is already in the tree, so that commit is
  usually empty and the verb is the only place the branch history records which
  of the two happened. Residual, deliberately unhandled: a change whose
  `tasks.md` boxes are all ticked but whose work was never implemented adopts
  into an implementation walk with no steps. The `PLAN_REVIEW` digest shows the
  ticked boxes to a maintainer, whose `/changes` re-plans it; nothing can tell
  "already built" from "ticked and abandoned" by reading the folder.
- **Fix-class issues skip specs by triage's call, ratified at the park.** Triage's
  `capture` reply carries a required `skipSpecs` boolean decided under an explicit
  rule — a spec-level change is one where a downstream observer of the system's
  contract would see an added, changed or removed requirement; fixes restoring
  intended behaviour, refactors, docs and tooling are not — with **bias to `true`
  for fix-class issues** (a false capability pressures the model into inventing
  deltas to satisfy `validate --strict`; a false skip is quiet and reversible). A
  recommending capture must write "None — skip_specs proposed because ⟨reason⟩"
  into the proposal's Capabilities section, and `/changes` at the `DESIGN_SPEC`
  park is the correction point. When the flag is true, the scaffold stamps
  `skip_specs: true` into `.openspec.yaml` itself — a deterministic TS patch in
  the driver (`newChange` options), fed by the zod-validated output; the model
  never writes metadata (single-sourced channel, diff-guard scope unchanged).
  Under the flag the CLI reports `specs: skipped` and counts the dependency
  satisfied, so PLANNING composes design (recording the deliberate skip in the
  drafter prompt) plus tasks and never drafts deltas; the validate-retry loop
  stays for genuine failures. `skipSpecs` also doubles as the **depth-lane
  signal**: fix-class issues take the shallow lane (proposal-lite → design-skip
  → tasks), feature-class issues the deep lane. The full depth doctrine —
  distributed exploration, gate depths, the planning-turn `INCOMPLETE` watch
  item — lives in `openspec/changes/opencode-agent-skip-specs-depth/design.md`
  (Decisions 5–6).
- **Capabilities are named at feature-domain granularity, never issue-sized.**
  Capture and specs-drafter prompts both carry the doctrine: names like
  `user-profile-memory` or `sdd-automation`, not one micro-capability per issue;
  and while `openspec/specs/` holds no archived corpus, **new capabilities
  only** — there is nothing yet to modify. Guidance, not a validator: the
  `DESIGN_SPEC` park enforces, the prompt states the rule it cites.
- **The plan counts one identity token, not two artefact revisions.** Under D1
  only `planRevision` remains — a machine identity for "a new plan happened",
  bumped by `PLAN_POSTED` alone, not an artefact revision. The former
  `specRevision` is gone: the proposal lives in the folder and `DESIGN_SPEC`
  reviews a digest of it, so nothing counts spec revisions. The report block
  stamps `planRevision`: it records which plan was implemented, and no signal
  bumps a report counter.
- **A phase rename is a persisted-shape change, and is migrated rather than
  bumped.** `PLANNING` was `EXECUTION_PLAN`; the name is written into every
  `AGENT_STATE` block as `phase` and `resumeFrom`, so an unmigrated rename has
  `z.enum` reject those blocks outright — the restore scan walks past them to an
  older comment, or starts the conversation over, and a parked failure loses the
  resume point `/retry` needs. `LEGACY_PHASE_NAMES` in `types.ts` maps the old
  name onto the new one and `phaseName` applies it inside the schema, which is
  where it has to live: there are four parse sites and three are on the read
  path, and a migration honoured at two of them restores under one scan and is
  discarded by the other. Deliberately **not** a `STATE_VERSION` bump — a bump
  strands every in-flight issue, and there is nothing here it would protect
  against, since the old name maps onto the new one exactly with no field to
  reinterpret. Read the table through `Object.hasOwn`, never `in`: a state block
  is attacker-editable text and `'toString' in` any object literal is true.
- **The 👀 has a lifetime, and the run that placed it owns both ends.** A
  reaction is the pipeline's only instant acknowledgement, and 👀 says "this
  arrived and something is running" — a claim that a run is one CI job makes
  temporary by definition. Leaving it on made every finished issue read as one
  still being thought about, on a comment nobody would touch again. So
  `runPipeline` holds the handle `react` now returns and `settleReaction` closes
  it out: **outcome on, then acknowledgement off**, in that order, because both
  writes are best-effort and the reverse leaves the comment bare for the width of
  an API call — or for good, if the second write is the one that fails. The
  handle lives in `runPipeline` rather than `runAccepted` because 👀 is placed
  before the run knows which of its exits it will take. `OUTCOME_REACTIONS` maps
  `RunStatus`, and its two `null` rows are the design: `completed` covers a
  delivery (where `handleDeliver` has already placed 🚀 — the one place that can
  tell a delivery from a stand-down), a `/cancel` and a stand-down, and the last
  two delivered nothing; `skipped` covers a refused command that already reacted
  😕 and a set of deliberate silences. Removal needs the reaction **id**, which
  only the create returns — hence `ReactionRef` — so never re-derive the target
  at removal time, and never treat a rejected delete as evidence the reaction
  survived.
- **Answering is phase-neutral in both directions.** `ANSWERED` is deliberately
  absent from `TRANSITIONS`; `transition` handles it as a non-moving signal
  accepted in every phase, because `/ask` is accepted in every phase. Do not put
  it back as a row per phase — the table and `/ask`'s reach drifting apart is
  what made a question asked in `COMPLETE`, `FAILED` or mid-pipeline throw
  `InvalidTransitionError` out of the pipeline, after the model turn was paid
  for and with nothing posted on the issue. A **failed** answer does not move the
  phase either: `failAnswer` posts and leaves `phase`, `resumeFrom` and
  `attempts` alone, which is also why `resumeFrom` can never name a waiting phase
  with no handler for `/retry` to resume into.
- **`/sync` is the `/ask` shape: a side operation, never a phase.** A branch
  that fell behind its base had no machine remedy before it — the conflict
  banner was permanent until a human merged locally. `runSync` in
  `src/phases/sync.ts` (the `answer.ts` precedent: a handler that is not a
  phase) merges `origin/<base>` into the agent branch, and every design choice
  follows from "moves nothing". It applies wherever the **agent branch
  exists** — `changeName !== null` is that fact by doctrine, the cancelled
  `COMPLETE` is the one branch-less state still naming a change and is refused
  so `/sync` cannot resurrect what `/cancel` deleted (issue #323: the drift
  park is pre-delivery, and a `/sync` gated on `prNumber` was a remedy the
  state it was prescribed for could not take). Dispatch sits in `sideOperation` beside `/ask`
  in `triggers.ts`, **before** the signal lookup — `/sync` has no
  `COMMAND_SIGNALS` entry, so the transition table is never consulted, no
  `PHASES` member or presentation row exists, and `phase`, `attempts`,
  `resumeFrom` and every per-PR budget are byte-identical after every outcome
  (assert the persisted state, not the returned status). It runs in
  `driveMachine` **ahead of both budget stops**: the clean path spends nothing,
  so `/sync` must work at the token ceiling, and the wall-clock stop parks in
  `INCOMPLETE` — a state move, the one thing `/sync` never does; the handler
  asks the token ceiling itself, before each repair turn only. Repair rounds
  clone the `commit-repair.ts` doctrine (`AGENT_SYNC_REPAIR_MAX_ROUNDS`,
  `ROUND_RANGE`): the prompt names the conflicted paths and carries the markers,
  the model is forbidden git (`SYNC_FORBIDDEN_GIT_RULE`, pinned
  `instructions.test.ts`-style), the pipeline alone completes the merge and
  pushes. No persisted `syncAttempts` — `/sync` is human-initiated like `/ask`;
  the token ceiling is the bound. The merge goes through `Git.mergeBase` /
  `completeMerge` / `abortMerge` in `src/git-merge.ts`, **never `commitAll`**:
  a merge carries base's own already-reviewed content, which the commit path's
  caps and protected-path dropping would misjudge (dropping base's
  `.github/workflows/` edits would silently un-merge them). A conflict is an
  outcome, not an error — `MergeOutcome` — and a refused push carrying base's
  workflow edits is translated by `isWorkflowPushForbidden` in `errors.ts`,
  matched on GitHub's own sentence and naming the update-branch remedy. The
  reply is `postAnswer`'s write (a plain comment, no block); a repair turn's
  spend is the one thing that changes, rewritten in place via
  `state-persist.ts`. Steering notes ride the same seam as the handoff:
  `/retry <note>` / `/continue <note>` arguments reach the resumed
  implementation prompts enveloped under `MAINTAINER_NOTE_FRAMING`
  (`implement-prompts.ts`, pinned), framed as guidance with the plan/folder as
  truth and `/changes` as the re-plan channel — prompt-scoped, never persisted.
- **The review loop is `review-loop/`, not a local reimplementation.**
  `handleReview` in `src/phases/review.ts` drives that workspace through
  `review-runner.ts`, reached from `CODE_REVIEW` on an explicit `/review` and by
  no other route. It used to run inside `handleImplement`, between the
  implementation commit and the push, and **must not grow back there**: one
  arrangement made three problems. A review that broke discarded an
  implementation that had not, because the push sat on the far side of it; every
  task paid the loop's wall clock before anybody saw a diff; and `/retry` re-ran
  the model turn that had already succeeded, because the resume point was the
  whole phase. Two independently expensive operations, with two independent
  failure modes and two natural cadences, do not share a phase, a job, a retry
  budget and a resume point. `ensureBranch` at the top of the handler is not
  optional for the same reason the split is: this review usually runs in a job
  that implemented nothing, so the remote branch is the only copy of the work.
  `check-loop.ts` exists only for CI fixing, which the workspace does not cover.
  **What the loop produces is pushed by the branch, not by the commit.** The loop
  commits its fixes in its own worktree and merges them into this checkout itself,
  so `commitAll` — which reports only what _this process_ staged — answers `null`
  whether the loop found nothing or found twenty things, and reading that as
  "nothing to apply" left every finding it ever made unpushed on a branch in a
  checkout about to be deleted. `phases/review-push.ts` asks the **branch**
  instead (`git.headSha` either side of the loop) and pushes when it moved; a
  commit this process made needs no second opinion and is pushed on that alone.
  **Every push reconciles with the remote first, because the branch is shared
  with humans, not owned.** Run 32374999214 (PR #313): a maintainer pushed merge
  `1f7ce71b` to `agent/issue-305` three hours into a review loop, and every later
  pipeline push was rejected non-fast-forward — `ensureBranch` fetches once per
  phase and nothing until the push looked at the remote again, so five review
  fixes died with the runner and the run parked in `FAILED` inviting a `/retry`
  that re-runs the whole loop. `git-reconcile.ts` (split from `git.ts` along
  `git-revert.ts`'s seam) fetches the branch and merges `origin/<branch>` when
  HEAD does not contain it — **merge, never rebase, never force**: the branch is
  shared by design, and rewrites or force would discard the human line or
  history the loop's `primary` branch shares. A conflict aborts the merge and
  throws naming the conflicted paths; a fetch that finds no remote branch is a
  first push, not an error; base-branch pushes (`ARCHIVE`) do not reconcile. On
  the review path the reconcile runs **before `dropUnpushable`**, so a protected
  path that arrived via the human line is reverted before the push instead of
  riding the merge into a GitHub refusal of the whole push (the issue #240
  class); `push()`'s own internal reconcile is then an idempotent no-op.
  It also pushes **as each fix lands**, on the `[review-loop] published` marker
  the loop prints: `mergeEachFix` in the generated config makes the loop merge per
  fix instead of once at the end behind its build gate, and the push stays on this
  side of the pipe because the credential must never be visible to a subprocess
  whose children the model controls. Everything the loop prints is repeated into
  the **public** Actions log as it arrives and into the **encrypted** transcript
  unabridged — and `review-transcript.ts` folds the loop's own `trace.jsonl` in
  after the child exits, which is this phase's equivalent of the tool activity the
  implement phase feeds the transcript from. It is encrypted rather than uploaded
  as a file for the reason the transcript exists: an Actions artefact is
  downloadable by anyone with repository read access — a subprocess that runs for an hour in silence is indistinguishable
  from a hang, which is how run 31704544065 came to be cancelled at minute 60 with
  nothing to show for it. A failed loop is described by `describeFailure`, never by
  its exit code: a build gate, a runner deadline, a missing binary, an unresolvable
  plan path and a merge conflict are all `exit 1`, and each has a different remedy.
  The loop's own deadline is **`reviewBudget`, not `turnTimeoutMs`**, and that
  distinction is the difference between the phase getting its job and getting 90
  minutes of it: the turn cap bounds one uninterrupted model turn and is held small
  enough to still detect a turn that will never answer, while this phase is dozens
  of separately-bounded subprocesses across several rounds. Bounded by the turn cap,
  run 31803380299 was killed at exactly 90 minutes with one finding of six fixed and
  three hours of job left. So the loop gets what is left of the **job's** clock less
  the teardown reserve — `AGENT_JOB_TIMEOUT_MINUTES` is its only ceiling, and a
  second one of the review's own was tried and removed: any value small enough to
  feel safe under the job becomes the only bound a review ever reaches, which is
  this same defect wearing a different number. It gets it as **two** bounds: `softMs` is handed to the loop in its config as `runTimeoutMs`, and
  `hardMs` — a `AGENT_WRAP_UP_MS` slice later — is the kill behind it. The loop stops
  itself at the soft one between two issues, publishes, writes its summary and exits
  **75**, which `reviewOutcome` reads as `stopped`: not `failed`, because nothing
  broke and its fixes are on the branch, and not `passed`, because it did not finish.
  The generated config also carries `commitAuthor` — the same identity this
  pipeline's own commits use — without which every commit the loop makes fails on a
  runner with _Author identity unknown_.
  In that loop the first round runs every check — one repair prompt seeing every
  failure fixes more than a fail-fast round would — and later rounds re-run only
  what failed. Only a **full** pass may return `passed`: a narrowed round has not
  looked at the checks it skipped since before a repair edited the tree.
- **The pull-request door resolves before it acts, and its lookup is not
  swallowed.** A restore starts from the **issue** — that is where the blocks
  written before a pull request existed live, and `readThread` needs one of them
  to learn which second thread to read — so a comment typed on a pull request
  names nothing this pipeline can restore: `github.event.issue.number` there is
  the _pull request_.
  `resolvePullRequestTrigger` in `pr-trigger.ts` recovers the issue from the head
  branch, `agent/issue-<n>`, the same link a red CI run travels; that costs an API
  call, which is why it is a second step and not a branch of the pure
  `parseTriggerEvent`. Its **order is the design**: the slash-command test is free
  and comes first, so every ordinary code-review comment on every pull request in
  the repository is dropped with no lookup at all — the head lookup that follows is
  not free, so nothing may be moved in front of it and nothing that reads its
  answer may be moved behind. The fork check is the one to get right. `head.ref`
  is attacker-controlled, so a pull request opened from a fork whose branch is
  named `agent/issue-42` looks like the agent's own to every other field here;
  without `PR_FOREIGN_REPOSITORY`, anyone who can open a pull request could type
  `/review` and buy a privileged job that prompts the model, spends issue 42's
  token budget and pushes commits to a real agent branch — the same attack
  `CI_FOREIGN_REPOSITORY` answers through the other door. The lookup itself is
  deliberately **not** caught, unlike every other GitHub call this pipeline
  degrades to a `warn`: it is the only thing that says which issue the run is
  about, and the fork guard reads its answer, so a rejection has to reach `runCli`
  and leave the job red rather than become a skip indistinguishable from a comment
  nobody typed. `TriggerEvent` gains a third member rather than a flag on the
  issue one, because `resolveIssue` reads the issue's title and body straight off
  that shape and this payload carries the _pull request's_ — a flag hands every
  phase the wrong document under the right field names. Every `kind` test is an
  exhaustive `switch` for the same reason, with `unreachable` making a fourth kind
  a compile error rather than a silent bucketing. The report and the state block
  and the state block go wherever `feedbackTarget` says, which after delivery is
  the pull request — safe now that `readThread` reads both threads, and _not_
  safe before it, which is why this used to say the opposite.
- **Once a pull request exists, it is the surface — record included.**
  `feedback-target.ts` says where, and `feedbackTarget` is now the answer for
  **every** write: the labels, and the run's one comment, block and all —
  resolved once, by the buffer, from the state the run _entered_ on. `commandSurface` is the other half —
  a command typed on the issue is refused with a reply naming where to type it,
  not "does not apply", which would be false twice over since the command applies
  perfectly and would have worked one page over.
  The record used to be the exception, and the reason was mechanical rather than
  editorial: `findLatestState` scans one list, so a block on the pull request was
  a second source of truth that scan could never see. **So the scan moved with
  the comments.** `readThread` in `orchestrator.ts` reads the issue, and if its
  newest block names a `prNumber`, reads that thread too and takes the newest
  block across both. Four things not to undo.
  The **issue is read first, always**: `prNumber` is itself a field of a state
  block, so the only way to learn which second thread to read is to restore from
  the one that needs no lookup.
  `postAndAppend` addresses `feedbackTarget(**input.state**)` — the state the
  phase started from, not the one it produced. Addressing it with the new state
  posts the very block that first records `prNumber` to the pull request it
  names, leaving the issue with nothing that has ever heard of it and the scan
  with no way in; the one-comment lag puts the handover on the issue, which is
  where a reader wants it anyway.
  The merge is **issue then pull request by construction**, not by timestamp:
  every block on the pull request was written after the last one on the issue,
  because the write moves there the moment `prNumber` is set and never moves
  back. It also fails safe — a block hand-edited onto the issue after delivery
  loses to the machine's own newer one.
  And there is **no `STATE_VERSION` bump and no migration**: an issue with no
  pull request behaves exactly as it did, so nothing in flight is stranded.
  Rollback is one-way in the narrow sense `INCOMPLETE`'s was — older code reads
  the issue only and would miss blocks written to the pull request meanwhile.
  **An answer is still not a record**: `/ask` moves no phase, spends no attempt
  and writes no artefact, so `postAnswer` posts a plain comment carrying no block
  and writes the spend through `state-persist.ts`, which rewrites the newest
  block in place and posts nothing. Its branch stays on the **trigger** rather
  than on `feedbackTarget` — the two now agree, since `commandSurface` refuses
  issue commands once a pull request exists, but the trigger says what the
  function is for (reply where the question was asked) instead of deriving it
  from a rule two modules away that would have to keep agreeing.
  `pull-request-note.ts` is **gone**, and its absence is the change in one line:
  it existed only to tell a pull-request reader which issue the report had been
  posted to, and the report is now on the pull request.
  Every comment still gains one line from `postAndAppend` naming where commands
  go — said on the write they share rather than threaded through eight renderers,
  where any one of them could forget. Three older consequences still hold. The
  label reconcile **clears the issue** when it writes the pull request, because a
  copy left behind would freeze at whatever the state was that day and no later
  reconcile would ever look at it again. `applyPullRequestCommand` does not narrow
  to `/review`: with the issue refusing commands, a narrowing there would leave
  `/retry`, `/cancel` and `/ask` nowhere at all to be typed, and which commands a
  state accepts is `applyCommand`'s one answer for both doors. And the workflow's
  pull-request arm names **every** command in `SLASH_COMMANDS` (checked against it
  by `workflow.test.ts`) while the label cleanup step reaches both the issue and
  the pull request, since which of the two carries a stranded `agent:working`
  depends on how far the killed run got.
- **One model endpoint.** Everything goes through `openai-config.ts`; there are
  no provider-specific keys and no second place a model is named. OpenCode is
  never handed the real key: `provider-proxy.ts` holds it and `contain()` in
  `index.ts` configures everything downstream with the placeholder, because the
  SDK puts the config into the spawned server's environment where `bash` can
  read it. Never pass `config.openai` to an OpenCode path — pass the contained
  settings. `AGENT_MCP_SERVERS` rides the same seam (`mcpServers` on
  `OpenAiSettings`, carried through `proxiedSettings` by its spread), so the
  in-process session and `OPENCODE_CONFIG_CONTENT` carry one server set — and
  the knob's `headers`/`environment` values join `pipelineSecrets`, though the
  config content itself stays model-readable (documented residual risk).
  That proxy is also where **transient failures are retried**, because
  it is the one layer that sees a real HTTP status and the only one the review
  loop's subprocesses also pass through; do not add a second retry in the
  adapter, where the status is already gone.
- **The provider id is a catalogue key, and the transport is not.**
  `LLM_PROVIDER` (default `openai`) says which models.dev row OpenCode resolves
  `LLM_MODEL` under; `npm` stays `@ai-sdk/openai-compatible` and wins over the
  borrowed row's own package in OpenCode's resolution order
  (`model.provider?.npm ?? provider.npm ?? existingModel?.api.npm`), so naming
  `anthropic` against a gateway borrows metadata without loading another SDK.
  It is not cosmetic: a row OpenCode does not find leaves `limit.context` at
  `0`, and `isOverflow` returns `false` unconditionally at zero — **auto-
  compaction is off**, with no other symptom — and `reasoning` at `false`, which
  makes `variants()` return `{}` so no reasoning effort is selectable at all.
  The id may not contain a slash: `parseModelRef` splits at the **first** one
  and keeps the whole remainder as the model id, which is what lets a model id
  contain slashes. `createOpenCodeAgent` logs the resolved reference at `debug`,
  names only — a CI log is world-readable on a public repository.
- **A model no catalogue carries is described rather than guessed at, and the
  description is omitted rather than zeroed.** `model-metadata.ts` resolves what
  a run knows about its model on a four-rung ladder — `AGENT_MODEL_*` overrides,
  then the models.dev row, then **nothing emitted**, then OpenCode's own zero
  defaults — and the third rung is the one to preserve: writing
  `limit: { context: 0 }` explicitly _pins_ the value that switches
  auto-compaction off, where an absent key leaves OpenCode's own catalogue merge
  free to answer. `limit` is emitted on the strength of `context` alone, with an
  unknown `output` written as `0`, because OpenCode reads a zero output exactly
  as absent (`?? existingModel?.limit?.output ?? 0`) and `maxOutputTokens` falls
  back to its own ceiling — a zero _context_ is nothing like that.
  The reader is **`sdd-runner/src/pricing.ts`**, imported across the workspace
  boundary one function wide and one direction only: it is already a models.dev
  client with a disk cache, a bounded fetch and two recorded incident fixes, and
  the minimality ladder forbids a second copy of all that. Revisit the boundary
  at a third consumer (papai's own `src/model-context.ts` is the candidate), not
  before. The lookup runs **after the guardrail door** — a payload the pipeline
  is about to drop must not pay for a network read — and `catalogueEntry` is the
  one function permitted to swallow, per the feedback-channel rule above.
  `buildOpencodeConfig` stays **synchronous** and takes the resolved facts as a
  field on the settings it already has: it is the single definition serving both
  the in-process session and the `OPENCODE_CONFIG_CONTENT` the review loop's
  subprocesses read, and an async builder would fork that. `MainOptions.modelCatalogue`
  is the seam that keeps the suites off the network; without it every `runCli`
  test reaches models.dev and times out.
- **A profile differs by cost as well as by permission, and the effort is set on
  the profile rather than on the call.** `LLM_MODEL_LIGHT` reaches `plan` — the
  read-only phases — and `small_model`, and deliberately **not** `propose` or
  `build`: a weak spec is the input to every later phase, and the gates that would
  catch one cost wall clock rather than tokens. `AGENT_EFFORT_PLAN` /
  `AGENT_EFFORT_BUILD` become `agent.<name>.variant`, and config-level is forced
  rather than preferred — the pinned SDK's prompt body has **no** `variant` field,
  and the review loop's `opencode run` workers carry no `--agent` and so resolve
  to `build`, which a per-call setting could never reach. Note the two pins are
  different versions: `@opencode-ai/sdk@1.18.12` types the config, `opencode-ai@1.18.7`
  reads it, and it is the **server's** version that decides which agent keys are
  honoured — its loader merges `model`, `variant`, `options`, `temperature`,
  `top_p` and `steps`, which the SDK's generated `AgentConfig` under-declares and
  admits only through its index signature. Effort values are **passed through, not
  enumerated**: `transform.ts` computes the valid tiers per model from its id and
  release date, so a list copied here would refuse tiers that work and be wrong on
  the next model — the loader checks the shape, OpenCode refuses the rest. And
  `setCacheKey: true` is unconditional: `ProviderTransform` emits a
  `promptCacheKey` for `@ai-sdk/openai-compatible` only when it is set, and a
  provider that ignores the field is unaffected, so a knob for it would be
  ceremony.
- **The retry budget is refused, never applied-then-regretted.** A `/retry` past
  `maxAttempts` is turned down in `src/triggers.ts` before the signal reaches
  `transition`, so the issue keeps `FAILED` and its `resumeFrom` and raising
  `AGENT_MAX_ATTEMPTS` still resumes it. It used to be checked in `driveMachine`,
  after `applyTrigger` had applied `RETRY` — which clears `resumeFrom` — so
  spending the budget parked the issue in a handler phase that `/retry` (needs
  `FAILED`) and a plain comment (needs a waiting phase) both refuse, reachable
  only by `/cancel`, under a notice inviting the `/retry` that had just become
  impossible. There is deliberately **one** such check and no backstop in the
  cascade: forward moves reset `attempts`, so `RETRY` is the only way a spent
  count reaches a handler. The invariant to preserve: no path may leave the
  persisted state in a phase that has a handler but that no trigger can
  re-enter. `refuseReviews`, beside it in the same file, is that invariant on the
  other ceiling: a `/review` past `maxReviewAttempts` is refused before the
  signal is applied, because applied and then regretted it would park the issue
  in `CODE_REVIEW`, a handler phase no trigger re-enters, under a notice
  inviting the command that had just become impossible. It is a separate
  function rather than a branch inside `refuseExhausted` because the remedy
  differs: nothing is parked, so `/retry` cannot help, and the notice has to name
  `AGENT_MAX_REVIEW_ATTEMPTS`.
- **An over-budget stop parks in `FAILED`; it does not stay put.** The token
  check sits inside the cascade, before each handler, and cannot move to the
  trigger layer the way the retry gate did: half its firings are mid-cascade
  (`REVIEW_AND_MUTATE` → `PR_DELIVERY` → `COMPLETE` in one job), where the phase
  has rightly advanced and there is no signal to refuse. So the **stop** carries
  the invariant instead — `transition(FAILED)` with `resumeFrom` naming the
  phase it refused to start, which is the recovery path that already exists and
  is what makes "raise `AGENT_MAX_TOKENS`, reply `/retry`" true. Leaving the
  phase alone stranded the issue in a handler phase, reachable only by
  `/cancel`, on a first `/approve` with no failure involved. `attempts` is
  **carried, not incremented**: running out of tokens is not a failed attempt,
  and spending one would let the retry gate refuse the very `/retry` the token
  notice asks for, citing a ceiling it never mentioned. The **answer** path is
  the deliberate exception and moves nothing, for the reasons `failAnswer` moves
  nothing — plus `COMPLETE` accepts no `FAILED`, so parking a question there
  would throw out of the pipeline.
- **A wall-clock stop parks in `INCOMPLETE` and is left by `/continue`, not
  `/retry`.** `time-budget.ts` mirrors `token-budget.ts` deliberately, and the
  three places it differs are each a decision. The bound may be **absent** — a job
  deadline is derived from two facts only an Actions runner knows
  (`AGENT_JOB_STARTED_MS` + `AGENT_JOB_TIMEOUT_MINUTES`, the latter the same
  expression the workflow's own `timeout-minutes:` reads, so there is one value and
  not a pair kept in step by hand), so every `--event-path` run has none and must
  behave exactly as it did before. The park is its **own phase**, not a second kind
  of park in `FAILED`: telling them apart there would need a field every reader of
  `FAILED` consulted, because `/retry` means "the thing that broke, again" where
  `/continue` means "you were not finished". And the run reports **`waiting`**, not
  `failed` — a token stop starts no work, this one finished some and stopped to
  hand it over, so the job exits 0 and the Actions page does not go red for a run
  that behaved correctly. `attempts` is carried and `lastError` stays `null`, for
  the reasons the token stop carries `attempts`. `OUT_OF_TIME` is accepted in
  exactly the phases that have a handler and a test asserts that set against
  `hasHandler` — the stop fires before _any_ handler, so a narrower list throws
  `InvalidTransitionError` out of the pipeline from the phases it left out.
  `turnTimeoutMs` clamps to **1 ms, never 0**: `withDeadline` treats a
  non-positive budget as "no bound", so the obvious `Math.min` removes the bound
  exactly when the job has least time left. `INCOMPLETE` is deliberately **not** in
  `WAITING_PHASES` — that set's one reader decides whether a plain comment buys a
  classifier turn, and a park is moved on by a command, not by prose.
- **`abort` is the stop; `close()` is the leak.** Measured against a live
  `opencode-ai@1.18.7`: `POST /session/:id/abort` kills the running tool child and
  leaves the server up, while `close()` — which on POSIX is one `proc.kill()` on
  one pid, no group, no escalation — kills the server and **orphans** the tool
  child, reparented to init. A tool command is a session leader in its own process
  group, so no group kill aimed at the server reaches it. So `turn-stop.ts` never
  treats `close()` as the fallback for an abort that did not take, and `abort()` is
  the one boundary here that is best-effort **and reports**: a failed abort must not
  become the run's failure, but the caller's next decision depends on the answer.
  Both cases are in `live-sdk.integration.ts`, driven through `/session/:id/shell`
  — the same `bash -l -c` child the bash tool spawns, needing no model — because a
  pin bump can change either. `abort` is also synchronous with respect to its
  writer (29 ms to return, and a file being appended to did not grow by a byte in
  the five seconds after), which is what collapses the staging fence from a polling
  wait into a cheap assertion.
- **A turn stopped part-way through is salvaged, and salvage never becomes a
  second failure.** `turn-stop.ts` runs three steps in a fixed order and each one is
  a decision. The **soft** stop aborts and asks for a handoff, bounded by
  `AGENT_WRAP_UP_MS`, and asks only if the abort was accepted — the premise of a
  second prompt is an idle session. The **hard** stop aborts again unconditionally,
  depending on nothing the model chose to do. Only then the salvage, fenced on
  _some_ abort having been accepted: the size caps merely report on this path, so a
  tree still being written to would be committed rather than refused, and that is
  the one thing this path must not do. **Read the token usage before anything closes
  the server** — nothing in `turn-stop.ts` closes anything, and it must stay that
  way: `tokensUsed()` degrades to `0` with a `warn`, `recordSpend` runs _after_ the
  handler returns, and `INCOMPLETE` is exactly the state a `/continue` comes back
  out of, so a total missing this job's turn is the total the next job hands to the
  token ceiling. Everything in `salvage.ts` degrades to "nothing pushed, and here is
  why" and nothing in it throws — a clean tree included, which is a legitimate
  outcome rather than an error. The `--no-verify` is **mandatory, not an
  optimisation**: `package.json`'s `prepare` installs `scripts/pre-commit.sh` as
  `.git/hooks/pre-commit` on any install where `.git` exists, the Actions runner
  included, and that hook runs lint, typecheck, format and the licence scan over the
  staged files — all four of which a mid-edit tree fails, verified by staging one and
  running the installed hook. Without the flag the salvage cannot commit at all.
  `salvageAll` is a separate `Git` operation rather than a flag on `commitAll`
  because its **return type** is the point: clean, refused and committed-but-large
  are three ordinary outcomes here that each earn a different sentence on the issue,
  where `commitAll` has only `StagedTotals | null` and a throw.
- **A refused commit is repaired, never a failure on its own.** `commit-repair.ts`
  wraps every `commitAll` this pipeline makes on the implement and CI-fix paths:
  the repository's own `.git/hooks/pre-commit` gets to reject a tree, the model is
  handed exactly what it printed, and the commit is issued again — bounded by
  `AGENT_COMMIT_REPAIR_MAX_ROUNDS`. Without it `git commit` was the last place a
  lint error could surface and the one place the pipeline had no answer for it, so
  an implementation that had worked lost its phase to an unformatted file and cost a
  `/retry`, which buys a fresh job that re-runs the model turn that had already
  succeeded. Four things not to undo. Only a **`GitError`** is repaired — the diff
  guard's refusals are `PipelineError`s raised before the commit is issued, and no
  number of rounds may talk this into committing a staged credential. The last
  rejection is what is finally **rethrown**, so a run that spends its rounds fails
  exactly as it failed before the module existed and the change can only turn a
  failure into a success. The repair prompt forbids the model to run git at all,
  because "the commit was refused" reads to a model holding `bash` as an invitation
  to commit with `--no-verify`, which is the salvage path's alone and would push a
  tree neither the hook nor the guard accepted. And a repair turn is a **model
  turn**, so `implement-commit.ts` catches `isTurnDeadline` around the whole loop and
  leaves by the same door a stopped step leaves by — anything else would fail a run
  whose tree was worth salvaging. `phases/review.ts` deliberately does not repair:
  its findings come from `opencode run` subprocesses and it opens no session, so
  repairing there would boot the OpenCode server for a phase built to avoid it.
- **The unit of work is a plan step, and between two of them is where a run wants to
  stop.** `handleImplement` reads the plan's steps and `phases/implement-steps.ts`
  walks them: one turn, `commitAll`, `push`, next. Pushing **per step** is the same
  argument that put the push in this phase rather than the next one — an Actions
  working tree dies with the job, so work is durable the moment it is pushed and not
  before — and it is what makes the wall clock cheap: at a step boundary the tree is
  clean, the branch carries every finished step and `stepsDone` records the cursor, so
  the clock is checked in front of every step (`timeForAnotherStep`, whose threshold is
  exactly where `turnTimeoutMs` would have to clamp to 1 ms) and a step that cannot fit
  is **not started**. That park is `OUT_OF_TIME` with a notice of its own, the only one
  of the three that may say both "work was done" and "nothing was lost". Four things
  not to undo. The gate is asked **only of a declared step**: a plan with no steps is
  one indivisible turn, where refusing to start costs everything the turn would have
  written and being interrupted salvages what it did. A step's turn gets the **whole**
  remaining clock rather than a share, since a share needs an estimate of a step's cost
  that nothing here has. `mintEnvelope` and `composeSystemPrompt` are called **once per
  handler** and reused by every step and by the wrap-up, for the reason stage 2 already
  reused them. And the per-turn bound handed to the adapter is a **function**, not a
  number: it is derived from the job's remaining clock and one job now takes many
  turns, so a number read when the session booted would hand the last step a bound
  sized against a clock half an hour stale, which is the silent runner death the bound
  exists to prevent. `stepsDone` is additive with a default and needed no
  `STATE_VERSION` bump (rollback is one-way in the same narrow sense `INCOMPLETE`'s
  was); it is reset by `handlePlan` and by a finished implementation, and a cursor past
  the end of the plan walks from the top rather than reporting a plan nobody
  implemented.
- **The handoff is an artefact, and it is retired by a new plan.** The wrap-up's
  reply travels in an `AGENT_HANDOFF` block via `artifacts.ts` — never scraped out
  of the notice's prose — and `buildImplementPrompt` includes it enveloped, framed
  as a report to verify rather than as instructions. `findHandoff` owns the
  lifecycle: superseded for free by the next stop (blocks append in order, the read
  walks newest-first), and **retired by a plan revision it does not match**, since
  "done", "remaining" and "tried and rejected" are all claims about the plan the
  interrupted turn was implementing. A `/retry` after a failed implementation of the
  _same_ plan deliberately keeps it — the branch still carries the work it describes.
  Note that the revision guard is not reachable end to end today: a part-way stop
  only happens in `REVIEW_AND_MUTATE` and `INCOMPLETE` accepts only `/continue`, so
  there is no route from a written handoff back to `PLANNING`. It still covers a
  hand-edited block, and it is the invariant that keeps the note honest the day such
  a route exists.
- **A red run is acted on where the branch is live and no job is on it.**
  `CI_FAILED` names two rows in `TRANSITIONS`, `COMPLETE` and `PR_DELIVERY`, and
  the absences are the design. `PR_DELIVERY` is the genuine race: phase 3 pushes
  the branch and posts a block naming that phase before phase 4 opens the pull
  request, so a job that died in between left a live branch whose red checks were
  refused as an invalid transition and dropped — nothing posted, no `ciAttempts`
  spent, no trace but a `reason` string nobody reads. The four phases before the
  branch exists stay out because `handleCiFix` would run the checks against a
  branch cut from the base; `REVIEW_AND_MUTATE`, `CODE_REVIEW` and `CI_FIX` stay
  out because the machine never persists them (a block is written only when a
  handler posts, and all three post the phase they moved _to_ — which is also why
  a check that goes red during a review is read against the `COMPLETE` block the
  issue is still carrying), and honouring a hand-edited one would put a second
  job on a branch another is mid-commit on — the concurrency group queues those
  two, and since the pull-request door it does so by construction rather than by
  coincidence: the group is the `agent` job's own, keyed on
  `needs.resolve.outputs.branch`, and `resolve` derives that branch from the issue
  number it parsed, whichever of the three kinds the event was. Two spellings
  happening to agree was the old proof and it was never one; one number is. What
  that buys is ordering and not safety — the second job is queued rather than
  concurrent, which is exactly why the hand-edited block still must not be
  honoured. **`FAILED`
  stays out deliberately**, the close call: the branch is pushed there, but
  `CI_FAILED` is a forward move, so it would reset `attempts` and leave the one
  phase `/retry` accepts, and a fix that went green would park the issue in
  `COMPLETE` announcing success for a delivery that never finished. Those red
  checks are deferred behind the `/retry` the failure comment already asked for,
  not abandoned. A refused red run **logs at `warn` with the phase** and posts
  nothing, for the reason `settledPullRequest` sets out: CI fires on every push,
  so a comment per red run is spam.
- **A refusal a `/retry` cannot change is translated, not repeated.** `Actions is
not permitted to create or approve pull requests` is a repository or
  organisation setting, and the bare API message posted as-is reads like a bug in
  the agent: it names a setting without saying where it lives, hides the fact
  that the branch is pushed and only the API call is left, and leaves `/retry` as
  the only visible move — which fails again, until the retry budget is spent on a
  condition no retry could ever change. `pullRequestForbiddenError` names the
  repository toggle, the organisation policy that overrides it, the
  `AGENT_GITHUB_TOKEN` secret the workflow already prefers, and a prefilled
  `compare` URL that needs no permissions at all. Matched on GitHub's sentence
  rather than the status, and **only** that one: the same 403 covers a token
  merely missing `pull-requests: write`, whose remedy is different, so widening
  it sends that maintainer to tick a box that was never the problem. The compare
  URL is built from `gitRemoteBase`, not github.com — an Enterprise Server
  install answers on its own host, and a link into the wrong one is worse than
  no link.
- **A round budget belongs to a pull request, not to an issue.**
  `handleDeliver` clears `ciAttempts`, `ciBudgetReported` and `reviewAttempts`
  through `FRESH_PR_BUDGETS` on its `existing === null` branch — a genuinely new
  pull request — and leaves all three alone when it refreshes the open one. The
  constant is named for the **class** rather than for CI, which is what keeps the
  next per-pull-request counter from being added to the state and forgotten here;
  `reviewAttempts` joined it exactly that way, being the same fact about the same
  thing — a review round is spent on the diff one pull request carries. The CI
  pair used to reset nowhere at all, and `applyCiTrigger` short-circuits on
  `ciBudgetReported` before it even looks the pull request up, so an issue that
  burned its rounds on one pull request and then delivered a second got no fix
  round on the new one and no comment explaining the silence. Do not extend the
  reset to the refresh path: same branch, same commits, same checks that
  spent the rounds, and a clean slate there is one broken branch bouncing off the
  agent for as long as anyone keeps replying `/retry`.
- **A feedback channel has exactly one door, and that door swallows
  everything.** `react` in `feedback.ts` — with `unreact`, its mirror, which is
  the same door read the other way and takes the same catch —
  `reconcileLabels` in `labels.ts`, `attempt` in `reply-buffer.ts`,
  `persistState` in `state-persist.ts`, `refreshPullRequest` in
  `phases/review.ts` and `dropUnpushable` in `phases/review-push.ts` are the only
  functions in their modules that call GitHub or git, and each catches every
  rejection and degrades it to a
  `warn`; a caller reaches the same `RunResult` and the same **persisted state**
  it would have reached with the channel absent. `dropUnpushable` is the newest,
  and the one where "best-effort" is a judgement about which failure is worse
  rather than about decoration: if the revert breaks, the push that follows is
  the one GitHub was always going to refuse — exactly the outcome that existed
  before the guard — where throwing would turn a review that found real problems
  into a failed run. It still must not be silent, so what it reverted rides out
  into the phase's report. (`noteReview` in `pull-request-note.ts` used to head
  this list and is gone: it pointed a pull-request reader at the issue the report
  had gone to, and the report is now on the pull request.)
  `refreshPullRequest` is the one that shows what the rule is about,
  because the very same `updatePullRequest` is not decoration everywhere:
  in `handleDeliver` it **is** the work, so a rejection there is correctly fatal
  and correctly resumed from `PR_DELIVERY`. In the review phase the loop has run
  and its findings are already commits on a pushed branch, and the call only
  re-renders a body around them — so letting it throw parked the issue in
  `FAILED` with `resumeFrom: CODE_REVIEW`, and the `/retry` that failure comment
  invites re-ran the _entire_ review loop, every `opencode run` subprocess of it
  and another round off `AGENT_MAX_REVIEW_ATTEMPTS`, to repair a decoration.
  Best-effort is a property of what a call is **for**, not of which endpoint it
  hits. One door rather than a `try` per call site because best-effort has to be
  a property of a function, not a convention: every write these
  channels make is decoration on work that matters and a fresh way to break a
  pipeline that used to work — a token without `issues: write`, a fork run, an
  organisation restricting who may create a label, a secondary rate limit — and a
  convention honoured at six call sites is honoured at five the day somebody
  adds a seventh. Adapters do **not** anticipate the rule: `github-labels.ts`
  rejects a 403 like any other transport, and only swallows the 422 that means
  "this label already exists", because that is idempotence at the layer where an
  HTTP status still exists. The accepted cost is stated at the catch in
  `labels.ts` and is not an oversight: a `TypeError` from inside the reconcile
  degrades to exactly the same `warn` as a 403, so a bug in a channel is
  invisible to anyone not reading the log. It has been paid once already — a
  stubbed transport answered the label read with the wrong shape,
  `name.startsWith` threw into that catch, and the suite stayed green having
  reconciled nothing. Sorting an `unknown` at the catch into "mine" and "theirs"
  is how that gets fragile, so do not add the discrimination; add a test that
  asserts the write. The workflow's `if: always()` label cleanup obeys the same
  rule in YAML, with `|| echo`: a job whose only red step is the one taking a
  label off has reported a failure that did not happen.
- **A run says whether it reported, and the workflow reads that.** `RunResult`
  carries `reported`, and `step-output.ts` turns it into a `reported=true` line
  in `$GITHUB_OUTPUT`; the workflow's fallback "Agent job did not finish" comment
  is gated on `steps.pipeline.outputs.reported != 'true'`. It used to be gated on
  `if: failure()` alone, which selects **every** red job — and six paths exit 1
  only after posting their own report (`failRun`, `failAnswer`, both over-budget
  stops, `refuseExhausted`, the CI-budget notice), so every genuine failure drew
  a second comment claiming "the issue state is unchanged" beside a block that
  had just moved to `FAILED`. Only CI runs escaped, by accident:
  `github.event.issue.number` is empty on a `workflow_run` event — which is why
  the workflow now resolves the number from `workflow_run.head_branch` too, and
  why that widening had to sit _inside_ the `reported` gate. Set `reported` on
  any new terminal path from what that path **posted**, never from its status
  — `failed` covers both a reported failure and a crash, and `skipped` covers
  both a silent guardrail drop and a refused command that answered on the issue.
  A throw is deliberately unmarked: that is the crash the fallback comment is
  for. Writing the marker is best-effort and must never throw — `GITHUB_OUTPUT`
  is absent on every `--event-path` run.
- **`reported` is decided by the one write a run makes, and by nothing else.**
  A run posts one comment, when it settles, so "the issue carries an account of
  this run" is a fact about that single `createComment` and about nothing a
  phase can know. `flushAround` in `orchestrator.ts` sets the flag from what
  GitHub **accepted** and overwrites whatever the terminal path claimed; the
  guardrail exit in `runPipeline` keeps its own answer only because it returns
  before the buffer is ever begun. Leave the per-path values as they are — they
  document what each path intends to have said, and are what a second write
  would be decided from.
  This is where the swallow narrows. `attempt` in `reply-buffer.ts` still turns
  every GitHub failure into a `warn`, but a refused post must leave the flag
  **false**: a report GitHub turned down is a report the issue does not carry,
  and claiming otherwise suppresses the fallback comment that is the only thing
  that would explain the silence. Reactions and labels are the same argument one
  step shorter — an emoji is not an account of anything, and neither is a label.
- **One command, one reply, and the workflow keeps it that way.** Issue #281
  drew three bot comments per maintainer command: the live status comment
  finalised, the phase report, and the transcript notice. The first two are now
  one comment posted at the end (`reply-buffer.ts`), and the workflow's
  transcript step **edits** it rather than posting — reading
  `steps.pipeline.outputs.reply-comment`, which `step-output.ts` writes beside
  `reported=true`. The infrastructure-failure step publishes its own comment id
  for the same reason: when the pipeline died before flushing, its notice _is_
  the run's one comment, so the transcript step must be ordered after it and
  append to that. A step that posts a second comment undoes the whole change.
  The cost of buffering, and the one thing the old shape did better: a process
  that never runs its `finally` — an OOM kill, a cancelled job, a runner past
  `timeout-minutes` — loses every section it had collected. The flush sits in a
  `finally` so a throw still posts, and `teardownReserveMs` still holds back
  wall-clock time for that write; SIGKILL is what the fallback comment covers,
  as it always did.
- **The token budget is per issue and persisted.** `tokensSpent` lives in the
  state block; the orchestrator checks it before each phase. Budget on
  **tokens**, never on `cost`: token counts come
  from the provider's usage block, while cost is derived from OpenCode's model
  catalogue and is `0` for any model it does not price. Read the total from
  `session.get`, not by summing events — the check happens immediately after a
  prompt returns, and an event-derived total is whatever has arrived by then.
- **Every state block a job writes records the running total**, through
  `recordSpend` in `token-budget.ts` — a phase that succeeded, one that threw,
  and one the budget refused to start, all three. Written separately they drifted
  apart at once: `runHandler` patched `tokensSpent` while `failRun` and
  `failAnswer` did not, so a job that spent 250,000 tokens and then threw
  persisted `0`. That is the worst possible place to be blind, because retries
  **are** the failure path — the runaway this bounds is an issue bouncing through
  `/retry` and CI-fix rounds, so an issue could burn the ceiling and hand the
  next runner a clean slate, round after round. The figure is always
  `carriedTokens` (the restored block, captured once) plus the job's session
  total, never a per-phase sum: one job's session is already cumulative across
  the phases it cascades through.
- **Do not pay to classify a comment the budget cannot act on.** `applyIntent`
  asks `withinBudget` before `classifyComment` and routes an over-budget comment
  to the answer path, where the cascade's one stop reports it. The classifier is
  the single model turn that posts nothing — its `none` branch deliberately
  stays quiet, and this pipeline persists state by posting — so the ceiling has
  to stop the turn rather than count it. A run **under** budget that classifies
  `none` used to leak that turn outright and no longer does: `readAndSkip`
  records it through `state-persist.ts`, which rewrites the newest state block in
  place instead of appending a comment. That write is best-effort like every
  other one this pipeline added, so a refused rewrite reports the figure the
  issue actually carries rather than the one the run hoped to write.
- **`INIT_OR_CLARIFY` classifies with the default inverted.** `applyClarifyIntent`
  skips a comment only when the classifier positively reports `none`; every other
  reading re-runs triage, which is what the phase used to do for every comment —
  a "thanks", a 👍 or a bystander's aside each bought a full triage turn. It
  cannot reuse `applyIntent`: that bias exists to protect an approved artefact and
  there is none here, so a misread answer is not one cheap extra reply but a
  stalled conversation, the agent answering its own clarifying questions back at
  the maintainer while the issue stays parked. `question` is deliberately **not**
  admitted as a skip-to-answer for the same reason — in this phase it is the
  bucket every failure and ambiguity lands in, not a verdict, so honouring it
  would stall exactly the comments least able to survive it. A blank body (the
  `issues.opened` event that starts every issue) and an over-budget issue both
  skip the classifier and fall through to triage, where the cascade's own stop
  reports the ceiling — the rule above, one model turn cheaper. This is the one
  phase `buildClassifyPrompt` briefs on what the phase means, because `none` is
  now load-bearing and a real answer is often a bare fragment that reads as
  chatter to a phase-blind classifier.
- **A turn that broke says _which_ remote broke.** `runTurn` probes
  `connection.alive()` on the failure path and raises `serverGoneError` when the
  local `opencode serve` has stopped answering, instead of passing on the
  transport's `The socket connection was closed unexpectedly` — a sentence that
  names neither end of the socket and sends every reader to the model provider.
  Three orderings there are load-bearing: a turn deadline leaves **before** the
  probe (a ceiling relabelled as a crash throws away finished steps), a probe that
  **rejects** reads as `false` rather than replacing the failure it was asked
  about, and a failure over a server that still answers is passed through
  untouched. It is a classification and must never become a **retry**: the one
  layer that may retry is `provider-proxy.ts`, the only one that still has an HTTP
  status. The workflow's post-mortem step is the other half — it reports the OOM
  killer, the cgroup memory peak and a process census by `comm`, because _why_ the
  server died is not visible from inside the process that lost it.
- **Bounds go on the finished prompt, and on waiting.** `prompt-budget.ts` caps
  what reaches the model — per prompt, not per input, since a per-input cap
  bounds one log and nothing else. `deadline.ts` bounds waiting for a model turn;
  it cannot cancel the request and does not claim to, which is why the _phase_ now
  aborts on the way out rather than treating the abandoned turn as finished. What
  both buy is a failure the pipeline can report, instead of a runner killed by
  `timeout-minutes`, which posts nothing at all. That failure is
  `turnDeadlineError`, distinguishable by **code** so `handleImplement` can tell a
  ceiling from a crash — every other rejection out of a prompt still means the work
  broke — and carrying the `ProgressSnapshot`, because only the adapter can see it.
- **Ask for JSON through `promptForJson`, not `agent.prompt` + `parseModelJson`.**
  It re-asks once with the validation complaint attached. Once, not until it
  works.
- **Progress reporting never carries content.** `activity.ts` decodes OpenCode's
  event stream through schemas that name only the scalar fields they want, so
  tool input, tool output, model text and a provider's error message have
  nowhere to land. `session.error` is the event that most tempts a widening and
  is decoded on exactly those terms — the error's **name and status code**, never
  its `message`, which is where a rejected credential gets quoted back. Do not
  widen a schema to "make the log more useful": a CI log is world-readable on a
  public repository and is _not_ covered by the outbound redaction in
  `github.ts`. Names, statuses and counts only. Every shape there is
  recorded from a live server — re-record rather than adjusting by inspection,
  and note that the SDK's generated `Event` union is already behind its own
  server, which is why each decode is a `safeParse` yielding `null`.
  The **one widening that is legal** lives transcript-side:
  `describeProviderDetail` in `activity-detail.ts` decodes the provider's own
  message off `session.status` retry and `session.error` events — shapes from
  the pinned SDK, `status.message` and `error.data.message` — and
  `progress.ts` feeds it to the encrypted transcript one row per occurrence,
  in front of the collapse gate for `foldStall`'s reason. The public log
  carries nothing of it; a provider's failure text is the designated content of
  the designated place, redacted by value before it is encrypted.
- **The agent cannot commit its own workflow, and that is enforced at staging.**
  GitHub refuses a push from a GitHub App or an Actions token that creates or
  updates a file under `.github/workflows/` unless the App holds the `workflows`
  permission — and the `permissions:` block a workflow may grant its own
  `GITHUB_TOKEN` has no `workflows` key, so the default token can never do it.
  The refusal is **per push, not per file**: one blocked workflow file discards
  the whole commit, which is how issue #240 lost two runs of finished, unrelated
  work at several hundred thousand tokens each. `protected-paths.ts` names the
  prefixes and `stageAllowed` in `git-commit.ts` takes them back out of the index
  between `git add --all` and the guard, on **both** commit paths. Three things
  not to undo. It **drops rather than refuses** — a refusal here would lose
  exactly the work the remote would have lost, where dropping keeps the rest —
  which is also why it lives beside the commit and not in `diff-guard.ts`, whose
  job is to judge a change set and whose refusals are real outcomes. It
  **reverts the working-tree copy**, not merely unstages it: an unstaged edit is
  still an edit, so the next step's `git add --all` would stage it again for
  ever, and a turn that wrote nothing else would hand `git commit` an empty index
  to fail on — which is why `stageAllowed` returns what it dropped as well as
  what is left, and why an emptied index reports "nothing to commit" instead. And
  the prompts state the rule — `PROTECTED_PATHS_RULE` in `protected-paths.ts`,
  carried verbatim by all four instruction blocks that can write a file
  (`IMPLEMENT_INSTRUCTIONS`, `CI_FIX_INSTRUCTIONS` and `plan-draft.ts`'s two) and
  asserted against the constant by `instructions.test.ts`, so a softened copy
  cannot pass — but a rule the model has to remember is not a guardrail: the
  prompts are the courtesy, the staging step is the mechanism. Widening
  `PROTECTED_PREFIXES` is a privilege decision: an agent that can rewrite
  `agent-pipeline.yml` can rewrite the permissions, concurrency group and secret
  wiring that bound it, in a job that job itself defines.
- **The minimality rule reaches the code-writing blocks and stops there.**
  `MINIMALITY_RULE` in `prompts.ts` is carried verbatim by
  `IMPLEMENT_INSTRUCTIONS` and `CI_FIX_INSTRUCTIONS`, and deliberately **not** by
  `plan-draft.ts`'s two — `instructions.test.ts` asserts both halves, so an edit
  that hands it to a drafter fails rather than passing quietly. Artifact scope is
  a different question and already has an answer: `openspec/config.yaml`'s `rules`
  reach those blocks through the instructions payload, and a rule about stdlib and
  one-liners would be noise in a prompt that writes no code. The text is
  **duplicated** from `review-loop/src/prompt-templates.ts`'s `MINIMALITY_LADDER`
  rather than imported — that workspace is a subprocess here, not a module, and a
  runtime import for one paragraph is a boundary to defend at every later
  refactor. `tests/opencode-agent/minimality-rule.test.ts` pins the two equal, and
  is where a reworded rule surfaces. Note what it does **not** say: nothing about
  minimising file count. The phrasing this rule descends from says "fewest files
  possible", and in the papai repository a `max-lines` failure means split the
  file — adopting that clause would put the prompt in conflict with an enforced
  convention.
- **A drop is reported, never only logged, and `null` is not a verdict.**
  `commitAll` answers `CommitOutcome` — `clean | blocked | committed` — because
  `StagedTotals | null` made `null` mean both "the tree was already clean" and
  "everything the turn wrote is a file the remote refuses", and a caller holding
  one bit reported the second as the first. Run 31779566286 is the cost: a
  correct CI diagnosis whose only edit was `agent-pipeline.yml`, dropped at
  staging, reported as "Pushed a fix: no — nothing changed", twice, until the
  pull request's `ciAttempts` budget was gone. `dropped` rides on **`committed`**
  too — a partial drop pushes real work, so every other signal reads as success
  while part of the change is silently absent. Three consequences to keep. The
  CI-fix report names the file and says a maintainer must apply it by hand,
  because `/retry` cannot reach the remedy — another round re-derives the same
  edit. A green verdict on a round that pushed **nothing** is scoped to the job,
  not the branch: the repair turn holds `bash`, and run 31779566286 got its green
  by running `build:client` and `docker pull` on its own runner. And
  `ciBlockedPaths` carries the path into the next round's prompt, rewritten each
  round rather than accumulated, so a round that pushes clears a path a
  maintainer has since applied by hand. The review loop needs its own guard
  (`git-revert.ts`, driven from `review-push.ts`): its fixes are commits it makes
  in a worktree of its own and merges, so they never pass through an index
  `stageAllowed` sees, and a protected path there fails the **push** rather than
  being dropped.
- **A process artefact is not a deliverable, and that is enforced at staging
  too.** `stray-paths.ts` names `*.pid`, `*.sock` and `nohup.out`, and
  `stageAllowed` takes them back out of the index alongside the protected paths.
  It is a **separate list from `protected-paths.ts` on purpose**: that one is what
  a push cannot carry, this one is what a commit is not for, and the two have
  different remedies — a guardrail that conflates them is one nobody can reason
  about when it fires. The failure it answers is issue #239, which delivered a
  pull request whose whole diff was `serve3.pid`: the turn that was to write the
  deliverable died first, the pid file was the only dirty path left, and one
  stray line is not zero — so `walk.commits === 0` was false and
  `noChangesError`, the single question the pipeline asks about an implementation
  that produced nothing, answered wrong. Keep the list **short**: an entry here
  claims that no repository this pipeline works on would ever track such a file,
  which is only true of a runtime's own scratch. Anything a project might
  legitimately version belongs in that project's `.gitignore`, where a maintainer
  can see it and override it.
- **A turn the model never answered is a failure, not an empty success.**
  `turn-stall.ts` folds the event stream into what the provider has got wrong
  **since the last finished step**, and `requireAnswer` in `turn-run.ts` fails the
  turn when the decoded reply is empty _and_ that record is not. **Both halves are
  required and neither may be dropped**: an empty reply alone is an ordinary shape
  (the implement phase discards the text), and a stall alone describes a turn that
  recovered — which is precisely what a `step-finish` clearing the record means.
  Together they are issue #239's implement turn: refused 25 times over 12 minutes,
  idle without another finished step, an empty envelope every layer read as
  success, and a commit of whatever the tree happened to hold. It raises an
  **ordinary failure**, not a ceiling: nothing was written so nothing can be
  salvaged, and `FAILED` with its resume point intact is the right place to wait
  out a quota that clears with time. The read happens **after** the turn returns
  and in the adapter, the one place holding both signals — `runTurn` never sees
  the decoded reply.
- **A turn the provider stopped serving is aborted mid-flight, not burned to the
  whole-turn deadline.** The record above judges a turn that _returns_; the
  2026-08-21 incident was four runs whose turns never did — a gateway answered
  HTTP 200 and streamed nothing, the session retried the identical request 78
  times, and `AGENT_TIMEOUT_MS` was the only bound that fired, at 90 minutes. So
  `TurnStall` also carries `lastProgressAt` — stamped by the tracker at creation,
  on every finished step and every **newly started** tool call (a tool starting is
  as much proof the model answered as a step finishing), with `foldStall` kept
  pure — and `turn-run.ts` rides a **second reader on the heartbeat's tick** to
  ask, on every beat, whether `now − lastProgressAt ≥ AGENT_STALL_TIMEOUT_MS`
  **and** retry evidence has accumulated since that progress. Both conditions,
  always: the evidence is what separates a provider wave from one very long
  generation, which is the deadline's business and must keep being. `0` disables
  the knob and is exactly the old behaviour. The rejection is
  `turnStallError` (`TURN_STALL`), raced against the work `withDeadline`-style
  and passed through `runTurn`'s catch before the `alive()` probe. On the
  implement path it salvages like a deadline but **skips the wrap-up ask** — the
  soft stop's second prompt presumes an idle session that can still answer, and
  a stall abort happens because it cannot — and then leaves by the **failure
  door**: rethrown after the salvage so `failRun` parks `FAILED` with the stall
  text as `lastError` and `/retry` as the remedy, not `OUT_OF_TIME`/`INCOMPLETE`,
  which would invite a `/continue` into a wave that has not passed. Finished
  steps are not re-run by that `/retry`; their boxes are ticked on the branch
  and the walk skips them.
- **Capabilities are deny-by-default.** `openai-config.ts` grants tools by name
  on top of `"*": "deny"`, per agent profile: `plan` (the read-only phases)
  cannot edit or run commands, `build` can. Add a capability by naming it, never
  by widening the wildcard. Credentials are scrubbed from `process.env`
  (`secrets.ts`) before anything spawns, because the OpenCode server inherits it
  wholesale — so never reintroduce a code path that reads a secret from `env`
  after `runCli` has loaded config. Outbound text is redacted in `github.ts`, at
  the boundary: never move that into a renderer, and never add a `GitHubApi`
  method that sends free text without passing it through `clean`. `diff-guard.ts`
  inspects the index between `git add --all` and the commit; its `parseNumstat`
  fixtures are recorded from real git output, so re-record rather than adjust
  them by inspection. That inspection also **measures** what it lets through:
  `commitAll` returns `StagedTotals | null` rather than a boolean — `null` for a
  tree that was already clean — and `changedLines` rides out on it into the state
  block, where the delivery comment sizes its `/review` recommendation against
  `reviewHintLines`. The figure was already computed to refuse a runaway commit
  and was being thrown away. Keep it a **count**, never a `shouldReview` flag: a
  verdict frozen at commit time can only disagree with the threshold the config
  carries when the comment is read. It is **summed across the steps of one run** and no
  longer overwritten per commit — harmless while a phase made one commit, an
  under-report by a factor of the plan's length once it makes one per step — and it is
  patched only when the run committed something, so a continuation that kept nothing
  does not overwrite an earlier run's figure with a 0 that reads as a small diff. Note
  what a commit per step does to the guard's other half: the file and line caps now
  bound a **step** rather than a whole implementation, which is right, since they exist
  to refuse a runaway `git add --all` and that is a property of one staging operation
  rather than of a plan. `measure`'s `binaries` deliberately does not
  ride along — a commit that got past the guard has none, so that list is a
  working detail of judging a change set rather than a fact about one.
- Untrusted text (issue bodies, comments, **check output**) must go through the
  envelope from `prompts.ts` before reaching a prompt, and commands must be
  spawned as argv vectors with `shell: false`. The envelope is only as good as
  its three legs: a random per-prompt id, neutralising _every_ delimiter-shaped
  run rather than the one that would have matched, and `composeSystemPrompt`
  stating the rule for that same id. `mintEnvelope()` is called once per handler
  and its `nonce` passed to both the system prompt and the user prompt — the
  `SystemPromptInput.nonce` field exists to make forgetting that a type error.
- No `await` inside a loop body (repo lint). Sequential iteration goes through
  `src/sequence.ts` (`mapSeries`, `firstMatch`) or tail recursion.
- One class per file: pipeline failures are constructed through the factories in
  `src/errors.ts` rather than new error subclasses.
- Tests live in `tests/opencode-agent/`, follow `tests/CLAUDE.md`, and must not
  touch the network. Two files are deliberately not `*.test.ts`, so default
  discovery skips them; both need the `opencode` CLI and neither runs in CI.
  `live-sdk.integration.ts` (`bun run opencode-agent:test:live`) is the recorder —
  the SDK response fixtures in `adapters.test.ts` come from it, so re-run it rather
  than adjusting a decoder by inspection when the pin moves.
  `server-survival.integration.ts` (`bun run opencode-agent:test:survival`) is the
  diagnostic: it drives candidate shell commands through `POST /session/:id/shell`
  and asks after each whether this job's own server survived them. Both are driven
  **without a model** — the shell endpoint spawns the same `bash -l -c` child the
  bash tool does — which is what makes them cheap enough to run on a laptop.
- When a command test asserts an outcome, assert the **persisted state**, not
  just the returned status — a state that is never posted never happened.
- **The SDK response shapes are recorded, not guessed.** `sdk-contract.ts`'s
  `decodeSessionId`, `decodeReply` and `decodeAbort` decode `{ data, error }`
  through a schema;
  the fixtures in `adapters.test.ts` come from a live run. When the
  `@opencode-ai/sdk` pin moves, re-run the live check and re-record rather than
  adjusting the decoders by inspection. Note the asymmetry: request/response
  payloads sit under `data`, but an event from the `/event` stream carries its
  `type` and `properties` at the top level. Note too that an SSE stream does
  **not** end when its server does — the client reconnects for ever unless
  `sseMaxRetryAttempts: 0` is passed, so never make teardown wait for a stream to
  run out.
- **Commit identity is per-run actor, author vs committer split.** `src/commit-identity.ts` resolves the git identity once per job from `TriggerEvent` (`issue`/`pull-request` → `senderLogin` via `GET /users/:login` → `id+login@users.noreply.github.com`, `ci`/`pr-merged`/lookup failure → `github-actions[bot]`/`41898282+github-actions[bot]@users.noreply.github.com`, explicit `AGENT_COMMIT_NAME`/`AGENT_COMMIT_EMAIL` wins per field). `src/git.ts` stamps author via `GIT_AUTHOR_*` env and committer via `git -c user.name/email` (service), so blame shows the human while push provenance stays service. The same resolved author is fed to `review-runner.ts` `commitAuthor` and to every `commitAll`/`salvageAll`/`ARCHIVE` commit in the job; re-resolving per commit would waste `GET /users` and diverge across steps — one lookup per job, reused.

## Dependencies

- `@octokit/rest` — GitHub REST access, behind `src/github.ts`.
- `@opencode-ai/sdk` — headless OpenCode server + session, behind
  `src/opencode-adapter.ts`.
- `zod` — payload, config and model-reply validation (shared with root).

The first two sit in `devDependencies` even though the pipeline needs them at
run time: this workspace is developer tooling that never runs inside the papai
container, and the Dockerfile's `prod-deps` stage installs with `--production`.
The Actions workflow runs a plain `bun install --frozen-lockfile`, so both are
present there.

The workflow additionally installs the `opencode` CLI (the review-loop workspace
shells out to `opencode run`) and checks out `obra/superpowers` to `.superpowers/`.
Both of those paths, plus the generated `.opencode-agent/` run inputs, are
gitignored — `git add --all` in the implement phase would otherwise commit them.
