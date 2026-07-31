<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0285: App-Local Story Dependencies (Per-Run Copy/Seal)

## Status

Not Implemented

## Date

2026-07-14

## Context

ADR-0283 shipped the first OS-enforced sandbox for Tier 0 stories as a dual-platform model: a native `sandbox-exec` (Seatbelt) backend on Darwin and a pinned-image Docker backend on Linux. Both backends exposed the lock-keyed dependency closure to the child via a **session-sibling symlink** — `<session>/node_modules` linking back into the parent-owned cache, with the app's own `appRoot` linking to it. That layout exposed a structural defect specific to Darwin: Bun 1.3.13 resolves scoped packages by **enumerating ancestor directories above `appRoot`**. A sibling dependency link under the system temporary directory still triggers that enumeration, and allowing the temporary-directory ancestors would weaken the session-only filesystem read boundary that Seatbelt was meant to enforce. The sibling-link layout was therefore incompatible with a hermetic Darwin profile.

This plan (`docs/superpowers/plans/2026-07-14-hermetic-story-app-local-dependencies.md`) and its design (`docs/superpowers/specs/2026-07-14-hermetic-story-app-local-dependencies-design.md`) proposed to close that defect by **materializing the verified dependency snapshot into a real `<session>/app/node_modules` directory** (a copy, not a link) before sealing the app, and by stripping every dependency-cache path from the sandbox contracts. The cache would remain a parent-owned, sealed source for the materialization but would never be mounted, linked, or otherwise exposed directly to the child. The Darwin profile would then permit reads only to `appRoot` and platform runtime paths — no dependency-cache, temporary-parent, worktree, or home-directory grant — letting the normal Bun resolver operate without any parent-directory permission. The Linux backend would mount `appRoot` read-only at `/session/app` and drop the separate dependency-cache/node_modules bind mount.

The design was overtaken by events within hours. On the same day (2026-07-14) the companion `docker-all-hosts` design retired the Seatbelt backend entirely — the very backend whose scoped-package-enumeration defect this plan existed to work around. With Seatbelt gone, the Darwin-specific motivation vanished. Three days later (2026-07-17) the **zero-copy dependencies** design superseded this plan's per-run copy with a read-only bind mount of the sealed cache at `/session/app/node_modules`, which achieves the same child-facing app-local layout without copying the ~609 MB tree per invocation. The design spec's own header records this supersession explicitly, and ADR-0225's supersession table freezes the chain.

## Decision Drivers

- **Preserve the session-only read boundary under Seatbelt.** The Darwin profile must not grant reads to temporary-directory ancestors, yet Bun's scoped-package resolution required exactly those ancestors under the sibling-link layout — a contradiction the plan had to resolve.
- **The child sees dependencies only below `appRoot`.** `<session>/app/node_modules` must be a real directory (not a symlink, not a sibling link) so the normal Bun resolver works without any parent-directory permission.
- **The dependency cache stays parent-owned and never reaches the child directly.** The sealed cache is a materialization source; it is never mounted, linked, or otherwise exposed to the sandboxed process.
- **Integrity is proven, not assumed.** The materialized app-local tree must match the sealed dependency snapshot's `treeHash`, and session integrity verification must detect both app-local and parent-cache mutation before and after child execution.
- **Fail-closed on every contract violation.** Non-regular files, symlinks escaping the source tree, dangling links, and hash mismatches each abort with a diagnostic before the child is launched.
- **Backend contracts carry no cache paths.** `StorySandboxRequest` drops `dependencyRoot`; the Darwin profile grants only `appRoot` plus runtime paths; Linux drops the separate `/session/node_modules` bind mount.

## Considered Options

### Option 1 — per-run copy/seal of the dependency tree into a real `app/node_modules` directory (the plan's choice)

Add a `materializeSessionDependencies(source, destination, fs)` helper that traverses the sealed cache with `lstat`/`readdir`, copies one regular file at a time, permits internal symlinks only after resolved-target containment in `sourceRoot`, rejects special/dangling/escaping entries, makes the destination readonly, and returns `hashDependencyTree(destination)`. Session assembly materializes the cache into `appRoot/node_modules`, requires its hash to equal `dependency.treeHash`, removes the session-level sibling link, and seals the app only after the local dependencies are readonly. Sandbox contracts drop `dependencyRoot` and all cache grants/mounts.

- **Pros:** closes the Seatbelt enumeration defect structurally — the child's resolver never touches a parent directory; the cache is never exposed to the child; integrity is hash-proven on both app-local and parent-cache trees; backend contracts become minimal and uniform.
- **Cons:** copies the ~609 MB dependency tree into every session (a per-run cost the plan accepted as the price of Seatbelt compatibility); adds a validated-copy helper and its contracts; widens session-integrity verification to cover two trees.

