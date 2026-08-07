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
  `AGENT_REPORT` for the artefacts. `AGENT_STATUS` is the odd one out — it marks
  the run's live status comment so `renderThread` can leave it out of a prompt,
  and it is read by nothing else.
- `src/triggers.ts` decides _whether and where_ an event moves the state — it
  keeps the slash commands and the dispatch — with the red-CI half in
  `src/ci-trigger.ts`, the plain-comment half in `src/comment-intent.ts`, and the
  shared outcome shape plus `moveOrSkip` in `src/trigger-outcome.ts`;
  `src/orchestrator.ts` drives the phase cascade once that decision is made;
  `src/token-budget.ts` decides whether the cascade may afford another step, and
  `src/phase-failure.ts` decides what a run that broke is left looking like.
  Phase handlers in `src/phases/` return a `TransitionSignal`, a comment body and
  optional artefact blocks, and never write state or decide the next phase
  themselves.
- Feedback on the issue that is not a comment lives apart from the machine that
  causes it: `src/presentation.ts` owns the one glyph/label/headline table every
  renderer reads, `src/feedback.ts` the reaction channel, `src/labels.ts` the
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
  record what it spent.
- Every external boundary is an injected interface (`GitHubApi`, `Git`,
  `CheckRunner`, `RunReview`, `OpenCodeAgent`, `ReadSkillFile`).

## Local rules

- **Never scrape prose to recover an artefact.** Spec, plan and report travel in
  hidden blocks via `blocks.ts` / `artifacts.ts`. Heading-and-trailer scraping
  silently truncated specs at their first `---` rule; do not reintroduce it.
- **Each artefact counts its own revisions.** `specRevision` and `planRevision`
  are separate fields and each handler renders and stores one of them, from a
  single local so the visible heading and the hidden block cannot disagree. They
  were one shared `revision` bumped by both `SPEC_POSTED` and `PLAN_POSTED`, so
  the counts interleaved and the first execution plan on every issue announced
  itself as revision 2 — revision 3 if the spec had been revised once first —
  which is not a reading "the Nth version of this artefact" allows. The report
  block stamps `planRevision`: it records which plan was implemented, and no
  signal bumps a report counter. Splitting them needed no `STATE_VERSION` bump
  because both fields default; the old key is dropped rather than mapped onto
  either, since it was a sum and never a count of either artefact.
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
- **The review loop is `review-loop/`, not a local reimplementation.** Phase 3
  drives that workspace through `review-runner.ts`. `check-loop.ts` exists only
  for CI fixing, which the workspace does not cover. In that loop the first round
  runs every check — one repair prompt seeing every failure fixes more than a
  fail-fast round would — and later rounds re-run only what failed. Only a **full**
  pass may return `passed`: a narrowed round has not looked at the checks it
  skipped since before a repair edited the tree.
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
  re-enter.
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
- **A red run is acted on where the branch is live and no job is on it.**
  `CI_FAILED` names two rows in `TRANSITIONS`, `COMPLETE` and `PR_DELIVERY`, and
  the absences are the design. `PR_DELIVERY` is the genuine race: phase 3 pushes
  the branch and posts a block naming that phase before phase 4 opens the pull
  request, so a job that died in between left a live branch whose red checks were
  refused as an invalid transition and dropped — nothing posted, no `ciAttempts`
  spent, no trace but a `reason` string nobody reads. The four phases before the
  branch exists stay out because `handleCiFix` would run the checks against a
  branch cut from the base; `REVIEW_AND_MUTATE` and `CI_FIX` stay out because the
  machine never persists them (a block is written only when a handler posts, and
  both post the phase they moved _to_), and honouring a hand-edited one would put
  a second job on a branch another is mid-commit on — the workflow's concurrency
  group queues those two, but only while `workflow_run.head_branch` and
  `agent/issue-<n>` agree, which is a coincidence and not a proof. **`FAILED`
  stays out deliberately**, the close call: the branch is pushed there, but
  `CI_FAILED` is a forward move, so it would reset `attempts` and leave the one
  phase `/retry` accepts, and a fix that went green would park the issue in
  `COMPLETE` announcing success for a delivery that never finished. Those red
  checks are deferred behind the `/retry` the failure comment already asked for,
  not abandoned. A refused red run **logs at `warn` with the phase** and posts
  nothing, for the reason `settledPullRequest` sets out: CI fires on every push,
  so a comment per red run is spam.
- **The CI-fix budget belongs to a pull request, not to an issue.**
  `handleDeliver` clears `ciAttempts` and `ciBudgetReported` on its
  `existing === null` branch — a genuinely new pull request — and leaves both
  alone when it refreshes the open one. Neither used to reset at all, and `applyCiTrigger` short-circuits
  on `ciBudgetReported` before it even looks the pull request up, so an issue
  that burned its rounds on one pull request and then delivered a second got no
  fix round on the new one and no comment explaining the silence. Do not extend
  the reset to the refresh path: same branch, same commits, same checks that
  spent the rounds, and a clean slate there is one broken branch bouncing off the
  agent for as long as anyone keeps replying `/retry`.
- **A run says whether it reported, and the workflow reads that.** `RunResult`
  carries `reported`, and `step-output.ts` turns it into a `reported=true` line
  in `$GITHUB_OUTPUT`; the workflow's fallback "Agent job failed" comment is
  gated on `steps.pipeline.outputs.reported != 'true'`. It used to be gated on
  `if: failure()` alone, which selects **every** red job — and six paths exit 1
  only after posting their own report (`failRun`, `failAnswer`, both over-budget
  stops, `refuseExhausted`, the CI-budget notice), so every genuine failure drew
  a second comment claiming "the issue state is unchanged" beside a block that
  had just moved to `FAILED`. Only CI runs escaped, by accident:
  `github.event.issue.number` is empty on a `workflow_run` event. Set `reported`
  on any new terminal path from what that path **posted**, never from its status
  — `failed` covers both a reported failure and a crash, and `skipped` covers
  both a silent guardrail drop and a refused command that answered on the issue.
  A throw is deliberately unmarked: that is the crash the fallback comment is
  for. Writing the marker is best-effort and must never throw — `GITHUB_OUTPUT`
  is absent on every `--event-path` run.
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
- **Bounds go on the finished prompt, and on waiting.** `prompt-budget.ts` caps
  what reaches the model — per prompt, not per input, since a per-input cap
  bounds one log and nothing else. `deadline.ts` bounds waiting for a model turn;
  it cannot cancel the request and does not claim to. What both buy is a failure
  the pipeline can report, instead of a runner killed by `timeout-minutes`, which
  posts nothing at all.
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
  them by inspection.
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
  touch the network. The one exception is `live-sdk.integration.ts`, which is
  deliberately not a `*.test.ts` so default discovery skips it; it needs the
  `opencode` CLI and is run via `bun run opencode-agent:test:live`.
- When a command test asserts an outcome, assert the **persisted state**, not
  just the returned status — a state that is never posted never happened.
- **The SDK response shapes are recorded, not guessed.** `sdk-contract.ts`'s
  `decodeSessionId` and `decodeReply` decode `{ data, error }` through a schema;
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
