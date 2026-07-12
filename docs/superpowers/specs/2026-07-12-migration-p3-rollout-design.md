<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai Migration · Phase 3: Rollout & Polish (design)

> **Parent roadmap.** `2026-07-11-kiss-to-papai-migration-roadmap-design.md` (phase P3, the final phase).
> Builds on completed P0/P0.5/P0.6, P1, P2. Details P3 to the level needed for a writing-plans plan.
>
> **Goal.** Make the migration _operable_: a shadow-run runbook, a config importer (kiss Projects →
> nerv/papai config), and a working live-transcript layer so users can watch a coding session.
>
> **Repos touched.** `papai` (most of it) + `nerv` (importer target + one notify field). **magi: no code**
> — the transcript layer reuses magi's existing bearer-gated transcript endpoint.
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-12) in the kiss/nerv/magi/papai repos.

## Decisions of record

1. **All three parts** in scope: shadow-run runbook, config importer, transcript restore.
2. **papai owns the transcript capability token** — it mints a signed token → `magiSessionId` and proxies
   to magi's EXISTING bearer-gated `GET /sessions/:id/transcript`+`/stream`. magi builds no `shareToken`
   and no public route.
3. **Transcript reach = ACP + nerv tasks.** ACP surfaces the link directly (it holds the sessionId); nerv
   surfaces it by passing `magiSessionId` in the `/api/notify` payload and letting papai mint + append the
   link.
4. **Importer is a standalone `--dry-run`/`--apply` script** writing nerv Mongo + papai `coding_guardrails`
   directly (no nerv create-API exists). No cred import (kiss creds are global env), no per-user vault
   import (kiss has none), and the channel→context binding is left to `/nerv bind` (printed as operator steps).

## Key findings (grounding)

- **kiss `Project`** (`kiss/src/models/Project.ts:56-102`, Mongo): `channels[]`, `repositories[]`
  (`ProjectRef` `kiss/src/types/index.ts:8-19`: `projectPath`/`description`/`defaultBranch`/`worktreeSubdir`/`pipelineJobTrackList`),
  `mcpServers[]`, `modelProvider`(+`maxTaskCost`), `autoReview`, `selfReviewEnabled`, `enabled`. **No
  per-integration cred fields** — figma/youtrack/etc. are global env (`kiss/src/services/SecretStoreBootstrap.ts`
  `PROJECT_ENV_KEYS`). kiss `ProjectService` is read-only; **no `Project.create` anywhere** — kiss Projects
  are provisioned by direct Mongo writes.
- **nerv `IProject`** (`nerv/src/db/models/Project.ts:18-71`): `contextIds[]`, `notifyContextId?`,
  `repositories[]`, `mcpServers?`, `modelProvider?`, `model?`, `forge?`, `forgeToken?`, `secrets?`,
  `autoReview?`, `selfReviewEnabled?`, `costBudgetUsd?`. `ProjectService` has ONE write path
  (`setNotifyContextId`, `nerv/src/services/ProjectService.ts:75-81`, wired to `POST /projects/bind`) —
  **no Project-create route/API**. Projects seeded by direct Mongo writes.
- **papai targets:** `coding_guardrails` via `setCodingGuardrails(pi, guardrails)`
  (`papai/src/coding-credentials/guardrails.ts:14-45`, admin route `coding-guardrails-routes.ts:66`); the
  per-user vault (`codingSessionCredentials`, `papai/src/coding-credentials/store.ts:35-80`) — **no kiss
  source data**, so untouched.
- **magi transcript:** **no `shareToken`** (not on `Session` `magi/src/session/state.ts:17-37`, not a
  store column, no `/t/:token` route). Only bearer-gated `GET /sessions/:id/transcript` (`router.ts:194-201`)
  - `/stream` (`router.ts:203-209`), serving `<MAGI_TRANSCRIPT_DIR>/<sessionId>.jsonl`
    (`transcript-reader.ts:37-51`; `recording:'disabled'` if the dir is unset).
- **papai transcript viewer** (`papai/src/debug/transcript-viewer.ts`): the public `/t/<token>` route
  (`routeTranscriptPaths:114-135`) + proxy exist, but `proxyTranscriptHistory:38`/`proxyTranscriptStream:64`
  target magi's **nonexistent** `/t/:token/...` route, and **nothing produces a `transcriptUrl`** — dead
  end-to-end.
