## Purpose

Defines how the GitHub Actions agent chooses the git author and committer for every commit it pushes, so history is attributable per run, verifiable, and free of a phantom bot identity.

## ADDED Requirements

### Requirement: Default commit identity is the service account

The system SHALL default commit identity to the runtime service account `github-actions[bot]` when no explicit operator override is set.

#### Scenario: Unconfigured job defaults to service

- **WHEN** the job runs with `AGENT_COMMIT_NAME` and `AGENT_COMMIT_EMAIL` unset
- **THEN** the fallback commit identity is `name=github-actions[bot]` and `email=41898282+github-actions[bot]@users.noreply.github.com`

#### Scenario: Explicit operator pin wins

- **WHEN** `AGENT_COMMIT_NAME` and/or `AGENT_COMMIT_EMAIL` are explicitly set via environment (`vars.AGENT_COMMIT_*` in `agent-pipeline.yml`)
- **THEN** the explicitly set field(s) SHALL be used verbatim and SHALL take precedence over any actor or service resolution for that field

### Requirement: Per-run actor is the commit author when a human triggered the run

The system SHALL set the git author to the human who triggered the run when the trigger is human-authored; otherwise it SHALL fall back to the service account.

#### Scenario: Issue and pull-request commands attribute to sender

- **WHEN** the trigger `kind` is `issue` or `pull-request` and `senderLogin` is a non-empty maintainer identity that passed guardrails (`guardrails.ts:checkSender`)
- **THEN** the resolved author name SHALL be `senderLogin`

#### Scenario: Machine triggers fall back to service

- **WHEN** the trigger `kind` is `ci` (red check run on `agent/issue-<n>`) or `pr-merged` (archive `D7`), or the `issue` trigger has no comment (`issues.opened` with `null` sender body)
- **THEN** the resolved author SHALL be the service account `github-actions[bot]`

#### Scenario: All commits in one job share the same actor

- **WHEN** a job implements multiple plan steps (one turn, commit and push per step in `REVIEW_AND_MUTATE`), or runs review-loop fixes, or salvages a mid-turn tree
- **THEN** every commit pushed by that job SHALL carry the same resolved author determined once at job start for that trigger

### Requirement: Author email is the actor's GitHub noreply with id

The system SHALL construct the author's email as the actor's GitHub noreply address, preferring the `id+login` form for verification.

#### Scenario: Successful user lookup yields id-prefixed noreply

- **WHEN** actor resolution fetches `GET /users/:login` and receives `{id, login}`
- **THEN** the author email SHALL be `<id>+<login>@users.noreply.github.com`

#### Scenario: Lookup failure falls back to short noreply without failing the run

- **WHEN** `GET /users/:login` rejects (404, rate limit, network, empty login) or the trigger has no human login
- **THEN** the system SHALL fall back to `<login>@users.noreply.github.com` if a login is known, otherwise to the service email `41898282+github-actions[bot]@users.noreply.github.com`, log at `warn`, and SHALL NOT fail the run

#### Scenario: Local reproduction falls back to service

- **WHEN** the agent runs locally via `--event-path` with no `GET /users` capability or token
- **THEN** the resolved author email SHALL be the service account email

### Requirement: Author and committer are distinct

The system SHALL author commits as the resolved actor (or service fallback) and SHALL committer them as the service account, so blame shows the human while push provenance shows automation.

#### Scenario: Human-triggered commit split

- **WHEN** the resolved author is a human actor `bob`
- **THEN** the git commit SHALL have `author.name=email` from actor (`bob` / `<id>+bob@users.noreply.github.com`) and `committer.name=email` as `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com`

#### Scenario: Service-fallback commit unified

- **WHEN** the resolved author is the service account (machine trigger or lookup failure)
- **THEN** both author and committer SHALL be the service account

#### Scenario: Review-loop commits carry the same identity

- **WHEN** the `CODE_REVIEW` phase runs the `review-loop/` workspace (`review-runner.ts`)
- **THEN** commits created inside the loop (worktree) SHALL carry the same resolved author/committer pair as the job's other commits, via `ReviewLoopSettings.commitAuthor` set from the job's resolver

### Requirement: Resolution precedence is explicit over actor over service

The system SHALL resolve each identity field with precedence explicit operator pin > actor > service, per field.

#### Scenario: Name pinned, email from actor

- **WHEN** `AGENT_COMMIT_NAME` is explicitly set but `AGENT_COMMIT_EMAIL` is not
- **THEN** commit author name SHALL be the pinned name and commit author email SHALL be the actor noreply (or service fallback)

#### Scenario: Both pinned overrides actor completely

- **WHEN** both `AGENT_COMMIT_NAME` and `AGENT_COMMIT_EMAIL` are explicitly set
- **THEN** no `GET /users/:login` lookup is needed and both fields SHALL be the pinned values for every commit

### Requirement: Resolution is best-effort and never blocks delivery

Identity resolution SHALL NOT cause a commit to be refused or the run to fail beyond falling back to the service identity.

#### Scenario: Guarded commit still delivers

- **WHEN** actor resolution fell back to service after a failed user lookup
- **THEN** `git commit` and `push` SHALL still proceed with the fallback identity and SHALL NOT be reported as a `blocked` commit (`git-commit.ts:CommitOutcome`)

### Requirement: No papai runtime or scope-model side effects

The system SHALL keep commit-identity resolution isolated to the `opencode-agent` GitHub Actions pipeline; it SHALL NOT create or mutate papai platform instances, task instances, storage/context ids, or `tool_prefs`.

#### Scenario: Papai scope unchanged

- **WHEN** any open-issue triggers the agent
- **THEN** no SQLite rows, `config context id`, `storage context id`, or `tool_prefs` entries SHALL be created or modified for commit-identity reasons
