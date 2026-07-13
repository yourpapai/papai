<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-ups · FU1: MCP Wire Alignment + Stream-Drain Fix (design)

> **Context.** First sub-project of the post-migration follow-ups program. Two independent hardening
> fixes surfaced by the migration's final reviews. Detailed to writing-plans level.
>
> **Repos touched.** `nerv` (the MCP alignment) + `papai` (a one-line stream-drain). **magi: no code**
> — magi's MCP request contract is already internally consistent; the fix is entirely nerv-side.
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-12) in the nerv/magi/papai repos.

## Decisions of record

1. **The fix is nerv-side.** magi reads `projectSpec.mcp: McpUpstream[]` (array) + `mcpTokens:
Record<string,string>` (keyed by upstream `id`) consistently on start/follow-up/resume; nerv sends a
   single `mcp` object + a singular `mcpToken` string — the wrong shape. Align nerv to magi.
2. **Minimal single-upstream.** nerv resolves exactly one MCP gateway today, so send it as a
   **one-element `McpUpstream[]` array + a one-entry `mcpTokens` record**. Do NOT build a full
   multi-upstream config model (YAGNI; extend later if a real need appears).
3. **No Project schema change.** `Project.mcpToken` stays a single string in the DB; the pluralization
   happens at the wire layer (wrap `{ [id]: mcpToken }` at send time).
4. The transcript stream-drain is a one-line `upstream.body?.cancel()` on the non-ok branch.

## Key findings (grounding — the mismatch, reframed)

- **nerv sends the wrong shape on ALL three paths.** `MagiClient` (`nerv/src/services/MagiClient.ts`)
  sends a singular `mcpToken: string` — `startSession` (`:80-82`, `StartSessionInput.mcpToken?: string`
  `:51`), `followUp` (`:90-103`), `resumeSession` (`:112-123`) — and `projectSpec.mcp` as a single object
  `MagiMcpSpec` (`:20-26,41`, built in `SupervisorService.ts:70-96` as one `mcpDescriptor`, fields
  `{url,host,header,allowedHosts,toolPolicy}`, **no `id`**). The token originates as a single string:
  `resolveMagiCredentials` (`nerv/src/supervisor/magiCredentials.ts:16-36`) → `MagiCredentials.mcpToken?:
string`, from `Project.mcpToken` (`nerv/src/db/models/Project.ts:34-35,64`, a single Mongoose `String`)
  or `MagiProjectDefaults.mcpToken` (`SupervisorService.ts:24`).
- **magi is internally consistent and reads plural, everywhere.** `handleStart`/`handleFollowUp`/`handleResume`
  (`magi/src/server/router.ts:104,239,271`) all read `asStringRecord(body['mcpTokens'])`;
  `StartSessionInput`/`FollowUpSessionInput`/`ResumeCredentials` all have `mcpTokens?: Record<string,string>`
  (`magi/src/session/state.ts:97,115,136`). `asStringRecord` (`router.ts:33-40`) returns `{}` for a
  missing/misnamed field — so nerv's singular `mcpToken` is **silently dropped to `{}`**, never an error.
- **`projectSpec.mcp` must be an ARRAY — start hard-fails otherwise.** `resolveMcp`
  (`magi/src/project/spec-validation.ts:139-142`) throws `projectSpec.mcp must be an array` for a
  non-array; `handleStart` catches it → **HTTP 400** (`router.ts:98-102`). So **any nerv task with `mcp`
  configured fails to start today.** It's only invisible because no Project has `mcp` populated (then
  `mcp === undefined`, skipped) — there is **no working path**, not a partially-working one.
- **Canonical shape (magi's).** `McpUpstream` (`magi/src/project/config.ts:69-76`):
  `{ id, url, host, header, allowedHosts, toolPolicy? }`; `ProjectSpec.mcp?: McpUpstream[]` (`:92`).
  `mcpTokens` is keyed by `McpUpstream.id` — `mcpLaunchConfigs` (`magi/src/session/helpers.ts:68-75`)
  does `tokens[entry.id]` and **throws** if an upstream has no matching token. The `id` is also the ACP
  server name / tunnel tag / mediator routing key (CSV-joined in `lifecycle.ts:123-126`), constrained by
  `MCP_ID_PATTERN`.
- **transcript stream-drain** (`papai/src/debug/transcript-viewer.ts:79-81`): `proxyTranscriptStream`'s
  `if (!upstream.ok || upstream.body === null)` branch returns a fresh `Response` without cancelling
  `upstream.body` — on a non-2xx response that still has a body, the stream is left un-drained (a
  connection leak). The success path (`:82`) is the only place `upstream.body` is consumed.

---

## Component A — align nerv's MCP forwarding to magi's contract (nerv)

**A stable upstream `id`, computed once.** Define the single gateway's `id` in one place (used for BOTH
the `mcp[]` entry and the `mcpTokens` key so they always agree) — a stable value matching magi's
`MCP_ID_PATTERN` (derived from the gateway's config name if one exists, else a fixed constant like
`'gateway'`). The id is NOT persisted; it's synthesized at spec-build time.

