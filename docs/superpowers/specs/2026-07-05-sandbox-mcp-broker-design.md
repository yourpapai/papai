<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sandbox MCP Broker — extending the coding agent without loosening isolation

- **Status:** Proposed (design approved via brainstorming; not yet planned)
- **Date:** 2026-07-05
- **Scope:** `papai` (catalog + vault + `tool_prefs` + settings UI) · `magi` (mediation + worker + config generation) · `geofront` (2nd bridged channel + worker enclosure)
- **Related:**
  - `docs/architecture/coding-sessions.md` (ACP plugin, magi provisioning, Phase 4c derived egress, Phase 5a/5b guardrails/identity)
  - `docs/superpowers/specs/2026-07-01-per-project-egress-domains-design.md`
  - `docs/superpowers/specs/2026-06-27-phase-5a-operator-guardrails-design.md`
  - geofront `docs/adr/ADR-0004-zero-trust-network-policy.md`, `ADR-0012-credential-lifecycle-and-redaction.md`, `ADR-0013-configurable-egress-policy.md`
  - geofront `docs/specs/SPEC-0003/0004` (leliel transport/host-exec) — the rejected alternative A

---

## 1. Problem

papai + acp-plugin + magi + geofront were built security-first: the coding agent runs in a
zero-trust geofront sandbox with **deny-by-default egress** and **no secrets in the agent
container**. That posture is correct, but it creates friction the moment a user wants to give
the agent _more capability_ — specifically to connect a **custom MCP server** (a company Jira,
Confluence, an internal API, a Figma endpoint) so the agent can do more inside a coding session.

Today the only self-serve knob that adds capability is `additionalEgressDomains` (Phase 4c /
per-project-egress). That knob is the wrong tool for MCP:

- It punches a **two-way network hole** in the agent's egress (exfiltration + prompt-injection surface).
- The MCP server bears **credentials**, which would then have to live **inside the sandbox** — violating the no-secrets invariant.
- It offers **no per-tool gating** and no credential isolation.

We need a way to let the agent _use_ credential-bearing MCP servers **without** the credential
entering the sandbox and **without** widening the agent's egress.

## 2. Invariants (the "security level" we must not loosen)

Any capability path MUST preserve all five. These are extracted from the code and the geofront ADRs.

1. **INV-1 — No secret in the sandbox.** No long-lived credential materializes in the agent
   container. (geofront ADR-0012; magi stages host-side, `env_clear=true`, secrets never from transport.)
2. **INV-2 — Deny-by-default egress.** The agent reaches only allowlisted HTTP(S)-CONNECT hosts;
   no raw TCP/UDP/DNS; the ceiling is org-layer-only and intersection-only. (ADR-0004/0013.)
3. **INV-3 — Runtime assumed compromised; tool output is untrusted.** Brokered results are a
   prompt-injection / tool-poisoning surface even from a "trusted" server.
4. **INV-4 — Policy is immutable from inside.** The agent cannot widen its own authority.
5. **INV-5 — Per-tool gating + audit.** Every capability is allow/ask/deny-able per context and
   leaves an audit trail. (papai `tool_prefs`; ADR-0009.)

## 3. Requirements

- **Trust model — tiered.** The operator publishes a **vetted catalog** of MCP capabilities; the
  end user **selects + configures** (supplies their own scoped credential) within the operator's
  ceiling. No arbitrary self-serve MCP.
- **Capability types (first).** **Remote SaaS MCP servers** and **internal / self-hosted MCP
  servers** — both are credential-bearing **HTTP** services. (Local CLIs and broader in-sandbox
  powers are out of scope; see §11.)
- **Prompt-injection posture — pragmatic.** Per-tool allow/ask/deny + audit + treat brokered
  output as untrusted + honor MCP's confused-deputy / token-passthrough rules. Injection is an
  acknowledged, managed residual — not solved here (§10).

## 4. Design overview — "D: in-band MCP broker over the ACP-adjacent channel"

The agent already delegates capabilities to magi over the ACP channel: magi (the ACP **client**)
handles `fs/read_text_file`, `fs/write_text_file`, and `session/request_permission` on the agent's
behalf. MCP tool-brokering is the same shape — _the agent asks, and magi (which holds the
credential and the egress) answers._ We reuse that channel rather than giving the agent a new
network peer.

