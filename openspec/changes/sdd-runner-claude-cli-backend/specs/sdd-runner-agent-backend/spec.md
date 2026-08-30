## Purpose

Lets an sdd-runner run drive the official Claude Code CLI for every stage role instead of `opencode run` subprocesses, behind one run-wide config selection: headless invocations with per-role tool allowlists, spelling-selected credential profiles, run-scoped CLI state outside the checkout, and stream decoding into the runner's existing event, usage, budget and session-ledger plumbing.

## ADDED Requirements

### Requirement: One run-wide backend selection serves every stage role

The backend named at config load SHALL serve every stage agent of the run — drafter, reviewer, skeptic, resolver, estimator, decomposer, atomicity and planner — with no per-role, per-stage or per-round override and no mid-run switch. On the `opencode` route, whether named or defaulted, the runner SHALL behave exactly as before this change: the same argv array and the same child environment for every spawn, no Anthropic credential read, no credential guard evaluated, no run-scoped CLI configuration directory created, and no `claude` process spawned. On the `claude` route every stage spawn SHALL invoke the pinned `claude` CLI and no `opencode` process SHALL be spawned for any role of that run. A stage failure SHALL NOT cause a silent fallback onto the other route.

#### Scenario: Default route is byte-identical

- **WHEN** a run loads a config that names no backend
- **THEN** every stage spawn's argv array and child environment are identical to the pre-change runner's, no `claude` process is spawned, no Anthropic credential is read, and no run-scoped CLI configuration directory is created

#### Scenario: Claude selection serves every stage role

- **WHEN** a run loads a config selecting the claude route
- **THEN** the drafter, reviewer, skeptic, resolver, estimator, decomposer, atomicity and planner spawns all invoke the claude CLI, and no `opencode` process is spawned for any role of that run

#### Scenario: The route is fixed for the whole run

- **WHEN** a claude-route stage spawn fails, or the run continues into later stages after a gate decision
- **THEN** every subsequent spawn is still composed on the claude route, and no stage falls back to an `opencode` invocation

### Requirement: Stage roles run headless under per-role tool allowlists

Every claude stage invocation SHALL run headless with streaming event output, `--permission-mode default`, the prompt delivered on the child's stdin rather than in any argv entry, and an explicit closed `--allowedTools` allowlist chosen by the stage's role. No allowlist SHALL contain a wildcard tool entry and no invocation SHALL carry a blanket permission bypass. The roles that materialize OpenSpec artifacts under the change directory — drafter, resolver, decomposer and atomicity — SHALL receive file-writing and file-editing tools alongside the reading tools. The analysis roles — reviewer, skeptic, estimator and planner — SHALL receive the reading tools plus a scratch-scoped write for their own JSON output and no artifact-wide write. No sdd-runner stage role SHALL receive command execution: the runner, never the agent, runs strict validation and every other command a stage depends on. Role recognition SHALL match the labels the runner actually emits, including their artifact and round suffixes (`drafter-<artifact-id>`, `resolver-r<n>`, `reviewer-r<n>`, `skeptic-r<n>`). A label the mapping does not name SHALL inherit the weakest analysis allowlist, never a broader one, and the condition SHALL be visible in the run's log. Extending the mapping to the runner's labels SHALL leave the allowlist answers for the review loop's own labels unchanged.

#### Scenario: Artifact-writing roles can write artifacts

- **WHEN** a `drafter-<artifact-id>`, `resolver-r<n>`, `decomposer` or `atomicity` stage spawns on the claude route
- **THEN** its invocation carries an allowlist including file-writing and file-editing tools alongside the reading tools

#### Scenario: Analysis roles cannot write artifacts

- **WHEN** a `reviewer-r<n>`, `skeptic-r<n>`, `estimator` or `planner` stage spawns on the claude route
- **THEN** its invocation carries the reading tools and a write confined to its scratch output path, and no artifact-wide write

#### Scenario: No stage role can execute commands

