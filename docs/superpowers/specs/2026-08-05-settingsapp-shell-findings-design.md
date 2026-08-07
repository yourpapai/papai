<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# SettingsApp shell — findings close-out design

**Date:** 2026-08-05
**Source review:** [`docs/ux-reviews/SettingsApp.md`](../../ux-reviews/SettingsApp.md) — 14 open findings (2 High, 6 Med, 6 Low)
**Goal:** Close all 14 findings against the settings shell, leaving `_BACKLOG.md` with no open SettingsApp entries.

## Context

`client/settings/SettingsApp.svelte` is the frame every settings visit passes through. It owns
the three session gates, both navigation surfaces, the group/collapse model, and the scrollspy.
The 14 findings cluster into four groups — session state, layout/scroll, navigation model, and
design-system consistency — and two structural moves resolve most of them at once.

## Corrections to the review

Three things surfaced during design that change what the findings say. The review document is
updated as part of this work, not silently contradicted.

### The loading gate never renders in production

`settings-app-loading-gate-unannounced` describes a small unannounced "Loading…" on a black
field. That screenshot is a Storybook-only state. `client/settings/index.ts:26-32` awaits
`bootstrapSession(code)` **before** `mount(SettingsApp, { target })`, so the component's
`loading` branch is unreachable in the real app: the component does not exist yet while
bootstrap runs. What a user actually sees is `client/settings/settings.html`'s empty
`<div id="app"></div>` — a fully blank page with no text at all.

The severity stands and the finding is not withdrawn; its **text is corrected** to name the real
mechanism, and its fix changes accordingly: mount before bootstrapping, which makes the
`loading` branch real and gives the new `failed` state somewhere to render. It then closes as
`fixed` like the rest.

### The focus-ring tokens already exist

`settings-app-focus-ring-scoped-to-grid` proposes drawing the ring colour from a token.
`client/shared/tokens.css:39-40` already defines:

```css
--focus-ring: 2px solid rgba(82, 224, 138, 0.4);
--focus-ring-offset: 1px;
```

`client/settings/settings.css:132` and `client/shared/ui/Select.svelte:66-67` each hardcode that
exact literal instead of using it. No new token is introduced; both call sites adopt the
existing one. The scoping half of the finding is unchanged.

### There is no type scale, so the spacing finding narrows

`settings-app-hardcoded-px-in-shell-chrome` covers both spacing and font sizes. Spacing has
tokens (`--s1`…`--s9`, `--gap-*`). Font size does not: the codebase carries **218 hardcoded
`font-size` values across 85 files**, with no scale to move to. Introducing one is a
cross-cutting project touching every section, not a shell fix.

This finding is therefore **narrowed to spacing** and closed on that basis, and a new
`deferred` finding is filed for the missing type scale so the gap stays visible in
`_BACKLOG.md`'s Deferred section rather than disappearing.

## Global constraints

- Runtime **Bun**; **Svelte 5 runes**; strict TypeScript; **`.js` extension in import paths**.
- Formatter is **oxfmt** (`bun run format`), not prettier.
- **Never add lint-disable or type-ignore comments.** A `max-lines` failure is a design signal —
  split the file.
- **Never log the settings auth code**, the CSRF token, or session cookies.
- `docs/ux-reviews/_BACKLOG.md` is generated — never hand-edit; regenerate with `bun run ux:backlog`.
- Findings use the review conventions: `**Id:**` and `**Status:**` are the first two bullets; a
  non-`open` status requires a `- **Resolved:**` line; there is no `partial`.
- Shared primitives (`Shell`, `Select`) are consumed by DebugApp and every section. **All changes
  to them must be backward-compatible with existing call sites**, verified by test.
