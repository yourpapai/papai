<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: MCP servers knob for the agent pipeline

## Context

See `proposal.md` — Why. The behavioural ground truth is already recorded in
`opencode-agent/docs/mcp-integration-research.md` (verified against
`opencode-ai@1.18.7`): tool naming `<server>_<tool>`; the `<server>_*` wildcard as the
grant key (bare name = silent no-op); global-only grants cancelled by a profile's
trailing `"*": "deny"`; `ask` deadlocks; OAuth remotes park at `needs_auth`; broken
servers degrade to status data bounded by the binary's own 30 s timeout; config-content
`environment` values reach spawned children. This design implements the research's §7
recommendation 1 and does not re-derive those facts.

Two code facts shape the seams: `buildOpencodeConfig` in `openai-config.ts` is the one
builder serving the in-process session and the review loop's `OPENCODE_CONFIG_CONTENT`
(so an `mcpServers` field on `OpenAiSettings` — the way `profiles` rides today — reaches
both by construction), and `pipelineSecrets` in `secrets.ts` is the one list both the
environment scrub and the outbound redaction read.

## Goals / Non-Goals

**Goals:**

- One maintainer-set knob, validated at job start, delivered identically to both
  execution paths, granted by generated wildcard keys, with declared credentials wired
  into the existing value-based scrub/redaction.
- An unset knob leaves the emitted configuration byte-identical to today's.

**Non-Goals:**

- Everything in `proposal.md` — Non-goals (opt-out knob, credential containment,
  repo-file surfaces, status surfacing, teardown handling).
- Accepting unverified config fields: the schema takes only `command`/`environment`
  (local) and `url`/`headers` (remote). `cwd`, `timeout`, `enabled` and the name-only
  disable arm exist in the SDK types but nothing in this pipeline needs them; an
  operator who wants a server off removes it from the knob.

## Decisions

### D1 — `propose` gets no MCP grant

The maintainer decision ("all agent profiles") predates `propose` (the D8
artifact-drafting profile). Its map is deliberately the most confined — read plus edit,
diff-guard-scoped, no `bash` — and MCP tools would be its only unconfined egress: a
prompt-injected drafting turn with a remote MCP server gains an exfiltration channel no
other grant in that profile permits. Drafting turns also compose prose, not tool calls.
*Alternative — grant all three profiles for symmetry:* rejected; symmetry with a
profile whose defining property is confinement is not a virtue.

### D2 — `oauth: false` is forced, and an `oauth` object is refused at parse

