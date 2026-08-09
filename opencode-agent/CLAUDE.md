# opencode-agent Workspace

## Purpose

`opencode-agent/` is a standalone Bun workspace holding a **spike**: an
event-driven GitHub Actions coding agent built on the OpenCode SDK and
obra/superpowers skills. It is not a papai runtime dependency and nothing under
`src/` imports it. Full behaviour, configuration and setup: `README.md`. Open
findings: `ROADMAP.md`.

## Shape

- One CI job = one call to `runCli`. State lives in hidden blocks on the issue,
  not on disk: `AGENT_STATE` for the machine, `AGENT_SPEC` / `AGENT_PLAN` /
  `AGENT_REPORT` / `AGENT_HANDOFF` for the artefacts. `AGENT_STATUS` is the odd one out — it marks
  the run's live status comment so `renderThread` can leave it out of a prompt,
  and it is read by nothing else.
- An event is parsed before it is judged: `src/trigger-events.ts` says what a raw
  payload **is** and `src/guardrails.ts` whether the pipeline may act on it. That
  split is not tidiness — it is what lets `src/pr-trigger.ts` finish a parse
  without importing the policy layer that will judge the finished event, which
  would be a cycle. There are **three** doors, not two: an issue event, a red CI
  run, and a comment typed on a pull request, which is the one `parseTriggerEvent`
  cannot finish alone (`src/github-pulls.ts` reads the head that names its issue).
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
- Feedback on the issue that is not a comment lives apart from the machine that
  causes it: `src/presentation.ts` owns the one phase glyph/label/headline table
  every renderer reads and `src/outcomes.ts` the second vocabulary beside it — the
  outcome glyphs, which are keyed by how a run _ended_ rather than by which phase
  it is in, which is why they are not one table; `src/feedback.ts` the reaction channel over `src/github-reactions.ts`'s
  endpoints, `src/labels.ts` the
  label reconcile over `src/github-labels.ts`'s endpoints, and
  `src/status-reporter.ts` the run's live status comment over the body
  `src/status-comment.ts` renders. Each channel has exactly one function that
  talks to GitHub, because "best-effort" has to be a property of one function
  rather than a convention at each call site. The status comment carries an
  `AGENT_STATUS` block — never `AGENT_STATE`, which would give the restore scan a
  second source of truth — so that `prompt-budget.ts` can drop it before the
  twenty-comment window is taken; without that, every previous run's progress
  table would take a slot from the conversation triage, answering and the
  classifier are being asked to read. Filter that channel by **marker**, never by
  author: the agent writes the spec, the plan and every report too.
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
  three ways to end. It owns the bound, the heartbeat and the failure
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
  do not reintroduce it. The plan is the case that had to grow a second half: its
  block carries the ordered **steps** beside the text, and the text is _rendered from
  them_ by `renderPlanMarkdown`, so the comment a maintainer approved and the list the
  implementation walks cannot disagree. Reading the steps back out of the markdown
  would be that same bug on a new surface, which is why `findPlan` exists and why a
  `steps` field the schema cannot vouch for degrades to **no steps at all** rather than
  to the steps it could parse — half a plan read as a whole plan is the failure being
  avoided, and no steps is a shape this pipeline already runs correctly.
- **Each artefact counts its own revisions.** `specRevision` and `planRevision`
  are separate fields and each handler renders and stores one of them, from a
  single local so the visible heading and the hidden block cannot disagree. They
  were one shared `revision` bumped by both `SPEC_POSTED` and `PLAN_POSTED`, so
  the counts interleaved and the first plan on every issue announced
  itself as revision 2 — revision 3 if the spec had been revised once first —
  which is not a reading "the Nth version of this artefact" allows. The report
  block stamps `planRevision`: it records which plan was implemented, and no
  signal bumps a report counter. Splitting them needed no `STATE_VERSION` bump
  because both fields default; the old key is dropped rather than mapped onto
  either, since it was a sum and never a count of either artefact.
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
  In that loop the first round runs every check — one repair prompt seeing every
  failure fixes more than a fail-fast round would — and later rounds re-run only
  what failed. Only a **full** pass may return `passed`: a narrowed round has not
  looked at the checks it skipped since before a repair edited the tree.
