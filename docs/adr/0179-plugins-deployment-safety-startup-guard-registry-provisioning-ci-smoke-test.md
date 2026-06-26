<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0179: Plugins Deployment Safety — Startup Guard, Registry Provisioning, CI Smoke Test

## Status

Implemented

## Date

2026-06-01

## Context

A missing `plugins/` directory in a deployed Docker image crashed the bot ~50ms after startup, but only when `DEBUG_SERVER=true` triggered the lazy `import()` of a plugin-contributed task provider. The Dockerfile's `COPY plugins ./plugins` line was the must-do fix, but there was no defense in depth: a misbuilt image could still ship, and the only remaining `src/`→`plugins/` static import — `src/debug/settings/provision-routes.ts` reaching across the boundary to `provisionAndConfigure` — kept the settings HTTP provisioning route coupled to plugin internals.

The plan addressed this in three independent PRs: (1) make the missing-directory case observable and fail fast at startup instead of crashing mid-import; (2) introduce a plugin-contributed `provision` hook on the task-provider registry and rewire the settings route to dispatch through it, eliminating the cross-boundary static import; (3) add a CI smoke test that boots the freshly built Docker image and asserts it stays up, so any boot-time crash blocks the build.

## Decision Drivers

- **Defense in depth**: a missing `COPY plugins` should not be the only thing between a clean build and a crash in production; startup and CI should each catch it independently.
- **Layer isolation**: `src/` must not statically import from `plugins/`; the settings route should reach plugin behavior through the registry, the same abstraction `autoProvision` already uses.
- **Fail fast with an actionable message**: operators need a one-line reason pointing at the missing `COPY`, not a dynamic-import stack trace.
- **Degraded mode for non-debug deployments**: a bot running without `DEBUG_SERVER` should still start (plugins are optional in that mode) and log a warning.
- **CI catches boot crashes before merge**: the build should not turn green if the image exits within seconds of starting.

## Considered Options

### Startup guard

**A. Pure `evaluateStartupGuard` function + wiring in `src/index.ts`** (chosen)

- Pros: pure, unit-testable, no I/O; the decision is a discriminated union (`ok`/`warn`/`exit`) consumed by the single startup site; `directoryMissing` surfaced on `DiscoveryResult` makes the input explicit.
- Cons: adds a small module and a type; the guard is trivial but must be kept in sync with the `DEBUG_SERVER` semantics.

**B. Inline `if/exit` in `src/index.ts`**

- Pros: no new file.
- Cons: untestable; the exit/warn/ok logic is entangled with startup sequencing; duplicates the directory check.

### Provision dispatch

**A. Registry `provision` hook, looked up by provider type** (chosen)

- Pros: mirrors the existing `autoProvision` pattern; the route resolves the hook from `getTaskProviderProvision(taskInstance.type)`; `src/` has zero static imports from `plugins/`; YouTrack (no hook) returns 422 `unsupported` uniformly.
- Cons: adds `TaskProviderProvision*` types and threads `provision` through `PluginContributions`, `TaskProviderRegistrationInput`, `buildRegisterTaskProviderType`, and `commitTaskProviderRegistration`; the route name `handleProvisionKaneo` is now a misnomer (it serves any provider with a hook).

**B. Keep the cross-boundary import, guard it with a runtime `import()`**

- Pros: smaller diff.
- Cons: preserves the layering violation; a missing plugin module still crashes the route at request time, not startup.

### CI smoke test

