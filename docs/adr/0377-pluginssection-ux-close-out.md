<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0377: PluginsSection UX Close-Out

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-05)

## Context

`PluginsSection` (`client/settings/sections/PluginsSection.svelte`) — the settings section for per-context plugin enable/disable and plugin config — had 14 open UX-review findings (`docs/ux-reviews/PluginsSection.md`), the largest open backlog of any of the 19 reviewed sections. The findings clustered around four root defects:

1. **One `error` variable multiplexed four unrelated failures.** Load failures, toggle failures, save failures and required-field validation all wrote the same section-level `error` string, so no failure could be rendered near its cause, a load failure could not offer a retry, and a save could never be acknowledged without risking confusion with an error.
2. **The server route never returned the stored value.** `src/debug/settings/plugins-routes.ts` computed `hasValue` but never emitted `value`, unlike its three sibling routes (`config-routes.ts`, `byok-field-response.ts`, `coding-credentials-routes.ts`), so a non-sensitive stored plugin setting rendered as a permanently empty box labelled "(set)".
3. **Raw schema enums reached the user.** Eligibility states rendered as `config_missing: api_key` with no sentence naming the consequence or the next step, and the disabled toggle gave no explanation of why it was disabled.
4. **Config rows hand-rolled what `SettingsFieldShell` already solves.** Fields were a bare `Field` + password `Input`: no masked `Secret` resting state with Replace, `required` never reached the control as `aria-required` (only a literal asterisk in the label text), and spacing used hardcoded `10px`/`12px` values off the token scale.