Forcing beats requiring: a maintainer who omits the field still gets the clean
`failed`-with-HTTP-error degradation instead of a job silently parked at `needs_auth`.
Refusing the object beats ignoring it: every `McpOAuthConfig` field is browser-shaped,
so an object can only ever express an intent the runner cannot honour — refusing names
the mistake at load time. The parse rejection and the emission forcing are two halves of
one rule; each alone leaks (parse-only would still emit user-set values verbatim if the
schema ever widened; emit-only would let a typo'd `oauth: {...}` read as accepted).

### D3 — Grants are generated beside the existing allows, never configurable

`grant()` composition gains the MCP keys after the named allows in each map (order
matters: the resolved rules list is an ordered concatenation and the later rule wins,
which is why the allows already sit after `"*": "deny"`). The key is always
`<name>_*` — the form verified to admit the whole toolset. Because the key is
generated, the research's "grant-key typo guard" follow-up dissolves: a bare-name key
cannot be written through any surface this change ships. It returns only if the deferred
opt-out knob ever introduces hand-keyed grants.

### D4 — New module `mcp-servers.ts`, the `check-spec.ts` pattern

`AGENT_MCP_SERVERS` is the second non-scalar knob: a Zod schema (repo convention for
config boundaries) over a JSON document, a two-stage refusal naming the variable and
the shape problem, re-exported through `config-values.ts` the way `parseChecks` is.
`config-values.ts` itself stays scalar-only by its own stated seam; `check-spec.ts`
covers checks specifically and none of the existing modules covers MCP declaration
shapes. Server names are validated as `[A-Za-z0-9_-]+` because the name is embedded in
tool names and permission keys. The parsed result rides `OpenAiSettings.mcpServers`
(optional, absent = none), so `buildOpencodeConfig` stays synchronous and both
execution paths and `pipelineSecrets` read one field.

### D5 — Workflow spelling: `secrets.AGENT_MCP_SERVERS || vars.AGENT_MCP_SERVERS`

Token-bearing values belong in a secret (registered secrets are masked in Actions logs;
variables are not). Token-free definitions may live in a plain variable, which is
visible to non-admin maintainers and diffable in settings. The secret wins when both
are set, matching the workflow's existing `secrets.AGENT_GITHUB_TOKEN ||
secrets.GITHUB_TOKEN` precedent. `.github/workflows/` is a protected path the agent's
own token cannot push, so this line rides the PR and a maintainer merges it — the knob
is inert until then, same as every `AGENT_*` forwarding line.

### D6 — Silence on server failure, no status reads

The binary's own degradation (status data, tools absent, 30 s bound, job unaffected) is
the whole failure story; the pipeline adds no timeout and no `GET /mcp` poller, which
the research measured blocking up to the 30 s floor. Whether the `/event` stream
carries a cheaper MCP status signal is deliberately not investigated: acting on it
would change the spec'd silence, so it belongs to the opt-out/status follow-up, not
here.

## Capability gating, scope model, dependencies, hooks

- **Gating:** the tool-prefs model that matters here is the OpenCode profile permission
  maps (`plan`/`propose`/`build`), not papai's `tool_prefs` — this workspace has no
  chat-platform surface. Papai's own tool gating, plugins and MCP adapter (`src/mcp/`)
  are untouched; nothing under papai's `src/` imports anything from this workspace.
- **Scope model:** no persisted state of any kind — no storage/config context ids, no
  platform instance, no DB rows. The knob lives in repository Actions settings; the
  run's interaction with it is read-at-load.
- **DB / dependencies:** no migration, no new dependency. Zod is already the workspace
  config-boundary validator; the `@opencode-ai/sdk` `Config['mcp']` types type the
  emitted block (with `oauth: false` in the remote arm matching `McpRemoteConfig`).
- **Hooks / TDD:** the Write/Edit TDD hook pipeline gates the new
  `opencode-agent/src/mcp-servers.ts` and every edited `src/` file — tests first:
  `tests/opencode-agent/mcp-servers.test.ts` (parse/refusals), config-emission
  assertions in the existing `openai-config` suite shape (mcp block, grant keys,
  byte-identical-unset), and a `pipelineSecrets` collection case. The new source file
  enters the Stryker per-file ratchet when the PR measures it.

## Risks / Trade-offs

- [A knob credential is model-readable via config content (S3-9).] → Documented in the
  README entry with the guidance (unauthenticated locals; afford-to-expose tokens);
  `pipelineSecrets` wiring keeps it out of logs and outbound text; containment is the
  named follow-up.
- [Review-loop fan-out multiplies local-server boots and egress connections.] →
  Documented beside `AGENT_REVIEW_POOL_SIZE` (default 1); not a code problem.
- [Pin drift invalidates the verified behaviours the design leans on.] → The config
  emission is pinned by unit tests, which survive a bump; the binary-behaviour claims
  carry the research doc's §1.1 re-verification note (its follow-up list, not a task
  here).
- [A wide schema would invite unverified fields.] → D4/Non-goals: minimal schema;
  unknown fields refused by the Zod schema rather than passed through.
- [Users `bunx` unpinned servers.] → README guidance to pin exact versions in
  `command`; the ephemeral runner refetches every job either way (research §1.4 row 5).

## Migration Plan

Additive: an unset knob is byte-identical to today (asserted by test). Rollback is
revert; no persisted state, no state-block shape change, no `STATE_VERSION` interest.
The workflow line lands in the same PR as the code — until merged, the knob is simply
never set, which is the unset case.

## Open Questions

None — the deferrable items (opt-out, containment, repo-file surfaces, status
surfacing) are named Non-goals/follow-ups, and each would change scope, not approach,
if reopened.
