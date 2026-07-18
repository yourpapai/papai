<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss MCP Fleet — Remaining Work (deferred-features spec)

> **Type.** Backlog / deferred-work spec. Snapshots everything left after the feature-parity plans **F1–F4
> shipped**, so nothing is silently dropped. Each item below is scoped enough to become its own
> `writing-plans` cycle. Parent docs: the sequencing roadmap
> (`2026-07-11-kiss-mcp-feature-parity-followups-design.md`) and the master migration design
> (`2026-07-10-kiss-mcp-servers-as-papai-plugins-design.md`).
>
> **Sources consolidated here:** roadmap §5 (consciously deferred), the "Follow-ups" section of each
> F-plan (F1–F4), the F4 final-review finding (fleet-wide policy-doc bug), and the F4 review Minors.

## Status snapshot — what already shipped

| Plan   | Scope                                                                                                                        | State      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **F1** | `mcp-figma` full-simplify (CSS-layout string + `globalVars` text-style dedup) + comma-separated token pool with 429 rotation | ✅ shipped |
| **F2** | `mcp-gitlab` read completeness: `x-total-pages` pagination (tree + MR list `all`, `capped` flag) + `jobUrl` parsing          | ✅ shipped |
| **F3** | `mcp-teamcity` config-envelope flattening (camelCase, redaction-preserving) + lone-object tolerance                          | ✅ shipped |
| **F4** | `mcp-gitlab` MR write tools (`post_comment`/`create_discussion`/`update_mr`/`set_mr_state`)                                  | ✅ shipped |

All four are committed on `docs/papai-nerv-plugin-design` (kept as-is, not merged); each passed `check:full` 12/12.

## Priority overview (recommended, not yet decided)

| #       | Item                                                                         | Repo  | Rough size                     | Priority rationale                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------- | ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | magi `ask` fail-open gate fix                                                | magi  | S–M                            | **Security, highest leverage** — until fixed, every `ask` write policy in the fleet (incl. F4's) behaves as `allow`. Unlocks real gating for all shipped writes. |
| **R2**  | Fleet-wide write-policy doc correction                                       | papai | S                              | **Security-doc accuracy** — youtrack/mattermost READMEs (+ roadmap) name the wrong knob; operators cannot gate those writes by following them today. Cheap.      |
| **R3**  | Redaction operator surface (`redaction_prompt` + `mcp_redaction` UI + unset) | papai | M                              | Completes the redaction foundation so operators configure/roll back via UI, and per-context prompt override.                                                     |
| **R4**  | `abortSignal` threading (all 8 plugin clients)                               | papai | S–M                            | Hygiene/correctness sweep; mechanical, broad.                                                                                                                    |
| **R5**  | F5 — Mattermost binary-attachment delivery                                   | papai | S / M / L (approach-dependent) | Last feature-parity gap; **needs an approach decision** (see R5).                                                                                                |
| **R6**  | `mcp-gitlab` `update_mr` assignee/reviewer resolution                        | papai | S–M                            | Feature-completeness for F4; demand-driven.                                                                                                                      |
| **R7**  | Dead `key === 'key'` branch in `mcp-sentry/format.ts`                        | papai | XS                             | Cleanup; remove or document.                                                                                                                                     |
| **R8**  | F4 review Minors (empty-string `title`; missing no-HTTP-call tests)          | papai | XS                             | Robustness/test-coverage polish.                                                                                                                                 |
| **R9**  | magi `npm_publish` sandbox capability                                        | magi  | M                              | Feature; separate concern.                                                                                                                                       |
| **R10** | RAG `top_k` result-count control                                             | papai | S                              | **YAGNI** — not kiss parity; build only on concrete demand.                                                                                                      |

---

## R1 — magi `ask` fail-open gate fix _(magi repo · security · highest leverage)_