**A. Bash script + a step in the `build` job** (chosen; diverged from the plan's separate `smoke` job)

- Pros: reuses the just-built image in the same job; no extra job scheduling; `docker/build-push-action` with `driver: docker` keeps the image visible to plain `docker` commands.
- Cons: lengthens the build job; a smoke failure fails `build` rather than an isolated `smoke` job.

**B. Separate `smoke` job depending on `build`** (the plan's original shape)

- Pros: isolated failure surface, clearer job name in the CI dashboard.
- Cons: requires exporting/re-loading the image between jobs (artifact or registry round-trip), adding latency and complexity.

## Decision

Three coordinated changes implement the architecture:

### 1. Defensive startup guard (PR 1)

`DiscoveryResult` gains a `directoryMissing: boolean` field, populated in all three return paths of `discoverPlugins` (`true` only when the directory does not exist; `false` for read failures and the normal path). A pure `evaluateStartupGuard({ directoryMissing, debugServerEnabled })` returns `{ action: 'ok' }`, `{ action: 'warn'; reason }`, or `{ action: 'exit'; reason }`. `src/index.ts` destructures `directoryMissing` from `discoverPlugins` and consumes the decision: `exit` → `log.fatal` + `process.exit(1)`; `warn` → `log.warn` and continue; `ok` → no-op. The exit reason names the missing `COPY plugins ./plugins` and the mount alternative.

### 2. Provision via the plugin registry (PR 2)

`TaskProviderProvisionContext`, `TaskProviderProvisionOutcome` (status-discriminated: `provisioned` / `registration_disabled` / `failed`), and `TaskProviderProvision` are added to `src/providers/registry.ts`. The `provision?` field threads through `ContributedTaskProviderEntry`, `TaskProviderTypeDescriptor`, `PluginContributions.taskProviderRegistration`, `TaskProviderRegistrationInput`, `buildRegisterTaskProviderType`, and `commitTaskProviderRegistration`, mirroring the existing `autoProvision` plumbing. `getTaskProviderProvision(type)` resolves the hook from the descriptor. `src/debug/settings/provision-routes.ts` is rewritten to authenticate, CSRF-check, resolve the context scope, load the assigned `task_instance`, look up `getTaskProviderProvision(taskInstance.type)`, and dispatch — returning 422 `unsupported` when no hook is registered. The Kaneo plugin exports `kaneoProvision` (delegating to `provisionAndConfigure`) and registers it in `activate`. After this, `git grep -nE "from ['\"][.][/]+plugins/" src/` returns zero matches.

### 3. CI Docker smoke test (PR 3)

`scripts/ci/docker-smoke-test.sh` runs the built image with `DEBUG_SERVER=true` and minimal stub env (`LLM_API_KEY`, `MAIN_MODEL`, `SETTINGS_PUBLIC_BASE_URL`, `INSTANCE_CONFIG_KEY`, `DB_PATH`), polls `docker inspect` for `Running` over a 15s deadline, then asserts the `"msg":"Starting papai..."` line is present and that no `Cannot find module` / `process.exit(1)` / pino `"level":60` (fatal) line appears. In CI the script is invoked as a step inside the `build` job (after "Build Docker image"), with `docker/build-push-action` configured to `driver: docker` so the host Docker daemon — and thus the script's `docker image inspect`/`docker run` — sees the image the build step produced.

## Consequences

### Positive

- A missing `plugins/` directory fails fast at startup with an actionable message instead of a deferred dynamic-import stack trace.
- `src/debug/settings/provision-routes.ts` no longer statically imports from `plugins/`; the last `src/`→`plugins/` cross-boundary import is gone.
- Provisioning is provider-agnostic at the route layer: any future provider that registers a `provision` hook is served by the same route without a route edit.
- CI blocks any image that exits within 15s or logs a fatal error, catching missing-`COPY`, bad imports, and missing required env uniformly.
- Degraded mode (no `DEBUG_SERVER`) preserves the historical non-debug startup path; only the debug surface requires plugins.

### Negative

- The route export is still named `handleProvisionKaneo` though it now dispatches to any registered provider hook; the name is a misnomer and a rename is a follow-up.
- The smoke test is a step in `build` rather than a separate `smoke` job (divergence from the plan), so a smoke failure fails the broader `build` job rather than an isolated surface; this was chosen to avoid image export/re-load complexity between jobs.
- The smoke script's fatal-error grep relies on pino's `"level":60` rather than a literal `FATAL` token (the literal substring false-positives on URLs/stack frames); any non-pino fatal log would not be caught.
- `TaskProviderProvisionOutcome` is Kaneo-shaped (the `provisioned` variant carries `email`/`password`/`kaneoUrl`/`apiKey`/`workspaceId`); a second provisioning provider with a different credential shape would need a union extension or a generic envelope.

### Risks

- The smoke test exercises only the boot path; it does not validate that plugin tools actually load or that a settings provision succeeds end-to-end — those remain covered by the server-side test suites, not CI.
- The startup guard keys on `directoryMissing` only; a present-but-empty `plugins/` directory (e.g. a bad copy that preserved the dir but not its contents) reports `ok` and starts in what is effectively degraded mode silently.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin activation model and contribution lifecycle this guard and provision hook extend.
- ADR-0130/0131/0133: Task Provider as Plugin (phases 1–3) — the plugin-contributed task-provider registry the `provision` hook plugs into.
- ADR-0177: Plugin Review Validated Remediation — the review pass that surfaced the deployment-safety gaps this work closes.

## Implementation Notes

Key files, confirming presence:

- `src/plugins/discovery.ts` — `DiscoveryResult.directoryMissing` populated in all three return paths (lines 34, 233, 244, 273).
- `src/plugins/startup-guard.ts` — `evaluateStartupGuard` pure guard (lines 6–29).
- `src/index.ts` — guard wired after `discoverPlugins` (lines 161–174); `exit` → `process.exit(1)`, `warn` → continue.
- `src/providers/registry.ts` — `TaskProviderProvisionContext`/`TaskProviderProvisionOutcome`/`TaskProviderProvision` types (lines 26–45), `provision` on `ContributedTaskProviderEntry` (line 66) and `TaskProviderTypeDescriptor` (line 206), `getTaskProviderProvision` lookup (line 195).
- `src/plugins/runtime-types.ts`, `src/plugins/context.ts`, `src/plugins/loader.ts` — `provision` threaded through the contribution/registration pipeline.
- `src/debug/settings/provision-routes.ts` — rewritten to dispatch via `getTaskProviderProvision`; no `plugins/` import remains (lines 1–89).
- `plugins/task-provider-kaneo/auto-provision.ts` — `kaneoProvision` export delegating to `provisionAndConfigure` (line 12).
- `plugins/task-provider-kaneo/index.ts` — `kaneoProvision` registered in `activate` (line 89).
- `scripts/ci/docker-smoke-test.sh` — boot/liveness/log assertion script (lines 1–72); uses `DB_PATH`, a `docker image inspect` precheck, and the `"level":60` fatal grep.
- `.github/workflows/ci.yml` — smoke step inside the `build` job (lines 43–48), `docker/build-push-action` with `driver: docker` (lines 25–32).

Divergences from the plan: the CI smoke test was inlined as a step in the existing `build` job rather than a separate `smoke` job, the buildx driver was pinned to `docker`, the script added a `docker image inspect` precheck and `DB_PATH` env, and the fatal-error grep uses pino's `"level":60` instead of the literal `FATAL`.