- Client tests need the browser condition and the client preload:
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`.
  `bun run test:client` (`package.json:49`) already hardcodes `tests/client/`, so a path argument
  appended to it narrows rather than replaces; a bare `bun test tests/client/...` matches nothing
  and reports success **without executing**.
- `bun shoot` rewrites every baseline — always scope it: `bun shoot -g <Section>`. Regenerate the
  spec's `@generated` region with `bun run shoot:gen` after adding stories.

## Architecture

Two structural moves carry most of the work; everything else attaches to them.

### Move 1 — extract the nav model

Today `SettingsApp.svelte` holds four hardcoded singletons for a single collapsible group:
`ADVANCED_IDS` (`:56`), `advancedCollapsed` (`:102`), `observableSectionIds` (`:152`), and the
hashchange auto-expand keyed to `ADVANCED_IDS.includes(id)` (`:173`). Adding a second
collapsible group by copy-paste duplicates all four.

New module `client/settings/nav.svelte.ts` owns the model:

```ts
export interface NavItem {
  id: string
  label: string
}
export interface NavGroup {
  key: 'personal' | 'advanced' | 'admin'
  kicker: string
  collapsible: boolean
  danger: boolean
  items: NavItem[]
}
```

It exports:

- `buildNavGroups(session, isGroup): NavGroup[]` — pure; the current `:106` derivation plus the
  `collapsible` flag on Admin.
- a `$state` collapse map keyed by `NavGroup['key']`, with `isGroupCollapsed(key)` and
  `toggleGroup(key)`.
- `expandGroupOwning(id, groups): void` — replaces the `ADVANCED_IDS.includes()` check, so a deep
  link or jump-menu pick expands whichever group owns the target.
- `mountedSectionIds(groups): string[]` — ids of groups that are not collapsed; replaces
  `observableSectionIds`.
- `groupHint(items): string` — derives the toggle's summary from the group's own items instead of
  a hand-written list.

The module is pure functions plus one reactive map: testable without a DOM.

Default collapse state: `advanced` collapsed, `admin` collapsed, unless the initial hash targets
a section inside one of them.

### Move 2 — move the scroll boundary into the settings grid

`client/shared/ui/Shell.svelte:35` makes `.ui-shell__body` the scroll container
(`overflow-y: auto`, `padding: 16px`). The sidebar is `position: sticky; top: 0;
max-height: 100vh; overflow-y: auto` (`SettingsSidebar.svelte:71`). The scrollport is
`100vh` minus the 48px top bar and 32px of body padding, so the sidebar's box overshoots it by
~80px. Because the element is sticky, the outer scroll never recovers that strip: the tail of a
16-item admin nav can be scrolled to inside the sidebar but is never painted.

There is no CSS unit for "my scrollport's height", so the fix is structural:

```
now                          proposed
┌─ topbar ─────────┐         ┌─ topbar ─────────┐
├─ body  ░scroll░  ┤         ├─ body (no scroll)┤
│ ┌────┐ ┌───────┐ │         │ ┌────┐ ┌───────┐ │
│ │nav │ │ main  │ │         │ │nav │ │ main  │ │
│ │stky│ │       │ │         │ │░sc░│ │░scrl░│ │
│ │    │ └───────┘ │         │ │░rl░│ │░     │ │
└─┼────┼───────────┘         └─┴────┴─┴───────┴─┘
  │    │ ← ~80px clipped,
  └────┘   never painted