The broker is decomposed into **dumb, single-purpose pieces** so that **no component ever combines
"faces an adversary" + "holds the secret" + "parses hostile output."**

```
[agent, in sandbox]
   │  MCP over stdio (native MCP client → local stdio server)
   ▼
[mcp-tunnel, in sandbox]            dumb, tagged pipe; holds nothing, parses nothing
   │  frames over the 2nd geofront-bridged unix socket  (--mcp <sock>)
   ▼
[magi-main, host]                  route by tag · per-tool policy · resolve cred from vault
   │  opaque request + one scoped credential, over a host control socket
   ▼
[worker, own geofront enclosure]   dumb; netns + proxy egress restricted to MCP hosts; holds 1 cred
   │  HTTPS with injected credential; response streamed OPAQUE
   ▼
[MCP server: SaaS or internal]
   ▲
   └── response streams back opaque the whole way ──▶ agent parses it (already-untrusted zone)
```

**Key moves:**

- **The agent gains zero new network egress.** It reaches only `mcp-tunnel`, a child process over
  stdio — not a network endpoint. INV-2 preserved _exactly_.
- **The credential never enters the sandbox** and is never held by any agent-reachable component.
  It lives in the worker, two hops away, none of which the agent can address. INV-1 preserved.
- **magi never parses hostile upstream output** — the worker streams responses **opaque**; the
  agent parses them in the already-untrusted sandbox. This is what keeps magi-main and the worker
  _dumb_ and collapses the parser-RCE surface.

**Surface decomposition** — no single component combines all three dangerous properties (this is
the core reason D beats a single smart gateway; see §7.1):

| component              | faces an adversary?                        | holds the secret?          | parses hostile output?  |
| ---------------------- | ------------------------------------------ | -------------------------- | ----------------------- |
| `mcp-tunnel` (sandbox) | yes — the agent                            | no                         | no                      |
| magi-main (host)       | the agent's _requests_ only (minimal peek) | no (resolves + hands down) | no — never the upstream |
| worker (enclosure)     | the untrusted upstream                     | one scoped cred            | no — opaque streaming   |

### 4.1 Transport selection

ACP defines four MCP transports; the agent advertises which it supports via
`agentCapabilities.mcpCapabilities`. **magi selects at runtime.** As of 2026-07 **no ACP agent
advertises the `acp` transport** (§12), so the stdio path is what ships. The choice only affects the
_sandbox → magi-main_ hop — everything downstream (policy, cred resolution, worker enclosure, opaque
upstream streaming) is identical across paths.

- **Shipping path — `McpServerStdio`.** magi declares `command: mcp-tunnel` (or, for opencode, an
  `mcp.local` entry in its native `OPENCODE_CONFIG_CONTENT`); the tunnel + 2nd geofront socket
  (§5.1–5.2) carry MCP frames to magi-main. Supported by every current agent. **This is the design.**
- **Future path — `McpServerAcp` (MCP-over-ACP).** The client (magi) becomes the MCP-server endpoint;
  the agent sends `mcp/connect` / `mcp/message` / `mcp/disconnect` as **agent→client** requests (the
  _same_ routing family as `fs/*` and `session/request_permission`), and **`mcp-tunnel` + the
  geofront `--mcp` socket disappear**. **Not yet usable:** the transport is **`UNSTABLE`** in the SDK
  and, as of 2026-07, **zero agents or clients advertise it** — even adapters whose SDK already
  carries the type advertise only `http`/`sse` (§12). magi should detect `mcpCapabilities.acp` at
  init and prefer this path per-agent _if it ever appears_, but the design does **not** depend on it.
  Its design RFD motivates the transport with exactly our problem (sandboxing an ACP component), so
  it is the natural long-term convergence — on no timeline we control.
- **Rejected — `McpServerHttp` / `McpServerSse`.** These make the **agent** connect directly to the
  URL → require agent egress to the MCP server → violate **INV-2**. Not used.

## 5. Components

### 5.1 `mcp-tunnel` (in the sandbox) — dumb tagged pipe · **the shipping transport (§4.1)**