- **nerv observability:** `TaskRepo` has `magiSessionId?`/`sessionStatus?` but **no transcript link field**;
  `PapaiTaskNotifier.notifyStatus` (`nerv/src/services/PapaiTaskNotifier.ts:57-81`) only has free-text
  `extraMarkdown`; the `/api/notify` payload is `{contextId, threadId, markdown}`.

---

## Component 1 — Shadow-run runbook (papai doc, no code)

Create `docs/deployment/kiss-to-papai-shadow-migration.md`: (1) run papai+nerv against the same GitLab
repos kiss serves; (2) **shadow** by assigning the bot to kiss-created MRs (P1's assignee-watch adopts
them) and comparing outputs against kiss's; (3) a **parity checklist** (review-fix, CI-fix, cost, output
language); (4) **per-project cutover** (bind the project via `/nerv bind`, disable kiss on that project);
(5) **rollback** (un-assign the bot, re-enable kiss). No code — P1 already provides adoption.

## Component 2 — Config importer (standalone script)

`tools/import-kiss-projects.ts` (a Bun script in papai), invoked `--dry-run` (default) or `--apply`, with
Mongo URIs for kiss (read) + nerv (write) via env, and papai config access for guardrails.

**Per kiss `Project` doc → a nerv `Project` doc** (written directly to nerv's Mongo `Project` collection,
matching `IProject`):

- `repositories` ← kiss `repositories[]` (`projectPath`, `description`, `defaultBranch`→`baseBranch`,
  `worktreeSubdir`; per-repo `pipelineJobTrackList` carried onto the nerv repo config),
- `modelProvider`/`model` ← kiss `modelProvider`, `costBudgetUsd` ← kiss `maxTaskCost`,
  `autoReview`/`selfReviewEnabled` ← kiss, `mcpServers` ← kiss `mcpServers[]`,
- `contextIds: []` / `notifyContextId` **unset** (bound later via `/nerv bind`).
- kiss fields with **no nerv target** (`proxy`, `ignoreFiles`, `ephemeralSessions*`) are dropped with a
  logged warning.

**Also:** write a suggested default `coding_guardrails` for the platform instance (via `setCodingGuardrails`)
if none exists — `allowedAgents`/`whoMayUse` defaults; do not overwrite an existing one.

**Explicitly NOT imported:** creds (kiss's are global env — the runbook lists the nerv `forgeToken`/env the
operator must set), the per-user vault (no kiss source), and the channel→context binding. For each imported
project the script **prints the exact `/nerv bind <projectPath>` command** the operator runs in the target
chat channel to finish the binding.

`--dry-run` prints the full nerv `Project` docs + guardrails it _would_ write (a reviewable manifest) and
makes no writes; `--apply` performs the writes idempotently (upsert by repo `projectPath`, never clobbering
an existing `notifyContextId`).

## Component 3 — Transcript restore (papai + nerv; zero magi code)

**papai capability-token layer** (`src/debug/transcript-viewer.ts` + a token helper):

- Mint a **signed, expiring capability token** carrying `{ magiSessionId, exp }` (mirroring the existing
  `mintPluginMcpToken` signing pattern — stateless, no new table). A `mintTranscriptToken(magiSessionId)`
  helper returns the token; the public URL is papai's existing `/t/<token>`.
- **Repoint the proxy:** `proxyTranscriptHistory`/`proxyTranscriptStream` now VERIFY the token → extract
  `magiSessionId`, then target magi's REAL endpoint `${magi_base_url}/sessions/${magiSessionId}/transcript`
  (and `/stream`) with `Authorization: Bearer ${magi_token}` (from the acp plugin admin config,
  `getViewerMagiConfig`). The public `/t/<token>` route (`routeTranscriptPaths`) is unchanged.

**ACP surfacing** (`plugins/acp/`): after `start_session`/`continue_session` yields a magi `sessionId`, mint
a transcript token and include papai's `/t/<token>` URL in the tool result / reply (making the acp prompt
fragment's long-promised `transcriptUrl` real).

**nerv surfacing:**

