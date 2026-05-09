# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.2.0] - 2026-04-28

### Added

- **audit:** Add ConsolidatedBehavior type, Zod-validated file I/O
- **audit:** Add phase2 consolidation + phase3 scoring, Zod validation, schema v2
- **audit:** Add ConsolidatedManifest, Phase 3 selection, downstream invalidation
- **audit:** Add consolidation LLM agent with structured output (Phase 2)
- **audit:** Add Phase 2 consolidation runner with structured input
- **audit:** Align behavior audit scoring and planning flow
- **audit:** Implement keyword-batched behavior audit pipeline
- **recurrence:** Add RecurrenceSpec types and Zod schemas
- **recurrence:** Add recurrenceSpecToRrule
- **recurrence:** Add parseRrule, nextOccurrence, occurrencesBetween
- **recurrence:** Add describeRecurrence
- **recurrence:** Add cronToRrule translator for migration
- **db:** Migration 026 — unify recurrence storage on rrule
- Replace cronExpression with rrule/dtstartUtc across all layers
- **tools:** Migrate create_recurring_task to RRULE schedule schema
- **tools:** Migrate update_recurring_task to RRULE schedule schema
- **audit:** Move audit artifacts under dedicated root
- **tps-meter:** Add validation utilities for config hardening
- **tps-meter:** Update submodule with validation utilities
- **tps-meter:** Security hardening — all 15 audit findings addressed
- **opencode:** Enable tps meter plugin
- **behavior-audit:** Split phase2 into classify and consolidate
- **review-loop:** Swap agents, raise maxRounds default to 10
- **review-loop:** Expand severity to medium/low, replace fixPlan with needsPlanning
- **review-loop:** Simplify permission policy to always-allow
- **review-loop:** Expand severities, add planning prompt, commit discipline in fix prompt
- **review-loop:** Add plan-then-fix flow when needsPlanning is true
- **codeindex:** Scaffold workspace package
- **codeindex:** Implement tier1 workspace
- **review-loop:** Add ProgressLog interface
- **review-loop:** Wire console.log progress logging in CLI
- **review-loop:** Add detailed progress logging to loop controller
- **behavior-audit:** Add verbose generation output via BEHAVIOR_AUDIT_VERBOSE=1
- **behavior-audit:** Add spent time to per-item output across all phases
- **behavior-audit:** Add phase-stats types, accumulation, and formatting
- **behavior-audit:** Extract-agent returns AgentResult with usage
- **behavior-audit:** Keyword-resolver-agent returns AgentResult with usage
- **behavior-audit:** ResolveKeywords returns usage alongside keywords
- **behavior-audit:** Extract phase runner unwraps AgentResult, renders stats
- **behavior-audit:** Classify-agent returns AgentResult with usage
- **behavior-audit:** Classify phase runner unwraps AgentResult, renders stats
- **behavior-audit:** Consolidate agent and phase runner use AgentResult, render stats
- **behavior-audit:** Evaluate agent and phase runner use AgentResult, render stats
- **behavior-audit:** Add Phase1bProgress, migrate Progress to version 5
- **behavior-audit:** Add pure consolidate-keywords-helpers (Task 3)
- **behavior-audit:** Add embedding and consolidation config env vars
- Enrich codeindex search results with ranking metadata and structured MCP output
- **behavior-audit:** Add embedSlugBatch agent for keyword consolidation
- **behavior-audit:** Implement phase 1b keyword consolidation pipeline

### Changed

- **recurring:** Replace cronExpression with rrule+dtstartUtc across types, schema, and runtime
- Retire src/cron.ts — inline parser into translator, relocate to test oracle
- **datetime:** Remove semanticScheduleToCompiled and its helpers
- **recurrence:** Extract module, add timezone to scheduled prompts, wire recurring tool barrels
- **behavior-audit:** Separate canonical artifacts from checkpoints
- **behavior-audit:** Persist phase2a classifications as artifacts
- **behavior-audit:** Make phase2b and phase3 artifact-driven
- **behavior-audit:** Remove legacy manifest aliases
- **behavior-audit:** Complete feature-key helper rename
- **behavior-audit:** Migrate legacy manifest aliases on load
- **behavior-audit:** Require canonical artifacts for phase loading
- **behavior-audit:** Rebuild reports from canonical artifacts
- **behavior-audit:** Normalize keyword vocabulary
- **behavior-audit:** Finish artifact-model convergence
- **review-loop:** Move into root workspace
- **behavior-audit:** Remove dead exports from progress.ts and keyword-vocabulary.ts
- **behavior-audit:** Remove void-parameter anti-pattern from progress and reporting
- **behavior-audit:** Replace duplicate ConsolidatedStoryRecord with canonical ConsolidatedBehavior
- **behavior-audit:** Unify duplicate buildPhase2Fingerprint and buildPhase2aFingerprint
- **behavior-audit:** Simplify legacy migration, delete progress-schemas.ts
- **behavior-audit:** Narrow ConsolidatedManifestEntry.featureKey to required string
- **behavior-audit:** Remove behavior markdown output, harden agent config, add knip coverage
- **behavior-audit:** Remove legacy helpers, harden config, update knip coverage
- **tests:** Fix codeindex lint failures, remove conditional guards, update CI/Docker/migration fixes
- **tests:** Fix review-loop lint errors, remove conditionals, clean dead code, fix YouTrack classify error tests
- **tests:** Extract shared ContextSnapshot fixture
- **tests:** Extract shared YouTrack fetch mock utilities
- **tests:** Extract shared review-loop config fixture and temp-dir helpers
- **tests:** Extract shared Kaneo task search response fixture
- **tests:** Extract shared group setup helper in interaction-router tests
- **tests:** Extract race-condition reviewer helper in loop-controller tests
- **tests:** Remove duplicate behavior-audit-phase-stats test file
- **behavior-audit:** Remove resolver agent, simplify keyword extraction to single phase
- Add scripts/behavior-audit/index.ts (new home for orchestrator)
- Add scripts/behavior-audit/reset.ts (new home for reset script)
- Move behavior-audit-entrypoint.test.ts into behavior-audit/
- Move behavior-audit-interrupted-run.test.ts into behavior-audit/
- Move behavior-audit-incremental.test.ts into behavior-audit/
- Move behavior-audit-classify-agent.test.ts into behavior-audit/
- Move behavior-audit-storage.test.ts into behavior-audit/
- Move behavior-audit-phase1-keywords.test.ts into behavior-audit/
- Move behavior-audit-phase1-selection.test.ts into behavior-audit/
- Move behavior-audit-phase1-write-failure.test.ts into behavior-audit/
- Move behavior-audit-phase2a.test.ts into behavior-audit/
- Update in-place test imports to new behavior-audit module paths
- Delete top-level behavior-audit barrel and source files (moved into behavior-audit/)
- Update package.json and knip.jsonc for consolidated behavior-audit layout

### Documentation

- **calendar-sync:** Remove rrule-parser coupling after unification
- **system-prompt:** Align RECURRING TASKS section to RRULE vocabulary
- Add security hardening design spec for opencode-tps-meter plugin
- Self-review fixes for tps-meter security spec
- Add implementation plan for tps-meter security hardening
- **behavior-audit:** Add phase2 redesign spec and plan
- Review-loop enhancements design spec
- Review-loop enhancements implementation plan
- Review-loop config fix and progress logging design spec
- Review-loop config fix and progress logging implementation plan
- **research:** Add prompt-optimization research report
- **research:** Refine prompt-optimization report formatting
- Add behavior-audit legacy cleanup plan, reformat stale hybrid-to-artifact plan
- Revise plugin system implementation plan
- Address plugin plan review feedback
- Add behavior audit keyword consolidation design spec
- Clarify codeindex search workflow
- Expand pi migration plan with superpowers skills and TPS meter; add behavior-audit consolidation plan
- Update consolidation plan to match current codebase state

### Fixed

- **audit:** Apply lint fixes and formatting to audit pipeline files
- **recurring:** Persist timezone when updating recurring task schedule
- **recurrence:** Stabilize RRULE schedule updates
- **audit:** Keep incremental behavior reruns consistent
- **opencode:** Preserve session ids for idle rechecks
- **codeindex:** Finalize validation follow-ups
- **codeindex:** Commit updated bun.lock with workspace deps
- **codeindex:** Improve reference extraction and reorganize tests
- **codeindex:** Tighten tier1 symbol indexing and resolution
- **review-loop:** Correct agent commands and model IDs in example config
- **behavior-audit:** Make rebuild tolerate stale manifest metadata
- **behavior-audit:** Reject empty normalized keywords
- **behavior-audit:** Reset evaluated artifacts with downstream phases
- **behavior-audit:** Tighten phase3 selection and clear stale failures
- **lint:** Eliminate all no-conditional-in-test violations across test suite
- **lint:** Fix unsafe-array-assignment in behavior-audit-phase-stats test
- **tests:** Make recurring missed-dates test time-independent
- Align code symbol lookup with exact matches
- **behavior-audit:** Tighten keyword range and clear embedding base URL default
- **behavior-audit:** Prevent artifact filename collisions and parallelize processing
- **behavior-audit:** Unify attributed progress reporting

