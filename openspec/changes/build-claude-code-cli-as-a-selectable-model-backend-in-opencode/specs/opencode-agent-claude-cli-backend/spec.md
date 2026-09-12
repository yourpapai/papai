<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets a repository maintainer point the opencode-agent pipeline's model turns at the
official Claude Code CLI instead of the headless OpenCode server, behind the same
session seam: one job-wide selector, a startup credential-exclusivity guard,
determinism-pinned invocations, allowlist-based permissions, and a pinned workflow
install.

## ADDED Requirements

### Requirement: Backend selection is one job-wide knob

The pipeline SHALL read `AGENT_BACKEND` with values `opencode` and `claude`, defaulting
to `opencode` when unset or empty — the workflow forwards an unset repository variable
as the empty string, which reads as unset. The selected backend SHALL serve every model
turn of the job; phases, budgets, guardrails and feedback behave identically above the
seam on either backend. A non-empty value outside the two SHALL fail job startup with
an error naming `AGENT_BACKEND`, before any model turn is spent. The default route SHALL behave
byte-identically to the pre-change pipeline: no CLI install, spawn, or Anthropic
credential handling occurs on it.

#### Scenario: Unset knob keeps the OpenCode route

- **WHEN** a job runs with `AGENT_BACKEND` unset
- **THEN** every model turn is served by the OpenCode server session exactly as before, and no `claude` process is spawned

#### Scenario: Claude backend serves the whole job

- **WHEN** `AGENT_BACKEND=claude` and a job cascades through several phases that prompt the model
- **THEN** every turn of that job runs through the CLI backend, and no turn of that job is served by the OpenCode server

#### Scenario: Unknown value fails at startup

- **WHEN** `AGENT_BACKEND` holds any non-empty value other than `opencode` or `claude` (unset or empty keeps the default)
- **THEN** configuration loading fails with an error naming `AGENT_BACKEND`, before any model turn runs

### Requirement: Exactly one Anthropic credential, checked before any spend

