<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the research findings document that compares every way an end user could declare
MCP servers for the opencode-agent pipeline, the evidence discipline its claims must carry,
the safety rules its live verification must follow, and the ranked recommendation it must
deliver — with no production code change.

## ADDED Requirements

### Requirement: The change delivers a research document, not runtime behavior

The change SHALL produce exactly one new document,
`opencode-agent/docs/mcp-integration-research.md`, optionally plus a one-line link to it
from `opencode-agent/ROADMAP.md`, and SHALL NOT modify production sources, tests, or the
workflow. No `mcp` block may be added to any runtime configuration the pipeline builds. The
document SHALL carry the SPDX licence header matching the existing documents in
`opencode-agent/docs/` and follow their confidence-labelled, recorded-not-guessed style.

#### Scenario: The deliverable is a document

- **WHEN** the change is delivered as a pull request
- **THEN** the diff adds `opencode-agent/docs/mcp-integration-research.md`
- **AND** contains no edits under production sources, tests, or the workflow

#### Scenario: No runtime configuration gains an mcp block

- **WHEN** the configuration the pipeline builds for either execution path is inspected
  after the change
- **THEN** it emits no `mcp` key

#### Scenario: The licence-header gate passes

- **WHEN** the licence-header check runs over the new document
- **THEN** it passes with the same SPDX header the existing documents carry

### Requirement: SDK config-shape claims are anchored to the pinned SDK

The document SHALL record the OpenCode `mcp` configuration surface — per-server local
configuration (command vector, working directory, environment, enabled flag, timeout) and
remote configuration (url, headers, oauth setting, enabled flag, timeout) — citing the
pinned `@opencode-ai/sdk` type definitions, and SHALL record for each runtime MCP endpoint
(add, connect, disconnect, auth, status) whether it is usable from an unattended pipeline
job.

#### Scenario: A config-shape claim names its anchor

- **WHEN** the document states a field or type of the `mcp` configuration surface
- **THEN** the claim cites the pinned SDK type definition it was read from

#### Scenario: Runtime endpoints are judged for unattended use

- **WHEN** the document describes an MCP runtime endpoint
- **THEN** it states whether that endpoint is reachable from a job with no interactive user

### Requirement: Behavioural claims carry a confidence label and are never guessed

Every claim about runtime behaviour — tool naming, server startup or connect failure
handling, `enabled: false` semantics, merge or override between a repo-committed config
file and `OPENCODE_CONFIG_CONTENT`, and OAuth status flows — SHALL be labelled **verified**
(observed against the real `opencode` binary) or **by inspection**. An unlabelled
behavioural claim SHALL NOT appear in the document.

#### Scenario: A behavioural claim is verified by live run

- **WHEN** the document claims how the real binary names tools, resolves permissions,
  merges configuration sources, or handles a failing server
- **THEN** the claim is labelled verified and records the configuration fed to the binary —
  a throwaway stdio MCP server delivered via `OPENCODE_CONFIG_CONTENT`

#### Scenario: A claim cannot be run

- **WHEN** a claim cannot be verified against the live binary inside the job
- **THEN** it is explicitly marked by inspection rather than presented as verified

### Requirement: Live verification never kills processes by name

Live verification SHALL start each experiment process, record its pid at spawn time, and
terminate it by that recorded pid only. It SHALL NOT use `pkill`, `killall`, or any other
name-based kill, because the job's control plane is an `opencode serve` on loopback that
must survive every experiment.

#### Scenario: An experiment process is cleaned up

- **WHEN** a live verification ends with a spawned experiment process still running
- **THEN** it is terminated using the pid recorded when it was spawned

#### Scenario: The control plane survives the research

- **WHEN** every live verification in the job has completed
- **THEN** the loopback `opencode serve` control plane is still running

### Requirement: Every plausible configuration surface is evaluated

The document SHALL evaluate at least five candidate surfaces: a repo-committed OpenCode
config file; a pipeline environment knob in the existing `AGENT_*` style; repository
Actions variables or secrets referenced from a committed config through environment
interpolation; user edits to a forked workflow file; and issue- or comment-level
configuration. Candidates found during research MAY be added. Each candidate SHALL be
scored on what the user must know about the pipeline's internals, where the value lives
and how it is reviewed and changed, how secrets are supplied, and what failure looks like,
against the CI constraints and the security model.

#### Scenario: A candidate found during research joins the comparison

- **WHEN** research surfaces a configuration surface beyond the named candidates
- **THEN** it is added to the comparison and scored on the same dimensions

#### Scenario: The comparison is complete at the verdict

- **WHEN** the document reaches its recommendation
- **THEN** every candidate it evaluated appears in the comparison with its scores and its
  CI-constraint and security assessment

