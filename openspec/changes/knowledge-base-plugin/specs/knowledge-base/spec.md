## Purpose

Provides grounded question-answering over a per-group curated corpus with tiered retrieval, source citations, and opt-out, so every papai group can answer support questions from vetted knowledge without a separate bot.

## ADDED Requirements

### Requirement: Plugin activation and per-group eligibility
The system SHALL provide a first-party plugin `knowledge-base` with `apiVersion: 1`, `storageScope: 'group'`, and `contributes.tools`/`contributes.jobs`/`configRequirements` that activates on all platform instances (Telegram, Mattermost, Discord, Kontur Talk) and is eligible per config-context id (group-shared). The plugin SHALL remain eligible when the config-context has a null `task_instance_id` (unconfigured task instance) and SHALL compute live-turn eligibility per thread-scoped `storageContextId` mapped to its group config-context.

#### Scenario: Group enables plugin and chats in sibling threads share corpus
- **WHEN** a group admin enables `knowledge-base` for a group config-context and two sibling threads issue questions
- **THEN** both threads can call the knowledge-base tool and retrieve chunks indexed for that group config-context (not a per-thread private corpus)

#### Scenario: Null task instance does not block knowledge base
- **WHEN** a group's `context_settings.task_instance_id` is null (never configured via `/config`)
- **THEN** the plugin is still `eligible` for that config-context and its tool is available live; scheduled jobs for that config-context are not run by default (see `src/plugins/scheduled-contexts.ts:configuredDefaults` filtering `taskInstanceId !== null`) and require explicit enable in `plugin_context_state` to be scheduled

#### Scenario: Thread isolation of live turns
- **WHEN** two threads in the same group run concurrent turns
- **THEN** each turn's conversation history, retrieval query, and answer synthesis are isolated to its thread `storageContextId` and do not leak history or provisional state to the sibling thread

### Requirement: Knowledge-base tool is capability-gated and respects tool_prefs
The system SHALL expose the grounded retrieval as a plugin tool `ask_knowledge_base` (runtime name `plugin_knowledge_base__ask_knowledge_base`) that is subject to capability gating, domain/risk prefs, and per-context `tool_prefs` resolution (most-specific-wins: `toolOverrides` → `domainDefaults[plugin]` → `riskDefaults[read]` → implicit `allow`). The tool SHALL be classified `read` risk in the `plugin` domain (capability `knowledge-base`); an explicit `TOOL_METADATA['plugin_knowledge_base__ask_knowledge_base'] = read('plugin')` entry overrides the dynamic `plugin_` fallback (`src/tools/tool-metadata.ts:197` `open-world`) so guest-mode read-only (`applyGuestReadOnlyFilter` allows only `risk: 'read'`) and `read-only` preset semantics are consistent. An `allow` entry exposes the tool normally; `deny` removes it; `ask` exposes it wrapped so the LLM must supply `_permission_reason` and execution waits for explicit per-call user confirmation before running.

#### Scenario: Allow exposes tool normally
- **WHEN** a context's `tool_prefs` resolves to `allow` for `ask_knowledge_base`
- **THEN** the tool is available to the LLM and executes without an extra confirmation step

#### Scenario: Ask requires explicit confirmation
- **WHEN** a context's `tool_prefs` resolves to `ask` for `ask_knowledge_base`
- **THEN** the LLM invocation includes `_permission_reason` and the system does not execute retrieval until the user explicitly confirms that call; without confirmation the tool does not run and no chunks are returned

#### Scenario: Deny hides tool
- **WHEN** a context's `tool_prefs` resolves to `deny` for `ask_knowledge_base`
- **THEN** the tool is absent from the assembled toolset and the system prompt does not instruct the agent to use it

#### Scenario: Guest mode receives read-only filtered toolset
- **WHEN** a group has `guest_mode` on and an unrecognized user sends a question
- **THEN** the user is treated as `actorRole: 'guest'`, is not provisioned into `users`/`group_members`, and receives the guest read-only toolset (which includes `ask_knowledge_base` as a `read` tool) with the same `allow`/`ask`/`deny` gating but without memory capture

