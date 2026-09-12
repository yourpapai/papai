## ADDED Requirements

### Requirement: Launch configuration resolution

Every verb SHALL resolve its run configuration through one ladder before any run work starts: a config file at the work dir when present, else the `AFK_RUNNER_MODEL` environment entry for the model with compiled defaults for the rest. A present config file SHALL be authoritative for the whole five-key configuration — its `model`, `budget`, and `deadline` govern the run even when the environment entry names something else — and an absent file SHALL keep the environment-plus-defaults behavior unchanged. All verbs — `start`, `resume`, `status`, `stop`, `report`, `runs`, `analyze` — SHALL resolve through the same ladder, so a run's configuration is one resolution, not a per-verb shape.

#### Scenario: Config file at the work dir governs the launch

- **WHEN** the work dir holds a config file whose `model` and `budget` differ from the `AFK_RUNNER_MODEL` entry and the compiled defaults
- **THEN** the run launches with the file's model and budget, and the environment entry is not consulted for them

#### Scenario: Absent config file keeps environment-plus-defaults behavior

- **WHEN** no config file sits at the work dir and `AFK_RUNNER_MODEL` names a model
- **THEN** the run launches with that model, the compiled default budget, and no deadline armed — the behavior before the file surface existed

#### Scenario: No file and no environment entry falls to the compiled defaults

- **WHEN** the work dir holds no config file and `AFK_RUNNER_MODEL` is unset
- **THEN** the run launches with the compiled default model and budget

#### Scenario: An invalid config file fails the launch loudly

- **WHEN** the config file at the work dir carries a key outside the five-key contract or a value of the wrong shape
- **THEN** the verb fails before any run work starts, naming the offending key or the invalid value, never silently falling back to environment or defaults

### Requirement: Standing default work dir is ignore-covered

There SHALL be exactly one standing default work dir — `.afk-runner` under the repo root: the config schema's defaulted `workDir` and the CLI's no-file fallback SHALL resolve to the same path, and the repository's ignore file SHALL cover that path. A run launched with no configuration SHALL place all of its bookkeeping — run directories, memos, event logs — under that ignored default, so the runner's own bookkeeping never appears as untracked tree dirt and never trips the agent write guard.

#### Scenario: A default run leaves the tree clean of bookkeeping

- **WHEN** a run launches with no config file and writes its run directory, memo, and event log
- **THEN** all of that bookkeeping sits under the standing default work dir, which the ignore file covers, and none of it is reported as untracked tree dirt

#### Scenario: One default stands in both places

- **WHEN** a config file whose `repoRoot` equals the standing root omits `workDir`, and another launch from that same root has no config file at all
- **THEN** both resolve the work dir to the same standing default path

## MODIFIED Requirements

### Requirement: Command doc flags stay parseable

The front-door command doc (`.claude/commands/sdd-auto.md` and its `.opencode` twin) SHALL document only flag forms the `start` argument parsing accepts — over its whole body, the launch-configuration prose included. Every flag the doc names SHALL parse through the same argument parsing the `start` verb uses, so the doc cannot drift into unknown-flag errors, and a flag the parsing would silently ignore SHALL fail the pin. The doc SHALL document the launch-configuration surface — the config file at the work dir, the `AFK_RUNNER_MODEL` environment entry, the compiled defaults, and their precedence — and that prose SHALL introduce no flag form: configuration rides the file-over-environment-over-defaults ladder, with no `--budget`, `--deadline`, or `--model` flags.

#### Scenario: Documented flag inventory parses

- **WHEN** every flag the command doc names is run through the `start` argument parsing with its documented value form
- **THEN** each documented flag is accepted with no unknown-flag or invalid-value error

#### Scenario: Configuration prose stays total under the pin

- **WHEN** the doc gains its launch-configuration section
- **THEN** the pinned flag inventory stays exactly the flags the `start` parsing accepts — every flag form the grown doc names still parses with its documented value form, and none is silently ignored