- Declared to the agent as a **stdio MCP server** via ACP `session/new` `mcpServers`
  (magi passes `[]` today — `magi/src/acp/client.ts:163`). The agent spawns one tunnel **instance
  per declared server**; each is launched with a **server-id arg set by magi** (the agent cannot
  spoof which server it is talking to).
- Job: read MCP frames on its stdio (agent side), tag them with the server id, forward to the 2nd
  socket; stream replies back. **No credentials, no policy decisions, no MCP-semantic parsing**
  beyond frame boundaries. It lives in the untrusted sandbox, so it is deliberately valueless.

### 5.2 geofront 2nd bridged channel — `--mcp <sock>` · **the shipping transport (§4.1)**

- Today geofront creates the ACP socket and bridges it to the agent's stdio:
  `geofront workspace up --acp <acp.sock>` (`magi/src/runtime/geofront/geofront-runtime.ts:218`).
- Add a **second flag** `--mcp <mcp.sock>`: geofront creates a second host-side unix socket and
  bridges it to a second stream/fd inside the sandbox that `mcp-tunnel` connects to. **Only geofront
  can wire a host socket across the isolation boundary** — this is the sole required geofront change.
- magi-main connects to `<mcp.sock>` as a client, exactly as it already does for `<acp.sock>`.

### 5.3 magi-main — privileged control point (mediation)

- Intake depends on the transport (§4.1): on the **primary** path it handles agent→client
  `mcp/message` requests over the existing ACP connection (reading `MessageMcpRequest.method`); on
  the **fallback** path it terminates `<mcp.sock>` and reads the tunnel's tagged frames. From there
  both paths converge: **route** by server-id/`method` → **enforce per-tool policy** (a minimal,
  strict peek at the tool name; input is from _our own_ agent, not the hostile upstream) →
  **resolve the MCP credential** from the per-identity vault → hand the opaque request + the one
  credential to the worker.
- Bound to magi-main (not the worker) because (a) geofront hands the socket to the `workspace up`
  invoker, and (b) routing + policy + vault access are **privileged** operations the worker must not
  have, and one shared channel may fan out to multiple workers.
- magi-main is **not** a listening network service — it is the far end of a controlled pipe, so the
  agent cannot probe/flood/exploit it as a peer.

### 5.4 worker — dumb, unprivileged egress executor

- Runs in its **own geofront enclosure** (reuse `proxy_container` + iptables + dnsmasq), with:
  `[egress.policy.allowlist] domains = <session's MCP upstream hosts>, ports = [443]`.
- Holds **only** the session's MCP credential(s) (handed at spawn) — **no vault, no DB, no
  filesystem, dropped privileges**.
- Does the **hardened outbound call**: fail-closed host allowlist + credential injected at the
  **header** layer + **opaque response streaming** with size/time caps. Because the proxy performs
  DNS resolution + the allowlist check, **DNS-rebinding is mitigated** (the worker never chooses the
  final IP); an in-code IP-pin is belt-and-suspenders.
- **Default granularity: one shared worker per session** (allowlist = union of the session's MCP
  hosts). **Escalation: one worker per server** (own enclosure, one cred, one host) for
  high-sensitivity credentials. Do **not** build the incoherent middle (per-server workers sharing a
  netns). Dumbness is what makes a _shared_ worker safe: there is no parser to exploit, so the
  co-located creds are not stealable via a hostile response.
- **Lifecycle:** spun at session start (or lazily on first MCP use), torn down + creds shredded at
  session end.

### 5.5 papai — catalog, vault, gating, settings UI

- **Catalog (governance, tiered trust):** the operator publishes vetted MCP server entries
  (name, upstream URL/host, transport=http, required credential shape, default tool policy). The
  user selects from this catalog and supplies **only their own scoped credential**, stored in the
  **per-identity vault** (same pattern as `resolveForge` / `resolveAgentSecrets`; Phase 4b/5b).
- **Per-tool gating (INV-5):** each catalog tool is allow/ask/deny-able per context, but because
  these are the _coding agent's_ tools (not papai's chat-LLM tools), the gate is enforced in
  **magi-main's mediator** and configured through the settings UI (like the Phase-5a guardrails) —
  it does **not** reuse papai's `tool_prefs` (which gates the orchestrator's own tools). Every
  brokered call is audited.
