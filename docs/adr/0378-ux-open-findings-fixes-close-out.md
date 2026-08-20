<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0378: UX Open-Findings Fixes Close-Out (SP5)

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-05)

## Context

After the section-by-section UX-review close-outs (ADR-0362 through ADR-0377), nine open findings remained in the generated backlog `docs/ux-reviews/_BACKLOG.md`. The sub-project SP5 (`docs/superpowers/plans/2026-08-05-ux-open-findings-fixes.md`) closed them and took the backlog to `0 open finding(s) across 18 section(s)`.

1. **`byok-load-error-raw-message` (Med):** a failed BYOK initial load rendered the raw exception string as the `ErrorState` headline — a user-facing panel led with `TypeError: Failed to fetch`.
2. **`ai-output-no-save-confirmation`:** `ConfigFieldRow` saves in place with no submit-and-navigate step, so a completed write was indistinguishable from a control that was never touched.
3. **`guest-mode-toggle-not-exposed-a11y` (Med):** the guest-mode toggle's on/off value was invisible to assistive tech, and the mutation-error banner lacked `role="alert"`.
4. **`kaneo-access-empty-state-dead-end`:** the "No Kaneo access yet" `EmptyState` offered no control; prose said "ask a group admin" with no next step.
5. **`kaneo-access-password-no-copy-rehide`:** after reveal there was no way to clear the secret from screen.
6. **`coding-credentials-conditional-fields-unexplained`:** *Auth method* appears only for Anthropic and *Base URL* becomes required for `openai-compatible`, with no explanation attached to the field.
7. **`members-empty-state-dead-end`:** the `DataTable` empty snippet read a bare "No members" with the add form sitting directly above it.
8. **`byok-hardcoded-spacing`:** eight hardcoded gap/padding literals across `ByokSection`, `ProviderForm` and `RoleBindingBlock` bypassed the token scale.
9. **`profile-sparse-layout-minimal-data`:** suggested framing ProfileSection's lone field row in a bordered panel.

Two server-side facts constrained the design: the Kaneo password reveal is **destructive** (`src/debug/settings/kaneo-credentials-routes.ts:127` clears the stored password before responding; a second reveal 409s), and `fetcher-helpers.ts`'s `requireOk` discards non-JSON 500 bodies, so the raw error text reaching `ErrorState` is the generic `request failed with status 500`, not the fixture body.

## Decision Drivers

- **Shared-first layering.** Four shared components (`ErrorState`, `ConfigFieldRow`, `Btn`, `Pill`) gained small opt-in props in their own tasks; each consumer change landed separately so a shared API and its first use were reviewed independently. New props must leave every untouched consumer byte-identical — `ErrorState` has 18 consumers, only one of which needed `detail`.
- **The visual-baseline loop is the only sanctioned way to move a baseline.** Audit first (the failure list is the prediction of which shots the change moved), re-shoot only the affected section (`bun shoot -g <Section>`, never bare `bun shoot`), read every PNG whose mtime changed — including ones the audit did not predict — then re-audit to 0 failed. A shot whose content changes without being predicted is a defect, not a baseline update.
- **The audit floor is the contract.** SP5 entered at 474 passed / 0 failed and exited at 476: +1 for `ErrorState` "With detail", +1 for `CodingCredentialsSection` "OpenAI-compatible" (the only shootable state for the Base URL hint). No other new baselines.
- **Not every state is screenshottable.** The `✓ Saved` marker is timer-dismissed (2000 ms), and `toHaveScreenshot()` retries until two consecutive frames match — a transient element cannot produce a stable snapshot, so it is deliberately unit-tested only with no visual baseline.
- **Reveal-once must be one-way in the UI too.** Because reveal clears the stored password server-side, a bare Hide that restored the Reveal button would re-arm a control that cannot work after the user discarded the only copy. The component renders a terminal "shown once" line instead.
- **Don't implement a finding's literal fix when the intent is better met otherwise.** The guest-mode finding suggested `aria-pressed={enabled}`; that would announce *"Disable guest mode, pressed"* — the label naming the action and the state naming its opposite. `aria-describedby` pointing at the On/Off `Pill` meets the intent.
- **Documentation closure runs last and alone.** A `Resolved:` line cites the commit that fixed the finding, and that hash does not exist until the fix is committed; the docs task touched zero files under `client/` or `src/`.
- **A decision-close is a valid close.** `profile-sparse-layout-minimal-data` was closed `wont-fix` with a rationale, not a hash: `Panel.svelte` has zero consumers under `client/settings/`, and four sections render the identical unframed `.settings-field-list` — framing one would buy layout at the cost of design-system consistency.

## Considered Options

### Option 1 — Opt-in shared props, one-way Hide, hint helper, token substitution, one wont-fix (chosen)

- **Pros:** every new prop is opt-in so the 17 untouched `ErrorState` consumers and all `Btn`/`Pill` consumers stay byte-identical; the one-way Hide matches the destructive server semantics; `hintFor(field)` avoids nesting three ternaries in the template; rounding `.role-binding`'s 6px gap to `var(--gap-tight)` avoids adding a single-consumer 6px token.
- **Cons:** the rounding moves seven screenshot baselines by 2px (verified acceptable on inspection); the Saved marker has no visual coverage, so a styling regression there would not be caught by the audit.

### Option 2 — Implement each finding's literal suggested fix

