## Purpose

Governs how the `bun run test` wrapper executes the suite on a local host: picking serial or parallel execution from explicit flags, CI, host load, and core count; scaling the per-test timeout when load demotes the run; disclosing why a mode was chosen; and streaming live child output to non-interactive callers — without changing which tests run or what the persisted report records.

## ADDED Requirements

### Requirement: Execution mode selection considers host load
The wrapper SHALL resolve the execution mode in this precedence order: an explicit `--serial` or `--parallel` flag; then a truthy `CI` environment variable (serial); then host load (serial when the 1-minute load average is at least 0.75 × the available core count); then core count (parallel at 8 or more cores, serial below). A load average that is zero on every sample — platforms without loadavg support, such as Windows — SHALL be treated as an unloaded host.

#### Scenario: Loaded many-core host is demoted to serial
- **WHEN** no explicit mode flag is given, `CI` is unset, the host has 8 or more cores, and the 1-minute load average is at least 0.75 × cores
- **THEN** the suite executes serially rather than one worker process per test file

#### Scenario: Explicit mode overrides load
- **WHEN** `--parallel` is passed explicitly on a host whose 1-minute load average meets the demotion threshold
- **THEN** the run executes in parallel regardless of load

#### Scenario: CI takes precedence over load and core count
- **WHEN** `CI` is truthy and no explicit mode flag is given, on a many-core host under load
- **THEN** the run executes serially

#### Scenario: Idle many-core host stays parallel
- **WHEN** no explicit mode flag is given, `CI` is unset, the host has 8 or more cores, and the 1-minute load average is below the demotion threshold
- **THEN** the run executes in parallel

#### Scenario: Few-core host is serial regardless of load
- **WHEN** no explicit mode flag is given, `CI` is unset, and the host has fewer than 8 cores
- **THEN** the run executes serially

#### Scenario: Zero load average is treated as unloaded
- **WHEN** the platform reports a load average of zero on every sample, the host has 8 or more cores, `CI` is unset, and no explicit mode flag is given
- **THEN** the run executes in parallel

### Requirement: Per-test timeout scales only with load demotion
The wrapper SHALL inject a per-test timeout into the child run: 15000 ms normally, and 30000 ms when the run was demoted to serial by host load. An explicit `--timeout` given on the command line, in either the separated or the `=`-joined form, SHALL take precedence over the injected value. Serial runs that were not load-demoted — serial by explicit flag, by `CI`, or by core count — SHALL keep the 15000 ms default.

#### Scenario: Normal run keeps the default timeout
- **WHEN** a run executes without load demotion and without an explicit `--timeout`
- **THEN** the child receives a per-test timeout of 15000 ms

#### Scenario: Demoted run gets an extended timeout
- **WHEN** a run was demoted to serial by host load and no explicit `--timeout` is given
- **THEN** the child receives a per-test timeout of 30000 ms

#### Scenario: Explicit timeout wins over the injected one
- **WHEN** the command line carries an explicit `--timeout 20000` on a load-demoted run
- **THEN** the child receives 20000 ms and the run is serial

#### Scenario: Non-load serial keeps the default timeout
- **WHEN** a run is serial because of an explicit `--serial`, a truthy `CI`, or a low core count, on an idle host
- **THEN** the child receives a per-test timeout of 15000 ms

### Requirement: Run summary discloses mode and load demotion
The summary the wrapper prints at the end of a run SHALL name the selected execution mode, and a run demoted to serial by host load SHALL be marked as load-demoted in that summary (for example `serial · load`), so a caller can distinguish load demotion from serial chosen by flag, `CI`, or core count.

#### Scenario: Demoted run is marked as load-demoted
- **WHEN** a run was demoted to serial by host load
- **THEN** the summary line presents the mode as `serial · load`

#### Scenario: Non-demoted runs show a plain mode
- **WHEN** a run is parallel, or serial by explicit flag, `CI`, or core count
- **THEN** the summary line presents the mode without any load marker