### Requirement: Issue- and comment-level configuration is rejected explicitly

The document SHALL record issue- and comment-level MCP configuration as evaluated and
rejected on security grounds — issue authors and commenters are untrusted, a local server
definition they supply is arbitrary command execution in a privileged job, and a remote one
an exfiltration endpoint — and SHALL NOT omit it from the comparison.

#### Scenario: The rejected surface is present

- **WHEN** the document lists the evaluated surfaces
- **THEN** issue- and comment-level configuration appears, marked rejected, with the
  security reasoning stated

### Requirement: Each option's evaluation is grounded in the CI environment

The document SHALL ground every option's evaluation in the recorded CI facts: no
interactive user, so OAuth browser flows cannot complete and `ask` permissions deadlock the
job; MCP credentials placed in config content or a local server's environment are
model-readable through the spawned server's environment; the runner is ephemeral with no
writable home assumed, so stdio servers are installed per run and per-server OAuth token
caches are useless; network egress is unrestricted, making an MCP server a potential
exfiltration channel; a repo-committed file is model-readable and attacker-influenceable via
pull request on repositories taking contributions; and a server that fails to boot must
degrade rather than hang. CI-environment claims already established by the workflow, the
README, or prior ROADMAP findings SHALL be cited rather than re-derived.

#### Scenario: A CI fact is cited, not re-derived

- **WHEN** the document states a CI-environment fact already established by a prior finding
- **THEN** it cites that finding rather than presenting the fact as newly derived

#### Scenario: Server boot failure behaviour is recorded, not assumed

- **WHEN** the document describes what happens when a configured MCP server fails to start
- **THEN** the description is labelled verified from a live run or by inspection

### Requirement: Credential exposure risk is documented per option

The document SHALL state, for each option, the risk that MCP credentials reach the model,
including that a repo-committed config file is readable by the model in both profiles and
therefore SHALL NOT carry credentials — credentials travel only through environment
interpolation from masked secrets. It SHALL evaluate whether the existing
loopback-placeholder proxy pattern and value-based secret scrubbing generalise to MCP
headers and environment blocks, and SHALL record the outcome as a risk assessment per
option with any implementation named as a deferred follow-up. The document itself SHALL NOT
contain any real credential or secret value.

#### Scenario: The repo-file option is assessed for credentials

- **WHEN** the document evaluates the repo-committed config file
- **THEN** it states that the file is model-readable and must never carry credentials

#### Scenario: Containment approaches are evaluated without being implemented

- **WHEN** the document evaluates credential containment for MCP headers and environment
- **THEN** it records whether the proxy-placeholder and scrubbing patterns generalise
- **AND** names the implementation as a deferred follow-up rather than designing it

### Requirement: Permission-model interaction is verified against the real binary

The document SHALL determine and record which permission key form grants MCP tools
arriving as `<server>_<tool>` names — for example a `<server>_*` wildcard entry — confirmed
against the resolved rules the real binary reports, using the same verification method the
existing profile permission table used. Per the maintainer decision, the recommended shape
SHALL grant the server wildcard in both the read-only and the write-capable profile and in
the global default, and the per-server opt-out SHALL appear only as a deferred follow-up,
not as a design.

#### Scenario: The granting key form is confirmed

- **WHEN** the document states which permission entry grants a server's tools
- **THEN** the statement is confirmed against the resolved permission rules the real binary
  reports

#### Scenario: The deferred opt-out is named, not designed

- **WHEN** the document covers per-profile granting of MCP tools
- **THEN** the grant covers both profiles
- **AND** the per-server opt-out appears only as a named follow-up

### Requirement: Both execution paths are addressed for every option

The document SHALL describe, for each option, where an `mcp` block would be injected so the
in-process server path and the `OPENCODE_CONFIG_CONTENT` subprocess path cannot drift, and
SHALL record for the repo-file option whether review-loop subprocesses — spawned with
`OPENCODE_CONFIG_CONTENT` set — would even see a checkout-local file.

#### Scenario: An option states its injection point

- **WHEN** the document evaluates a configuration surface
- **THEN** it names where the `mcp` block enters the configuration for each of the two
  execution paths, or records that the option cannot reach one of them

### Requirement: The document ends with a ranked recommendation and named follow-ups

The document SHALL end with a ranked verdict naming the recommended configuration surface
with its end-user UX justification, the grant-all-profiles permission shape, and each
deferred item — the per-server opt-out and the credential-containment work — as a named
follow-up.

#### Scenario: The verdict is actionable

- **WHEN** a reader reaches the end of the document
- **THEN** they know which surface to implement, why it won on end-user UX, and which
  follow-ups were deliberately deferred
