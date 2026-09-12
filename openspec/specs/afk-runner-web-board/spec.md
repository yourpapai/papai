# afk-runner-web-board Specification

## Purpose

A standalone, phone-first web board over the afk-runner work dir: an operator away from the machine sees the run portfolio live — which runs wait for a decision, which are progressing, what they cost — through a read-only server that renders the same event-fold truth the CLI consumes.

## Requirements

### Requirement: Read-only serve verb over the work dir

The `serve` verb SHALL start an HTTP server over the resolved work dir and SHALL be read-only over run artifacts: it SHALL NOT append events, mutate run state, or write files under the work dir. Its file access SHALL go through a seam exposing only read operations, mirroring the `analyze` seam's construction. Serving SHALL tolerate a torn final log line the same way the fold does — as if the in-flight event were absent — and SHALL pick the line up once it is complete.

#### Scenario: Serving leaves the corpus byte-unchanged

- **WHEN** the board has served a work dir containing running, gate-pending, and terminal runs for a period that included new event appends
- **THEN** every run's event log, memo, and gate files are byte-unchanged from before serving began

#### Scenario: Torn tail does not break serving

- **WHEN** a run's log ends in a partially written line at scan time
- **THEN** the board renders the fold of the complete prefix and renders the completed event on a later sweep

### Requirement: Token-gated access

Every served route SHALL require a bearer token. When the operator provides no token, the server SHALL generate a random one at boot and print the board URL carrying it exactly once. The server SHALL bind to the loopback interface by default; listening on a wider interface SHALL require an explicit operator flag.

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request arrives with no token or a wrong token
- **THEN** the server rejects it without revealing run data

#### Scenario: Boot without a token prints the entry URL

- **WHEN** `serve` starts with no token configured
- **THEN** a random token is generated and the ready-to-open board URL containing it is printed once to stdout

### Requirement: Portfolio view sorted by attention

The board's primary view SHALL render one card per run in the work dir, sorted: gate-pending runs first, then running runs, then recently finished runs. A gate-pending card SHALL show the gate mode, the pending age, and the resume pointer. A running card SHALL show the current stage, round over cap, and — for execution-armed runs — the per-task progress line derived from the run's task record (done/total with failed retries named). Spend SHALL render tokens-first with cost as a lower bound, per the cross-run accounting doctrine.

#### Scenario: Gate-pending run leads the board

- **WHEN** the work dir holds one gate-pending run and two running runs
- **THEN** the portfolio renders the gate-pending run first with its gate mode and pending age

#### Scenario: Armed run shows the walk

- **WHEN** a running execution-armed run's task record shows 7 of 12 tasks done with one failed-and-retrying
- **THEN** its card shows the 7/12 progress line naming the retrying task

#### Scenario: Empty work dir renders an empty board

- **WHEN** the work dir contains no runs
- **THEN** the portfolio renders an empty state instead of an error

### Requirement: Live updates push through SSE

The board SHALL push a full portfolio snapshot to connected clients through Server-Sent Events whenever a change is detected. Change detection SHALL sweep run logs' and memos' freshness on a short interval; detection mechanism (polling vs file watching) is an implementation detail. A client connecting SHALL receive the current snapshot immediately.

#### Scenario: Event append reaches a connected phone

- **WHEN** a live run appends an event that changes its fold-derived position and a client is connected
- **THEN** the client receives an updated portfolio snapshot without any user action

#### Scenario: New run appears on the board

- **WHEN** a new run directory is created in the work dir while the board serves
- **THEN** the portfolio grows by that run's card on a later sweep

### Requirement: Run-detail view

Selecting a run SHALL render its detail: the pipeline position, the per-round history with raised and open finding counts, the per-task walk with attempt counts for armed runs, a bounded recent-events feed, and — for a pending gate — the gate file rendered read-only. The detail view SHALL offer no action that settles, steers, or mutates the run.

#### Scenario: Detail shows the gate waiting

- **WHEN** the operator opens a gate-pending run's detail
- **THEN** the rendered gate file's content is shown read-only alongside the resume pointer

#### Scenario: Detail shows round convergence

- **WHEN** the operator opens a run that closed two review rounds
- **THEN** the detail shows both rounds with their raised and open counts

### Requirement: Spend rendering is tokens-first with honest cost bounds

Wherever the board renders spend — portfolio totals, run cards, run detail — it SHALL render token totals first and cost as a lower bound, naming the count of runs whose spend could not be priced, never presenting unpriced cost as complete.

#### Scenario: Unpriced run renders honestly

- **WHEN** the portfolio holds a run whose cost cannot be priced
- **THEN** that run's spend renders its token total with cost marked unavailable, and the portfolio totals carry the unpriced count