### Option 2 — zero-copy read-only bind mount of the sealed cache at `/session/app/node_modules` (chosen by history — superseded this plan)

Keep the dependency closure in the parent-owned, sealed cache; expose it to the child as a Docker read-only bind mount at `/session/app/node_modules`. No per-run copy; the child still resolves dependencies below its apparent app root, but the bytes are the cache's bytes, projected by the container.

- **Pros:** achieves the same child-facing app-local layout with **zero per-run copy** (the ~609 MB / ~60 s materialization is eliminated); only viable once Seatbelt is gone, since it relies on Docker's mount namespacing rather than a Darwin filesystem profile; becomes the final dependency-exposure model recorded by ADR-0225.
- **Cons:** incompatible with the Seatbelt backend this plan was written for (Seatbelt has no equivalent of a container mount namespace that can project a cache directory under the app root without granting the cache path itself); requires the Docker-on-all-hosts decision to land first.

### Option 3 — keep the sibling-link layout and widen the Seatbelt profile to permit temporary-directory ancestors

Grant the Darwin profile reads up the temporary-directory chain so Bun's scoped-package enumeration succeeds.

- **Pros:** no copy, no new helper, no contract change.
- **Cons:** abandons the session-only read boundary — the whole point of the OS sandbox; the design explicitly rejected granting temporary-directory ancestors, worktree, `HOME`, or the cache root. This was the status quo the plan existed to fix.

## Decision

The plan decided on Option 1 across a sealed-copy helper, simplified session assembly, stripped sandbox contracts, and a reopened hard-boundary acceptance suite. **None of it shipped:** before any task landed, the Seatbelt backend was retired (2026-07-14) and the design was superseded by the zero-copy bind mount (2026-07-17). What the plan called for:

1. **App-local sealed dependency materialization** (Task 1). A new `scripts/story-runner-session-dependencies.ts` exporting `materializeSessionDependencies(sourceRoot, destinationRoot, fs)` — a validated recursive copy that traverses with `lstat`/`readdir`, permits only contained internal symlinks, rejects special/dangling/escaping entries, makes the destination readonly, and returns `hashDependencyTree(destinationRoot, fs, true)`.
2. **Replace links in session assembly** (Task 1). Materialize the cache into `appRoot/node_modules`, require its hash to equal `dependency.treeHash`, remove the session-level sibling link, seal the app only after local dependencies are readonly, and verify both app-local and parent-cache hashes before and after child execution.
3. **Remove cache paths from sandbox contracts** (Task 2). Drop `dependencyRoot` from `StorySandboxRequest`; delete cache-link validation and grants on Darwin; drop the separate `/session/node_modules` bind mount on Linux while retaining app-readonly, tmp/report-write, UID:GID, no-IPC/network, and capability restrictions.
4. **Simplify Linux** (Task 2). Remove dependency validation, mount, and host/container path translation; retain app readonly, tmp/report writes, and the existing hardening; update runner-request assertions to contain app/tmp/reports only.
5. **Reopen the hard-boundary acceptance suite** (Task 3). Direct-child controls import `@fixture/dependency` from app-local modules before each host-sentinel probe; candidate manifest evidence records `sandboxBackend` and the dependency hash; baseline comparison accepts the historical omission; docs record that the child sees sealed app-local dependencies while evidence records the cache fingerprint/backend.

Because the design was superseded, items 1–5 were never executed — the plan's checkboxes remain `- [ ]`, the named files were never created, and the contracts the plan would have stripped still carry the dependency-cache paths the zero-copy bind mount requires. The child-facing *outcome* (dependencies resolvable at an app-local path, no session-sibling link) was instead achieved by ADR-0225's read-only bind mount, which projects the sealed cache at `/session/app/node_modules` without a per-run copy.

## Consequences

### Positive

- The plan correctly diagnosed the Seatbelt scoped-package-enumeration defect and proposed a structurally sound fix for it; had the Docker-on-all-hosts decision not landed the same day, the per-run copy would have closed the boundary as designed.
- The supersession was rapid and explicit: the design spec's own header, ADR-0225's supersession table, and the zero-copy design all record the chain, so the discarded per-run-copy path is documented and unlikely to be re-attempted.
- The child-facing goal (dependencies resolvable below the app root, no sibling link into the parent cache) was ultimately met by the zero-copy bind mount — a strictly better outcome that avoids the ~609 MB per-run copy this plan would have incurred.

