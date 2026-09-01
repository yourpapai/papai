# Design — telegram-rich-inbound

## Context

See `proposal.md — Why`. The adapter's intake surface is grammy filter-based:
`bot.on('message:text')` matches only updates whose message has a `text` property;
`RichMessageMessage` is a separate union arm (`rich_message` set, `text` absent),
so it matches no registered filter today and is silently dropped.

## Goals / Non-Goals

- Goals: no-silent-drop intake for rich sends and rich edits; plain-text extraction
  as a pure, error-tolerant function; no behavior change for existing text/media paths.
- Non-Goals (design-level): no formatting preservation, no rich-attachment download,
  no changes to context-scope resolution — extracted text reuses `extractContextInfo`
  and friends unchanged.

## Decisions

### D1 — Bare-`message` catch-all that no-ops without `rich_message`

Register `bot.on('message', …)` alongside the existing filters. grammy dispatches to
**all** matching handlers, so plain-text and media messages also reach this handler;
it returns immediately unless `ctx.message?.rich_message !== undefined`. Rich
messages match only the bare filter (no `text`/`photo`/… properties), so there is no
double delivery for them, and the no-op guard covers everything else.
Alternative rejected: widening the existing filters — grammy property filters cannot
be "or"-ed across properties without restructuring all intake; the catch-all is
additive and leaves current routing untouched.

Precedence rule: if Telegram ever populates both `text` and `rich_message` on one
message, `text` wins and the rich walk is skipped (the `message:text` path already
delivered it; the catch-all no-ops when `text` is present).

### D2 — Extraction as a pure module: `src/chat/telegram/rich-inbound.ts`

No existing module parses message content (message-extraction.ts handles ids,
context, and reply context — see `src/chat/telegram/message-extraction.ts`), so a
new module is justified. One exported pure function: received rich message →
`string | null`. Walk order: text-bearing blocks (paragraph, section heading,
preformatted, list item, quotation) in document order; within each block, `RichText`
is `string | RichText[] | styled-node` where every styled node carries `text:
RichText` — a plain recursion concatenates. Unknown block or node types are skipped,
not thrown: extraction is error-tolerant by design, mirroring the adapter's
error-tolerant AST-scanning philosophy. `null` when nothing text-bearing is found
(media-only). No Zod schema: the payload arrives through grammy's typed transport;
defensive `typeof` guards in the walk cover malformed nodes.

### D3 — Edits ride the existing deliver path

`onMessageEdit`'s guard widens from `ctx.editedMessage?.text === undefined → return`
to also attempt rich extraction when `text` is absent, reusing D2's function and the
existing `editedAt` plumbing.

### D4 — Fake bot extension (test seam, unchanged DI surface)

`tests/platform/harness/fake-telegram-bot.ts` gains the ability to emit a rich
message update through its existing handler-slot queue — no new seam; production code
takes no new injectable dependency beyond what `botFactory` already provides.

## Risks / Trade-offs

- [Telegram later adds `text` to rich messages] → D1's `text`-wins precedence keeps
  intake single-path; extraction stays for the documented no-text shape.
- [Extraction drops a future text-bearing block type] → skipped-not-thrown keeps
  intake alive (message still delivered with partial text); the block whitelist is
  table-driven in tests, so adding a type is a one-line change with a failing test
  first.
- [Rich group messages need mention detection on extracted text] → reuse of
  `extractContextInfo` means mention logic operates on the extracted string exactly
  as for plain text; no rich-specific mention parsing exists (inline mention nodes
  concatenate to `@name` text, which the existing matcher handles).

## Migration Plan

Additive; no DB or config changes. Deploy and roll back as a normal release. The
dogfood probe (tasks 1.1–1.2, findings in `probe-findings.md`) pins real payload
shapes before the extractor constants are written; post-landing, live traffic
(debug log buffer) is reconciled against those findings (task 5.4), and the
whitelist widens only with a failing test first.

## Hook/TDD interactions

New files (`rich-inbound.ts`, its tests, fake-bot extension) pass through the
Write/Edit TDD hook pipeline (tests-first enforced there). Order of work: extractor
unit tests (pure function, grouped-assertion matrices over the node union) → fake
bot emit capability + its test → adapter routing tests (DM, group mention, thread,
edit) — the platform lane scenario lands last.
