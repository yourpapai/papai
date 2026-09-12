## Purpose

The opencode agent's CI job can run with the `codeindex` MCP server
provisioned as a reversible, instrumented experiment: every added behavior
is inert while the `AGENT_MCP_SERVERS` variable is unset, runs that do
enable it produce per-job usage evidence linked to an experiment ledger,
and the keep-or-revert decision is made from that evidence by a human
following the documented procedures.

## ADDED Requirements

### Requirement: Provisioning is gated on the MCP knob

Every workflow step this capability adds to the agent job — sibling
checkout, dependency install, index prebuild, canary query, usage report —
MUST be conditioned on the `AGENT_MCP_SERVERS` declaration naming a
`codeindex` server, read through the same spelling the pipeline forwards
(secret wins over variable). While neither spelling declares `codeindex`,
the job's steps, timing, and pipeline behavior MUST be indistinguishable
from a job before this capability existed.

#### Scenario: codeindex not declared
- **WHEN** neither the `AGENT_MCP_SERVERS` secret nor the variable declares the codeindex server — either spelling unset or empty, or a secret declaring only other servers
- **THEN** no codeindex checkout, install, prebuild, canary, or report step executes, and the pipeline step runs exactly as it did before

#### Scenario: codeindex declared
- **WHEN** `AGENT_MCP_SERVERS` declares the codeindex local server, in the secret or the variable
- **THEN** the agent job provisions the pinned sibling checkout outside the workspace (`../codeindex`, using a token able to read the private sibling repository), installs its dependencies, and prebuilds the index from the base-branch checkout before the pipeline step runs

### Requirement: The index is warm before any model turn

The provisioning MUST complete a full index build before the pipeline step
starts, so MCP queries never answer from an empty database while a
background build catches up. A provisioning failure MUST fail the job
before the pipeline step rather than let model turns run against a cold or
missing index.

#### Scenario: Cold runner
- **WHEN** a job starts on a fresh runner with the variable set
- **THEN** the index build completes (or the job fails visibly) before the pipeline step, and the first MCP query of the run answers from a populated index

### Requirement: A canary proves health at zero model spend

Provisioning MUST end with a canary query against the built index using a
fixed, known query text. The canary MUST fail the provisioning when it
returns no results, and the usage report MUST exclude the canary's known
query text from the model-usage counts.

#### Scenario: Canary succeeds
- **WHEN** the canary query returns at least one symbol
- **THEN** provisioning reports success and the pipeline step proceeds

#### Scenario: Canary fails
- **WHEN** the canary query returns no results
- **THEN** the job fails before any model tokens are spent, with output naming the canary and the likely causes

#### Scenario: Canary excluded from usage
- **WHEN** the usage report counts queries and the canary's fixed query text is present in the query log
- **THEN** that entry is counted as canary, not as model usage, and the report says so

### Requirement: Every instrumented run emits a usage report

After the pipeline step — regardless of its outcome — the agent job MUST
read the codeindex query log and emit a per-job usage summary to the job's
step summary and the job log. The summary MUST include, per MCP tool:
call count, hit rate, median and maximum latency, and error count; plus
the most frequent query texts, the canary exclusion, and the count of
explicit reindex requests. Reading the log MUST be read-only and MUST NOT
require any server process to be alive.

#### Scenario: Model used the tools
- **WHEN** the pipeline ran MCP queries
- **THEN** the step summary shows per-tool counts, hit rates, latencies, errors, and top queries for this job

#### Scenario: No usage
- **WHEN** the model made no codeindex tool calls
- **THEN** the summary still renders, showing zero model usage (plus the canary line), so absence of usage is observable rather than indistinguishable from a missing report

#### Scenario: Pipeline failed
- **WHEN** the pipeline step failed or was cancelled
- **THEN** the usage report still runs and emits whatever the query log holds

### Requirement: The report links the experiment ledger

The usage summary MUST carry a link to the experiment ledger document at
its repository-default-branch URL, so a maintainer reading a run page can
reach the revert, read, decide, and cleanup procedures without leaving the
evidence.

#### Scenario: Link present
- **WHEN** the usage report renders
- **THEN** it contains a resolvable link to `docs/operations/codeindex-ci-experiment.md` on the default branch

### Requirement: The ledger documents the four procedures

The experiment ledger document MUST exist in the repository and MUST
contain: the procedure to revert the experiment (unsetting the
`AGENT_MCP_SERVERS` variable and what that leaves behind), the procedure
for reading the statistics (job step summaries, which jobs matter, the
deeper evidence layers), the decision rubric with explicit keep and revert
criteria, and the procedure for removing the statistics output after a
keep decision (including how to stop query logging entirely). The ledger
MUST also state the exact token-free `AGENT_MCP_SERVERS` declaration to
set.

#### Scenario: Maintainer lands on a run page
- **WHEN** a maintainer follows the report's ledger link
- **THEN** the document explains how to revert, how to read the statistics, how to decide, and how to remove the statistics output after keeping

#### Scenario: Operator enables the experiment
- **WHEN** an operator follows the ledger to start the experiment
- **THEN** it names the exact variable content to set and where to set it, without requiring any commit
