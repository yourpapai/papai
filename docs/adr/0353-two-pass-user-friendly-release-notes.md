<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0353: Two-Pass Humanization for User-Friendly Release Notes

## Status

Accepted

## Date

2026-08-01

## Context

Version release announcements (`src/announcements.ts`, `announceNewVersion`) extract the current changelog section on startup and humanize it once via the central/global LLM before the admin reviews and broadcasts it to opt-in subscribers (ADR-0233). The single-pass humanizer had a structural flaw: the raw changelog section — full of conventional-commit noise like `build:`, `ci:`, `chore:`, `refactor:`, dependency bumps, and scope-tagged entries (`feat(telegram): …`) — was handed to the model in one shot with a mixed instruction: filter out internal churn *and* rewrite for a non-technical audience *and* format the announcement. Combining selection and tone in one prompt makes both unreliable: internal entries leak through, or the model rewrites so aggressively that user-facing meaning drifts.

The design (`docs/superpowers/specs/2026-08-01-user-friendly-release-notes-design.md`) and plan (`docs/superpowers/plans/2026-08-01-user-friendly-release-notes.md`) scoped the fix entirely inside `src/announcements/humanize.ts`: split the one LLM call into two purpose-built passes with a typed intermediate, keeping the public `humanizeChangelog` signature unchanged so callers are untouched.

## Decision Drivers

- **Separate selection from tone.** Classification ("does an end user care?") and writing ("say it warmly and plainly") are different tasks; a dedicated pass each produces better results on both than a combined prompt.
- **Typed intermediate between passes.** Pass 1 must return machine-checkable data (`Array<{ kind, text }>`), not prose, so pass 2 only ever sees surviving entries and zero-survivor detection is exact, not heuristic.
- **Structured output, not prompt-scraping.** Use the AI SDK's structured output (`generateText` + `Output.object` with a Zod schema) rather than asking for JSON and parsing text — no parse failures, no partial JSON recovery logic.
- **Fail safe.** Any classify or write failure returns `null` (the caller skips the humanized draft and keeps the raw changelog); a release whose entries all classify as internal gets a fixed behind-the-scenes one-liner instead of an empty or hallucinated announcement.
- **Test via the DI seam.** The existing `HumanizeChangelogDeps` interface gains a `generateStructured` dep so both passes are unit-testable without `mock.module` or network.
- **AI SDK v7 conventions.** `generateObject` is deprecated; the structured pass must use `generateText({ ..., output: Output.object({ schema }) })` and read `result.output`.

## Considered Options

### Option 1 — Two-pass pipeline inside `humanizeChangelog`: classify with structured output, then write from survivors only (chosen)

Pass 1 classifies the raw section via `generateStructured` against `classifiedEntriesSchema` (`kind: 'new' | 'improvement' | 'fix'`, instructed "when in doubt, drop"); zero survivors short-circuits to the exported `EMPTY_RELEASE_NOTE` without invoking the write pass. Pass 2 receives only `JSON.stringify(classified.entries)` with a tone-only system prompt carrying a few-shot example and the three exact section headers `✨ New` / `⚡ Improvements` / `🛠 Fixes`.

- **Pros:** internal churn can never reach the write prompt, so it cannot leak into the announcement; the write prompt is pure tone (smaller, easier to keep honest); zero-survivor releases are detected deterministically from the typed result; each pass is independently testable through the DI seam; public signature unchanged.
- **Cons:** two LLM calls instead of one per release (cost/latency doubles on a once-per-release, admin-reviewed path — negligible); a second system prompt to maintain; misclassification drops real entries silently (mitigated by "keep text close to the original" and admin review before broadcast).

### Option 2 — Keep one pass, strengthen the combined prompt (rejected)

Rewrite the single system prompt to demand both filtering and benefit framing more forcefully.

- **Pros:** one LLM call; smallest diff.
- **Cons:** the failure mode that motivated the change is structural, not wording — a single prompt doing selection and tone still lets internal entries through and still sees them in its context window while writing; zero-user-facing-entry releases have no clean answer (the model either hallucinates content or emits an empty body); no typed intermediate, so nothing to test against except the final prose.

### Option 3 — Deterministic pre-filter by conventional-commit prefix, single write pass (rejected)

Drop `build:`/`ci:`/`chore:`/`refactor:`/`deps:` lines with a regex before calling the LLM once.

- **Pros:** cheap, deterministic, no extra LLM call.
- **Cons:** prefix ≠ user value — `feat(core): rewrite scheduling engine` is internal churn with a user-facing prefix, and `fix: reminders fire an hour late` is user-facing regardless; a regex cannot make the judgment call the classify pass exists to make ("when in doubt, drop"); still leaves kind classification (`new`/`improvement`/`fix`) to the write prompt.

## Decision

Option 1 shipped as three commits against `src/announcements/humanize.ts` and `tests/announcements/humanize.test.ts`:

1. **Classification schema and dep (no behavior change).** `classifiedEntriesSchema` (Zod: `entries: Array<{ kind: enum('new','improvement','fix'), text: string }>`), exported `ClassifiedEntries` type, and a new `generateStructured` dep on `HumanizeChangelogDeps` whose default implementation calls `generateText({ ...opts, output: Output.object({ schema: classifiedEntriesSchema }) })` and returns `result.output`.
2. **Classify pass wired in.** `CLASSIFY_SYSTEM_PROMPT` selects user-facing entries only (drop build/ci/test/chore/refactor/deps/docs/formatting; when in doubt, drop) and labels survivors by kind; `humanizeChangelog` calls `generateStructured` first, returns the exported `EMPTY_RELEASE_NOTE` (`'This release is all behind-the-scenes improvements — nothing new to learn.'`) when zero entries survive, and otherwise passes `JSON.stringify(classified.entries)` to the write pass. A classify-pass throw returns `null` via the existing catch.
3. **Benefit-framed write prompt.** `SYSTEM_PROMPT` replaced with a tone-only prompt: plain warm language for non-technical users, no jargon/config keys/module names/commit hashes/scopes, one benefit-framed line per item, grouping under the exact headers `✨ New` / `⚡ Improvements` / `🛠 Fixes` (omit empty sections), no preamble or version number, plus a few-shot input/output example.

