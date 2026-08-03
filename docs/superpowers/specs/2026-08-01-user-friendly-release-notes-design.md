<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User-friendly release notes via two-pass generation

**Date:** 2026-08-01
**Status:** Approved (design)

## Problem

Release notes are humanized from the raw changelog by a single LLM call in
`src/announcements/humanize.ts`. The current single-pass prompt under-delivers
in three ways:

1. **Internal items still leak in** — refactors, dependency bumps, CI, and
   internal module names reach end users.
2. **Phrasing is too technical** — user-facing changes are described with
   jargon (tool names, config keys, API terms) instead of plain language.
3. **Items describe changes, not benefits** — entries say what changed in the
   code rather than what the user can now do or what annoyance went away.

## Decision drivers (from brainstorming)

- Borderline items: **when in doubt, drop it** — shorter, cleaner notes beat
  completeness.
- Grouping: three sections — `✨ New`, `⚡ Improvements`, `🛠 Fixes` —
  because "works better/faster now" items are neither new features nor bug
  fixes.
- Releases with zero user-facing changes produce a **friendly one-liner**
  draft (not `null`), because `null` currently falls back to showing the admin
  the raw changelog — which defeats the purpose.

## Architecture

Two-pass pipeline inside `humanizeChangelog`. The public signature
(`(rawSection: string, deps?) => Promise<string | null>`) is unchanged; callers
(`src/announcements.ts`, the admin regenerate route in
`src/debug/settings/admin/release-notes-routes.ts`) are untouched.

### Pass 1 — Classify (selection only)

- New `generateObject` call (Vercel AI SDK + Zod schema). This is the first
  structured-output usage in the codebase.
- Schema: `{ entries: Array<{ kind: 'new' | 'improvement' | 'fix'; text: string }> }`.
- The prompt's only job is **selection**: keep only changes a non-technical
  chat-bot user would notice or benefit from. Drop build, ci, test, chore,
  refactor, deps, docs, formatting, and other internal plumbing. When in
  doubt, drop.
- `text` stays close to the raw changelog entry — rewriting is pass 2's job,
  so each pass has exactly one responsibility.

### Pass 2 — Write (tone only)

- Existing-style `generateText` call.
- System prompt is tone-focused and includes a **few-shot example** (raw entry
  → benefit-framed line).
- Rules:
  - Write for non-technical users: plain, warm, concise. No jargon, config
    keys, module names, commit hashes, or scopes in parentheses.
  - One short line per item, framed as a benefit: what the user can now do,
    or what annoyance is gone.
  - Group under the exact headers `✨ New`, `⚡ Improvements`, `🛠 Fixes`;
    omit a section entirely when it has no items.
  - Output only the announcement body — no preamble, no version number.

### Deps seam

Extend `HumanizeChangelogDeps` with a `generateStructured` dep (thin wrapper
over `generateObject`) alongside the existing `generate` dep. DI-first,
matching the existing test style; no `mock.module`.

## Edge cases & error handling

| Case                                   | Behavior                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| Pass 1 returns zero entries            | Return a friendly one-liner, e.g. "This release is all behind-the-scenes improvements — nothing new to learn." |
| Pass 1 throws / invalid structured out | Log `warn`, return `null` (existing fallback)                    |
| Pass 2 throws                          | Log `warn`, return `null`                                        |
| Pass 2 returns empty/whitespace        | Return `null` (existing behavior preserved)                      |

## Testing

Update `tests/announcements/humanize.test.ts` (DI via deps):

- **Happy path:** mock `generateStructured` returning survivors → assert the
  write pass receives only survivors; final text returned.
- **Filtering contract:** schema validates `kind ∈ {new, improvement, fix}`
  (use `schemaValidates()` helper).
- **Zero entries:** friendly one-liner returned (not `null`).
- **Pass 1 throws:** `null` + warn logged.
- **Pass 2 throws:** `null` + warn logged.
- **Empty write output:** `null`.

## Out of scope

- No changes to `announcements.ts`, the admin release-notes route, broadcast,
  or the settings UI.
- No deterministic pre/post regex filtering of the changelog.
- No changes to subscription/opt-in behavior.