**Spec shape (`SupervisorService.ts` MCP descriptor build):** change the resolved `projectSpec.mcp` from a
single `MagiMcpSpec` object to a **one-element array** `[{ id, url, host, header, allowedHosts, toolPolicy }]`
(the `McpUpstream` shape). nerv's `MagiClient` `mcp` field type changes from `MagiMcpSpec` (object) to
`McpUpstream[]` (array) accordingly.

**Token shape:** change the wire token from singular `mcpToken: string` to **`mcpTokens: Record<string,string>`
keyed by the same `id`** (`{ [id]: mcpToken }`), on `StartSessionInput`, `followUp`'s opts, and
`resumeSession`'s opts. `MagiCredentials` gains `mcpTokens?: Record<string,string>` (replacing
`mcpToken?: string`); `resolveMagiCredentials` builds the record from the single `Project.mcpToken` (unchanged
in the DB) + the id — returning `undefined`/`{}` when no token, so a Project WITHOUT MCP still sends
nothing (and start still succeeds, unchanged).

**All three `MagiClient` calls** (`startSession`/`followUp`/`resumeSession`) send `mcpTokens` (record) and,
for start, the array-shaped `projectSpec.mcp`. Follow-up/resume reuse the parent's validated `projectSpec`
(magi side) so they only need the token record right.

**Net effect:** a nerv task with MCP configured **starts** (no 400) and the gateway token reaches the
coding agent on start, follow-up, and resume.

## Component B — transcript stream-drain (papai)

In `proxyTranscriptStream` (`papai/src/debug/transcript-viewer.ts:79-81`), cancel the upstream body on the
non-ok/early-return branch: `void upstream.body?.cancel()` before returning the error `Response`, so a
non-2xx upstream stream response doesn't leak the connection.

---

## Cross-repo contract summary

| #   | Interface         | Producer → Consumer | Change                                                                                          |
| --- | ----------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `projectSpec.mcp` | nerv → magi         | single object → `McpUpstream[]` (one element, with `id`)                                        |
| 2   | mcp token         | nerv → magi         | singular `mcpToken` → `mcpTokens: Record<string,string>` keyed by `id` (start/follow-up/resume) |

## Testing strategy

- **nerv:** with a Project that has MCP configured, `SupervisorService` produces `projectSpec.mcp` as a
  one-element `McpUpstream[]` (with a valid `id`) and `mcpTokens` as `{ [id]: token }` — the shape magi's
  `resolveMcp`/`mcpLaunchConfigs` accept (no 400, token present); the id is identical in `mcp[].id` and the
  `mcpTokens` key; `startSession`/`followUp`/`resumeSession` all carry `mcpTokens`. A Project WITHOUT MCP
  sends no `mcp`/`mcpTokens` (unchanged behavior). Consider a contract-style test asserting the emitted
  body matches magi's `McpUpstream`/`mcpTokens` expectations.
- **papai:** `proxyTranscriptStream` with a non-ok upstream (body present) cancels `upstream.body` (spy
  on `cancel`) and returns the error response.

## Out of scope / deferred

- A full **multi-upstream MCP config model** for nerv (stays single-gateway, wrapped in a one-element
  array). If nerv ever needs multiple upstreams, this is the extension point.
- Any **magi** change (magi's contract is correct and load-bearing — `mcp` array + `id`-keyed `mcpTokens`).
- Any **Project schema** change (`mcpToken` stays a single string; pluralization is wire-only).

## Open assumptions (resolve during planning)

- The exact stable **`id`** to synthesize for the single gateway — whether nerv's resolved MCP descriptor
  (or `Project.mcpServers`) already carries a natural name to use, or a fixed `'gateway'` constant is
  cleanest. It must match magi's `MCP_ID_PATTERN` and be identical between the `mcp[]` entry and the
  `mcpTokens` key.
- Whether nerv's `MagiMcpSpec` type is reshaped to magi's `McpUpstream` directly or a nerv-local equivalent
  — confirm the field set matches (`toolPolicy` optional).