### Miscellaneous

- **audit:** Add CONSOLIDATED_DIR + PHASE3_TIMEOUT_MS to config
- Add rrule-temporal dependency
- **repo:** Capture planning updates and harden safe fetch
- **knip:** Register review-loop workspace entries and cover formatSummary

### Styling

- **review-loop:** Apply formatter fixes

### Testing

- **recurrence:** Add cron vs rrule facade equivalence oracle
- **behavior-audit:** Split integration test support helpers
- **behavior-audit:** Split phase1 keyword scenarios
- **behavior-audit:** Split storage and reset scenarios
- **behavior-audit:** Split phase2 and phase3 scenarios
- **behavior-audit:** Stabilize audit suite migration
- **behavior-audit:** Replace remaining avoidable module mocks
- **behavior-audit:** Reload config for injected classify defaults
- **review-loop:** Add log mock to all runReviewLoop calls
- **behavior-audit:** Cover vocabulary migration on load
- **behavior-audit:** Fix phase3 reset regression coverage

### WIP

- Refactor(tests): DRY duplicate test code (Tasks 1-2)

### Build

- **review-loop:** Scaffold empty workspace

### Guardrails

- Block git checkout -- in both Claude Code and OpenCode hooks
## [5.1.3] - 2026-04-20

### Added

- Add readable group and user labels to /group and /groups commands
- Implement deferred prompt delivery targets

### Documentation

- Add rrule-temporal adoption spec and implementation plan
- Add readable label design and implementation plan
- Add deferred prompt delivery design and plan
- **codeindex:** Update tier1 implementation plan and design spec
- Add debug dashboard expansion design spec

### Fixed

- **opencode:** Use session.idle hook instead of non-existent session.stop
- Restore local check suite
- Scope /groups user label cache by context
- Preserve @username labels for Discord users
- Preserve Discord guild lookups on channel cache misses
- Keep group label lookups best-effort
- Bound group label lookups
- Include @username when Discord labels match
- Resolve pre-existing test failures in debug-server and behavior-audit suites
- Preserve deferred prompt usernames for personal mentions
- Keep deferred prompt delivery semantics isolated
- Align deferred proactive state with delivery context
- Honor Telegram ID mentions for deferred delivery
- Keep deferred prompts retryable on Discord send failures
- Normalize shared deferred prompt batching
- Honor Mattermost deferred delivery mentions

### Merge

- Sync readable-labels branch with origin/master
## [5.1.2] - 2026-04-18

### Changed

- **opencode:** Update TDD plugin to match ADR-0070 silent post hooks + stop gate

### Documentation

- Add ADRs for behavior audit, group Kaneo provisioning, sensitive message cleanup, and Discord thread capabilities
- Move completed specs and plans to archive, add ADRs 77-78

### Fixed

- Replace unsafe object cloning with Proxy for observed chat provider
- Address PR #95 review comments
## [5.1.1] - 2026-04-18

### Added

- Export isSensitiveKey helper from config module
- Add messages.delete capability and deleteMessage to ReplyFn
- Implement deleteMessage in Mattermost adapter
- Mask sensitive values in config editor confirmation, add isSensitiveKey flag
- Add isSensitiveKey flag to wizard process results
- Delete or warn after sensitive config editor input
- Delete or warn after sensitive wizard input
- Pass messageId to setup flow integration functions
- Add upfront warning on platforms without message deletion
## [5.1.0] - 2026-04-18

### Added

- **behavior-audit:** Add incremental manifest schema
- **behavior-audit:** Persist lastStartCommit at run start
- **behavior-audit:** Collect changed files for incremental selection
- **behavior-audit:** Add incremental manifest reruns
- **db:** Add recurring ownership foreign keys
- **groups:** Gate group access behind allowlists

### Documentation

- Add calendar sync design spec (Google Calendar + Apple Calendar via tsdav)
- Add calendar sync implementation plan (17 tasks)
- Add sensitive message cleanup design spec
- Add sensitive message cleanup implementation plan

### Fixed

- **behavior-audit:** Surface corrupt manifest state
- **behavior-audit:** Write manifest atomically

### Miscellaneous

- **opencode:** Bump plugin and refresh cleanup plan

### Testing

- **behavior-audit:** Narrow task 3 startup coverage
## [5.0.1] - 2026-04-16

### Added

- **chat:** Add reply replacement methods
- **interactions:** Replace selector menus in place
- **interactions:** Replace config and wizard menus in place
- **telegram:** Add menu replacement reply helpers
- **telegram:** Expose interaction menu replacement replies
- **discord:** Add interaction menu replacement replies
- **discord:** Wire menu replacement to clicked interaction message
- **youtrack:** Add comment pagination controls
- **bot:** Record group observations for command handlers; archive completed plans as ADRs
- **youtrack:** Add work-item pagination controls
- **youtrack:** Add search pagination controls
- **behavior-audit:** Add two-phase AI agent script for UX evaluation

### Documentation

- **plans:** Archive completed work and add planning notes

### Fixed

- **telegram:** Clear buttons on text menu replacement
- **telegram:** Limit menu replacement to callback replies
- **discord:** Gate menu replacement on editable messages
- **youtrack:** Handle offset-only comment pagination
- **youtrack:** Handle offset-only work-item pagination
- **youtrack:** Preserve high-offset pagination
- **search:** Honor offset across providers
- **search:** Apply offset after kaneo assignee filtering
- **youtrack:** Finalize remaining parity gaps

### Testing

- **chat:** Specify reply replacement semantics
- **discord:** Cover replacement fallback behavior
- **interactions:** Verify menu replacement flows
## [5.0.0] - 2026-04-15

### Added

- **chat:** Add ThreadCapabilities type and threadId to IncomingMessage
- **telegram:** Implement forum topic creation on mention
- **bot:** Implement thread-scoped storage context IDs
- **tools:** Add lookup_group_history tool
- **thread-aware-group-chat:** Complete implementation
- Add userIdentityMappings table for identity resolution
- Add identity types module
- Add identity mapping CRUD operations
- Add identity resolver with auto-link support
- Add natural language identity detection
- Add Kaneo identity resolver implementation
- **identity:** Update mapping module with type guards
- **kaneo:** Add identity resolver and users operations
- Add set_my_identity tool for NL identity claiming
- Add clear_my_identity tool for NL identity denial
- Add identity tools to toolset
- Add identity resolution to create_task tool
- Add identity resolution to update_task tool
- Add identity resolution to search_tasks tool
- Add identity resolution to list_tasks tool
- Add identity resolution to watcher tools
- Add identity resolution to watcher tools
- Wire up identity resolvers to Kaneo and YouTrack providers
- **chat:** Add ResolveUserContext and extend ChatProvider.resolveUserId signature
- **chat/discord:** Scaffold DiscordChatProvider with env validation
- **chat/registry:** Register discord provider
- Add validateChatProviderEnv with discord support
- **chat/discord:** Add stripBotMention and isBotMentioned helpers
- **chat/discord:** Add mapDiscordMessage with bot/type filters
- **chat/discord:** Add buildDiscordReplyContext with REST fallback
- **chat/discord:** Add chunkForDiscord and formatLlmOutput
- **chat/discord:** Add reply helpers — typing indicator, buttons, ReplyFn
- **chat/discord:** Wire registerCommand, onMessage, and message dispatch
- **chat/discord:** Implement sendMessage and resolveUserId
- **commands/help:** Extract buildHelpText and append Discord deferral note
- **wizard:** Re-export state, engine, and save functions for Discord handler
- **chat/discord:** Implement start() and button interaction dispatch
- **chat:** Add chat capability metadata
- **chat:** Add provider-agnostic interaction routing
- **chat:** Gate command menu, config, context, and group on chat capabilities
- **message-queue:** Add QueueItem and CoalescedItem types
- **message-queue:** Implement QueueRegistry with TTL cleanup
- **message-queue:** Add public API with enqueueMessage and flushOnShutdown
- **bot:** Integrate message queue into handleMessage
- **index:** Add graceful shutdown hook to flush message queues
- Implement per-context message queue with coalescing
- Add thread-scoped storage context and forum status caching
- **tools:** Add chatUserId to MakeToolsOptions for identity isolation
- **tools:** Update buildTools and identity tools to use chatUserId
- **orchestrator:** Thread chatUserId through to makeTools
- Use preferredUserIdentifier for identity resolution
- **tools:** Update makeTools to use chatUserId for identity isolation
- **deferred-prompts:** Pass chatUserId in proactive LLM
- **identity:** Wire auto-link flow on first group chat interaction
- **identity:** Complete chat user ID isolation and auto-link flow
- Add Discord interaction mapping helpers
- **scripts:** Scaffold ACP review loop CLI
- **scripts:** Add review-loop issue contracts and ledger
- **scripts:** Add ACP subprocess wrapper
- **scripts:** Add review-loop policy and prompt helpers
- **scripts:** Automate ACP review loop
- **group-settings:** Add registry persistence
- **chat:** Capture group display metadata
- **group-settings:** Add access checks and observations
- **group-settings:** Add DM selector state machine
- **group-settings:** Wire config selector flow
- **group-settings:** Wire setup selector flow
- Add web fetch error model
- Add web fetch database tables
- Add web fetch URL normalization and quota
- Add Bun-compatible safe web fetch
- Add web content extraction helpers
- Add web fetch cache and distillation
- Add web fetch orchestration
- Wire web fetch tool and prompt guidance
- **context:** Implement context command redesign with token counting and platform rendering
- Add tool execution wrapper helper
- Wrap all tool executions with error handler
- Add pre-flight tool result validation
- Integrate tool result validation before LLM calls
- Complete missing tool results error prevention system
- Add Mattermost typing indicator and YouTrack custom field validation
- Add YouTrack workflow validation and custom fields support
- Expose youtrack agile and sprint tools
- Expose youtrack history and saved query tools
- Surface honest youtrack custom field support
- Add youtrack command tool
- **hooks:** Add needsRecheck flag to SessionState
- **hooks:** Add check output parser for concise failure summaries
- **hooks:** Concise failure summary from check:full output
- **hooks:** Add Stop hook with full-check gate and interrupt escape hatch
- **hooks:** Register Stop hook in settings