- **WHEN** any sdd-runner stage invocation is composed, under any role, round or attempt
- **THEN** its allowlist names no command-execution tool, and the strict validation that follows decomposition and atomicity is run by the runner rather than by the agent

#### Scenario: Suffixed labels resolve to their role

- **WHEN** the labels `drafter-proposal` and `resolver-r3` are mapped to allowlists
- **THEN** each resolves to its role's artifact-writing allowlist rather than falling through to the weakest analysis set

#### Scenario: An unmapped label degrades to the weakest allowlist

- **WHEN** a label the mapping does not name is invoked
- **THEN** it runs with the most restricted analysis allowlist, and the condition appears in the run's log

#### Scenario: Review-loop labels keep their existing answers

- **WHEN** the review loop's own labels are mapped after the runner's labels are added
- **THEN** each receives exactly the allowlist it received before the mapping was extended

#### Scenario: The prompt rides stdin and permission is never bypassed

- **WHEN** a claude stage subprocess spawns
- **THEN** the composed prompt is written to the child's stdin, no argv entry carries it, and the arguments contain no blanket permission-bypass flag

### Requirement: The credential guard runs before any run directory or model spend

On the claude route the runner SHALL resolve the credential environment at startup — after config load, before the run directory is created, before any stage prompt is built and before any model spend — through the same guard the review loop uses, so the accepted spellings and their invocation profiles are inherited rather than restated by the runner. A rejected credential environment — both Anthropic spellings set, neither set, or a conflicting gateway credential set — SHALL fail the run with that guard's code-prefixed selection error, distinguishable from other startup failures and naming the variables involved. `ANTHROPIC_API_KEY` alone SHALL select the bare invocation profile and `CLAUDE_CODE_OAUTH_TOKEN` alone the native profile; only the spelling the selected profile claims SHALL cross into a stage child's environment. The child environment SHALL be the credential's only carrier: no credential value SHALL appear in the run's events, live output, transcripts, session ledger, gate files or report, no credential SHALL be written to disk in any form — the runner materializes no credential file, so it holds no at-rest copy — and no credential SHALL persist between runs. Content a writing role itself authors into a repository file is the recorded residual of granting that role write access, not a runner-authored leak.

#### Scenario: The API key alone runs the bare profile

- **WHEN** a claude-route run starts with `ANTHROPIC_API_KEY` set and the OAuth spelling unset
- **THEN** every stage invocation runs the bare profile and the child environment carries exactly that one credential

#### Scenario: The OAuth token alone runs the native profile

- **WHEN** a claude-route run starts with `CLAUDE_CODE_OAUTH_TOKEN` set and the API-key spelling unset
- **THEN** every stage invocation runs the native profile and the child environment carries exactly that one credential

#### Scenario: A rejected credential environment fails before any run directory

- **WHEN** a claude-route run starts with both Anthropic spellings set, with neither set, or with a conflicting gateway credential set
- **THEN** the run fails with the guard's code-prefixed selection error naming the variables, before the run directory is created, before any stage spawns and before any model spend

#### Scenario: A mismatched spelling injects nothing

- **WHEN** the selected profile is one spelling and the only credential value present carries the other
- **THEN** no credential reaches the stage child's environment, rather than the other spelling crossing

#### Scenario: Credentials never reach runner-authored records

- **WHEN** a claude-route run completes and its events, live output, transcripts, session ledger, gate files and report are inspected
- **THEN** no credential value appears in any of them, and no credential file was written anywhere on disk

#### Scenario: The accepted spelling set is inherited, not restated

- **WHEN** the shared guard narrows or widens the credential spellings it accepts
- **THEN** the runner accepts and refuses exactly what the guard decides, holding no second spelling list of its own

### Requirement: CLI state is run-scoped and lives outside the checkout

On the claude route the runner SHALL point the CLI's configuration directory at a run-scoped directory created under the operating system's temporary root, never inside the configured repository root or working directory, so CLI session and configuration state never crosses runs and nothing the runner or a stage commits can stage it. The directory SHALL be removed on a best-effort basis at run teardown; a failure to remove it SHALL NOT fail the run or change its exit status.

