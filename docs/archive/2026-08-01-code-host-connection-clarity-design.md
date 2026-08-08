<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Code host connection clarity (sub-project D)

**Date:** 2026-08-01
**Status:** Design approved, pending spec review
**Source review:** [`docs/ux-reviews/CodeHostSection.md`](../../ux-reviews/CodeHostSection.md)
**Predecessors:** sub-project C (control target size), A (namespace-aware story fixtures),
B (settings field error channel) — all complete on branch `ui-ux-review-01`

## Problem

`CodeHostSection` renders a bare stack of field cards. It never answers the section's own
headline question — is a code host connected, and to which one — and it gives a first-time
user no idea what the access token is for or what it must be able to do. The conditionally
revealed Instance URL carries no required marker despite the route rejecting it blank, and a
stored instance URL survives a switch to a SaaS kind, leaving stored state diverged from the
visible form.

Sub-project B's spec deferred exactly this set (`2026-07-31-settings-field-error-channel-design.md:271-274`)
and built the inline-error channel that D uses to mark and explain `instance_url`.

## Scope

**In:** the findings that live inside `CodeHostSection.svelte` and its fixtures — H2
(connection status), H3 (first-setup guidance), H4 (conditional-required Instance URL), the
stale stored instance URL, the empty-fields guard, and the two Lows local to this file
(destructive Clear's variant, the actions row's gap and alignment). One server-side edit to
field **labels** in `coding-credentials-fields-meta.ts`; no server behavior change.

**Out:** the three findings that live in shared primitives and would touch every settings
section and both admin SPAs — a `disabled`/busy prop on `Input` (inputs stay editable during
save), a text alternative for `SettingsFieldShell`'s required `*` plus `aria-required` on the
control, and promoting `PageHeader`'s title to a real heading element. These carry their own
cross-SPA visual sweep, like sub-project C did, and belong in a separate sub-project.

## Design

### 1. Header connection status (H2)

`getCodingCredentialState` (`src/coding-credentials/store.ts:57-73`) already computes
`configured` / `complete` / `missing` / `unreadable` for the forge namespace, and
`fetcher-schemas.ts:47-48` already parses them. The section reads only `configured`, at
`:246`, to gate the Clear button. This is therefore pure rendering — no server work.

A `StatusPill` goes in `PageHeader`'s `action` snippet beside Refresh, and the header's
existing unused `sub` prop (`PageHeader.svelte:16`) names the specific host.

Both derive from `currentData`, **never from `drafts`** — the header reports saved state, so
it does not flicker as the user edits a form they have not submitted.

| Condition                                            | Pill            | Sub                                          |
| ---------------------------------------------------- | --------------- | -------------------------------------------- |
| `currentData === null`                               | none            | none                                         |
| `unreadable`                                         | `error`         | none — the existing unreadable banner explains it |
| `!configured`                                        | `not connected` | none                                         |
| `configured && !complete`, `missing` contains `kind` | `pending`       | none — there is no host to name              |
| `configured && !complete`                            | `pending`       | `GitHub · needs an access token`             |
| `complete`                                           | `connected`     | `GitLab · gitlab.internal.example.com`       |

No change to `status-tone.ts`: `connected` maps to `accent`, `pending` to `warn`, `error` to
`danger`, and `not connected` falls through to `neutral`, which renders without a dot — the
right weight for "nothing configured yet".

Two client-side helpers, both mirrors of server truth. Each carries a comment naming its
source, matching the existing `needsInstanceUrl` mirror at `CodeHostSection.svelte:23-26`:

- **display name** — `github` → `GitHub`, `github-enterprise` → `GitHub Enterprise`,
  `gitlab` → `GitLab`, `gitlab-self-hosted` → `GitLab (self-hosted)`.
- **host** — for SaaS kinds, the fixed host (`github.com`, `gitlab.com`); for self-hosted
  kinds, `new URL(instance_url).host` inside a `try`/`catch`, falling back to the raw stored
  string so a malformed stored value degrades to something readable rather than throwing.

### 2. First-setup guidance (H3)

Rendered under the same `{#if !currentData.complete}` guard the sibling uses
(`CodingCredentialsSection.svelte:290`):

> Coding sessions push branches and open pull requests as you. Create a personal access token
> that can read and write repository contents and pull requests, then paste it below — it is
> encrypted and never shown again.

