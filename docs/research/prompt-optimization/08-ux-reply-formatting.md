<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 08 — User-facing UX and reply formatting

The prompt currently says: `"When referencing tasks or projects, format them as Markdown links: [Task title](url). Never output raw IDs. Keep replies short and friendly. Don't use tables."` That's 25 words for cross-platform reply formatting. This file expands it into concrete rules per platform, covers progress signals, empty/error states, transparency, and when to show the model's reasoning.

## 1. Principle: the model produces intent, the adapter renders presentation

Today the model produces Markdown and each chat adapter passes it through. That mostly works, but:

- **Telegram MarkdownV2** reserves `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!` — any of them outside a styled span must be escaped with `\`. A Markdown link containing an unescaped `.` in the URL raises 400. ([10](./10-references.md) #29)
- **Mattermost** renders a GFM-ish superset (tables supported; inline code blocks, block quotes).
- **Discord** renders a GFM subset (tables not supported; `@username` mentions are special syntax `<@id>`).

Rule: **the model emits standard Markdown without platform-specific escapes**; the adapter layer converts to each platform's dialect. This is the `telegramify-markdown` / similar pattern ([10](./10-references.md) #30). The prompt should not try to teach the model Telegram MarkdownV2 — that's a renderer's job.

## 2. Reply-formatting canon

The proposed system-prompt `<rule id="output">` (see [`02-system-prompt-flaws.md`](./02-system-prompt-flaws.md) §2):

> When you reference a task or project, format it as a Markdown link `[Title](url)`; never output raw IDs. Replies render as chat messages — keep to short paragraphs and simple bullet lists. Avoid tables.

Finer rules (to be enforced by example, not by a new rule per case):

- **Task references.** Always `[Title](url)`. If the provider exposes a human id (`AUTH-42`), use `[AUTH-42 · Title](url)` for disambiguation in lists.
- **Due dates.** "Due Fri, Apr 24" over "2026-04-24". Timezone ONLY when different from user's configured timezone ("Due Fri, Apr 24 at 5 pm UTC").
- **Assignees.** Username, not id. Platform-native mentions when appropriate (Discord `<@123>`, Mattermost `@user`, Telegram `@username`) — resolved by the adapter, the model just writes `@user`.
- **Bullets.** `- item` or `• item`; the adapter can pick.
- **Bold.** Only for the one thing that matters in the reply (task title on creation, status on change). Not whole sentences.
- **Code blocks.** Only when the user asks (e.g. "give me the cron for weekdays at 9"). Never for task titles or ids.
- **Emoji.** Off by default; on only when the user has signalled it in past turns (`save_instruction("use emoji in replies")`). Matches Mind the Product's chatbot best practice of respecting user-chosen register. ([10](./10-references.md) #31)

## 3. Progress signals

Chat platforms expose a "typing..." indicator. Use it to signal liveness during multi-tool turns.

- **Telegram:** `sendChatAction("typing")` — renews every 5s. The adapter can emit this on each tool call and when the final reply is assembled.
- **Mattermost:** `"posted":{"typing":true}` via WebSocket.
- **Discord:** `client.triggerTyping(channel)`.

NN/g ([10](./10-references.md) #32) and Mind the Product ([10](./10-references.md) #31) both highlight typing indicators as the single most reliable way to keep users engaged during latency. papai already has async message-queue processing; attaching typing pulses is a small add.

For long operations (3+ tool calls, or a slow web fetch), emit an interim message: "One second — looking up the Auth project…". This is an explicit "show my work" signal without overwhelming detail. Anthropic and NN/g both flag show-your-work as a trust lever, with the caveat that too much reasoning is worse than none. ([10](./10-references.md) #33, #32)

## 4. "Show-your-work" calibration

Research ([10](./10-references.md) #34) finds that **correct** rationales and certainty cues increase trust; **wrong** rationales decrease it. Implication: don't surface the model's chain-of-thought to the user by default. Instead:

- **Do** surface tool-level progress ("Found 3 matching tasks in Auth…").
- **Do** surface decision rationale only when the decision is load-bearing ("Marked as medium priority because the deadline is next week — say if you want urgent instead.").
- **Don't** surface the model's planning ("Let me first call list_projects, then search_tasks, then…"). That is noise.

In practice: the model should reply with the _result_, optionally with a one-clause rationale. The trace viewer in the debug dashboard (`client/debug/`) is where reasoning is surfaced for auditors.

## 5. Empty / error / edge states

| State                                 | Today                           | Recommended reply pattern                                                                                                 |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Empty list (`list_tasks` returned 0)  | raw empty array → model ad-libs | "No tasks in Auth match those filters." + `next_actions.hint` hints the model to offer to create one.                     |
| Truncated list (14 matches, 10 shown) | model narrates all 10           | "10 of 14 matches — say narrow it if you want a specific one."                                                            |
| Ambiguous match                       | model picks one                 | "I found two: [AUTH-12 Login crash](…) and [AUTH-17 Logout redirect](…). Which one?"                                      |
| Confirmation required                 | model echoes the tool message   | "Delete \"Auth bug\"? This is permanent." (from `recovery.question`). Await reply.                                        |
| Provider error (rate limited)         | model narrates                  | "The task tracker is rate-limiting me; let me try again in a moment." (if retryable) OR surface `userMessage` verbatim.   |
| Provider error (workflow validation)  | model dumps all required fields | "The project workflow needs a Priority and an Assignee before I can move this to In Progress. What should I set them to?" |
| `web_fetch` too large                 | model says "can't"              | "That page is too big to fetch whole. What specifically are you looking for?"                                             |
| Identity unresolved (group)           | model asks whoever              | "To link you to a tracker user, reply with your username — e.g. `I'm jsmith`."                                            |

