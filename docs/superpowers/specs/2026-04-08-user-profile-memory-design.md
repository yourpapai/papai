<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User Profile Memory Design

**Date:** 2026-04-08
**Status:** Approved

## Problem

papai already has four layers of persistent memory:

| Layer                                     | What it stores                                                 | Populated by                                                          |
| ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `conversation_history` + `memory_summary` | Verbatim turns + LLM-trimmed rolling summary                   | Automatic, every turn                                                 |
| `memory_facts`                            | Entity references (`task #42`, `proj:abc`)                     | Rule-based extraction from tool results                               |
| `user_instructions`                       | **Explicit** behavioral directives ("always reply in Spanish") | LLM tool `save_instruction` when user says "always/never/from now on" |
| `memos` (with `embedding` column)         | User's free-form notes and thoughts                            | LLM tool `save_memo` when user shares info to keep                    |

What's missing is **implicit user-oriented memory** — persistent observations about _who the user is_ and _how they prefer to interact_, derived from observation rather than explicit dictation. The user's role, expertise, communication style, recurring interests — things a human colleague picks up naturally over time and which help the bot feel user-oriented rather than generic.

Existing layers don't cover this:

- Instructions are explicit ("always X"), not observed ("seems to prefer X").
- Memos are content-shaped (notes, links, thoughts), not user-shaped.
- Facts are entity IDs, not preferences.
- Summary is narrative about the conversation, not typed beliefs about the user.

## Scope

**In scope (Phase A):** A single per-user markdown blob capturing stable persona facts — identity, expertise, communication style, interests. Populated by a background extraction pipeline that runs at the same cadence as smart-trim. Rewritten in-place hot-path via two LLM tools (`remember_about_user`, `forget_user_profile`) when the user explicitly adds or removes something. DM-only in this phase; groups are inert.

**Out of scope (Phase A, with expansion notes at the end of this doc):**

- Phase B — implicit preferences inferred from interaction patterns (corrections, repeated requests, behavioral cadence)
- Phase C — typed structured memory, episodic memory (successful past interactions as few-shot examples), and reflective belief synthesis à la Park et al.

Phase A is deliberately the minimum viable layer that lays the right groundwork for B and C without rework.

## Research summary

Common patterns across mem0, LangMem, Letta, ChatGPT's "memory" feature, and Park et al.'s generative agents:

- **Background extraction** after a turn closes is the dominant pattern for implicit observations — avoids blocking the reply, uses a smaller/cheaper model.
- **Typed but loose schema** — `{kind, value, confidence, evidence, timestamps}` outperforms free text at scale, but single-blob "core memory" (Letta) is simpler and Letta's own benchmarking showed flat memory beats fancy retrieval at conversational scales.
- **Hot-path write tools** for explicit add/forget actions that need immediate confirmation; background extraction for implicit observations that don't.
- **Single-shot LLM rewrite** handles deduplication, conflict resolution, and contradiction without needing separate ADD/UPDATE/DELETE/NONE machinery — mem0 has both, but the LLM-rewrite approach is simpler when there's only one document to maintain.
- **User control is non-negotiable**: view, edit, delete, full opt-out.

Phase A adopts: background extraction + single markdown blob (Letta core-memory style) + two hot-path tools (mem0-style explicit writes) + full user control via slash commands. This is the smallest common denominator of the dominant patterns, chosen for the smallest possible delta to papai's existing code.

## Decisions

- **Single markdown blob per user**, not typed records. Mirrors the existing `memory_summary` pattern.
- **New table `user_profile(user_id, profile, updated_at)`** keyed by `user_id`, not `context_id`.
- **DM-only in Phase A.** Profile extraction, profile tools, and the profile section of the system prompt are all excluded from group conversations at the boundaries (not guarded inside handlers).
- **Background extraction piggybacks on the existing smart-trim trigger** (every 10 user messages or hard cap), implemented as a new sibling function `runProfileExtractionInBackground` that runs in parallel with `runTrimInBackground` — not by extending the trim runner itself.
- **Two hot-path LLM tools**, `remember_about_user` and `forget_user_profile`, both routing through the same small-model blob-rewrite pipeline.
- **Two slash commands**, `/profile` (show) and `/profile clear` (wipe). Editing happens via natural language through the LLM tools.
- **Size is model-judged, not char-capped.** The extraction prompt asks for ≤300 lines as a soft upper bound with guidance to prefer brevity. A generous 50,000-char sanity ceiling in the validation layer catches malformed responses only.
- **Profile is injected into the system prompt** as a new `=== User profile ===` section at the top of the existing memory context block (before summary and facts).