The monolithic section (~230 lines owning every card's markup) made these defects inseparable: fixing per-card feedback required somewhere for the feedback to live.

## Decision Drivers

- **Component boundary before behaviour change.** Task 3 extracted `PluginCard.svelte` as a *pure move* — same markup, class names, testids and pixels, verified by an unchanged visual audit — so every later fix had a single-plugin scope and the load-bearing checkpoint was provably behaviour-preserving.
- **Server contract parity.** The `value` field was added character-identically to the expression the three sibling routes already used (`maskSensitiveValue(raw)` for sensitive, verbatim otherwise), and `patchPluginConfig` began parsing its result so the route's `unchanged` no-op flag could reach the caller as "No change — the stored value was the same" instead of a silent success.
- **Client-side eligibility copy, not reuse.** `src/plugins/eligibility-message.ts` was deliberately not reused: it is chat-facing, backtick-quotes plugin ids, joins raw keys, and has no access to field labels. A pure `client/settings/lib/plugin-eligibility.ts` maps each eligibility shape to a pill tone/label plus a sentence, resolving missing keys back to their declared field labels.
- **`knip --strict` forbids unused files and exports.** A pure module cannot land ahead of its first consumer: Task 2 (the eligibility module) was executed, reverted, and re-committed inside Task 6 (the first importer). The same constraint governed `PluginConfigField` — the type export was withheld in Task 1 and added only in Task 4, its first consumer.
- **One confirmation surface, one error owner.** The section keeps only the load error (rendered as `ErrorState` with retry, replacing the list) and the clear-value `Confirm`; toggle/save errors and validation live on the card or the owning field.
- **No `aria-pressed` on the Enable/Disable toggle.** Rejected on the SP5 precedent (`guest-mode-toggle-not-exposed-a11y`): the label already swaps "Enable"/"Disable", so `aria-pressed` would announce the opposite of the label. The toggle's `aria-describedby` points at the status pill (and the explanation, when one exists) instead.
- **Shared fixtures are frozen.** `settings-plugins-populated` is consumed by `AdminPluginsApprovalSection` too, so the new Configurable/Ineligible fixtures landed as separate scenario keys rather than mutating the shared one.

## Considered Options

### Option 1 — Extract PluginCard, then fix per-card (chosen)

Extract the card in a zero-delta checkpoint, then land server value, per-card feedback, SettingsFieldShell rows, eligibility copy, structure and tokens as separate tasks, closing findings last with hash-cited `Resolved:` lines.

- **Pros:** the pure-move checkpoint proves the extraction changed nothing (green audit without re-shooting); each fix owns a card, not a section; server defect fixed at the route rather than papered over in the client.
- **Cons:** eight sequential tasks with strict commit boundaries; two scheduling corrections (Task 2 merge into Task 6, Task 4's stale-error clearing) had to be amended into the plan during execution.

### Option 2 — Fix findings in place inside the monolithic section

- **Pros:** no extraction task, fewer commits.
- **Cons:** per-card state would have meant keying every error/in-flight/validation record by plugin id inside the section — the same complexity with worse locality and no checkpoint proving the refactor was safe. Rejected.

### Option 3 — Reuse `src/plugins/eligibility-message.ts` for the pill copy

- **Pros:** no new module.
- **Cons:** chat-facing tone, backtick-quoted ids, raw key joins, no label access; would have reproduced the `config_missing: api_key` problem it was meant to fix. Rejected.

### Option 4 — `ariaPressed={plugin.enabled}` as the finding literally requested

- **Pros:** one prop.
- **Cons:** announces "Disable, pressed" — the label naming the action and the state naming its opposite, against the SP5 precedent. Rejected in favour of `aria-describedby` → status pill.

## Decision

Option 1 shipped. What landed (verified against the tree):

1. **Server contract** — `plugins-routes.ts:40` returns `value` (masked for sensitive, verbatim otherwise, `''` when unset); `fetcher-schemas.ts:151,165` stops omitting `value` and adds `PluginConfigPatchResultSchema` with the `unchanged` flag; `fetchers.ts:198` parses it. Route tests assert both the masked and verbatim branches (`tests/debug/settings/plugins-routes.test.ts:93,120`).
2. **PluginCard extraction** — `client/settings/components/PluginCard.svelte` owns one plugin: head (h3 + pill + toggle), config rows, per-card error (`plugin-card-error-<id>`), per-field validation via `Field`/`SettingsFieldShell` `error`, in-flight `busy` across both the request and the parent's re-fetch, and transient `✓ Saved` / "No change" notes.
3. **Section slimmed to page states** — `PluginsSection.svelte:80-91` renders `ErrorState` with retry for load failures, `EmptyState` with an operator hint, and a `ul`/`li` list; it keeps only the fetch (with a stale-response race guard) and the section-level clear `Confirm`.
4. **Eligibility copy module** — `client/settings/lib/plugin-eligibility.ts` maps every eligibility shape to tone + label + explanation, resolving missing keys to field labels; consumed at `PluginCard.svelte:11,52`. Pills now read Ready / Off / Unavailable / Needs setup / Not supported here.
5. **Accessible toggle** — the pill carries `id="plugin-elig-<id>"`, explanations render as `#plugin-explain-<id>`, and the toggle's `ariaDescribedBy` references both; no `aria-pressed`.
6. **SettingsFieldShell rows** — sensitive fields rest masked behind Replace (`Secret` + `maskSecret`), non-sensitive stored values are readable in the editor, `required` reaches the control as `aria-required`; spacing moved onto `--gap-inline`/`--radius`.
7. **New fixtures, frozen shared ones** — `settings-plugins-configurable` and `settings-plugins-ineligible` scenario keys (`scenarios.ts:252-253`) and stories; `settings-plugins-populated` byte-identical.
8. **Findings closed** — all 14 findings flipped to `fixed` in `docs/ux-reviews/PluginsSection.md` with hash-cited `Resolved:` lines; the two server-side defects found while fixing are named in the findings they sat behind; backlog regenerated via `bun run ux:backlog` (0 open across 19 sections at close-out).

## Consequences

### Positive

- The UX backlog reached 0 open across all 19 sections at close-out — the stated goal of the sub-project.
- Error ownership is now structural: a failure renders on the card or field that caused it, load failures offer a retry in-place, and a save is distinguishable from both an error and an untouched control.
- A non-sensitive stored plugin value is visible in the UI for the first time; sensitive values follow the same masked-then-Replace pattern as BYOK and coding credentials.
- Screen-reader users hear a human status ("Disable, button, Ready") instead of a schema enum, and a disabled toggle explains itself.
- Every spacing value in the section resolves through the shared token scale; the card matches `McpSection`'s rounded-corner sibling pattern.

### Negative

- **Two execution-time amendments are baked into the plan.** Task 2 was reverted and re-committed inside Task 6 (knip-forbidden unused module), and Task 4's `saveConfig` originally cleared `cardError` after the validation guard's `return`, letting a stale banner stack under a field-level message; both are documented in the plan but a reader of the original steps alone would misdiagnose the commit history.
- **The eligibility copy module is client-side-only.** The explanation strings exist in one place with no server-side counterpart; a new eligibility reason added to the registry will hit the module's `default: throw` until client copy is written. This is deliberate (the server shape cannot express label-aware copy) but is a maintenance coupling.
- **`aria-pressed` rejection is recorded, not enforced.** Nothing in `Btn` prevents a future caller from re-adding `ariaPressed`; the rationale lives in this ADR and the finding's `Resolved:` line.
- **Plan checkboxes were never ticked.** All ~40 checkboxes remain `- [ ]` in the plan file; completion is only inferable from the tree and the findings doc.

### Risks

- **Shared-fixture freeze is a comment, not a guard.** `settings-plugins-populated` staying byte-identical is enforced only by the comment in `settings-handlers-plugins.ts`; a future edit would silently move `AdminPluginsApprovalSection`'s baselines. Mitigation: code review + the visual audit catching the move.
- **Backlog drift after close-out.** The plan's "0 open across 19 sections" end state was true at close-out; a new PluginsSection finding (`plugins-inactive-copy-overclaims-approval`) has since opened against the eligibility copy module, so the plan document alone is no longer a reliable statement of current state.
- **Note timers are card-local.** The 2s save acknowledgement is cleared on unmount via an effect cleanup; any future refactor that moves notes to the section must carry the timer cleanup or leak timeouts.

## Related Decisions

- **ADR-0256 (BYOK Settings Field Shell)** — introduced `SettingsFieldShell`, the primitive Task 5 adopted for plugin config rows.
- **ADR-0359 (UX Findings Backlog)** — the stable-id findings format, `Resolved:`-hash contract and generated-backlog discipline Task 8 consumed.
- **ADR-0360 (Visual Gate Trustworthiness)** — the "audit without re-shooting; read every changed PNG; scope `bun shoot -g`" discipline applied in Tasks 3-7.
- **ADR-0367 (ReposSection UX Close-Out) / ADR-0371 (ToolsSection UX Close-Out)** — sibling close-outs under the same UX-review program, same pixel-impact task split.
- **SP5 precedent (`guest-mode-toggle-not-exposed-a11y`)** — the basis for rejecting `aria-pressed` in favour of `aria-describedby` on a label-swapping toggle.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-05-pluginssection-close-out.md`; spec: `docs/superpowers/specs/2026-08-05-pluginssection-close-out-design.md`.
- Branch `ui-ux-review-02`; no merge, no push.
- Client tests run via `bun run test:client` only — `bunfig.toml:8` `pathIgnorePatterns` makes `bun test tests/client/...` silently discover nothing.
- Task 1 is the only task touching `src/`, hence the only one inside the Stryker mutation ratchet's scope; both new route tests assert kill-worthy branches rather than merely executing the new line.
- `.storybook-shots/` is gitignored; baselines are verified locally by `bun run visual:audit` but never committed.