#### Scenario: CLI state lives outside the repository

- **WHEN** a claude-route run spawns its stages
- **THEN** the CLI configuration directory it created is under the temporary root and is inside neither the repository root nor the working directory

#### Scenario: CLI state dies with the run

- **WHEN** a claude-route run tears down and a later run starts
- **THEN** the previous run's CLI configuration directory has been removed and the later run begins with no CLI state carried over from it

#### Scenario: A failed cleanup does not fail the run

- **WHEN** removing the run-scoped CLI configuration directory fails at teardown
- **THEN** the run's outcome and exit status are unchanged and the failure is reported without being escalated

#### Scenario: No commit can stage CLI state

- **WHEN** a stage writes artifacts and the runner's working-tree handling stages them
- **THEN** no CLI session or configuration file is among the staged paths, because that state lives outside the checkout

### Requirement: Claude usage and cost feed the runner's existing spend accounting

A claude-route stage turn's token usage SHALL be counted exactly once, from that turn's terminal result event, with input, output, cache-read and cache-write counts kept as separate buckets exactly as on the opencode route, and its cost SHALL flow into the run's cost ledger, the budget ceiling the decision ladder checks, and the gate's cost digest. The configured model SHALL keep its provider-prefixed spelling in config on both routes so the runner's price lookup resolves; stripping the prefix is a route-local argv concern and SHALL NOT rewrite the configured value. A turn whose spend cannot be priced SHALL be treated by the decision ladder as unknown spend, never as zero. A turn that exits successfully with no decodable result event, or with one signalling an error, SHALL fail that stage attempt through the runner's existing error path rather than resolve as an empty success. A stage spawn killed before its result event arrives SHALL be recorded as killed in the session ledger with its token spend uncounted — the under-count carried over from the shared claude route, not a new behavior of this one.

#### Scenario: A turn's spend reaches the ledger, ceiling and digest once

- **WHEN** a claude-route stage turn completes and emits its result event
- **THEN** its input, output, cache-read and cache-write counts and its cost enter the run's cost ledger exactly once, and the same figures are what the budget ceiling and the gate cost digest report

#### Scenario: The configured model keeps its provider prefix

- **WHEN** the configured model carries a provider prefix and a claude-route stage spawns
- **THEN** the price lookup resolves against the prefixed id from config while the invocation receives the model id without the prefix

#### Scenario: Unpriceable spend gates instead of reading as free

- **WHEN** a claude-route turn's spend cannot be priced
- **THEN** the decision ladder treats the run's spend as unknown and presents the gate rather than counting the turn as zero cost

#### Scenario: A missing or error-signalling result fails the attempt

- **WHEN** a claude-route stage turn exits successfully with no decodable result event, or with one signalling an error
- **THEN** the stage attempt fails through the runner's existing error path and never resolves as an empty success

#### Scenario: A killed turn is recorded as killed with uncounted spend

- **WHEN** a claude-route stage spawn is killed before its result event arrives
- **THEN** its session-ledger line records the killed status and no partial token spend is added to the run's totals

### Requirement: Session continuation takes the rebuild path on the claude route

The resume path SHALL NOT compose an opencode-shaped continuation argument on the claude route, and SHALL NOT fail a stage with an argument-composition refusal. Because every claude spawn's CLI state directory is created fresh for that spawn and removed with the run, no earlier turn's session is addressable by a later process, so a recorded session id SHALL NOT be offered to the claude CLI. A claude-route resume that finds a recorded session id for an interrupted stage SHALL take the runner's existing stage-boundary rebuild path instead — the same fallback a pruned or provider-rejected session takes today — and SHALL report that fallback path, so an operator can see why the finer grain was not used. The session id SHALL still be recorded in the ledger on both routes, and the opencode route's continuation behavior SHALL be unchanged.

#### Scenario: A claude-route resume rebuilds instead of continuing

