<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Migrating kiss's MCP Server Fleet into papai Plugins

> Design spec. Closes Gap #4 (and part of Gap #5) from
> `kiss-vs-papai-nerv-magi-geofront-gap-analysis.md`: kiss ships ten first-party MCP servers; the
> quartet ships ~one. This migrates kiss's fleet into papai as first-class plugins that coding
> agents consume through the **existing** MCP delivery pipeline, with **zero changes** to magi,
> geofront, the broker, or the in-sandbox tunnel.

## Goal

Give the sandboxed coding agent access to kiss's integrations (Confluence, Figma, GitLab, Mattermost,
RAG, Sentry, TeamCity, YouTrack, plus a test canary) by re-implementing each kiss MCP server as a
native papai plugin exposed via the `mcpServer: true` surface. Full parity with kiss's fleet, plus a
generic port of kiss's response-redaction security layer.

## Background: the three layers that make this cheap

Research across kiss, papai, magi, and geofront established that papai already has a purpose-built
surface for exactly this, and that using it requires no work downstream of papai.

**kiss's servers (source shape).** All ten are stdio processes on `@modelcontextprotocol/sdk`, each
shaped as `createServer(client)` with a hand-rolled `fetch`-based upstream client, env-var
credentials, and — for four of them — an internal-model PII/secret redaction layer in
`mcp/shared/`. Launched via jiti from `mcp/<name>-mcp/index.ts`; assembled for the agent by
`src/services/McpConfigBuilder.ts` into qwen `settings.json`.

**papai's `mcpServer: true` surface (target shape).** When a plugin manifest sets `mcpServer: true`,
papai _itself_ hosts that plugin's already-registered tools as a stateless streamable-HTTP MCP server
at `/mcp/plugin/<pluginId>` (`src/mcp-server/{server-route,plugin-bridge,token}.ts`). Auth is a
signed, 30-day, context-bound capability token (`mintPluginMcpToken`), re-checked on every redemption.
The plugin runs no server and declares no URL/command — it just calls `registration.registerTool`.
`plugins/synthetic-web-search` is the working reference (its `search` tool reaches coding agents today).

**Delivery to the coding agent (unchanged pipeline).** `plugins/acp/session-tools.ts` already forwards
`projectSpec.mcp[]` + `mcpTokens` to magi on `POST /sessions`. magi validates the spec
(`spec-validation.ts`, HTTPS + host-allowlist + ≤8 upstreams), stands up a **credential-holding worker
enclosure per upstream** (a nested geofront sandbox holding exactly that upstream's token, egress
locked to its host), a host-side mediator, and an optional per-tool gate. geofront bind-mounts the
mediator socket into the agent sandbox via `--mcp-mount` (`/run/magi/mcp.sock`); the agent spawns
`mcp-tunnel` per declared server as a stdio↔socket splice. **magi treats a `plugin:<id>` internal
server identically to any external HTTPS catalog upstream** — the only difference is a papai-minted
token instead of a vaulted one.

The consequence: migrating a kiss server = re-implement its tools as papai plugin tools and flip
`mcpServer: true`. Nothing in magi, geofront, the worker enclosure, `--mcp-mount`, `mcp-tunnel`, or the
ACP handshake changes.

## Approach (decided)

**Approach A — native `mcpServer: true` plugins — chosen** over (B) keeping kiss's servers as
standalone processes catalogued as external upstreams (rejected: the operator catalog requires HTTPS
upstreams, kiss's are stdio, so B means wrapping + self-hosting each server separately, with no papai
governance and no per-context config), and (C) a hybrid (used only for the genuinely ill-fitting
`npm_publish`).

Approach A is the only option that is genuinely "papai plugins connectable to coding agents," and it
requires zero work downstream of papai. Governance (per-tool allow/ask/deny), credential isolation,
minted capability tokens, and per-context enablement all come for free.

## Architecture & plugin shape

One papai plugin per kiss server, under `plugins/mcp-<service>/`, cloned from the
`synthetic-web-search` shape:

```
plugins/mcp-<service>/
  plugin.json        # mcpServer:true, permissions:["http"], providerAllowedHosts, configRequirements,
                     # optional mcpResponseRedaction:true
  index.ts           # factory: activate() registers each tool via registration.registerTool
  client.ts          # thin upstream client built ONLY on providerRuntime.httpFetch
  tools/*.ts         # per-tool input parse + client call + format
  input-schema.ts    # zod schemas
  format.ts          # response shrinking/normalization (ported from kiss simplify/format)
  redaction-prompt.md # only for redacting plugins (ported from kiss .promt categories)
  README.md
```