**Problem.** `magi/src/mcp-broker/gate.ts:153` — the broker gate that governs coding-agent MCP tool calls
treats the `ask` policy state as fail-open (behaves like `allow`) instead of pausing for confirmation (or
failing closed). Because papai surfaces per-tool policy to magi via the MCP-plugin-server `toolPolicy`
(`default_tool_policy` + `tool_policy`, values `allow`/`ask`/`deny`), an operator who sets a write tool to
`ask` gets no gate at all in the sandbox.

**Impact.** Every `ask`-policied write across the fleet is effectively `allow`: F4's four GitLab writes,
`mcp-youtrack`'s six writes, `mcp-mattermost`'s `create_post`. This is the single highest-leverage
deferred item — it makes the `ask` state real for all already-shipped writes.

**Scope / approach.** magi-side. Fix the gate so `ask` fails closed or routes to the operator-confirmation
path; `deny` blocks; `allow` proceeds. Coordinate with a papai-side integration check. Until it lands,
`deny` is the only hard block operators can rely on (documented in R2).

**Decision needed.** What `ask` resolves to in a headless coding session (fail-closed vs queue-for-operator).

---

## R2 — Fleet-wide write-policy doc correction _(papai · security-doc · cheap)_

**Problem (found in F4 final review).** The coding-agent (magi) path is gated by the **MCP-plugin-server
tool policy** — `default_tool_policy` + per-tool `tool_policy` on `McpPluginServerConfig`
(`src/coding-credentials/mcp-plugin-servers.ts`), surfaced in the admin **MCP Plugin Servers** settings
section and handed to magi as `toolPolicy`. It is **not** gated by `tool_prefs` (the **Tools** settings
section), which only governs papai's own chat-facing tool loop — `src/mcp-server/plugin-bridge.ts`
(`callPluginMcpTool`) never consults `tool_prefs`.

**Impact.** `plugins/mcp-youtrack/README.md` and `plugins/mcp-mattermost/README.md` both instruct
operators to set `tool_prefs` to `ask`/`deny` to gate their writes — that guidance is **inert** for coding
sessions. An operator following it believes their writes are gated when they are not. The roadmap spec's
F4 section carries the same `tool_prefs` framing.

**Already fixed:** `plugins/mcp-gitlab/README.md` (commit `32b3fa319`) now names the correct knob.

**Scope / approach.** papai docs only. Correct the youtrack + mattermost READMEs (and the roadmap spec's
F4 wording) to point at `default_tool_policy`/`tool_policy` on the **MCP Plugin Servers** admin config;
add the note that `tool_prefs` does not gate MCP tools; add the `ask`-depends-on-R1 caveat (use `deny` for
a hard block until R1 lands). Mirror the corrected gitlab README wording.

---

## R3 — Redaction operator surface _(papai · completes the redaction foundation)_

Three related pieces from roadmap §5, best done together:

- **R3a — Per-plugin/per-tool redaction-prompt override.** Plan 1 ships only the shared
  `DEFAULT_REDACTION_PROMPT` (`src/mcp-server/redaction.ts`). Add a context-scoped `redaction_prompt`
  config key read via `runtimeContext.contextConfig.get('redaction_prompt')`, falling back to the default,
  and thread the resolved prompt into `redactText`. Driver: `mcp-youtrack`'s attachment-content
  redaction wants a bespoke prompt.
- **R3b — `mcp_redaction` settings-UI panel.** The backend admin-config API exists
  (`src/debug/settings/admin/mcp-redaction-routes.ts`, `src/coding-credentials/mcp-redaction.ts`), but
  there is no settings-UI panel for operators to set `model_url`/`api_key`/`model_name`/`timeout_ms`
  (currently raw admin-config only). Add the Svelte panel.
- **R3c — `mcp_redaction` unset/clear.** `mcp-redaction-routes.ts` exposes only GET/PUT; add a `DELETE`
  route + a `clearMcpRedactionConfig` helper so an operator can roll back to "unconfigured" (which
  re-disables redacting plugins via the fail-closed eligibility guard). Land with R3b.