### Changed

- Update tools index and tests for identity resolution
- **providers:** Rename Capability to TaskCapability
- **providers:** Fix blank lines around Capability alias and remove tautological test
- **providers:** Restore interface spacing and merge split type imports
- **chat:** Remove wizard platform branching
- **providers:** Drop deprecated capability alias
- **tools:** Convert makeTools to options object pattern with storageContextId
- **search:** Use assigneeId filter with proper 'me' resolution
- **discord:** Use mapping approach for interaction handlers, fix threadId import, update help text
- **review-loop:** Replace while-loop with recursion, drop lint overrides
- Extract Discord button dispatch and add auth to interaction routing
- Extract orchestrator error handling into modular support modules
- **group-settings:** Extract dispatchGroupSelectorResult and fix admin throttle
- **hooks:** Remove baseline/surface from PreToolUse, add needsRecheck flag
- **hooks:** Remove per-edit test run and surface diff from PostToolUse

### Documentation

- Add provider capability architecture design and plan
- Sync CLAUDE.md and README.md with codebase
- Add e2e planning workflow design
- **env:** Add Discord block to .env.example
- **CLAUDE:** Document Discord chat provider
- Add /context command redesign spec
- Add /context command redesign implementation plan
- Add e2e planning workflow guide
- Add e2e test plan template
- Link e2e planning workflow
- Finish e2e planning workflow rollout
- Clarify e2e plan filename
- **chat:** Clarify resolveUserId contract and Telegram passthrough semantics
- **plugins:** Align plugin plans with provider capabilities
- Add planning documents for message queue and group DM settings
- Add file attachments design
- Add Discord capability alignment design
- Archive completed plans and add new ADRs
- Add web fetch MVP design
- Add ACP review automation design
- **help:** Describe DM-only group settings
- Refine E2E planning ADR, add excluded scope and backend quirks sections
- Add multi-provider router design spec
- Add proactive group messaging design spec
- Add codeindex Tier 1 design spec
- Refresh README and CLAUDE guidance
- Tighten codeindex Tier 1 design
- Add codeindex Tier 1 implementation plan
- **superpowers:** Add YouTrack tool parity checklist plan
- Add youtrack bulk command confirmation design
- Add bulk youtrack confirmation plan
- Update youtrack bulk command safety design
- Add youtrack bulk command safety plan
- Add stop-gated check plan

### Fixed

- **youtrack:** Allow null values for resolved field in IssueListSchema
- **lint:** Resolve oxlint errors across codebase
- **chat/discord:** Escape botId in mention regex to prevent ReDoS
- **discord:** Reserve space for fence operations to prevent chunk overflow
- **discord:** Catch event-listener rejections; wire env-validation into registry
- **chat:** Address Task 2 review issues — contract, immutability, signatures
- **chat:** Narrow Task 2 follow-up — remove premature interactions.callbacks, read-only sets, expand mock defaults
- **chat/telegram:** Remove routeInteraction fallback from callback dispatch
- **chat:** Address task 3 review follow-ups
- **task4:** Separate buttonCalls from textCalls in createMockReply; add error boundary in setupBot onInteraction
- **chat:** Correct config fallback guidance
- Add readonly modifiers and expand test coverage for message queue types
- **message-queue:** Add pino logging to MessageQueue
- Update lastAccessed on get and add tests
- **security:** Isolate identity mappings by chatUserId in group chats
- Remove accidentally merged web-fetch-mvp.md
- **review-loop:** Resolve config paths deterministically
- **review-loop:** Remove planPath from config
- Persist review-loop session pointers
- **review-loop:** Preserve already_fixed verdicts
- **scripts:** Harden review-loop task 2 state
- **scripts:** Harden ACP session bootstrap
- **scripts:** Harden review-loop permissions
- **scripts:** Finalize ACP review loop
- Make web fetch quota atomic
- Classify safe fetch errors
- Map safe fetch timeouts
- Harden safe fetch validation
- Classify safe fetch failures
- Tighten safe fetch SSRF checks
- Normalize safe fetch content types
- Harden web distillation fallback
- Harden web fetch orchestration
- Improve Discord adapter mention detection, code block chunking, and button dispatch
- **message-queue:** Add cleanup, timeout handling, and sequential execution
- Remove unused ToolErrorResult interface
- Address PR review comments from #92
- Prevent recording group observations for ignored non-mentioned messages
- Render static markdown messages correctly on Telegram
- Align YouTrack tools with provider behavior
- Validate and paginate YouTrack sprint operations
- Reject impossible YouTrack sprint datetimes
- Validate youtrack history and saved queries
- Classify missing youtrack saved queries
- Preserve youtrack query ids and history timestamps
- Classify missing youtrack sprint assignment lookup
- Validate update_task custom fields safely
- Align custom field guardrails
- Honor explicit custom field support
- Gate destructive youtrack commands
- Harden youtrack command tool input
- Broaden youtrack command safeguards
- Tighten youtrack command safety gating
- Lock down youtrack command confirmation gating
- Tighten youtrack command confirmation safeguards
- Disable bulk youtrack commands
- Clarify single-issue youtrack command contract
- Enforce single-issue youtrack command input
- Restore bulk youtrack validation path
- Clarify youtrack taskIds contract
- Centralize provider due date normalization

### Miscellaneous

- Update dependencies and design docs
- Knip config for intentionally exported identity functions
- **deps:** Add discord.js ^14.25.1
- **knip:** Ignore env-validation.ts (entry-point side-effect boundary)
- **opencode:** Bump @opencode-ai/plugin to 1.4.3
- Remove archived docs and unused .semgrep config
- Merge origin/master into acp-review-automation
- Remove unused exports flagged by knip
- **guardrails:** Prevent git stash usage in Claude/opencode hooks
- Disable prefer-readonly-parameter-types and fix queue typing spy
- Clean up youtrack bulk command plans and update opencode plugin

### Testing

- **db:** Update schema and migration tests for identity mappings
- **commands:** Fix /config assertions to use buttonCalls
- **tools:** Add chatUserId isolation tests for identity tools
- **review-loop:** Cover resolved config paths
- Hermetic review-loop cwd override
- Add Mattermost metadata tests and interaction router coverage
- Strengthen web fetch db coverage
- Tighten extraction helper coverage
- Cover web fetch tool failures
- Add web fetch integration coverage
- Strengthen web fetch integration coverage

### Build

- Prepare web fetch dependencies and tests
- Prepare web fetch dependencies and tests

### Review-loop

- Harden permission policy, skip terminal issues, and cleanup
## [4.9.0] - 2026-04-09

### Added

- **kaneo:** Add list_tasks filter params matching @kaneo/mcp
- **youtrack:** Implement getComment operation
- **youtrack:** Implement deleteProject via DELETE /api/admin/projects/{id}
- **youtrack:** Extend ISSUE_FIELDS with reporter, updater, votes, attachments, parent, subtasks
- **youtrack:** Complete Phase 1 - bug fixes and extended field coverage
- **youtrack:** Add bundle schemas for state management
- **youtrack:** Add bundle cache for state management
- **tools:** Update status tools with shared bundle confirmation
- **youtrack:** Complete Phase 2 - statuses and custom fields
- **youtrack:** Complete phase 3
- **youtrack:** Complete phase 5 - sprints, activities, saved queries, count_tasks

