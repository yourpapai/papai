<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0347: Code Host Connection Clarity — Client-Derived Header Status and Submit-Time Instance URL Hygiene

## Status

Accepted

## Date

2026-08-01

## Context

The settings UI's `CodeHostSection` (`client/settings/sections/CodeHostSection.svelte`) manages the per-context `forge` credential record (code host kind, instance URL, access token) used by coding sessions to push branches and open pull requests. A UX review found that the section did not answer its basic questions: a user could not tell whether a code host was connected, what the access token was for, or why the Instance URL field was sometimes present and sometimes not. In addition, switching the `kind` from a self-hosted value to a SaaS value (`github`/`gitlab`) hid the Instance URL field, and because `collectValues` skipped hidden fields, the previously stored self-hosted URL survived the save — the route merges submitted values over the stored record.

The server route already computes `configured` / `complete` / `missing` / `unreadable` for the namespace (`client/settings/fetcher-schemas.ts`), so no server behavior changes were needed — the only server-side edit was two field **label** strings in `src/debug/settings/coding-credentials-fields-meta.ts`. Design: `docs/superpowers/specs/2026-08-01-code-host-connection-clarity-design.md`; plan: `docs/superpowers/plans/2026-08-01-code-host-connection-clarity.md`.

## Decision Drivers

- **Header status must derive from saved state, never from drafts.** Deriving the pill and sub line from `drafts` would make them flicker as the user edits a form they have not submitted; the header reports what is *stored*.
- **The sub line is suppressed via the saved `kind` value, not by inspecting `missing`.** When `kind` is missing its stored value is `''`, so `FORGE_DISPLAY_NAMES['']` is `undefined` and the sub is omitted — the same condition as the spec's table, without depending on the ordering or contents of the `missing` array.
- **No provider-specific scope strings in copy.** Nothing in the repo documents the exact GitHub/GitLab scopes the forge token needs; capability phrasing ("read and write repository contents and pull requests") is accurate against what the code does with the token and cannot rot as providers rename scopes.
- **The Instance URL requirement is conditional, so the server keeps `required: false`.** The client resolves the condition it already computes for visibility (`showInstanceUrl`), mirroring the sibling's `effectiveRequired` in `CodingCredentialsSection.svelte`. The hint must also mention operator allowlisting, because self-hosted hosts must be allowed in magi's fail-closed `MAGI_ALLOWED_REPO_HOSTS` — without it, a valid-looking URL saves cleanly and fails much later as an opaque session error.
- **The stale-URL fix is an explicit submit-time assignment, not a change to the hidden-field skip.** The skip is correct for every other field; only `instance_url` needs the invariant. The assignment is guarded on the response actually declaring an `instance_url` field, so a legacy token-only record does not gain a key it never had.
- **Honest severity:** `deriveApiBaseUrl` returns a fixed host for SaaS kinds and never reads `instance_url` for them, so a leftover value is inert for request routing. This is a data-hygiene fix (stored state should match the visible form), not a routing-correctness fix.

## Considered Options

### Option 1 — Pure client-side rendering with a submit-time invariant (chosen)

Derive the header pill (`connected` / `pending` / `error` / `not connected`) and sub line from the saved response via client-side mirrors (`FORGE_DISPLAY_NAMES`, `FORGE_SAAS_HOSTS`, `forgeHost`); add first-setup guidance, a scope-describing token placeholder, a conditionally-required Instance URL marker with hint, an empty-fields guard, a `danger` Clear variant, and an explicit `values['instance_url'] = ''` at submit when the kind no longer needs it.

- **Pros:** no server behavior changes; status can never disagree with what the route will compute; the submit-time invariant keeps stored state consistent with the visible form.
- **Cons:** display-name and SaaS-host tables are duplicated client-side mirrors of `FORGE_KINDS` / `deriveApiBaseUrl` in `src/coding-credentials/types.ts` and must be kept in sync manually; switching back to a self-hosted kind after a SaaS save means retyping the URL (accepted trade-off).

### Option 2 — Server-computed display status

Extend the coding-credentials response with a precomputed status/display-name payload.

- **Pros:** single source of truth for naming and host derivation; no client mirrors.
- **Cons:** adds wire surface and server churn for a purely presentational concern; the response schema already carried every input needed, so the server work would be duplication, not new capability. Rejected.

### Option 3 — Clear the stale URL by submitting hidden fields

Have `collectValues` include hidden fields (with their draft values) instead of skipping them.

- **Pros:** no special-case invariant for `instance_url`.
- **Cons:** changes the semantics of every hidden field, not just this one; a hidden field's draft may hold a value the user never intended to submit. Rejected — the skip is correct; only `instance_url` needed the targeted fix.

## Decision