**Scope / approach.** papai core + settings UI. Keep the redaction fail-closed contract intact
(unconfigured → redacting plugins disabled). Mask `api_key` in API responses (already done as
`api_key_set`).

---

## R4 — `abortSignal` threading _(papai · hygiene sweep)_

**Problem.** None of the plugin HTTP clients forward the caller-supplied `options.abortSignal`
(from `callPluginMcpTool`) into their `httpFetch` calls, so an in-flight upstream request cannot be
cancelled when the brokered call aborts. Applies to all clients: `mcp-sentry`, `mcp-confluence`,
`mcp-figma` (incl. the F1 token-rotation retries), `mcp-teamcity`, `mcp-rag`, `mcp-mattermost`,
`mcp-gitlab` (incl. F2 paged fetches + F4 writes), `mcp-youtrack`.

**Scope / approach.** Thread `abortSignal` from each tool `execute(input, ctx, { abortSignal })` → the
client method → the `httpFetch` `init.signal`. Mechanical per-plugin; a single sweep. Add a test per
client asserting the signal is forwarded. No behavior change when no signal is passed.

---

## R5 — F5: Mattermost binary-attachment delivery _(papai · needs an approach decision)_

**Problem.** `mcp-mattermost`'s `downloadAttachment` inlines small text (`< 512_000` bytes) but returns a
bare metadata note for binary or large files (`client.ts` `note: 'Binary attachment; content not inlined
(no filesystem handoff in this MCP transport).'`). kiss delivered the bytes; papai currently cannot.

**Roadmap decision of record:** deliver via a papai-hosted short-TTL signed URL (option b), NOT sandbox
filesystem staging (option a, rejected to preserve the zero-magi/geofront-change property).

**Precedent.** `src/plugins/transcript-facade.ts` is the exact pattern: a permission-gated facade injected
into the plugin runtime (`PluginToolRuntimeContext['transcript']`) that mints a papai public URL
(`${getSettingsPublicBaseUrl()}/t/<token>`) backed by a signed capability token (`token.ts`
`mintTranscriptToken`, distinct `kind`) and a public route (`src/debug/transcript-viewer.ts`, `/t/`).

**Realization is undecided — three options (present at plan time):**

1. **Full staging infra (roadmap option b, faithful).** New in-memory single-use byte store
   (`src/mcp-server/attachment-staging.ts`: short TTL + per-item + total size caps + oldest-evict, keyed
   by unguessable id, context-tagged) + a new `attachment` token kind (`token.ts`) + a new public route
   `GET /mcp/attachment/<token>` (verify → single-use `takeBytes` → stream with Content-Type/Disposition)
   - an `attachment` plugin facade (mirrors `transcript-facade`) + `mcp-mattermost` wiring (stage fetched
     bytes → return signed URL; fall back to the note if staging unavailable/over-cap). **Largest scope;
     adds a public byte-serving route + a memory-DoS surface** (mitigated by caps + single-use + TTL).
2. **Signed proxy (re-fetch on GET).** No byte storage: the tool returns a signed URL carrying the
   Mattermost `fileId` + context; on GET, papai re-resolves the context's Mattermost creds and
   re-fetches/streams the file. Avoids a memory store but adds **route-time creds resolution + an
   outbound fetch (SSRF surface) outside a tool call**.
3. **Lighter: enrich the note (no new papai infra).** Replace the bare note with the attachment's own
   Mattermost download/web URL + filename/size/mime, so a human (or an agent with Mattermost egress) can
   retrieve it directly. Fraction of the work; **no public byte-serving route, no DoS surface** — but
   delivery relies on Mattermost access, not papai.

**Cross-cutting caveat for options 1–2.** Whoever fetches the returned papai URL (the sandboxed agent, or
a human) needs network access to papai's public host — for the agent, papai's host must be in the
project's egress allowlist (operator config, not a magi/geofront code change). Frame the tool response
accordingly.

