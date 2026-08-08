<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0367: ReposSection UX Close-Out

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-04)

## Context

`ReposSection` (`client/settings/sections/ReposSection.svelte`) — the settings section for managing a context's coding repositories (add/delete, preset selection, per-repo egress domains) — had 5 open UX-review findings (`docs/ux-reviews/ReposSection.md`), four of which this sub-project closed:

1. **`repos-no-heading-element` (Low):** the add form's sub-label was a `<p>`, so the form was unreachable by heading navigation. `PageHeader.svelte` already rendered the section title as an `<h2>`; the residual was the missing `<h3>`.
2. **`repos-status-not-announced-never-clears` (Low):** a single top-of-section status pair was written by three unrelated handlers (`load`, `handleAdd`, `handleDelete`), and `status` was only cleared at the start of the next mutation — a success message persisted indefinitely.
3. **`repos-load-error-no-recovery` (Low):** a load failure rendered a bare error with no recovery affordance; the only retry path was the `⟳` glyph in the header's far corner.
4. **`repos-egress-silently-normalised` (Low):** `parseEgress` lowercases, trims and dedupes on submit, and the form clears on success, so a user typing `PyPI.org, pypi.org` never saw two entries collapse into one.

The fifth finding, **`repos-no-edit-capability`**, was deliberately carved out: editing needs PATCH/PUT on the coding-repos routes plus new per-row UI — a feature spec of its own.

Two hard scope constraints shaped every fix: **no shared-primitive changes** (`client/shared/ui/` untouched) and **no edits to the shared rules in `client/settings/settings.css`** (`.status-error`/`.status-success` have 30+ consumers and belong to a different sub-project). Additionally, **no new visual baselines**: the audit floor stayed 467, with exactly three named baselines permitted to change.

## Decision Drivers

- **The audit floor is the evidence.** Tasks were split by *expected pixel impact*, not finding order. The `<h3>` promotion — the one fix that must not move a pixel — runs the visual audit **without re-shooting**, so a green audit is real evidence rather than a tautology. Re-shooting to make a failing audit green destroys the only evidence that task produces.
- **Each message sits with the control that produced it.** The single status pair became two slots: load/delete outcomes above the repo rows, add outcomes inside the add-form card.
- **Errors persist; successes expire.** An error stays until the user retries or succeeds (it demands action); a success message auto-clears after `statusTimeoutMs`.
- **The auto-clear duration is a prop, not a constant.** `statusTimeoutMs` (default 4000) is injected so Storybook meta args can set it to 600s — no screenshot ever races a wall clock, and tests inject tiny values instead of using fake timers.
- **A preview must derive from the same function the submit path uses.** The egress hint reads `parseEgress(addEgress)` via `$derived`, so it cannot drift from what is actually saved.
- **Never silently edit what the user typed.** Rewriting the textarea on blur was rejected: it would destroy line breaks and ordering.
- **Pre-existing tests are not edited to pass.** Three existing status tests use bare `querySelector` with no positional assertion and still pass under the new routing — a failure among them means the routing is wrong, not the test.

## Considered Options

### Option 1 — Origin-routed feedback slots + timer-as-prop + read-only egress preview (chosen)

Split the status pair into a list slot (load/delete, with an inline `Retry` button re-running `load(contextId)`) and an add slot (add outcomes only); auto-clear successes via `setTimeout` keyed on an injectable `statusTimeoutMs` prop with teardown in an `$effect` cleanup; promote the label to `<h3>` with an explicit `font-weight: 400` pin; render a live `Will save: …` hint under the egress textarea derived from `parseEgress`, rendering nothing when no hosts parse.

- **Pros:** closes all four findings; zero shared-layer churn; the prop keeps baselines deterministic; the empty-field guard keeps the egress-focused baseline byte-identical.
- **Cons:** four state variables and two timers where two variables sufficed before; the Retry button also renders after a failed delete (accepted deliberately — after a failed delete the list state is uncertain, and re-fetching tells the user whether it landed; separate error variables would add state for no user benefit).

### Option 2 — Keep one status pair, add only a timer and a Retry button

- **Pros:** smaller diff.
- **Cons:** fixing the timer or the Retry alone leaves the other finding's message in the wrong place — the two findings share one root cause and must be fixed together.

### Option 3 — Fake timers in tests instead of an injectable duration

- **Pros:** no new prop.
- **Cons:** the spec's testing-strategy table proposed this, but it leaves screenshots racing a wall clock; the `added, success status` baseline would fail intermittently under CI load. The prop is the reason the plan could hold the 467-baseline floor.

### Option 4 — Rewrite the egress textarea to its normalized form on blur

- **Pros:** the user sees exactly what will be stored.
- **Cons:** silently edits what someone typed and destroys line breaks and ordering; rejected in the spec.

## Decision

Option 1 shipped. What landed (verified against the tree):