### Changed

- **kaneo:** Sync update-task with official @kaneo/mcp flow
- **youtrack:** Switch relations to REST API /links endpoint

### Documentation

- Design for full YouTrack API coverage in tools
- Add enhanced YouTrack full API design with error handling and observability
- Add YouTrack full API implementation plan with TDD tasks
- Add user profile memory design (Phase A)
- Add user profile memory implementation plan (Phase A)
- Mark YouTrack Phase 2 cleanup as complete

### Fixed

- **youtrack:** Use project shortName in search queries and add created field to list
- **youtrack:** Send color in updateLabel request body
- **youtrack:** Properly type Attachment on Task
- **youtrack:** Add numberInProject and resolved to ISSUE_LIST_FIELDS
- **youtrack:** Remove unused YouTrackAttachment type export
- **youtrack:** Address relation type and timestamp schema issues
- Replace unsafe type assertion in relations.test.ts
- Use proper type guard in users.test.ts
- Use proper type guards in work-items.test.ts
- Update import and fix unsafe type assertions in statuses.test.ts
- Replace unsafe type assertions with satisfies in mappers.test.ts
- **youtrack:** Address code review issues #4, #5, #7, #8
- Use correct config key and improve error handling

### Miscellaneous

- Re-enable no-unsafe-type-assertion and no-unsafe-argument lint rules
- Remove knip ignoreIssues for bundle-cache.ts

### Testing

- Fix pre-existing failing tests in llm-orchestrator and tool tests
- Create test helper for clearBundleCache, update bundle-cache.test.ts import
- Update index.test.ts to use test helper for clearBundleCache
## [4.8.7] - 2026-04-08

### Added

- **kaneo:** Add list_tasks filter params matching @kaneo/mcp

### Changed

- **kaneo:** Sync update-task with official @kaneo/mcp flow

### Fixed

- **youtrack:** Use project shortName in search queries and add created field to list

### Testing

- Fix pre-existing failing tests in llm-orchestrator and tool tests

### Revert

- Migrate back from streamText to generateText
## [4.8.6] - 2026-04-07

### Changed

- Migrate deferred prompts and proactive LLM from generateText to streamText
## [4.8.5] - 2026-04-07

### Changed

- Extract LLM event functions to reduce file size
## [4.8.4] - 2026-04-07

### Added

- Add get_current_time tool for KV cache efficiency
## [4.8.3] - 2026-04-07

### Changed

- Simplify LLM timeouts to flat 20-minute totalMs
## [4.8.2] - 2026-04-07

### Added

- Add LLM timeout limits to proactive and memory generateText calls
## [4.8.1] - 2026-04-07

### Added

- **debug:** Expand dashboard log buffer, history, and trace step details

### Fixed

- Resolve username to user ID in Mattermost group commands

### Ci

- Disable mutation testing in CI
## [4.8.0] - 2026-04-06

### Added

- **debug:** Add LLM trace detail modal and enhance dashboard UI
- Add client build script and test
- Extend TDD hooks to recognize client/ and scripts/ source roots
- Create single entry point and update HTML
- Add happy-dom test setup preload
- Add build:client and test:client scripts
- Remove archive tools, add delete-project tool

### Changed

- Move client source files to client/debug/
- Update imports in moved client/debug files
- Use @happy-dom/global-registrator for canonical DOM setup
- Move client tests to tests/client/debug/
- Serve dashboard from pre-built public/ directory

### Documentation

- Add client build pipeline design
- Add client build pipeline implementation plan
- Update CLAUDE.md for client build pipeline

### Fixed

- Handle flat tests/client/ paths in resolveImplPath

### Miscellaneous

- Add happy-dom and gitignore public/
- Add test:client to check:full pipeline
- Add client build stage to Dockerfile
- Extend knip scope to client/ and remove dead search module

### Testing

- Adapt smoke tests for single-bundle serving

### Ci

- Add build job for client assets
- Drop unused build artifact dependency from e2e and mutation jobs
## [4.7.8] - 2026-04-05

### Added

- **tdd:** Add import verification to prevent test bypass

### Changed

- **llm:** Add deps parameter to processMessage for DI testing
- Add deps parameters to conversation, memory, embeddings, proactive-llm
- Add DI to completion-hook, create-recurring-task, announcements, task-status; remove db/index and changelog-reader from mock-reset
- Add DI to bot, admin commands, and scheduler; remove registry and llm-orchestrator from mock-reset
- Add DI to remaining recurring tool factories (delete, update, pause, skip, list, resume)
- Remove test-only exports from source modules

### Documentation

- **test-helpers:** Document beforeEach usage pattern for mock helpers
- **tests:** Update CLAUDE.md for global mock reset pattern
- Update testing conventions with DI pattern documentation

### Fixed

- Mark setSchedulerDeps as @public for knip unused-export check
- Update mockDrizzle docstring and remove empty beforeEach

### Miscellaneous

- Remove test-health check (superseded by global mock reset)
- Remove superseded spyOn migration plan document

### Testing