```

`Shell` gains a `bodyScroll?: boolean` prop defaulting to `true`, so **DebugApp is unaffected**.
Settings passes `false`; `.ui-shell__body` then sets `overflow: hidden` and the settings layout
becomes a full-height flex column:

- the jump menu (visible below 900px) as a fixed first row;
- `.settings-grid` as `flex: 1; min-height: 0`, with the sidebar `height: 100%; overflow-y: auto`
  and `.settings-grid__main` `overflow-y: auto`.

The sidebar loses `position`, `top`, and `max-height` entirely — the overshoot is gone by
construction rather than by arithmetic. The body's `padding: 16px` moves inward so each
scrollbar sits at its own column edge.

`client/settings/scrollspy.ts` gains a `root: Element | null` parameter passed to the
`IntersectionObserver`, so its `-30% 0px -60% 0px` band measures against the real scroller
rather than the viewport. `.settings-section`'s `scroll-margin-top: 96px`
(`settings.css:33`) is reduced to `var(--gap-inline)` — with the main column as the scroller and
nothing sticky inside it, the 96px offset no longer compensates for anything.

Native fragment navigation (`window.location.hash = '#id'`) scrolls the nearest scrollable
ancestor and continues to work.

## Components

### Session gates — `client/settings/session.svelte.ts`, `index.ts`, new `SettingsGate.svelte`

`bootstrapSession` currently swallows every failure into one status (`session.svelte.ts:45-47`),
so a network blip is reported to the user as an expired link, on a screen with no action.

The server makes the distinction unambiguous: `src/debug/settings-routes.ts:102` returns **401**
for an invalid or expired code, `:125` returns **401** for an unauthenticated bootstrap, and
`:83` returns **429** when rate-limited. `FetchError` (`client/shared/fetcher-helpers.ts:29`)
already carries `status`.

```ts
type Status = 'loading' | 'ready' | 'unauthenticated' | 'failed'
```

- `FetchError` with `status === 401` → `unauthenticated`, keeping today's "send `/config` for a
  new link" copy and no retry, because retry cannot help.
- Anything else — network error, 5xx, 429, schema parse failure → `failed`, carrying the error
  message, with a **Try again** action. A 429 correctly lands here: `Retry-After` means it will
  eventually work.
- `registerExpiryHandler`'s 401 handler continues to set `unauthenticated`.

`retryBootstrap()` re-runs the same path. The auth code is retained in module scope for this,
because `index.ts:30` strips it from the URL after the first attempt and a transport failure does
not consume it server-side. **The retained code is never logged.**

`index.ts` mounts before bootstrapping:

```ts
export async function start(target: Element): Promise<void> {
  registerExpiryHandler()
  mount(SettingsApp, { target })
  const code = readCodeFromLocation(window.location.search)
  await bootstrapSession(code)
  if (code !== null) stripCodeFromUrl()
}
```

This makes the `loading` branch real. A new `client/settings/components/SettingsGate.svelte`
renders all three non-`ready` states, each with the brand chrome so no state is an unbranded
blank page, and `role="status"` on the loading state so the wait is announced.

### Navigation — sidebar, jump menu, group toggle

**Breakpoint → 900px.** The 720px cutover (`settings.css:137`, `SettingsSidebar.svelte:130`)
leaves a squeeze band: at 760px the sidebar takes its full fixed 220px track while the
single-column affordances are already off, giving the main column ~492px — *less than the 640px
"narrow" viewport gives it*.

| viewport | sidebar | main column |         |
| -------- | ------- | ----------- | ------- |
| 640px    | hidden  | 608px       | ok      |
| 720px    | hidden  | 688px       | ok      |
| 760px    | 220px   | 492px       | squeeze |
| 860px    | 220px   | 592px       | squeeze |
| 900px    | 220px   | 632px       | ok      |
| 1280px   | 220px   | 1012px      | ok      |

A container query was considered and rejected: the settings shell is always full-viewport-width,
so it would compute the same cutover with more machinery.

**Admin becomes collapsible, default collapsed.** It is currently the longest group (16 items)
and the only one that cannot collapse, and its 16 sections mount eagerly (`SettingsApp.svelte:263`)
unlike Advanced, which unmounts while collapsed — so every admin's page load fires all 16
sections' fetches. Marking it `collapsible` in the nav model gates both the nav list and the
section mounts through the same mechanism.

**Shared inline toggle.** `.settings-advanced__toggle` (`SettingsApp.svelte:292`) is a
full-width button whose only styling is a `border-bottom` and which has no `:hover` rule
anywhere — it reads as a divider. A new
`client/settings/components/SettingsGroupToggle.svelte` gives Advanced and the Admin zone the
same disclosure with a resting affordance and distinct hover/active states, and takes its summary
text from `groupHint(items)`.

**Jump menu** consumes the shared `Select` (below), honours group collapse via the same nav
model, and adopts the 900px breakpoint.

**Scrollspy stops writing the URL.** `SettingsApp.svelte:194` calls `history.replaceState` on
every section crossing, rewriting the entry a sidebar click pushed — so Back lands on a hash the
user never chose. The spy's callback now sets `activeId` only; the hash changes on explicit
navigation (sidebar link, jump menu) and nothing else.

### Shared primitives — `Select`, focus ring

`client/shared/ui/Select.svelte` takes a flat `Option[]`, is `display: inline-flex` at
`font-size: 12px`, and hardcodes the focus ring. Using it verbatim for the jump menu would flatten
the group structure and shrink the sole small-screen navigation control to a 12px inline pill.

It gains, both **opt-in and backward-compatible**:

```svelte
<!-- existing callers unchanged -->
<Select {value} options={flat} />

