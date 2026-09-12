# sdd-runner-durability spec

## Purpose

Defines stop-anywhere, resume-anywhere durability for sdd-runner runs: opencode session capture and exact-state restore, per-attempt transcripts, and boundary-honoring stops.

## ADDED Requirements

### Requirement: Session ledger records every spawn

The runner SHALL append one ledger line per agent spawn attempt to the run's session ledger (`sessions.jsonl`), capturing the opencode session id as soon as it appears in that agent's event stream, plus the spawn's role, round, attempt, model, and final status. A crash mid-agent SHALL still leave the session id on disk.

#### Scenario: Id recorded before the agent completes

- **WHEN** an agent spawn emits its first session-bearing event line
- **THEN** a ledger line exists on disk containing that session id before the spawn's outcome is known

#### Scenario: Killed spawn is marked

- **WHEN** a spawn is killed before producing its artifact
- **THEN** its ledger line records the killed status, leaving the session id available for resume

### Requirement: Transcripts stored per attempt

The runner SHALL store each agent spawn attempt's raw event stream as a transcript file under the run's `transcripts/` directory, named to correlate with its session-ledger line (same agent label, round, and attempt key).

#### Scenario: Transcript correlates with its ledger line

- **WHEN** an investigator reads a session-ledger line
- **THEN** a transcript file exists whose name is derivable from that line's label, round, and attempt

### Requirement: Interrupted runs resume at the finest available grain

Resume SHALL resolve in order: completed stage artifacts (continue past them without re-running agents), a recorded in-flight agent session (continue that agent from its exact context via the stored session id), then stage-boundary re-spawn from rebuilt prompts when no session is usable. The runner SHALL report which path a resume took.

#### Scenario: Complete artifact skips the agent

- **WHEN** a stage's artifact is complete despite the interruption
- **THEN** resume continues past that stage without spawning any agent for it

#### Scenario: In-flight agent continues its session

- **WHEN** an agent was interrupted mid-spawn and its session id is recorded
- **THEN** resume continues that agent from its exact prior context and the run reports the session-continuation path

#### Scenario: Pre-change run falls back to rebuild

- **WHEN** an interrupted run predates session capture
- **THEN** resume re-enters at the stage boundary with a rebuilt prompt and reports the fallback path

### Requirement: Session resume failure degrades, never worsens

When a recorded session cannot be continued — missing, pruned, or rejected by the provider — the runner SHALL fall back to the stage-boundary re-spawn and record the fallback. A resume SHALL never corrupt or discard existing run artifacts.

#### Scenario: Pruned session falls back safely

- **WHEN** session continuation fails on a resumed run
- **THEN** the affected stage re-spawns from a rebuilt prompt and all prior artifacts and logs remain intact

### Requirement: Resumed spend counts toward budget

Tokens and cost spent by a session continuation SHALL flow through the same usage accounting and budget guard as fresh spawns.

#### Scenario: Resume toward budget gates like a fresh round

- **WHEN** continuing an interrupted session would reach or exceed the configured budget
- **THEN** the run gates exactly as an over-budget fresh round would

### Requirement: Calm stop is durable and boundary-honoring

A stop request — the TUI stop key or the `stop` verb from another process via a marker file — SHALL be honored at the next stage or round boundary: in-flight agents run to completion, artifacts and the event log stay consistent, and the run records a stopped-but-resumable status.

#### Scenario: Stop between rounds keeps everything consistent

- **WHEN** a stop request lands while round 2 of 3 is running
- **THEN** round 2 completes, its artifacts and events are recorded, and the run stops with resumable state before round 3

#### Scenario: Stop from another process

- **WHEN** `sdd stop <run-id>` is run in another terminal while the run is active
- **THEN** the run observes the request at its next boundary and stops calmly

### Requirement: Completed-run output points at raw evidence

The output for a completed run SHALL list the run's transcript directory and session ledger so an investigator can locate raw agent evidence without prior knowledge of the run directory layout.

#### Scenario: Report footer names the evidence

- **WHEN** a completed run's report is printed
- **THEN** it names the `transcripts/` directory and `sessions.jsonl` ledger with their paths