- Add global mock reset preload to eliminate mock pollution
- Move mock helpers to beforeEach in tools/db/commands tests
- Move mock helpers to beforeEach in providers/message-cache/chat tests
- Move mock helpers to beforeEach in remaining helper-only files
- Move drizzle mock.module to beforeEach in simple inline mock files
- Move AI SDK mock.module to beforeEach
- Move complex multi-mock files to beforeEach pattern
- Move remaining inline mock.module calls to beforeEach
- Extract duplicated mock setup to file-level beforeEach
- **helpers:** Replace mockDrizzle mock.module with _setDrizzleDb setter
- Remove mockDrizzle calls (setupTestDb auto-sets drizzle)
- Replace drizzle mock.module with _setDrizzleDb in all test files
- Remove drizzle from mock-reset (DI migration complete for drizzle)
- Remove vestigial db/index mock.module (exports don't exist)
## [4.7.7] - 2026-04-04

### Documentation

- Add ADR-0047 for session-level mutation testing rejection
- Add ADRs for completed features and clean up code
- Add mock pollution elimination design and implementation plans

### Fixed

- **debug:** Fix dashboard browser errors and add smoke tests
- **debug:** Improve dashboard initialization and update tests
- Send welcome message after demo mode auto-provisioning
## [4.7.6] - 2026-04-04

### Added

- **kaneo:** Generate unique email addresses and slugs per registration

### Changed

- **config:** Replace wizard-hijack with standalone config-editor
- **tdd:** Remove dead code from mutation testing utilities
- **tdd:** Remove session-level mutation baseline from hooks

### Fixed

- Resolve explicit-function-return-type and no-unnecessary-type-arguments lint errors
- Prevent TDD hook from sending prompts when user interrupts session
- /user remove now correctly reports when user doesn't exist

### Testing

- **commands:** Update admin tests for unique email format
## [4.7.5] - 2026-04-03

### Changed

- **announce:** Remove auth.allowed check, add p-limit, extract test helper
## [4.7.4] - 2026-04-02

### Fixed

- **deploy:** Add DEMO_MODE to CI workflow .env generation
## [4.7.3] - 2026-04-02

### Fixed

- **wizard:** Single-step edit confirmation was broken
- Skip wizard auto-start for demo users
- **deploy:** Transfer CADDY_ADDITIONAL_CONFIG via SCP instead of heredoc
## [4.7.2] - 2026-04-02

### Added

- **tdd:** Add Claude and Opencode TDD enforcement hooks
- **tdd:** Add pre-stop checks for uncommitted changes and check:full
- Add copyAdminLlmConfig for demo mode
- Auto-add unknown DM users in demo mode
- Copy admin LLM config after Kaneo provisioning in demo mode

### Changed

- **wizard:** Extract shared logger mock and improve test organization
- Rename test files to match src/ convention

### Documentation

- Add mock.module to spyOn migration plan
- **plan:** Update migration plan with current progress
- Add DEMO_MODE to .env.example

### Fixed

- Single field edit from /config and skip to keep existing values
- **plan:** Address 7 issues in demo auto-provision implementation plan
## [4.7.1] - 2026-03-31
## [4.7.0] - 2026-03-31

### Added

- **debug:** Add event bus with zero-overhead guard
- **debug:** Add state collector with lazy bus subscription
- **debug:** Add Bun.serve() debug server with SSE and dashboard
- **debug:** Wire debug server into startup and shutdown
- **wizard:** Add validation service skeleton
- **wizard:** Implement API key validation
- **wizard:** Add base URL validation
- **wizard:** Add model existence validation
- **wizard:** Update WizardStep type for async live validation
- **wizard:** Export validation service from index
- **wizard:** Add live validation to API key step
- **wizard:** Add live validation to base URL step
- **wizard:** Add live validation to model steps
- **wizard:** Integrate live validation into engine
- **wizard:** Add interactive button support for validation errors
- Interactive config editing with buttons and pre-filled values
- Auto-start setup wizard for new users on first interaction
- Add /start command with welcome message
- **debug:** Add log ring buffer with search and stream adapter
- **debug:** Add /logs and /logs/stats routes with ring buffer wiring
- **scheduler:** Add type definitions
- **scheduler:** Implement core scheduler with retries
- **scheduler:** Add cron expression support via Bun.cron
- **scheduler:** Add central scheduler instance with cleanup tasks
- **debug:** Add persistence accessors and getMessageCacheSnapshot facade
- **debug:** Add getSchedulerSnapshot and getPollerSnapshot facades
- **debug:** Add getWizardSnapshots and getSessionSnapshots facades
- **debug:** Rewrite state-collector with admin filtering and wire adminUserId
- **debug:** Instrument bot.ts and llm-orchestrator.ts with lifecycle events
- **debug:** Instrument cache, conversation, and wizard with lifecycle events
- **debug:** Instrument scheduler, poller, and message-cache with lifecycle events
- **debug:** Serve dashboard static files with Bun.build() transpilation
- **debug:** Complete dashboard HTML with live debug panels
- Add shared TDD core modules (test-resolver, session-state, test-runner)
- Add Claude Code TDD adapter hooks and settings
- Add OpenCode TDD enforcement plugin
- Add Pattern 4 detection for module-level mutable state
- Implement TDD enforcement hooks with pre/post tool validation
- **deploy:** Add debug and logging env vars, expose metrics port

### Changed

- **plan:** Derive WizardData from ConfigKey for single source of truth
- **plan:** Simplify validation logic for small_model and embedding_model steps
- **plan:** Convert wizard state to sync and remove unused files
- **wizard:** Validate at end instead of each step
- **wizard:** Improve UX and split into modules
- Extract large functions into modules without disabling lint rules
- Update YouTrack tests to use centralized mock helpers
- **debug:** Switch logger to pino.multistream for dynamic stream attachment
- **scheduler:** Fix lint violations and add unregister
- **message-cache:** Extract cleanup functions for scheduler
- **scheduler:** Migrate recurring task scheduler to use central scheduler
- **deferred-prompts:** Migrate to centralized scheduler
- **scheduler:** Extract methods to fix max-lines-per-function
- **scheduler:** Remove lint overrides and fix max-lines-per-function
- Rename mock-pollution to test-health script
- **debug:** Export stats/state objects, move resetStats to test helpers
- **tdd:** Fix code style in tdd-enforcement plugin and update SessionState instantiation
- **tdd:** Update surface extractor and related tests
- **tdd:** Complete session-level mutation testing optimization
- **tdd:** Fix mutation testing integration and session stop blocking
- Migrate mutation testing from per-file to session-level

### Documentation

- Add debug tracing tool design
- Add bot configuration UX design document
- Add bot configuration UX implementation plan
- Revise implementation plan with correct platform-agnostic architecture
- Add Session 1 event bus + server skeleton design
- Add Session 1 implementation plan
- **debug:** Align design doc with Session 1/2 implementation decisions
- Add file attachments research with caveats analysis
- Add scheduler utility design document
- Add scheduler utility implementation plan
- **debug:** Add Session 3 instrument source modules design
- **debug:** Add Session 3 implementation plan
- **debug:** Update design for client-side state management in Session 4
- **debug:** Add Session 4 dashboard HTML design
- **debug:** Add Session 4 dashboard HTML implementation plan
- Add LLM guidance research for large codebases
- Update .github/instructions and fix documentation formatting
- Add plugin system design document
- Add plugin system implementation plan
- Update TDD hooks integration plans and enhance Telegram reply context
- Add TDD enforcement protocol to CLAUDE.md, Copilot, and opencode

### Fixed

- **plan:** Store taskProvider in WizardSession instead of inferring from data
- **plan:** Don't intercept commands during active wizard
- **plan:** Use existing normalizeTimezone utility for timezone validation
- **plan:** Use storageContextId instead of contextId throughout wizard
- **plan:** Use text-based flow for Mattermost wizard instead of Interactive Dialogs
- **plan:** Use auth.storageContextId in bot.ts wizard integration
- **plan:** Remove async/await from sync wizard functions and use type guard
- **config:** Allow isConfigKey to validate all provider keys
- **wizard:** Save config under storageContextId and handle llm_baseurl default
- Remove typescript/no-unsafe-type-assertion override and fix tests
- **debug:** Make server log route tests resilient to logger mock pollution
- **debug:** Validate parseIntParam to ignore NaN query values
- **scheduler:** Use calculateBackoff helper to fix unused export
- **wizard:** Use TASK_PROVIDER env var instead of hardcoded 'kaneo'
- Increase Stryker timeout and reduce concurrency for CI
- Increase stryker bun runner timeout for CI
- Restore message cache from SQLite on startup
- Extract sender_name from Mattermost WebSocket events and deduplicate ONE_WEEK_MS constant
- Resolve lint errors in test-health script
- **tdd:** Correct input.args access and cwd-relative path resolution

### Miscellaneous

- Update readme
- **scheduler:** Final verification and cleanup

### Testing

- **plan:** Add fetch mocking to validation tests
- **debug:** Add log buffer unit tests (red)
- **debug:** Add log route integration tests (red)
- **scheduler:** Add integration tests for central scheduler
## [4.6.0] - 2026-03-27

### Added

- Redact sensitive values in /set command messages
- **db:** Add execution_metadata column to deferred prompt tables
- **schema:** Add executionMetadata column to scheduled and alert prompt tables
- **types:** Add ExecutionMetadata type and schema for deferred prompts
- **deferred:** Update row mappers and CRUD to handle executionMetadata
- **tools:** Add execution parameter to create/update deferred prompt tools
- **deferred:** Implement execution mode dispatch with lightweight, context, and full modes
- **poller:** Use dispatchExecution for mode-aware deferred prompt execution
- Implement in-memory message cache
- Add SQLite persistence for message cache
- Implement reply chain builder
- **telegram:** Extract and cache reply metadata
- **mattermost:** Add root_id and parent_id to post schema
- **mattermost:** Cache incoming messages and populate replyToMessageId
- **llm-orchestrator:** Add detailed APICallError logging for production debugging
- Implement personal memory & recall (Phase 06)
- Add message reply and quote context awareness

### Changed

- **deferred:** Remove invokeLlmWithHistory backward compat wrapper
- Extract DB cleanup interval into explicit startup function
- **mattermost:** Export extractReplyId and MattermostPostSchema
- Remove test-only exports from message-cache source

### Documentation

- Add deferred prompt execution modes design
- Add execution modes implementation plan
- Add design for message reply and quote context
- Add implementation plan for message reply and quote context
- **adr:** Add ADRs 0033, 0034 and 0008 for deferred prompts and architecture
- **plans:** Archive completed proactive and deferred prompt plans to done/
- **plans:** Update existing plans for memory recall and reply context
- **plans:** Remove plans moved to done/ archive
- **user-stories:** Add repo integration user stories
- Add Mattermost reply chain implementation design
- Add Mattermost reply chain implementation plan
- Add project logo and update README

### Fixed

- **test:** Remove unsafe type assertions in execution-modes tests
- **deferred:** Load history before appending in lightweight mode
- **test:** Close previous DB before creating new one in migration tests
- **plan:** Correct migration system instructions
- **plan:** Correct Drizzle onConflictDoUpdate syntax
- **plan:** Make all Drizzle operations synchronous
- **plan:** Use scoped child loggers
- **plan:** Add scheduled cleanup for expired messages
- **plan:** Align Task 8 with actual class-based extractMessage
- **security:** Use registry rule pack instead of deprecated ai-best-practices repo
- Use composite key (context_id, message_id) for message_metadata
- Schedule retry flush after persistence failure
- Add periodic sweep for expired message cache entries
- **tests:** Test real cache implementation by mocking only DB dependency
- Address review findings for memo feature
- Address review feedback from pullrequestreview-4016459408
- Refine auto-mode fallback and clarify archiveMemos doc comment
- **tests:** Resolve mock pollution in conversation tests

### Miscellaneous

- **security:** Remove unused .semgrep/config.yml
- Increate mutation testing concurrency
- Remove @public from buildReplyChain (now used by reply-context)

### Testing

- **migration:** Add tests for execution_metadata column migration
- **deferred:** Add failing tests for execution mode dispatch
- **tools:** Add tests for execution parameter on deferred prompt tools
- Add integration tests, fix knip unused exports
- **mattermost:** Add schema parsing tests for reply fields
- **mattermost:** Add reply chain extraction tests

### Db

- Add message_metadata table for reply chain tracking

### Design

- Telegram reply chain infrastructure for message context

### Plan

- Add implementation plan for telegram reply chain infrastructure

### Types

- Add CachedMessage and MessageMetadataRow types
## [Unreleased]

### Added

- **chat:** Message reply and quote context awareness
  - Bot captures when users reply to or quote messages
  - Parent message context included in LLM prompts
  - Reply chain summaries for multi-level threads
  - Bot responses thread correctly in Telegram and Mattermost
- **types:** `ReplyContext` and `ReplyOptions` types for reply chain tracking

## [4.5.1] - 2026-03-25

### Added

- **tools:** Add ToolMode to gate deferred prompt tools in proactive execution
- **deferred:** Use proactive mode to exclude scheduling tools during delivery
- **deferred:** Rewrite proactive trigger with spotlighting and delivery mode framing
- **prompt:** Rewrite PROACTIVE MODE and add PROMPT CONTENT guidance for deferred prompts
- **deferred:** Improve prompt field description to guide deliverable content

### Changed

- **prompt:** Remove timezone disclosure and conversion instructions from system prompt

### Documentation

- Add proactive delivery mode design for recursive scheduling fix
- Add proactive delivery mode implementation plan

### Fixed

- **utils:** Weekly schedule without days now defaults to Monday
- **utils:** LocalDatetimeToUtc now handles empty-string timezone via try/catch
- **tools:** Remove duplicate ToolMode declaration

### Miscellaneous

- Move completed datetime review fixes plan to done
- Add timezone ADR and move completed plans to done

### Styling

- **tools:** Move ToolMode declaration after imports

### Testing

- **utils:** Add DST transition tests for localDatetimeToUtc
## [4.5.0] - 2026-03-25

### Added

- Implement background events for deferred prompts
- **utils:** Add localDatetimeToUtc, semanticScheduleToCron, and utcToLocal utilities
- **tools:** Accept structured dueDate in create-task and convert local time to UTC
- **tools:** Accept structured dueDate in update-task and convert local time to UTC
- **tools:** Thread userId through makeCoreTools; convert UTC dueDate to local in get-task and list-tasks
- **tools:** Replace raw cronExpression with semantic schedule in create-recurring-task
- **tools:** Replace raw cronExpression with semantic schedule in update-recurring-task
- **tools:** Convert UTC nextRun/lastRun to local time in list, resume, and skip recurring task returns
- **deferred-prompts:** Accept local datetime for fire_at; convert to UTC in tool
- Add transitive import detection for mock pollution
- Add source file scanner for import graph building
- Add transitive mock pollution detection
- **background-events:** Implement polling and event processing

### Changed

- Proactive AI agent — use conversation history, locking, and natural prompts
- Extract shared system prompt builder for consistent proactive/interactive behavior
- **deferred-prompts:** Address review feedback
- **prompt:** Remove timezone disclosure and conversion instructions from system prompt
- **poller:** Use BuildProviderFn factory instead of direct TaskProvider

### Documentation

- Add background events design for deferred prompt history integration
- Add background events implementation plan
- Add afterEach cleanup guideline for mock pollution

### Fixed

- Address PR #64 review comments — deferred marking, failure handling, tests
- Persist memory facts from proactive tool results
- Add afterAll mock.restore to prevent transitive pollution
- Restrict Pattern 1 victims to test files only
- **instructions:** Propagate createdAt timestamp from cache to DB sync
- **tests:** Mock providers/factory.js instead of registry.js in orchestrator tests; add timezone guard in proactive-llm

### Miscellaneous

- Add date-fns and date-fns-tz dependencies
- Finalize workflow improvements and documentation
- Remove unused LocalDatetime type export
- Disable max-lines lint rule for scripts directory
## [4.4.0] - 2026-03-24

### Added

- Add migration 013 for deferred prompts tables
- Add deferred prompt types and alert condition Zod schema
- Implement task snapshot management for change detection
- Implement 5 unified deferred prompt LLM tools
- Implement deferred prompt LLM tools and polling loops
- Add deferred-prompts barrel export
- Wire deferred prompt pollers into bot startup/shutdown
- Add --staged flag to check-quiet script
- Add timezone validation for /set timezone command

### Changed

- Remove old proactive system, update schema with deferred prompt tables
- Remove unused deferred-prompts barrel export and knip ignore
- Add concurrency limit (5) for parallel LLM invocations
- Replace custom concurrency limiter with p-limit
- Remove redundant condition validation from CRUD layer
- Replace raw SQL datetime arithmetic with JS filtering

### Documentation

- Add deferred prompts design document
- Rewrite deferred prompts implementation plan
- Update documentation to reflect check-quiet and correct check command list
- Add --staged flag documentation to CLAUDE.md
- Update roadmap Phase 7 to reflect deferred prompts, add 7b for provider-gated fields
- Update ADR status and clean up completed implementation plans
- Archive outdated documents and add ADR 0031

### Fixed

- Safer configure_briefing/configure_alerts, clarify design doc as future work
- Register migration 013 in runtime migration list
- Resolve Drizzle type error in getScheduledPromptsDue
- Wire deferred prompt tools into makeTools, fix knip issues
- **scripts:** Address shell script security and robustness issues
- Replace N+1 task fetching with per-project listTasks approach
- Add userId ownership checks to advanceScheduledPrompt and completeScheduledPrompt
- Add explicit return types to tool execute functions
- **scripts:** Fix word splitting and shell portability issues in check-quiet.sh
- Validate value presence for operators that require it
- Update capturedAt on snapshot upsert
- Remove task.updatedAt from condition fields — providers don't supply it
- Add searchTasks fallback when provider lacks projects.list
- Prune stale snapshots for deleted tasks on each poll cycle
- Add userId ownership check to updateAlertTriggerTime
- Add concurrency limit (10) for user-level alert fan-out
- **tests:** Include getLogLevel in logger mock to prevent mock pollution
- Address PR review feedback from pullrequestreview-3997096442
- Log actual prompt and response to history, not metadata

### Miscellaneous

- Add check-quiet script to package.json
- Upgrade TypeScript to v6.0.2

### Security

- Sanitize condition values in describeCondition for LLM prompts
## [4.3.0] - 2026-03-23

### Added

- Add recurring task occurrences tracking and completion hook
- Implement Phase 07 — proactive assistance
- **scripts:** Add static analyzer for Bun test mock pollution
- **proactive:** Implement Phase 07 review fixes
- Implement custom instructions (save/list/delete via LLM tools)

### Changed

- **scripts:** Replace regex/string analysis with TypeScript AST

### Documentation

- Restore implemented plans and add Architecture Decision Records
- Archive completed plans and add ADRs 0017-0020
- Add test improvement roadmap and phase plans
- Add mock pollution prevention rules to CLAUDE.md
- Add custom instructions feature design
- Add custom instructions implementation plan

### Fixed

- Replace mock.spy with spyOn in scheduler test
- **tests:** Rewrite false-confidence tests to actually test production code
- **tests:** Rewrite processMessage tests to eliminate mock pollution
- **tests:** Stop mocking tools/index.js to fix YouTrack tools-integration
- **tests:** Eliminate mock pollution from bot-auth and recurring-tools test files
- **tests:** Resolve all mock pollution warnings, enable strict mode
- **tests:** Add mock.restore() cleanup to prevent mock pollution
- **tests:** Eliminate mock pollution by removing high-level module mocks
- Address PR #45 review comments — timestamps, validation, error consistency, test reliability
- Replace Output.object() with prompt-based JSON parsing for model compatibility
- Improve scheduler observability and fix test mock types
- **telegram:** Resolve start() blocking forever preventing post-startup tasks
- Implement Phase 6 test infrastructure & isolation improvements
- Improve test isolation and standardize mock patterns (Phase 6)
- Align listColumns mock signature with real options object API
- Normalize instruction text, enforce max length, strip createdAt from list output

### Miscellaneous

- Switch stryker to native bun test runner

### Testing

- Increase mutation score to 30.28% (Phase 1)
- **youtrack:** Add operations and labels tests (Phase 2)
- Implement Phase 2 test plan — fill critical module gaps
- **scripts:** Add integration tests for check-mock-pollution
- Implement Phase 3 schema validation and test reliability improvements
- Implement Phase 4 common-sense scenario gap tests (~41 new tests)

### Ci

- Disable mutation testing on pull requests
## [4.2.0] - 2026-03-21

### Added

- Implement Phase 01 YouTrack error classification (context, network detection, tests)
- Implement Phase 04 (CI trigger, delete task tests, confirmation gate tests)
- Implement Phase 05 (admin, bot-auth, set, config command handler tests)
- Implement recurring work automation (Phase 8)
- Add mutation testing thresholds and progress reporter
- Add timezone config key for recurring task scheduling
- Timezone-aware system prompt and due date handling

### Changed

- **tests:** DRY test suite with shared helpers and add duplicate detection

### Documentation

- Move completed plans to done
- Archive completed phase 02 and 03 plans

### Fixed

- Apply bun format and add CI concurrency group by commit SHA
- Apply PR review feedback - propagate labelId and projectId context in YouTrack error classification
- Rename unused reply param to _reply in bot-auth.test.ts (TS6133)
- Complete logger mock in recurring and cron tests to fix failing logger tests
- Simplify test command to use bun test auto-discovery
- Remove tests from ignorePatterns so tests are copied to sandbox
- **scripts:** Fix shell escaping in detect-duplicates.ts
- Await rejects assertion in propagates provider errors test
- **cron:** Validate step > 0 to prevent infinite loop on */0
- **recurring:** Address PR review feedback
- Address Phase 8 verification gaps

### Miscellaneous

- Add stryker mutation testing dependencies
- Add stryker mutation testing configuration
- Add mutation testing scripts and fix test paths
- Gitignore stryker temp dir and reports
- Whitelist stryker checker plugin in knip config
- Disable no-confusing-void-expression and await-thenable for tests; clean up task-resource tests
- **package:** Integrate duplicate detection into check script
- **package:** Rename test:duplicates to duplicates

### Testing

- Add tests for archive and relation methods in task-resource
- Fix exception assertion patterns in task-resource tests
- **cron:** Add test for negative step value (*/-1)

### Ci

- Add mutation testing job with incremental cache
- Restrict push trigger to master branch only
## [4.1.5] - 2026-03-20

### Ci

- Separate security scan job from check script
## [4.1.4] - 2026-03-20

### Fixed

- **ci:** Escape variables in deploy script heredoc
## [4.1.3] - 2026-03-20

### Documentation

- Redesign README with enterprise-grade standards
## [4.1.2] - 2026-03-20

### Added

- Add TASK_PROVIDER env var for single-provider deployment

### Fixed

- Add missing migration008GroupMembers import
## [4.1.1] - 2026-03-20

### Fixed

- Remove non-existent schemas directory from Dockerfile
## [4.1.0] - 2026-03-20

### Added

- Add ChatProvider interface and registry
- Migrate user ID columns from integer to text
- Decouple from Telegram via ChatProvider abstraction
- Multi-chat provider support, schema cleanup, and admin auto-seed
- Add drizzle database client wrapper
- **error-handling:** Improve error classification and user feedback
- Implement Phase 02 enhanced tool capabilities
- **phase-03:** Implement persistence and context improvements
- Add group_members table schema
- Update chat types for group support
- Add groups module with CRUD operations
- Update Mattermost provider for group support
- Add group management commands
- Add command context restrictions
- Propagate storage context through all layers
- Update help command for group context
- Complete group chat support implementation

### Changed

- Extract LLM orchestration module from bot.ts
- Accept LanguageModel instance in trimWithMemoryModel
- Relocate schemas into provider directories
- Extract shared Kaneo provisioning service
- Move youtrack schema tests to mirror src/ structure
- **tests:** Update tests to use Drizzle ORM
- Complete Drizzle ORM migration

### Documentation

- Add multi-chat provider design (Telegram + Mattermost)
- Add multi-chat provider implementation plan
- Add group chat documentation

### Fixed

- Use string literal instead of unsafe type assertion for mock model
- Resolve all lint warnings

### Miscellaneous

- Remove implemented and outdated plan documents
- Setup tdd poc hooks and roadmap phases user stories
- Add drizzle config and schema definitions
- Update gitignore for SQLite WAL files
- Ignore SQLite WAL files in gitignore
- Add bun check and bun fix scripts for parallel task execution

### Testing

- Add guardrails for e2e test execution
- Fix test isolation issues
- Complete group chat test suite

### Deps

- Add drizzle-orm and drizzle-kit
## [4.0.4] - 2026-03-19

### Fixed

- Add entrypoint script to fix /data permissions with su-exec dropping to bun user
- **docker:** Run as non-root bun user to satisfy security scanner
## [4.0.3] - 2026-03-19

### Fixed

- Create /data directory with bun user permissions for SQLite

### Ci

- Add typecheck and unit tests to pre-commit hook
- Upgrade codeql-action to v4 and add required permissions for SARIF upload
## [4.0.2] - 2026-03-19

### Fixed

- Add schemas directory to Dockerfile

### Ci

- Add typecheck and unit tests to pre-commit hook
## [4.0.1] - 2026-03-19
## [4.0.0] - 2026-03-19

### Added

- Add YouTrack as second provider to validate abstraction (Phase 6)
- Add delete-task tool and improve provider abstraction
- Implement missing YouTrack methods and fix comment interface
- **youtrack:** Add common schemas and enums
- **youtrack:** Add user schemas
- **youtrack:** Add comment schemas
- **youtrack:** Add project schemas
- **youtrack:** Add tag schemas
- **youtrack:** Add custom field schemas
- **youtrack:** Add agile board schemas
- **youtrack:** Add issue schemas
- **youtrack:** Add issue link schemas
- **youtrack:** Add schema index file
- **youtrack:** Complete schema definitions for YouTrack REST API
- Integrate Semgrep security scanning
- **youtrack:** Add production-ready Zod schemas for API response types
- **youtrack:** Wire Zod parse() into all operations for runtime API response validation

### Changed

- Add provider interface and error types (Phase 1)
- Add KaneoProvider adapter and provider registry (Phase 2)
- Rewire tools and bot to use TaskProvider interface (Phase 3)
- Rewire bot to use provider abstraction (Phase 4)
- Clean up provider layer imports (Phase 5)
- Rename columns.crud capability to statuses.crud
- Split coarse-grained capabilities into granular ones
- Extract operations to fix lint warnings
- Move src/kaneo/ into src/providers/kaneo/
- Move schemas to root schemas/ and restructure tests to mirror src/
- Remove migration infrastructure and reorganize types

### Documentation

- Add semgrep security integration design
- Add semgrep integration implementation plan
- Add mutation testing design with StrykerJS command runner approach
- Add mutation testing implementation plan

### Fixed

- Use pip install for semgrep instead of binary download
- Resolve semgrep CI error and knip unlisted binaries
- **youtrack:** Simplify ISSUE_FIELDS custom fields query to name-based shape
- **youtrack:** Update mappers to use name-based custom field lookup and schema types
- **youtrack:** Update ISSUE_LIST_FIELDS to name-based custom fields shape
- **knip:** Use ignoreFiles for test-only YouTrack schemas (files rule requires ignoreFiles not ignoreIssues)
- Add CHANGELOG.md to Docker image for version announcements

### Miscellaneous

- Create youtrack provider schemas directory
- Add directly-imported transitive deps to package.json
- Remove dead code flagged by knip
- Final knip cleanup — zero issues remaining
- Restore bin/ to .semgrep/.gitignore
- **youtrack:** Delete types.ts and update knip config for schemas

### Styling

- Fix lint warning by compressing long function signatures

### Ci

- Add knip job for unused dependency/export detection

### Revert

- Restore queueMicrotask in cache-db.ts (accidentally included in youtrack schema migration)
## [3.2.3] - 2026-03-17

### Fixed

- Use inputMessageCount to correctly slice assistant messages from LLM response
- Append all response.messages to history without slicing
## [3.2.2] - 2026-03-17

### Added

- Improve /context command output format
## [3.2.1] - 2026-03-17

### Added

- Announce new version to users with Kaneo accounts on startup
- **commands:** Add /context command to show memory context

### Changed

- Make /context admin-only and upload as text file
- Split cache.ts to fix max-lines warning
- Use dependency injection for bot in announcements

### Documentation

- Add multi-provider task tracker support plan
- Update CLAUDE.md and project documentation

### Fixed

- **bot:** Persist assistant responses to conversation history
- Clear in-memory facts cache in clearFacts()
- Resolve TypeScript type errors in announcements

### Styling

- Condense error logging to fix max-lines warning
## [3.2.0] - 2026-03-16

### Added

- Add e2e tests for labels and projects
- **e2e:** Add automatic Docker lifecycle management for E2E tests
- Add e2e tests for task comments
- Add e2e tests for task relations
- Add e2e tests for column management
- Add e2e tests for task archiving
- Add e2e tests for error handling
- Add e2e tests for user workflows
- Add e2e tests for label operations
- Add e2e tests for project archive

### Changed

- Remove eslint-disable comments from setup.ts
- Migrate to API-generated Zod schemas

### Documentation

- Add e2e testing documentation using existing docker-compose
- Fix e2e documentation code example
- Add Kaneo API bugs documentation
- Mark test coverage plan as completed
- Move completed test coverage plan to done directory
- Update CLAUDE.md with comprehensive e2e test coverage
- Research Kaneo column API endpoint patterns
- Document E2E test isolation issue with mock.module

### Fixed

- Add missing afterAll hooks to e2e tests
- E2e test verification and API fixes
- Resolve all lint warnings and type errors
- Remove eslint-disable comments and use Promise.all()
- Update unit tests for new multi-field update behavior
- **e2e:** Improve task-relations test quality
- Column color default and test config pattern
- Remove extra test from user workflows
- Correct comment retrieval filtering
- Update comment-resource test mocks to use correct schema
- Add await to error handling test assertions
- **tests:** Remove async/await from Bun expect().rejects.toThrow() calls
- Use unique column names to avoid conflicts with defaults
- Increase Docker startup timeout
- Address remaining E2E test failures
- Remove eslint-disable comments by fixing type annotations
- Correct activity field from 'message' to 'content' per API docs
- Parse actual API response for comment creation
- Resolve E2E test failures by aligning schemas with actual API responses
- Align types and test mocks with actual resource return types
- **e2e:** Use docker compose (v2) instead of docker-compose (v1)
- **ci:** Run unit tests only in the test job
- **kaneo:** Use 'todo' as default status when creating a task
- **tests:** Align task-resource mock columns with real Kaneo naming
- **kaneo:** Restore 'to-do' default status; fix column name mocks

### Miscellaneous

- Update e2e tests to reference bugs doc
- Add lint suppression check to pre-commit hook

### Styling

- Fix lint issues in test files

### Testing

- Complete comprehensive e2e test suite
- Run E2E suite and capture results
- Complete E2E test fixes - all criteria met
- Add mock restoration and microtask flush helpers
- Add mock restoration to project-tools.test.ts
- Add mock restoration to all tool tests
- Fix history persistence test for async caching
- Fix config cache test by clearing user cache
- Update task resource mocks to include to-do column
- Update comment resource tests for pending ID behavior
- Fix comment order in E2E test (newest first)
## [3.1.1] - 2026-03-13

### Added

- Add e2e test client with resource cleanup
- Add e2e tests for task lifecycle
- Add e2e test npm scripts using existing docker-compose
- Migrate existing config keys to renamed format

### Fixed

- Add missing projectId assertions in e2e test
- Move testClient initialization to beforeAll
## [3.1.0] - 2026-03-13

### Added

- Add e2e test setup module with provisioning

### Documentation

- Align config key names and update documentation for Kaneo

### Fixed

- Per-tool verification — fix bugs and improve test coverage
## [3.0.17] - 2026-03-12

### Fixed

- Fall back to JSON token when sign-up response has no session cookie
## [3.0.16] - 2026-03-12

### Added

- Allow specifying backup path in /migrate rollback
## [3.0.15] - 2026-03-12

### Fixed

- Migration column slug, API schemas, and e2e test verification

## [3.0.14] - 2026-03-12

### Fixed

- Match \_\_Secure- prefixed session cookie in provision.ts

## [3.0.13] - 2026-03-12

### Fixed

- Remove Origin from sign-up request in provision.ts

## [3.0.12] - 2026-03-12

### Fixed

- Correct kaneo-db-fix command YAML and provision auth

## [3.0.11] - 2026-03-12

### Fixed

- Send Origin header on sign-up to ensure session cookie is returned

## [3.0.10] - 2026-03-12

### Fixed

- Patch kaneo apikey.user_id NOT NULL to enable API key creation

## [3.0.9] - 2026-03-11

### Fixed

- **provision:** Use Bearer token from response body instead of Set-Cookie

## [3.0.8] - 2026-03-11

### Fixed

- **provision:** Replace body-token fallback with sign-in fallback

## [3.0.7] - 2026-03-11

### Fixed

- **provision:** Add Origin header to all Better Auth requests and fix body token fallback
- **provision:** Use username or telegramId as email local part on pap.ai domain

## [3.0.6] - 2026-03-11

### Fixed

- **provision:** Fall back to session token from response body when Set-Cookie header is absent

## [3.0.5] - 2026-03-11

### Added

- Add /help command and register bot commands with Telegram

## [3.0.4] - 2026-03-11

### Added

- Disable Kaneo registration by default

### Changed

- Extract command handlers into src/commands/ directory

### Documentation

- Restore full changelog history

### Fixed

- Use --prepend to preserve existing changelog entries on release

### Miscellaneous

- Add CHANGELOG.md to oxfmt ignore

### Security

- Block SSO and OAuth callback paths in Caddy

## [3.0.3] - 2026-03-11

### Fixed

- Use internal Kaneo URL for provisioning to fix session cookie
- Install dependencies before format step in release workflow

## [3.0.2] - 2026-03-11

## [3.0.1] - 2026-03-11

## [3.0.0] - 2026-03-11

### Added

- Migrate from Linear to Kaneo
- Add Kaneo self-host services to docker compose
- Add comprehensive Linear → Kaneo migration script
- Add parent-child relation support for sub-issue migration
- Add E2E migration test script
- Expand E2E verification — comments, label assignments, priorities, accurate label count
- CI tests, deploy health check, workflow_run trigger, Kaneo provisioning on first interaction

### Changed

- Split migrateUser to fix max-lines-per-function lint warning
- Split E2E migration test into smaller modules
- Add Zod validation to kaneoFetch and remove all lint disable comments
- Extract migration test constants to break circular import
- Linear → Kaneo migration infrastructure and test helpers
- Skip pass-1 partial frontmatter write in createTaskFromIssue
- Consolidate schemas, fix partial PUT updates, restore fetch in tests
- **queue:** Replace recursion with promise chaining

### Fixed

- Resolve TS2532 in frontmatter buildDescriptionWithRelations
- Track only newly-created columns in stats.columns (was overcounting)
- Add cursor pagination to fetchLabels, fetchWorkflowStates, fetchProjects
- Linear to Kaneo migration script fixes and improvements
- Resolve lint errors without disabling rules
- Update CONFIG_KEYS expected length in tests
- **classify-error:** Map KaneoValidationError to validationFailed app error

### Miscellaneous

- Reduce migrate-linear-to-kaneo.ts line count to fix max-lines lint warning
- Add queue.ts utility (missed in earlier commits)

### Revert

- Rollback codebase to v1.1 state

## [2.0.0] - 2026-03-06

## [1.0] - 2026-03-06

### Added

- Show typing indicator while LLM is processing
- Implement multiuser support with admin management

### Documentation

- Update multi-user support plan with username support

### Fixed

- Convert markdown tables to plain text before entity parsing
- Code review fixes for search-issues label filtering bug

### Testing

- Expand and reorganise format tests

## [0.9] - 2026-03-06

### Added

- Add database migration framework
- Implement two-tier conversation history persistence
- Add format utility for Markdown to MessageEntity conversion
- Integrate markdown formatting with bot
- Add type guard for date_time entities and move handling to mapEntityWithExtras

### Changed

- Move tests from src/ to dedicated tests/ directory
- Remove lint disable comments and properly type entities
- Simplify entity mapping by returning null for unsupported entities
- Remove unused loadFacts import and simplify fact persistence

### Documentation

- Add plan reference to multi-user support roadmap item
- Add Markdown to HTML formatting design
- Add implementation plan for markdown formatting
- Fix marked API usage, test assertions, and file paths
- Fix markdown formatting design and implementation plan
- Fix markdown formatting design and impl plan
- Fix review feedback issues in markdown formatting plans
- Fix design doc async option and impl plan test paths
- Mark database migration framework as complete

### Fixed

- Migration validation and database cleanup
- Address code review feedback for conversation history persistence
- Use bold as default for date_time and unknown entity types
- Add intentional fallthrough comment for date_time case
- Address code review feedback for conversation history persistence
- Resolve TypeScript type errors in tests

### Miscellaneous

- Add @gramio/format and marked dependencies

### Styling

- Fix lint warnings in migrate.test.ts

### Testing

- Verify all tests pass and linting clean

## [0.1] - 2026-03-04

### Added

- Add discriminated union error types
- Add user-facing error message mapper
- Implement granular error messages
- Add comments, labels, due dates, relations, and project tools
- Add linear response shape guards
- **linear:** Add removeIssueLabel wrapper function
- **tools:** Add remove_issue_label tool
- **linear:** Add archiveIssue wrapper function
- **tools:** Add archive_issue tool

### Changed

- Extract resolveWorkflowState to fix function length warning

### Documentation

- Update CLAUDE.md to reflect current architecture
- Update README to reflect current features and architecture
- Add comprehensive unit testing coverage plan for papai
- Actualize roadmap to reflect current implementation state
- Add plan for Linear API response validation roadmap item
- Clarify deterministic classification for response-shape errors
- Mark remove labels and archive issues as complete

### Fixed

- Tighten guard checks and date validation
- Remove duplicate error log from requireEntity
- Apply remaining response guard review suggestions

### Miscellaneous

- Ignore .worktrees directory

[3.0.3]: https://github.com/wKich/papai/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/wKich/papai/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/wKich/papai/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/wKich/papai/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/wKich/papai/compare/v1.0...v2.0.0
[1.0]: https://github.com/wKich/papai/compare/v0.9...v1.0
[0.9]: https://github.com/wKich/papai/compare/v0.8...v0.9
[0.1]: https://github.com/wKich/papai/compare/v0.0.0...v0.1
