<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets a repository maintainer declare MCP servers for the opencode-agent pipeline through
one `AGENT_MCP_SERVERS` Actions variable or secret, with validation at job start,
identical delivery to both execution paths, generated permission grants, and
value-based scrubbing of any credentials the declaration carries.

## ADDED Requirements

### Requirement: The knob is parsed and validated at job start

The pipeline SHALL read `AGENT_MCP_SERVERS` as a JSON object mapping server names to
declarations, and SHALL refuse an unloadable value with an error naming the variable
before any model turn is spent. A server name SHALL be a non-empty identifier safe to
embed in a tool-name prefix (letters, digits, hyphen, underscore), because tools arrive
as `<name>_<tool>`. Local entries SHALL carry a non-empty `command` array and MAY carry
`environment`; remote entries SHALL carry a `url` and MAY carry `headers`. An `oauth`
object on any entry SHALL be refused: no unattended job can complete a browser flow.

#### Scenario: Unset knob changes nothing

- **WHEN** `AGENT_MCP_SERVERS` is unset or blank
- **THEN** the run loads exactly as before: no `mcp` key in the emitted OpenCode
  configuration and no MCP permission keys in any profile

#### Scenario: Valid declaration is accepted

- **WHEN** the knob holds a JSON object with one `local` entry (with `command`) and one
  `remote` entry (with `url` and `headers`)
- **THEN** the run loads and both servers appear in the emitted configuration

#### Scenario: Malformed value fails at job start

- **WHEN** the knob holds invalid JSON or an entry that fails the shape above
- **THEN** configuration loading fails with an error naming `AGENT_MCP_SERVERS` and the
  shape problem, before any model turn runs

#### Scenario: OAuth declaration is refused

- **WHEN** any entry carries an `oauth` object
- **THEN** configuration loading fails with an error naming `AGENT_MCP_SERVERS` and
  stating that OAuth remotes cannot start unattended

### Requirement: One definition reaches both execution paths identically

The declaration SHALL be merged in the one configuration builder that serves both the
in-process OpenCode session and the serialized environment config handed to review-loop
subprocesses, so the two paths cannot carry different server sets. Every remote entry
SHALL be emitted with `oauth: false` regardless of what the declaration said.

#### Scenario: Both paths carry the same block

- **WHEN** a valid knob is set and a run builds its OpenCode configuration
- **THEN** the in-process session config and the serialized config content handed to
  spawned `opencode` subprocesses carry the same `mcp` block

#### Scenario: Remotes are emitted OAuth-free

- **WHEN** the knob holds a `remote` entry without any `oauth` field
- **THEN** the emitted configuration carries that entry with `oauth: false`

### Requirement: Permission grants are generated, wildcard, and profile-wide

For every declared server, the pipeline SHALL emit a generated `"<name>_*": "allow"`
permission key in the read-only profile's map, the write-capable profile's map, and the
global default — the wildcard form that admits the server's whole toolset. Grants
SHALL be `allow` only; `ask` is never emitted for an MCP key (an unattended job would
deadlock on it). The artifact-drafting profile SHALL NOT gain MCP tools: drafting turns
are the most confined surface, and MCP tools would be their only unconfined egress.

#### Scenario: Both working profiles admit the server's tools

- **WHEN** the knob declares a server that connects and supplies tools
- **THEN** the read-only and write-capable profiles' permission maps each carry
  `"<name>_*": "allow"`, and the server's tools are model-visible under both profiles

#### Scenario: The drafting profile stays MCP-free

- **WHEN** the knob declares a server
- **THEN** the artifact-drafting profile's permission map carries no MCP key, and that
  profile's model-visible tool table contains no `<name>_*` tools

#### Scenario: No knob, no MCP tools anywhere

- **WHEN** the knob is unset and a server were somehow connected by other means
- **THEN** deny-by-default keeps its tools invisible to every profile the pipeline
  prompts

### Requirement: Declared credentials are scrubbed and redacted by value

Every `headers` and `environment` value in the declaration SHALL be collected into the
pipeline's credential list, so the value-based environment scrub removes them from the
spawned server's environment and the value-based outbound redaction replaces them in
text the pipeline posts. The pipeline SHALL NOT log the knob's value. Token-bearing
declarations belong in an Actions **secret** (masked in logs, encrypted at rest by
GitHub); token-free declarations may live in an Actions variable — the workflow SHALL
forward both spellings. Residual, documented risk: the serialized config content itself
is readable by the model in the write-capable profile, so a credential in the knob is
reachable by the model regardless of scrubbing; guidance in the documentation SHALL
state this.

#### Scenario: Header tokens leave the spawned environment

- **WHEN** the knob holds a remote entry whose `headers` carry a token, and the run
  scrubs its environment before spawning the OpenCode server
- **THEN** no environment variable visible to the model's shell holds that token value

#### Scenario: Outbound text is redacted by value

- **WHEN** text the pipeline is about to post contains a declared header or environment
  value
- **THEN** the posted text carries a redaction placeholder in its place

#### Scenario: Secret and variable spellings both reach the job

- **WHEN** the repository sets `AGENT_MCP_SERVERS` as an Actions secret, or as an
  Actions variable, or as neither
- **THEN** the job receives the set spelling's value, or no value at all, respectively

### Requirement: A broken server degrades to data and is reported nowhere

A server that fails to start or connect SHALL NOT fail the job: its tools are absent
from the model-visible table and the run proceeds — the degradation the pinned OpenCode
binary already provides, bounded by its own 30-second client timeout. The pipeline
SHALL NOT add per-server timeout machinery and SHALL NOT poll MCP status (a status read
blocks up to that same 30-second floor). Failure is silent by design in this version.

#### Scenario: Bad command does not fail the job

- **WHEN** a declared local server's command does not exist
- **THEN** the job proceeds through its phases with that server's tools absent, and no
  pipeline-level timeout or status poller engages

#### Scenario: Job never waits on MCP status

- **WHEN** a run with declared servers executes
- **THEN** the pipeline issues no MCP status reads and adds no wall-clock wait beyond
  what the OpenCode binary itself imposes
