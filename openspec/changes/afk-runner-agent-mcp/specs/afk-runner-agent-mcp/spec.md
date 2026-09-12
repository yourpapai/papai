<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets an afk-runner run give its stage agents MCP servers: an operator-declared server set validated before any run work, composed per spawn into the config content delivered to opencode children — authoritative over ambient configuration, narrowed per agent role, with dead servers degrading to bounded telemetry instead of failing the run.

## ADDED Requirements

### Requirement: Operator server configuration is validated before any run work

The MCP server configuration SHALL arrive only through the runner-level operator surface — environment knobs read and refused at start, the change's design selection (the config-schema-keys alternative was considered and rejected as the design records). It SHALL consist of a global base map of named servers plus an optional per-role narrowing map. A present-but-invalid configuration SHALL fail every verb that can spawn agents or spend budget, before any run work — before any agent spawn or budget spend — with an error naming the offending key and the shape problem; verbs that can neither spawn nor spend (status, report, stop, runs, analyze, serve) are not gated on the MCP surface, so the calm-stop channel stays available whatever the invocation's environment carries. Server names SHALL be non-empty and restricted to letters, digits, hyphen, and underscore (the alphabet safe to embed in a tool-name prefix), shall refuse the prototype-pollution names (`__proto__`, `constructor`, `prototype`) — checked over the raw parsed own keys, because a record-schema rebuild and assignment-style emission both silently drop `__proto__`, letting a declared server vanish without a refusal — and the base map SHALL refuse shadowing names at the same start-time validation: a name whose `name_` prefix is a prefix of another base-map name (the generated `<name>_*` permission keys glob over one flat tool-name namespace, and the recorded later-rule-wins ordering would let the wrong key win for overlapping wildcards whichever order they are emitted in), and a name whose `name_` prefix is a prefix of a built-in tool name on record (a generated key would otherwise deny or allow a built-in tool, breaking the non-MCP invariance requirement). Each entry SHALL declare its kind through a `type` field (`local` or `remote`): a local entry SHALL carry a non-empty command array and MAY carry environment values; a remote entry SHALL carry a url and MAY carry headers; an entry carrying an interactive OAuth shape SHALL be refused because no unattended run can complete it. Narrowing keys SHALL be members of the runner's closed role vocabulary (drafter, reviewer, skeptic, resolver, estimator, decomposer, atomicity, implementer, planner) and SHALL name only servers present in the base map.

#### Scenario: Valid declaration is accepted

- **WHEN** the operator surface holds a base map with one local entry (with `command`) and one remote entry (with `url`), plus a narrowing entry for `reviewer`
- **THEN** the verb starts the run and the declared set is available to the spawn-time composition

#### Scenario: Malformed value fails before run work

- **WHEN** the surface holds invalid JSON, an entry failing the shapes above, a server name outside the safe alphabet, a prototype-pollution server name, or a shadowing server name (of another base-map entry or of a built-in tool name on record)
- **THEN** the verb fails with an error naming the offending key and the shape problem, and no agent is spawned and no budget is spent

#### Scenario: Unknown role key is refused

- **WHEN** the narrowing map is keyed by a string outside the closed role vocabulary
- **THEN** the verb fails with an error naming that key before any run work

#### Scenario: Narrowing cannot mint servers

- **WHEN** a narrowing entry names a server absent from the base map
- **THEN** the verb fails with an error naming that server before any run work

#### Scenario: OAuth declaration is refused

- **WHEN** any entry carries an interactive OAuth shape
- **THEN** the verb fails with an error stating that unattended runs cannot complete an interactive authorization flow

### Requirement: Every opencode stage-agent spawn carries runner-composed config content

For every stage-agent spawn on the opencode route, the runner SHALL compose and serialize into the child's environment, as `OPENCODE_CONFIG_CONTENT`, a configuration carrying: the provider definition for the model reference the spawn passes, whenever that reference names a provider (`<provider>/<model>`) — a bare reference (no `/`) has no provider definition to carry and resolves through the binary's own catalogue and auth; a permission base covering the base map's MCP-delivered tools (a generated wildcard allow for each server in the spawn's resolved set, a generated wildcard deny for each server the role's narrowing sheds); and the `mcp` map for that set. The content SHALL reach the child as an explicit spawn option threaded through the command builder — the builder SHALL NOT read the invoking process's ambient environment to produce it. When the operator surface declares no servers, the injection SHALL be inert: the runner delivers no config content of its own and every spawn behaves exactly as before this change.

#### Scenario: Child environment carries the composed content

- **WHEN** a run with a configured server set spawns any stage agent — drafter, reviewer, skeptic, resolver, estimator, decomposer, atomicity, or implementer
- **THEN** the spawned opencode child's environment carries the serialized content holding exactly the spawn's resolved `mcp` entries and their grants

#### Scenario: The model resolves without ambient configuration