### Requirement: Tiered retrieval with score gate and top-k
The system SHALL retrieve from SQLite `chunks` using cosine similarity over float32 BLOB embeddings, partitioned into tiers: high tier `readme` + `curated_kb` and low tier `channel` (distilled threads) and any future unvetted source types. Retrieval SHALL request top-k = 6, with `RETRIEVAL_MIN_SCORE` applied as a gate on the high tier's best score: when the high tier is empty or its best finite similarity is below the configured threshold, the system SHALL serve the low tier instead; when the high tier passes the gate, the system SHALL return high-tier hits and fill any remaining slots (k − highCount) from the low tier ranked after the high tier. The system SHALL expose `maxScore` as the best similarity among the served chunks.

#### Scenario: High tier passes gate and mixes with low tier
- **WHEN** high-tier best score is at or above `RETRIEVAL_MIN_SCORE` and both tiers have hits
- **THEN** results contain all high-tier hits first and remaining slots filled from the low tier sorted by score

#### Scenario: High tier below gate falls back to low tier only
- **WHEN** high-tier best score is below `RETRIEVAL_MIN_SCORE`
- **THEN** results contain only low-tier chunks (high-tier weak matches do not crowd out fallback)

#### Scenario: Empty corpus returns no chunks with maxScore zero
- **WHEN** the group has no chunks indexed
- **THEN** retrieval returns an empty list and `maxScore` reports zero without error

### Requirement: Dimension guard and degenerate embedding handling
The system SHALL guard against embedding dimensionality mismatches and degenerate vectors: stored chunks whose embedding byte length does not equal `queryDims * 4` SHALL be dropped with a structured warning (id, sourceRef, dims vs queryDims) and not scored; non-finite cosine scores SHALL be dropped with a warning; an all-zero or non-finite query vector SHALL cause the tool call to fail with a structured error and not return fabricated hits. The system SHALL never throw for a single bad row when other rows are scorable.

#### Scenario: Mismatched dimensions are dropped not crashed
- **WHEN** a chunk was embedded with a prior model dimension different from the current query dimension
- **THEN** that chunk is skipped with a warning log and remaining chunks are still scored and ranked

#### Scenario: All-zero query vector fails closed
- **WHEN** the embedding provider returns an all-zero vector for the question
- **THEN** retrieval fails with an error indicating an undefined cosine and does not invent citations

### Requirement: Grounded answer synthesis with citations and truncation
The system SHALL synthesize answers only from provided context excerpts, never fabricating facts from model priors; when no excerpt supports an answer the system SHALL reply that the knowledge base has no reliable answer and SHALL not invent a workaround or escalate to a human. The system SHALL render tier labels in the prompt (readme/documentation, curated KB, support-channel thread) ordered by priority, instruct the model to cite excerpt numbers inline as `[n]` or `[n, m]`, deterministically resolve citations to markdown links against the retrieved chunks, and build the canonical `Источники:` tail from cited excerpts only. Retrieval-uncited excerpts SHALL not appear in the tail. The system SHALL truncate the answer **body** to 4000 characters at a paragraph boundary with a `…(truncated)` marker **before** appending the canonical `Источники:` tail intact (body budget is capped to `min(4000, platformMax - 96)` when `platformMax` < 4096). Total delivered text SHALL respect the calling platform's `maxMessageLength` — Telegram `4096` (`src/chat/telegram/metadata.ts:22`), Kontur Talk `4096` (`src/chat/kontur-talk/metadata.ts:12`), Discord `2000` (`src/chat/discord/metadata.ts:20` via `chunkForDiscord`), Mattermost `16383` (`src/chat/mattermost/metadata.ts:22`); default cap `4096` when platform unknown (`4000` body budget leaves `96` for tail/header before tail truncation applies for 4096 platforms). If `body + tail` would exceed `platformMax`, tail is truncated to the longest prefix that fits within `platformMax - len(body)` while keeping markdown link validity — i.e. truncate only at a complete markdown link boundary `[n](url)` / last complete `Источники:` entry, never mid-URL or mid-bracket, so every retained link remains resolvable; if no complete tail entry fits within the remaining budget, the tail is omitted except for its header. Body truncation (`…(truncated)`) is applied first at the platform-adjusted body budget; tail truncation is then applied against the `platformMax` cap; for Discord the delivery layer `chunkForDiscord` (`src/chat/discord/format-chunking.ts:18`) may split the final `body+tail` across multiple messages each respecting `platformMax`, but truncation still guarantees each chunk boundary respects link validity; markers already wrapped as links SHALL not be re-linked. No platform branch is introduced in retrieval or prompt code beyond the delivery-layer cap/chunking — `ChatRouter` fan-out remains identical across instances.

