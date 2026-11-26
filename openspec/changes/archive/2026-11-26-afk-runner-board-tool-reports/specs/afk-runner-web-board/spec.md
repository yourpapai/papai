## MODIFIED Requirements

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

### Requirement: Run-detail view

Selecting a run SHALL render its detail: the pipeline position, the per-round history with raised and open finding counts, the per-task walk with attempt counts for armed runs, a live event feed, per-stage spend accounting, and — for a pending gate — the gate file rendered read-only. The detail view SHALL offer no action that settles, steers, or mutates the run.

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

## ADDED Requirements

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
