## MODIFIED Requirements

### Requirement: Five-key strict schema

The configuration file SHALL accept exactly the five run keys `repoRoot`, `workDir`, `model`, `budget` (USD, default 5), and `deadline` (minutes, optional), plus the optional `backend` route selector whose only accepted values are `opencode` and `claude` and which defaults to `opencode` when absent. Every other key SHALL be rejected at load time with the offending key named in the error, together with its replacement when one exists. A `backend` value outside the two accepted spellings SHALL fail config load in the same error surface, naming the key and its accepted values, before any run directory is created and before any model spend. The `model` key SHALL keep its provider-prefixed spelling on either route, because the runner's price lookup is keyed by that spelling; adapting the id for a route's command line is a route-local concern and SHALL NOT rewrite the configured value.

#### Scenario: Minimal valid config

- **WHEN** the config contains only `repoRoot` and `model`
- **THEN** loading succeeds with `workDir` defaulted, `budget` defaulted to 5, no deadline armed, and the backend defaulted to `opencode`

#### Scenario: Removed key rejected by name

- **WHEN** the config contains `autonomy`, `models`, `timeouts`, or `budgetUsd`
- **THEN** loading fails naming that key and pointing at its replacement (`budget`, the single `model`, compiled timeout constants) or stating none exists

#### Scenario: Backend key is accepted, not rejected as unknown

- **WHEN** the config sets `backend` to `claude` alongside `repoRoot` and `model`
- **THEN** loading succeeds with that route selected, and the strict schema does not reject the key as an unknown key

#### Scenario: Unknown backend value rejected by name

- **WHEN** the config sets `backend` to any value other than `opencode` or `claude`
- **THEN** loading fails naming the `backend` key and its two accepted values, before any run directory is created or any model spend occurs