The copy is **capability-phrased and names no provider scope strings**. This is deliberate:
nothing in the repo documents what scopes the forge token needs.
`docs/architecture/coding-sessions.md:60` says only that it is a GitHub/GitLab PAT used by
`finish_session` and `review_pr`. Naming `repo` or `api` would assert values with no source of
truth in the codebase and no test keeping them honest, and they would rot as GitHub's
fine-grained tokens evolve. Capability phrasing is accurate against what the code actually
does with the token.

The `forge_token` placeholder becomes `token with repo read/write access`, replacing the
generic `enter a new value` (`CodeHostSection.svelte:231`). Other sensitive fields keep the
generic placeholder.

Copy lives client-side, in the component. `FieldMeta`
(`coding-credentials-fields-meta.ts:8-15`) has no hint or description key, and the sibling
keeps every hint and placeholder in the component (`CodingCredentialsSection.svelte:299-340`).
D follows that precedent rather than extending the server type.

### 3. Instance URL (H4)

- **Required marker:** `effectiveRequired = field.required || (field.key === 'instance_url' && showInstanceUrl)`,
  mirroring the sibling's `:299`. The server keeps `required: false` for this field
  (`coding-credentials-fields-meta.ts:72`) because it is conditionally required; the client
  resolves the condition it already computes for visibility.
- **Placeholder:** `https://gitlab.example.com`.
- **Hint:** _Needed because you chose a self-hosted code host. Your operator must also allow
  this host for coding sessions._

The second sentence exists because self-hosted instance hosts must be operator-allowlisted in
magi's `MAGI_ALLOWED_REPO_HOSTS`, which is fail-closed
(`docs/architecture/coding-sessions.md:60`). Without it a user can enter a valid `https://`
URL, save successfully, and only discover the problem as an opaque session failure later —
with nothing on this screen hinting at the cause.

Because `showInstanceUrl` already drives visibility, the marker and hint appear and disappear
with the field. No new state.

### 4. Stale stored instance URL

`collectValues()` gains a submit-time invariant: when `!needsInstanceUrl(currentKind)`, send
`instance_url: ''`. Parallel to the sibling's block at `CodingCredentialsSection.svelte:177-186`
and commented the same way.

Implementation note: the loop currently `continue`s on hidden fields (`:125`), so this is an
explicit assignment **after** the loop, not a change to the skip condition.

**Honest severity.** The source review implies a stale URL misroutes a SaaS connection. It
does not: `deriveApiBaseUrl` (`src/coding-credentials/types.ts:73-79`) returns the fixed host
for `github` and `gitlab` and never reads `instance_url` for them, so a leftover value is
inert for request routing. The real cost is that stored state diverges from the visible form,
and the value silently reappears prefilled if the user switches back. That is worth fixing,
but it is a data-hygiene fix, not a correctness one.

The accepted trade-off: switching back to a self-hosted kind after a SaaS save means retyping
the URL.

### 5. Empty-fields guard

Wrap the `{#each}` in `{#if fields.length === 0}` → `No code host fields available — try Refresh.`
`{:else}` …, matching `CodingCredentialsSection.svelte:283-285`.

### 6. Two Lows local to this file

- **Clear:** `variant="ghost"` → `variant="danger"` (`CodeHostSection.svelte:248`) so the
  trigger's weight matches the danger dialog it opens (`:274`).
- **Actions row:** `.settings-field__actions` (`:291-294`) gains `gap: var(--gap-tight)` — the
  space between Clear and Save is currently collapsed markup whitespace — and a
  `padding-inline` that lands its right edge on the field cards' content edge.

  **Unresolved from source.** The review measured the inputs ending at x=1256 and Save at
  x=1280, a 24px difference. The card's `padding: var(--gap-inline)` (12px) plus its 1px
  border accounts for only 13px of that. The remaining 11px cannot be explained from source
  alone. The implementation must therefore **derive the padding value from a screenshot
  measurement**, not from this arithmetic, and confirm the alignment visually before
  committing.

### 7. Label copy

- `instance_url`: `Instance URL (enterprise / self-hosted)` → `Instance URL`. The qualifier
  moves into the hint from section 3.
- `kind`: `Code host` → `Host type`. The current label duplicates the section title verbatim.
  The review suggested "Provider", which is rejected here because it collides with the sibling
  section's "Model provider" field.

Each label string is duplicated across four files. A rename must touch all of them, and the
plan names them individually:

