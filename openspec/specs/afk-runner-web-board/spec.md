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

Selecting a run SHALL render its detail: the pipeline position, the per-round history with raised and open finding counts, the per-task walk with attempt counts for armed runs and — when the log carries it — each item's text, a live event feed whose task lines carry the event's bounded detail when present (an item's text on started, the recorded tail on failed), per-stage spend accounting, and — for a pending gate — the gate file rendered read-only. The agent todos panel SHALL name any implementer whose spawn completed without emitting todos, alongside its last-snapshot entries. The detail view SHALL offer no action that settles, steers, or mutates the run.

The event feed SHALL be tiered: signal events (stage, round, gate, findings, tasks, spawns, completions, convergence) render one line each with their distinguishing data (tool and argument for tool use, role and model for spawns, finding class and detail, model and usage for completions); agent-activity events (tool use) render collapsed into per-agent strips carrying the agent's live usage ticker, its most recent tool call, its model, and its transcript path; waiter-heartbeat events (`auto_decision` reporting a still-pending decision) SHALL be excluded from the feed before its bound is applied, so a heartbeat flood cannot shrink the feed. The feed's bound SHALL apply to rendered feed content, and earlier events SHALL remain reachable through history pagination. An in-flight agent's strip SHALL collapse into its completion's signal line once the agent finishes.

#### Scenario: Detail shows the gate waiting

- **WHEN** the operator opens a gate-pending run's detail
- **THEN** the rendered gate file's content is shown read-only alongside the resume pointer

#### Scenario: Detail shows round convergence

- **WHEN** the operator opens a run that closed two review rounds
- **THEN** the detail shows both rounds with their raised and open counts

#### Scenario: Signal lines carry their distinguishing data

- **WHEN** the feed renders a spawn, a filed finding, and a completion
- **THEN** each line names its subject — the spawn its role and model, the finding its class and detail, the completion its model and usage — not just its event type

#### Scenario: A heartbeat flood cannot shrink the feed

- **WHEN** a run's log contains thousands of still-pending auto-decision heartbeats between signal events
- **THEN** the feed's bounded window still contains signal events, the heartbeats excluded before the bound is applied

#### Scenario: Walk rows name their items

- **WHEN** the operator opens an armed run whose started events carry item text
- **THEN** each walk row renders the item's identifier with its text, and a run whose events carry no text renders identifier-only rows exactly as before

#### Scenario: Feed task lines carry detail

- **WHEN** the recent-events feed renders a started or failed task event carrying detail
- **THEN** the line includes the bounded detail beside the identifier

#### Scenario: Todos panel names a non-emitting implementer

- **WHEN** an armed run's log carries a `todos_missing` event for an implementer label
- **THEN** the todos panel renders that label with a no-todos-emitted note, without presenting runner-synthesized todo content

### Requirement: Spend rendering is tokens-first with honest cost bounds

Wherever the board renders spend — portfolio totals, run cards, run detail, per-stage accounting, agent strips — it SHALL derive spend from the run's per-step usage deltas (`step_finish` events) summed over the whole log, and cost as a lower bound, naming the count of runs whose spend could not be priced, never presenting unpriced cost as complete. Delta-derived spend SHALL include usage consumed by attempts that ended without a usage-aggregate event (killed turns, validation-retry discards), so a run's rendered spend SHALL NOT drop or undercount real consumption relative to its delta stream. Spend SHALL refresh at the board's normal change-detection cadence — a connected client sees a running run's spend move as steps finish, without waiting for an agent's completion event. Cost SHALL be treated as unknown when any contributing delta carries tokens with a zero cost.

#### Scenario: Unpriced run renders honestly

- **WHEN** the portfolio holds a run whose cost cannot be priced
- **THEN** that run's spend renders its token total with cost marked unavailable, and the portfolio totals carry the unpriced count

#### Scenario: Killed-turn spend stays counted

- **WHEN** a run's agent consumed usage reported through step-finish deltas and was then killed, its continuation reporting only post-continuation usage in its completion event
- **THEN** the board's spend for that run includes both the killed turns' and the continuation's usage

#### Scenario: Spend moves while an agent is in flight

- **WHEN** a connected client views a running run and the run appends a step-finish delta
- **THEN** the run's rendered spend reflects the delta on the next change detection, before any agent completion event exists

#### Scenario: Clean runs render the same total as before

- **WHEN** every agent of a completed run finished cleanly (each step delta covered by a completion event's aggregate)
- **THEN** the delta-derived total equals the completion-aggregate total for that run

### Requirement: Event history pagination below the live window

The board SHALL serve a run's events below the live feed window through a paginated read-only route keyed by sequence number, and the detail view SHALL offer an affordance to load earlier events from it. Because the event log is append-only, pages entirely below the tail SHALL be immutable between fetches. The route SHALL sit behind the same token gate as every other route and SHALL tolerate a torn final log line the same way the fold does.

#### Scenario: Loading earlier events

- **WHEN** the operator activates the load-earlier affordance on a run whose log is longer than the live window
- **THEN** earlier events render above the live window, fetched through the pagination route

#### Scenario: Earlier pages are stable while the run lives

- **WHEN** the same earlier page is fetched twice while the run appends new events
- **THEN** both fetches return identical content

### Requirement: Per-stage spend accounting in run detail

Run detail SHALL render, per pipeline stage the run has entered, that stage's wall-clock duration, token total, and cost lower bound, derived from stage-entry/exit timestamps and the same delta-based spend attribution as the run totals. Re-entries of the same stage SHALL be summed into that stage's row, and the in-flight stage's wall SHALL be measured from its latest entry to render time.

#### Scenario: Completed stages account their consumption

- **WHEN** a run has entered and exited intake, draft, and one review round before opening detail
- **THEN** each of those stages renders its own wall duration, token total, and cost

#### Scenario: The active stage's wall runs live

- **WHEN** detail is opened while a stage is in flight
- **THEN** that stage's row shows duration measured from its latest entry to the render time, growing on later refreshes

### Requirement: The open detail stays live

While a run's detail view is open, receiving an SSE portfolio snapshot SHALL re-fetch the selected run's detail within a bounded time, so every detail field — not only todo telemetry — stays current without user action. Re-fetches SHALL be throttled so a burst of snapshots cannot flood the server. The portfolio-over-SSE doctrine is unchanged: the snapshot payload stays the portfolio projection.

#### Scenario: Todo update reaches the open detail

- **WHEN** the operator has a run's detail open and the running agent appends an `agent_todos` event
- **THEN** the panel shows the new list within the sweep-and-fetch cadence, without any user action

#### Scenario: Snapshot burst does not flood the server

- **WHEN** several sweep cycles fire while the detail is open
- **THEN** detail re-fetches are bounded by the throttle, not one per snapshot

#### Scenario: Other detail fields stay current too

- **WHEN** a running agent's tool activity, spend, or position changes while a detail view is open
- **THEN** the re-fetched detail reflects those changes with the same cadence — the liveness is the detail view's, not the todo panel's