- **nerv:** `PapaiTaskNotifier`/`PapaiNotifier` include the repo's `magiSessionId` in the `/api/notify` body
  (new optional field).
- **papai:** `notify-route.ts` `NotifyBodySchema` accepts an optional `magiSessionId`; when present, papai
  mints a transcript token and **appends the `/t/<token>` link** to the delivered chat message.

**magi:** no code. Deployment note: `MAGI_TRANSCRIPT_DIR` must be set (else the endpoint returns
`recording:'disabled'` and there's nothing to view).

---

## Cross-repo contract summary

| #   | Interface                   | Producer → Consumer | Change                                                                       |
| --- | --------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| 1   | kiss Project → nerv Project | importer → nerv DB  | direct upsert (no nerv create-API); dry-run manifest                         |
| 2   | kiss Project → papai config | importer → papai    | default `coding_guardrails` via `setCodingGuardrails`                        |
| 3   | transcript token            | papai (internal)    | signed `{magiSessionId,exp}`; `/t/<token>` → magi `/sessions/:id/transcript` |
| 4   | `/api/notify` payload       | nerv → papai        | add optional `magiSessionId`; papai mints + appends `/t/<token>` link        |

---

## Config

- **papai:** transcript-token signing secret (reuse the existing plugin-token signing key); token TTL
  (e.g. 30 days, mirroring `mintPluginMcpToken`). acp plugin `magi_base_url`/`magi_token` (already configured).
- **magi (deployment):** `MAGI_TRANSCRIPT_DIR` must be set so sessions record a transcript.
- **importer:** `KISS_MONGO_URI` (read), `NERV_MONGO_URI` (write), papai platform-instance id for guardrails.

## Error handling

- Importer: `--dry-run` is the DEFAULT (no accidental writes); `--apply` upserts idempotently and never
  overwrites an existing `notifyContextId` or an existing `coding_guardrails`; a kiss field with no nerv
  target is dropped with a warning, not a failure.
- Transcript: an invalid/expired token → 401/404 from `/t/<token>` (no proxy attempted); magi
  `recording:'disabled'` (dir unset) or a 404 session → a clear "transcript unavailable" response, not a 500;
  no `magi_token`/`magi_base_url` configured → the link is simply not minted (no crash).
- notify: `magiSessionId` is optional — a notify without it behaves exactly as today.

## Testing strategy

- **Importer:** unit-test the kiss→nerv field mapping (incl. `maxTaskCost`→`costBudgetUsd`, per-repo
  `pipelineJobTrackList`, dropped-field warnings); `--dry-run` writes nothing; `--apply` upserts idempotently
  (second run is a no-op) and never clobbers `notifyContextId`/existing guardrails; prints the `/nerv bind` lines.
- **Transcript (papai):** `mintTranscriptToken` round-trips; `/t/<token>` with a valid token proxies to
  magi `/sessions/:id/transcript` with the bearer (mock magi); invalid/expired token → 401/404; ACP reply
  includes the `/t/<token>` link; `/api/notify` with `magiSessionId` appends the link, without it is unchanged.
- **Transcript (nerv):** `PapaiTaskNotifier` includes `magiSessionId` in the notify body.

## Out of scope / deferred

- magi `shareToken` + public `/t/:token` route (papai owns the token instead) — not built.
- Per-user vault / per-integration cred import (no kiss source data).
- Fully automating the channel→context binding (left to `/nerv bind`, printed by the importer).
- The pre-existing `mcpToken`(nerv)/`mcpTokens`(magi) naming mismatch (a P2 follow-up, unrelated).

## Open assumptions (resolve during planning)

- The exact reuse of papai's token-signing primitive (`mintPluginMcpToken` / its signing key) for the
  transcript token — confirm the helper's location and whether a distinct token "kind" is warranted.
- Whether the importer runs best as a papai `tools/` script (papai has the guardrails store) that opens two
  Mongo connections, or as a nerv-side script for the nerv writes + a papai settings call for guardrails —
  confirm which store access is cleanest for a single idempotent run.
- How ACP currently surfaces (or intends to surface) `transcriptUrl` in its prompt fragment, so the minted
  link lands in the reply the way the fragment already advertises.