| File                                                        | Site                          |
| ----------------------------------------------------------- | ----------------------------- |
| `src/debug/settings/coding-credentials-fields-meta.ts`      | `:66` (kind), `:74` (url)     |
| `client/stories/msw/settings-handlers-coding.ts`            | `forgeFields`, `:126`, `:134` |
| `tests/client/stories/msw/settings-handlers-coding.test.ts` | `:77`                         |
| `tests/client/settings/code-host-section.test.ts`           | `:78`, `:113`, `:149`         |

`tests/debug/settings/coding-credentials-fields-meta.test.ts` asserts only the `mcp` servers
label (`:31`) and needs no change — verified, not assumed.

## Testing

### Unit — `tests/client/settings/code-host-section.test.ts`

One test per resolution, not per feature:

- pill and sub across all six header states in the section-1 table, including the two that
  render **no** sub (`missing` contains `kind`; `unreadable`) — the cases a naive
  implementation gets wrong;
- the first-setup paragraph renders when `!complete` and is absent when `complete`;
- `instance_url` carries the required marker and the hint only while a self-hosted kind is
  selected, and loses both when the kind switches back. Driven **through the select**, not by
  remounting with different props, so it pins the reactive path rather than the initial render;
- `collectValues` sends `instance_url: ''` when the kind does not need it and the real value
  when it does. Asserted against the **PATCH body via the mock fetch**, not against DOM state —
  this is the data-correctness case;
- the empty-fields guard renders when `fields` is `[]`.

### Fixtures and stories

Two new forge records in `client/stories/msw/settings-handlers-coding.ts`, each with the
namespace-guarded GET that sub-project A established:

- `forgeIncomplete` — `configured: true, complete: false, missing: ['forge_token']`
- `forgeSelfHosted` — `kind: 'gitlab-self-hosted'` with an `instance_url`

Both registered in `client/stories/msw/scenarios.ts` and given a `Story` in
`CodeHostSection.stories.svelte`.

The `unreadable` pill state gets unit coverage only. No fixture exists for it, and adding one
to shoot a single pill is not worth a new baseline.

### Visual

Regenerate the `@generated` region for the two new stories
(`bunx crvy-strybk generate --config ./strybk.config.ts && bun run format`), then add two
interaction states below `@generated-end`:

- the self-hosted reveal, showing the required marker and hint together;
- the incomplete state, showing pill and first-setup paragraph in one frame.

The file's existing `beforeEach` viewport pin (`CodeHostSection.spec.ts:13-15`) already
neutralizes `sharedPage` viewport bleed for this spec.

### Two hazards carried as explicit plan steps

**`bun shoot` is `playwright test --update-snapshots`.** It overwrites baselines, and
`.storybook-shots/**` is gitignored, so an unintended overwrite has **no recovery path**.
Every shoot step is preceded by a `cp -r` of the baseline directory and followed by reading
the resulting PNGs. Plain `bunx playwright test` is the only way to *detect* a pixel change.
Do **not** run `bun run shoot:gen` — it invokes `license:headers`.

**Expected baseline movement.** The `danger` variant on Clear and the actions-row padding are
the only pixel changes to already-baselined states, and both are scoped to this component. The
plan names which baselines are expected to move — `Populated`, `Empty`, `Save validation
error`, and every manual state containing the actions row — so an *unexpected* baseline change
is a signal rather than noise.

Sibling sections get a plain `bunx playwright test -g CodingCredentialsSection --workers=1`
(and the same for `CodingMcpSection`) with **no** `--update-snapshots`, confirming nothing
leaked out of this component.

### Gate

`bun run check:full`.

## Alternatives considered

**Concrete per-kind token scopes in the helper copy.** Most actionable for a user on a
token-creation screen, but the values exist nowhere in this repo — see section 2.

**Server-side normalization of `instance_url`.** Have the route drop the field when
`needsInstanceUrl(kind)` is false, so the invariant holds for any client rather than just this
form. Rejected as out of the CodeHost-local scope set for D; the client invariant covers the
only client that exists.

**Sub line only, or pill only, for connection status.** A pill alone answers "is it working"
but not "which host"; a prose line alone diverges from `KaneoAccessSection`, which already uses
`StatusPill` for exactly this question (`KaneoAccessSection.svelte:117`).

**Keeping the stale instance URL deliberately.** Defensible — it makes switching back a
one-click operation, and the value is inert. Rejected because stored data continuing to
diverge from the visible form is what the finding was actually about.
