## Purpose

Automates the outer loop of spec-driven development: a runner sub-project orchestrates drafting, fresh-eyes review, convergence, and decomposition across spawned agents inside one OpenSpec change, reporting progress at pipeline altitude and concentrating human attention at a single gate.

## ADDED Requirements

### Requirement: Pipeline stage sequencing and resume

The runner SHALL execute stages in order — intake (depth classification, change scaffolding via `openspec new change`), draft (proposal, specs, design per schema DAG), review loop, decomposition, atomicity check, human gate — and SHALL produce tasks.md only after the review loop has converged or the human has overridden a cap-hit halt. The gate SHALL be enterable at two points: an **early cap-hit presentation** before decomposition (open BLOCKERs with their evidence trails plus assumptions logged so far) and a **final presentation** after the atomicity check (the full digest). An answered or explicitly overridden cap-hit gate SHALL unblock decomposition, and the final presentation SHALL still follow. State SHALL be split: OpenSpec artifacts in the change folder (git truth); run state in a gitignored run dir (`state.json`, `events.ndjson`, JSON sidecars, transcripts). Resume SHALL reconstruct position from `openspec status` plus `state.json`, and renderer state from replaying `events.ndjson`.

#### Scenario: Normal progression

- **WHEN** a run starts from a task description
- **THEN** the change is scaffolded, artifacts are drafted in dependency order, and tasks.md is written only after a converged round is recorded

#### Scenario: Cap-hit early gate

- **WHEN** the review loop reaches its round cap with open BLOCKERs
- **THEN** the runner halts at an early gate presentation before decomposition, and tasks.md is produced only after the human answers or explicitly overrides the blockers

#### Scenario: Resume after interruption

- **WHEN** a run is killed mid-round and restarted with the same run id
- **THEN** the runner derives its stage and round from `state.json` plus artifact existence, replays `events.ndjson` to rebuild the display, and continues without redoing completed stages

### Requirement: Structured progress events

The runner SHALL append every pipeline event to `<runDir>/events.ndjson` in a schema-validated form covering three altitudes: L0 agent telemetry (tool use, token/cost deltas), L1 agent lifecycle (spawned, retrying — with reason: stall or validation —, killed, completed with usage), and L2 pipeline semantics (stage enter/exit, round open/close, finding filed/classified/resolved/dismissed, assumption logged/vetoed/applied, convergence verdict, artifact materialized, depth classified, gate presented/answered, human hand edits detected). The event log SHALL be sufficient to rebuild the rendered view by replay alone.

#### Scenario: Replay reconstruction

- **WHEN** a post-hoc report command runs against a finished run dir
- **THEN** it reproduces the stage map, round burndown, and gate digest from `events.ndjson` without re-reading agent transcripts

#### Scenario: Machine-readable CI output

- **WHEN** the runner executes in a non-TTY environment
- **THEN** it emits line-mode output and the complete semantic record lands in `events.ndjson`

#### Scenario: PR synthesis

- **WHEN** `report <runId> --pr` runs after implementation
- **THEN** it synthesizes an evidence-backed PR body from `events.ndjson`, the change folder, and the branch git log — stating what scrutiny did and did not happen (depth profile and rationale, rounds and findings, gate trajectory, which lenses ran)

### Requirement: Semantic progress rendering

During a run the renderer SHALL show: an always-visible pipeline map with per-stage state (done, active with round k/cap, pending, skipped); one live line per active agent labeled with role and round; a scrolling region of semantic one-liners for L2 events; and a compact convergence burndown row at each round close. Verbosity profiles SHALL control altitude: `brief` (L2 + gate only), `normal` (plus L1 completion footers; default), `debug` (plus L0 tool lines).

#### Scenario: Pipeline position always visible

- **WHEN** any event renders during the run
- **THEN** the pipeline map reflects the current stage and, inside the review loop, the current round and cap

#### Scenario: Round-close burndown

- **WHEN** a review round closes
- **THEN** one line summarizes findings by class, resolutions, dismissals, and the convergence verdict (e.g. `round 2: 0B 0M 1N · 3 resolved · 2 dismissed · converged`)

