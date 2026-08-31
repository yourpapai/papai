<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets a repository operator tune the claude CLI backend through one `AGENT_CLAUDE_ENV`
Actions variable: operator-chosen environment variables merged into every `claude`
child spawn on the claude route, validated at job start, with route-owned names refused
and the values treated as pipeline credentials.

## ADDED Requirements

### Requirement: The knob is parsed and validated at job start

The pipeline SHALL read `AGENT_CLAUDE_ENV` as a JSON object mapping environment-variable
names to string values, and SHALL do so on both model backends. An unset or empty value
SHALL configure nothing. A set value that is not loadable as such an object — invalid
JSON, a non-object, or any entry value that is not a string — SHALL fail job startup
with an error naming `AGENT_CLAUDE_ENV` and the problem, before any model turn is spent
and before any process is spawned, whichever backend the job selected.

#### Scenario: Unset knob changes nothing

- **WHEN** `AGENT_CLAUDE_ENV` is unset or empty
- **THEN** the job loads and runs exactly as before on either backend

#### Scenario: Valid object is accepted

- **WHEN** the knob holds a JSON object whose every value is a string
- **THEN** the job loads and the entries are carried for the claude route

#### Scenario: Malformed value fails at job start on the claude route

- **WHEN** `AGENT_BACKEND=claude` and the knob holds invalid JSON, a non-object, or an entry whose value is not a string
- **THEN** job startup fails with an error naming `AGENT_CLAUDE_ENV` and the problem, before any CLI process is spawned and before any model spend

#### Scenario: Malformed value fails at job start on the opencode route too

- **WHEN** the opencode backend is selected and the knob holds a malformed value
- **THEN** job startup fails the same way — route-scoping makes the knob inert, it never defers the knob's validation to a spawn

### Requirement: Names the route owns are refused

A knob entry whose name is one the claude route strips from the child environment or
injects itself SHALL be refused at job startup with an error naming `AGENT_CLAUDE_ENV`
and stating the rule — the route's own names are not operator-settable — rather than a
schema path. The refused set SHALL cover the names the route strips (`LLM_BASE_URL`,
`AGENT_MCP_SERVERS`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`) and the names it
injects itself (`CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`, and the invocation profile's
credential spelling). The refusal SHALL fire before any spawn, and a knob carrying no
refused name SHALL be accepted whatever else it holds.

#### Scenario: A credential spelling is refused

- **WHEN** the knob sets `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`
- **THEN** job startup fails naming `AGENT_CLAUDE_ENV` and the rule, before any spawn — a custom entry can never shadow the credential that selects the invocation profile

#### Scenario: A route-managed name is refused

- **WHEN** the knob sets `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`, `LLM_BASE_URL` or `AGENT_MCP_SERVERS`
- **THEN** job startup fails naming `AGENT_CLAUDE_ENV` and the rule, before any spawn

#### Scenario: Unowned names pass

- **WHEN** the knob sets only names outside the refused set — for example `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` or `CLAUDE_CODE_SUBAGENT_MODEL`
- **THEN** the job loads and those entries reach the claude route's child environments

### Requirement: Custom variables reach every claude CLI child

On the claude route with the knob set, every spawned `claude` child SHALL carry the
operator's entries in its environment, alongside the post-scrub environment the route
already assembles. Precedence SHALL be fixed: the route's own injections — the
profile's credential spelling, `DISABLE_AUTOUPDATER` and `CLAUDE_CONFIG_DIR` — SHALL
win over any custom entry for the same name. Nothing else about the spawn SHALL change:
the command line, the invocation profile, the permission allowlists, the detached
process group and its kill, the teardown and every budget SHALL be identical with and
without the knob.

#### Scenario: Custom variables ride the child environment

- **WHEN** the claude route runs a turn with the knob holding an unowned name and its string value
- **THEN** the spawned child's environment carries that name with the operator's value, on every turn of the job

#### Scenario: Route-owned values win

- **WHEN** a name the route also injects somehow reaches the merged environment — the in-depth case the refused set exists to make unreachable through the knob
- **THEN** the child carries the route's value, never the custom one

#### Scenario: The spawn is otherwise unchanged

- **WHEN** the same turn runs with and without a valid knob
- **THEN** the spawned command line, the invocation profile and every other spawn property are identical; only the environment differs

#### Scenario: Unset knob keeps the child environment byte-identical

- **WHEN** the claude route runs with the knob unset or empty
- **THEN** every spawned child's environment is exactly what the route built before this capability existed

### Requirement: The knob is inert off the claude route

The knob SHALL be scoped to the claude route the way the backend selection itself is.
On the opencode backend a valid knob SHALL have no observable effect: no spawned
OpenCode server and no review-loop subprocess environment SHALL carry the entries. The
review loop's own claude subprocesses SHALL NOT receive them either — their
environments keep carrying only what they carry today — and the documentation SHALL
state this boundary as the knob's residual scope, extendable only by a later change.

#### Scenario: Inert on the opencode route

- **WHEN** the opencode backend runs a full job with a valid knob set
- **THEN** the run proceeds exactly as without the knob, and no environment this pipeline assembles carries the custom entries

#### Scenario: Review-loop claude subprocesses are out of scope

- **WHEN** a claude-route job runs its review loop
- **THEN** the loop's claude subprocess environments carry no knob entry

### Requirement: Knob values are treated as pipeline credentials

Every value in the knob SHALL join the pipeline's credential list, so the value-based
environment scrub removes each value from environments this pipeline assembles for
processes other than the claude CLI child, and the value-based outbound redaction
replaces each value in text the pipeline posts and in the transcript it writes. The
pipeline SHALL NOT log the knob's value. The knob SHALL be delivered as an Actions
variable only — the job receives no value when only a same-named Actions secret is set
— and the documentation SHALL state that secrets do not belong in it: the values reach
an environment the CLI's `Bash` children inherit, so a secret placed there is readable
by the model however the pipeline redacts its own outputs.

#### Scenario: A value is redacted from outbound text

- **WHEN** text the pipeline is about to post contains a knob value
- **THEN** the posted text carries a redaction placeholder in its place

#### Scenario: A value is scrubbed from other spawned environments

- **WHEN** a knob value also appears as a standalone value in an environment the pipeline assembles for a spawned process other than the claude CLI child
- **THEN** that environment does not carry the value, while the claude child still receives it through the knob's own delivery

#### Scenario: The knob is never logged

- **WHEN** the pipeline logs or reports the job's configuration
- **THEN** the knob's raw JSON and its values appear nowhere in the log or the report

#### Scenario: Only the variable spelling reaches the job

- **WHEN** the repository defines `AGENT_CLAUDE_ENV` as an Actions variable, or only as an Actions secret, or as neither
- **THEN** the job receives the variable spelling's value, and no value at all in the latter two cases
