---
name: ux-review
description: Use when the user asks to review, critique, or assess the UI/UX of a papai settings/admin section or `client/` component — e.g. "UX review ToolsSection", "review the UI of the task provider panel", "run a UX review on the members section". Produces a report-only, severity-ranked findings document; it never edits source.
---

# UX Review (guided, screenshot + source, report-only)

Review one `client/` section by reading its Storybook screenshots **together with** its
source, scoring against the fixed rubric, and writing a severity-ranked findings document.

<HARD-GATE>
This skill is REVIEW-ONLY. While running it you MUST NOT:

- edit, create, or delete any `.svelte`, `.ts`, `.tsx`, `.js`, `.jsx` file under `client/` or `src/`;
- propose concrete edits, before→after diffs, or an ordered change-plan (findings carry only a one-line described fix);
- run any fix → re-shoot → verify loop.

Allowed outputs: markdown under `docs/ux-reviews/`; **`*.stories.svelte` files and `tests/visual/**`
when a state the rubric requires has no story to capture it**; reading any repo file; running
`bun shoot` / `bun shoot:gen` to capture screenshots; reading the resulting PNGs. Applying findings
is a separate, human-initiated step in a separate session.
</HARD-GATE>

## When to Use

- "UX review `<Section>`", "review the UI of `<X>`", "run a UX review on `<X>`".
- `<X>` is a settings/admin section or a `client/` component with a Storybook story.

**Do NOT use** for: writing or fixing component code; visual-regression gating; whole-UI
batch sweeps (this is per-section, human-triggered).

## Prerequisites

- Storybook running: `bun storybook` (kept warm).
- One-time: `bunx playwright install chromium`.
- Background reading: `docs/architecture/storybook-screenshots.md`.

## Procedure

1. **Resolve the target.** Find the component (`client/**/<Section>.svelte`) and its story
   (`client/**/<Section>.stories.svelte`). Note the story id stem, e.g.
   `settings-sections-toolssection`.

2. **Capture the depth-B set.** Shoot the existing state stories:

   ```bash
   bun shoot -g <Section>
   ```

   Then add the interaction + narrow-viewport states you need in the manual region of the
   generated spec (`tests/visual/**/<Section>.spec.ts`, below `// @generated-end auto-screenshots`)
   and re-shoot. Use the real `@crvy/strybk` API:

   ```ts
   // below @generated-end auto-screenshots
   test('<Section> — expanded, narrow', async ({ sharedPage }) => {
     await switchStory(sharedPage, 'settings-sections-<section>--populated')
     await sharedPage.setViewportSize({ width: 640, height: 900 })
     await sharedPage.getByText('tasks').click() // expand an accordion group, etc.
     await expect(sharedPage).toHaveScreenshot()
   })
   ```

   Capture the states the rubric needs, only where they apply:
   - **State stories** — populated / empty / error / loading (the generated set).
   - **Interaction & micro-states (dim 9)** — hover and active on the primary action, focused
     input, disabled control, invalid/validation, and any in-flight ("Saving…") frame. Use
     Playwright `.hover()` / `.focus()` / `.click()`; note that programmatic `.focus()` does
     **not** trigger `:focus-visible`, so confirm the keyboard focus ring from source, not the shot.
   - **Spacing & sizing (dim 8)** — the default desktop width plus the ~640px narrow width; a
     long-content variant (long name / long error string) if a story or arg supports it, to
     expose spacing/alignment/overflow the short fixtures hide.

3. **Read screenshots + source together.** Read the baseline PNGs under
   `.storybook-shots/**/<Section>.spec.ts/` with the Read tool, and read the component
   source. Source is mandatory — it is what makes the findings real rather than guessed from
   pixels:
   - affordance / accessibility — semantic markup, `aria-*`, focus order, disabled reasoning;
   - **spacing, alignment & sizing (dim 8)** — read the actual gap/margin/padding/height/radius
     values and check them against the shared spacing/size tokens; flag one-off px that drift
     from sibling elements or the scale (a misaligned edge is often a hardcoded value in source);
   - **interaction & micro-states (dim 9)** — confirm `:focus-visible`, hover, disabled, and
     busy styling exist in the stylesheet rather than inferring them from a single frame.

4. **Score against the rubric.** Walk every dimension in `docs/ux-reviews/RUBRIC.md` (visual
   hierarchy, affordance, design-system consistency, feedback/state, content, accessibility,
   responsive/layout, spacing/alignment/sizing, interaction/micro-states); assign each
   `pass` / `warn` / `fail` with one line of rationale.

5. **Write the findings doc.** Copy `docs/ux-reviews/_TEMPLATE.md` to
   `docs/ux-reviews/<Section>.md` and fill it in: the scorecard header, then severity-ranked
   findings (High → Low). Each finding carries dimension · severity · where-visible · source
   anchor (`file:line`) · one-line suggested fix. Nothing more — no edits, no change-plan.

   Each finding carries `**Id:**` and `**Status:**` as its first two bullets. `Id` is kebab-case,
   section-prefixed, assigned by hand, never derived from the heading, and never reused. `Status` is
   `open`, `fixed`, or `superseded`; the latter two require a `**Resolved:**` line naming the commit
   or sub-project. There is no `partial` — a partially-fixed finding stays `open` with its text
   narrowed to the residue, keeping its id. Narrowing to the residue forces you to say what
   specifically remains, which is what a later implementer needs; a `partial` status would let
   you defer that and leave the finding as vague as it was.

6. **Format and hand off.** `bun run format` (the repo formatter is `oxfmt`, not prettier),
   then report the path to the user. Do not commit unless asked. Stop — implementation is a
   separate session.

## Re-reviewing an already-reviewed section

When `docs/ux-reviews/<Section>.md` already exists, the review is a re-verification, not a fresh
pass. Everything in the Procedure still applies, plus:

- **Read the shared primitives the section consumes**, not just its own file. Most fixes so far
  landed in `Btn`, `Field`, `Input`, and the shared state components — a section can have findings
  closed by a change that never touched its source. Reading only the section's own file reports
  those as still open.
- **Walk every existing finding by id.** For each: confirm it still reproduces (leave `open`), or
  set `fixed`/`superseded` with a `Resolved:` line, or narrow its text to what remains and keep it
  `open` under the same id. Never delete a finding and never reuse its id.
- **Re-score all nine dimensions** from what you see now, not from the previous scorecard.
- **Severity is re-assignable.** A High may legitimately become a Low if the surrounding UI improved.
- Add new findings with fresh ids.
- Set `**Date:**` to today — it means _last reviewed_.
- Regenerate and commit:

```bash
bun run ux:backlog
bun run format
```

## Optional: cross-section consistency pass

When asked to review consistency rather than one component, read the composed `SettingsApp`
shots (`Personal-ready`, `Group-ready`, `Admin-ready`), compare sections against rubric
dimension 3, and write `docs/ux-reviews/_consistency.md` in the same findings format.