## Architecture

```
                          ┌────────────────────────────────────┐
                          │      System prompt assembly         │
                          │  (src/system-prompt.ts)             │
                          ├────────────────────────────────────┤
                          │ === Custom instructions ===         │ ← user_instructions
                          │ === User profile ===                │ ← NEW (DM-only)
                          │ === Memory context ===              │ ← memory_summary + memory_facts
                          │ <base prompt + workflow rules>      │
                          │ <USER_PROFILE_RULES (DM-only)>      │ ← NEW
                          └────────────────────────────────────┘
                                          ▲
                                          │ injected each turn (DM only)
                ┌─────────────────────────┼─────────────────────────┐
                │                         │                         │
       ┌────────────────┐       ┌──────────────────┐       ┌─────────────────┐
       │ instructions   │       │  user_profile    │       │  memory_summary │
       │  (existing)    │       │     (NEW)        │       │   (existing)    │
       │ explicit, hot  │       │ implicit, bg     │       │ narrative, bg   │
       └────────────────┘       └──────────────────┘       └─────────────────┘
                                          ▲
                                          │ rewrites
                  ┌───────────────────────┴───────────────────────┐
                  │                                                │
        ┌───────────────────────────┐          ┌──────────────────────────────┐
        │ background extraction     │          │ hot-path LLM tools           │
        │ runProfileExtraction-     │          │ remember_about_user(fact)    │
        │ InBackground()            │          │ forget_user_profile(what)    │
        │ (called from same         │          │ (only registered in DMs)     │
        │  trigger as smart trim)   │          │                              │
        └───────────────────────────┘          └──────────────────────────────┘
                  ▲
                  │
        ┌─────────┴────────────────────┐
        │ trigger point in              │
        │ llm-orchestrator.processMessage:│
        │   if shouldTriggerTrim(...)    │
        │     void runTrimInBackground(...)            │
        │     if isDirectUserContext(contextId):       │
        │       void runProfileExtractionInBackground(...) │
        └───────────────────────────────┘
```

The two background runners are independent — neither awaits the other. If profile extraction throws, trim still runs and the user's reply (already sent) is unaffected.

## Storage

New SQLite table in a new migration file `src/db/migrations/NNN_user_profile.ts` (exact sequence number TBD during implementation):

```ts
// src/db/schema.ts
export const userProfile = sqliteTable('user_profile', {
  userId: text('user_id').primaryKey(),
  profile: text('profile').notNull(), // markdown blob
  updatedAt: text('updated_at').notNull(),
})
```

Keyed by `user_id`, not `context_id`. In Phase A, this column is only ever populated with direct DM user IDs; groups never write or read it. In Phase B (per-speaker extraction in groups), the key is already correct.

No backfill, no data transform. Rollback is dropping the table.

### Cache integration

Add a `profile: string | null` slot to `UserCache` in `src/cache.ts`, with a `profile_loaded` flag for lazy-load gating, mirroring how `summary` works. New helpers, each cloned from the corresponding `summary` helper:

```ts
getCachedProfile(userId: string): string | null
setCachedProfile(userId: string, profile: string): void
clearCachedProfile(userId: string): void
```

DB sync goes through a new `syncProfileToDb` in `src/cache-db.ts`, mirroring `syncSummaryToDb` (`queueMicrotask`-based background write).

## New module: `src/profile.ts`