- **The pull-request door resolves before it acts, and its lookup is not
  swallowed.** State lives in hidden blocks on the **issue** and `findLatestState`
  scans the issue thread, so a comment typed on a pull request names nothing this
  pipeline can restore — `github.event.issue.number` there is the _pull request_.
  `resolvePullRequestTrigger` in `pr-trigger.ts` recovers the issue from the head
  branch, `agent/issue-<n>`, the same link a red CI run travels; that costs an API
  call, which is why it is a second step and not a branch of the pure
  `parseTriggerEvent`. Its **order is the design**: the `/review` test is free and
  comes first, so every ordinary code-review comment on every pull request in the
  repository is dropped with no lookup at all — the head lookup that follows is
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
  still go to the issue whichever door was used, and that is not a preference: a
  block on the pull request is a second source of truth the restore scan cannot
  see. `applyPullRequestCommand` keeps refusing everything but `/review` even
  though the resolver means nothing else can reach it, because a decision enforced
  only by whichever layer filters first is one a second door quietly repeals.
- **One model endpoint.** Everything goes through `openai-config.ts`; there are
  no provider-specific keys and no second place a model is named. OpenCode is
  never handed the real key: `provider-proxy.ts` holds it and `contain()` in
  `index.ts` configures everything downstream with the placeholder, because the
  SDK puts the config into the spawned server's environment where `bash` can
  read it. Never pass `config.openai` to an OpenCode path — pass the contained
  settings. That proxy is also where **transient failures are retried**, because
  it is the one layer that sees a real HTTP status and the only one the review
  loop's subprocesses also pass through; do not add a second retry in the
  adapter, where the status is already gone.
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
  `reconcileLabels` in `labels.ts`, `attempt` in `status-reporter.ts`,
  `persistState` in `state-persist.ts`, `refreshPullRequest` in
  `phases/review.ts` and `noteReview` in `pull-request-note.ts` are the only
  functions in their modules that call GitHub, and each catches every rejection
  and degrades it to a
  `warn`; a caller reaches the same `RunResult` and the same **persisted state**
  it would have reached with the channel absent. `noteReview` is the newest and
  the one that leaves the issue entirely: it posts the two-line pointer a
  `/review` typed on a **pull request** earns — the loop's verdict, whether the
  findings became commits, and the `#n` where the report and the state block went
  — and it fires on the trigger **kind**, in a `switch` beside `feedback.ts`'s,
  never on the phase, since `CODE_REVIEW` is reached identically through both
  doors and a phase test would draw a pointer for a maintainer already reading the
  report. It is its own module rather than a second `try` beside
  `refreshPullRequest` for the reason the rule states, and `RunResult` is absent
  from its signature the way it is from `StatusReporter.finish`: `reported` means
  "the issue carries this run's account of what happened" and gates the workflow's
  fallback comment, so a note on the pull request — which that comment neither
  reads nor could reach — must leave the flag **unreachable**, not merely
  untouched. An edit that wanted to set it would have to change the interface
  first. `refreshPullRequest` is the one that shows what the rule is about,
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
- **`reported` means an account of what happened, so a status comment never sets
  it.** The live status comment is what makes that distinction load-bearing
  rather than pedantic: a run killed mid-phase leaves "🛠️ Writing and reviewing
  the code — run in progress" on the issue, which is precisely the silence the
  fallback comment exists to explain, and nothing ever corrects it — the process
  that owned that comment is gone, and the next run opens its own. Marking it
  reported would suppress the only comment that would have said why the issue
  stopped. So `StatusReporter.finish` takes the `RunResult` and returns `void`:
  the flag is **unreachable** from the channel, not merely left alone by habit,
  and an edit that wanted to set it would have to change the interface first.
  Keep it that way, and keep `finish` unable to _reject_: `runAccepted` awaits it
  on the way out with the result already decided, so a channel that could throw
  there would turn a finished run into a failed one. The rule above is what makes
  that impossible. The finalising edit on a _returning_ path does not set the
  flag either, though it safely could: the paths that report already do, and two
  writers of one flag is how it drifts. Reactions and labels are the same
  argument one step shorter — an emoji is not an account of anything, and
  neither is a label.
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
  nowhere to land. Do not widen a schema to "make the log more useful": a CI log
  is world-readable on a public repository and is _not_ covered by the outbound
  redaction in `github.ts`. Names, statuses and counts only. Every shape there is
  recorded from a live server — re-record rather than adjusting by inspection,
  and note that the SDK's generated `Event` union is already behind its own
  server, which is why each decode is a `safeParse` yielding `null`.
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
  the prompts state the rule (`IMPLEMENT_INSTRUCTIONS`, `PLAN_INSTRUCTIONS`) so a
  well-behaved turn never writes such a file, but a rule the model has to
  remember is not a guardrail — the prompts are the courtesy, the staging step is
  the mechanism. Widening `PROTECTED_PREFIXES` is a privilege decision: an agent
  that can rewrite `agent-pipeline.yml` can rewrite the permissions, concurrency
  group and secret wiring that bound it, in a job that job itself defines.
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
