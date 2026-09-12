## ADDED Requirements

### Requirement: Config file is the authoritative launch surface

The config file at the work dir SHALL be the authoritative launch surface, with a recorded precedence: config file over the `AFK_RUNNER_MODEL` environment entry over the compiled defaults. When the file is present it SHALL be the run's configuration, loaded through the five-key contract unchanged — strict unknown-key rejection with the offending key named and its replacement pointer given, and the metered derivation where `budget: null` means unmetered. When the file is absent the environment entry and compiled defaults SHALL apply as before. The environment entry SHALL carry no budget or deadline: there is no per-run spend override outside the config file, and no launch path around its rejection rules.

#### Scenario: File model wins over the environment entry

- **WHEN** the work dir holds a config file naming one model while `AFK_RUNNER_MODEL` names another
- **THEN** the launched run uses the file's model

#### Scenario: Environment entry wins over the compiled default

- **WHEN** no config file sits at the work dir and `AFK_RUNNER_MODEL` names a model
- **THEN** the launched run uses that model in place of the compiled default

#### Scenario: A null budget launches unmetered from the front door

- **WHEN** the config file sets `budget` to null
- **THEN** the launched run is unmetered — bounded by the round cap and the review trajectory alone — expressed by the file alone, with no wrapper script

#### Scenario: A numeric budget arms a cost ceiling from the front door

- **WHEN** the config file sets `budget` to a number different from the compiled default
- **THEN** the launched run's decision ladder and cost guard compare against that number, not the default

#### Scenario: A deadline arms the waiter from the file

- **WHEN** the config file sets a `deadline` in minutes and a gate is presented on a non-interactive stream
- **THEN** the conservative waiter arms with that deadline, with no wait flag passed

#### Scenario: Rejection reaches the launch path

- **WHEN** the config file at the work dir carries a removed key such as `budgetUsd`
- **THEN** the launch fails naming that key and pointing at its replacement (`budget`), instead of the run starting under the environment entry or the compiled defaults