All behavior is client-side in `CodeHostSection.svelte`: header `StatusPill` and sub derived from saved response data; first-setup helper paragraph shown while `!currentData.complete` (suppressed when the response carries zero fields, where a `No code host fields available — try Refresh.` guard renders instead); `placeholderFor` returning `token with repo read/write access` and `https://gitlab.example.com`; the Instance URL row marked required and hinted only while `showInstanceUrl`; the Clear trigger switched to `variant="danger"` to match its already-danger confirmation dialog; and in `collectValues`, after the loop, `if (fields.some((f) => f.key === 'instance_url') && !needsInstanceUrl(currentKind)) values['instance_url'] = ''`. The two forge field labels were renamed to `Host type` and `Instance URL` in the server field meta and mirrored into the story fixtures; new `settings-code-host-incomplete` / `settings-code-host-self-hosted` scenarios, stories, and visual baselines cover the new states. The `unreadable` pill state is unit-test-only — no fixture was added to shoot a single pill. The actions row's right-edge padding was measured from a rendered baseline (14px) rather than calculated, because the source-derived value (13px) did not agree with the measurement.

## Rationale

The route's `configured` / `complete` / `missing` / `unreadable` contract was already sufficient; the gap was entirely presentational, so the fix belongs in the component. Deriving from saved values keeps the header stable during editing; deriving the sub's suppression from the stored `kind` keeps it independent of `missing`-array ordering. The submit-time invariant is the minimal change that fixes the stale-URL bug without altering the generally-correct hidden-field skip, and its field-presence guard keeps legacy token-only payloads byte-compatible.

## Consequences

### Positive

- The header now answers "is a code host connected?" across all seven status resolutions, including the two that render no sub line.
- First-time users learn what the token must be able to do without any provider-specific scope string being asserted.
- Self-hosted users see the Instance URL requirement and the operator-allowlist caveat before saving, instead of an opaque session failure later.
- Stored records can no longer carry a stale self-hosted URL under a SaaS kind.
- Two new scenario keys and visual baselines pin the connection states; sibling sections were verified regression-free.

### Negative

- `FORGE_DISPLAY_NAMES` / `FORGE_SAAS_HOSTS` are client-side mirrors of server constants; adding a forge kind now requires touching both sides.
- Switching a record from self-hosted to SaaS and back requires retyping the instance URL.
- The 14px actions-row padding is a measured magic number (documented in the CSS comment) rather than a token expression.

### Risks

- If the server ever renames kind values or SaaS hosts, the mirrors silently degrade to a suppressed sub line or a raw-URL fallback (`forgeHost` returns the malformed string rather than throwing) — visible but not breaking. Mitigation: the fixture mirror test and visual baselines pin the current kind set.

## Implementation Notes

- Pill vocabulary is exactly `connected`, `pending`, `error`, `not connected` (lowercase); the header renders nothing while the first load is in flight (`currentData === null`), so the `Error` and `Loading` visual baselines did not move.
- Copy strings are exact and verbatim, including the em dash `—` (U+2014) and middot `·` (U+00B7); the setup-hint paragraph is kept on one source line so `textContent` substring assertions are not broken by injected whitespace.
- `SettingsFieldShell` suppresses `hint` while `error` is set — intended precedence, not worked around.
- Verification: the unit suite `tests/client/settings/code-host-section.test.ts`, the fixture mirror and namespace-guard tests, and re-shot visual baselines with a byte-compared expected-movement list (only `Error`/`Loading` unchanged); `bun run check:full` passed.

## Related Decisions

- ADR-0345: Settings Field Error Channel — provides the inline `error` channel whose precedence over `hint` this decision relies on.
- ADR-0346: Namespace-Aware Story Fixtures — established the guarded handler families (`settings-handlers-coding.ts`) and scenario-key model that this decision's new fixtures extend.
- ADR-0256: BYOK Settings Field Shell — provides `SettingsFieldShell` with the `required` / `hint` props used here.

## References

- Plan: `docs/superpowers/plans/2026-08-01-code-host-connection-clarity.md`
- Design: `docs/superpowers/specs/2026-08-01-code-host-connection-clarity-design.md`
- Implementation: `client/settings/sections/CodeHostSection.svelte`; field meta `src/debug/settings/coding-credentials-fields-meta.ts`; fixtures `client/stories/msw/settings-handlers-coding.ts`; tests `tests/client/settings/code-host-section.test.ts`, `tests/visual/settings/sections/CodeHostSection.spec.ts`
- Commits: `b1306207d` (label rename), `e00d0b503` (header status), `b085b844c` (first-setup guidance), `420af5eee` (empty-fields guard + danger Clear), `d1d2b9ca4` (visual coverage), `67a69d43e` (actions-row alignment)