All of these become `next_actions.suggested_reply` templates in the tool output (see [`04-tool-output-steering.md`](./04-tool-output-steering.md) §1).

## 6. Persona and tone

The current persona is thin. Expand in the proposed system prompt:

```xml
<role>
You are papai, a task-management assistant …
Tone: friendly, concise, professional. Do not apologise repeatedly or narrate
what you are "about to" do.
</role>
```

Additional tone rules worth enforcing by example (in the `<examples>` block):

- **No "Sure, I'll …"** openers. Answer directly.
- **No "As an AI assistant, I…"** disclaimers.
- **One acknowledgement, not three.** "Done." is a valid reply.
- **Mirror register.** If the user is terse, be terse. If the user is chatty, a touch more chat.

## 7. Platform-specific escape hatches

The adapter should:

- **Telegram:** convert standard Markdown to MarkdownV2 with full escape-table. Prefer `telegramify-markdown`-style library ([10](./10-references.md) #30). Fall back to plain text if escape fails.
- **Mattermost:** pass through GFM. Honour tables if the reply contains one, but the prompt discourages tables anyway.
- **Discord:** strip tables; convert `| foo | bar |` to bullet form; convert `@user` to `<@id>` via the identity map.

Pulled out of the prompt entirely. The `<rule id="output">` just says "standard Markdown, no tables" and the adapter handles the rest.

## 8. Internationalisation

Today the bot speaks English. Users interacting in Russian, Spanish, etc. work because Claude multilingual is good, but:

- **Locale hints in the prompt** are worth adding when user language is detected: `<locale language="es-ES"/>` — lets the model choose locale-appropriate formats (dd/mm/yyyy vs mm/dd/yyyy).
- **Timezone names.** "Fri, Apr 24 at 5 pm" is ambiguous in German — use locale-aware formatter in the renderer, not the model.
- **Custom instruction: "always reply in Spanish"** already works via the instruction block.

## 9. Accessibility

- Don't rely on colour or emoji to convey state. Text-first ("Completed" not "✅").
- Don't use ASCII-art separators — screen readers choke on them.
- Keep one fact per line in lists; dense paragraphs are hard to navigate on mobile.

## 10. Evaluation hooks

- **Snapshot fixtures per platform.** For a canonical set of replies, assert the rendered output parses cleanly on each platform (Telegram parseMode='MarkdownV2' doesn't throw).
- **Reply-length eval.** Assert replies after successful tool calls are ≤280 characters in 80% of fixtures. Long-form responses only when the user explicitly asked for detail.
- **Emoji-off default.** Assert emoji don't appear unless a `save_instruction` explicitly requested them.

## 11. Concrete recommendations

- **R-08-1 (H):** move platform-specific Markdown escaping into the adapter layer. Prompt stays platform-agnostic.
- **R-08-2 (H):** drive empty / error / truncation replies from `next_actions.suggested_reply` rather than ad-libbed text.
- **R-08-3 (M):** emit typing indicators during multi-tool turns via each adapter's native API.
- **R-08-4 (M):** on tool calls that take >2s, send an interim "looking up…" message.
- **R-08-5 (M):** expand the persona section with concrete tone examples (no disclaimers, no triple apologies, mirror register).
- **R-08-6 (L):** add locale hints to the system prompt when user language differs from English.
- **R-08-7 (L):** ship a per-platform Markdown renderer with unit tests (Telegram MarkdownV2, Mattermost GFM, Discord).

External: NN/g ([10](./10-references.md) #32), Mind the Product ([10](./10-references.md) #31), Telegram parseMode docs ([10](./10-references.md) #29), telegramify-markdown ([10](./10-references.md) #30), Seeing-the-reasoning ([10](./10-references.md) #34).
