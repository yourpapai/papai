<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets the claude route bill the agent pipeline's model turns against an
Anthropic subscription: the OAuth credential spelling selects a second,
neutralized-native CLI profile whose every determinism and confinement
property is pinned by recording rather than assumed from documentation.

## ADDED Requirements

### Requirement: The credential spelling selects the invocation profile

When the claude backend runs, `ANTHROPIC_API_KEY` SHALL select the bare
profile — every invocation carrying `--bare`, the API key re-added to the
child environment, byte-identical to the pre-change bare route — and
`CLAUDE_CODE_OAUTH_TOKEN` SHALL select the native profile: no `--bare`, and
the neutralization flags `--setting-sources ''` plus
`--strict-mcp-config --mcp-config <a JSON document naming zero servers>` on
every invocation. All other invocation facts SHALL be profile-blind: the
prompt on stdin, `--output-format stream-json --verbose`,
`--permission-mode default`, the profile's `--allowedTools` allowlist, the
explicit `--model`, the conditional `--effort`, and `--resume <id>` when a
session id is memoized. On the native profile the child environment SHALL
carry exactly `CLAUDE_CODE_OAUTH_TOKEN` as its Anthropic credential — the
symmetric mirror of the bare profile's API-key rule — and on the bare profile
the child environment SHALL carry no OAuth token, exactly as before.

#### Scenario: The API-key spelling keeps the bare profile untouched

- **WHEN** the claude backend runs with `ANTHROPIC_API_KEY` as its credential
- **THEN** every invocation carries `--bare` and no neutralization flags, the child environment carries the API key and no OAuth token, and no invocation, environment, or guard behavior differs from the pre-change bare route

#### Scenario: The OAuth spelling runs the neutralized native profile

- **WHEN** the claude backend runs with `CLAUDE_CODE_OAUTH_TOKEN` as its credential
- **THEN** every invocation omits `--bare` and carries `--setting-sources ''`, `--strict-mcp-config`, and a `--mcp-config` document naming zero servers, and the child environment carries the OAuth token as its only Anthropic credential

#### Scenario: Both spellings set still fails before any spend

- **WHEN** both credentials are set on the claude backend
- **THEN** job startup fails under the existing exclusivity guard before any CLI process is spawned, unchanged by this profile split

### Requirement: The native profile's neutrality is census-pinned, not assumed

The claim that the native profile loads no repository state SHALL be pinned
by free, un-credentialed census recordings that the recorder re-asserts
whenever it runs and that a CLI pin move cannot silently break: the init
line's `mcp_servers` SHALL be the empty list (no repository `.mcp.json`
auto-connect), the loaded skills SHALL be the CLI's built-ins only (no
repository skill discovery), and the context census SHALL show no
memory-file loading (the repository's `CLAUDE.md` not in context — a
config-dir default this requirement promotes from coincidence to pinned
fact). The census legs SHALL run without credentials and without model
spend, so they can run anywhere, any time, at zero cost.

#### Scenario: The census asserts no repository surfaces

- **WHEN** the recorder's un-credentialed census leg runs the native profile and reads the init line and context breakdown
- **THEN** the MCP server list is empty, the skill list contains only built-in skills, and no memory-file category appears, and any deviation fails the recorder loudly

#### Scenario: A CLI pin move re-answers neutrality before any credentialed turn

- **WHEN** the pinned CLI version changes and the recorder is re-run
- **THEN** the free census legs run first, so a version that reintroduces repository state is caught at zero spend, before the credentialed proof turn is attempted

### Requirement: Confinement parity — the allowlist bounds the native toolset

The native profile exposes the CLI's larger built-in toolset, and tool
permission SHALL still be expressed as the same explicit `--allowedTools`
allowlists under `--permission-mode default`, pinned by a recorded refusal:
a turn whose prompt attempts a tool outside its profile's allowlist (the
recorded case: `WebFetch` under the `plan` allowlist) SHALL produce a
permission refusal with no tool effect — the `permission_denials`-shaped
outcome — never a granted call. No native invocation SHALL carry
`--dangerously-skip-permissions`, and no profile SHALL receive an allowlist
broader than its bare-profile counterpart.

#### Scenario: An unlisted built-in tool is refused on the native profile

- **WHEN** a native-profile turn's prompt attempts a `WebFetch` call, which is not on that profile's allowlist
- **THEN** the call is refused under `--permission-mode default` and produces no fetch, with the refusal recorded as the standing confinement pin

### Requirement: The OAuth carrier is proven by its subscription signature

The native profile's authentication SHALL be proven by a credentialed
recording, not assumed: a turn driven with the OAuth token SHALL resolve
with real reply text and emit the subscription-shaped rate-limit fact (the
`rate_limit_event` line's five-hour window signature), which is the
native-path proof because the init line's `apiKeySource` stays `none` on
this path and cannot serve. The recorder SHALL also pin the negative that
keeps it honest: a deliberately invalid token SHALL fail fast with the
recorded `api_error` result shape — the env token is authoritative over any
local keychain, so a local recording cannot silently authenticate through
the operator's own credentials. Until the credentialed proof exists on the
pinned CLI version, the native profile SHALL NOT be considered supported.

#### Scenario: The credentialed proof turn lands the subscription signature

- **WHEN** the recorder runs the native profile with a valid OAuth token
- **THEN** the turn resolves with reply text, and the stream carries the subscription rate-limit fact, stamped into the recorded facts alongside the CLI version

#### Scenario: An invalid token fails fast, proving the env token authoritative

- **WHEN** the recorder's negative leg runs the native profile with a deliberately invalid token
- **THEN** the turn fails promptly with the recorded `api_error` result shape rather than succeeding through any other local credential source

### Requirement: Secret handling is unchanged by the profile split

The OAuth token value SHALL remain covered by the pipeline's secret handling
on both profiles: joined to the scrub set by value, redacted from any log,
state block, or transcript entry by value, never named by value in any error
message, and never present in any invocation's arguments. The token reaches
exactly one place — the spawned CLI's environment on the native profile —
accepting the already-recorded residual that same-user children of the CLI's
own tool calls inherit that environment.

#### Scenario: Redaction covers the natively-injected token

- **WHEN** stream content or a failure diagnostic on the native profile would carry the token value
- **THEN** the transcript and any public log receive a redaction placeholder instead, exactly as for the API-key spelling

#### Scenario: No credential rides the argv

- **WHEN** any invocation is composed on either profile
- **THEN** the arguments name no credential value, the token travelling by environment alone