<!-- new -->
<Select {value} groups={[{ label: 'Personal', options: [...] }, ...]} block />
```

- `groups?: { label: string; options: Option[] }[]` rendering `<optgroup>`. `options` and `groups`
  are mutually exclusive; when `groups` is absent behaviour is byte-identical to today.
- `block?: boolean` — full-width with `height: var(--row-h)`, preserving the jump menu's current
  44px target size.
- `:focus-within` switches from the hardcoded literal to `outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset)`.

**Focus ring scope.** `settings.css:132` scopes the ring to `.settings-grid`, but
`SettingsApp.svelte:211` (top bar) and `:215` (jump menu) render outside it, as do all three
gates — so the context switcher, sign-out, the small-screen navigation, and every gate fall back
to the UA default. The rule re-scopes to the settings root and adopts the existing tokens.

### Copy

Two nav labels appear twice with nothing but the group kicker to tell them apart. Each admin
duplicate is renamed to what it actually does, **nav label and `PageHeader` title together**, so
the nav and its destination agree:

| id               | nav label       | section title              | what it is                                |
| ---------------- | --------------- | -------------------------- | ----------------------------------------- |
| `analytics`      | Analytics       | Personal · Analytics       | unchanged                                 |
| `analytics-admin`| Analytics policy| Admin · Analytics policy   | collection mode, kill switch, egress      |
| `byok`           | BYOK LLM        | Personal · BYOK LLM        | unchanged                                 |
| `byok-admin`     | BYOK keys       | Admin · System · BYOK keys | read-only table of every context's status  |

The Advanced hint (`SettingsApp.svelte:244`) — "Memory, AI output, identity, BYOK, integrations",
five names for ten sections, lowercasing `identity` against its own title and inventing the word
"integrations" — is replaced by `groupHint(items)`, derived from the group's real items.

### Spacing tokens

The shell chrome uses one-off px (`SettingsSidebar.svelte:64` — gap 20, padding 16/12, link
padding 6/8, nav gap 2; `SettingsApp.svelte:292` — gap 8, padding 10/4) while the main column it
frames uses `--gap-section` / `--gap-group`. Spacing values move onto `--s1`…`--s9` /
`--gap-*`. **Font sizes are out of scope** — see Corrections above.

## Testing

| What                                                | Where                                                    |
| --------------------------------------------------- | -------------------------------------------------------- |
| Status mapping: 401 → `unauthenticated`; 500 / network / 429 / parse error → `failed`; success → `ready` | `tests/client/settings/session.test.ts`      |
| `retryBootstrap` re-runs exchange with the retained code and can reach `ready` | same                          |
| `buildNavGroups` for personal / group / admin / super-admin shapes | `tests/client/settings/nav.test.ts`       |
| Collapse defaults, `toggleGroup`, `expandGroupOwning`, `mountedSectionIds`, `groupHint` | same                  |
| `Select` renders `<optgroup>` for `groups`; flat `options` callers unchanged | `tests/client/shared/select.test.ts`  |
| Fixture modes `unauthenticated` and `failed`         | `client/stories/decorators/withFixtures.ts` + stories      |

Visual states, added to `tests/visual/settings/SettingsApp.spec.ts` and shot with
`bun shoot -g SettingsApp`:

- **Unauthenticated** and **Failed** gates — currently uncapturable; this closes
  `settings-app-unauthenticated-state-uncaptured`.
- **Loading** — now a real production state.
- **Admin sidebar at 1280×600** — proves the nav tail is reachable.
- **760px** — proves the squeeze band is gone.
- **Admin collapsed / expanded** — the new default and the disclosure.

The existing `personal-narrow`, `breakpoint-edge`, `advanced-expanded`, `sidebar-link-hover`, and
`admin-zone-narrow` states are re-shot; the breakpoint-edge state moves to the new 900px cutover.

Mutation testing runs as a blocking per-file ratchet on changed files
(`bun test:mutate:changed`). New modules (`nav.svelte.ts`, `SettingsGate.svelte`) carry no
baseline floor yet but are measured; assertions must be real, not existence checks. Verify a
touched file with `bun test:mutate:file <path>` before pushing.

## File structure

**Create**

- `client/settings/nav.svelte.ts` — nav model, collapse state, hint derivation
- `client/settings/components/SettingsGate.svelte` — loading / unauthenticated / failed
- `client/settings/components/SettingsGroupToggle.svelte` — shared inline disclosure
- `tests/client/settings/nav.test.ts`
- `tests/client/shared/select.test.ts`

**Modify**

- `client/settings/SettingsApp.svelte` — consume the nav model and gate component; drop the four
  singletons and the inline toggle markup; gate admin section mounts
- `client/settings/session.svelte.ts` — `failed` status, 401 branch, `failureMessage`, `retryBootstrap`
- `client/settings/index.ts` — mount before bootstrap
- `client/settings/scrollspy.ts` — `root` parameter
- `client/settings/settings.css` — contained-height grid, 900px breakpoint, focus-ring token and
  scope, `scroll-margin-top`
- `client/settings/components/SettingsSidebar.svelte` — drop sticky/max-height, spacing tokens, 900px
- `client/settings/components/SettingsJumpMenu.svelte` — shared `Select`, honour collapse, 900px
- `client/settings/components/SettingsTopBar.svelte` — spacing tokens
- `client/shared/ui/Shell.svelte` — `bodyScroll` prop
- `client/shared/ui/Select.svelte` — `groups`, `block`, focus-ring token
- `client/settings/sections/admin/AdminAnalyticsSection.svelte:221` — title → "Analytics policy"
- `client/settings/sections/admin/AdminByokSection.svelte:74` — title → "BYOK keys"
- `client/stories/decorators/withFixtures.ts` — `unauthenticated` / `failed` session modes
- `client/settings/SettingsApp.stories.svelte`, `tests/visual/settings/SettingsApp.spec.ts`
- `tests/client/settings/session.test.ts`
- `docs/ux-reviews/SettingsApp.md` — statuses, corrections, the new deferred finding
- `docs/ux-reviews/_BACKLOG.md` — regenerated via `bun run ux:backlog`

## Finding disposition

All 14 close as `fixed`, each with a `- **Resolved:**` line naming this sub-project. Two carry a
text correction first (see Corrections above): `settings-app-loading-gate-unannounced` is rewritten
to name the real mechanism, and `settings-app-hardcoded-px-in-shell-chrome` is narrowed to spacing.
Both then close as `fixed`, because this work addresses their corrected text in full — the type-scale
residue leaves as a separate finding with its own id rather than as an `open` remainder.

| Id                                            | Sev  | Closed by                                              |
| --------------------------------------------- | ---- | ------------------------------------------------------ |
| `settings-app-sidebar-tail-unreachable`       | High | Move 2 — scroll boundary                               |
| `settings-app-unauthenticated-dead-end`       | High | `failed` status + retry                                |
| `settings-app-loading-gate-unannounced`       | Med  | Mount-before-bootstrap + `role="status"` + brand chrome |
| `settings-app-focus-ring-scoped-to-grid`      | Med  | Re-scope to settings root + existing `--focus-ring`    |
| `settings-app-jump-menu-bare-select`          | Med  | `Select` gains `groups` + `block`                      |
| `settings-app-advanced-toggle-reads-as-divider`| Med | `SettingsGroupToggle`                                  |
| `settings-app-admin-nav-not-collapsible`      | Med  | Move 1 — Admin collapsible, default collapsed          |
| `settings-app-breakpoint-keys-off-viewport`   | Med  | 900px cutover                                          |
| `settings-app-advanced-hint-undercounts`      | Low  | `groupHint(items)`                                     |
| `settings-app-duplicate-nav-labels`           | Low  | Renamed admin label + title                            |
| `settings-app-scrollspy-rewrites-history-entry`| Low | Spy drives the active marker only                      |
| `settings-app-hardcoded-px-in-shell-chrome`   | Low  | Spacing tokens (narrowed — font size out of scope)     |
| `settings-app-unauthenticated-state-uncaptured`| Low | Fixture modes + gate stories                           |
| `settings-app-jump-menu-ignores-collapse`     | Low  | Nav model + `Select` groups                            |

**New finding filed, not fixed here:** the design system has no type scale (218 hardcoded
`font-size` values across 85 files). Recorded in `SettingsApp.md` with status `deferred` and a
`- **Resolved:**` line naming the blocker, so it surfaces in `_BACKLOG.md`'s Deferred section.

## Out of scope

- `plugins-inactive-copy-overclaims-approval` — server-side eligibility reasons in
  `src/plugins/registry-context-eligibility.ts`; a different subsystem, its own cycle.
- Sub-grouping the 16 admin sections into labelled clusters — needs a nested group model in both
  the sidebar and the jump menu; the collapse fix addresses the finding as written.
- An app-wide type scale — see the deferred finding above.
