<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0275: Sandbox MCP Broker — Phase 3b (magi: Multi-Server & Operator Catalog)

## Status

Implemented (with divergence)

## Date

2026-07-08

## Context

ADR-0260 shipped **Phase 1** (the stdio transport: `agent → mcp-tunnel → bind-mounted host socket → magi-main mediator`), ADR-0264 shipped **Phase 2** (the kernel-isolated, credential-holding `mcp-worker` enclosure that makes the real outbound HTTPS call), and ADR-0274 shipped **Phase 3A** (the papai-side per-identity vault + the operator-curated MCP catalog that supersedes the interim freeform URL). Through all three, magi-main stayed a **dumb byte relay**: it forwarded every brokered MCP request to the worker unexamined and streamed every response back opaque. Nothing in the broker path enforced a per-tool decision — a session that legitimately reached one MCP tool reached *all* of them, and the credential was spent on every `tools/call` regardless of whether the operator wanted that tool used.

This ADR's source plan (`docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3b-magi.md`) is the **magi-side half of Phase 3B**: enforce a per-tool **allow/deny** (and, per the shared spec INV-5, **ask**) decision on brokered MCP calls *inside the magi-main mediator* — not in papai's `tool_prefs`, which gates chat tools, not brokered MCP — and audit every decision, all without breaking the opaque-response relay that is the broker's core safety property. The architecture: a `toolPolicy` rides the existing `spec.mcp` thread (`ProjectSpec.mcp[].toolPolicy` → `LaunchMcpConfig.toolPolicy` → the apparatus); a **gating decorator** wraps each worker-facing `handleConnection`; it line-parses only the **request** side (ndjson JSON-RPC), and for `tools/call` looks up `params.name` in the policy — **allow** forwards the original raw line bytes to the worker, **deny** writes a synthesized JSON-RPC error back to the agent and never forwards. Responses continue to stream byte-for-byte opaque (the gate is wired so the worker's replies never pass through any parsing).

The plan scoped Phase 3B-magi to **allow/deny + audit** and explicitly parked `'ask'` (interactive per-call permission needing a mid-session round-trip to the chat user) as a **documented follow-up**, treating `'ask'` as allow-with-warn so a catalog could not hard-break a session before the interactive flow existed. Multi-server multiplexing (one mediator fronting N workers, routed by `serverId`) and the operator catalog's papai-side storage were attributed to ADR-0264 / ADR-0274 respectively; this plan layers the gate onto that substrate.