**Recommendation.** Option 1 is the faithful roadmap realization and the safest byte-path (bytes are
pre-fetched by the tool's SSRF-validated `httpFetch`, so the route needs no creds/outbound fetch); option
3 is the pragmatic minimum if the byte-serving route/DoS surface isn't wanted. **Decision required before
an F5 plan.**

---

## R6 — `mcp-gitlab` `update_mr` assignee/reviewer resolution _(papai · feature-completeness)_

**Deferred from F4.** kiss's `update_mr` also resolves `assigneeUsername`/`reviewerUsernames` → user ids
via a `GET /users?username=` lookup before the PUT. F4 shipped `update_mr` with the direct PUT fields
(`title`/`description`/`target_branch`) only. Add the username→id resolution (with a bounded lookup and a
clean "user not found" error) if there's demand. Small–medium; demand-driven.

---

## R7 — Dead `key === 'key'` branch in `mcp-sentry/format.ts` _(papai · cleanup)_

**Deferred low-severity.** The `SECRET_KEY` regex never matches a bare `key`, so the explicit exemption is
a no-op today (harmless, ported faithfully from kiss). Remove it, or document intent, so a future regex
tightening can't silently reintroduce a bypass. Trivial.

---

## R8 — F4 review Minors _(papai · robustness/test polish)_

- **`update_mr` empty-string tightening.** `write-tools.ts` `executeUpdateMr` reads `title`/`targetBranch`
  via `readOptionalString`, which does not reject `""` even though the schema declares `minLength: 1`
  (papai does not runtime-validate the JSON schema). A caller passing `title: ""` issues a PUT with an
  empty title (GitLab likely 4xx → `gitlab_error`). Consider a "present-but-non-empty" reader so it
  returns `validation_error` instead. Minor/inconsistency, not a silent-mutation risk.
- **Missing no-HTTP-call tests.** `gitlab_post_comment`/`gitlab_create_discussion` lack a dedicated
  "validation failure issues no HTTP request" test (the property is structurally guaranteed; `update_mr`
  and `set_mr_state` already have it). Add for symmetry.

---

## R9 — magi `npm_publish` sandbox capability _(magi repo · feature)_

**Deferred, separate concern.** kiss exposed an `npm_publish` capability; papai's sandbox does not.
magi-side sandbox capability, independent of the MCP-plugin fleet. Scope/design owned by magi.

---

## R10 — RAG `top_k` result-count control _(papai · YAGNI)_

**Not kiss parity.** kiss's `rag-mcp` exposes no result-count control (verified); papai's `mcp-rag` tool
takes only `query`. Adding `top_k` would be a _new_ feature beyond kiss. Per YAGNI, **build only on
concrete demand** — a small standalone enhancement (add `top_k` to the schema + client query param) when
justified, not as parity work.

---

## Suggested sequencing

A defensible order if picking up this backlog:

1. **R2** (cheap security-doc fix — operators can't gate youtrack/mattermost writes today) + **R7**/**R8**
   (trivial cleanups) — a quick "correctness & honesty" sweep.
2. **R1** (magi `ask` fix) — makes every shipped write's `ask` policy real; coordinate papai↔magi.
3. **R3** (redaction operator surface) — completes the redaction foundation.
4. **R4** (`abortSignal` sweep) — mechanical hygiene across all clients.
5. **R5** (F5) — once its approach is decided; last feature-parity gap.
6. **R6 / R9 / R10** — demand-driven features, as needed.

Each becomes its own brainstorm → plan → subagent-driven execution cycle, following the fleet's process
(TDD, pure-shaper table tests + mocked-`httpFetch` client tests, full `lint`/`knip`/`check:full` 12/12,
listing verification, no bare-module imports, `encodeURIComponent` every path segment).