### Requirement: Reviewer context isolation

Each review round SHALL run in a freshly spawned agent whose prompt is constructed by the runner to contain only: current artifact files read from disk, project conventions, the review rubric, and the resolutions ledger (prior findings with their outcomes: edited, evidence-answered, assumed, dismissed). The runner SHALL NOT place in the reviewer prompt: the original task description, drafter reasoning, prior conversation, the assumptions log, or superseded drafts. Isolation is enforced by process and prompt construction, not by instruction.

#### Scenario: Fresh spawn per round

- **WHEN** review round k starts
- **THEN** a new agent process is spawned with a runner-constructed prompt containing no orchestrator or drafter conversation content

#### Scenario: No drafter anchoring

- **WHEN** the reviewer evaluates a decision the drafter justified only in conversation
- **THEN** the reviewer sees only what the artifacts state, so undocumented rationale surfaces as a finding

### Requirement: Answer-before-ask

Before classifying any finding as BLOCKER, the reviewer SHALL attempt to answer it from the repository (code, `openspec/specs/`, `docs/architecture/`) using read-only access and SHALL record that attempt as `code_evidence_attempted` on the finding. A question answerable from the repo SHALL NOT be raised as a question; it becomes a consistency check between artifact and codebase.

#### Scenario: Self-served question

- **WHEN** the reviewer wonders which scope id keys a piece of state
- **THEN** it reads the scope-model declaration/docs first; if answered, the finding (if any) is a doc-vs-code inconsistency, not a question

#### Scenario: Genuine gap survives

- **WHEN** no code or doc evidence answers the question
- **THEN** the finding is recorded as BLOCKER with an attempted-but-empty evidence trail

### Requirement: Structured findings and resolver separation

Review findings SHALL be emitted as schema-validated JSON records with: class (BLOCKER | MATERIAL | NITPICK), a verbatim `gap` quote from the artifact, the question, the code-evidence attempt, and a resolution field. A separate resolver agent (not the reviewer) SHALL assign final classification and SHALL resolve each finding by exactly one of: editing the artifact, answering from code evidence, logging an assumption, or dismissing with justification. Every resolution — including each dismissal with its justification — SHALL be recorded in a resolutions ledger provided to all later review rounds, since evidence-answered and assumption-resolved findings leave no artifact change and are otherwise invisible to the next fresh reviewer.

#### Scenario: Resolution prevents re-raising

- **WHEN** round k+1's reviewer considers a finding topically identical to one already resolved (edited, evidence-answered, assumed, or dismissed)
- **THEN** the ledger entry instructs it not to re-raise without new evidence

#### Scenario: Evidence required

- **WHEN** a finding lacks a `gap` quote or its quoted gap is answered verbatim elsewhere in the artifacts
- **THEN** the resolver dismisses it as a nitpick with a one-line justification

### Requirement: Objective convergence predicate

The review loop SHALL terminate when a round k ≥ 1 records 0 BLOCKER findings, 0 MATERIAL findings, and at most 3 NITPICK findings. The loop SHALL NOT exceed the depth profile's round cap. Reaching the cap with unresolved BLOCKERs SHALL halt planning at the early gate with the unresolved list — an escalation, not a failure. The predicate SHALL be evaluated by runner code over the round's post-resolution classifications (the schema-validated resolutions JSON, after the resolver has assigned final classes) — never over reviewer-raw findings, never by reviewer declaration, never parsed from markdown.

#### Scenario: Convergence

- **WHEN** round 3's resolutions JSON records 0 BLOCKER, 0 MATERIAL, 1 NITPICK
- **THEN** the loop exits and decomposition proceeds

#### Scenario: Cap-hit escalation

- **WHEN** the round cap is reached with 2 BLOCKERs still open
- **THEN** the runner halts at the gate listing exactly those BLOCKERs and their evidence trails

### Requirement: Runner-materialized loop artifacts