- **WHEN** a spawn with delivered content runs in an environment whose discovered config files define no provider
- **THEN** the turn proceeds rather than failing on an unresolvable model — a `<provider>/<model>` reference resolves from the delivered provider definition, and a bare reference resolves through the binary's own catalogue and auth

#### Scenario: Unset configuration changes nothing

- **WHEN** the operator surface declares no servers
- **THEN** the runner sets no config content for its children and spawns inherit and discover ambient configuration exactly as before this change

### Requirement: Delivered content is authoritative over discovered configuration

The delivered content SHALL overlay, not replace, configuration the opencode binary discovers: discovered entries the content does not name SHALL survive, and every same-key conflict — provider entry, `mcp` server entry, or permission leaf — SHALL resolve to the delivered content. No discovered configuration SHALL re-enable what the delivered permission base denies: every server the base map names is keyed allow-or-deny by construction, so a shed server's tools SHALL NOT be model-visible for that role, whatever a repo-local or global config file declares. The base's authority SHALL cover exactly the namespace it names: servers that exist only in discovered configuration are ambient configuration exercising their own authority over their own tools — the delivered content neither names nor keys them — and their visibility SHALL be exactly that of a content-free spawn, except under a name-prefix collision: a generated `<name>_*` key globs the binary's one flat tool-name namespace, so a discovered-only server whose name extends a base-map name (discovered `foo_bar` beside base `foo`) inherits that key's verdict — deny when the base name is shed, allow when granted — under the same content-is-final precedence, and no start-time validation can refuse it because discovered names are invisible at validation time (a documented residual: the non-MCP invariance requirement rules out the only verified catch-all deny, so this scope is revisited only if a deny shape that spares built-in tools is ever verified).

#### Scenario: Same-key conflict resolves to the delivered content

- **WHEN** the delivered content and a discovered config file define the same server or provider key differently
- **THEN** the delivered definition is the one that takes effect, and the discovered one never spawns or serves

#### Scenario: Discovered-only entries stay under ambient authority

- **WHEN** a discovered config file defines and self-grants a server the delivered content does not name
- **THEN** the entry loads under the overlay and keeps exactly the visibility a content-free spawn would give it — the delivered content neither names nor keys it, and no requirement in this capability governs it — unless its name extends a base-map server's name (`foo_bar` beside `foo`), in which case that server's generated key reaches its tools as the requirement's name-prefix-collision residual records

#### Scenario: A discovered file cannot grant back

- **WHEN** a discovered config file sets an allow for a tool of a server the delivered permission base denies (a base-map server shed by this role's narrowing)
- **THEN** the tool remains invisible to the agent — the delivered permission decisions are final

### Requirement: Global base set with per-role narrowing

The server set each spawn carries SHALL be the global base map minus the servers its role's narrowing entry removes. A role with no narrowing entry SHALL carry the full base set. Narrowing SHALL only remove; the per-role surface SHALL NOT introduce a server the base map lacks (refused at start per the validation requirement). Each spawn's `mcp` map and grants SHALL cover exactly the narrowed set, so a shed server's tools are unusable by that role's agents even while other roles carry them.

#### Scenario: A checking role sheds the work servers

- **WHEN** the base map carries a work server and a code-index server, and the narrowing entries for reviewer and skeptic remove the work server
- **THEN** reviewer and skeptic spawns carry only the code-index server in their content, while drafter, decomposer, and atomicity spawns carry both

#### Scenario: A role without narrowing carries the full base

- **WHEN** a role has no narrowing entry
- **THEN** its spawns' content carries every server in the base map with a grant for each

#### Scenario: A shed server is unusable by the narrowed role

- **WHEN** a role whose narrowing removed a server encounters that server's tools
- **THEN** the tools are absent from that role's model-visible tool table

### Requirement: Permission grants are allow-or-absent

Delivered permission grants SHALL be `allow` or absent — `ask` SHALL NOT be emitted for any MCP key: the spawn route auto-approves permissions that are not explicitly denied, so `ask` gates nothing on an unattended run and SHALL NOT be relied on as a hold-point. For each granted server the runner SHALL emit a generated wildcard allow covering that server's whole toolset, and SHALL copy no permission text from operator input. The permission base SHALL scope its deny to MCP-delivered tools: the delivered content SHALL NOT change the visibility or behavior of non-MCP (built-in) tools relative to an otherwise identical spawn with no delivered content.

#### Scenario: A granted server's tools are usable

- **WHEN** a spawn's resolved set includes a server that connects and supplies tools
- **THEN** the delivered content carries a wildcard allow for that server, its tools are model-visible, and a call to one round-trips

#### Scenario: No ask is ever emitted

- **WHEN** any spawn's delivered permission configuration is inspected
- **THEN** no MCP key carries `ask` — every emitted grant is an allow-valued wildcard or absent

#### Scenario: Non-MCP tool behavior is unchanged

- **WHEN** a spawn with delivered content runs beside an otherwise identical spawn without it
- **THEN** both spawns expose the same built-in tool surface and behavior, the content's permission effect reaching only MCP-delivered tools

### Requirement: Untrusted input never defines a server

The `mcp` block, the grants, and the server set SHALL derive solely from the operator surface. Task files, agent prompts and transcripts, gate answers, issue bodies, and chat text SHALL contribute nothing: no run-time text can define, add, remove, or narrow a server.

#### Scenario: A task file's MCP-shaped block is ignored

- **WHEN** a task file or issue body consumed by the run carries configuration-shaped text naming servers
- **THEN** the emitted content's server set is identical to a run without that text — derived only from the operator surface

#### Scenario: Agent output cannot reshape the set

- **WHEN** an agent's own output proposes or formats server configuration
- **THEN** no subsequent spawn's server set, `mcp` map, or grants change as a result

### Requirement: A dead server degrades to bounded telemetry, never a run failure

A server that fails to start, fails to connect, or never initializes SHALL NOT fail the run, its stage, or the agent turn: it degrades to bounded status data under the opencode binary's own connection timeout (the verified 30-second ceiling on the pinned route), its tools are simply absent, and the run proceeds. The runner SHALL NOT add per-server timeout machinery or unbounded status waits, and any status read it performs SHALL treat the binary's ceiling as its floor. Dead-server visibility SHALL be telemetry at the existing noise altitudes, which the run's fold tolerates and never drives on: an L1-class record at spawn time naming the agent and the servers that spawn carries (on the `opencode run` route the parent's only truthful spawn-time status is the declaration itself — connection statuses settle inside the child, with no parent-side status surface), and an L0-class record when a call targets a tool a dead server would have owned. Event payloads SHALL carry names, statuses, and counts only — never a server's environment values, header values, or any URL that embeds a token.