**One plugin per server** because papai's approve / enable / config / tool-policy granularity is
per-plugin — that is what lets an operator enable Confluence but not Figma and set per-tool policy.

**Runtime data flow (all pre-existing):**

```
plugin tools ──registerTool──▶ papai contributionRegistry
   │ (mcpServer:true)
   ▼
papai /mcp/plugin/<id>  ──minted token, streamable-HTTP MCP──▶
   catalog entry "plugin:<id>"  ──resolveMcpServers──▶ acp start_session
   ──POST /sessions {projectSpec.mcp[], mcpTokens}──▶ magi
   ──worker enclosure (holds token) + mediator + per-tool gate──▶ geofront --mcp-mount
   ──/run/magi/mcp.sock──▶ mcp-tunnel (in sandbox) ──stdio──▶ coding agent
```

**Two hard constraints this shape imposes** (both handled by the reference plugin):

1. **All outbound network goes through `providerRuntime.httpFetch`**, which enforces
   `providerAllowedHosts`. Each plugin declares its upstream host(s) in the manifest, and clients are
   plain-fetch re-implementations — **no** `@mattermost/client`, `@gitbeaker/rest`, or Figma SDK, since
   those do their own network I/O and would bypass the allowlist.
2. **Tools run in papai's process**, bound to the calling `{storageContextId, chatUserId}` from the
   token — stateless request handlers, exactly as `callPluginMcpTool` already invokes them.

**Special cases:**

- **`mcp-npm` (`npm_publish`) — out of scope for papai-hosting.** A papai-hosted tool runs in papai's
  process, but the package being published lives in the geofront sandbox, not papai. Hosting it in
  papai is architecturally backwards. Documented as a deliberate exception; recommended to live
  sandbox-side in magi. Effective papai plugin count is **9**.
- **`mcp-gitlab` — read-first.** Reuses no kiss code (a fresh thin client). Read tools ship; write
  tools (`post_comment`, `create_discussion`, `update_mr`, `set_mr_state`) are deferred/optional since
  they overlap magi's forge-write domain.

## Generic response-redaction capability

Ports kiss's `mcp/shared/` internal-model redaction as a reusable capability applied at papai's single
choke point: `callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts` — the one place a plugin tool's
output becomes an MCP response bound for the coding agent. It is **not** hard-coded into four plugins.

**Opt-in surface:**

- Manifest flag `mcpResponseRedaction: true` (new optional boolean on `pluginManifestSchema`).
- Each opting-in plugin ships a default `redaction-prompt.md` (ported from kiss's per-server `.promt`
  categories: NAME, PHONE, EMAIL, PASSPORT, INN, SNILS, ADDRESS, CONTRACT, SPECIAL, BIOMETRIC, COMPANY,
  SECRET, APIKEY, PII), overridable per-context via config.
- Internal-model credentials live in **operator admin config** `mcp_redaction`
  (`{ modelUrl, apiKey, modelName, timeoutMs }`) — the papai equivalent of kiss's `INTERNAL_MODEL_*`.

**Redactor internals (ported from `mcp/shared/{internalModel,validatedAnswer,answerMcp}.ts`):**

1. Call the configured internal model (OpenAI-compatible `chat/completions`) with the plugin's
   redaction prompt + the tool output.
2. Parse a JSON findings array `[{string, redacted}, …]`; apply longest-match-first substring
   replacement `value → [LABEL]`.
3. **Fail-closed**: on any error (model call, timeout, JSON parse), return a block marker
   (`isError: true`, text `[RESULT BLOCKED BY VALIDATION: <reason>]`) rather than raw bytes.
4. Optional size-guard: outputs over a threshold are truncated with a note. (papai's bridge is
   stateless HTTP — no `~/.qwen` file-spill like kiss; this is a simple cap, not a resource handoff.)

**Two deliberate properties:**