### Requirement: Live child output on non-interactive stdout
The wrapper SHALL mirror the child's combined stdout/stderr live, while the child is still running, whenever the wrapper's own stdout is not a TTY (pipes and non-interactive agent shells). When stdout is a TTY, the wrapper SHALL mirror nothing and print only the summary, unless `--stream` is passed. Interactive bypass runs (`--watch`, `-u`, `--update-snapshots`) SHALL keep inheriting the terminal directly regardless of TTY detection. Streaming SHALL NOT change persistence: the captured log stays byte-complete and correctly interleaved, the report artifacts are written, and the exit code remains the child's own.

#### Scenario: Piped run shows live progress
- **WHEN** `bun run test` runs with its stdout piped to a non-TTY consumer
- **THEN** child output reaches the consumer while the run is in progress, not only after it finishes

#### Scenario: Interactive terminal stays quiet by default
- **WHEN** the wrapper's stdout is a TTY and `--stream` is not passed
- **THEN** no child output is mirrored and the run ends with its summary

#### Scenario: Interactive terminal can opt into streaming
- **WHEN** the wrapper's stdout is a TTY and `--stream` is passed
- **THEN** child output is mirrored live

#### Scenario: Streamed run persists identically
- **WHEN** the same suite runs streamed and non-streamed
- **THEN** both runs produce the same persisted log, JUnit, report JSON, and exit code

#### Scenario: Killed run leaves readable partial evidence
- **WHEN** the wrapper is killed before the child finishes, for example by a shell timeout
- **THEN** the caller has already received the output produced before the kill, and the persisted log file contains everything the child wrote up to that point

#### Scenario: Watch runs keep the terminal
- **WHEN** a bypass run is started with `--watch` or `-u`
- **THEN** the child inherits the terminal's stdio directly and no report is persisted

### Requirement: Load-awareness preserves the run contract
Mode demotion, timeout scaling, and the streaming default SHALL NOT change what a run executes or how it is judged: a full run SHALL execute the same set of test files under serial and parallel alike, the coverage floor SHALL continue to gate the same, the exit code SHALL remain the child's own, and the persisted artifacts under `reports/test/` SHALL keep answering the query commands (`test:status`, `test:failures`, `test:show`, `test:log`) without a new run.

#### Scenario: Demoted run still writes a queryable report
- **WHEN** a load-demoted full run finishes
- **THEN** `reports/test/last-run.{log,junit.xml,json}` are written and `bun run test:status` answers from them

#### Scenario: Demotion does not drop tests
- **WHEN** the same tree is run once parallel (idle host) and once serial (load-demoted)
- **THEN** both runs execute the same test files and a green suite reports the same totals

#### Scenario: Exit code stays the child's own
- **WHEN** a load-demoted, streamed run's child exits non-zero
- **THEN** the wrapper exits with that same non-zero code

### Requirement: Shared-host guidance for agents
The repository's agent-facing guidance (the run-checks section of `AGENTS.md`, `tests/CLAUDE.md`, and the bun-script semantics in `docs/architecture/commands.md`) SHALL state the rules for running the suite on a shared or loaded host: use `bun run test:affected` in the edit loop and one full suite before finishing; never run two full suites concurrently on one machine, preferring serial execution and a shell timeout budget of at least 20 minutes on a shared host; after a shell-timeout kill, consult the persisted report (`bun run test:status`, `test:log`) before starting any new run; and treat a suspected load-induced flake as a non-regression until the failing file(s) alone are re-run.

#### Scenario: Edit-loop rule is documented
- **WHEN** a coding agent reads the shared-host testing guidance
- **THEN** it is told to use `bun run test:affected` during the edit loop, run the full suite once before finishing, and never run two full suites concurrently on one machine

#### Scenario: Timeout and flake triage rules are documented
- **WHEN** a coding agent reads the shared-host testing guidance after a shell-timeout kill or a suspected load flake
- **THEN** it is told to query the persisted report first (`bun run test:status` / `test:log`) instead of blind-restarting, and to re-run only the failing file(s) before concluding a regression