#### Scenario: A failing command never fails the run

- **WHEN** a configured local server's command fails at spawn time
- **THEN** the run's stages proceed with that server's tools absent and no run-level failure is declared for it

#### Scenario: A never-initializing server is bounded

- **WHEN** a configured server accepts the spawn but never completes initialization
- **THEN** no stage waits past the binary's own bound, the run proceeds once the status settles, and no run-level status wait is added on top

#### Scenario: Dead servers are visible as noise telemetry

- **WHEN** a spawn carries a server that ends up dead, and later a call targets a tool that server would have owned
- **THEN** an L1-class record names the agent and the server at spawn time, an L0-class record captures the orphaned call, and the run's decisions never drive on either

#### Scenario: Event payloads keep the discipline

- **WHEN** dead-server telemetry is emitted
- **THEN** payloads carry server names, statuses, and counts only — no environment values, header values, or token-bearing URLs from the configuration

### Requirement: Config credentials ride only the child environment and are never logged

The serialized content carries the provider credential and any credentials the operator's server declarations carry (remote headers, local environment values). It SHALL NOT be logged, echoed into run artifacts, or carried in any event payload; beyond the child environment and the content itself, the runner SHALL persist no part of the server configuration. The carrier variables themselves (`AGENT_MCP_SERVERS`, `AGENT_MCP_ROLE_NARROWING`, `LLM_API_KEY`, `LLM_BASE_URL`) SHALL be withheld from any child environment the runner composes — only the serialized content rides, so per-role narrowing never widens credential exposure beyond the content a spawn actually carries. The change's documentation SHALL state the residual exposure plainly — the spawned agent's own processes can read the content, so any credential in it is reachable by the model until the named credential-containment follow-up lands — and SHALL direct operators to prefer servers that need no credential in the content.

#### Scenario: The composed content is never logged

- **WHEN** any verb, log line, event, or run report touches the composed config content
- **THEN** only non-secret metadata (server names, statuses, counts) appears — never the content's value or any credential it carries

#### Scenario: The model-readable residual is documented

- **WHEN** the change's documentation is read
- **THEN** it states that credentials inside the delivered content are readable by the spawned agent's processes, and recommends servers needing no credential in the content until containment lands

### Requirement: Runner-level keying and the gating boundary

The server configuration SHALL key at the runner level only — the per-invocation operator surface — and SHALL NOT read from or write to any papai per-user, per-group, per-thread, or platform-instance storage; a run SHALL persist no server state anywhere. Runner-agent MCP tool calls SHALL be gated solely by the delivered permission maps: papai's per-context tool preferences neither gate nor are consulted for runner spawns, which carry no papai context. The change's documentation SHALL state this boundary, including the consequence that a runner agent consuming a papai-hosted MCP server authenticates by its binding token and bypasses papai's per-context tool-preference resolution — subject to the runner's permission maps alone.

#### Scenario: Nothing about servers persists

- **WHEN** a verb runs with a configured server set and exits
- **THEN** no server configuration or status persists in any store the runner or papai owns

#### Scenario: Gating resolves against the delivered permission maps only

- **WHEN** a runner agent makes an MCP tool call
- **THEN** the call is admitted or denied by the spawn's delivered permission configuration alone, with no per-context tool-preference resolution involved