`docs/architecture/behaviors.md` documents the two-pass behavior in the version-release-announcements bullet.

## Consequences

### Positive

- Internal changelog churn (build, ci, chores, dependency bumps) can no longer reach the announcement: the write pass's context contains only classified survivors, so the leak is structurally excluded rather than prompt-discouraged.
- Releases with zero user-facing entries yield a fixed, honest behind-the-scenes one-liner instead of raw-changelog fallback or hallucinated content.
- The write prompt is pure tone and formatting — short, auditable, and pinned by a test asserting the section headers and few-shot example.
- Both passes are unit-tested through the DI seam (`generateStructured` / `generate`) with no module mocking; the happy-path test asserts the write prompt never sees the raw section.
- Callers (`announceNewVersion`) are untouched; the failure contract (`null` → keep raw changelog) is unchanged.

### Negative

- Two central-LLM calls per release instead of one (bounded: once per version bump, admin-reviewed, never BYOK).
- Two system prompts to keep in sync if the classification taxonomy (`new`/`improvement`/`fix`) ever changes — the schema enum, classify prompt, write prompt headers, and tests must move together.
- Silent misclassification risk: a genuinely user-facing entry dropped by pass 1 never reaches the admin's draft. Mitigated by the classify prompt's "keep text close to the original" rule and the mandatory admin review/edit/regenerate step before broadcast (ADR-0233).

### Risks

- **Structured-output support varies across central-LLM providers.** `Output.object` relies on the provider's JSON/schema mode; a provider without it fails the classify pass. Mitigation: the failure path returns `null` and the release keeps its raw changelog — degradation, not corruption.
- **Prompt drift between schema and prompts.** If someone adds a `kind` to the schema without updating both prompts' headers, sections go missing. Mitigation: the write-prompt test asserts all three headers; the schema tests pin the enum.
- **Empty-release note wording baked into code.** `EMPTY_RELEASE_NOTE` is a hardcoded English string; changing tone later means a code edit. Accepted: it is a deliberate constant, exported and tested.

## Related Decisions

- [ADR-0233](README.md) — Release Announcement Subscriptions: the opt-in broadcast pipeline (admin review → broadcast → per-recipient idempotent delivery) whose draft quality this ADR improves; the humanize step it owns is the seam this ADR restructures. (Source file pruned with the 0201-0300 batch index reference; see `docs/adr/README.md`.)
- [ADR-0302](0302-remove-deferred-prompt-modes.md) — precedent for simplifying an LLM-facing pipeline by removing modes rather than adding prompt instructions.
- [ADR-0349](0349-rename-deferred-prompt-tool-surface-to-reminders-alerts.md) — same "users and the model read plain words, internals stay internal" philosophy applied to the tool surface.

## Implementation Notes

Verified present against the shipped tree via `read`/`grep` and `bun test`:

| File | Role | Evidence |
| --- | --- | --- |
| `src/announcements/humanize.ts:16-25` | `classifiedEntriesSchema` + `ClassifiedEntries` type. | `read` confirms. |
| `src/announcements/humanize.ts:27-35` | `CLASSIFY_SYSTEM_PROMPT` (drop internal churn; when in doubt, drop). | `read` confirms. |
| `src/announcements/humanize.ts:37` | `EMPTY_RELEASE_NOTE` exported constant. | `read` confirms. |
| `src/announcements/humanize.ts:39-58` | Benefit-framed `SYSTEM_PROMPT` with `✨ New` / `⚡ Improvements` / `🛠 Fixes` headers and few-shot example. | `read` confirms. |
| `src/announcements/humanize.ts:60-78` | `generateStructured` dep on `HumanizeChangelogDeps`; default impl via `generateText` + `Output.object`. | `read` confirms. |
| `src/announcements/humanize.ts:97-111` | Two-pass orchestration: classify → zero-survivor short-circuit → write from `JSON.stringify(classified.entries)`; catch returns `null`. | `read` confirms. |
| `tests/announcements/humanize.test.ts` | Schema describe block, classify-first happy path, empty-survivors short-circuit, classify-throw → null, write-prompt content assertions. | `bun test tests/announcements/humanize.test.ts`: 10 pass, 0 fail. |
| `docs/architecture/behaviors.md:28` | Two-pass behavior documented in the version-release-announcements bullet. | `grep` confirms. |

Plan-vs-implementation notes:

- **The shipped few-shot example is richer than the plan's literal snippet.** The plan's Task 3 example input contained only `new` and `fix` entries; the shipped `SYSTEM_PROMPT` example also includes an `improvement` entry and its `⚡ Improvements` output section, exercising all three headers in the few-shot. The test contract (`toContain('⚡ Improvements')`, `toContain('Example input')`, `toContain('benefit')`) is satisfied either way; the shipped version is strictly better as model guidance.
- **Plan checkboxes were never ticked** (`- [ ]` throughout) although every task shipped; completion was verified against code and tests, not checkbox state.

The source plan `docs/superpowers/plans/2026-08-01-user-friendly-release-notes.md` and design `docs/superpowers/specs/2026-08-01-user-friendly-release-notes-design.md` remain in place alongside this ADR.