- **Fail-closed eligibility.** A plugin with `mcpResponseRedaction: true` while `mcp_redaction` is
  unconfigured is `config_missing` → ineligible for the MCP-server path. PII-bearing tools can never
  silently ship unredacted (matches kiss's "fail loudly").
- **MCP-path-only scope.** Redaction fires at the `/mcp/plugin` bridge — only when output goes to the
  coding agent. The same plugin tool used as an ordinary papai _chat_ tool is not redacted, because
  that path stays inside papai's own trusted orchestrator LLM, not the sandbox.

Marked `mcpResponseRedaction: true`: **confluence, mattermost, sentry, youtrack** (kiss's four).

## Per-server plan

All plugins: `mcpServer: true`, `permissions: ["http"]`, `providerAllowedHosts` set to the upstream.
"Cred scope" is the per-plugin **default**; every key is context-overridable.

| Plugin           | Tools                                                                                                                                                                                                                       | Upstream host        | Cred keys · default scope                                                | Redact |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ | ------ |
| `mcp-confluence` | 5: get_page, get_page_by_title, get_comments, add_comment, resolve_short_link                                                                                                                                               | `wiki.skbkontur.ru`  | base_url, username, password (Basic) · **admin**                         | ✅     |
| `mcp-figma`      | 7: get_file, get_file_nodes, get_images, get_file_styles, get_style, get_components, get_comments                                                                                                                           | `api.figma.com`      | token · **context**                                                      | —      |
| `mcp-gitlab`     | read-first: get*repository_tree, get_file_content, get_mr_info, get_mrs, get_job *(writes deferred: post*comment, create_discussion, update_mr, set_mr_state)*                                                              | internal GitLab host | base_url, token · **admin**                                              | —      |
| `mcp-mattermost` | 5: get_post, get_thread, get_channel_posts, create_post, download_attachment                                                                                                                                                | Mattermost host      | url, access_token · **admin**                                            | ✅     |
| `mcp-rag`        | 1: rag_search                                                                                                                                                                                                               | RAG host             | api_key, context_code, sources, base_url, source_description · **admin** | —      |
| `mcp-sentry`     | 7: get_projects, search_issues, get_issue, get_issue_events, get_issue_tag_values, get_issue_comments, get_issue_details                                                                                                    | Sentry host          | base_url, token, org_slug · **admin**                                    | ✅     |
| `mcp-teamcity`   | 4: get_projects, get_project_config, get_project_pipelines, get_pipeline_config                                                                                                                                             | TeamCity host        | base_url, token · **admin**                                              | —      |
| `mcp-youtrack`   | 14: get_issue, get_state_activities, get_comments, add_comment, create_issue, update_fields, get_issue_tags, add_issue_tag, remove_issue_tag, set_tags, set_issue_link, get_field_options, get_attachments, read_attachment | `yt.skbkontur.ru`    | base_url, api_key · **context**                                          | ✅     |
| `mcp-test`       | 1: test (canary)                                                                                                                                                                                                            | none                 | none                                                                     | —      |
| ~~`mcp-npm`~~    | `npm_publish`                                                                                                                                                                                                               | —                    | **Out of scope** — belongs sandbox-side (magi); documented exception     | —      |

Notes:

- **9 papai plugins** ship; `npm` is the documented exception.
- `mcp-youtrack` overlaps the existing `task-provider-youtrack` plugin but is distinct: agent-facing
  read/comment/attachment tools, not papai's orchestrator task provider. Fresh thin client, no shared
  code.
- `mcp-gitlab` and `mcp-mattermost` re-implement their clients as plain `httpFetch` (kiss used
  `@gitbeaker/rest` / `@mattermost/client`, which would bypass the allowlist).
- `mcp-test` is kept as a live end-to-end canary proving the `/mcp/plugin` → sandbox path per deploy.

## Config, enablement & tool-policy model

**Per-plugin config** — `configRequirements` per manifest, with the scoping above. Tokens/passwords are
`sensitive: true`; base URLs carry kiss's defaults (`wiki.skbkontur.ru`, `yt.skbkontur.ru`,
`api.figma.com`) so only the secret is required. A plugin missing a required key is `config_missing` →
ineligible for that context (fail-closed).

**Operator → user enablement flow (all existing surfaces, no new plumbing):**

1. **Approve** the plugin in settings (keyed to manifest hash).
2. **Enable as internal MCP server** via `mcp_plugin_servers` admin config
   (`src/coding-credentials/mcp-plugin-servers.ts`) and set per-tool `allow`/`ask`/`deny`. Requires
   `SETTINGS_PUBLIC_BASE_URL` (fail-closed otherwise).
3. **User selects** `plugin:<id>` in their "Coding MCP servers" section. No token stored — one is
   minted per session by `mintPluginMcpToken`.

**Default tool policies (secure-by-default):**

- **Reads** (`get_*`, `search_*`, tree/file/issue/thread) → `allow`.
- **Corporate writes** (`confluence_add_comment`, `mattermost_create_post`, all `youtrack` mutations,
  any enabled `gitlab` writes) → `ask` by default.
- **Highest-risk writes** (issue/MR state changes: `set_issue_link`, `set_mr_state`, `update_mr`) →
  **`deny`** by default.

> **Caveat (record explicitly).** magi's gate currently fails `ask` open to `allow`
> (`magi/src/mcp-broker/gate.ts:153`, "not wired up yet"). Until that is fixed, `ask` ≈ `allow`. That
> is why highest-risk writes default to `deny`, not `ask`. Fixing the `ask` fail-open is a magi-side
> follow-up, out of scope here.

**Redaction config:** operator sets `mcp_redaction` admin config. Unset while any redacting plugin is
enabled → those plugins ineligible.

## Core changes beyond the plugins

Everything else is plugin-local; the only core edits are:

1. `src/plugins/types.ts` — add optional `mcpResponseRedaction: boolean` to `pluginManifestSchema`.
2. `src/mcp-server/plugin-bridge.ts` — add the redaction post-processor in `callPluginMcpTool` (reads
   `mcp_redaction` admin config, applies the plugin's redaction prompt, fail-closed).
3. New `mcp_redaction` admin-config surface + settings wiring (internal-model creds).

## Testing

Follows papai's DI-first plugin pattern and TDD write-hooks.

- **Per tool**: input-schema validation (`schemaValidates()`), client call with mocked fetch
  (`setMockFetch()`/`restoreFetch()`), response formatting. Clients take an injectable `httpFetch` (like
  `synthetic-web-search`) so tests never hit the network.
- **Redactor unit tests**: findings-JSON parsing, longest-match-first substitution, fail-closed path
  (model error/timeout/bad JSON → block marker, `isError`). Internal model mocked.
- **Bridge integration**: `callPluginMcpTool` applies redaction only when the plugin opts in; verifies
  the MCP-path-only scope (chat-tool path unaffected).
- **Manifest tests**: `mcpServer: true`, `permissions`, `providerAllowedHosts`, `configRequirements`,
  and `config_missing` eligibility when a required key is unset.
- **Live canary**: `mcp-test` exercised through the real `/mcp/plugin/<id>` route end-to-end.

## Implementation sequencing (waves)

Each wave is independently shippable — a plugin is usable the moment it is approved + enabled.

1. **Core foundation** — `mcpResponseRedaction` manifest field; bridge redactor; `mcp_redaction`
   admin config + reader. No plugins yet.
2. **Reference plugin** — `mcp-sentry` end-to-end _with redaction on_ (proves the whole pattern
   including the new core hook).
3. **Non-overlapping batch** — `mcp-confluence`, `mcp-figma`, `mcp-rag`, `mcp-teamcity`.
4. **Overlapping batch** — `mcp-youtrack`, `mcp-gitlab` (read-first), `mcp-mattermost`.
5. **Canary + docs** — `mcp-test`; update `coding-stack-overview.md`, `plugins.md`; note the `npm`
   exception and the magi `ask`-fail-open follow-up.

## Success criteria

- Every plugin's tools are callable by a coding agent via `/mcp/plugin/<id>` with **zero
  magi/geofront changes**.
- Redaction verified fail-closed for confluence/mattermost/sentry/youtrack.
- Per-tool `allow`/`ask`/`deny` honored; highest-risk writes default `deny`.
- `bun check:full` green (tests, format, lint, knip, types).
- `npm_publish` documented as a deliberate sandbox-side exception with a magi follow-up note.

## Out of scope / follow-ups

- **`npm_publish`** as a sandbox-side (magi) capability.
- **magi `ask` fail-open fix** (`gate.ts:153`) — required before `ask` policies are meaningful.
- **`mcp-gitlab` write tools** — deferred pending a decision on the papai/magi forge-write boundary.
- **RAG / internal-host reachability** — several upstreams (Confluence, RAG, TeamCity, internal
  GitLab, YouTrack) are internal corporate hosts; the coding-agent worker enclosure's egress must be
  permitted to reach them (operator egress-ceiling config), otherwise these servers are unreachable
  from the sandbox regardless of the papai plumbing.
