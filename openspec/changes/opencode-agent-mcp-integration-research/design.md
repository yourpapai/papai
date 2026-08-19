<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Research — connecting custom MCP servers into the agent pipeline

## Context

See `proposal.md` — Goal and Required content. Four current-state facts shape
the approach:

- Both execution paths are fed by one builder: `buildOpencodeConfig` in
  `opencode-agent/src/openai-config.ts` serves the in-process session and is
  serialised into `OPENCODE_CONFIG_CONTENT` for the review-loop's
  `opencode run` subprocesses. Any surface the research recommends must be
  describable as an injection into that one builder, or it cannot reach both
  paths — the research records where the injection would sit, without touching
  the builder.
- The two OpenCode pins differ and the server's version decides behaviour
  (`@opencode-ai/sdk@1.18.12` types the config; `opencode-ai@1.18.7` reads
  it). Config-shape claims anchor to the SDK types; behaviour claims must be
  verified against the binary.
- Roadmap finding S3-9 already established that the spawned server's
  environment — `OPENCODE_CONFIG_CONTENT` included — is model-readable via
  `bash` in the `build` profile, and `provider-proxy.ts` (loopback
  placeholder) and `secrets.ts` (value-based scrubbing) already exist as the
  containment patterns the credential assessment generalises.
- This job runs inside the pipeline it studies: its control plane is an
  `opencode serve` on loopback, so live verification must never kill by name.

## Goals / Non-Goals

**Goals:**

- One document an implementer can act on without re-doing the discovery:
  every plausible configuration surface enumerated, scored on end-user UX
  against the CI constraints and the security model, and ranked.
- Every claim traceable: SDK anchors cited by file:line, behaviour verified
  against the real binary or explicitly marked by inspection, CI facts cited
  to the workflow/README/Roadmap findings that established them.
- Live verification that leaves the job's own control plane untouched and no
  residue in the repository.

**Non-Goals:**

- Everything listed in `proposal.md` — Non-goals (no production code, no
  `mcp` block in any runtime config, no per-server opt-out, no credential
  containment). Design-level additions: no new module, test, dependency, or
  workflow change of any kind; the throwaway experiment server is neither
  committed nor installed from npm.

## Decisions

### D1 — The document lives in `opencode-agent/docs/`, in the existing findings style

`remaining-findings-evaluation.md` and `review-command-plan.md` set the
conventions: SPDX header, verdict-first presentation, **verified** / **by
inspection** confidence labels on claims. The new document follows them; the
licence-header gate that applies to those files applies to this one.

*Alternative considered — `docs/architecture/` in the papai root or the change
folder itself.* Rejected: the workspace keeps its findings beside the Roadmap
that tracks them, and its readers (README knob table, Roadmap findings) link
within the workspace.

### D2 — Live verification feeds `OPENCODE_CONFIG_CONTENT`, not the SDK runtime endpoints

Experiments hand the real `opencode` binary a config containing an `mcp`
block via `OPENCODE_CONFIG_CONTENT` — the exact transport the review-loop
subprocess path uses — plus a throwaway stdio MCP server. The runtime
endpoints (`POST /mcp`, `/mcp/{name}/connect|disconnect|auth`, `GET /mcp`
status) are recorded from the SDK types and judged for unattended usability,
but the config route is the one verified live, because it is the route any
recommended surface would actually take.

*Alternative considered — driving the runtime endpoints.* Kept as a recorded
assessment, not the verification vehicle: an unattended job cannot complete an
OAuth browser flow, so half the endpoint surface is dead on arrival and would
verify nothing the pipeline can use.

### D3 — The throwaway MCP server is an inline script, not an npm package

The experiment server is a minimal stdio JSON-RPC responder written into the
job's temp directory at run time. No dependency is added, nothing
supply-chain touches the workspace, and nothing is left in the tree. A
published `bunx`-able server would adopt the very supply-chain exposure the
comparison is supposed to score, not take on.

### D4 — Pid discipline: experiments are killed by recorded pid, never by name

Every spawned experiment records its pid at spawn time and is terminated by
that pid; `pkill`/`killall` are excluded because this job's control plane is
an `opencode serve` on loopback that shares the binary's name. Every
experiment command is bounded with a timeout so a wedged server cannot hang
the job, and the control plane is confirmed alive after the experiments.

### D5 — The comparison fixes its scoring dimensions before ranking

Each surface is scored on the same dimensions: what the user must know about
pipeline internals; where the value lives and how it is reviewed and changed;
how secrets are supplied; what failure looks like; plus its CI-constraint and
security assessment. Issue- and comment-level configuration is scored and
then rejected on security grounds inside the document, not omitted — the
rejection (arbitrary command execution / exfiltration endpoint from untrusted
input) is itself a finding an implementer needs on record.

### D6 — The recommendation records the permission shape as a finding, not a design

The `<server>_*` wildcard grant across both profiles and the global default is
confirmed against the resolved permission rules the real binary reports — the
same verification method the existing plan/build permission table used — and
recorded. The deferred items (per-server opt-out; credential containment for
MCP headers and environment blocks) are named as follow-ups with their risk
documented per option, not designed.

## Capability gating, scope model, dependencies, hooks

- **Capability gating / tool-prefs:** no new tool surface ships in this
  change; nothing enters the deny-by-default profiles or papai's `tool_prefs`.
  The document records the future gating shape (D6) as a verified finding
  only.
- **Scope model:** no persisted state of any kind — no storage context id,
  config context id, platform instance, or user keys anything. The only
  artifact is a committed markdown file riding the change branch.
- **DB / dependencies:** no drizzle migration or backfill; no new dependency
  (D3). No new module — the existing `docs/` conventions cover the
  deliverable.
- **Hook/TDD interactions:** a docs-only change writes no test or source
  file, so the Write/Edit TDD hook pipeline has nothing to gate; the
  licence-header and format checks are the gates that apply to the new file.
  There is no test-first order of work — verification is the document's own
  labelled evidence plus `bun run lint`, `bun run typecheck`, and
  `bun run format:check`.

## Risks / Trade-offs

- **Live verification kills the control plane.** → Mitigation: D4 — pid-only
  kills, timeouts on every experiment, and a final liveness check on the
  loopback control plane.
- **The two pins disagree — SDK types say one thing, the binary does another.**
  → Mitigation: behaviour claims are verified against the binary (the version
  that decides), and the document records both pin numbers so a later bump
  knows what to re-verify — the same re-record convention `sdk-contract.ts`
  carries.
- **A repo-committed config could silently override pipeline-owned config.** →
  Mitigation: merge-vs-override semantics are verified live (D2) and the
  security consequence is scored into the repo-file option, not left open.
- **Experiments leave residue or carry credentials.** → Mitigation:
  placeholder token values only, temp-dir scratch, and a diff confined to the
  two named files.
- **Findings go stale after a pin bump.** → Mitigation: accepted — the
  document records versions and method, matching the workspace's
  recorded-findings convention; it is a snapshot, not a contract.

## Migration Plan

None. Additive docs-only change delivered through the pipeline's normal
DELIVER phase as a pull request; maintainer review is the acceptance gate.
Rollback is reverting the commit.

## Open Questions

- Whether the optional `ROADMAP.md` link line is added — decided by whether
  the research surfaces a follow-up worth tracking, and settled while writing
  the document; it changes neither the specs, the approach, nor the task
  breakdown.