- **Pros:** mechanically satisfies every review document; no judgment calls to defend.
- **Cons:** re-introduces the defects the plan rejects — a Reveal button that 409s after the secret is discarded, `aria-pressed` contradicting the action-label swap, a `Panel` wrapper that contradicts four identical sections, and a new 6px token for one consumer. Worse net UX than Option 1.

### Option 3 — Batch all nine findings into one monolithic commit per section

- **Pros:** fewer commits; no intermediate audit states.
- **Cons:** the baseline loop becomes unauditable — the audit's prediction list is only meaningful per-change, and mixed changes make "which edit moved which shot" unanswerable. Violates the shared-first review model.

## Decision

Adopt Option 1, executed as nine tasks:

- **`ErrorState` gains `detail?: string`** rendered as a closed `<details>` disclosure ("Technical details"); absent → byte-identical output. `ByokSection` leads with the written sentence "Could not load BYOK settings for this context." and passes the raw exception as `detail`; the inline banner for the currentData-present path deliberately keeps the raw text.
- **`ConfigFieldRow` renders a `✓ Saved` marker** (`role="status"`) for `SAVED_VISIBLE_MS` (2000) after `save()`, `clearField()` or `saveEnum()` resolves — declared once as a local snippet, rendered in both the enum and input branches. No visual baseline, unit coverage only.
- **`Btn` gains `ariaDescribedBy?: string`, `Pill` gains `id?: string`** (both attribute-only, visually inert); `GuestModeSection` wires `aria-describedby="guest-mode-state guest-mode-help"` and adds `role="alert"` to the mutation-error banner. `Pill` gets an `id` prop rather than an id-carrying wrapper because it is `display: inline-flex` inside a flex row — a wrapper would become the flex item and risk a height shift.
- **`KaneoAccessSection`** adds a "Check again" `EmptyState` action re-running `load(contextId)` (a link was rejected: a non-provisioned personal context has no reachable admin destination), and a one-way Hide: `revealedOnce` state swaps the Reveal button for a terminal "shown once" line.
- **`CodingCredentialsSection`** extracts `hintFor(field)` covering the pre-existing combobox hint, why *Auth method* appears (provider is Anthropic), and why *Base URL* is required (`openai-compatible` endpoint); adds the `settings-coding-credentials-openai-compatible` fixture and story so that hint is shootable. The fixture must also override `agent` to `'opencode'` — `compatibleProviders('claude', …)` returns only `['anthropic']`, and a raw fixture bypasses the `onSelectChange` reconciliation that keeps agent/provider pairings valid.
- **`MembersSection`** empty copy becomes "No members yet — add the first one using the form above.", keeping "No members" as a prefix so the pre-existing loading-placeholder test still matches.
- **Spacing literals → tokens:** seven value-identical substitutions (`--s1` / `--s4`) plus one deliberate 2px increase — `.role-binding`'s `gap: 6px` rounds to `var(--gap-tight)` rather than minting a 6px token.
- **`profile-sparse-layout-minimal-data`** closed `wont-fix` with a written rationale.

## Consequences

### Positive

- Backlog reached `0 open finding(s) across 18 section(s)`; the backlog is now a clean signal where any new open finding is genuinely new work.
- Shared primitives grew only opt-in surface; no consumer was broken or visually disturbed (audit floor arithmetic held: 474 → 476, exactly the two predicted additions).
- The rejected literal fixes are recorded in the findings' `Resolved:` lines, so the `aria-pressed` suggestion and the bare-Hide re-arm cannot be re-litigated without reading why they were rejected.
- The audit-first / scoped-reshoot / inspect-every-frame loop is now a proven, repeatable protocol for baseline changes.

### Negative

- The `✓ Saved` marker and the GuestModeSection aria wiring have no visual-baseline coverage (attribute-only / transient); regressions there depend on unit tests alone.
- The `.role-binding` 2px rounding is a real, if imperceptible, visual change accepted as the price of not minting a single-consumer token.
- The `wont-fix` close leaves ProfileSection visually sparse; if a second preference lands there the finding may be worth reopening.

### Risks

- The backlog can drift above zero as new review documents are added (a 19th section with an open finding appeared after SP5); the `bun run ux:backlog` regeneration and its "is current" test keep the rollup honest, but the zero state is not sticky.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-05-ux-open-findings-fixes.md`; spec: `docs/superpowers/specs/2026-08-05-ux-open-findings-fixes-design.md`.
- Fix commits cited in the dispositions include `6c0e9307f` (BYOK load-error message) and `c2b3acf4d` (spacing tokens); the remaining six findings cite their respective task commits in `docs/ux-reviews/*.md`.
- Client tests run with `bun run test:client` (never bare `bun test tests/client/…` — `bunfig.toml` ignores that path); the visual check is `bun run visual:audit` (`VISUAL_AUDIT=1`, threshold 0.02, zero over-threshold pixels fails).
- `.storybook-shots/` is gitignored local state — baselines are never committed; the audit is the proof of correctness.

## Related Decisions

- ADR-0359: UX findings backlog stable IDs & generated rollup — the backlog format this close-out targeted.
- ADR-0360: Visual gate trustworthiness — the audit protocol SP5's baseline loop operationalizes.
- ADR-0362–0377: the per-section UX close-outs that left these nine findings open.
- ADR-0352: Shared primitive accessibility — the pattern `Btn.ariaDescribedBy` / `Pill.id` extends.

## References

- `docs/superpowers/plans/2026-08-05-ux-open-findings-fixes.md`
- `docs/superpowers/specs/2026-08-05-ux-open-findings-fixes-design.md`
- `docs/ux-reviews/_BACKLOG.md`
