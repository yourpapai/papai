<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Provider-pair open-findings fix — design

**Date:** 2026-08-04
**Status:** approved, not yet planned
**Predecessor:** [`2026-08-03-tools-section-open-findings-design.md`](./2026-08-03-tools-section-open-findings-design.md)

## Goal

Close all 5 open findings across `docs/ux-reviews/TaskProviderSection.md` (3 open) and
`docs/ux-reviews/GroupProviderSection.md` (2 open), taking **both sections to `0 open`**.
Backlog-wide open count falls **29 → 24**; the `Med` bucket falls **7 → 4**; sections at zero
open rise **4 → 6**.

| Finding | Section | Severity |
| --- | --- | --- |
| `task-provider-null-silently-preselected` | TaskProvider | Med |
| `task-provider-raw-id-options` | TaskProvider | Med |
| `group-provider-null-silently-preselected` | GroupProvider | Med |
| `group-provider-raw-id-options` | GroupProvider | Low |
| `task-provider-states-unverified` | TaskProvider | Low |

## Why this is one project and not two

`TaskProviderSection` and `GroupProviderSection` are near-clones — the personal-scoped and
group-scoped bindings of a task instance to a context, built from an identical
`Field` + `Select` + primary-button form. Four of the five findings are **two defects
duplicated across the pair**, and both review documents already cross-reference each other
("identical residue exists in the sibling"). Fixing one section alone would leave the other
holding a finding whose text points at code that no longer exists.

The duplication is literal. The silent-preselect expression is byte-identical apart from the
variable name:

```ts
// GroupProviderSection.svelte:40-44        TaskProviderSection.svelte:51-55
const currentId = result.taskInstanceId  // instance.taskInstanceId
selected =                               // selectedInstanceId =
  currentId !== null && result.available.some((a) => a.id === currentId)
    ? currentId
    : (result.available[0]?.id ?? '')
```

So is the option-label expression (`GroupProviderSection.svelte:97`,
`TaskProviderSection.svelte:132`) and the server-side option construction
(`src/debug/settings/context-task-instance-routes.ts:37-46`,
`src/debug/settings/group-routes.ts:196-203`).

## Layer A — Server: stop calling a base URL a name

### The defect

Both route handlers build the option object with a line-for-line identical literal and no
shared builder:

```ts
{ id: taskInstance.id, type: taskInstance.type, status: taskInstance.status, name: taskInstance.config['baseUrl'] }
```

`config` is `Record<string, string>` (`src/instances/types.ts:6`) decrypted from a free-form
JSON blob; `task_instances` has no `name` column (`src/db/instance-schema.ts:20-28`). So
`name` is `string | undefined` **by construction** — absent for any instance whose provider
config carries no `baseUrl`. The client is then left to paper over a server-side gap by
rendering the opaque primary key.

### The fix

Extract one shared builder, `src/debug/settings/task-instance-options.ts`, consumed by both
handlers. It filters to `status === 'active'`, excludes unreadable rows (both call sites
already go through `listTaskInstancesSafe()`), and **always** produces a display label:

- `config['baseUrl']` when present and non-empty;
- otherwise `` `${typeLabel} instance (${id})` `` — e.g. `YouTrack instance (inst_bare)`.

`typeLabel` comes from a small map covering the two types the codebase knows
(`src/instances/context-store.ts:19-25`): `kaneo → Kaneo`, `youtrack → YouTrack`, falling
back to the raw `type` string for anything else. An unknown type yields
`acme instance (inst_x)` — still a sentence, still unique, never a bare id.

