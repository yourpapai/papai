<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets a review-loop run spawn the official Claude Code CLI for its four loop roles instead of `opencode run` subprocesses, behind one run-wide config selection: headless invocations with per-role tool allowlists, spelling-selected credential profiles, NDJSON event decoding into the loop's usage accounting, run-scoped CLI state isolation, and the opencode-agent review hand-off that carries the job's backend into the loop.

## ADDED Requirements

### Requirement: Backend selection is one run-wide config knob

The review loop's config SHALL carry a single agent-backend selection with values `opencode` and `claude`, defaulting to `opencode` when absent. The selected backend SHALL serve every agent role of the run — reviewer, fixer, matcher and inspector. The loop SHALL NOT mix backends within one run: a config that names different backends for different roles SHALL fail config validation, as SHALL any value outside the two. The default route SHALL behave byte-identically to the pre-change loop — no `claude` process is spawned and no Anthropic credential is read on it.

#### Scenario: Absent selection keeps the opencode route

- **WHEN** a run loads a config that names no backend
- **THEN** every role subprocess is an `opencode run` invocation composed exactly as before the change, and no `claude` process is spawned

#### Scenario: Claude selection serves every role

- **WHEN** a run loads a config selecting `claude`
- **THEN** reviewer, fixer, matcher and inspector turns all spawn the claude CLI, and no `opencode` process is spawned for any role of that run

#### Scenario: Mixed per-role backends are refused

- **WHEN** a config names one backend for the reviewer and a different one for the fixer
- **THEN** config validation fails before any subprocess starts, naming one backend per run as the rule

#### Scenario: Unknown value fails at config load

- **WHEN** the backend selection holds any value other than `opencode` or `claude`
- **THEN** config validation fails before any subprocess starts, naming the selection

### Requirement: Role invocations run headless with per-role tool allowlists