When the claude backend is selected, the pipeline SHALL require exactly one of
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` to be present, and SHALL fail job
startup loudly — naming both variables, with a failure distinguishable from other
startup failures by its error code — when both are set or when neither is, before any
`claude` process is spawned and before any model spend. Both-set SHALL fail because the
API key silently wins and switches billing to per-token Console charges; neither-set
SHALL fail because no credential remains. The documented default route is the API key
(Commercial Terms, predictable billing); the OAuth token is the opt-in for teams
drawing from a Pro/Max/Team/Enterprise subscription. The guard SHALL NOT fire on the
`opencode` route. On the claude route a set `LLM_API_KEY` SHALL likewise fail job
startup, naming the variable: the gateway credential is refused, not merely unused,
because with no provider proxy in front of the review loop's `opencode run` children
a present key would reach a subprocess whose children the model controls.

Credentials SHALL arrive as GitHub Actions secrets (encrypted at rest by GitHub,
masked in logs) and SHALL be injected only after the pipeline's environment scrub: the
spawned CLI's environment carries the one chosen credential and no other pipeline
credential. Credential values SHALL never be logged, posted, persisted into any state
block, or written to the transcript; error messages name variables, never values.

#### Scenario: Both credentials set fails before spawning

- **WHEN** `AGENT_BACKEND=claude` and both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are set
- **THEN** job startup fails naming both variables and stating that the API key would silently win billing, and no `claude` process is spawned

#### Scenario: Neither credential set fails

- **WHEN** `AGENT_BACKEND=claude` and neither variable is set
- **THEN** job startup fails naming both variables as the accepted spellings, before any model spend

#### Scenario: The gateway credential is refused on the claude route

- **WHEN** `AGENT_BACKEND=claude` and `LLM_API_KEY` is set
- **THEN** job startup fails naming `LLM_API_KEY` before any model turn or CLI spawn, and the key never reaches a review-loop subprocess

#### Scenario: The single chosen credential is the only one injected

- **WHEN** exactly one of the two credentials is set and the run spawns the CLI
- **THEN** the CLI's environment carries that credential and none of the pipeline's other secrets, and no log line, state block or transcript entry carries the credential's value

#### Scenario: The opencode route is unaffected by the guard

- **WHEN** `AGENT_BACKEND` is `opencode` or unset, whatever Anthropic credentials happen to be present
- **THEN** startup proceeds under the gateway credential rules exactly as before, and the exclusivity guard neither fails the job nor rewrites the environment

### Requirement: Model turns consume the first-party CLI only

The claude backend SHALL obtain all model behavior by spawning the official `claude`
CLI binary. The pipeline SHALL NOT import an Anthropic Agent SDK, SHALL NOT call the
Anthropic HTTP API directly, and SHALL NOT hand a subscription OAuth token to anything
other than the spawned CLI binary — the only sanctioned consumer since the Feb 19 2026
enforcement.

#### Scenario: Turns are CLI subprocesses

- **WHEN** the claude backend runs a model turn
- **THEN** the reply is produced by a spawned `claude` process, and the pipeline itself contacts no Anthropic API endpoint and loads no Agent SDK package

#### Scenario: OAuth is consumed by the binary alone

- **WHEN** the run is authenticated with `CLAUDE_CODE_OAUTH_TOKEN`
- **THEN** the pipeline places the token only in the `claude` binary's environment — no pipeline library, API call, or other pipeline-spawned process receives it — accepting that subprocesses the CLI's own `Bash` tool spawns inherit that environment (a recorded residual, design Risks)

### Requirement: Invocations are deterministic and name the model explicitly

Every CI invocation of the CLI SHALL run with `--bare`, so user hooks, MCP servers,
skills and CLAUDE.md discovery are skipped and any two runners see the same context.
The job's configured model SHALL be passed explicitly as `--model` on every invocation
— the model is named in exactly one place on this route — and the invoking profile's
reasoning effort SHALL be passed explicitly as `--effort` whenever that profile has an
effort configured. A profile with no configured effort (including `propose`, which
carries none on either backend) omits `--effort` rather than inventing a value; no
other source of effort exists on this route. The OpenAI-compatible gateway endpoint and its
credential are unused on this route and SHALL NOT reach the CLI's arguments or
environment. No `~/.claude` state SHALL be carried across jobs: continuity exists only
inside a job, through session resume, and every job starts from clean CLI state.

#### Scenario: Every spawn carries the determinism and model flags

- **WHEN** the claude backend composes any CLI invocation
- **THEN** the arguments include `--bare` and an explicit `--model` carrying the configured model id, plus an explicit `--effort` when the invoking profile has an effort configured

#### Scenario: Gateway configuration stays off the route

- **WHEN** a job runs with `AGENT_BACKEND=claude`
- **THEN** the gateway endpoint and its credential participate in no turn, and the CLI receives neither in arguments nor environment

#### Scenario: No CLI state survives a job

- **WHEN** a job ends and a later job starts on the same issue
- **THEN** the later job's first CLI invocation starts with no session state, credential cache, or other `~/.claude` content produced by the earlier job

### Requirement: Profiles map to explicit tool allowlists, never blanket permission

Tool permission on the claude route SHALL be expressed as an explicit `--allowedTools`
allowlist derived from the existing deny-by-default profiles, with
`--permission-mode default`. The pinned mappings are: `plan` → `Read,Glob,Grep`;
`build` → `Read,Edit,Write,Bash,Glob,Grep`. No invocation SHALL carry
`--dangerously-skip-permissions`, and no profile SHALL receive a tool allowlist
broader than its OpenCode-side capability set. A tool outside the invocation's
allowlist SHALL NOT execute on this route — `--allowedTools` auto-approves its
members and enables nothing, and under headless `-p` with
`--permission-mode default` a permission request for an unlisted tool has no
grantor, so the call is refused rather than run, whatever default tool
availability `--bare` leaves loaded; this effective-toolset confinement SHALL
be pinned by a recorded fixture (a plan-profile turn whose prompted `Bash`
call is refused), not assumed from documentation.

#### Scenario: Read-only profile gets the read-only allowlist

- **WHEN** a turn runs under the `plan` profile
- **THEN** the CLI is invoked with `--allowedTools Read,Glob,Grep` and `--permission-mode default`

#### Scenario: Write-capable profile gets the write allowlist

- **WHEN** a turn runs under the `build` profile
- **THEN** the CLI is invoked with `--allowedTools Read,Edit,Write,Bash,Glob,Grep` and `--permission-mode default`

#### Scenario: Blanket permission is never used

- **WHEN** any CLI invocation is composed on this route, under any profile and any budget or stop condition
- **THEN** the arguments never include `--dangerously-skip-permissions`

#### Scenario: An unlisted tool is refused, not run

- **WHEN** a plan-profile turn's prompt attempts a `Bash` call, which is not on that profile's allowlist
- **THEN** the call is refused under `--permission-mode default` and produces no tool effect, keeping the review gates structurally read-only on this route too

### Requirement: Stream-json output is decoded, resumed, and shape-validated

Turns SHALL run with `--output-format stream-json`, and the NDJSON stream SHALL be
decoded line by line: the final reply text and the token usage come from the `result`
line; the session id comes from the init message and is returned as the turn's
`sessionId`; a later turn in the same job continues that session via
`--resume <session-id>`. Line shapes SHALL be validated against decoders recorded from
a live CLI, never guessed: a line whose shape is not recognized SHALL be skipped for
progress purposes without failing the turn, while an exit-0 run with a missing or
undecodable `result` line SHALL fail the turn rather than resolve as an empty
success, and an exit-0 run that leaves the job with no session id — no init
message this turn and none memoized from an earlier turn — SHALL likewise fail
rather than resolve under a synthetic id, which would silently fork the
session's context. A decodable `result` line that itself signals an error — the
CLI's `is_error` marking or the recorded equivalent — or that carries empty
final text SHALL likewise fail the turn with that same error family regardless
of exit code: the route relies on the CLI's documented error-to-non-zero-exit
correlation for nothing, and error-shaped or empty output is the empty-success
shape, not a reply.

#### Scenario: A successful turn returns result-line facts

- **WHEN** the CLI exits 0 having emitted an init message and a `result` line
- **THEN** the turn resolves with the `result` line's text and token usage, and the session id taken from the init message

#### Scenario: A resolved turn with no session id fails rather than forking context

- **WHEN** the CLI exits 0 with a decodable `result` line but the job holds no session id — no init message this turn and none memoized from an earlier turn
- **THEN** the turn fails with the same error family as a missing `result` line, and no later turn resumes a synthetic id

#### Scenario: An error-signalling or empty result line fails regardless of exit code

- **WHEN** the CLI emits a decodable `result` line that signals an error (`is_error` true or the recorded equivalent) or carries empty final text, whatever the exit status
- **THEN** the turn fails with the same error family as a missing `result` line, and the error or empty text is never resolved as the turn's reply

#### Scenario: The next turn resumes the session

- **WHEN** a job prompts a second turn after a first one succeeded
- **THEN** the CLI is invoked with `--resume` carrying the first turn's session id

#### Scenario: Unrecognized non-result lines degrade

- **WHEN** the stream carries a line whose shape is not recognized, of any type among `system`, `assistant`, `user`, `stream_event`
- **THEN** the line is skipped for progress purposes and the turn proceeds to its normal completion

### Requirement: Exit codes are honored, never swallowed

A CLI exit status of 0 SHALL mean the turn completed; any non-zero exit SHALL fail the
turn with the exit code carried in the failure and distinguishable by error code from
deadline, stall and dead-server failures. No path SHALL reinterpret, retry away, or
swallow a non-zero exit into an empty success.

#### Scenario: Non-zero exit fails the turn

- **WHEN** the CLI exits non-zero — a rejected credential, a usage limit, or an internal error — and the stream carries no error-signalling or empty `result` line, which the stream-json requirement's error family owns whatever the exit status
- **THEN** the prompt rejects with a failure naming the exit code, and the phase treats it as the work breaking

#### Scenario: Zero exit with a sound result line succeeds

- **WHEN** the CLI exits 0 and a decodable `result` line arrived that signals no error and carries non-empty final text, and a session id is available — this turn's init message or one memoized from an earlier turn
- **THEN** the turn resolves with that reply text and raises no error

### Requirement: The stop kills the process group and reports; teardown reaps and terminates what was abandoned

No long-lived server exists on this route. The session's stop SHALL kill the CLI
**process group** — so tool children, including a Bash tool's subprocesses, are not
orphaned — and SHALL report whether the kill landed, because the stop's caller fences
salvage on that answer. Teardown (`close`) SHALL NOT be used as a turn's stop, or as
the fallback for a kill that did not land, and SHALL report nothing; if a CLI process
is still alive at teardown — a turn abandoned by a deadline outside the implement
phase, or a crashed run — teardown SHALL terminate it with the same group-kill
mechanism, fire-and-forget, never blocking teardown, and SHALL then reap what
remains, so no live credentialed CLI process outlives the job (the opencode route's
teardown kills its server; parity, not a new stop). Token totals SHALL
be read from the `result` line(s) received before any teardown — summing or taking
last as the recorded usage shape dictates — so a turn that delivered a `result` line
before its stop still reaches the per-issue token budget (a turn stopped before any
`result` line has no usage carrier on this route; the under-count is a recorded
design risk).

#### Scenario: Abort kills the group, children included

- **WHEN** a turn is stopped while the CLI and a Bash tool child are running
- **THEN** the stop signal is delivered to the CLI's whole process group, and no tool child is left running, reparented to init

#### Scenario: A refused kill is reported, not assumed

- **WHEN** the group kill does not land — the process already gone, or the signal refused
- **THEN** the stop reports that it did not land to its caller, which must not stage a working tree whose writer may still be running

#### Scenario: Spend is read before teardown

- **WHEN** a turn is stopped after its `result` line arrived
- **THEN** the token total recorded for the budget is the one that result line reported, read before any process teardown

#### Scenario: An abandoned child is terminated at teardown

- **WHEN** a turn deadline abandons the CLI outside the implement phase, and the run reaches teardown with the process group still alive
- **THEN** teardown terminates the group with the same kill mechanism, fire-and-forget and without fencing any salvage on it, and no live CLI process outlives the job

### Requirement: Spend reporting degrades to zero and the budget stays on tokens

The session's token total SHALL reflect the usage the CLI's `result` lines report,
including every completed turn of the job. When no result line has been seen or the
usage shape is not recognized, the total SHALL degrade to `0` with a `warn` and SHALL
NOT fail the phase. The per-issue budget SHALL gate on tokens only; the
`total_cost_usd` figure the CLI reports SHALL never be used as a budget, ceiling or
stop condition.

#### Scenario: Missing usage degrades to zero

- **WHEN** a turn's usage is absent or undecodable and the budget asks the session for its total
- **THEN** the session reports `0`, logs at `warn`, and the phase proceeds rather than failing

#### Scenario: Cost never gates

- **WHEN** a `result` line reports a non-zero `total_cost_usd`
- **THEN** no budget check, stop decision or refusal on this route considers it

### Requirement: Public progress carries names, statuses and counts only

Progress derived from the stream SHALL keep the workspace rule: the public Actions log
carries tool names, line types, statuses and counts only; assistant text, tool input
and tool output content go to the encrypted transcript alone, redacted by credential
value before they reach it.

#### Scenario: Content stays out of the public log

- **WHEN** a turn emits assistant text and tool activity
- **THEN** the public log rows for that turn carry tool names and counts only, and the text and tool content appear only in the encrypted transcript

#### Scenario: A quoted credential is redacted

- **WHEN** stream content bound for the transcript contains a pipeline credential value
- **THEN** the transcript receives a redaction placeholder in its place

### Requirement: The workflow installs a pinned CLI only when the backend is selected

The agent workflow SHALL install the `claude` CLI at one pinned exact version before
the pipeline step, only when the claude backend is selected for the run; on the default
route no install step runs. The pipeline step SHALL forward `ANTHROPIC_API_KEY` and
`CLAUDE_CODE_OAUTH_TOKEN` into its environment only on the claude route, and
`LLM_API_KEY` / `LLM_BASE_URL` only on the opencode route, so neither route's
environment carries the other route's credential. Beyond the install gate and those
forwarding gates, nothing in the workflow, the phase cascade or the state machine
SHALL differ between the two backends.

#### Scenario: Selected backend gets the pinned install

- **WHEN** a run selects `AGENT_BACKEND=claude`
- **THEN** the workflow installs the pinned `claude` CLI version before the pipeline step, and the pipeline finds the binary on its path

#### Scenario: Default route installs nothing new

- **WHEN** a run leaves `AGENT_BACKEND` at its default
- **THEN** the workflow performs no `claude` install and is otherwise identical to the pre-change workflow

#### Scenario: The version is pinned, not floating

- **WHEN** the install step names the CLI version
- **THEN** it pins one exact version — no floating tag and no `latest` — so any two runners execute the same binary

#### Scenario: Credentials are forwarded only to their own backend

- **WHEN** the workflow runs the pipeline step on either backend
- **THEN** the Anthropic credential variables reach the step's environment only on the claude route, and the gateway credential variables only on the opencode route

### Requirement: No papai runtime or scope-model side effects

The claude backend SHALL remain repository-scoped Actions configuration: it SHALL NOT
create or mutate papai platform instances, task instances, storage or config context
ids, `tool_prefs`, or any SQLite state, and SHALL NOT change how any chat platform
instance, guest user, or unconfigured (null) task instance is handled anywhere in
papai.

#### Scenario: Papai scope unchanged

- **WHEN** any number of jobs run with the claude backend selected
- **THEN** no papai database row, context id, or permission entry differs from the same jobs run on the default backend