1. **Heading semantics** (`e24abe5a1`) — add-form label promoted from `<p>` to `<h3>` (`ReposSection.svelte:192`) carrying the same `.settings-repos__add-label` class, which gained an explicit `font-weight: 400` so the tag change stayed pixel-identical; the audit ran against untouched baselines and passed 467/0.
2. **Origin-routed feedback** (`3814bd2b8`) — `error`/`status` split into `listError`/`listStatus`/`addError`/`addStatus`; the list error renders inside `.settings-repos__feedback` beside an outline `Retry` button (`testid="repos-error-retry"`, `:153`) that re-runs `load(contextId)`; add outcomes render at the end of the add-form card; successes clear after `statusTimeoutMs` (default 4000, `:22,:25`), with both timers cancelled in an `$effect` teardown; the header `⟳` IconButton stays as the idle refresh affordance. Stories set `statusTimeoutMs: 600_000` in meta args (`ReposSection.stories.svelte:17`). Two baselines changed (`Error`, `added, success status`), both read as PNGs before acceptance.
3. **Egress preview** (`e6c8f7ec3`) — `egressPreview = $derived(parseEgress(addEgress))` (`:59`) renders `Will save: pypi.org` / `Will save N domains: …` (`:237-241`) between the textarea and the static hint, styled in the same small dim type as `.ui-field__hint` (`:355`), rendering nothing for an empty field. No `aria-live` region — per-keystroke announcements would be noise, not help. One baseline changed (`long content in the add form, narrow`).
4. **Documentation close-out** (`95dd05395`) — four findings flipped to `fixed` in `docs/ux-reviews/ReposSection.md` with hash-cited `Resolved:` lines and re-derived source line numbers; rubric rows re-scored; backlog regenerated via `bun run ux:backlog` (never hand-edited), moving ReposSection to a single remaining open finding.

## Consequences

### Positive

- The add form is reachable by heading navigation with zero pixel movement — proven by an audit run against untouched baselines, not by re-shooting.
- Every feedback message renders beside the control that produced it; load and delete failures carry an inline recovery action.
- Success messages no longer persist indefinitely, and no screenshot or test races a wall clock because the duration is injectable.
- The egress field's silent normalization is now visible before submit, and the preview cannot drift from what is stored because both paths call the same `parseEgress`.
- Only three named baselines changed across the whole sub-project; the 467 floor held; `settings.css` and shared primitives are untouched.

### Negative

- The component's state surface grew from two status variables to four plus two timers and a teardown effect — more machinery for a small section.
- The Retry button appears after a failed delete even though the delete itself cannot be retried; the behavior is defensible (re-fetch resolves uncertainty) but must be explained to future readers.
- The plan's checkbox state and the backlog's expected numbers (14 open / 18 sections) were accurate only at close-out time; subsequent sub-projects moved the backlog further, so the plan document alone is no longer a reliable statement of current state.

### Risks

- **`statusTimeoutMs` as public API**: consumers could pass `0` or extreme values; mitigated by the default and by the prop being consumed only by settings stories/tests today.
- **Timer teardown correctness** depends on the no-reactive-reads `$effect` running exactly once; a future refactor that adds a reactive read to that effect would re-register the cleanup. The pattern is documented in the component.
- **Baseline-scoping fragility**: the egress preview renders nothing when empty specifically to protect the `egress-textarea-focused` baseline; changing the empty-state rendering later re-baselines that shot and must be a deliberate act.

## Related Decisions

- **ADR-0362 (ToolsSection UX Open-Findings Fixes)** — sibling sub-project under the same UX-review program; contrasts with this ADR's zero-shared-churn constraint (ToolsSection required an additive `Btn` prop; ReposSection needed none).
- **ADR-0350 (Repositories Section Clarity)** — the earlier ReposSection remediation that introduced the shared-layout add form and confirm-dialog delete these findings built on.
- **ADR-0359 (UX Findings Backlog)** — the stable-id findings format, `Resolved:`-hash contract, and generated-backlog discipline the close-out task consumed.
- **ADR-0360 (Visual Gate Trustworthiness)** — the "read every changed PNG; a green audit after re-shoot is not evidence" discipline this plan applied per-task.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-04-repossection-close-out.md`; spec: `docs/superpowers/specs/2026-08-04-repossection-close-out-design.md`.
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.
- Client tests run via `bun run test:client` only — `bunfig.toml:8` `pathIgnorePatterns` makes `bun test tests/client/...` silently discover nothing. Final gate: `test:client` 1436/0, `visual:audit` 467/0, backlog parser 21/21, baseline count 15.
- Timing-flake discipline: the positive auto-clear test polls with `waitFor` (fixed wall-clock sleeps are forbidden by `tests/CLAUDE.md`); the negative test keeps a generous fixed bound because asserting a non-event cannot be polled, and starvation can only make the timer *less* likely to fire.
- `repos-no-edit-capability` stayed open at close-out (later decision-closed as deferred); it requires backend update routes plus per-row UI and is a feature spec of its own.
