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

Allowed outputs: markdown under `docs/ux-reviews/`; reading any repo file; running
`bun shoot` / `bun shoot:gen` to capture screenshots; reading the resulting PNGs. Applying
findings is a separate, human-initiated step in a separate session.
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

   Capture only the interaction states that apply (expanded group, focused input,
   invalid/validation, primary-action hover) plus the ~640px narrow width. Desktop is the
   default width.

3. **Read screenshots + source together.** Read the baseline PNGs under
   `.storybook-shots/**/<Section>.spec.ts/` with the Read tool, and read the component
   source. Source is mandatory — it is what makes affordance and accessibility findings real
   (semantic markup, `aria-*`, focus order, disabled reasoning) rather than guessed from pixels.

4. **Score against the rubric.** Walk all seven dimensions in `docs/ux-reviews/RUBRIC.md`;
   assign each `pass` / `warn` / `fail` with one line of rationale.

5. **Write the findings doc.** Copy `docs/ux-reviews/_TEMPLATE.md` to
   `docs/ux-reviews/<Section>.md` and fill it in: the scorecard header, then severity-ranked
   findings (High → Low). Each finding carries dimension · severity · where-visible · source
   anchor (`file:line`) · one-line suggested fix. Nothing more — no edits, no change-plan.

6. **Format and hand off.** `bunx prettier --write docs/ux-reviews/<Section>.md`, then report
   the path to the user. Do not commit unless asked. Stop — implementation is a separate session.

## Optional: cross-section consistency pass

When asked to review consistency rather than one component, read the composed `SettingsApp`
shots (`Personal-ready`, `Group-ready`, `Admin-ready`), compare sections against rubric
dimension 3, and write `docs/ux-reviews/_consistency.md` in the same findings format.
