<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 3rd-Party Provider Trust Tier — Research

**Date:** 2026-05-23
**Status:** Research / decision-support (not an implementation spec)
**Related:** [`2026-05-23-task-provider-as-plugin-design.md`](./2026-05-23-task-provider-as-plugin-design.md), [`2026-05-23-chat-provider-as-plugin-design.md`](./2026-05-23-chat-provider-as-plugin-design.md), [`2026-03-30-plugin-system-design.md`](./2026-03-30-plugin-system-design.md)

## Purpose

The two provider-as-plugin specs keep the existing trust model: provider plugins are trusted, first-party, in-repo code reviewed via PR and run with full process privileges. This document explores what would be required to safely accept **externally-authored** provider plugins — code the operator did not write. It is decision-support feeding a future go/no-go, not a committed design. It does not pick a signing-root format, design an RPC schema, or commit a timeline.

## Section 1: Problem Statement & Threat Model

### Why first-party safety does not transfer

First-party provider plugins are safe _because every line was reviewed and committed by the maintainer_. They run with full Node/Bun privileges (raw WebSocket, platform SDKs, `process`, `fs`). A 3rd-party tier removes the reviewed-by-maintainer guarantee while keeping the privileges — that is the entire problem.

### Trust boundary shift

Under today's model, an activated 3rd-party provider plugin could:

- **Exfiltrate secrets** — `LLM_API_KEY`, S3 credentials, and every user's task-tracker token are reachable via `process.env` and the SQLite DB.
- **Phone home** — arbitrary outbound network from inside the bot process.
- **Tamper** — write any SQLite table, including `users`, `system_config`, `admins`.
- **Persist** — register scheduled jobs that run indefinitely.
- **Impersonate** — send chat messages as the bot to any user.

### Assets to protect

Central LLM credentials; per-user provider tokens; S3 object-store credentials; the `system_config` / `admins` / `users` tables; the message stream (no silent exfiltration of user content); bot identity (no unauthorized sends).

### Adversary tiers

- **(a) Honest-but-buggy** — well-meaning code with defects (crashes, leaks, runaway loops).
- **(b) Opportunistically malicious** — generic data-harvesting, "call home with whatever I can read."
- **(c) Actively malicious** — targeted exfiltration of this deployment's secrets.

**Position:** a pure in-process JavaScript sandbox can credibly defend against (a) and (b) but **not** (c) on a shared Bun process. The recommendation hinges on whether (c) is in scope. If the operator only ever installs reputable-but-unaudited plugins, (a)/(b) defenses may suffice; if genuinely untrusted code is in scope, only OS-level isolation is credible.

## Section 2: Isolation Options

| Option                                                                       | Isolation strength | Defends tier (c)? | Cost / friction | Notes                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------ | ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Capability narrowing only** (no sandbox)                                | Weak               | No                | Low             | Freeze `PluginContext`, deny `process`/`fs` by convention. Trivially bypassed in-realm. Only meaningful when combined with code review — i.e. equivalent to first-party.                                  |
| **B. `node:vm` / SES locked realm**                                          | Medium             | No                | Medium          | Curated global, blocks accidental `process.env` reads. Shared heap + prototype reachability means a motivated attacker escapes. Good for (a)/(b).                                                         |
| **C. Worker thread + message-passing RPC**                                   | Medium-high        | Partial           | Medium-high     | Plugin runs in a `Worker`, no shared memory; host mediates all I/O over a serializable RPC channel. Provider interface becomes async-RPC. Defends most of (b), some of (c); still shares OS process/user. |
| **D. Child process (separate OS process)**                                   | High               | Mostly            | High            | Own memory; host talks over stdio/socket RPC; OS resource limits possible. Network egress still open unless firewalled.                                                                                   |
| **E. OS sandbox / container** (seccomp, gVisor, microVM, separate container) | Very high          | Yes               | Very high       | Full isolation including network egress control. The only credible defense against (c). Large operational lift; changes deploy topology.                                                                  |

### The fundamental tension

The provider interface is I/O-heavy and latency-sensitive: every tool call hits a provider; every chat message round-trips. Options C–E impose an RPC boundary that turns near-synchronous `TaskProvider`/`ChatProvider` method calls into cross-boundary serialized async. A chat provider holding a live WebSocket cannot sit behind a coarse RPC boundary without re-architecting the inbound-event flow.

