<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0366: Provider-Pair Open-Findings Fixes — Server-Guaranteed Labels and No Silent Preselection

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-04)

## Context

The two task-provider settings sections — `TaskProviderSection` (per-context binding) and `GroupProviderSection` (group binding) — are a structurally duplicated pair. Between them they carried 5 open UX-review findings (`docs/ux-reviews/TaskProviderSection.md`, `docs/ux-reviews/GroupProviderSection.md`):

1. **`task-provider-null-silently-preselected` / `group-provider-null-silently-preselected`:** both sections resolved an unbound context (`taskInstanceId: null`) or a stale binding by falling back to `available[0]`, making "not yet configured" pixel-identical to "bound to the first instance" — an admin could read an unset context as already routed.
2. **`task-provider-raw-id-options` / `group-provider-raw-id-options`:** `task_instances` has no name column and `config` is a free-form decrypted blob, so an instance with no `baseUrl` reached the client as `name: undefined` and the option label fell back to the raw internal id (`inst_bare (youtrack · active)`).
3. **`task-provider-states-unverified`:** the bound-instance credential list, the Kaneo provision CTA, and the post-provision secret reveal had never been rendered by any Storybook fixture or screenshot.

The label/selection logic existed twice (once per section, byte-for-byte), and the option construction existed twice server-side (`context-task-instance-routes.ts`, `group-routes.ts`) — every fix would otherwise have to be applied twice and could drift.

## Decision Drivers

- **The server guarantees a human-readable label; the UI never renders a primary key.** `TaskInstanceOption.name` is required on the server type (unlike the client wire schema, where it stays optional — a strict schema would turn one unlabeled instance into a failed fetch blanking the whole section).
- **One label fallback rule, stated once, implemented twice:** `baseUrl` when present and non-empty, else `` `${typeLabel} instance (${id})` `` (`Kaneo`/`YouTrack`, raw `type` otherwise). Duplicated deliberately across server and client because MSW replaces the server in Storybook, so only the client copy runs in fixtures; both copies must produce identical strings.
- **An empty select makes the unset state visible in the control itself.** The silently-preselecting block collapsed into one shared resolver returning `selected: ''` plus a placeholder: `Not yet assigned — select an instance` (unbound) vs. `Assigned instance is unavailable — select another` (stale binding) — two strings, because telling the user "Not yet assigned" about a stale binding would state something false.
- **No shared-primitive changes.** `Select.svelte` already renders a disabled placeholder option when `placeholder` is non-empty; changing the primitive would churn baselines across all 18 settings sections. No new submit guard either — both sections already return early on empty selection and the placeholder option is disabled.
- **A fix without a fixture that exercises it is an unverified claim.** New MSW fixture families and stories render the bound/provisionable/reveal states (TaskProvider) and the unassigned/nameless-bound states (GroupProvider), turning source-only claims into pixel-verified ones. A `<select>` renders only its chosen option, so binding the nameless instance is the only way to screenshot the fallback label.
- **Ten pre-existing tests asserted the defect or silently depended on it** and had to change as part of the fix — each was individually enumerated in the plan; any failure outside that list meant stop and report.

## Considered Options

### Option 1 — Shared units that fix the defect while de-duplicating (chosen)

Three duplicated blocks each collapse into one shared unit that also fixes the defect: a server-side option builder (`src/debug/settings/task-instance-options.ts`, `listActiveTaskInstanceOptions()` + `taskInstanceLabel()`), a client-side label formatter (`client/settings/lib/task-instance-label.ts`, `formatTaskInstanceOption()`), and a client-side selection resolver (`client/settings/lib/task-instance-selection.ts`, `resolveTaskInstanceSelection()` + placeholder constants). Plus MSW fixtures/stories/screenshot cases for the never-rendered states.

- **Pros:** closes all 5 findings; one place to fix the rule next time; the wire field stays named `name` and the client schema stays lenient (defense at a trust boundary); no shared-primitive churn.
- **Cons:** the fallback rule exists in two runtimes that must be kept identical by convention (pinned by twin unit-test suites, not by a shared module).

### Option 2 — Fix each finding locally inside each section

- **Pros:** smallest diff; no new files.
- **Cons:** applies every fix twice, guaranteeing future drift between the pair; leaves the three never-rendered states unverified; repeats the duplication that caused the findings to diverge in the first place.

### Option 3 — Tighten the wire schema (`name` required) and drop the client fallback

- **Pros:** single source of truth; no "dead" client fallback.
- **Cons:** one unlabeled instance becomes a failed fetch that blanks the entire section; also breaks MSW fixtures that legitimately omit `name`. Rejected — the client fallback is deliberately-kept defense-in-depth, documented as such in the code.