Agents SHALL NOT hand-write `review.md` or `assumptions.md`. Reviewers and resolvers SHALL emit schema-validated JSON sidecars (`findings-<k>.json`, `resolutions-<k>.json`, assumption records) into the run dir; the runner SHALL materialize the markdown artifacts into the change folder in the format the forked schema templates define. The materialized markdown SHALL pass `openspec validate` for the change. Materialized files SHALL carry a GENERATED header stating they are regenerated from sidecars and must not be hand-edited; human changes to their content SHALL flow through the gate file (`gate-<n>.md`) or the sidecars, never through direct edits.

#### Scenario: Markdown as a view

- **WHEN** a resolver finishes a round
- **THEN** the runner regenerates `review.md` and `assumptions.md` from the JSON sidecars, and the change validates

#### Scenario: No format drift

- **WHEN** an agent emits a malformed sidecar
- **THEN** the runner rejects it at schema validation and retries the agent with the validator error, rather than discovering broken markdown later

#### Scenario: Materialization regenerates, never merges

- **WHEN** a materialized file exists and a new round completes
- **THEN** the runner regenerates the file from sidecars wholesale, so any direct edit to it is discarded by construction

### Requirement: Agent lifecycle control

The runner SHALL spawn a fresh agent process per stage and per review round; SHALL kill agents exceeding their wall-clock timeout or inactivity timeout (no stdout); SHALL retry a stalled agent once at the infrastructure level — stall retries SHALL NOT consume the per-stage validation budget; SHALL retry a failed stage attempt with the validator or stage error appended to the prompt at most 2 times before halting with resumable state; and SHALL run multiple reviewer lenses concurrently where the depth profile requires them. The runner SHALL NOT trust agent-declared outcomes — convergence comes from post-resolution JSON, artifact existence from disk, and task atomicity from a checker pass.

#### Scenario: Retry with context

- **WHEN** a drafter's artifact fails validation
- **THEN** the runner respawns the drafter with the validation error appended, up to 2 attempts, then halts resumable

#### Scenario: Stall retry is infrastructure-level

- **WHEN** a reviewer agent produces no stdout for the configured inactivity timeout
- **THEN** the runner kills it, retries it once, and the retry does not count against the stage's 2-attempt validation budget

#### Scenario: Fresh context enforced

- **WHEN** round k+1 begins
- **THEN** no process or prompt state carries over from round k except the dismissed-findings ledger and current artifacts on disk

### Requirement: Assumption capture instead of questions

When the drafter or resolver faces an unknown not answerable from the repo, it SHALL record an assumption (text, basis: code-evidence | convention | default, confidence, blast radius, status: open | confirmed | vetoed) in the assumptions sidecar. Artifacts SHALL NOT retain unresolved `TODO:`/`TBD` markers outside `assumptions.md`.

#### Scenario: Default with accountability

- **WHEN** the resolver picks a least-surprise default for a product-judgment question
- **THEN** the choice is applied to the artifacts and logged as an open assumption with blast radius, visible at the gate

### Requirement: Single human gate

Before decomposition output is handed to apply, the runner SHALL halt at a gate: write `gate-<n>.md` (open assumptions ranked by blast radius, unresolved cap-hit BLOCKERs, change summary, cost and duration), print it with a resume command, and record `gate-pending` (with mode) in `state.json`. The gate SHALL have two modes — an early cap-hit mode presented before decomposition (blockers-focused) and a final mode after the atomicity check (full digest) — sharing one protocol and one version sequence. The gate SHALL accept four payload types: approve; veto with optional redirect; answer to a cap-hit BLOCKER; abort. The gate file SHALL use a checkbox protocol: an unchecked assumption entry is a veto; a line beginning with `→` under an entry supplies a redirect or answer payload. On resume the runner SHALL parse the gate file into a schema-validated `gate-response.json`; ambiguous input SHALL fail with an error naming the offending line and leave state unchanged. Each gate presentation SHALL be versioned (`gate-1.md`, `gate-2.md`, …) and recorded in the event log. Each veto SHALL trigger exactly one resolver pass updating affected artifacts and tasks followed by one re-presentation; veto cycles MAY repeat until the human approves or aborts. Approving while cap-hit BLOCKERs remain unanswered SHALL fail, naming the open entries: overriding a cap-hit halt SHALL require a per-blocker `→` answer or an explicit `OVERRIDE` marker line, and `--confirm-all` SHALL NOT override blockers. With `--wait`, the runner MAY block on stdin instead of exiting.