- **Settings UI:** a **Custom MCP** section that lists the operator catalog and lets the user
  enable + provide credentials, mirroring the existing "Code host" / "AI provider" sections
  (whole-record save, masked secrets, Clear button behind a `danger` confirm).

## 6. Data flow (one tool call)

1. Operator publishes `jira` in the catalog. User enables it and supplies a scoped Jira token →
   per-identity vault.
2. Session start: magi resolves the user's `jira` token, spawns the **worker enclosure**
   (allowlist = jira host, holds the token), and declares the server to the agent via ACP
   `mcpServers: [{ name: "jira", command: "mcp-tunnel", args: ["--server", "jira"] }]`.
3. geofront bridges `<mcp.sock>` alongside `<acp.sock>`.
4. Agent calls a tool → `mcp-tunnel` tags the frame `jira` → forwards over `<mcp.sock>`.
5. magi-main: check `tool_prefs` (allow/ask/deny) → resolve `jira` cred → dispatch opaque request +
   cred to the worker.
6. Worker: fail-closed allowlist check → HTTPS to jira with injected token → **stream response
   opaque** (size/time capped). Audit-log metadata (tool, server, status, size, timing) — **not**
   body content.
7. Response streams back opaque: worker → magi-main → `<mcp.sock>` → `mcp-tunnel` → **agent parses**.
8. Session end: worker + creds shredded.

The agent never held the token, never had egress to jira, and could reach nothing beyond `mcp-tunnel`.

## 7. Why D over the alternatives (threat-model-driven)

geofront's founding axiom: **the agent is hostile; assume it is compromised.** The upstream MCP
servers are the _secondary_ threat (operator-vetted catalog). The design optimizes against the
_primary_ adversary — the agent.

### 7.1 vs B — one MCP proxy app in a separate container with an isolated network

B (a ToolHive / Docker-MCP-Gateway sidecar the agent talks to **directly over the network**) has real
merits: off-the-shelf, keeps magi entirely out of the MCP path, natural per-server containers,
handles stdio upstreams. But it loses on the axis that matters here:

- **Egress fidelity.** B requires opening a hole in the agent's deny-by-default egress to reach the
  sidecar — handing the adversary a live service to scan/flood/fuzz/exploit. D adds **no network
  peer** (stdio to a dumb pipe).
- **Credential proximity.** In B the credential-holder **is** the agent's network peer; any gateway
  flaw exposes the creds. In D the credential is two non-addressable hops away.
- **Surface concentration.** B puts _faces-agent + faces-upstream + holds-cred + parses-both_ in one
  network-reachable box. D splits these across dumb pieces so **no component combines
  adversary-facing + secret-holding + hostile-parsing** (see §4 table).

B's advantages optimize against the _secondary_ threat (poisoned upstream) and developer effort — and
D already neutralizes the upstream threat via the dumb, opaque, kernel-egress-contained worker. The
price of D is putting magi-main in the data path; that is acceptable **only because magi-main stays
dumb about payloads** (opaque streaming). If we could not keep it dumb, B would win.

B is retained as the **fallback** if true per-MCP-server container isolation becomes a hard
requirement, or if a stdio upstream MCP server must be supported.

### 7.2 vs A — extend geofront's `leliel` host-exec broker

`leliel` is a built-but-unwired Rust broker (host-exec of declared argv tools over `wss://`, secrets
host-side). Its wire contract is **frozen** around single-exec argv semantics; an MCP server is a
stateful JSON-RPC session. Forcing MCP through leliel means building an MCP frontend + upstream
client inside leliel (different repo, different language, against a locked contract) — essentially
rebuilding the worker inside leliel. leliel's genuine strength is **deterministic local CLIs**, which
are out of scope. **A is the future path for local-CLI brokering (§11), not for MCP.**

### 7.3 vs the strawman — direct egress allowlist for the MCP endpoint

Rejected: loosens INV-1 (secret in sandbox), INV-2 (two-way egress), and INV-5 (no gating). This is
the motivation for the whole design.

## 8. Invariant preservation

