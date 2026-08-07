<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# TranscriptApp UX Findings — Design

**Date:** 2026-08-06
**Source review:** [`docs/ux-reviews/TranscriptApp.md`](../../ux-reviews/TranscriptApp.md)

## Goal

Close the four High findings and the story-coverage gap from the TranscriptApp UX review, so the
coding-session viewer stops rendering false or unreadable content and the composed viewer gains
screenshot coverage.

## Scope

Five findings, by id:

| Id                                        | Severity | What it is                                                       |
| ----------------------------------------- | -------- | ---------------------------------------------------------------- |
| `transcript-prompt-raw-json`              | High     | The user's own `prompt` event renders as raw JSON                |
| `transcript-tool-failure-reads-as-success` | High     | A failed tool call renders in the same green as a completed one  |
| `transcript-plan-raw-json`                | High     | Agent plans render as `JSON.stringify` output                    |
| `transcript-no-empty-state`               | High     | Zero events renders as a blank page in every status              |
| `transcript-app-story-renders-banner`     | Med      | The `TranscriptApp` story renders `StatusBanner`, not the app    |

### Out of scope

The eleven remaining findings stay `open` in the backlog. Two deserve explicit mention because this
work touches adjacent code without closing them:

- `transcript-no-design-system-primitives` — the empty state uses the shared `EmptyState` primitive,
  but `StatusBanner` stays bespoke and the literal `●` glyph stays. The finding remains open.
- `transcript-unknown-payload-raw-json` — genuinely unrecognised payload shapes still dump JSON.
  That is the deliberate terminal fallback of the new mapper, not an oversight.

### Corrections to the source review

Two findings in `docs/ux-reviews/TranscriptApp.md` were filed on weaker premises than stated. They
are out of scope here, but the review text should not be trusted as-is:

- `transcript-dim-text-contrast` — `client/shared/tokens.css:21` documents `--text-dim` at 5.69:1 on
  `--bg`, which clears WCAG AA. The blocks are visually recessive; the accessibility framing is wrong.
- `transcript-hardcoded-spacing` — there is no `--space-*` scale in `tokens.css`, only `--radius: 6px`.
  Only the `border-radius: 6px` literal has a token to migrate to.

## Architecture

A pure mapper narrows the untyped event payload; the Svelte components render a typed union.

The payload originates in **magi**, not this repository, and arrives typed only as `z.unknown()`
(`client/transcript/fetcher-schemas.ts:20`). Concentrating every field probe in one pure function
makes the speculative part exhaustively testable without mounting a component, and keeps the
branch-heavy markup out of the mutation-testing ratchet's way.

### Files

**New — `client/transcript/describe-event.ts`** (pure; no Svelte, no DOM):

```ts
export type DescribedEvent =
  | { kind: 'prompt';     body: string }
  | { kind: 'message';    body: string }
  | { kind: 'thought';    body: string }
  | { kind: 'tool';       title: string; status: string; tone: StatusTone }
  | { kind: 'plan';       entries: { content: string; status: string }[] }
  | { kind: 'permission'; decided: boolean }
  | { kind: 'result';     stopReason: string }
  | { kind: 'raw';        json: string }

export function describeEvent(event: TranscriptEvent): DescribedEvent
```

**New — `client/transcript/empty-state.ts`** (pure):

```ts
export function emptyStateFor(status: ViewerStatus): { title: string; hint?: string } | null
```

Kept separate from `describe-event.ts` deliberately: one module maps a single event's payload, the
other maps session status. They share no logic.

**New — `client/transcript/TranscriptView.svelte`.** Takes `{ events, status }` as plain props and
owns `<main class="tx-wrap">`, the header, the timeline, and the empty-state branch. This is the
storied component.

**Modified — `client/transcript/TranscriptApp.svelte`.** Shrinks to state-wiring: construct
`createTranscriptState(token)`, `onMount(load)`, render `<TranscriptView …>`. `token` stays its only
prop, so `client/transcript/index.ts` is untouched.