#### Scenario: Answer cites only what it used
- **WHEN** retrieval returns 6 chunks but the model cites only [2] and [5]
- **THEN** the posted answer contains links for 2 and 5 in the tail and no entries for the uncited 4 chunks

#### Scenario: No supporting context yields honest fallback
- **WHEN** retrieval returns no high-confidence context for the question
- **THEN** the model responds that it has no reliable answer in the knowledge base and does not hallucinate steps

#### Scenario: Truncation preserves sources
- **WHEN** a drafted answer plus its Sources tail exceeds 4000 chars
- **THEN** the body is cut at a paragraph boundary, `…(truncated)` is inserted, and the tail remains complete (or as much of the tail's prefix as fits when the tail itself exceeds the cap)

#### Scenario: Model-written Sources list is stripped when canonical tail exists
- **WHEN** the model emits its own `Sources:`/`Источники:` list despite the prompt forbidding it and a canonical tail is present
- **THEN** the trailing model-written list is stripped and only the citation-driven canonical tail is posted

### Requirement: Opt-out, self-exclusion, and retroactive purge
The system SHALL honor opt-out for knowledge-base contribution via `:no-bot:` text in any message of a thread; threads containing that signal SHALL never be written to `thread_archive` or `chunks`, and if a previously archived thread later gains such a signal the system SHALL delete its archive row and purge all derived chunks (matching `<permalink>#%` with escaped pattern) in one transaction. `no-bot`/`no_bot` reaction opt-out and retroactive reaction purge require columns `type`/`reactions` that `message_metadata` (`src/db/schema.ts:170-186`) does not store and are deferred as non-normative in this change (no-op) until such columns exist; `reactions_checked_at` is reserved for that future. The bot's own posts SHALL be stripped before archiving and before judging so the corpus never reinforces its own answers, and author names/mentions SHALL not appear in distilled items. This deferral is governed by `specs/knowledge-base/indexing/spec.md` Channel crawl requirement (verbatum elsewhere), which is the normative source for implementable exclusions.

#### Scenario: Text opt-out excludes whole thread
- **WHEN** a thread contains `:no-bot:` in any reply after being archived and distilled
- **THEN** the next crawl or revalidation sweep deletes the thread's archive row and all its `channel` chunks so future retrieval never surfaces it

#### Scenario: Reaction opt-out is retroactive — deferred in this change
- **WHEN** a user adds a `no-bot` reaction to a post in an already-indexed thread
- **THEN** in this change no removal occurs (deferred until `message_metadata` stores reactions; `reactions_checked_at` reserved); when reaction storage exists the system SHALL remove the thread's chunks and archive entry and not re-index that thread until the reaction is absent and the thread is re-observed

#### Scenario: Bot self-exclusion prevents feedback loop
- **WHEN** the corpus contains a thread where the bot authored an answer
- **THEN** bot-authored posts are stripped before judging and indexing, so the bot's answer is never distilled back into the KB (safe even when help and knowledge channel are the same)

### Requirement: Privacy, secret handling, and cross-platform parity
The system SHALL behave identically across Telegram, Mattermost, Discord, and Kontur Talk platform instances via `ChatRouter` fan-out: the tool, prompt fragments, scheduled jobs, and Settings UI sections for sources/thresholds are available per config-context on any instance without platform-specific branching. The system SHALL never log raw chunk content, thread text, embeddings, tokens, passwords, or API keys; logs MAY contain only ids, sourceRefs, dims, scores, and counts. Credentials for GitLab fetch (when used) and LLM BYOK overrides per config-context SHALL be stored encrypted-at-rest, and `providerRuntime.httpFetch` calls SHALL enforce `providerAllowedHosts` (including context-sourced dynamic hosts tiered as admin-bypass vs context-validated public-URL checks).

#### Scenario: Same group via different platform instances shares corpus
- **WHEN** a group is accessed through a Telegram instance and separately through a Mattermost instance that map to the same config-context id
- **THEN** both instances resolve eligibility against the same group config-context and retrieve from the same `chunks` keyed by that config-context

#### Scenario: Secrets are not logged or exposed
- **WHEN** a thread contains `Bearer eyJ...` or `password=...` or a long hex run
- **THEN** scrubbing replaces it with `[REDACTED]` before indexing, and no log entry contains the secret's value in any platform

#### Scenario: BYOK and GitLab credentials stay encrypted
- **WHEN** an admin or group configures a BYOK LLM key or a GitLab token for README fetch
- **THEN** the value is persisted encrypted-at-rest and masked in settings responses, and use at runtime goes through the encrypted config facade with host-allowlist and public-URL validation on every `httpFetch`

### Requirement: Feedback is per-user, stored but not driving retrieval
The system SHALL persist feedback on answers in a `feedback` table keyed by `(config_context_id, answer_id, voter)` partitioned per group (`config_context_id TEXT NOT NULL` via `getScopeKey('group', ...)`), with per-user `chatUserId` attribution (`voter`), thread-isolated (each voter's reaction is one row) so `(answer_id, voter)` uniqueness is per-group not global and groups do not collide or leak votes. `answer_id` is the stable identifier minted per `ask_knowledge_base` invocation as `sha256(configContextId|timestamp|answerHash)` (64-char hex, lowercase), returned as `answerId` alongside `answer/sources/maxScore` and used as `feedback.answer_id` FK for the lifetime of the answer's bot message; regeneration mints a new id and prior feedback remains keyed to the old row (no migration). `answerHash` SHALL be the lowercase hex `sha256` of the final delivered answer string as returned to the user — i.e. after `linkCitations`/`stripTrailingSourcesList`, body truncated to ≤4000 chars at paragraph boundary with `…(truncated)` before appending the canonical `Источники:` tail intact (tail truncated only at complete `[n](url)` boundaries when needed), or for the no-context fallback the literal fallback text; if the final answer string is empty, `answerHash` is `sha256("")`. `timestamp` is `Date.now()` milliseconds at mint time, stringified decimal. Feedback capture in this change is **not wired to a user trigger** — no chat interaction, reaction prefix, or `/settings` route writes `knowledge_base_feedback` yet; `answerId` is minted/returned/storage-ready so a future interaction (`perm:`-like callback or tool) can upsert `(config_context_id, answer_id, voter)` without a data migration — the write path is deferred. Stored feedback SHALL not alter retrieval ranking or auto-tuned thresholds in this change; it is reserved for future phases. Guests SHALL still be able to leave feedback on answers they can see (once the future trigger is added) but SHALL not cause memory capture. No retention/TTL or cardinality bound is enforced on `knowledge_base_feedback` in this change; orphaned `answer_id` rows accumulate per group until a future retention/cleanup job; `chatUserId` deletion follows the existing user-deletion path.

#### Scenario: Feedback stored per-user does not re-rank
- **WHEN** a user leaves positive or negative feedback on an answer
- **THEN** the feedback row is written, retrieval for the next question still ranks by cosine tiers/threshold only, and the rank order is unchanged by the feedback

#### Scenario: Feedback remains per-user not per-group aggregated for identity
- **WHEN** two users vote on the same answer
- **THEN** two distinct rows exist keyed by voter and neither vote is attributed to the other user
