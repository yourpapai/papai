<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Remediation Design (Verified Findings, 3rd Pass)

- **Date:** 2026-05-31
- **Status:** Approved design, pending implementation plan
- **Branch:** `multi-provider-fixes-3rd`
- **Supersedes/extends:** `2026-05-29-multi-provider-validated-findings-remediation-design.md`
  (that pass marked several items fixed that re-verification found still open — see #11/#18 below)

## Background

A code-review report on the multi-provider feature produced ~20 findings. Each
was re-verified against the current code by reading and quoting the actual
source. Results:

- **Confirmed verbatim:** 16 findings.
- **Partially correct (severity/wording adjusted):** #3 (masking) and #18
  (resolver branch).
- **Refuted:** the `start.ts` provisioning finding (originally MED) — passing
  `msg.user.id` into `maybeProvisionKaneo(contextId, …)` is the intended
  DM `contextId == userId` convention, not a relocated defect. **Out of scope.**

This spec covers **all confirmed findings**, organized into four
independently-mergeable tracks ordered by risk and shared root cause.

### Root cause threading the cluster

Migrations `048_namespace_kaneo_config` / `049` renamed the per-context provider
credential keys from the flat literals `kaneo_apikey` / `youtrack_token` to
plugin-namespaced keys (`plugin:task-provider-kaneo:provider:credential`,
`plugin:task-provider-youtrack:provider:token`). The **data** was renamed but
multiple **readers** still key on the old literals. Findings #1, #3, #4, #5, #6
are all instances of this one root cause. The fix direction is **descriptor-driven**:
no code hardcodes provider key names — required/sensitive/label/validation
metadata is derived from the live task-provider descriptor and its storage keys
are computed via the existing `storageKeyForProviderField`.

A second cross-cutting decision (`isolate + preserve`) governs the resilience
findings (#2, #7, #8, #12): one undecryptable encrypted row must never abort a
migration, throw on a read path, or tear down an already-running instance.

## Goals

- Restore the dead onboarding guard so unconfigured users are prompted to `/setup`.
- Make startup migrations and instance read/reconcile paths resilient to a
  single undecryptable encrypted row.
- Permanently eliminate the hardcoded-provider-key bug class via descriptor-driven
  resolution.
- Enforce the provider HTTP host allowlist instead of bypassing it.
- Remove dead code / leaked abstractions and refresh stale docs.

## Non-Goals

- The refuted `start.ts` provisioning finding (intended DM convention).
- Any new abstraction beyond a small descriptor-key helper; all fixes reuse
  existing `*Safe` decode helpers and descriptor machinery.
- Broad unrelated refactoring of the instances or wizard subsystems.

---

## Track 1 — Release blockers (HIGH)

### #1 — Dead required-config onboarding guard

**Defect.** `checkRequiredProviderConfig` (`src/llm-orchestrator-config.ts:24-26`)
filters the context's config keys with a type-guard against the literals
`'kaneo_apikey' | 'youtrack_token'`. After migrations 048/049,
`getConfigKeysForContext` returns plugin-namespaced keys, so the filter matches
nothing and always returns `[]`. `ensureRequiredConfig`
(`src/llm-orchestrator.ts:179`) runs on the live message path, so an unconfigured
user never receives the "Missing configuration… Use /setup" prompt; their turn
proceeds to a provider the resolver silently nulls out.

**Fix (descriptor-driven).** Resolve the task-provider descriptor for the
context's assigned task instance. Take its context-scoped fields where
`required: true`, compute each storage key with `storageKeyForProviderField`,
and report any of those keys missing from the context's stored config. No
provider key names are hardcoded.

**Files.** `src/llm-orchestrator-config.ts`; a small descriptor-required-keys
helper (co-located with `storageKeyForProviderField` in `src/config-keys.ts`).

### #2 — Migration 045 re-introduces the M1 crash

**Defect.** `src/db/migrations/045_provider_base_url.ts:24` runs
`decryptInstanceConfig(row.config)` inside `rows.forEach(...)` with no per-row
isolation. A single undecryptable row (e.g. after `INSTANCE_CONFIG_KEY` rotation)
throws → `backfillBaseUrl` aborts → `migration045.up()` aborts → `initDb()`
throws → `process.exit(1)`. This is the exact failure mode the runtime safe-decode
pattern (`rowsToInstancesSafe`) was created to prevent; it was never applied to
the migration path.

**Fix.** Wrap each row's decrypt+backfill in try/catch; on failure log a `WARN`
with the row id and `table`, then skip the row. The migration completes
regardless of unreadable rows.

**Files.** `src/db/migrations/045_provider_base_url.ts`.

---

## Track 2 — Stale-key cluster (root-cause completion)

All readers move off the old literals to descriptor-driven / namespaced resolution.

### #3 — `SENSITIVE_KEYS` stale (adjusted: maintainability, not active leak)

`src/config.ts:14` defines `SENSITIVE_KEYS = {'kaneo_apikey','youtrack_token'}`,
so `isSensitiveKey()` returns `false` for the namespaced keys. **Re-verification
note:** masking is NOT currently broken — both wizard masking paths
(`engine.ts:78` and `getNextPrompt`) fall back to `field.sensitive`, which is
`true` for the Kaneo credential and YouTrack token. So `SENSITIVE_KEYS` is dead
for these keys, and a real leak would require a sensitive field with
`field.sensitive` omitted.

**Fix.** Derive sensitivity from descriptor `field.sensitive` rather than a
hardcoded literal set; remove the stale literals. Keep any genuinely-static
sensitive keys (non-provider) in the set if such exist.

**Files.** `src/config.ts`.

### #4 — Wizard prompt/validation literal branches

`src/wizard/steps.ts:22` (`BUILTIN_PROMPTS`) and `:96-98` (`validateField`) key
on `'kaneo_apikey'`/`'youtrack_token'`; `:33` (`displayLabelForKey`) checks
`'youtrack_token'`. All dead for namespaced providers → generic fallthrough.

**Fix.** Drive prompt text, validation, and display labels from descriptor field
metadata (`label`, `required`, `sensitive`, any field-level validation). Remove
the dead literal branches.

**Files.** `src/wizard/steps.ts`.

### #5 — `labelForStorageKey` dead branch

`src/config-keys.ts:47-50` returns `'YouTrack Token'` only when
`storageKey === 'youtrack_token'` — dead for the namespaced key.

**Fix.** Derive the label from the descriptor field `label` resolved via the
storage key; drop the literal branch.

**Files.** `src/config-keys.ts`.

### #6 — `types/config.ts` enumerates old names as canonical

`src/types/config.ts:12` (`TaskProviderConfigKey`) and `:42-48`
(`ALL_CONFIG_KEYS`) still list `kaneo_apikey` / `kaneo_workspace_id` /
`youtrack_token` as canonical members of the config-key union.

**Fix.** Stop enumerating provider key literals as canonical config keys.
Provider keys are descriptor-derived at runtime; the static union retains only
genuinely-static config keys. Update dependent types/usages accordingly.

**Files.** `src/types/config.ts` (+ any callsites narrowing on the removed union
members).

---

## Track 3 — Instance resilience & lifecycle (isolate + preserve)

### #12 — Unsafe list helpers on production paths

`src/plugins/task-provider-lifecycle.ts:49`,
`src/setup/task-instance-selection.ts:30`, and `src/debug/admin-system.ts:27,33`
call the non-safe `listTaskInstances()` / `listPlatformInstances()`, which map
over `decryptInstanceConfig` and propagate. One bad row 500s the admin system
endpoint and breaks `/setup`.

**Fix.** Switch these callsites to the existing `*Safe` variants
(`listPlatformInstancesSafe` / `listTaskInstancesSafe`), which isolate per-row
failures into a `failures` diagnostics array and return readable rows.

**Files.** the three callsite files (and their default-deps wiring where
applicable).

### #7 — `/apply` tears down a healthy instance on an unreadable row

In `src/debug/instance-route-support.ts` reconciliation, a decode failure drops
the row from both `desiredById` and `activeIds`, so the still-running runtime
instance for that id lands in `runtimeIdsToRemove` and is removed with
`desiredStatus=null`. A transient decrypt/key-rotation error thus terminates a
healthy running provider.

**Fix (preserve).** Collect the ids that failed to decode (from the `*Safe`
`failures`) and exclude them from `runtimeIdsToRemove`. An unreadable row must
never tear down its already-running instance; leave it untouched and surface it
in diagnostics.

**Files.** `src/debug/instance-route-support.ts`.

### #8 — Failed `removeInstanceStrict` wedges the instance permanently

`src/chat/router.ts:90-96`: if `provider.stop()` throws, `instance.status` is
left at its pre-stop value and the entry stays in the map. Subsequent `/apply`
runs see same id + same config + `status !== 'stopped'` →
`reconcileActiveInstance` returns it `unchanged` forever. No retry until restart.

**Fix.** Wrap the stop in try/finally so the instance is removed from the map
(and/or marked `stopped`) even when `stop()` throws, allowing a later `/apply` to
retry. The thrown error is still surfaced as a failed patch upstream.

**Files.** `src/chat/router.ts`.

### #10 — Discord adapter reads `process.env['ADMIN_USER_ID']`

`src/chat/discord/index.ts:139` reads `process.env['ADMIN_USER_ID']` inside the
adapter, violating the "no env in adapters" rule (M3/D1). Currently inert — the
value flows only as a dead `_adminUserId` param and real `isAdmin` comes from the
interaction — but it is a per-instance correctness landmine.

**Fix.** Remove the env read and the dead `_adminUserId` param threading through
`map-message.ts` / `button-dispatch.ts`. `isAdmin` continues to come from the
interaction.

**Files.** `src/chat/discord/index.ts`, `src/chat/discord/map-message.ts`,
`src/chat/discord/button-dispatch.ts`.

### #11 — D3 dead branch not actually removed

`src/instances/bootstrap.ts:131-134` still contains the unreachable narrowing
branch after `collectMissing()`; the prior pass added a comment but left the dead
runtime branch. (`collectMissing()` already guards both `chatType` and
`adminUserId`, so the branch never executes.)

**Fix.** Remove the dead runtime branch; express the type-narrowing without an
unreachable early-return (e.g. derive the narrowed values from the same checks
`collectMissing()` performs, or assert via a typed helper).

**Files.** `src/instances/bootstrap.ts`.

### (optional) Flaky `bot.test.ts` "Access revoked" hook timeouts

`tests/bot.test.ts` "Access revoked during session" cases fail under full-suite
load with `beforeEach/afterEach hook timed out`; they pass 72/0 in isolation.
Not caused by this work. Stabilization (raising the hook timeout or reducing
per-test setup cost) may be folded into this track.

**Files.** `tests/bot.test.ts` (+ shared setup if the timeout source is there).

---

## Track 4 — Abstractions, dead code & docs

### #13 — `removeInstanceStrict` dead-naming

The non-strict twin was deleted; the `Strict` qualifier no longer contrasts with
anything. Rename to `removeInstance` and update callsites.

**Files.** `src/chat/router.ts` + callsites.

### #14 — `ApplyFailureAction` includes never-emitted `'stop'`

`src/debug/instance-route-support.ts:28` declares
`'remove' | 'recreate' | 'start' | 'stop'`, but no `failedPatch`/`startedPatch`
call ever emits `'stop'`. Remove the dead union member.

**Files.** `src/debug/instance-route-support.ts` (+ any client union mirror).

### #15 — Provider HTTP bypasses the host allowlist

Both manifests declare `providerAllowedHosts: []` while holding `provider.task`,
and both clients call global `fetch()` directly
(`plugins/task-provider-kaneo/client.ts:88`,
`plugins/task-provider-youtrack/client.ts:62,114`), so the `providerRuntime`
host-allowlist safety net is declared but never applied.

**Fix (enforce).** Route both plugins' HTTP through `ctx.providerRuntime` so the
allowlist is enforced, and populate `providerAllowedHosts` in both manifests with
the real provider hosts (instance `baseUrl` host plus Kaneo `internalUrl` host as
applicable). Verify the providerRuntime helper supports the request shapes the
clients need before cutover.

**Files.** `plugins/task-provider-kaneo/client.ts`,
`plugins/task-provider-youtrack/client.ts`, both `plugin.json`.

### #16 — `internalUrl` two divergent config pipelines

Kaneo's `internalUrl` is declared in `providerConfigSchema` but the factory
(`plugins/task-provider-kaneo/index.ts`) ignores it; it is read only via a direct
`taskInstance.config['internalUrl']` in provisioning.

**Fix (factory consumes it).** Make the Kaneo factory read `internalUrl` from
config into `KaneoConfig` so the schema-declared field flows through the normal
provider pipeline; provisioning reads it from the same typed config rather than
the raw record.

**Files.** `plugins/task-provider-kaneo/index.ts`, Kaneo provisioning.

### #17 — Misleading validator comments

Both `validate-config.ts` files claim "context-scoped fields are NOT available
here," but `validateEffectiveTaskProviderConfigResult` passes the merged config
(including context-scoped `credential`/`token`) at resolver time via
`descriptorFieldsForMode(descriptor, true)`. No bug (the validators don't consume
those fields), but the comments mislead future authors.

**Fix.** Correct the comments to state that at resolver time the merged config
including context-scoped fields is passed, and that the instance-config-only
validation path is the one without context fields. Comment-only; no behavior
change.

**Files.** both plugins' `validate-config.ts`.

### #18 — Resolver `descriptor === undefined` branch (adjusted)

`src/providers/resolver.ts:149-154`: when `descriptor === undefined` the code
builds `{ ...instance.config }` then hands it to `createValidatedProvider`, which
immediately returns `null` via `unknown_task_provider`. **Re-verification note:**
the branch is reachable (a plugin deactivated after its instance row exists), not
pure dead code, but the config object is built and never used.

**Fix.** Return `null` early on `descriptor === undefined` (with a `WARN`) instead
of building an unused config and round-tripping through the validator.

**Files.** `src/providers/resolver.ts`.

### #19 — Two-phase `validateConfig` mutation in loader

`src/plugins/loader.ts:150` mutates
`activationContext.collected.taskProviderRegistration.validateConfig` after the
plugin's `activate()` has already built the registration — a mutable-field-after-
build pattern.

**Fix.** Prefer passing the resolved validator at registration time
(`registerTaskProviderType`) if the registration API allows it. If the
activation-ordering constraint genuinely forces post-hoc assignment, keep the
mutation but document the constraint inline. Decide during implementation based
on the registration API shape.

**Files.** `src/plugins/loader.ts` (+ possibly the registration facade).

### #20 — ADR-0009 stale

`docs/adr/0009-multi-provider-task-tracker-support.md` describes `src/providers/kaneo/`
(deleted) and `llm-orchestrator.ts` reading `TASK_PROVIDER` (gone) as the current
implementation.

**Fix.** Update ADR-0009's Implementation Status to reflect plugin-contributed
providers under `plugins/task-provider-*/` and the resolver/descriptor flow;
remove the `src/providers/kaneo/` and `TASK_PROVIDER` references.

**Files.** `docs/adr/0009-multi-provider-task-tracker-support.md`.

---

## Cross-Cutting Concerns

### Testing (TDD per finding)

Each bug-fix follows Red → Green. Representative failing tests to add first:

- **#1:** an unconfigured context produces the "Missing configuration… Use /setup"
  reply on the live message path.
- **#2:** migration 045 completes (and backfills readable rows) when one row is
  undecryptable, logging a WARN instead of throwing.
- **#7:** `/apply` with one unreadable row leaves the corresponding running
  instance in the router map (no teardown) and reports it in diagnostics.
- **#8:** `removeInstance` clears the map entry even when `provider.stop()`
  throws, and a subsequent reconcile can retry.
- **#12:** the three list callsites return readable rows when one row is
  undecryptable instead of throwing.
- **#15:** provider HTTP requests are rejected/allowed per `providerAllowedHosts`.
- **#16:** `internalUrl` set in config reaches the constructed Kaneo provider.

Descriptor-driven changes (#1, #3–#6) get tests asserting behavior under the
namespaced keys (e.g. required-key detection, masking, labels) so the bug class
cannot silently regress if keys are renamed again.

### Error handling

Unreadable rows always degrade to `WARN` + diagnostics on read/migrate/reconcile
paths and never throw or tear down running instances. Provider-runtime HTTP
rejections (host not allowlisted) surface as structured provider failures, not
crashes.

### Sequencing

Tracks are independently mergeable and ordered 1 → 4. Track 1 (release blockers)
can ship first. Track 2 completes the descriptor-driven root-cause fix. Track 3
shares the `isolate + preserve` decision. Track 4 is cleanup + docs.

## Open Questions

- #19: whether `registerTaskProviderType` can accept the validator at
  registration time, or the activation ordering forces the documented post-hoc
  mutation. Resolve during implementation.
- #15: confirm the `providerRuntime` helper covers all request shapes both
  clients use before cutover; if a gap exists, extend the helper rather than
  retaining direct `fetch`.
