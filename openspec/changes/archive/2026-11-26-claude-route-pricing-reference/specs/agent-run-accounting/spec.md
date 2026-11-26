<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## ADDED Requirements

### Requirement: A run is priced under the catalogue key of the backend that ran it

The model reference a run is priced and logged under SHALL name the provider that
actually served the run's model turns, and SHALL name the model by the same id
the backend was invoked with. A run on the Claude CLI backend SHALL be priced
under the Anthropic catalogue, whatever provider id the gateway route's
configuration names; a run on the OpenCode backend SHALL keep being priced under
the configured gateway catalogue id, which is the key its own model resolution
already uses.

This applies to the catalogue rung and to the log line that records which rung
answered. It does not reorder the ladder: a backend that states its own cost
still outranks the catalogue.

#### Scenario: A claude-backend run whose configuration names a gateway catalogue

- **WHEN** a run on the Claude CLI backend is priced, and the configuration
  carries a gateway catalogue provider id left over from the other route
- **THEN** the run is priced and logged under the Anthropic catalogue, and that
  gateway id appears in neither the pricing lookup nor the log line

#### Scenario: A model named with a provider prefix

- **WHEN** a claude-backend run's configured model is spelled `<provider>/<model>`
  — the form this route accepts and strips before invoking the CLI
- **THEN** it is priced under the same stripped model id the CLI was invoked
  with, and not under a reference that concatenates two provider names

#### Scenario: The stripped model id has a catalogue row

- **WHEN** a claude-backend run's counts are priced and the Anthropic catalogue
  carries a row for that model id
- **THEN** the run is priced from that row's own rates, not from a figure
  averaged across other providers publishing a model of the same name

#### Scenario: An opencode-backend run is unaffected

- **WHEN** a run on the OpenCode backend is priced
- **THEN** it is priced and logged under the configured gateway catalogue
  provider id exactly as before

#### Scenario: The backend's own figure still wins

- **WHEN** a claude-backend run's backend states a non-zero cost
- **THEN** that figure is the run's cost, the catalogue is not consulted, and
  the log line names the reference this requirement pins

#### Scenario: The reference is a name, not a credential

- **WHEN** the reference is written to the run log on a public repository
- **THEN** it carries the provider id and the model id only, and no part of any
  Anthropic or gateway credential