### Negative

- The plan was written but never executed. `scripts/story-runner-session-dependencies.ts` does not exist; `materializeSessionDependencies`, `copyValidatedEntry`, and `makeDependencyTreeReadOnly` are absent from the codebase; the plan's three tasks and every checkbox remain incomplete.
- The supersession was a near-simultaneous event: this plan (2026-07-14), the Seatbelt-retiring docker-all-hosts design (2026-07-14), and the zero-copy design (2026-07-17) all landed within three days, so the per-run-copy work was overtaken before it could start.
- The Darwin-specific motivation (Bun's ancestor enumeration under Seatbelt) is now moot in the shipped tree, because the macOS backend the plan targeted no longer exists — a future contributor reading only this plan would misread its urgency without the supersession context ADR-0225 and this ADR provide.

### Risks

- **A future Bun version could revive native scoped-package resolution behavior.** If a macOS-native (Seatbelt-style) backend is ever reattempted and Bun still enumerates ancestors, the defect this plan diagnosed would recur. The zero-copy bind mount relies on Docker mount namespacing and does not answer a native-backend question; any such revival should consult this plan's diagnosis before re-proposing a per-run copy or a widened profile.
- **The plan's validated-copy helper was never built or tested.** If a future design needs a sealed recursive copy with symlink-containment and hash verification (e.g. for a non-Docker hermetic lane), it cannot reuse this plan's helper — the design exists only as a spec, and the zero-copy bind mount sidesteps the need entirely.
- **Documentation drift.** The supersession is recorded in the design spec header and in ADR-0225, but a reader who reaches the plan through an older index or branch may not see the supersession notice. Archiving the plan and spec alongside this ADR (per the closing note) is the mitigation.

## Related Decisions

- **ADR-0225** — Hermetic Story Execution — Docker-Only OS Sandbox with Immutable Snapshots. **Supersedes** this plan in full. Its supersession table records "2026-07-14 app-local dependencies — Superseded by zero-copy bind mount once Seatbelt was gone." The shipped dependency-exposure model is the read-only bind mount at `/session/app/node_modules` (`scripts/story/sandbox.ts:218`), not this plan's per-run copy.
- **ADR-0283** — Hermetic Story Process Sandbox, Phase 1. Established the dual-platform (Seatbelt + Docker) sandbox and the session-sibling dependency link whose Darwin-specific defect this plan existed to fix. ADR-0283's Task 3 (Seatbelt backend) was built and retired for the same ancestor-enumeration reason; this plan was the dependency-side companion to that backend, and it fell with it.
- **ADR-0282** — Hermetic E2E Master Baseline. Established the runner-owned session (`app/`, `tmp/`, reports) and the JS I/O guard whose bypasses the OS sandbox (and thus this dependency-exposure question) addressed. The session contract (`scripts/story/session.ts:33-46`) still exposes `dependencyRoot` because the zero-copy model, not this plan's app-local copy, is what shipped.
- **ADR-0284** — Scenario Catalog Hermetic Story Coverage Ledger. The Tier 0 inventory whose executable records depend on the hermetic execution model this dependency-exposure question is part of; unaffected by which dependency-exposure design won, since both produce an app-local `node_modules` path for the child.
- **The companion designs** (`docs/superpowers/specs/2026-07-14-hermetic-story-docker-all-hosts-design.md`, retired Seatbelt; `docs/superpowers/specs/2026-07-17-hermetic-story-zero-copy-dependencies-design.md`, the replacing bind-mount model) — the two designs that, together, made this plan obsolete before it started.

## Implementation Notes

Verified against the shipped tree via `grep`/`glob`/`read`. **No artifact this plan named or described is present.** The table records both the absent plan artifacts and the zero-copy bind mount that replaced them.

| File | Role | Evidence |
| --- | --- | --- |
| `scripts/story-runner-session-dependencies.ts` | Plan Task 1: new sealed-copy helper (`materializeSessionDependencies`). | **Absent.** `glob scripts/story-runner-session*.ts` returns no matches; the runner lives under `scripts/story/`. |
| `scripts/story/session.ts:33-46` | Session contract still exposes `dependencyRoot: string` (plan Task 2 required its removal from the sandbox request; the session exposes the cache root to the sandbox for the bind mount). | `read` confirms — line 36. |
| `scripts/story/session.ts:205` | `createStoryRunnerSession` still populates `dependencyRoot: dependency.root` — the parent-owned cache root, not a materialized app-local copy. | `read` confirms. |
| `scripts/story/sandbox.ts:15-23` | `StorySandboxRequest` still carries `dependencyRoot: string` (line 18). Plan Task 2 Step 3 prescribed its removal; the zero-copy bind mount requires it. | `read` confirms. |
| `scripts/story/sandbox.ts:179-225` | `buildLinuxStorySandboxCommand()` still mounts the dependency root read-only at `/session/app/node_modules` via `dockerMount(dependencyRoot, '/session/app/node_modules', true)` (line 218). Plan Task 2 Steps 3–4 prescribed removing exactly this bind mount; the zero-copy design retained it. | `read` confirms. |
| `scripts/story/sandbox.ts:11` | `StorySandboxBackend = 'linux-docker'` — only Docker survives. The macOS Seatbelt backend this plan targeted does not exist in the shipped tree. | `read` confirms. |
| `scripts/story/child.ts:77` | Child invocation still passes `dependencyRoot: session.dependencyRoot` into the sandbox request. | `grep` confirms. |
| `materializeSessionDependencies` / `copyValidatedEntry` / `makeDependencyTreeReadOnly` | Plan Task 1 Step 3 helper functions. | **Absent.** Repo-wide `grep` finds these symbols only inside the plan file itself. |
| `scripts/story/dependencies.ts` | Lock-keyed sealed cache that this plan would have copied from. Present and unchanged in role; the cache is now bind-mounted rather than copied. | `glob` confirms (cf. ADR-0225/0283 evidence). |
| `tests/stories/sandbox/process-boundary.test.ts` | Hard-boundary acceptance suite (plan Task 3). Present, but its `dependency-mount-write` probe (cf. ADR-0283) asserts the read-only bind mount rejects child writes — i.e. it proves the zero-copy model, not this plan's per-run copy. | `glob` confirms; ADR-0283 records the eight-operation suite. |
| `docs/superpowers/specs/2026-07-14-hermetic-story-app-local-dependencies-design.md:10-14` | The design spec's own header declares `Status: Superseded by 2026-07-17-hermetic-story-zero-copy-dependencies-design.md (read-only bind mount instead of per-run copy) after 2026-07-14-hermetic-story-docker-all-hosts-design.md retired the Seatbelt backend this layout was built for.` | `read` confirms. |
| `docs/adr/0225-hermetic-story-execution-docker-sandbox.md:95` | ADR-0225 supersession table: "2026-07-14 app-local dependencies — Superseded by zero-copy bind mount once Seatbelt was gone." | `read` confirms. |

Plan-vs-implementation notes:

- **The plan was not executed; it was superseded before any task started.** All three tasks and every step retain their `- [ ]` checkboxes in the source plan. The named creation (`scripts/story-runner-session-dependencies.ts`) was never written; the named modifications (`scripts/story-runner-session.ts`, `scripts/story-sandbox.ts`, `scripts/story-sandbox-macos.ts`, `scripts/story-sandbox-linux.ts`) target flat filenames that do not exist in the shipped tree — the runner was reorganized into the `scripts/story/` package by ADR-0282/0283.
- **The motivating backend (Seatbelt) was retired the same day.** The plan's entire rationale — Bun's ancestor enumeration under the Darwin `sandbox-exec` profile — ceased to apply when the `docker-all-hosts` design moved every host to the Linux container. ADR-0225 records the Seatbelt retirement and the ancestor-enumeration root cause; ADR-0283 records that its Task 3 Seatbelt backend was built and then removed for the same reason.
- **The child-facing outcome was achieved a different way.** Both this plan's per-run copy and the shipped zero-copy bind mount present dependencies to the child at an app-local path (`/session/app/node_modules`) with no session-sibling link. The difference is mechanism: this plan copied and hashed ~609 MB per run; the shipped model projects the sealed cache through Docker's read-only bind mount at zero copy cost. ADR-0225 measures the eliminated setup ("a 60-second setup for a 2.5-second suite" under the copy model) as one of the defects the zero-copy design closed.
- **The manifest already records the dependency fingerprint and backend either way.** Plan Task 3's requirement that candidate manifest evidence record `sandboxBackend` and the dependency hash shipped independently via ADR-0283 (`scripts/story/manifest.ts` `dependencySnapshot` + `sandboxBackend`, strict-optional), so the evidence-recording intent of Task 3 is satisfied even though the Task 3 fixture changes (app-local `@fixture/dependency` import) were never made.

The source plan `docs/superpowers/plans/2026-07-14-hermetic-story-app-local-dependencies.md` and design `docs/superpowers/specs/2026-07-14-hermetic-story-app-local-dependencies-design.md` are archived alongside this ADR to `docs/archive/`.
