<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## Why

afk-runner bookkeeping lives in a per-worktree `.afk-runner/` directory: every worktree holds its own runs, and the web board, `runs` accounting, and `analyze` corpus reports each see exactly one workdir. With multiple worktrees and projects in active use (two on this machine today, five more scattered by the pre-registered agent-mcp drill), there is no single place to observe runs, and no evidence base for deciding whether a shared supervision service is worth building. The engine's substrate (fold-is-truth over append-only logs, a workDir already relocatable by config, DI-seamed read surfaces) makes a centralized store cheap to try now — and the analyzer already records the settle-origin facts that price the remote-control features such a service would add.

## What Changes

- **Phase 0 — gate-attendance forensics**: a new zero-spawn metric family in the `analyze` corpus report — human vs policy vs waiter settle attribution joined with presented→answered wait latency — measuring how much gates actually wait for people.
- **Phase 1 — central-store dogfood**: `~/.afk-runner/projects/<slug>/` pinned as a supported workDir target of the existing five-key config ladder; a documented move-and-cutover procedure; two live worktrees dogfooding the shared store; an evidence notes artifact.
- The phased roadmap beyond (aggregation daemon, bridge service) is mapped in `design.md` as follow-up proposals gated on this change's evidence; nothing in those phases is implemented here.

## Capabilities

### New Capabilities

- `afk-runner-store`: central per-project run storage under `~/.afk-runner/` as a pinned contract — an absolute `workDir` in `.afk-runner/config.json` relocates all bookkeeping out of the worktree while the config lookup itself stays at `<repoRoot>/.afk-runner/`. Without it, central storage remains incidental `path.resolve` behavior: unpinned, undocumented, and unusable as the foundation the later aggregation phases need.

### Modified Capabilities

- `afk-runner-analysis`: adds the gate-attendance metric (settle-origin attribution × wait latency, per gate and aggregated) to the corpus report. The analyzer already computes settle origin per gate by emission order; without this metric the facts stay latent and any remote-settle investment case is argued from anecdote.

## Non-goals

- The Phase 2 aggregation daemon (one board over N stores, registration, singleton lifecycle) — follow-up change.
- The Phase 3 bridge (spawn supervision, delegated/remote settles, split-plane control, papai-bot as client) — follow-up change.
- Any gate-answering UX change; operators keep answering gate files wherever the workDir points.
- Multi-project grouping in the web board or `runs` output — deferred to the dogfood evidence.
- Multi-user/SaaS operation; the store is single-user, machine-local.
- Automated migration tooling; a documented manual move procedure is enough for two worktrees.

## Impact

- No platform or task instances affected; no chat config-context impact — the new persisted state is local filesystem storage under the user's home directory, per-user and machine-local by construction.
- Code: `afk-runner/src/analyze-*` (new metric modules), `afk-runner/src/config.ts` (contract pin; no ladder change), `tests/afk-runner/`.
- Docs: `docs/architecture/afk-runner.md` (layout + roadmap); precedent referenced from `docs/architecture/context-vault.md`.
- No DB changes; no new dependencies.