**Modified — `client/transcript/components/TimelineEvent.svelte`.** Calls `describeEvent(event)` once
into a `$derived`, then branches on `described.kind`. No `Record<string, unknown>` access remains in
the template.

**Unchanged:** `transcript.svelte.ts`, `fetchers.ts`, `sse.ts`, `stitch.ts`, `fetcher-schemas.ts`,
`StatusBanner.svelte`, `index.ts`. No state, network, or schema changes anywhere in this project.

`describe-event.ts` imports `statusTone` from `client/shared/ui/status-tone.js` — the first
`client/shared/ui` import in the transcript bundle. It is a pure `.ts` module, so it adds no CSS.

## Rendering rules

### `prompt`

Probe `payload.prompt ?? payload.text ?? payload.content`; accept only a string, otherwise fall
through to `raw`. Rendered as a visually attributed block — a distinct left-rail colour and a `you`
label — so the human's turn is separable from agent output.

**Stated assumption:** no `prompt` fixture exists anywhere in this repository, so the field name is a
guess ordered by likelihood. The `raw` fallback means a wrong guess degrades to current behaviour
rather than breaking. This assumption must be recorded in the finding's `Resolved:` line (see
Bookkeeping).

### `tool_call` / `tool_call_update`

`{ kind: 'tool', title, status, tone }`. Tone drives colour; the row also carries a glyph so the
state survives a monochrome or colour-blind read rather than resting on hue alone. Glyphs:
`completed` → `✔`, `failed` → `✖`, `in_progress` → `▸`, everything else → `·`.

`statusTone()` maps `failed`→`danger` and `pending`→`warn`, but has no entry for `completed` or
`in_progress`, so both return `neutral` — and `completed` losing its green would regress the one
branch that currently reads correctly. `describe-event.ts` therefore carries a two-key local
override (`completed`→`accent`, `in_progress`→`info`) and delegates everything else to
`statusTone()`.

The shared `TONE_MAP` is **not** modified: `client/settings/fetcher-schemas-analytics.ts:75` uses
exactly the `completed`/`in_progress`/`failed`/`requested` enum, so adding those keys would silently
recolour the analytics section — an unreviewed visual change outside this scope.

### `plan`

Accept only if `payload.entries` is an array whose items carry a string `content`; `status` defaults
to `'pending'`. Rendered as a checklist, one row per entry, with the marker reflecting entry status:
`completed` → `[x]`, `in_progress` → `[~]`, anything else → `[ ]`. A non-array or malformed `entries`
falls to `raw`.

### Unchanged kinds

`agent_message_chunk`, `agent_thought_chunk`, `permission_request`, `permission_decision`, and
`result` keep their current semantics; they move behind the union only. `thought` keeps its
`<details>` disclosure.

### `raw`

Terminal fallback: `JSON.stringify(payload, null, 2)`.

## Empty states

`TranscriptView` renders the timeline when `events.length > 0`. Otherwise it calls
`emptyStateFor(status)` and renders the shared `EmptyState` (`{ title, icon?, hint?, action? }`) if
it returns a record, and nothing if it returns `null`.

| status               | result                                             |
| -------------------- | -------------------------------------------------- |
| `connecting`         | "Loading the transcript…"                          |
| `live`               | "Session is running" · hint: "No output yet."      |
| `finished`           | "This session produced no output"                  |
| `recording-disabled` | `null`                                             |
| `invalid-token`      | `null`                                             |
| `error`              | `null`                                             |

The three `null` cases are why this is a lookup and not an `{:else}`: under `invalid-token` the
honest answer is "this link is dead", the banner says exactly that, and a second block underneath
would only dilute it.

## Defensive behaviour

Every probe has a fallback, so `describeEvent` has no error path — a malformed payload lands in
`raw`, which is what ships today. Three specifics:

- `JSON.stringify(undefined)` returns the value `undefined`, not a string. The current `text()`
  helper in `TimelineEvent.svelte:10-12` is protected only by its call sites happening to coalesce
  first. The mapper coalesces to `''` explicitly, so a missing field can never render the literal
  text `undefined`.
- Payloads arrive from `JSON.parse`, so they carry no cycles and `JSON.stringify` cannot throw.
- `describeEvent` is called once per event into a `$derived`, not once per branch test.

## Testing

Both new modules are pure, so they are tested where this repository already tests transcript logic:
`tests/client/transcript/` currently holds six logic suites and zero component-mount suites.

**`tests/client/transcript/describe-event.test.ts`** — table-driven over every kind, plus the
fallback cases that matter:

- `prompt` with each of `prompt`, `text`, `content`
- `prompt` with a non-string body → `raw`
- `plan` with a non-array `entries` → `raw`
- `plan` with an entry missing `content` → `raw`
- `tool` with each of `completed`, `failed`, `pending`, `in_progress`, and an unmapped status
- a payload of `{}` → `raw`

**`tests/client/transcript/empty-state.test.ts`** — all six statuses, asserting `null` for the three
suppressed ones.

Run both as `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`.
A bare `bun test tests/client/...` matches nothing and reports success without executing.

Both files are new, so the mutation ratchet seeds a baseline for them on merge.

## Story coverage

- **New `client/transcript/components/StatusBanner.stories.svelte`** — the six banner states move
  here under an honest title. No coverage is lost, and `transcript-app-story-renders-banner` is
  closed by the retitling alone.
- **New `client/transcript/TranscriptView.stories.svelte`** — populated (a fixture session
  exercising prompt → thought → tool → plan → result), plus `connecting`, `live`, and `finished`
  empty, plus `invalid-token` empty to prove nothing renders below the banner. One manual-region
  640px shot below `@generated-end auto-screenshots`.
- **`client/transcript/components/TimelineEvent.stories.svelte`** — add `Prompt` and
  `Tool call pending`; the ten existing states stay.
- **Delete `client/transcript/TranscriptApp.stories.svelte`** and its generated spec
  `tests/visual/transcript/TranscriptApp.spec.ts`, and drop the stale
  `.storybook-shots/transcript/TranscriptApp.spec.ts/` baselines (gitignored — local cleanup only).

Then `bun run shoot:gen` and re-shoot.

## Bookkeeping

- `tests/scripts/ux-backlog.test.ts:232` asserts `toHaveLength(21)`; there are now 22 review
  documents. **This test is red on the branch right now**, from writing the review. Bump it to 22.
- Mark the five findings `fixed` in `docs/ux-reviews/TranscriptApp.md`, each with a `**Resolved:**`
  line naming the commit. The `transcript-prompt-raw-json` line must state that the field-name probe
  order is a guess and should be re-verified against a real magi payload — otherwise a wrong guess
  silently reopens the finding with no one noticing.
- `bun run ux:backlog`, then `bun run format`.

The backlog parser throws on a non-`open` status with no `Resolved:` line, so this is enforced
rather than optional.

## Verification

- `bun run check:full`
- The two new client suites, run explicitly with the browser-conditions command above
- `bun shoot -g TranscriptView`, `bun shoot -g TimelineEvent`, `bun shoot -g StatusBanner` all green

## Global constraints

- Strict TypeScript; `.js` extensions in import paths.
- Never add lint-disable or type-ignore comments.
- A `max-lines` / `max-lines-per-function` failure is a design signal — split, do not compress.
- Formatter is `oxfmt` via `bun run format`, not prettier.
- Never hand-edit `docs/ux-reviews/_BACKLOG.md`; regenerate with `bun run ux:backlog`.
- Never hand-edit inside `@generated-begin` / `@generated-end auto-screenshots` regions.
- Never pass `--no-verify` to `git commit`.
