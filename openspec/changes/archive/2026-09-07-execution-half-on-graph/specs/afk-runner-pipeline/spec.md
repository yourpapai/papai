## MODIFIED Requirements

### Requirement: Stage sequence through the tail

The pipeline SHALL drive a run through intake, draft, the review loop, and a
tail — task decomposition, atomicity checking on depth M/L, and a final gate —
and SHALL end every run at a park: `completed` via release-gate approval (on an
execution-armed run) or via final-gate approval (on an unarmed run), or
`aborted` via abort. A depth-S run SHALL skip the atomicity stage, with
decomposition presenting the final gate as its last work act. No completion
path SHALL produce a completed run whose change folder lacks `tasks.md`. On an
execution-armed run, final-gate approval SHALL continue the pipeline into the
execution states — implement, verify, release — before completion.

#### Scenario: Depth-S run skips atomicity

- **WHEN** a run classified depth S converges
- **THEN** the pipeline runs decomposition and presents the final gate without an atomicity stage

#### Scenario: Completed run carries the task list

- **WHEN** any run reaches `completed`
- **THEN** the change directory contains a `tasks.md` produced by the pipeline's decomposition stage

#### Scenario: Armed run continues past the final gate

- **WHEN** an execution-armed run's final gate settles approve
- **THEN** the pipeline enters implement and continues through verify and release rather than completing

### Requirement: Gate decisions disclose their downstream effects

Every gate presentation SHALL state, next to each available decision, what the
pipeline does next if that decision is taken — including that approval at an
early gate continues the pipeline to the tail, that extend runs one more review
round, that approval at the final gate completes the run on an unarmed run and
enters execution (implement, verify, release) on an armed run, and that
approval at a release gate completes the run with the work implemented and
verified.

#### Scenario: Early gate explains approval

- **WHEN** an early gate is presented
- **THEN** its text states that approving continues the pipeline to decomposition and a final gate, and that extending runs one more review round

#### Scenario: Armed final gate names execution

- **WHEN** the final gate of an execution-armed run is presented
- **THEN** its text states that approving begins execution of the task list through implement, verify, and release