The runner SHALL detect human hand edits to agent-authored artifacts (proposal, specs, design, tasks.md) made while gate-pending, by comparing content hashes recorded at gate entry. Detected edits SHALL be re-validated, logged as events, and included in the re-presented digest; when specs or design changed, the runner SHALL run one drift-check resolver pass reconciling tasks.md before re-presenting.

#### Scenario: Exit and resume

- **WHEN** the gate is reached without `--wait`
- **THEN** the runner prints the digest and `gate resume <runId>`, exits, and later resumes from `state.json`

#### Scenario: Checkbox veto with redirect

- **WHEN** the human leaves A3 unchecked, adds `→ suppress autonomous replies only` beneath it, and resumes
- **THEN** the runner records a veto with redirect, runs one resolver pass applying it, re-materializes artifacts, and re-presents `gate-2.md`

#### Scenario: Ambiguous input rejected

- **WHEN** the gate file contains a mark the parser cannot classify
- **THEN** resume fails with an error naming the line and no run state changes

#### Scenario: Bare approve with open blockers fails

- **WHEN** the human checks every assumption box but leaves cap-hit BLOCKERs unanswered — or passes `--confirm-all` — and resumes
- **THEN** the runner rejects the response, names the open blocker entries, and no run state changes

#### Scenario: Hand edits detected

- **WHEN** the human edited a spec scenario and design.md while gate-pending
- **THEN** resume re-validates the change, logs the edits, runs the drift-check pass reconciling tasks.md, and includes the edit summary in the re-presented digest

### Requirement: Adaptive depth profiles

Intake SHALL assign depth profile S, M, or L. When `--depth` is passed, intake SHALL skip estimation entirely — the override is the expected path for obviously-small changes. Otherwise a read-only scope-estimator agent SHALL propose implicated files and modules with structured signals, and a deterministic mapping function in runner code SHALL assign the profile from those signals: cross-module impact, DB migration, provider-wide surface, credentials, and novelty (new top-level module or subsystem versus modification of existing modules — judged from code structure, not from `openspec/specs/`, which may be empty). The estimator's rationale SHALL be recorded as a `depth classified` event and shown in the gate digest. When a naive keyword pre-screen and the estimator disagree, the higher profile SHALL win; a two-level disagreement SHALL additionally be surfaced in the gate digest rather than silently resolved.

The profile SHALL set: whether design.md is created, the review round cap (S: 1, M: 3, L: 4), reviewer lens count (L adds a skeptic lens), and whether the atomicity check runs (skipped in S). Mid-run profile changes SHALL only escalate (M gaining open BLOCKERs after round 2 adopts the L lens set), never de-escalate.

#### Scenario: Override skips estimation

- **WHEN** the run starts with `--depth S`
- **THEN** no estimator agent runs and intake proceeds directly to scaffolding

#### Scenario: Small change stays cheap

- **WHEN** intake classifies a single-file bugfix as S
- **THEN** design.md is skipped, the review loop runs at most 1 round, and the atomicity check is skipped

#### Scenario: Dynamic escalation

- **WHEN** an M-profile run still has open BLOCKERs after round 2
- **THEN** subsequent rounds add the skeptic reviewer lens instead of consuming the remaining cap unchanged

### Requirement: Atomic task decomposition

Decomposition SHALL produce tasks.md where every task carries one atomic code change and ends with its verification command, per project task rules. In profiles M and L, a fresh atomicity-check agent SHALL split tasks bundling multiple changes and merge trivially coupled ones before the human gate.

#### Scenario: Atomicity enforcement

- **WHEN** a drafted task bundles a migration and a backfill
- **THEN** the atomicity check splits it into two tasks, each independently verifiable
