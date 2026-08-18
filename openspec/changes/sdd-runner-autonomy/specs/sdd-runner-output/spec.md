## Purpose

Makes the remaining human attention on sdd-runner runs cheap: Tier 0 terminal-output detail polish with a frozen non-TTY byte contract, an interactive gate-session front-end, and a live `watch` attach verb over the event log.

## ADDED Requirements

### Requirement: Frozen non-TTY byte contract

Non-TTY (CI/log-file) pipeline output SHALL remain byte-identical to its pre-change form, with exactly one permitted addition: the model id on agent `done` lines. All other Tier 0 output details SHALL land only in the dynamic (interactive-TTY) renderer and in gate files.

#### Scenario: CI output gains only the done-line model id

- **WHEN** a pipeline run writes to a non-TTY sink (pipe, file, CI log)
- **THEN** the byte stream SHALL equal the pre-change byte stream except that `done` lines include the model id

#### Scenario: Done line without a model id is unchanged

- **WHEN** a `done` event carries no model id (historical or unmetered run)
- **THEN** the done line SHALL be rendered exactly as before the change, with no model segment and no placeholder

#### Scenario: Interactive details never leak into non-TTY output

- **WHEN** any Tier 0 detail other than the done-line model id (stage timings, ETA, sparklines, retry badges, terminal title) is rendered
- **THEN** it SHALL appear only on interactive TTY output or in gate files, never in the non-TTY byte stream

### Requirement: Pipeline map stage details

In the dynamic renderer, the pipeline map SHALL show per-stage wall time and cost on completed stages, and an animated marker with elapsed seconds on the active stage.

#### Scenario: Completed stage shows wall time and cost

- **WHEN** a pipeline stage completes while rendering to an interactive TTY
- **THEN** its pipeline-map line SHALL display the stage's wall time and cost

#### Scenario: Active stage shows a live elapsed marker

- **WHEN** a pipeline stage is in progress on an interactive TTY
- **THEN** its line SHALL show an animated marker and elapsed seconds that advance while the stage runs

### Requirement: Slot line details

Agent slot lines in the dynamic renderer SHALL be truncated by visible display width so wide characters and emoji never break alignment. A retrying agent's slot line SHALL carry a retry badge. A `done` slot line SHALL read `<agent> done · <model> · in X out Y · $Z`, including the model id and token/cost figures.

#### Scenario: Wide characters never break alignment

- **WHEN** a slot label contains wide characters or emoji that exceed the available columns
- **THEN** the line SHALL be truncated by visible width so no rendered line overflows the terminal width

#### Scenario: Retrying agent shows a retry badge

- **WHEN** an agent slot is retrying
- **THEN** its slot line SHALL display a retry badge distinguishing it from a first-attempt run

#### Scenario: Done line carries model and usage

- **WHEN** an agent slot completes
- **THEN** its `done` line SHALL include the agent id, the model id, input and output token counts, and cost

### Requirement: Status line details

The dynamic-renderer status line SHALL show an ETA computed as the median of completed review rounds, SHALL show reasoning tokens when the count is greater than zero, and SHALL right-align its numeric columns.

#### Scenario: ETA reflects completed rounds

- **WHEN** at least one review round has completed
- **THEN** the status line SHALL show an ETA derived from the median duration of completed review rounds

#### Scenario: Reasoning tokens hidden when zero

- **WHEN** the run's reasoning-token count is zero
- **THEN** the status line SHALL NOT display a reasoning-tokens segment

### Requirement: Gate trajectory sparkline

The gate trajectory block SHALL show a per-round unicode burndown sparkline (glyphs `▁▂▃▄▅▆▇`) next to the existing per-round counts. The sparkline SHALL be pure text that renders identically in any pager.

#### Scenario: Sparkline accompanies per-round counts

- **WHEN** a gate trajectory block lists per-round open-findings counts
- **THEN** a sparkline of unicode block glyphs SHALL appear beside the counts, one glyph per round, encoding relative magnitude

### Requirement: Terminal title

On stage transitions the runner SHALL set the terminal title via the escape sequence `\x1b]0;sdd <change> · <stage>\x07`, and SHALL restore the prior title on exit on a best-effort basis: restoration SHALL be attempted from clean exits and from SIGINT/SIGTERM handlers; restoration after SIGKILL, and on terminals where the prior title cannot be queried (a fixed default restore string is used instead), is not guaranteed.

#### Scenario: Title tracks stage and is restored

- **WHEN** the pipeline transitions to a new stage on an interactive TTY
- **THEN** the terminal title SHALL be set to `sdd <change> · <stage>`
- **WHEN** the run exits cleanly or via SIGINT/SIGTERM
- **THEN** the original terminal title SHALL be restored

### Requirement: Quiet verbosity

The runner SHALL support `--verbosity quiet` alongside the existing `brief`/`normal`/`debug` levels, on `start`, `resume`, `continue`, and `gate` alike (per-command, not persisted). At `quiet`, intermediate pipeline output SHALL be suppressed, but the runner SHALL still emit: the final run summary; the gate-pending file path and `Next: sdd-runner gate resume <runId>` hint when a run halts at a gate; deadline bell/notification lines; steering warn lines; and, for a run that halts at a gate and therefore has no final summary, a one-line halt record naming the gate file.

#### Scenario: Quiet emits only the final summary

- **WHEN** a run executes to completion with `--verbosity quiet`
- **THEN** intermediate pipeline output SHALL be suppressed and only the final run summary SHALL be printed

#### Scenario: Quiet run halted at a gate still shows the way forward

- **WHEN** a run with `--verbosity quiet` halts at a gate
- **THEN** the gate file path, the resume hint, and a one-line halt record SHALL be printed even though no final summary exists

### Requirement: Interactive gate-session front-end

The interactive gate session SHALL use a `@clack/prompts` front-end (adapted behind the existing `Prompter` interface) offering accept/veto/inspect per item, a blocker-answer prompt, and a decision menu with consequences. The `gate-<n>.md` file grammar, the CLI flag path, and the hand-edited-file power path SHALL be untouched: a flag-driven decision, a hand-edited gate file, and an interactive session answering the same gate SHALL produce identical outcomes. The non-interactive readline path SHALL remain available as the power path and non-TTY fallback, unchanged.

#### Scenario: Flag and interactive paths produce identical outcomes

- **WHEN** the same gate is answered once via CLI flags and once via the interactive session with equivalent choices
- **THEN** the resulting gate decision record, version consumption, and run state SHALL be identical

#### Scenario: Hand-edited gate file still honored

- **WHEN** a user hand-edits `gate-<n>.md` instead of answering interactively
- **THEN** the pipeline SHALL consume the hand-edited file exactly as before, with no change in behavior

#### Scenario: Non-TTY fallback unchanged

- **WHEN** the gate session runs without an interactive TTY
- **THEN** the existing readline/flag power path SHALL be used with behavior unchanged

### Requirement: Watch verb

`sdd-runner watch <runId>` SHALL attach to a live run by replaying `events.ndjson` and then tailing it, rendering a scrollable findings list, a live burndown, and per-agent slots. Watching SHALL be read-only with respect to the run: it SHALL NOT write to the run directory or alter run state.

#### Scenario: Watch replays then tails

- **WHEN** `sdd-runner watch <runId>` attaches to an in-progress run
- **THEN** it SHALL first render state rebuilt by replaying the existing `events.ndjson`, then live-update from newly appended events

#### Scenario: Watch is read-only

- **WHEN** a watch session attaches to and detaches from a run
- **THEN** the run's event log, state files, and gate files SHALL be unmodified by the watch session