| Invariant                     | How D preserves it                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| INV-1 no secret in sandbox    | Credential lives in the worker; no agent-reachable component holds it.                                                   |
| INV-2 deny-by-default egress  | Agent reaches only `mcp-tunnel` over stdio; **no new network egress**. Worker egress is a _separate_ geofront enclosure. |
| INV-3 output untrusted        | Responses stream opaque; parsed in the sandbox; per-tool policy + audit; injection is a managed residual (§10).          |
| INV-4 policy immutable inside | Catalog + `tool_prefs` + allowlists live host-side; `mcp-tunnel` and the sandbox cannot mutate them.                     |
| INV-5 per-tool gating + audit | `tool_prefs` allow/ask/deny per context; every call audited (metadata only).                                             |

## 9. Component ownership / build items

| Item                                                | Owner                          | Notes                                                                                                                                   |
| --------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--mcp <sock>` second bridged channel               | **geofront**                   | The only geofront change; the shipping (stdio) transport.                                                                               |
| `mcp-tunnel` dumb tagged pipe                       | **magi** (staged into sandbox) | Shipping transport; stdio MCP server the agent spawns.                                                                                  |
| ACP `mcpServers` / opencode `mcp.local` declaration | **magi**                       | `McpServerStdio` via `session/new` (or opencode's native `OPENCODE_CONFIG_CONTENT`).                                                    |
| magi-main mediation (route/policy/cred-resolve)     | **magi**                       | Terminates the MCP channel; reuse identity/vault resolvers.                                                                             |
| Worker enclosure (dumb, netns, MCP-hosts allowlist) | **magi** + **geofront**        | Reuse `proxy_container` egress; hardened opaque outbound client.                                                                        |
| Fail-closed upstream host allowlist                 | **magi**                       | Mirror `MAGI_ALLOWED_REPO_HOSTS` (empty ⇒ refuse).                                                                                      |
| Per-tool gate (allow/ask/deny) + audit              | **magi** + **papai**           | Enforced in the magi-main mediator (**not** papai `tool_prefs`, which gates chat tools); configured via settings.                       |
| Per-identity MCP credential vault                   | **papai**                      | Same pattern as forge / agent-provider vaults.                                                                                          |
| Operator catalog + governance                       | **papai**                      | Vetted entries; tiered trust.                                                                                                           |
| Settings-UI "Custom MCP" section                    | **papai**                      | Whole-record save, masked secrets, Clear + danger confirm.                                                                              |
| MCP-over-ACP `mcp/message` handler                  | **magi**                       | **Future (§4.1)** — client-side handler in `buildClientApp`; drops the tunnel + socket for any agent that adopts `mcpCapabilities.acp`. |

## 10. Threats & mitigations

- **SSRF (worker outbound):** fail-closed host allowlist + kernel-enforced egress (own enclosure) +
  proxy-side DNS resolution (anti-rebinding) + private/link-local range block + no/validated redirects.
- **Parser exploit / DoS (untrusted upstream output):** magi and the worker **never parse** response
  bodies — opaque streaming with size + time caps. Parsing happens in the already-contained sandbox.
- **Request-parse surface (magi-main):** minimal, strict, size-capped read of the tool name only;
  input is from our own agent. Prefer a method allowlist.
- **Confused deputy / token passthrough (MCP spec):** the worker injects the **user's own scoped
  credential**; it never forwards the agent's/coding token upstream. Use RFC-8693 token exchange
  where the SaaS supports it.
- **Prompt injection / tool poisoning (INV-3, residual):** _not solved._ Managed by per-tool
  allow/ask/deny + audit + treating all brokered output as untrusted. Broker-side result inspection
  (redaction / injection-scanning) is deliberately **out of scope** because it would require parsing
  in a privileged component; it becomes an opt-in **parsing worker** later (§11).

## 11. Out of scope / future work

- **Broker-side result inspection** (redaction, secret-scanning, injection filtering) — requires a
  _parsing_ worker in its own enclosure, enabled per high-risk server. Future opt-in.
- **stdio / local-process upstream MCP servers** — would run a process to exploit; if needed, that
  one server uses design **B** (its own container).
- **Local CLIs / deterministic argv tools** — the future home for **leliel** (design A).
- **Broader in-sandbox powers** (extra registries, local services) — separate concern.
- **Per-server worker as default** — start shared-per-session; promote per-server-with-own-netns only
  on demand.

## 12. Open questions — verification results (2026-07-05)

Verified against `@agentclientprotocol/sdk` (magi `0.28.1`, opencode `0.21.0`), the installed agent
adapters, and the ACP repo changelog / RFDs (ecosystem research 2026-07-05).

1. **ACP client-proxied MCP (`McpServerAcp`) — ✅ EXISTS, ✗ UNADOPTED.** The transport is real:
   `McpServerAcp` + `mcp/connect` / `mcp/message` / `mcp/disconnect` are **agent→client** requests
   (same family as `fs/*` and `request_permission`) with a `withMcpServer(...)` builder, so magi
   _could_ be the MCP-server endpoint over the existing ACP channel with **no tunnel/socket**. **But**
   it is recent (ACP Rust crate `v0.13.0`, 2026-05-12; npm sdk `0.22.0`, 2026-05-18), **still marked
   `UNSTABLE`** as of sdk `1.1.0` (2026-06-29, "may be removed or changed"), and **no agent/client
   advertises it** (item 2). Its design RFD (`docs/rfds/mcp-over-acp.mdx`, Zed/nikomatsakis) motivates
   it with **our exact problem** — sandboxing an ACP component ("host an ACP component that runs in a
   WASM sandbox or on another machine") — so it is the natural long-term convergence, but the design
   must not depend on it.
2. **Per-agent `acp` support — ✗ NONE (as of 2026-07).** Every agent advertises only `http`/`sse`,
   never `acp`:

   | Agent                                                                                          | ACP SDK                                      | advertises `mcpCapabilities.acp`? |
   | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------- |
   | claude adapter (`@agentclientprotocol/claude-agent-acp`, ex `@zed-industries/claude-code-acp`) | sdk `1.1.0` — type present                   | ✗ `{http, sse}` only              |
   | `@zed-industries/codex-acp`                                                                    | Rust crate `=0.14.0` unstable — type present | ✗ `http` only                     |
   | `opencode`                                                                                     | sdk `0.21.0` — predates the type             | ✗ stdio/http/sse                  |
   | Gemini CLI (`--experimental-acp`)                                                              | sdk `0.16.1` — predates                      | ✗ stdio only                      |
   | Zed (reference client, feature author)                                                         | crate `=1.0.1` unstable — type present       | ✗ zero code references            |

   **Key point:** even adapters already on a type-carrying SDK (claude `1.1.0`, codex `0.14`, Zed
   `1.0.1`) **choose not to advertise it** — so the barrier is upstream _adoption + stabilization_,
   not a version bump. magi reads `mcpCapabilities` at init and selects transport at runtime;
   `http`/`sse` remain **rejected** (agent egress → INV-2). **Consequence:** **stdio is the shipping
   transport**; `McpServerAcp` is opportunistic future work on no timeline we control.
   _Operational note:_ magi's `claudePreset` installs the **deprecated** `@zed-industries/claude-code-acp`;
   it has been renamed to `@agentclientprotocol/claude-agent-acp` (now sdk `1.1.0`) — update the preset
   independently of this design.

3. **geofront enclosure-per-worker cost — ⏳ OPEN (empirical).** The credential-isolated worker
   enclosure is required on **every** transport (it is the egress/credential boundary, independent of
   tunnel/socket). Validate second-enclosure startup latency / resource use; consider lazy spawn on
   first MCP use.
4. **Streamable-HTTP / SSE upstreams — ◑ CLARIFIED.** On the primary path magi receives structured
   `mcp/message` (sees `method`, forwards content opaque); the **worker→upstream** leg still needs
   streamable-HTTP / SSE handling with size + time caps and no unbounded buffering. magi never
   deep-parses result content on either path.

## 13. Alternatives considered (summary)

| Option                                                      | Verdict                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **D** — dumb in-band broker over ACP-adjacent channel       | **Chosen.** Best fit vs the primary threat (hostile agent); reuses magi's existing capability-brokering. |
| **B** — smart MCP-gateway sidecar, agent talks over network | Fallback if per-server container isolation or stdio upstreams are required.                              |
| **A** — extend `leliel` host-exec broker to MCP             | Rejected for MCP (frozen argv contract, wrong repo/language); future path for local CLIs.                |
| Direct `additionalEgressDomains` for the MCP endpoint       | Rejected — loosens INV-1/2/5.                                                                            |