### Split recommendation

- **Task providers** — the `TaskProvider` surface is already request/response and already async, so **Option C (worker + RPC)** is tractable: each method becomes an awaited RPC; the worker holds the provider's own state.
- **Chat providers** — the long-lived connection and inbound event stream make C–E substantially harder. 3rd-party _chat_ providers should stay **out of scope longer** than 3rd-party _task_ providers, and when pursued likely need **Option D/E**.

## Section 3: Supply-Chain & Provenance Controls

Independent of runtime isolation. Any subset can ship; they layer.

### Distribution model (decide first — it gates everything else)

- **In-repo PR only** (status quo) — external authors open a PR; review _is_ the trust. No new machinery, but does not scale and is not "install without forking."
- **Vendored manifest registry** — a curated `registry.json` of approved plugin git refs/tarballs plus SHA-256 digests; operator opts in per plugin. Mid-weight; a reasonable first step toward external plugins without open install.
- **Open install-from-URL** — operator pastes a git URL / npm spec. Maximum reach, maximum risk; requires every control below plus runtime isolation at tier (c) strength.

### Integrity & provenance controls

- **Manifest + content signing** — a detached signature verified against a pinned maintainer public key (or a TUF-style root). Extends today's SHA-256 `manifestHash` from _integrity_ to _authenticated_ integrity.
- **Pinned digests / lockfile** — already done for `manifest + entry point`. Extend the hash to the **full file tree**, not just those two files, so unhashed sibling files cannot smuggle code.
- **Dependency policy** — external plugins pulling npm deps reintroduce the npm supply-chain surface the current system explicitly avoids. Options: vendored-deps-only, an allowlist, or a `node_modules`-free constraint.
- **Capability/permission diff at upgrade** — when an upgrade requests new permissions or new `providerAllowedHosts`, force re-approval with a visible diff. Extends the existing "hash change clears approval" rule with a human-readable permission delta.
- **Static screening at approval** — scan entry source for `eval`, `process.env`, `require('fs')`, `child_process`, dynamic import of non-allowlisted modules. Advisory (flag for reviewer), not a hard gate, since static checks are evadable.

### Secret-scope controls

3rd-party providers must never see other plugins' or core's secrets. The per-instance `task_instances.config` model already scopes config to the instance; the sandbox must inject **only** that instance's config — never `process.env`, never sibling instances' config.

## Section 4: Recommendation, Phasing & Open Questions

### Recommendation

- **Do not build the 3rd-party tier yet.** Ship the two first-party provider-as-plugin specs first. They deliver the structural win (uniform plugin model, single registration path) with zero new trust surface.
- When/if external demand is real, pursue in this order:
  1. **Task providers via Option C** (worker thread + async RPC), paired with: vendored-manifest-registry distribution, manifest signing, permission-diff-on-upgrade, and full-tree content hashing.
  2. **Chat providers** only after task-provider sandboxing proves out, likely via **Option D/E** because of the long-lived connection. A separate future spec.

### Phasing sketch (if pursued)

1. Full-tree content hash + permission-diff-on-upgrade (cheap; useful even for first-party plugins today).
2. Manifest signing + pinned maintainer key.
3. Worker-thread RPC harness for `TaskProvider` (the big lift); migrate one first-party task provider onto it as the proof.
4. Vendored registry + per-plugin operator opt-in UX.
5. Revisit chat providers with process/OS isolation.

### Open questions (left for a future go/no-go)

- **Platform vs application** — does the project want a 3rd-party ecosystem (platform) or to stay first-party-only (application)? This is a product decision and is the real gate, not a technical one.
- **npm-dependency policy** for external plugins (vendored-only vs allowlist).
- **Network egress control** — without it, even a sandboxed plugin can exfiltrate; this pushes toward Option E for genuinely untrusted code.
- **Per-plugin resource quotas** (CPU / memory / event-loop budget) — out of scope for a first sandbox; needed before open install.

### Explicit non-goals of this document

It does not select a signing-root format, does not design the RPC schema, and does not commit a timeline. It exists to make the trust trade-offs legible before any 3rd-party work is scheduled.