## Decision

Option 1 shipped (verified against the tree):

1. **Server builder** — `src/debug/settings/task-instance-options.ts` exports `listActiveTaskInstanceOptions()` with required `name`, derived by `taskInstanceLabel(id, type, baseUrl)`; both routes (`context-task-instance-routes.ts:15,47`, `group-routes.ts:30,197`) import it, replacing their inline `name: config['baseUrl']` mappings that could yield `undefined`. Commit `56721f1ec`.
2. **Client label** — `client/settings/lib/task-instance-label.ts` (`formatTaskInstanceOption()`); both sections map options through it (`TaskProviderSection.svelte:133`, `GroupProviderSection.svelte:98`). The unreachable-in-production fallback is kept deliberately and now also produces the type-and-id label instead of the bare id. Commit `65d1672e3`.
3. **Selection resolver** — `client/settings/lib/task-instance-selection.ts` (`resolveTaskInstanceSelection()` + `UNASSIGNED_PLACEHOLDER`/`UNAVAILABLE_PLACEHOLDER`); both sections delegate (`TaskProviderSection.svelte:54-56`, `GroupProviderSection.svelte:43-45`) and pass `placeholder` to `Select`. Commit `7383904b1`.
4. **TaskProvider fixtures** — `settings-task-provider-bound` family (config + context/task-instance + provision/kaneo), the `Bound` story, and a manual `TaskProvider — provision reveal` screenshot case; the family lives in `settings-handlers-task-provider.ts` (split out because `settings-handlers.ts` was at its enforced `max-lines` budget — treated as a design signal, not gamed). Commit `b03995932`.
5. **GroupProvider fixtures** — `settings-group-provider-unassigned` and `settings-group-provider-nameless-bound` families plus `Unassigned`/`NamelessBound` stories and generated screenshot cases. Commit `19b96cf1d`.
6. **Findings closed** — both review docs flipped to `fixed` with hash-cited `Resolved:` lines and refreshed States-captured headers; backlog regenerated. Visual audit floor rose 462 → 466.

## Consequences

### Positive

- The unassigned state is visible in the control itself; an unset context can no longer be misread as routed to the first instance.
- Every option reaching the client carries a human-readable label by server construction; the raw internal id never reaches pixels.
- Three previously never-rendered TaskProvider states and two GroupProvider states now have fixtures, stories, and screenshot baselines.
- Both sections went to 0 open findings; each `fixed` claim carries a commit hash and a named PNG.
- The client fallback, though unreachable against the real server, is pinned by tests and documented as intentional — it cannot be deleted as "dead code" by a future cleanup.

### Negative

- The label fallback rule is implemented twice (server + client) and kept identical only by twin test suites and convention — a deliberate cost of MSW replacing the server in Storybook.
- Ten existing tests had to be updated because they asserted the defect or silently depended on the silent preselect; each such dependency was invisible to assertion-based search and had to be found by enumerating fixtures with `taskInstanceId: null` that then submit.
- Four re-baseline cycles (`bun shoot`) were required; the audit is meaningful only because every changed PNG was individually read — re-shooting makes the audit pass by construction.
- The `NamelessBound` fallback label is roughly double the usual option length; its long-label overflow behavior beyond the current fixture id remains a documented residual, not a tracked finding.

### Risks

- **Server/client label-rule drift:** mitigated by twin unit suites asserting identical strings; a rule change must touch both.
- **Placeholder-copy drift:** the two em-dash strings are exported constants with a test asserting they differ; a regression test pins that the bound state shows no placeholder.
- **Audit-count gates:** the 462 → 466 floor is load-bearing; a dropped story or manual case shows up as a count mismatch, not a diff failure.

## Related Decisions

- **ADR-0362 (ToolsSection UX Fixes)** — sibling open-findings closure under the same rules: fix root causes in shared units, no shared-primitive churn, fixture-proven fixes.
- **ADR-0359 (UX Findings Backlog)** — the stable-id findings format and `Resolved:`-hash contract this closure consumed.
- **ADR-0360 (Visual Gate Trustworthiness)** — the rule that a green audit alone proves nothing and every changed PNG must be read.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-04-provider-pair-open-findings.md`; spec: `docs/superpowers/specs/2026-08-04-provider-pair-open-findings-design.md`.
- Closing commits: `56721f1ec` (server labels), `65d1672e3` (client label), `7383904b1` (placeholder, no preselect), `b03995932` (TaskProvider bound fixtures), `19b96cf1d` (GroupProvider fixtures).
- Verification: 38 server-side settings tests, 1483 client tests (0 failures), visual audit floor 466, plus a fresh-context adversarial review pass — "tests pass" and "audit green" were explicitly not accepted as evidence on their own.