The fallback is **stable for the life of the instance**: it derives only from `type` and `id`,
both immutable. A label derived from creation order (the review's original suggestion) would
renumber every instance whenever an earlier one is deleted.

### Naming: keep the wire field `name`

The field is called `name` but carries a base URL — a real semantic mismatch, and renaming it
to `label` was considered. **Decision: keep `name`.** Once the server guarantees a
human-readable value, `name` is accurate; renaming churns `TaskInstanceOptionSchema`, both
fetchers, both components, the MSW fixtures and the route tests for zero user-visible change.
The mismatch this finding is really about is *absence*, not the identifier.

### Extracting the duplicate is in scope

Removing the duplicated literal is required by the fix, not adjacent tidying: the fallback
rule must be identical in both responses, and two copies of it would drift. No other
refactoring of these route files is in scope.

## Layer B — Client: make the control honest

### Unassigned is not "the first option"

When a context has no task instance bound (`taskInstanceId === null`) but instances exist,
both sections fall through to `available[0]?.id` and render that option as chosen —
pixel-identical to a context genuinely bound to it. An admin sees what looks like a saved
assignment and skips configuring it, or re-saves a value they never chose. A misrouted task
provider silently sends work to the wrong tracker.

Fix: when `taskInstanceId` is `null` or not present in `available`, set the selection to `''`
and pass a `placeholder` to `Select`:

```svelte
placeholder="Not yet assigned — choose an instance"
```

`Select` already renders `<option value="" disabled>{placeholder}</option>`
(`client/shared/ui/Select.svelte:43-45`), so **no shared-primitive change is needed**. This
matters: a change to `Select` would churn visual baselines across all 18 sections and destroy
the affordability of per-batch baseline review. This was verified in source, not assumed.

**No new submit guard is required.** Both sections already return early on an empty
selection — `GroupProviderSection.svelte:55` and `TaskProviderSection.svelte:66`. The `Select`
`placeholder` option is `disabled`, so it also cannot be re-chosen once the user picks a real
value. This was checked before designing; do not add a redundant guard.

### One shared label helper

Both sections carry the identical expression
`` `${o.name ?? o.id} (${o.type} · ${o.status})` ``. Replace it with one helper,
`client/settings/lib/task-instance-label.ts`, mirroring the server's fallback rule so the two
never disagree.

### The schema stays `.optional()`

`TaskInstanceOptionSchema.name` is `z.string().optional()`
(`client/settings/fetcher-schemas.ts:204-209`). Tightening it to `z.string()` was considered
and **rejected**: the schema is enforced at fetch time, so a single instance the server failed
to label would fail validation and blank the entire section — turning a cosmetic naming bug
into a hard outage. Showing a raw id is strictly better than showing nothing.

The client fallback should therefore be **unreachable in practice but present**. This is
deliberate defense at a trust boundary, not dead code, and must not be "simplified away".

## Layer C — Fixtures

These sections are fixture-driven through **MSW**
(`client/stories/msw/settings-handlers.ts`, `settings-handlers-group.ts`, registered in
`client/stories/msw/scenarios.ts`), not the dependency-injection pattern the predecessor
project used for `ToolsSection`. Fixture families are named and selected per story via
`parameters={{ fixtures: '<family>' }}`.

### TaskProviderSection

`Populated` uses the shell-wide `settings-shell-ready` family, whose task-instance handler
already returns `taskInstanceId: null` with one `available` entry
(`settings-handlers.ts:238-245`). **That fixture is left alone.** After Layer B it stops
showing a false binding and starts showing the placeholder — the existing baseline becomes
the proof of the null fix, at no fixture cost.

Because `settings-shell-ready` also backs the composed `SettingsApp` stories, the
`SettingsApp-Personal-ready` baseline changes too. That is expected and correct; it must be
read, not waved through.

Add one story, **`Bound`**, on a new fixture family: a bound Kaneo instance with
`canProvision: true` and provider-context config fields. One story covers two of the three
states `task-provider-states-unverified` names — the `ConfigFieldRow` credential list
(`TaskProviderSection.svelte:145-150`) and the Kaneo provision CTA (`:156-164`) — because
`canProvision` is only ever true for a bound, active Kaneo instance, so the two states
co-occur in reality. Splitting them would fabricate a state the server cannot produce.

The third state, the post-provision secret reveal (`:168-180`), is reachable only by clicking
`provision-kaneo`, so it is a manual visual case on the `Bound` story with the provision
endpoint mocked. `Secret` renders a masked value, so no real credential is involved; the
fixture password must be an obvious dummy.

### GroupProviderSection

Its `Populated` fixture is genuinely bound (`taskInstanceId: 'inst_abc'`,
`settings-handlers-group.ts:81-88`), so unlike the sibling it needs its own null fixture.
Add two stories:

- **`Unassigned`** — `taskInstanceId: null` with a non-empty `available` list. This is the
  state the review says "has never been screenshotted".
- **`NamelessBound`** — bound to `inst_bare` (`{ id: 'inst_bare', type: 'youtrack', status:
  'active' }`, no `name`), which already exists in the populated fixture but has never been
  the *selected* option and so has never been rendered. A `<select>` displays only its chosen
  option, so binding the nameless instance is the only way to put the fallback label on
  screen. Expected: `YouTrack instance (inst_bare) (youtrack · active)`.

That second story is what makes both `*-raw-id-options` findings visually verifiable rather
than source-only claims. Note which layer it exercises: MSW replaces the server, so a fixture
option with no `name` drives the **client** helper's fallback, not the server builder's. The
server rule is covered by its own unit tests (below). Both must produce the same string, which
is why the rule is stated once in this spec and implemented twice against it.

## Verification

### Per-task loop

1. Apply the fix.
2. Run the covering tests: `tests/debug/settings/context-task-instance-routes.test.ts`,
   `tests/debug/settings/group-routes.test.ts`,
   `tests/client/settings/sections/TaskProviderSection.test.ts`,
   `tests/client/settings/sections/GroupProviderSection.test.ts`.
3. `bun shoot:gen` when stories were added, then
   `bun shoot -g TaskProviderSection` / `-g GroupProviderSection` / `-g SettingsApp` as the
   change requires.
4. **Read every changed PNG with the Read tool** and describe what actually changed against
   what the finding predicted.
5. `bun run visual:audit` — full run, not `-g`-filtered.
6. Commit.

Step 4 is load-bearing and not optional. Re-shooting makes the audit pass by construction, so
a green audit proves nothing about whether the UI improved. A task whose shots were not
individually read is not done.

Step 5 is a **full** audit deliberately. The predecessor project ran `-g ToolsSection` for
three consecutive tasks and missed seven failures in a section it had never filtered for; this
project touches a shell-wide fixture family, so the blast radius provably exceeds the two
sections under work.

### Adversarial verification

After the fix tasks, a **fresh agent** with no prior context re-derives every `fixed` claim
against current source and current screenshots. Whoever writes a fix does not certify it. In
the predecessor project this step refuted a claim that had already passed its own author's
review — and a nested reviewer commissioned by the implementer was found to be worthless,
so the verifier must be dispatched independently.

## Testing

### Server

New unit tests for the shared builder: a `baseUrl` instance yields the URL; an instance with
no `baseUrl` yields `Kaneo instance (<id>)` / `YouTrack instance (<id>)`; an unknown type
falls back to its raw type string; an empty-string `baseUrl` is treated as absent, not
rendered as an empty label. Both route tests assert the shared builder's output reaches their
respective responses, so the two endpoints cannot silently diverge again.

### Client

New unit tests for the label helper covering the `name`-present and `name`-absent paths.

Component tests, one pair per section:

- With `taskInstanceId: null` and a non-empty `available`, the `Select` value is `''` and the
  placeholder option is present — **not** `available[0].id`.
- With a bound `taskInstanceId`, the `Select` value is that id.

The first assertion is the entire guarantee of the two `Med` findings. A test that merely
asserts "a placeholder exists" without asserting the value is **not** `available[0].id` would
pass against the unfixed code.

**No existing test should need to change.** If one does, that is a signal the fix altered
behavior beyond the two findings — stop and report it rather than updating the assertion.

### Visual audit floor: 462 → 466

Three new stories (`Bound`, `Unassigned`, `NamelessBound`) enter the generated region, plus
one manual case (the provision reveal). The floor is the audit's *test count*;
`.storybook-shots/` is git-ignored, so changed baselines are identified by mtime and the shoot
log, not by `git status`.

## Closing the loop

A final task, after the adversarial pass:

1. Flip the 5 findings to `- **Status:** fixed`, each with a `- **Resolved:**` line citing its
   actual fix commit. The parser rejects a non-`open` status lacking one.
2. Re-score both scorecards. `TaskProviderSection` dimensions 4 and 5 and
   `GroupProviderSection` dimensions 4 and 5 are the ones this project can earn; a dimension
   whose rationale still describes a real residue keeps its `warn` and keeps a finding open.
3. Update both documents' **States captured** headers, which currently assert the very gaps
   this project closes.
4. `bun run ux:backlog` → both sections `0 open`, total **24 open**.
5. `bun test tests/scripts/ux-backlog.test.ts` (currency gate) after `bun run format`.

Statuses may only be flipped after the fix commits exist, because `Resolved:` must cite a real
hash.

## Risks

- **Shell-fixture blast radius.** `settings-shell-ready` backs the composed `SettingsApp`
  stories, so the personal-ready baseline changes. Expected — but it is exactly the shape of
  failure the predecessor project hit, and the full audit in step 5 is the mitigation.
- **The `Bound` story may reveal defects in never-rendered code.** Three states have never
  been screenshotted at any viewport; the field list, provision CTA and secret reveal may have
  spacing, overflow or contrast problems nobody has seen. Anything found is a **new `open`
  finding**, not something absorbed silently into this project's scope.
- **The `NamelessBound` label is long.** `YouTrack instance (inst_bare) (youtrack · active)`
  doubles the usual option length and may overflow the `Select` at the ~640px narrow width. If
  it does, that is a real finding — record it; do not shorten the fixture id to hide it.
- **Placeholder copy is a judgment call.** "Not yet assigned — choose an instance" states both
  the state and the next action. A reviewer should weigh it rather than assume it is fixed.

## Success criteria

- All 5 findings named in this spec reach `fixed`, each citing a real commit.
- Both sections' scorecards re-scored; both report `0 open`.
- Full audit: 466 passed, 0 failed.
- Every changed baseline read and described in human-readable terms.
- Adversarial pass finds no unsupported `fixed` claim.

The expected end state is `TaskProviderSection 0 open / 6 fixed`,
`GroupProviderSection 0 open / 7 fixed`, and a backlog total of 24 open.

**This target is not a hard criterion, and must not be defended by suppressing findings.**
Two paths legitimately lead elsewhere:

- A fix leaves a genuine residue. That dimension keeps its `warn` and the finding stays `open`
  with its text narrowed to the residue — the corpus's no-`partial` rule.
- A baseline read exposes a defect this spec did not anticipate — most plausibly in the
  never-rendered `Bound` states. It is recorded as a new `open` finding.

In either case the counts land above zero and the project is still successful. A `0 open`
result obtained by declaring a residual defect fixed is a failure, however green the audit is.
Report the actual numbers.
