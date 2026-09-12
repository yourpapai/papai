## ADDED Requirements

### Requirement: Run process ownership record

A process actively driving a run SHALL keep an ownership record in the run dir
that identifies the owning process, written before pipeline work starts and
removed when the process exits cleanly. Any process SHALL be able to determine
from the record whether the owning process is still alive; a run with
`running` status and no ownership record (or a record whose process is not
alive) SHALL be considered dead.

#### Scenario: Record follows the run lifecycle

- **WHEN** a process starts or resumes a run
- **THEN** the run dir carries an ownership record naming that process, and a
  clean exit removes it

#### Scenario: Crashed owner leaves a stale record

- **WHEN** the owning process dies without cleaning up
- **THEN** the record remains but its named process is not alive, and the run
  is reported dead

#### Scenario: Legacy run has no record

- **WHEN** a run predates ownership records and its process is gone
- **THEN** the run is considered dead — absence of a record never implies a
  live owner

### Requirement: Liveness-aware stop

The `sdd stop` verb and the session screen's stop key SHALL share one stop
semantic: a live run receives today's calm-stop request, honored at its next
boundary; a dead run settles immediately. Settling SHALL consume any stale
stop-request marker and move the run to the state its progress honestly
supports: a run that died before intake classification (no depth profile, no
stage artifacts) settles as aborted — not resumable; a run that died
mid-pipeline settles as stopped — resumable exactly like a live calm stop. The
stop output SHALL name which happened and the concrete next step.

#### Scenario: Live run calm-stops at the boundary

- **WHEN** stop is requested for a run whose owning process is alive
- **THEN** a calm-stop request is recorded, the run stops at its next boundary
  with consistent artifacts, and the status becomes stopped-resumable

#### Scenario: Dead mid-pipeline run settles resumable

- **WHEN** stop is requested for a dead run that had passed intake
  classification
- **THEN** the run's status becomes stopped without running any pipeline step,
  and the output states the run is resumable

#### Scenario: Dead pre-classification run settles terminal

- **WHEN** stop is requested for a dead run still at the intake stage with no
  depth profile
- **THEN** the run's status becomes aborted, and the output states there is
  nothing to resume and a fresh run starts from a task file

#### Scenario: Stale stop marker is consumed

- **WHEN** a dead run being settled carries an unconsumed stop-request marker
- **THEN** the marker is removed so a later resume of that run does not
  immediately re-stop

#### Scenario: Stopping a non-running run is a no-op

- **WHEN** stop is requested for a run already stopped, aborted, completed, or
  failed
- **THEN** no state changes and the output reports the run's current status

#### Scenario: Session screen stop settles a dead row

- **WHEN** the stop key is pressed on a session-screen row showing a dead run
- **THEN** the shared stop semantic applies, and the row no longer presents as
  active on the next listing
