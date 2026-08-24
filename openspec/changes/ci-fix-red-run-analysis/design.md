# Design: ci-fix-red-run-analysis

## Context

The CI-fix phase today (`opencode-agent/src/phases/ci-fix.ts`) reproduces CI by
running `deps.config.checks` — `AGENT_CHECKS` or `DEFAULT_CHECKS` — in a local
loop. The red run itself is never read: the `ci` trigger carries only its URL,
and `GitHubApi` has no Actions surface. See `proposal.md` for the incident
(runs 32641725211 / 32652877782, PR #337) and `specs/agent-ci-repair/spec.md`
for the behavior contract.

## Goals / Non-Goals

Goals:

- Diagnosis grounded in the red run's failed jobs and logs, with no
  repository configuration.
- Reuse the existing repair loop, envelope doctrine, and report machinery;
  the change is a re-scoping, not a rewrite.

Non-Goals:

- Reproducing runner-only environments (docker services, secrets) locally —
  those go down the log-based or needs-human paths.
- Touching the review loop's check command (`AGENT_CHECK_COMMAND`) or the
  commit-repair loop.
- Persisting anything new in `AGENT_STATE` — `ciAttempts`, `ciBlockedPaths`
  and their per-pull-request reset semantics are unchanged.

## Decisions

### D1: Failure discovery through two new `GitHubApi` methods

`listRunJobs(runId)` (jobs with per-step conclusions) and `jobLog(jobId)`
(the job's log text), wrapping `octokit.rest.actions.listJobsForWorkflowRun`
and `downloadJobLogsForWorkflowRun`. Everything through the existing boundary
in `github.ts`: redaction via `clean()` at the boundary, response shapes
recorded from a live run as fixtures (the `sdk-contract.ts` doctrine) rather
than guessed.

- The workflow's token gains `actions: read` (workflow-level permissions
  block — a human edit in this change; the agent's protected-paths rule
  governs what the *agent* may push, not what this repository may version).
- A fetch failure (403, GHES without the endpoint) is caught and becomes a
  needs-human report naming the error, not a crash: the fallback comment
  exists for crashes, but here a degraded sentence on the pull request is the
  more useful answer.
- Only failed jobs' logs are fetched; each is clipped with `clipTail` (tail —
  failures cluster at the end) under a per-job budget, with the aggregate
  capped by `prompt-budget.ts` as everywhere else.

Alternatives: deriving failures from check-run annotations (smaller payloads,
but no log text — the diagnosis would be blind); scraping the run URL
(forbidden by the no-scraping rule, and unauthenticated).

### D2: The trigger carries `runId`

`trigger-events.ts`'s `workflow_run` parse carries `runId` (payload `id`)
beside `runUrl`. The guardrail checks (own branch, own repository) are
untouched. `runUrl` stays what reports render; `runId` is what APIs address.

### D3: One diagnosis turn, then the existing loop, scoped by the verdict

The phase gains a diagnosis step ahead of the repair loop, asked through
`promptForJson` (one ask, one re-ask on invalid JSON — the existing seam):

- **Input**: failed job names + failed step names (API facts), clipped log
  excerpts (enveloped — CI log text is untrusted, and PR titles and branch
  names ride inside it), the red run URL, `ciBlockedPaths`.
- **Verdict schema**: `{ verdict: 'fix' | 'needs-human', reproduction?: { argv:
  string[] }, approach: string, humanReport?: string }` — `humanReport`
  required when the verdict is `needs-human`; `reproduction` present when the
  model derived the failing step's command from the repository's own workflow
  files in the checkout.

Flow after the verdict:

- `fix` + `reproduction` → run the argv locally via `shell.ts` (argv vector,
  no shell). Failing locally enters the existing `runCheckLoop` scoped to that
  one command, with repair prompts carrying the local output alongside the
  original log excerpt. Passing locally while CI was red is *not* success —
  the round falls through to the log-based path, per the spec.
- `fix` without `reproduction` → one repair turn working from the log
  (the model holds `bash` and may still verify what it can, but the report
  says the verdict rests on log analysis, not an observed local pass).
- `needs-human` → no repair turn; the report renders `humanReport` plus the
  job/step facts.

The derived argv's provenance (the repo's workflow, not the log) cannot be
verified mechanically — accepted, because it grants nothing the repair turn
does not already hold: the `build` profile has `bash`, and spawning stays
argv-vector so log text never reaches a command line.

Alternative considered: a single free-form "investigate with bash" turn. It is
smaller, but it abandons the bounded loop, the observed-pass guarantee behind
"green", and the structured needs-human verdict — all of which the spec
requires.

### D4: `AGENT_CHECKS`, `DEFAULT_CHECKS` and `check-spec.ts` are removed

`config.checks` and its parse go; `deps.runCheck` is replaced by running the
derived argv through the command runner with the same cwd/timeout treatment.
The workflow stops exporting `AGENT_CHECKS`; the opencode-agent README loses
the knob. `AGENT_CHECK_COMMAND` (review loop) is untouched — different
consumer, different question.

### D5: Report renderer gains two outcomes

`verdictLine` / `pushedLine` extend to the new outcomes: log-based fix pushed,
and needs-human (job, reason, remedy — from the verdict). The existing honesty
rules survive verbatim: a green verdict on a round that pushed nothing is
scoped to the job; a dropped fix is named; `/retry`'s limits are said plainly.
A needs-human round consumes its `ciAttempts` entry like any other — bounded,
and a later red run of the same pull request still reaches the budget notice.

### D6: Transcript, not the public log

Log excerpts and the verdict ride the encrypted transcript (the designated
place for content); the public Actions log carries job/step names and counts
only, per the progress-channel rule.

## Risks / Trade-offs

- [Log endpoint unavailable (GHES, token scopes)] → caught and reported as
  needs-human with the error; a maintainer loses diagnosis, not the pipeline.
- [Huge logs reach the prompt] → per-job `clipTail` budget plus the aggregate
  `prompt-budget.ts` cap, as every other content path.
- [Model misjudges fixable and pushes a bad fix] → CI re-runs on push and the
  next red run re-enters the loop under the same `ciAttempts` budget — the
  existing containment.
- [Model misjudges needs-human] → the report says so with its reasoning; a
  human `/retry` buys a fresh diagnosis round; no silent skip.
- [Prompt injection from log text] → envelope with per-prompt nonce (existing
  doctrine), redaction at the boundary, argv-vector spawning; the diagnosis
  prompt states the rules for the same nonce.
- [`AGENT_CHECKS` removal breaks other repos using the pipeline] → accepted:
  this workspace is repo-local tooling; the README documents the new contract.

## Migration Plan

One PR; no persisted-state change (`AGENT_STATE` shape untouched, no
`STATE_VERSION` bump), no phase-machine change (`CI_FAILED` → `CI_FIX` as
today). Rollback is revert. In-flight CI-fix rounds after deploy restore under
the same schema and simply take the new path on their next trigger.

## Open Questions

- None that change the specs, approach, or tasks. (Diagnosis-turn agent profile
  stays `build`, as the phase uses today; revisiting it is a tuning matter.)