Every claude role invocation SHALL run in headless print mode with NDJSON streaming output, `--permission-mode default`, and an explicit `--allowedTools` allowlist pinned per role. Allowlists SHALL be closed lists with no wildcard tool entry — no `*`-shaped tool grant — and no invocation SHALL carry a blanket permission bypass; the prohibition is on tool-name wildcards, not on path globs inside a scoped permission rule (the analysis roles' scratch-scoped `Write` path pattern is the mandated form, not a violation of this rule). The fixing role's allowlist SHALL include file editing and command execution; each analysis role's allowlist (reviewer, matcher, inspector) SHALL include neither — an analysis role executes nothing and its write access is confined to its scratch output; the reading tools are granted unscoped (an allowlist confines which tools may run, not which paths they touch), so reads outside the worktree remain possible — a recorded residual, strictly dominated by the fixing role's command-execution grant, and confining reads is a future spec change, not a default of this one. Any role the pinned mapping does not name SHALL inherit the weakest allowlist, never a broader one. A tool outside the invocation's allowlist SHALL NOT execute: `--allowedTools` auto-approves its members and enables nothing, and under headless operation an unlisted tool has no grantor, so the call is refused rather than run.

#### Scenario: Analysis roles cannot edit or execute

- **WHEN** the reviewer, matcher or inspector runs under the claude backend
- **THEN** its invocation carries an allowlist that excludes file-editing and command-execution tools, with `--permission-mode default`

#### Scenario: The fixer gets edit and execute

- **WHEN** the fixer runs under the claude backend
- **THEN** its invocation carries an allowlist including file-editing and command-execution tools alongside reading tools

#### Scenario: An unlisted tool is refused, not run

- **WHEN** an analysis-role turn's prompt attempts a command-execution call, which its allowlist does not name
- **THEN** the call is refused under `--permission-mode default` and produces no tool effect

#### Scenario: Blanket permission is never used

- **WHEN** any claude role invocation is composed, under any role and any budget or stop condition
- **THEN** the arguments never include a blanket permission-bypass flag

#### Scenario: An unnamed role inherits the weakest allowlist

- **WHEN** a role the pinned mapping does not name is invoked
- **THEN** it runs with the most restricted allowlist, and the condition is visible in the run's log

### Requirement: The prompt rides stdin; an oversized system prompt is refused before spawn

The loop SHALL deliver each role's prompt to the claude CLI on the child's stdin, never as a command-line argument, so the prompt is bounded by no operating-system argument cap and is not carried in a process listing. Role instructions appended as the system prompt SHALL ride a single argv entry, and the loop SHALL refuse to compose an invocation whose appended system prompt exceeds the operating system's single-argument byte cap: the role SHALL fail before any process spawns, with an error naming the cap and the remedy, never as a dead-backend classification.

#### Scenario: The prompt arrives on stdin

- **WHEN** a claude role subprocess spawns
- **THEN** the composed prompt is written to the child's stdin and no argv entry carries it

#### Scenario: An oversized system prompt is refused before spawn

- **WHEN** the composed system prompt for a role exceeds the single-argument byte cap
- **THEN** the role fails before any process spawns, with an error naming the byte cap and pointing at the system-prompt component as the one that grew

### Requirement: Credential spelling selects the invocation profile, under an exclusivity guard

When the claude backend is selected, the loop SHALL require exactly one of `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` and SHALL fail the run before any role subprocess spawns and before any model spend when both are set or when neither is (config load may itself have spawned git root detection when a standalone config omits `repoRoot`; the refusal still precedes every role spawn, worktree, install and spend), with a failure distinguishable from other startup failures and naming both variables. A credential variable that is present but empty or whitespace-only SHALL read as unset — continuous-integration forwards unset secrets as the empty string, and a present name SHALL NOT by itself count as set. `ANTHROPIC_API_KEY` alone SHALL select the bare invocation profile; `CLAUDE_CODE_OAUTH_TOKEN` alone SHALL select the native invocation profile. A set `LLM_API_KEY` on the claude backend SHALL be refused. Only the credential spelling the selected profile claims SHALL cross to a child's environment — the other spelling, the gateway endpoint and its credential SHALL NOT — and a credential whose spelling does not match the profile injects nothing, so a mismatched pair can never smuggle the other spelling through. The child environment SHALL be the credential's only carrier into anything the loop itself writes: a credential value SHALL NOT appear in any loop-authored log line, event, config file or run artifact — including indirectly, through logged tool output or captured child stderr — and no credential file SHALL be materialized; the run-scoped CLI state the loop creates lives outside the worktrees, so no commit the loop makes stages loop-created state. Role-authored content is the recorded boundary of that claim, not a failure of it: the fixing role holds both command execution and the credential in its child environment, so text it authors (its result output persisted into run artifacts, the ledger and trace fields carried from it, its decision notes on the loop's stdout) and files it writes in its worktree — which the loop's staging step would commit — can quote the credential; that model-mediated path is part of the fixer residual the design records, uncloseable by any loop-side scrub.

#### Scenario: The API key alone runs the bare profile

- **WHEN** the claude backend runs with `ANTHROPIC_API_KEY` set and `CLAUDE_CODE_OAUTH_TOKEN` unset
- **THEN** every role invocation runs the bare profile, and the child environment carries exactly the API key

#### Scenario: The OAuth token alone runs the native profile

- **WHEN** the claude backend runs with `CLAUDE_CODE_OAUTH_TOKEN` set and `ANTHROPIC_API_KEY` unset
- **THEN** every role invocation runs the native profile, and the child environment carries exactly the OAuth token

#### Scenario: Both set is refused before any spend

- **WHEN** the claude backend starts with both credential variables set
- **THEN** the run fails before any role subprocess spawns or any model spend, naming both variables

#### Scenario: Neither set is refused before any spend

- **WHEN** the claude backend starts with neither credential variable set
- **THEN** the run fails before any role subprocess spawns or any model spend, naming both variables

#### Scenario: A set LLM_API_KEY is refused on the claude backend

- **WHEN** the claude backend runs with `LLM_API_KEY` set
- **THEN** the run is refused, naming the conflicting credential

#### Scenario: A mismatched spelling injects nothing

- **WHEN** the selected profile is bare and the only credential value present carries the OAuth spelling
- **THEN** no credential reaches the child environment, rather than the other spelling crossing

#### Scenario: Credentials never reach loop-authored artifacts or logs

- **WHEN** a claude-backend run completes and the logs, events, config and artifacts the loop itself wrote are inspected
- **THEN** no credential value appears in any of them, including indirectly through logged tool output or captured child stderr

#### Scenario: Role-authored quoting is the recorded residual

- **WHEN** the fixing role's authored output or worktree files quote the credential it could read in its child environment
- **THEN** that carriage is the recorded fixer residual (command execution plus the credential in the child environment), not a loop-authored leak this requirement claims to prevent

### Requirement: Invocations are deterministic and CLI state is run-scoped

Bare invocations SHALL carry `--bare`. Native invocations SHALL carry the neutralization flags on every invocation — empty setting sources, and strict MCP configuration pointed at an empty server document — because either flag alone leaves a discovery surface open. The configured model SHALL be passed explicitly on every invocation; one model knob serves either backend, and a value spelled with a provider prefix keeps its model id. The CLI's config dir (`CLAUDE_CONFIG_DIR`) SHALL be a run-scoped directory under the operating system's temporary root, never inside a worktree or the checkout, so session files and CLI state never cross runs and no commit the loop makes can stage them; it SHALL be removed when the run tears down.

#### Scenario: Native invocations neutralize ambient configuration every time

- **WHEN** the native profile composes any role invocation
- **THEN** the arguments carry the empty setting-sources flag and the strict MCP configuration with an empty server document

#### Scenario: One model knob serves either backend

- **WHEN** the configured model value carries a provider prefix, the form the opencode backend uses
- **THEN** the claude invocation receives the model id with the prefix stripped

#### Scenario: CLI state lives and dies with the run

- **WHEN** a claude-backend run starts, spawns its roles, and tears down
- **THEN** the CLI config dir is created under the temporary root outside the worktrees during the run and removed at teardown, and a later run starts with no CLI state from it

#### Scenario: Loop commits never stage CLI state

- **WHEN** a fixer working in a loop worktree commits its fix
- **THEN** the commit cannot contain CLI session or config state, because that state lives outside the worktree

### Requirement: NDJSON events feed the loop's existing usage accounting

The loop SHALL decode the claude CLI's NDJSON output lines and map them into its existing per-agent accounting: token usage and cost counted once per turn, from the turn's `result` line — input, output, cache-read and cache-write tokens plus USD cost — with cached counters kept separate from uncached input exactly as on the opencode backend. The session id SHALL be taken from the first session-bearing line of a spawn and recorded through the session ledger synchronously, so a crash mid-agent still leaves it on disk. Line shapes SHALL be validated against decoders recorded from the live CLI, never guessed. A line whose shape the decoder does not recognize SHALL be skipped without failing the role. An exit-0 turn whose `result` line is missing or error-signalling SHALL fail that role attempt through the loop's existing error path rather than resolve as an empty success.

#### Scenario: Usage is counted once per turn

- **WHEN** a role's claude turn emits a `result` line and exits 0
- **THEN** the turn's input, output, cache-read and cache-write token counts and its USD cost enter the loop's usage totals exactly once

#### Scenario: The session id reaches the ledger as it arrives

- **WHEN** the first session-bearing line of a spawn arrives
- **THEN** the session id is recorded through the session ledger synchronously, before the spawn completes

#### Scenario: Unrecognized lines degrade

- **WHEN** the stream carries a line whose shape is not recognized
- **THEN** it is skipped and the role proceeds to its normal completion

#### Scenario: A missing or error-signalling result line fails the attempt

- **WHEN** a role's claude turn exits 0 with no decodable `result` line, or with one that signals an error
- **THEN** the role attempt fails through the loop's existing error path and never resolves as an empty success

#### Scenario: Cost and token reporting is identical across backends

- **WHEN** the same run shape executes once on each backend
- **THEN** live lines, run summary and run metrics carry the same usage fields with the same meanings, cache counters never folded into uncached input

### Requirement: Output exchange and spawn guards stay backend-agnostic

A claude role SHALL exchange its result through the same file-based contract as an opencode role: the prompt names the absolute scratch path under the role's working tree, the role's output is read from that path and validated against the role's schema, and a missing output is diagnosed with the same misplaced-scratch hint. Claude role subprocesses SHALL be bounded by the same wall-clock timeout and inactivity watchdog, with the same retry semantics — a stall retried once, a wall-clock timeout never retried — and no backend-specific retry layer SHALL sit on top of them.

#### Scenario: A claude role writes the expected scratch output

- **WHEN** a claude role completes successfully
- **THEN** its JSON output is found at the scratch path the prompt named and is validated against the role's schema like an opencode role's

#### Scenario: A misplaced output gets the same diagnosis

- **WHEN** a claude role exits 0 without writing the expected scratch path
- **THEN** the failure names the expected path and reports any misplaced scratch file found, as for an opencode role

#### Scenario: Watchdogs and retry semantics are unchanged

- **WHEN** a claude role subprocess hangs and produces no output, or overruns its wall-clock timeout
- **THEN** it is killed and reported exactly as an opencode role subprocess would be, with the stall retried once and the wall-clock timeout not retried

### Requirement: The pipeline hands its backend through to the loop

When the opencode-agent pipeline runs its review phase, the generated review-loop config SHALL select the job's backend for the loop's roles, and the environment handed to the loop SHALL match the route: the opencode route carries the OpenCode config content and no Anthropic credential; the claude route carries exactly the job's selected Anthropic credential and no OpenCode config content or gateway settings. On the claude route the review phase SHALL run with no provider proxy and no OpenCode server, and the route-gated CLI install SHALL have placed the `claude` binary where the loop's children find it — so a claude-route job's review phase completes through the loop instead of failing at its own boundary.

#### Scenario: The opencode route is unchanged by the new backend

- **WHEN** a job runs the opencode backend and reaches its review phase
- **THEN** the generated loop config and the loop's environment are byte-identical to what the pre-change pipeline generated, and the loop spawns `opencode` subprocesses

#### Scenario: The claude route configures the loop for claude

- **WHEN** a job runs the claude backend and reaches its review phase
- **THEN** the generated loop config selects the claude backend for the loop's roles, and the loop's environment carries the job's Anthropic credential and no OpenCode config content

#### Scenario: A claude-route review completes

- **WHEN** a claude-route job triggers the review phase against a configured review loop
- **THEN** the loop runs its rounds through claude subprocesses and reports its normal outcome, instead of the phase failing because the loop's children had no model to talk to

#### Scenario: No proxy serves the loop on the claude route

- **WHEN** the claude-route review loop spawns its role subprocesses
- **THEN** no provider proxy is started for them and no OpenCode server is booted, the CLI binary talking to Anthropic directly

### Requirement: No papai runtime or scope-model side effects

The backend SHALL live inside the review-loop workspace's subprocess boundary. Selecting or running either backend SHALL change no papai runtime, platform-instance, task-instance or config-context surface, and the opencode-agent and review-loop workspaces SHALL remain separate — the claude subprocess contract is duplicated across them rather than imported, with any duplicated doctrine pinned equal by a test.

#### Scenario: The loop runs standalone on either backend

- **WHEN** review-loop runs from a laptop or CI with either backend selected, outside any opencode-agent job
- **THEN** it reads its backend and credentials from its own config and environment and needs no papai runtime component

#### Scenario: The workspace boundary stays a subprocess boundary

- **WHEN** the claude backend is implemented in both workspaces
- **THEN** neither workspace imports the other's claude modules, and any text pinned equal between them is asserted equal by a test rather than shared at runtime