Public surface (mirrors `src/memory.ts`'s shape):

```ts
export function loadProfile(userId: string): string | null
export function saveProfile(userId: string, profile: string): void
export function clearProfile(userId: string): void
export function buildProfileContextMessage(profile: string | null): string | null
export async function extractProfile(
  history: readonly ModelMessage[],
  previousProfile: string | null,
  model: LanguageModel,
  deps?: ProfileDeps,
): Promise<string>
export async function applyRemember(
  previousProfile: string | null,
  fact: string,
  model: LanguageModel,
  deps?: ProfileDeps,
): Promise<string>
export async function applyForget(
  previousProfile: string,
  whatToForget: string,
  model: LanguageModel,
  deps?: ProfileDeps,
): Promise<string>
```

Sibling to `src/memory.ts`, not a submodule — the two pipelines share no state.

## Background extraction pipeline

### Trigger point — `src/llm-orchestrator.ts`

```ts
if (shouldTriggerTrim([...history, ...assistantMessages])) {
  void runTrimInBackground(contextId, [...history, ...assistantMessages])
  if (isDirectUserContext(contextId)) {
    void runProfileExtractionInBackground(contextId, [...history, ...assistantMessages])
  }
}
```

The DM-only check lives at the call site, not inside the runner. The runner is a "extract profile for this user" function and the caller is responsible for calling it only with valid DM user IDs.

### The runner — `src/conversation.ts`

Sibling to `runTrimInBackground`, structurally identical:

```ts
export const runProfileExtractionInBackground = async (
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps = defaultConversationDeps,
): Promise<void> => {
  log.warn({ userId, historyLength: history.length }, 'Profile extraction triggered (running in background)')
  emit('profile:start', { userId, historyLength: history.length })

  const llmApiKey = getCachedConfig(userId, 'llm_apikey')
  const llmBaseUrl = getCachedConfig(userId, 'llm_baseurl')
  const mainModel = getCachedConfig(userId, 'main_model')
  const smallModel = getCachedConfig(userId, 'small_model') ?? mainModel
  if (llmApiKey === null || llmBaseUrl === null || smallModel === null) return

  try {
    const previous = loadProfile(userId)
    const model = deps.buildModel(llmApiKey, llmBaseUrl, smallModel)
    const newProfile = await extractProfile(history, previous, model)
    if (newProfile !== previous) {
      saveProfile(userId, newProfile)
      log.info({ userId, sizeBefore: previous?.length ?? 0, sizeAfter: newProfile.length }, 'Profile updated')
    }
    emit('profile:end', { userId, success: true, changed: newProfile !== previous })
  } catch (error) {
    log.warn({ userId, error: error instanceof Error ? error.message : String(error) }, 'Profile extraction failed')
    emit('profile:end', {
      userId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
```

### Extraction prompt (lives in `src/profile.ts`)

```
You are a memory writer for a personal assistant chat bot.

Your task is to maintain a SHORT markdown profile of the user, capturing only
STABLE facts about who they are and how they prefer to interact. The profile is
shown to the assistant on every turn as background context, so it should help
the assistant be more user-oriented over time.

What to capture (only when supported by the conversation):
- IDENTITY: name, role, occupation, organization, location/timezone hints
- EXPERTISE: technical skills, domains, depth of experience
- COMMUNICATION STYLE: terseness, formality, language, things to avoid
- INTERESTS: topics the user repeatedly cares about

What NOT to capture (other systems handle these):
- Specific task IDs, project names, due dates
- Behavioral directives like "always do X"
- Conversation summaries or recent events
- Speculation, single-mention trivia, sensitive data (medical, financial)

Existing profile:
{PROFILE}

Recent conversation (verbatim, oldest to newest):
{MESSAGES}

Rules:
- Output a markdown document with these section headings, in this order:
  ## Identity
  ## Expertise
  ## Communication style
  ## Interests
  Omit any section that has no content.
- Prefer NEWER information over older when they conflict.
- If the conversation contains no new stable facts about the user, return the
  existing profile UNCHANGED, character-for-character.
- Output ONLY the markdown document, no commentary, no code fences.

Length & detail guidance:
- Aim for at most ~300 lines total. Treat this as a soft upper bound, not a target.
- Keep enough information to make the assistant noticeably more user-oriented,
  but skip trivia and one-off mentions.
- A good profile is dense and stable: prefer broad facts ("Senior Go engineer
  with backend infrastructure focus") over narrow ones ("Was working on the
  auth migration last Tuesday").
- When in doubt, be brief. The profile should feel like a colleague's mental
  model of the user, not an exhaustive log.
```

### Validation (post-LLM, inside `extractProfile`)

````ts
const PROFILE_SANITY_CEILING = 50_000 // chars; ~12k tokens

// After the LLM call:
const trimmed = newProfile.trim().replace(/^```(?:markdown)?\n?|\n?```$/g, '')
if (trimmed.length === 0 && (previous?.length ?? 0) > 0) {
  log.warn({ userId }, 'Profile extractor returned empty, keeping previous')
  return previous ?? ''
}
if (trimmed.length > PROFILE_SANITY_CEILING) {
  log.warn({ userId, length: trimmed.length }, 'Profile output exceeded sanity ceiling, treating as malformed')
  return previous ?? ''
}
return trimmed
````

The sanity ceiling is **not a content cap** — it's a safety net against a misbehaving small model returning runaway output. 50k chars is ~2× the theoretical 300-line × 80-char envelope, so it should never trip on valid output.

### Concurrency

Two fast-succession trim triggers could in theory race. Last-write-wins is acceptable here because the blob is overwritten wholesale and stable persona facts are robust to intermediate states. No mutex needed; if it becomes a problem in practice, add a per-user lock in the cache.

## Hot-path LLM tools

Two new tools in `src/tools/profile.ts`, registered via `makeTools(provider, contextId)` **only when `isDirectUserContext(contextId)`**:

### `remember_about_user`

```ts
{
  description:
    "Save a stable fact about the user (their role, expertise, communication style, " +
    "interests) when they explicitly tell you something to remember. Do NOT use this " +
    "for task IDs, project names, or behavioral directives like 'always reply in " +
    "Spanish' — use save_instruction for directives.",
  inputSchema: z.object({
    fact: z.string().min(3).max(500)
      .describe("A short sentence describing the fact, e.g. 'User is a senior Go developer'."),
  }),
}
```

Routes through `applyRemember(previous, fact, smallModel)` → one small-model rewrite → `saveProfile`.
Returns `{ status: 'saved' | 'unchanged' }`.

### `forget_user_profile`

```ts
{
  description:
    "Remove or weaken information from the user profile when the user explicitly " +
    "asks to forget something about themselves.",
  inputSchema: z.object({
    what_to_forget: z.string().min(3).max(500)
      .describe("Natural language description of what to forget."),
  }),
}
```

Routes through `applyForget(previous, whatToForget, smallModel)` → one small-model rewrite → `saveProfile`.
Returns `{ status: 'forgotten' | 'not_found' }`.

Both tools share the same length guidance, the same sanity-ceiling validation, and the same section structure as the extraction prompt. They differ only in the instruction text about what to do with the input.

There is deliberately **no `view_user_profile` tool** — the profile is already injected into every system prompt as `=== User profile ===`, so the main model can read it directly.

## System prompt integration

### DM-only addendum in `src/system-prompt.ts`

```ts
const USER_PROFILE_RULES = `USER PROFILE — Stable facts about the user (identity, expertise, style, interests):
- When the user explicitly tells you something lasting about themselves ("I'm a Go dev", "I don't like verbose replies"), call remember_about_user.
- When the user asks to forget something about themselves ("forget I'm a Go dev"), call forget_user_profile.
- For explicit behavioral directives like "always reply in Spanish", call save_instruction instead.
- The profile itself appears in the "User profile" block above — read it to tailor your replies.`

export const buildSystemPrompt = (provider: TaskProvider, timezone: string, contextId: string): string => {
  const localDateStr = getLocalDateString(timezone)
  const base = buildBasePrompt(localDateStr)
  const profileRules = isDirectUserContext(contextId) ? `\n\n${USER_PROFILE_RULES}` : ''
  const addendum = provider.getPromptAddendum()
  return `${buildInstructionsBlock(contextId)}${base}${profileRules}${addendum === '' ? '' : `\n\n${addendum}`}`
}
```

Groups never see the profile rules.

### Memory context injection in `src/conversation.ts`

```ts
export const buildMessagesWithMemory = (userId: string, history: readonly ModelMessage[]): MessagesWithMemory => {
  const profile = isDirectUserContext(userId) ? loadProfile(userId) : null
  const summary = loadSummary(userId)
  const facts = loadFacts(userId)
  const memoryMsg = buildMemoryContextMessage(profile, summary, facts)
  return {
    messages: memoryMsg === null ? [...history] : [memoryMsg, ...history],
    memoryMsg,
  }
}
```

`buildMemoryContextMessage` gains a `profile` parameter (first position) and emits it as `=== User profile ===\n<blob>` at the top of the combined block. Existing summary/facts sections stay below it.

**Ordering inside the block:** profile → summary → facts. Profile first because it's the most stable context and frames how everything else is interpreted.

## Slash commands

New file `src/commands/profile.ts`, following the `msg: IncomingMessage, reply: ReplyFn` pattern:

- `/profile` — shows the current blob, or `"No profile stored yet."`
- `/profile clear` — wipes the blob, confirms with `"Profile cleared."`

Both guard at handler entry with `isDirectUserContext(msg.contextId)`:

> `"User profile is only available in direct messages."`

Slash command registration is global at bot startup (no per-context registration), so this handler-entry guard is unavoidable — unlike the tool registration and system prompt, which exclude at the boundary.

### `/help` integration

Two lines added to `src/commands/help.ts`:

```
/profile         Show what the bot has learned about you (DM only)
/profile clear   Forget everything in your profile (DM only)
```

### `/context` (admin debug) integration

The existing admin `/context` command exports conversation history, summary, and known entities as a text file. Profile is slotted between summary and entities:

```
=== User profile ===
<blob>

=== Summary ===
<text>

=== Known entities ===
<list>
```

No new privilege model — the profile inherits the existing `/context` scoping rules unchanged (whether admin can view their own context only or others' contexts, profile follows).

## `isDirectUserContext` helper

Implementation deferred to the implementation plan. Two options, both acceptable:

1. **Threaded boolean** — add `isDirect: boolean` to `IncomingMessage` and pass it through call sites. Platform-agnostic, explicit, touches more call sites.
2. **Pure ID-format helper** — a function that inspects the context ID format (Telegram numeric user IDs vs negative group IDs, Mattermost's own convention). Self-contained but platform-aware.

Lean toward (1) — doesn't leak ID-format assumptions into shared memory code.

## Privacy & user control

- **Per-user isolation.** No cross-user visibility, no admin override, no group leakage.
- **Storage parity with existing memory layers.** Same SQLite file, same filesystem permissions, no new encryption.
- **LLM exposure parity.** Profile is sent to the user's configured LLM provider on every turn, exactly like instructions, summary, and facts already are.
- **Logging hygiene.** Log entries include `userId` and `sizeBefore`/`sizeAfter` deltas, never profile content.
- **Three layers of user control**, in increasing granularity: natural-language forget (hot-path `forget_user_profile` tool) → slash view (`/profile`) → full wipe (`/profile clear`).
- **Opt-out in Phase A** is via `/profile clear`. A global `profile_enabled` config key for permanent extraction disable is a Phase B addition.
- **Sensitive data exclusion** is best-effort via the extraction prompt's "what NOT to capture" clause — not a guarantee. Escape hatch is natural-language forget.

## Token cost trade-off

A populated profile at the ~300-line soft cap is roughly 6–12k tokens injected into every DM system prompt. Typical persona profiles in Letta and ChatGPT settle around 500–1500 tokens in practice, so most users will sit well below the ceiling. This is the explicit trade-off being made in exchange for always-on user-oriented context: no retrieval logic, no tool call to fetch, just always-there background knowledge. If cost pressure becomes real for heavy users, Phase C's typed+retrieved approach is the documented escape hatch.

## Testing

The TDD hook pipeline enforces test-first for any file under `src/`. Implementation order follows the test order.

### New test files

| Test file                                      | Covers                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/profile.test.ts`                        | Round-trip persistence; `extractProfile` happy path, sanity-ceiling fallback, empty-output fallback, code-fence stripping, unchanged-blob no-op; `applyRemember` add / duplicate; `applyForget` remove / not-found; `buildProfileContextMessage` shape |
| `tests/tools/profile.test.ts`                  | `remember_about_user` and `forget_user_profile` invoke the correct module functions and return expected status shapes; handle missing LLM config gracefully                                                                                            |
| `tests/commands/profile.test.ts`               | `/profile` shows blob in DM, shows empty-state message when blank; `/profile clear` wipes; both reject group contexts                                                                                                                                  |
| `tests/db/migrations/NNN_user_profile.test.ts` | Migration creates the expected table and primary key                                                                                                                                                                                                   |

### Existing test files to extend

| Test file                        | New cases                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/cache.test.ts`            | `getCachedProfile` lazy-loads from DB; `setCachedProfile` updates cache + queues sync; `clearCachedProfile` removes from cache; TTL expiry parity                                                          |
| `tests/conversation.test.ts`     | `buildMessagesWithMemory` includes profile section in DM, excludes in group; profile appears before summary; `runProfileExtractionInBackground` happy path, error-swallowing, missing-config short-circuit |
| `tests/llm-orchestrator.test.ts` | Trigger fires `runProfileExtractionInBackground` for DM; does NOT fire for groups; both runners fire together                                                                                              |
| `tests/tools/index.test.ts`      | `makeTools` includes profile tools for DM; excludes for groups                                                                                                                                             |
| `tests/system-prompt.test.ts`    | DM contexts include `USER_PROFILE_RULES`; group contexts omit it                                                                                                                                           |
| `tests/commands/help.test.ts`    | `/help` output contains the new `/profile` lines                                                                                                                                                           |
| `tests/debug/*` context export   | Profile blob is included in `/context` output when present                                                                                                                                                 |

### Mocking conventions

Per `tests/CLAUDE.md`:

- **Mutable `let impl` pattern** for `generateText` mocks, not `spyOn().mockImplementation()`.
- `mock.module()` calls get `afterAll(() => mock.restore())` to prevent pollution.
- Reuse helpers from `tests/utils/test-helpers.ts`.

### Mutation testing

Each branch of `extractProfile`'s validation logic (happy path, sanity-ceiling fallback, empty-output fallback, code-fence stripping, unchanged-blob no-op) gets a dedicated test case. This is to satisfy the TDD hook's mutation diff step without churn.

## Manual smoke flow (post-implementation)

1. Fresh user, send 10+ DM messages establishing persona ("I work in Go", "Prefer short replies", "Currently learning Rust").
2. Wait for the trim trigger or hit the hard cap → check logs for `profile:start` / `profile:end` events.
3. `/profile` → verify the blob has populated with the expected sections.
4. Send "forget that I use Go" → verify the assistant calls `forget_user_profile`, confirms, next `/profile` shows the role removed.
5. Send "remember that I'm based in Berlin" → verify `remember_about_user` fires and the fact appears.
6. `/profile clear` → verify wipe.
7. Send a message in a group → verify no extraction, no profile in system prompt, no profile tools exposed.

## A → B → C expansion path

Phase A is deliberately the minimum viable foundation. The two forward-looking phases below describe how to grow the system without rework.

### Phase B — Implicit preferences from interaction patterns

**What's new:** Capture preferences inferred from _how_ the user interacts — corrections, repeated requests, behavioral cadence — on top of the stable persona facts from Phase A.

Examples:

- "User often asks for shorter replies" → adds to `## Communication style`
- "User mostly creates tasks in the evening" → adds to `## Interests`

**Change cost from A:**

| Layer             | Change                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Storage           | **None.** Same `user_profile` table, same blob shape.                                                                     |
| Extraction prompt | Expanded `What to capture` with behavioral inference rules; `≥2 distinct messages of evidence` constraint for inferences. |
| Extraction runner | Optional: also pass assistant turns (corrections and tool-call patterns) as input, not just user turns.                   |
| Tools             | Optional: add `view_user_profile_inferences()` if users start asking "why do you think X?"                                |
| Config            | New optional key `profile_enabled` (default `true`) for wholesale opt-out.                                                |

**Migration cost A → B: ZERO.** Prompt change + optional config key.

**Hardest design question for B:** confidence calibration. The `≥2 occurrences` rule is the starting point; mem0's explicit ADD/UPDATE/DELETE/NONE operation vocabulary is the fallback if the soft rule proves too loose. Reference: <https://docs.mem0.ai/open-source/features/custom-update-memory-prompt>

### Phase C — Typed memory + episodic + reflection

Three independent sub-phases, any subset of which can be done first.

#### C-1: Typed structured profile (mem0-style)

Migrate the blob to typed records:

```ts
{ id, kind: 'identity'|'role'|'expertise'|'preference'|'style'|'context',
  value, confidence, evidence, created_at, last_seen_at }
```

**Why:** Surgical edits without an LLM call, per-kind retrieval, scoring (recency × confidence × relevance, Park-style), structured user UI.

**Migration:** parse the Phase A blob's section headings into `kind` enum values, one row per bullet. One-shot script. Keep the `user_profile` table for a deprecation period for read-fallback before dropping. Write a dedicated ADR for this migration — it's the highest-risk data change in the expansion path.

#### C-2: Episodic memory

New table:

```ts
user_episodes(user_id, scenario, exemplar_message_ids, outcome, last_used_at)
```

Stores "successful past interactions kept as exemplars" (LangMem's episodic category). Retrieved on-demand via vector search over `scenario` embeddings — reuses `src/embeddings.ts`. Tool-driven, not always-injected: the LLM calls `recall_similar_episode(scenario)` when it wants context.

Independent of C-1 — can ship first.

#### C-3: Reflective synthesis (Park et al.)

A new background runner `runReflectionInBackground` on a long cadence (every 50 user turns or weekly), synthesizing higher-level beliefs about the user from recent profile + summary + episodes: "User values rigor over speed", "User is currently in a learning phase", etc.

Written back into the profile blob (or as `kind: 'reflection'` records under C-1). Reference: Park et al., §4.3 Reflection — <https://arxiv.org/abs/2304.03442>.

**Hardest prompt in the entire expansion.** Easy to hallucinate, easy to over-interpret. Keep heavily constrained: "Only synthesize beliefs supported by multiple distinct profile entries; if uncertain, do nothing."

### Cross-cutting principles for all phases

- **The slash command surface stays stable** (`/profile`, `/profile clear`). Users never see the underlying storage change.
- **`user_profile` as a table name is deliberately neutral** — doesn't imply blob or typed rows, just "the user profile concept".
- **DM-only is the default initial scoping for every new phase.** Per-speaker group support is a parallel expansion vector.
- **Privacy model never weakens.** Per-user isolation and full-wipe capability are preserved across all phases.
- **Cost discipline:** each phase adds at most one new background runner.

## References

### Framework anchors

| Framework             | URL                                                                              | Relevant concept                                                        |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| mem0                  | <https://docs.mem0.ai/core-concepts/memory-types>                                | Memory layer hierarchy (conversation / session / user / organizational) |
| mem0                  | <https://docs.mem0.ai/core-concepts/memory-operations>                           | ADD/UPDATE/DELETE/NONE reconciliation                                   |
| mem0                  | <https://docs.mem0.ai/open-source/features/custom-fact-extraction-prompt>        | Fact extraction prompt pattern                                          |
| LangMem               | <https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>              | Semantic/episodic/procedural split; hot-path vs background extraction   |
| Letta                 | <https://docs.letta.com/guides/agents/memory-blocks/>                            | Core memory blocks always prepended to every prompt                     |
| Letta                 | <https://www.letta.com/blog/benchmarking-ai-agent-memory>                        | "Flat memory > fancy retrieval" at conversational scale                 |
| Anthropic memory tool | <https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/memory-tool> | Client-side filesystem memory pattern                                   |
| ChatGPT memory        | <https://help.openai.com/en/articles/8590148-memory-in-chatgpt-faq>              | Saved memories vs chat history distinction                              |
| Park et al.           | <https://arxiv.org/abs/2304.03442>                                               | Memory stream, reflection, recency × importance × relevance scoring     |

### Related papai design decisions

- ADR-0029: Custom Instructions System (`docs/adr/0029-custom-instructions-system.md`) — the parallel layer for explicit directives. The profile system is the implicit-observation counterpart.
- ADR-0016: Conversation Persistence — shared cache infrastructure this design reuses.