- **WHEN** a claude-route run resumes a stage whose session id was recorded before the interruption
- **THEN** the stage re-spawns from a rebuilt prompt, the fallback path is reported, and all prior artifacts and logs remain intact

#### Scenario: An opencode-shaped continuation is never composed

- **WHEN** a continuation is requested on the claude route
- **THEN** the composed invocation carries no opencode-shaped session argument, and no stage fails with an argument-composition error

#### Scenario: The opencode route still continues its sessions

- **WHEN** an opencode-route run resumes a stage whose session id was recorded before the interruption
- **THEN** that agent is continued from its exact prior context and the run reports the session-continuation path

### Requirement: Everything outside the spawn seam is backend-agnostic

Gate presentation and decisions, the decision ladder and its budget ceiling, the validation retries that follow decomposition and atomicity, working-tree guarding, calm stop, the interactive terminal surface, and the frozen non-TTY byte contract SHALL behave identically on both routes. Stage output exchange SHALL stay file-based on both routes: the prompt names the scratch path, the output is read from that path and validated against the stage's schema, and a missing output is diagnosed identically. Claude stage subprocesses SHALL be bounded by the same wall-clock timeout and inactivity watchdog with the same retry semantics as opencode ones, and no backend-specific retry layer SHALL sit on top of them — the absence of such a layer on the claude route is carried over deliberately.

#### Scenario: The non-TTY byte contract does not vary by route

- **WHEN** the same run shape executes once on each route on a non-interactive stream
- **THEN** the emitted lines match the frozen byte contract on both, differing only where a route-specific failure is being reported

#### Scenario: A misplaced stage output gets the same diagnosis

- **WHEN** a claude-route stage exits successfully without writing the scratch path its prompt named
- **THEN** the failure names the expected path and reports any misplaced scratch file found, exactly as on the opencode route

#### Scenario: Watchdogs and retry semantics are unchanged

- **WHEN** a claude-route stage subprocess stalls without output or overruns its wall-clock timeout
- **THEN** it is killed and reported exactly as an opencode stage subprocess would be, with no backend-specific retry layer wrapping it

#### Scenario: Gate, budget and terminal surfaces are unchanged

- **WHEN** a claude-route run reaches an early or final gate
- **THEN** the gate file, the decision ladder's evaluation against the budget, and the interactive screens behave exactly as on the opencode route

### Requirement: No papai runtime or scope-model side effects

The backend selection SHALL live inside sdd-runner's subprocess boundary. Selecting or running either route SHALL change no papai runtime, platform-instance, task-instance or config-context surface: no chat tool surface is added or gated, no tool preference (allow, ask or deny) is consulted and no confirmation flow is introduced, no thread-scoped or group-shared configuration is read or written, and a guest-mode toolset or an unconfigured (null) task instance is unaffected — the runner is a local maintainer tool with no platform-instance binding, on either route. The runner SHALL consume the review loop's existing backend composition seam rather than duplicating it. The runner SHALL require no continuous-integration workflow of its own for the claude route: operators install the pinned CLI themselves, and the runner's example configuration SHALL document the backend key with its two values, the two credential spellings and their invocation profiles, and the route's carried-over trade-offs.

#### Scenario: The runner stays outside the papai runtime

- **WHEN** a claude-route run executes from a maintainer's machine end to end
- **THEN** no platform instance, task instance, thread-scoped or group-shared configuration and no tool-preference record is read or written, and no chat tool surface is added, gated or confirmed

#### Scenario: The composition seam is reused, not copied

- **WHEN** a claude stage invocation is composed
- **THEN** it is produced by the review loop's existing backend composition rather than by a runner-local reimplementation of it

#### Scenario: The configuration surface documents the route

- **WHEN** an operator reads the runner's example configuration and pipeline documentation
- **THEN** they name the backend key and its two values, the two credential spellings with the invocation profile each selects, the requirement that the operator installs the CLI, and the route's carried-over trade-offs