The shared design (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`, "design D"; §5.3 magi-main mediation, §5.5 papai catalog/gating, §9 ownership, §10 threats) is the spec. Notably §9 (`:331`) names the per-tool gate as "**magi** + **papai** … Enforced in the magi-main mediator (**not** papai `tool_prefs`)", and INV-5 (`:51`) lists `allow/ask/deny` as first-class — so the **spec** already contemplated `'ask'`; it was the **plan** that deferred it. Verified across the magi repo (`~/Projects/yourpapai/magi/`) and geofront (`~/Projects/experiments/geofront/`, READ-ONLY); the operator catalog itself is papai-side (`src/coding-credentials/mcp-catalog.ts`, covered by ADR-0274) — magi only sees its effect as the validated `toolPolicy`.

## Decision Drivers

- **Enforce at the mediator, not in papai.** The per-tool decision belongs in magi-main (spec §9) — papai's `tool_prefs` gates chat tools and is not in the broker path — so the gate interposes between the mediator's parsed `serverId` routing and the credential-holding worker, on the *request* side only.
- **Never parse a response.** The opaque-response invariant (the Phase-1 decomposition that keeps the parser-RCE surface collapsed) is load-bearing: the gate parses *requests* to read `method`/`params.name`, but worker replies are wired straight to `outbound` and never pass through any gate logic.
- **Forward original bytes; synthesize errors.** An allowed `tools/call` forwards the exact raw ndjson line (the gate never re-serializes a forwarded request); a denied one synthesizes a JSON-RPC error and never reaches the worker — so a denied tool's request never causes the upstream credential to be spent.
- **Fail closed.** An unparseable request line, a malformed/nameless `tools/call` (`params.name` not a string), and a JSON-RPC **batch** array are all denied rather than forwarded — a line the gate cannot reason about must not reach the credential-holding worker, and per-call gating cannot be soundly applied to a batch.
- **Default allow-all when absent → byte-identical to 3A.** An upstream entry with no `toolPolicy` launches with no gate in the path and no added logging, so a non-gated session is unchanged; the gate is purely additive.
- **Audit every decision, no payload.** Each allow/deny/(ask) is logged via pino with `{ sessionId, serverId, tool, decision }` only — never arguments or the raw line.
- **Prototype-pollution-safe policy lookup.** The `tools` map is a plain `{}`; the gate reads it with `Object.hasOwn` so a tool named `constructor`/`__proto__`/`toString` can never resolve to an inherited member and dodge its specific deny/ask entry.
- **`'ask'` is a real round-trip, not a silent allow.** (Evolved beyond the plan.) An `'ask'` tool holds the line until an injected callback resolves; a missing callback fails closed (deny), so an `'ask'` policy can never silently widen to allow-with-warn.

## Considered Options

### Option 1 — request-side ndjson peek; allow forwards original bytes / deny synthesizes a JSON-RPC error; responses opaque; serialized async queue for `'ask'` (chosen, as shipped)

A decorator (`makeGatedHandleConnection`) wraps the worker-facing `handleConnection`. It buffers inbound into ndjson lines and drains them **strictly in order** through an async per-line gate (`gateLineAsync`): non-`tools/call` and allowed calls forward the original bytes; denied/malformed/batch lines get a synthesized JSON-RPC error and are never forwarded; an `'ask'` line awaits an injected `onMcpToolAsk` callback (`true` forwards, `false`/absent denies). The worker's `inner` writes responses straight to `outbound`, so the response side is never parsed. Inbound is paused for the duration of each drain pass so an outstanding `'ask'` backpressures the whole connection.

- **Pros:** keeps the opaque-response invariant absolutely (responses never enter gate logic); deny is enforced *before* the credential-holding worker, so a denied tool never spends the upstream token; serialized draining gives `'ask'` correct in-order semantics and real backpressure; the gate is purely additive (absent policy → no gate in the path).
- **Cons:** the gate now parses every request line (the one place the broker parses agent-originated JSON); an async `'ask'` adds a teardown race (a late deny resolving after the socket ended) that must be guarded.

### Option 2 — the plan's literal interim: synchronous gate, `'ask'` treated as allow-with-warn

Gate each line synchronously (a `while`-loop over a `StringDecoder` buffer); treat `'ask'` as `'allow'` with a `warn` log so the interactive flow can be added later without a schema change; forward unparseable lines verbatim (fail-open on non-JSON).

- **Pros:** the smallest possible diff; no async/teardown complexity; ships a policy shape forward-compatible with `'ask'` before the interactive flow exists.
- **Cons:** an `'ask'` policy would silently widen to allow (the very thing an operator setting `'ask'` does not want); fail-open on non-JSON forwards a line the gate cannot reason about to the credential-holding worker; no batch/malformed defense. **Rejected by the shipped code**, which implemented Option 1 — the plan's interim was superseded before this ADR was written.

### Option 3 — full MCP awareness (parse requests AND responses; re-serialize)

Make the gate a full JSON-RPC intermediary that parses both sides, validates result shapes, and re-emits serialized frames.

- **Pros:** enables result inspection / redaction on the response side.
- **Cons:** **violates the opaque invariant** — re-parsing hostile upstream output reopens the parser-RCE surface the Phase-1 decomposition deliberately collapsed; doubles the parsing surface; the credential-holding worker already parses nothing beyond newline framing. Rejected at the spec level (§10 treats brokered output as untrusted).

### Option 4 — enforce the policy in papai's `tool_prefs` (the chat-tool gate)

Gate brokered MCP tools through the same `tool_prefs` allow/ask/deny machinery that gates chat tools, instead of in the mediator.

- **Pros:** reuses an existing, UI-backed permission system.
- **Cons:** **rejected** by the shared spec (§9, `:331`): `tool_prefs` gates chat tools and is not in the broker path; the brokered call reaches the worker over a control socket the chat layer never sees, so papai-side gating would not actually stop the credential from being spent. The mediator is the only component on the request path.

## Decision

The Phase-3B-magi goal shipped in full across magi — per-tool allow/deny/**ask** is enforced in the mediator, every decision is audit-logged, responses stay opaque, and an absent policy is byte-identical to Phase 3A. The shipped implementation is materially richer than the plan (see divergences): interactive `'ask'` landed instead of the plan's allow-with-warn deferral, the decision layer was extracted to its own module, the pump became a serialized async queue, and batch/malformed/unparseable lines all fail closed. What shipped:

1. **`Permission` + per-entry `toolPolicy` types (magi).** `Permission = 'allow' | 'ask' | 'deny'` (`config.ts`); each `McpUpstream` carries an optional `toolPolicy?: { default; tools? }` (`config.ts:75`) — the policy is **per upstream entry**, not a single session-level field, matching the multi-server model.
2. **Fail-closed trust-boundary validation (magi).** `resolveMcpToolPolicy` (`spec-validation.ts`) rejects a non-object policy, a non-`allow/ask/deny` `default`, and any invalid per-tool value; the `tools` map is built plain and the lookup is `Object.hasOwn`-safe at the read side (`decideToolCall`), with an inline rationale for why a null-proto map was not used.
3. **`toolPolicy` threaded to the launch config (magi).** `LaunchMcpConfig.toolPolicy` (`launcher.ts:15`) and `mcpLaunchConfigs` (`helpers.ts`) spread `...entry` (policy included) per upstream; the credential map is matched fail-closed per entry.
4. **The gating decorator — connection/pump plumbing (`gate.ts`) + decision layer (`gate-line.ts`).** `makeGatedHandleConnection(policy, sessionId, inner, onMcpToolAsk?)` interposes a `PassThrough` (`gated`) between inbound and `inner`; `inner` writes responses straight to `outbound` (opaque). `attachGatedPump` buffers inbound into lines and drains them **serially** via `drainQueue` (sequential `await`, never parallelized), pausing inbound for each pass; `gateLineAsync` decides each line.
5. **Per-line decisions (`gate-line.ts`).** `decideToolCall` returns `allow` for any non-`tools/call` and a per-tool-then-default permission otherwise (`Object.hasOwn` lookup). `gateLineAsync`: a top-level JSON array → `denyBatch` (`-32600`); unparseable JSON → deny; a `tools/call` with a non-string `params.name` → deny; `deny` → synthesized `-32000` error; `ask` → `await resolveAskPermission` (`true` forwards, `false`/absent-callback denies); else forward the original raw line. Every decision is audit-logged (tool name + decision, no payload) via `writeQuietly`.
6. **Interactive `'ask'` wired end-to-end (magi).** `OnMcpToolAsk` (`gate-line.ts`) → `LaunchSpec.onMcpToolAsk` (`launcher.ts:34`) → `buildLaunchSpec`/`buildLaunchSpecFor` (`launch-spec.ts`) → `buildMcpAskCallback` (`mcp-ask.ts`, fail-closed `undefined` when no interactive notifier, else `permissions.requestExternal(...)`) → threaded into `startMcpApparatus` → `makeGatedHandleConnection`.
7. **Multi-server router (magi).** `makeServerRouter` (`server-router.ts`) dispatches each tunnel connection by its handshake `serverId` to that upstream's handler; an unknown `serverId` fails closed with a `-32601` JSON-RPC error instead of hanging.
8. **Gate wired into the multi-server apparatus (magi).** `startMcpApparatus` (`mcp-apparatus.ts`) launches one worker per upstream (bounded by `MAX_MCP_UPSTREAMS`, via `Promise.allSettled`), builds a per-`serverId` route map, and sets each entry's handler to `inner` when `toolPolicy` is absent or `makeGatedHandleConnection(entry.toolPolicy, sessionId, inner, onMcpToolAsk)` when present; the mediator's single downstream is `makeServerRouter(routes)`.
9. **Teardown-race + backpressure hardening (magi).** `writeQuietly` swallows write-after-end (a late `'ask'` deny resolving after `outbound` ended must not crash the process); `gated`/`outbound` carry `error` listeners; the serialized drain applies real backpressure so an outstanding `'ask'` blocks later lines.
10. **Docs (papai).** `docs/architecture/coding-sessions.md:42` carries a "Per-tool gating + audit (Phase 3B-magi)" paragraph documenting the request-side peek, opaque responses, deny-before-worker, batch rejection, audit shape, and the default-allow-all-absent-policy contract (with one stale sentence — see divergences).

## Consequences

### Positive

- An operator can **deny a brokered tool at the mediator** so its `tools/call` never reaches the credential-holding worker — a denied tool's request never causes the upstream token to be spent, closing the "reach one tool, reach all" gap left by Phases 1–3A.
- The opaque-response invariant is preserved absolutely: the gate parses only requests, and `inner` is wired directly to `outbound`, so worker replies never enter gate logic — the parser-RCE surface stays collapsed.
- Every decision leaves an audit trail (pino `{ sessionId, serverId, tool, decision }`, no payload), satisfying INV-5's audit half without ever logging arguments or raw lines.
- `'ask'` is a real interactive round-trip (not the plan's silent allow-with-warn): an operator setting `'ask'` gets a held line and a chat-user prompt, and a missing interactive channel fails closed — matching the spec's INV-5 intent more faithfully than the plan's interim.
- Default allow-all-when-absent keeps a non-gated session byte-identical to Phase 3A: no gate object, no added logging, no behavior change.
- Defense-in-depth on hostile input: prototype-member tool names (`Object.hasOwn`), JSON-RPC batches (wholesale `-32600`), and nameless/malformed `tools/call` all fail closed rather than reaching the worker.

### Negative

- The production wiring **outpaced the plan**: the plan's synchronous, allow-with-warn, single-module gate is not present verbatim. The decision layer was split into `gate-line.ts`, the pump became an async serialized queue to support interactive `'ask'`, and four fail-closed cases (batch, malformed, unparseable, missing-callback-ask) the plan did not specify all shipped. An ADR that verifies the plan's literal `gate.ts` shape against the tree will not find it; the divergence notes are the map.
- The docs drifted behind the code: `coding-sessions.md:42` still states `'ask'` is "currently treated as allow-with-warn" and that interactive permission "is a documented future feature" — which matches the plan, not the shipped interactive `'ask'`. The paragraph is otherwise accurate; the trailing sentence is stale.
- The gate now parses **every** brokered request line — the single place the broker parses agent-originated JSON. A pathological agent stream still cannot reach the worker with a gated line (deny/batch/malformed short-circuit first), but the parsing cost is new.
- There is **no magi-side operator catalog**: the assignment's "operator-curated MCP catalog on magi" is a misnomer — `grep catalog` in `magi/src` finds nothing. The catalog is entirely papai-side (ADR-0274); magi's only "catalog" surface is the fail-closed `toolPolicy` validation/enforcement.

### Risks

- **Full broker chain (gate enforced across a real container boundary) unverified on Linux/CI.** The unit/integration seams prove the gate forwards/denies/asks on real streams and the apparatus wires it per route; the real-docker end-to-end (a denied tool actually blocked at the mediator in a live session) remains the Linux handoff inherited from the Phase-2 verification (ADR-0263), since it needs the same-kernel `--mcp-mount` path.
- **Interactive `'ask'` latency blocks the connection.** Because the drain is serialized, a slow/unanswered `'ask'` backpressures every later line on that connection (by design — ordering requires it). A non-responsive chat user stalls the whole brokered stream until the ask resolves or the session tears down.
- **Async teardown race is mitigated, not structurally eliminated.** `writeQuietly` + error listeners prevent the crash, but a late ask resolution after teardown is a best-effort swallow-and-log; a future stream change that attaches a competing `error` listener could reintroduce an unhandled rejection.
- **Docs/code drift on `'ask'`.** A reader trusting `coding-sessions.md:42`'s "allow-with-warn" sentence will mis-model the runtime; the code (and the gate test suite) is authoritative.

## Related Decisions

- **ADR-0260: Sandbox MCP Broker — Phase 1 (Stdio Transport)** — the transport whose mediator `handleConnection` seam (`MediatorDeps`) this gate decorates; archived the shared design spec (`docs/archive/2026-07-05-sandbox-mcp-broker-design.md`).
- **ADR-0264: Sandbox MCP Broker — Phase 2 (Worker Enclosure)** — the credential-holding worker whose handler the gate wraps; already cited `makeGatedHandleConnection`, `makeServerRouter`, and `startMcpApparatus` as Phase-3B modules landing in the same tree, tagged `gate.ts` as "Phase-3B-magi". This ADR owns that attribution in depth.
- **ADR-0262 / ADR-0263** — the Phase-1 / Phase-2 docker-boundary verifications; ADR-0263 records the launch-gate proof whose Linux full-chain handoff this phase inherits.
- **ADR-0274: Sandbox MCP Broker — Phase 3a (papai Vault & Catalog)** — the papai-side operator catalog (`mcp-catalog.ts`) + per-identity resolver that **populates** `projectSpec.mcp[].toolPolicy`; this ADR is the magi-side **enforcement** of that same field.
- **Shared design spec — `docs/archive/2026-07-05-sandbox-mcp-broker-design.md`** (design D; §5.3 magi-main mediation, §5.5 papai catalog/gating, §9 ownership, §10 threats, INV-5).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. magi paths are under `~/Projects/yourpapai/magi/` (READ-ONLY); the operator catalog itself is papai-side (verified in this worktree, covered by ADR-0274).

| File | Role | Evidence |
| --- | --- | --- |
| `~/Projects/yourpapai/magi/src/project/config.ts:15` | `export type Permission = 'allow' \| 'ask' \| 'deny'`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/config.ts:69-76` | `McpUpstream` carries `toolPolicy?: { default: Permission; tools?: Record<string, Permission> }` (`:75`) — policy is **per upstream entry**. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/config.ts:80` | `MAX_MCP_UPSTREAMS = 8` — the absolute per-session ceiling the multi-server router is bounded by. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:34-38` | `PERMISSIONS` (`allow/ask/deny`) + `isPermission` guard. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:80-107` | `resolveMcpToolPolicy` — fail-closed: non-object policy, invalid `default`, invalid per-tool value all throw; inline note on the `Object.hasOwn` read-side defense (null-proto map rejected as tripping `no-unsafe-*` lint). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:148-149` | `resolveMcpEntry` calls `resolveMcpToolPolicy(raw['toolPolicy'])` and returns it on the `McpUpstream`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/project/spec-validation.ts:226,237` | `validateRepoSpec` calls `resolveMcp` and returns the validated `mcp` array. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/launcher/launcher.ts:8-16` | `LaunchMcpConfig` (structurally `WorkerConfig` + `id`/`token`/`toolPolicy`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/launcher/launcher.ts:20-23` | `McpAskDescriptor` (`serverId`/`toolName`), kept as its own launcher-layer type. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/launcher/launcher.ts:34` | `LaunchSpec.onMcpToolAsk?` — the interactive-ask channel threaded to the gate. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/helpers.ts:65-78` | `mcpLaunchConfigs` — spreads `...entry` (policy included) per upstream; fail-closed token match naming the offending id. | `read` confirms (divergence: plural + multi-server). |
| `~/Projects/yourpapai/magi/src/mcp-broker/mediator.ts:8-13` | `MediatorDeps.handleConnection` — the seam the gate/router decorate (`serverId`, `inbound`, `outbound`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/server-router.ts:10-29` | `makeServerRouter` — per-`serverId` dispatch; unknown id fails closed with `-32601` + `outbound.end()` + `inbound.resume()`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate.ts:13-14` | Re-exports `decideToolCall`/`ToolPolicy`/`McpAskDescriptor`/`OnMcpToolAsk` from `gate-line.js` so existing imports keep working. | `read` confirms (divergence: split module). |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate.ts:43-68` | `makeGatedHandleConnection(policy, sessionId, inner, onMcpToolAsk?)` — `gated` PassThrough; `inner(serverId, gated, outbound)` (responses opaque); stream-error swallow-and-log listeners; `attachGatedPump(...)`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate.ts:74-117` | `attachGatedPump` — `StringDecoder` line buffer + `queue`; `pump` pauses inbound, drains, then resumes (backpressure); `end`/`error` handling. | `read` confirms (divergence: async queue). |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate.ts:138-147` | `drainQueue` — sequential `await process(line)` ("must never be parallelized with e.g. Promise.all"). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate-line.ts:4-7,41-46` | `ToolPolicy`/`McpAskDescriptor`/`OnMcpToolAsk` types; `decideToolCall` (non-`tools/call`→`allow`; `Object.hasOwn` per-tool lookup → default). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate-line.ts:73-81` | `denyBatch` — top-level JSON array → `-32600` "batch requests are not supported". | `read` confirms (divergence: batch defense). |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate-line.ts:100-115` | `parseGateLine` (`batch`/`invalid`/`msg`) + `isMalformedToolCall` (nameless/non-string `params.name`). | `read` confirms (divergence: malformed/unparseable fail-closed). |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate-line.ts:120-136` | `resolveAskPermission` — `await onMcpToolAsk`; **absent callback → deny**; `deny-ask`/`allow-ask` audit logs. | `read` confirms (divergence: interactive ask, not allow-with-warn). |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate-line.ts:143-185` | `gateLineAsync` — deny-batch → fail-closed invalid → malformed deny → `deny` error → `ask` await → forward original `${line}\n`; `tools/call` allow logged. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/mcp-broker/gate-line.ts:55-67` | `writeQuietly` — guards `writableEnded`/`destroyed`, swallows write-after-end (teardown-race defense). | `read` confirms (divergence). |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:100-145` | `startMcpApparatus` — one worker per upstream via `Promise.allSettled` (`:114`); per-entry route map; failed entry → best-effort shutdown + propagate (`:117-123`); `onMcpToolAsk` param (`:106`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:124-134` | routes: `entry.toolPolicy === undefined ? inner : makeGatedHandleConnection(entry.toolPolicy, sessionId, inner, onMcpToolAsk)` — absent policy → no gate in path. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:137` | mediator downstream = `makeServerRouter(routes)`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/mcp-apparatus.ts:167-173` | `teardownMcpApparatus` — best-effort mediator close+unlink + concurrent worker shutdown. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/runtime/geofront/geofront-runtime.ts:152-160` | `launch` gates apparatus on `spec.mcp` non-empty; calls `startMcpApparatus(..., mcp, undefined, spec.onMcpToolAsk)` (`:156`); passes `--mcp-mount apparatus.mcpSocketPath` (`:160`). | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/launch-spec.ts:14-27,38-47` | `buildLaunchSpec` threads `onMcpToolAsk`; `buildLaunchSpecFor` builds it via `buildMcpAskCallback(... notifier.interactive)`. | `read` confirms. |
| `~/Projects/yourpapai/magi/src/session/mcp-ask.ts:8-23,28-39` | `sessionPermissionHooks` (shared waiting/resume transitions with in-turn ACP asks); `buildMcpAskCallback` — fail-closed `undefined` when `!enabled`, else `requestExternal(...).then(==='allow')`. | `read` confirms (divergence: interactive ask shipped). |
| `~/Projects/yourpapai/magi/src/mcp-broker/index.ts:7-8` | Barrel re-exports `makeGatedHandleConnection`, `decideToolCall`, `type ToolPolicy`. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/gate.test.ts:50-168` | allow/deny, prototype-member deny (`__proto__`/`constructor`/...), default-allow, nameless fail-closed, batch reject, multi-byte cross-chunk reassembly. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/gate.test.ts:92-106` | Audit-log assertion: `{ decision:'deny', tool:'constructor' }`, no `payload`/`arguments`. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/gate.test.ts:174-311` | Interactive ask: hold-then-forward, deny→error, **no-callback fail-closed**, order preservation (ask blocks line 2), CRITICAL teardown-race no-`uncaughtException`. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/mcp-broker/server-router.test.ts:29-61` | Dispatch to registered handler; unknown `serverId` → `-32601` JSON-RPC error. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts:41-108` | Multi-server: one worker per upstream behind one mediator, per-`serverId` routing, teardown unlinks sockets. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts:110-158` | `onMcpToolAsk` wiring end-to-end: real tunnel → mediator → gated handler → ask callback invoked with `{ serverId, toolName }`. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/runtime/geofront/mcp-apparatus.test.ts:200-260` | Rollback: primary launch error preserved (names failed upstream, not a shutdown error); shutdown-failure isolation; no leaked ctrl socket. | `read` confirms. |
| `~/Projects/yourpapai/magi/tests/session/lifecycle.test.ts:276-297` | `buildLaunchSpec` leaves `onMcpToolAsk` undefined when omitted; sets it when provided. | `read` confirms. |
| `docs/architecture/coding-sessions.md:42` | "Per-tool gating + audit (Phase 3B-magi)" paragraph — request-side peek, opaque responses, deny-before-worker, batch `-32600`, audit shape, default-allow-absent. | `read` confirms (trailing `'ask'` sentence is stale — see divergences). |

Plan-vs-implementation notes:

- **Interactive `'ask'` shipped, not the plan's treat-as-allow-with-warn deferral.** The plan's "Gating scope" stated `'ask'` is treated as `'allow'` with a `warn` log so a catalog can't hard-break a session before the interactive flow exists, and its Definition of Done lists "`'ask'` is treated as allow-with-warn (interactive permission is a documented follow-up)". Shipped implements interactive `'ask'` end-to-end: `OnMcpToolAsk` (`gate-line.ts:20`) is awaited in `resolveAskPermission` (`:120-136`); a **missing** callback fails CLOSED (`false`), never allow-with-warn; the callback is built by `buildMcpAskCallback` (`mcp-ask.ts:28-39`, fail-closed `undefined` when no interactive notifier) and threaded `LaunchSpec.onMcpToolAsk` → `startMcpApparatus(..., spec.onMcpToolAsk)` (`geofront-runtime.ts:156`) → `makeGatedHandleConnection(..., onMcpToolAsk)` (`mcp-apparatus.ts:133`). This matches the **spec**'s INV-5 (`allow/ask/deny` first-class) more closely than the plan did; the plan's interim was superseded before this ADR was written.
- **The decision layer was extracted to `gate-line.ts`.** The plan (Task 3) put `ToolPolicy`, `decideToolCall`, the line-pump, and `gateLine` all in one `gate.ts`. Shipped splits: `gate.ts` is the connection/pump plumbing (`makeGatedHandleConnection` + `attachGatedPump` + `drainQueue`), `gate-line.ts` holds the types, parsing, `decideToolCall`, and `gateLineAsync`. `gate.ts:13-14` re-exports the symbols so existing call sites/tests importing from `gate.js` keep working.
- **The pump is a serialized async queue with backpressure, not a synchronous `while`-loop.** The plan's `gateLine` was synchronous (`inbound.on('data')` → `while (nl !== -1) gateLine(...)`). Shipped `attachGatedPump` (`gate.ts:74-117`) pushes complete lines onto a `queue` and drains them via `drainQueue` (`:138-147`) which `await`s each `gateLineAsync` strictly in order — required because `'ask'` is now async. Inbound is `pause()`d for each drain pass and `resume()`d after, so an outstanding `'ask'` backpressures the whole connection (an `'allow'` line behind an `'ask'` waits). `drainQueue` carries an explicit comment that it "must never be parallelized with e.g. Promise.all".
- **JSON-RPC batches are rejected wholesale (fail-closed).** The plan did not address batches. Shipped `denyBatch` (`gate-line.ts:73-81`) returns `-32600` for any top-level JSON array, because per-call gating cannot be soundly applied to a batch line (a denied `tools/call` could hide inside an array and skip the gate). MCP 2025-06-18 removed batching, so this is spec-safe. Covered by two `gate.test.ts` cases (`:124-151`), including a batch of otherwise-allowed calls still being rejected.
- **Malformed/nameless `tools/call` and unparseable lines fail closed.** The plan forwarded unparseable (non-JSON) lines verbatim ("fail-open on non-JSON; the worker/upstream will reject"). Shipped `parseGateLine` (`gate-line.ts:100-108`) returns `invalid` for unparseable JSON → deny (`:157-160`), and `isMalformedToolCall` (`:113-115`) denies a `tools/call` whose `params.name` is not a plain string, so a nameless call cannot fall through to `policy.default` and dodge a specific tool's `ask`/`deny`. Covered by `gate.test.ts:115-122` (non-string `name`) and the prototype-member suite (`:67-106`).
- **Prototype-pollution defense is at the read side.** The `tools` map is a plain `{}`; the `spec-validation.ts:88-100` note explains a null-proto map was rejected because `Object.create`/`setPrototypeOf` are typed `any` and every cast trips the repo's `no-unsafe-*` lint. Defense is `Object.hasOwn` in `decideToolCall` (`gate-line.ts:44`), so `constructor`/`__proto__`/`toString` never resolve to inherited members. A dedicated test (`gate.test.ts:67-79`) denies all five prototype-member names.
- **`writeQuietly` + stream-error listeners guard the async teardown race.** Because `'ask'` resolves asynchronously, a late deny can resolve after `outbound` (a real net.Socket) has ended — an unguarded write-after-end would throw `ERR_STREAM_WRITE_AFTER_END` with no listener and crash the process. Shipped `writeQuietly` (`gate-line.ts:55-67`) checks `writableEnded`/`destroyed` and swallows errors; `gate.ts:59-64` attaches swallow-and-log `error` listeners. The `CRITICAL` test (`gate.test.ts:271-310`) proves a parked ask resolving after `outbound.end()` raises no `uncaughtException`.
- **The policy is per-entry, not a single session-level `mcp.toolPolicy`.** The plan (Task 1) validated one optional `mcp.toolPolicy = { default, tools }` on the `mcp` object. Shipped validates `toolPolicy` **per upstream entry** inside `resolveMcpEntry` (`spec-validation.ts:148`), returning `McpUpstream[].toolPolicy` — the multi-server generalization (each upstream has its own policy). The apparatus applies each entry's policy to its own handler independently (`mcp-apparatus.ts:131-133`).
- **`mcpLaunchConfigs` is plural and multi-server; `toolPolicy` rides `...entry`.** The plan (Task 2) threaded policy through a singular `mcpLaunchConfig(mcp, token)`. Shipped `mcpLaunchConfigs(mcp, mcpTokens)` (`helpers.ts:65-78`) builds `LaunchMcpConfig[]` (the multi-server shape already covered by ADR-0274); the policy is carried by the `...entry` spread (`:76`), not a dedicated field assignment.
- **The apparatus + router are extracted modules, not a direct `geofront-runtime.ts` edit.** The plan's file structure (Task 4) modified `geofront-runtime.ts` directly and listed neither `server-router.ts` nor `mcp-apparatus.ts`. Shipped: `startMcpApparatus` lives in `mcp-apparatus.ts` (one worker per upstream via `Promise.allSettled`, route map, gated handlers, rollback, teardown), `geofront-runtime.launch` just calls it (`:156`), and the `serverId` demux is `makeServerRouter` (`server-router.ts`). ADR-0264 already co-cited these as Phase-3B modules landing alongside Phase 2; this ADR owns the gating layer that sits on top of them.
- **The docs note (Task 5) shipped but its trailing `'ask'` sentence is stale.** The plan asked the doc to note `'ask'` is a documented follow-up (treated as allow for now). `coding-sessions.md:42` does carry a full "Per-tool gating + audit (Phase 3B-magi)" paragraph — correctly documenting the request-side peek, opaque responses, deny-before-worker, batch `-32600`, the `{sessionId,serverId,tool,decision}` audit shape, and default-allow-absent — but its final sentence still reads "`'ask'` is currently treated as allow-with-warn; true interactive permission … is a documented future feature". That matches the plan, not the shipped interactive `'ask'` (absent-callback now denies, never allow-with-warn). The paragraph was not updated when the code outpaced the plan's interim ask posture.
- **There is no magi-side operator catalog.** The assignment's scope names "operator-curated MCP catalog on magi", but `grep catalog` across `~/Projects/yourpapai/magi/src` finds nothing. The catalog is entirely papai-side (`src/coding-credentials/mcp-catalog.ts`, ADR-0274); magi's only catalog-related surface is the fail-closed `resolveMcpToolPolicy` validation + the gate's enforcement of the resulting `toolPolicy`. The magi-side "catalog" half is therefore the validation+enforcement contract, not a storage surface.
- **Full docker E2E (a denied tool actually blocked at the mediator in a real session) remains the Linux handoff.** The gate unit suite proves allow-forwards / deny-synthesizes-error / ask-holds / non-tool-passes / batch-rejects on real streams, and the apparatus wiring test proves the mediator applies the gate per route end-to-end against a fake worker. The real two-enclosure docker chain is the same-kernel `--mcp-mount` handoff inherited from ADR-0263; this plan's Task 5 called it out explicitly.

The source plan `docs/superpowers/plans/2026-07-08-sandbox-mcp-broker-phase-3b-magi.md` is archived alongside this ADR to `docs/archive/`. Its design spec (`2026-07-05-sandbox-mcp-broker-design.md`) is a shared document already archived with ADR-0260.
