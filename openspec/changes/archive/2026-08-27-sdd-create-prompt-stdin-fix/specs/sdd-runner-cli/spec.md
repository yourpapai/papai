## Delta: sdd-runner-cli

## MODIFIED Requirements

### Requirement: Inline session start without a task file

The runner SHALL accept a task description entered interactively (title plus
body) as the source for a new session, so starting work does not require
creating or managing a task markdown file. The entered text SHALL be persisted
inside the run directory as the task record, and the pipeline SHALL consume it
identically to file-sourced task text. With no runs existing, a bare
invocation SHALL go directly to this creation entry. Explicit task-file starts
SHALL remain supported and behave as today.

When the creation entry opens immediately after an interactive screen closes
on the same terminal, the prompt SHALL accept typed input: the closing of the
prior screen SHALL leave standard input in a state the prompt can serve, and
an operator typing a title SHALL have it received. An empty title SHALL
abandon creation (no run started, no side effects) without being mistaken for
end-of-input.

#### Scenario: Session created from typed description

- **WHEN** the operator picks new session, enters a title and description, and
  confirms a derived depth
- **THEN** a new run starts whose task text equals the entered description, and
  intake/draft/review proceed exactly as with a task file

#### Scenario: Description persists inside the run dir

- **WHEN** a session was started from a typed description
- **THEN** the full text remains available later from the run directory itself,
  independent of any repo file

#### Scenario: No runs routes to creation

- **WHEN** `sdd` runs with no target on a terminal and no runs exist
- **THEN** the runner enters the new-session flow instead of failing

#### Scenario: Prompt usable straight after the session screen

- **WHEN** the operator picks new session from the interactive session screen
  and the screen closes, then types a title and presses Enter
- **THEN** the typed title is received by the creation prompt and the flow
  continues to the description question

#### Scenario: Empty title abandons on a live terminal

- **WHEN** the creation prompt is opened from the session screen and the
  operator presses Enter on an empty title
- **THEN** creation is abandoned with the abandonment notice and no run is
  started — the empty line is treated as a deliberate empty title, not as
  end-of-input on an unusable stream
