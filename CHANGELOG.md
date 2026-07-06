# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.7.0] - 2026-07-06

### Added

- **client:** FetchError carries HTTP status from requireOk
- **client:** FormatFetchError plain-language error mapper
- **ui:** Associate Field label with Input/Select via context (aria-labelledby)
- **ui:** Add keyboard focus-within ring to Input and Select
- **settings:** Add optional name to TaskInstanceOptionSchema
- **settings:** Expose instance baseUrl as option name in task-instance pickers
- **acp:** Store shareToken/transcriptUrl on SessionRecord
- **acp:** Capture magi share token/url on session records
- **acp:** Prompt agent to share the transcript link
- **debug:** Read acp magi config from core for transcript proxy
- **debug:** Proxy historical transcript reads to magi
- **debug:** Long-lived SSE proxy for live transcript tail
- **debug:** Transcript viewer path dispatcher (assets, shell, proxy)
- **debug:** Mount public /t transcript routes before auth gate
- **client:** Register transcript viewer SPA bundle
- **client:** Transcript event + history Zod schemas
- **client:** Pure seq-ordered transcript stitch
- **client:** Transcript history fetcher + SSE wrapper
- **client:** Transcript viewer state + stitch orchestration
- **client:** Render transcript timeline + status states
- **client:** Self-heal transcript stream on disconnect + cover status transitions

### Changed

- **acp:** Extract session-record helpers to satisfy max-lines
- **acp:** Reuse client helpers in shareFieldsOf + cover list_sessions transcriptUrl

### Documentation

- **plan:** Implementation plan for GroupProviderSection UX fixes
- **guest-mode:** Design spec for GuestModeSection UX fixes
- **ux-review:** GuestModeSection review + manual visual states
- **guest-mode:** Implementation plan for GuestModeSection UX fixes
- **coding-sessions:** Design spec for sandbox MCP broker (design D)
- **coding-sessions:** Fold open-question verification into MCP broker spec
- **coding-sessions:** Record opencode acp-capability verification
- **coding-sessions:** Correct opencode acp finding (current version)
- **acp:** Design spec for transcript web viewer + shareable links
- **acp:** Magi returns transcriptUrl; drop papai base-url config from viewer spec
- **coding-sessions:** Reframe McpServerAcp as future after adoption research
- **acp:** Implementation plan for transcript web viewer + shareable links
- **acp:** Document the transcript viewer + shareable links
- **coding-sessions:** Resolve worker-isolation timing (ship code-enforced)
- **coding-sessions:** Worker isolation = launch gate + reuse geofront
- **ux-review:** IdentitySection review + manual state screenshots

### Fixed

- **settings:** GroupProvider loading/empty/error/busy states + friendly instance label
- **settings:** TaskProvider friendly errors + instance label (sibling convergence)
- **announcements:** Decode scoped group id to native channel id for broadcast
- **settings:** Make guest-mode state legible + recoverable (UX review fixes)
- **settings:** Reset toggleError on reload to prevent stale banner across context switch
- **client:** Satisfy lint rules in transcript state store
- **debug:** Make transcript-viewer missing-file tests build-state-independent
- **client:** Keep invalid-token terminal so a bad link doesn't retry forever

### Miscellaneous

- **knip:** Ignore field-context.ts exports (svelte-only consumers)
- **client:** Include transcript.css in storybook base stylesheet

### Testing

- **settings:** Friendly-label fixtures + deterministic GroupProvider loading-state test
- **settings:** Assert friendly instance-name option label (name ?? id) in both sections
- **client:** Pin history-wins-on-collision in stitch
- **debug:** End-to-end transcript proxy against stub magi
- **visual:** Add ReleaseSubscriptionSection mutating + error specs
- **system-prompt:** Seed migrated DB so the workflow prompt test passes in CI

### Ci

- **security:** Pin GitHub Actions to commit SHAs + add Dependabot
- **security:** Add 7-day cooldown to Dependabot config
- **security:** Pass release.yml step outputs via env to fix --strict scan
- **security:** Generate+upload SARIF and explain --strict parse failures

### Harden

- **debug:** Error handling, client-abort, asset guards for transcript proxy
## [6.6.0] - 2026-07-03

### Added

- **coding-credentials:** Provider+agent fields, provider→env mapping, compatibility
- **acp:** ResolveAgent capability; carry agent in projectSpec
- **settings-ui:** Agent + provider selects in the AI provider section
- **coding-credentials:** Typed forge connection fields + kind→apiBaseUrl
- **acp:** ResolveForge + deriveApiBaseUrl; carry projectSpec.forge; fix forge complete-state test
- **settings-ui:** Typed Code host connection (kind + instance URL)
- **coding-credentials:** Openai-compatible provider + base-url-required validation
- **acp:** ResolveProviderHost; carry projectSpec.providerHost
- **settings-ui:** Openai-compatible provider option + base-url hint
- **coding-credentials:** Operator guardrails admin config + section + agent filter
- **coding-credentials:** Force-shared-key resolves the operator agent-provider key
- **orchestrator:** Who-may-use gate on coding-session tools
- **coding-credentials:** Group-session identity resolves the acting user's creds
- **settings-ui:** Per-group coding-session identity policy
- **acp:** Per-identity not_configured wording for group sessions
- **acp:** Pre-flight self-hosted forge before starting a coding session
- **debug:** Add isScopeVisibleToCurrentAdmin visibility wrapper
- **debug:** Return unredacted logs from /logs route
- **debug:** Emit unredacted log entries on the SSE stream
- **storybook:** Add strybk config for spec generation
- **storybook:** Add playwright config targeting storybook iframe
- **storybook:** Generate visual specs from existing stories
- **storybook:** Add ToolsSection stories and generated visual spec
- **storybook:** Add ReposSection stories
- **storybook:** Add ByokSection stories
- **storybook:** Add KaneoAccessSection stories
- **storybook:** Add AdminUsersSection stories
- **storybook:** Add SettingsApp personal-ready shell story
- **storybook:** Add ProfileSection stories
- **storybook:** Add AiOutputSection stories
- **storybook:** Add ReleaseSubscriptionSection stories
- **storybook:** Add IdentitySection stories
- **storybook:** Add TaskProviderSection stories
- **storybook:** Add MemorySection stories
- **storybook:** Add CodingCredentialsSection stories
- **storybook:** Add CodeHostSection stories
- **storybook:** Add McpSection stories
- **storybook:** Add PluginsSection stories
- **storybook:** Add MembersSection stories
- **storybook:** Add GroupProviderSection stories
- **storybook:** Add GuestModeSection stories
- **storybook:** Add CodingIdentitySection stories
- **storybook:** Add SettingsApp group-ready shell story
- **storybook:** Add AdminInstancesSection stories
- **storybook:** Add AdminSystemSection stories
- **storybook:** Add AdminByokSection stories
- **storybook:** Add AdminGroupsSection stories
- **storybook:** Add AdminAdminsSection stories
- **storybook:** Add AdminPluginsConfigSection stories
- **storybook:** Add AdminPluginsApprovalSection stories
- **storybook:** Add AdminFeatureFlagsSection stories
- **storybook:** Add AdminToolDefaultsSection stories
- **storybook:** Add AdminReleaseNotesSection stories
- **storybook:** Add AdminCodingGuardrailsSection stories
- **storybook:** Add AdminAnnounceSection stories
- **storybook:** Add SettingsApp admin-ready shell story
- **coding-sessions:** Add per-identity model to agent-provider vault + projectSpec
- **settings:** Model field with combobox control + validation in coding credentials route
- **coding-credentials:** Add auth_method discriminator field
- **coding-credentials:** Emit CLAUDE_CODE_OAUTH_TOKEN for oauth-subscription
- **settings:** Surface + validate auth_method in coding credentials route
- **settings-ui:** OAuth-token field for Claude subscription auth
- **settings:** /models provider proxy (SSRF-guarded) + model combobox UI
- **settings:** Re-apply /models provider proxy (SSRF-guarded) + model combobox UI
- **completion:** Read-only tool filter + tool-failure detection
- **completion:** BuildVerifiedCompletion verify-and-report core
- **orchestrator:** Route risky interactive turns through verify-and-report
- **system-prompt:** Make the post-action confirmation name what was done
- **proactive:** Route risky deferred deliveries through verify-and-report
- **settings:** Let users clear coding AI-provider & code-host credentials
- **coding-repos:** Add additional_egress_domains column + migration
- **coding-repos:** Persist + validate additionalEgressDomains in store
- **coding-repos:** Accept additionalEgressDomains at settings route
- **acp:** Forward additionalEgressDomains in projectSpec
- **settings-client:** Parse additionalEgressDomains in repos schema + fetcher
- **settings-client:** Add per-project egress domains input
- **acp:** Thin chat-scoped session history index
- **acp:** Continue_session tool for follow-up requests
- **acp:** Record history on start/review and enrich list_sessions
- **acp:** Gate continue_session behind the whoMayUse guardrail
- **settings:** Tool group derivation for plugin/MCP namespaced names
- **settings:** Enumerate the runtime tool surface (plugins, MCP, providerless) in tools routes
- **settings:** Per-plugin group field on tool entries; plugin tools togglable
- **settings:** Kind:group bulk toggle; MCP tools listed and togglable
- **settings:** Admin tool-defaults catalog includes native plugin tools; group kind
- **settings-client:** Tool group field, group toggle fetchers, grouping lib
- **settings-client:** Per-plugin/per-server sub-groups with bulk toggles in ToolsSection
- **debug:** Shared LogFilter model with include/exclude + prefix matching
- **debug:** Server-side /logs filtering, /logs/scopes, stats matchingCount
- **debug:** Client filter URL helpers + filter-aware log bootstrap
- **debug:** Filter live log:entry SSE events per-connection
- **debug:** Scope filter picker + server-side LogExplorer, remove Fuse
- **debug:** URL-encoded filter state with refetch + SSE reconnect
- **skills:** Add report-only ux-review guided procedure
- **tokens:** Add --gap-tight and --radius-control
- **ui:** Add shared ErrorState component with retry
- **settings:** Add busy prop to shared Confirm dialog
- **group-settings:** Batch-read group member display labels
- **settings:** Add hybrid member-label resolver
- **settings:** Enrich group members GET with display labels
- **settings:** Add nullable member label fields to schema
- **settings:** Show member display names in MembersSection
- **ui:** Add busy affordance and intrinsic focus ring to Btn

### Changed

- **acp:** Extract buildSessionProjectSpec (max-lines); fix base-url label
- **debug:** Single-source visibility rule in isScopeVisibleToCurrentAdmin
- **debug:** Delete unused log-redaction module
- **acp:** Trim history index to consumed surface (drop listRecords)
- **tools:** Remove tool-context-reduction feature flags, make behavior default
- **settings:** Share StoredConfigValueSchema across schema modules
- **settings:** Dedup release-subscription toggle gate, reset action error on load

### Documentation

- **coding-credentials:** Phase 4 decomposition design (4a/4b/4c)
- **coding-credentials:** Phase 4a multi-provider + agent picker design
- **coding-credentials:** Phase 4a multi-provider implementation plan
- **coding-credentials:** Phase 4b typed forge connections design
- **coding-credentials:** Phase 4b typed forge implementation plan
- **coding-credentials:** Phase 4c derived egress design
- **coding-credentials:** Lock 4c decisions (exclude repo host; split preset egress)
- **coding-credentials:** 4c spec consistency (repo-host references)
- **coding-credentials:** Phase 4c derived egress implementation plan
- **coding-credentials:** Phase 5 guardrails + group identity design
- **coding-credentials:** Phase 5a operator guardrails design
- **coding-credentials:** Phase 5a operator guardrails implementation plan
- **coding-credentials:** Phase 5b group-session identity design
- **coding-credentials:** Phase 5b group-session identity implementation plan
- **coding-credentials:** Phase 5c redaction hardening design
- **coding-credentials:** Phase 5c redaction hardening implementation plan
- **claude:** Split CLAUDE.md into topic files under docs/architecture
- **plan:** /turns/:id scope enforcement implementation plan
- **debug:** Document /turns/:id scope enforcement (ADR-0223)
- **adr:** Correct ADR-0223 severity — defense-in-depth, not active leak
- **spec:** Remove debug log redaction; auth+scope as privacy boundary
- **plan:** Implementation plan for removing debug log redaction
- **adr:** Record ADR-0224 removing debug log redaction
- **adr:** Note ADR-0197 Decision 3 superseded by ADR-0224 in index
- **spec:** Phase 1 design for read-only/exploration coding sessions
- **spec:** Auto-commit+PR dirty sessions on auto-finish
- **spec:** Storybook→agent screenshot feedback pipeline design
- **plan:** Storybook→agent screenshot pipeline implementation plan
- **storybook:** Document agent screenshot workflow
- **storybook:** Point screenshot example at stable baseline path
- **plan:** Settings story backfill implementation plan
- **plan:** Fix garbled bullet in settings backfill plan
- **coding-sessions:** Whole-record save + resolveForge partial-vault guard
- **plan:** Full settings Storybook coverage plan
- **coding-sessions:** Phase 4d design — model selection + codex base-URL fix
- **plan:** Phase 4d model selection + codex base-URL fix implementation plan
- **coding-sessions:** Document Phase 4d model selection + codex base-URL fix
- **spec:** Verified completion message design (replace bare 'Done.')
- **plan:** Verified completion message implementation plan
- **coding-sessions:** Note per-user/group credential Clear buttons
- **coding-sessions:** Spec for per-project additional egress domains
- **coding-sessions:** Implementation plan for per-project egress domains
- **coding-sessions:** Fix task numbering in egress plan header
- **coding-sessions:** Document per-project additionalEgressDomains
- **coding-sessions:** Spec for follow-up coding session requests
- **coding-sessions:** Implementation plan for follow-up coding sessions
- **coding-sessions:** Document follow-up coding sessions
- **tools:** Spec for plugin and MCP tool permissions in settings UI
- **tools:** Implementation plan for plugin/MCP tool permissions in settings UI
- **tools:** Document plugin/MCP tool permission editing in the settings UI
- **settings:** Document registry-lockstep assumption and thread-scoped display gaps
- **spec:** Server-side scope filtering for debug log explorer
- **plan:** Implementation plan for log explorer scope filtering
- **specs:** AI UX review workflow design (guided, report-only)
- **plans:** Implementation plan for AI UX review workflow
- **ux-reviews:** Add seven-dimension UX review rubric
- **ux-reviews:** Add findings-doc output template
- **storybook:** Link screenshot pipeline to ux-review skill
- **architecture:** Plugin/core separation design (two-tier ports & adapters)
- **ux-reviews:** Dogfood ux-review skill on ToolsSection
- **ux-reviews:** Dogfood ux-review skill on TaskProviderSection
- **specs:** ProfileSection UX fixes design
- **ux-review:** Expand rubric to 9 dimensions
- **ux-reviews:** Re-review ProfileSection against 9-dim rubric
- **plans:** ProfileSection UX fixes implementation plan
- **ux-reviews:** Add MembersSection UX review report
- **specs:** Add MembersSection UX fixes design
- **plans:** Add MembersSection UX fixes implementation plan
- **plans:** Add Confirm-retrofit + schema-dedup follow-up plan
- **plans:** Record settled guard guidance for Confirm retrofit
- **ux:** Review ReleaseSubscriptionSection + design spec for fixes
- **plan:** Implementation plan for ReleaseSubscriptionSection UX fixes
- **spec:** Design for GroupProviderSection UX fixes + shared primitives
- **ux-review:** Add GroupProviderSection review + manual screenshot states

### Fixed

- **coding-credentials:** Reject unknown agent/provider values; cover render-alongside-selects
- **settings-ui:** Atomic agent/provider switch; provider-neutral placeholder; cover projectSpec.agent
- **deferred-prompts:** Stop reminder delivery leaking the model's time-check preamble
- **debug:** Scope-filter GET /turns/:id to the operator's own contexts
- **announce:** Upsert subscription so admins without a users row persist
- **notify:** Decode scoped storage context id for delivery
- **notify:** Route thread-less group context to channel, not DM
- **storybook:** Satisfy no-inline-comments lint in playwright config
- **storybook:** Make shoot:gen self-format and stamp headers for stable regeneration
- **acp:** Persist forge/provider config as a whole record; guard partial vault
- **storybook:** Mock members in coding-identity loading variant
- **settings-ui:** Remove unplanned model-fetching code from B4 component
- **settings:** Remove unplanned models tests from coding-credentials route test
- **settings-ui:** Normalize hidden oauth fields at submit time to avoid invisible 422
- **settings:** Harden /models proxy against redirect SSRF + anthropic /v1 base; cover opencode+anthropic
- **plugins:** Pass raw thread-scoped storage context id to plugin tool runtime
- **acp:** Declare continue_session in plugin manifest + guard test
- **settings:** Distinct 422 messages for unknown group domain vs unknown group
- **debug:** Treat lone * as match-all and drop empty scope patterns
- **debug:** Refresh log buffer stats + paging on filter change
- **ui:** Unify control radius on --radius-control (2px)
- **ui:** Raise EmptyState hint contrast to AA (--fg2)
- **settings:** Outline Clear, right-align field actions, tokenize gaps
- **settings:** ProfileSection keep-fields-on-refresh, ErrorState, empty action, intro
- **settings:** TaskProviderSection keep-data-on-refresh + ErrorState
- **settings:** AiOutputSection keep-fields-on-refresh + ErrorState
- **settings:** Distinguish MembersSection loading state from empty
- **settings:** Signal in-flight add and block double-submit in MembersSection
- **settings:** Confirm before removing a group member
- **settings:** Reset removing flag before member-list reload
- **settings:** Format MembersSection added_at via shared helper
- **settings:** Make MembersSection Remove read as destructive
- **settings:** Resolve member-label provider from platform store + log enrichment failures
- **settings:** Guard MembersSection state against context switch mid-request
- **settings:** Keep CodeHost clear dialog open with inline error
- **settings:** Keep PluginsSection clear-key dialog open with inline error
- **settings:** Keep MemorySection clear dialog open with inline error
- **settings:** Keep CodingCredentials clear dialog open with inline error
- **settings:** Keep admin instance-delete dialog open with inline error
- **settings:** Keep admin instance-stop dialog open with inline error
- **settings:** Keep admin-remove dialog open with inline error
- **settings:** Keep admin user-remove dialog open with inline error
- **settings:** Keep admin group-remove dialog open with inline error
- **settings:** Keep admin plugin-config clear dialog open with inline error
- **settings:** Keep admin plugin-reject dialog open with inline error
- **settings:** Keep announce-confirm dialog open with inline error
- **settings:** Keep release-notes broadcast dialog open with inline error
- **ui:** Make Btn busy styling orthogonal to disabled, drop dead cursor
- **settings:** Gate release-subscription toggle behind load state, add retry + busy feedback

### Miscellaneous

- **storybook:** Add playwright + crvy screenshot deps and ignore artifacts
- **storybook:** Wire shoot scripts, bun-test isolation, knip
- **proactive:** Correct stale 'dropping preamble' log to reflect verify-and-report
- **knip:** Ignore tool-grouping pending tools-routes wiring
- **knip:** Fix stale phrasing in group-tools ignore comment
- **debug:** Drop unused fuse.js dep and orphaned fuse-search test
- **knip:** Ignore .svelte-consumed types in fetcher-schemas-admin

### Styling

- **settings:** Format coding-identity fetcher + route import
- **ux-reviews:** Oxfmt TaskProviderSection findings doc
- **settings:** Design-system styling for ProfileSection empty-state link
- **settings:** Tokenize settings-field-list gap to --gap-inline
- **settings:** Space MembersSection error and align add row
- **ui:** Raise IconButton resting contrast

### Testing

- **coding-credentials:** Cover deriveProviderHost parse-error→null branch
- **coding-guardrails:** Cover 401/non-admin-POST/422 on the admin route
- **coding-credentials:** Two-user same-thread credential isolation
- **coding-credentials:** Redaction release-gate (ciphertext + no-log)
- **coding-credentials:** Runtime log-spy gate — store never logs secrets
- **storybook:** Add settings MSW handler families
- **storybook:** Register settings scenarios and session reset
- **storybook:** Personal settings handler families + scenarios
- **storybook:** Group settings handler families + scenarios
- **storybook:** Admin settings handler families + scenarios
- **coding-sessions:** Cover model in projectSpec + resolveModel forceSharedKey invariant
- **settings:** Cover model length boundary (200 chars accepted)
- **settings:** Assert /models proxy passes redirect:error (regression guard)
- **db:** Update last-migration guard to 066_coding_repos_egress
- **debug:** Update /logs scope-filter test to include= param (API change)
- **visual:** Add ErrorState story spec
- **settings:** Consolidate ProfileSection tests into sections/
- **settings:** Add TaskProviderSection load-error regression test
- **settings:** Assert Confirm busy label and blocked close
- **settings:** Cover MembersSection remove-error stays in dialog
- **visual:** Add MembersSection confirm + loading states
- **visual:** Give MembersSection fixture display labels
- **settings:** Add release-subscription mutation stories, fixtures, and screenshots
## [6.5.1] - 2026-06-26

### Added

- **coding-repos:** Per-context repo catalogue + CRUD route
- **acp:** Repo catalogue capability — list_projects + inline projectSpec
- **settings-ui:** Repositories catalogue section

### Changed

- **acp:** Split tools.ts under max-lines; drop dead project field; cover thread-scope + delete CSRF

### Documentation

- **coding-credentials:** Lock Phase 3 decisions (drop MAGI_PROJECTS, single inline path)
- **coding-credentials:** Phase 3 user-defined repositories implementation plan

### Fixed

- **deploy:** Prevent docker exec -T from eating the SSH heredoc
## [6.5.0] - 2026-06-26

### Added

- **coding-credentials:** Forge namespace + namespace-generalized settings route
- **acp:** Per-context forge token — resolveForgeToken + finish/review injection
- **settings-ui:** Code host token section
- **config:** DeleteConfigFromDb primitive for config-row removal
- **config:** ClearCachedConfig clears cache entry and DB row
- **config:** UnsetConfigValue + unsetPluginConfig with tool-cache invalidation
- **plugins:** DeletePluginAdminConfig removes the system_config row
- **tools:** ClearToolPrefs removes the tool_prefs row + invalidates tool cache
- **config:** Unsettable flag + isFieldUnsettable gate on ConfigField
- **settings:** Unset action on /settings/api/config (all context ConfigFields)
- **settings:** Unset action on /settings/api/plugins/config
- **settings:** Unset action on /settings/api/admin/plugin-config
- **settings:** Unset kind clears per-context tool_prefs
- **settings:** Unset kind clears admin tool defaults
- **settings:** Unset action clears tool_context_flags
- **settings-ui:** Unset fetchers for config and plugin fields
- **settings-ui:** Clear affordance for config + plugin fields
- **settings-ui:** Add unsetAdminPluginConfig + unsetToolDefaults fetchers
- **admin-ui:** Clear affordance for admin plugin config keys
- **admin-ui:** Clear admin defaults control in tool-defaults section
- **db:** Migration 063 — release announcement subscription columns + deliveries
- **announcements:** Subscription + draft + delivery store
- **announcements:** Central-LLM changelog humanizer
- **announcements:** Subscriber broadcast fan-out
- **announcements:** Humanize + persist draft + admin review notice on new version
- **settings:** Admin release-notes route (view/regenerate/save/broadcast)
- **settings:** Personal + group release-subscription routes
- **settings-ui:** Release notes + subscription fetchers and schemas
- **settings-ui:** Admin Release notes section
- **settings-ui:** Release announcement subscription toggle (personal + group)
- **settings:** Migrate platform-instance apply (live router reconcile) into settings admin

### Changed

- **settings:** Clearer action-presence narrowing in feature-flags unset dispatch
- **admin:** Remove duplicate Plugin Config section from operator dashboard
- **admin:** Remove duplicate System (LLM creds) section from operator dashboard
- **admin:** Remove duplicate Groups section from operator dashboard
- **debug:** Drop dead AuthorizedGroupEntry re-export from dashboard-types
- **admin:** Remove operator Instances UI and /api/* instance routes
- **admin:** Derive admin nav lists from a single source

### Documentation

- **coding-credentials:** Phase 2 forge-identity implementation plan
- **coding-credentials:** Phase 3 user-defined repositories design spec
- **config:** Registry-gated generic config unset design
- **config:** Implementation plan for registry-gated config unset
- **config:** Note unset/Clear capability in settings UI
- **spec:** Opt-in version announcement subscriptions design
- **spec:** Rename announcements feature to 'Release notes' to coexist with existing Announce
- **plan:** Release announcement subscriptions implementation plan
- **claude:** Document opt-in version release announcements feature
- **adr:** Write ADR-0169..0222 for completed plans; archive plans and specs
- **admin:** Design to deduplicate admin controls out of the dashboard into settings
- **admin:** Implementation plan for admin dashboard deduplication
- **admin:** Point admin controls at settings; /admin is now a read-only dashboard
- **plugins:** Point operator workflow at settings admin Instances + Plugins area

### Fixed

- **settings-ui:** Unique testids for Code host section
- **settings:** Admin plugin-config PATCH dispatches via typed union (reject wrong-case action)
- **settings-ui:** Required-field Clear confirm warns about plugin ineligibility
- **settings-ui:** Kind-aware Clear warning + guard Clear against double-submit
- **settings-ui:** Gate admin tool-defaults Clear on hasStoredDefaults (covers custom defaults)
- **deferred:** Deliver proactive prompts to new users + seed context_settings
- **ci:** Take a WAL-consistent, verified DB backup before deploy
- **db:** Add deliveries FK + strengthen migration 063 tests
- **announcements:** Upsert humanized body so admin save/regenerate persist without a seeded row
- **settings-ui:** Guard stale subscription loads + unique section id per scope
- **announcements:** Pre-LLM dedup anchor, save-before-broadcast, no sent-downgrade, result styling
- **settings:** Apply UX — keep failure message, 405 on non-POST, busy state, info log
- **debug:** 405 on non-GET to /admin/subjects/:id/recent-requests

### Miscellaneous

- **tools:** Log info on clearToolPrefs for parity with setToolPrefs
- **admin:** Remove dead types/handlers/tests orphaned by dashboard dedup

### Styling

- **acp:** Invert forgeToken spread guard; collapse test import

### Testing

- **settings:** Assert excluded operational secrets cannot be unset via config route
- Install test DB in tool-prefs-reading suites to fix CI flakiness
- **settings:** Cover release-subscription 422, unauthorized 403, group GET default
- **admin-llm:** Restore unit coverage for masking + validation (kept module)
- **admin:** Drop stale tests targeting removed /api/platform-instances + stale 'groups' id
- **admin:** Delete tombstone server-write-auth test file (coverage moved to settings/admin suites)

### Polish

- **settings-ui:** Style Clear row; mutually exclude the two tool-defaults confirm bars
- **announcements:** Single delivery timestamp + write logs + stronger store test
- **announcements:** Log missing central keys + assert humanizer system prompt
- **announcements:** Broadcast author comment, Readonly chat, honest test mocks + empty-list case
- **announcements:** Direct humanize ref, fuller persist assertion, document persist-before-send
- **settings-ui:** Share ctxQuery, cover regenerate + broadcast CSRF
- **settings-ui:** Reset broadcast result on retry + initial loading line
## [6.4.2] - 2026-06-25

### Added

- **coding-credentials:** Encrypted per-context agent-provider vault
- **plugins:** CodingSecrets capability gated by coding.secrets permission
- **settings:** Coding-credentials user route
- **settings-ui:** Coding sessions AI-provider section + fetchers
- **acp:** Inject per-context agent key into magi sessions; refuse when unconfigured

### Documentation

- **coding-credentials:** Top-level multiphase spec + Phase 1 spec & plan
- **coding-credentials:** Phase 2 forge-identity design spec
- **coding-credentials:** Lock Phase 2 forge-identity decisions

### Fixed

- **coding-credentials:** Complete namespace dispatch + cover unreadable path
- **audio-transcribe:** Dedicated per-user quota, group-shared + language-aware cache

### Testing

- **coding-credentials:** Cover masked-value preservation, optional clear, thread-scoped resolve
## [6.4.1] - 2026-06-25

### Added

- **live-status:** Add per-context ai_live_status toggle
- **participants:** Add chat roster service with fuzzy-rank resolution
- **tool:** Add resolve_chat_participant tool for group @mention resolution
- **tools:** Gate resolve_chat_participant by chatParticipantResolver in group context
- **plumbing:** Thread chatParticipantResolver from ChatRouter into MakeToolsOptions
- **prompt:** Add explicit resolve_chat_participant population procedure to GROUP_DEFERRED
- **acp:** Notify_token from system_config with lazy env seed
- **acp:** POST /api/notify handler
- **acp:** Mount /api/notify on its own token trust plane
- **membership:** Add members.provision capability and TaskProvider.provisionWorkspaceMember seam
- **identity:** Add 'provisioned' MatchMethod with no-overwrite guard
- **kaneo:** Implement KaneoProvider.listUsers and add members.provision capability
- **kaneo:** Implement kaneoProvisionMember (invite+accept flow) and KaneoProvider.provisionWorkspaceMember
- **db:** Migration 060 — kaneo_workspace_members table with encrypted_password column
- **membership:** EnsureWorkspaceMember with reuse-via-stored-password, encrypted_password persistence, identity-link write
- **membership:** Group_member:added/removed event subscriber, p-limit bounded, placeholder skip; fix failed/inactive rows to allow retry via upsert
- **membership:** Startup backfill iterates group_members, p-limit bounded, placeholder skip
- **membership:** First-interaction backstop in llm-orchestrator callLlm
- **settings:** GET/POST /settings/api/kaneo/credentials — member email + reveal-once reset
- **settings-ui:** KaneoAccessSection — show login email, workspace URL, reveal-once password reset
- **system-prompt:** Add find_user Kaneo assignment resolution guidance for group context
- **acp-plugin:** Scaffold acp plugin with magi client and read tools
- **acp-plugin:** Start_session tool with kv session tracking
- **acp-plugin:** List_sessions (kv-scoped) and session_status
- **acp-plugin:** Finish, cancel, answer_permission tools
- **acp-plugin:** Review_pr tool, /acp command, prompt fragment
- **byok:** Self-serve enable/disable toggle on user route
- **byok:** Add toggleByok client fetcher
- **byok:** Self-serve toggle in user BYOK section

### Changed

- **message-queue:** Remove dead fire-and-forget seam, narrow enqueue to void
- **kaneo:** Extract establishMemberSession to satisfy max-lines-per-function
- **settings-ui:** Rename Kaneo credential reset→reveal for behavior consistency
- **byok:** Make admin BYOK route read-only
- **byok:** Read-only admin BYOK overview
- **byok:** Remove dead status state and dead CSRF test code
- **byok:** Remove dead patchAdminByok fetcher

### Documentation

- **spec:** Kaneo group-member provisioning design
- **spec:** Reminder @mention resolution design
- **plan:** Reminder @mention resolution implementation plan
- **plan:** Kaneo group-member provisioning implementation plan
- **plan:** Close 4 gaps in Kaneo group-member plan (reuse, settings UI, reset branches, label wiring)
- Note resolve_chat_participant tool and chat-participant roster
- **acp:** Add papai notify-endpoint implementation plan (#6)
- **acp:** Document /api/notify endpoint and NOTIFY_TOKEN
- **kaneo-spike:** Record phase-0 feasibility outcome (invite+accept; no add-member/set-password over HTTP)
- **plan:** Revise Kaneo plan to Phase-0 reality (invite+accept, Branch-B credentials, reuse via stored password)
- **acp-spec:** Rename geofront sandbox to acp-agent
- **acp:** Add papai acp plugin implementation plan (#7)
- **acp:** Document the acp plugin in CLAUDE.md
- **live-status:** Document the minimum tool-label hold before Thinking
- **byok:** Design spec for self-serve BYOK enablement
- **byok:** Implementation plan for self-serve BYOK
- **byok:** Document self-serve BYOK enablement model

### Fixed

- **timezone:** Resolve timezone from config-context id, not raw chatUserId
- **participants:** Use canonical group-context derivation + realistic scoped-id test
- **tools:** Repair tool-cache invalidation for resolver-scoped keys + wire resolver into providerless group tools
- **participants:** Reject empty query, gate prompt on tool availability, log label fallback
- **acp:** Notify_token seed uses onConflictDoNothing; add whitespace test
- **acp:** Constant-time token compare, document target contract, log 401, test bad JSON
- **acp:** Check bearer before config-state, guard sendMessage throws, type-safe token read
- **kaneo:** Sanitize synthetic member email, add provisioning error-path tests, debug entry log
- **membership:** Skip group-membership backstop for guest actors
- **settings-ui:** Relabel reveal-once button 'Reveal password' (was misleadingly 'Reset password')
- **acp-plugin:** Omit Content-Type on bodyless requests; use real plugin types
- **acp-plugin:** Revert zod import; keep raw JSON-Schema + loose tool types for discovery
- **mattermost-link:** Allow reading public channels the requester hasn't joined
- **live-status:** Hold a tool label ≥1s before reverting to Thinking
- **byok:** Reject ambiguous bodies carrying both action and values
- **byok:** Guard save against in-flight toggle; add disable-direction test

### Miscellaneous

- **acp:** Register notify-token test-only seam in knip
- **knip:** Remove temporary suppression for membership module and identity mapping
- **acp-plugin:** Register acp plugin entry in knip
## [6.4.0] - 2026-06-20

### Added

- **stats:** Token usage time-series + labeled charts
- **admin:** Sortable tables, unambiguous timestamps, styled detail views
- **debug:** Page backward through buffered logs from the browser
- **admin:** Embed per-subject token-per-day chart in billing detail
- **debug:** Pin the operator's own session with a 'you' badge
- **tools:** Add riskDefaults tier to tool preferences
- **tools:** Add permission preset definitions and detection
- **settings:** Add preset branch + activePreset to tools route
- **settings-client:** Add tool preset schema and fetcher
- **settings-ui:** Add permission preset bar to Tools section
- **providers:** Add linkTypeNotFound provider error
- **memory:** Thread kind/include_stale filters through the recall cascade
- **memory:** Search_memory uses the recall cascade (provenance, kind, include_stale)
- **db:** Migration 058 — open_dm_access + users.blocked_at
- **instances:** Open DM access read/write helpers
- **users:** Block/unblock/isBlocked helpers + blocked_at
- **auth:** Open-access auto-add + block gate; remove DEMO_MODE branch
- **settings:** Open-access toggle + user block/unblock routes
- **settings:** Audit-log user block; log casing + toggle/not-found tests
- **settings-client:** Open-access + block fetchers and schemas
- **settings-ui:** Open-access toggle + user source badge + block/unblock
- **tool-prefs:** HasStoredToolPrefs presence check
- **tools:** Admin tool-defaults store + seed helper
- **tools:** Seed admin tool defaults on first toolset build
- **settings:** Admin tool-defaults GET/POST route
- **settings-ui:** Admin Default tool permissions section
- **settings-ui:** Collapsible sidebar group support
- **settings-ui:** Collapsible Advanced group; Personal stays minimal
- **settings-ui:** Gate Kaneo auto-provision on provisionable bound instance
- **run-control:** Add RunControl types and RunRegistry
- **run-control:** Add stop summary builder
- **run-control:** Add steering prepareStep and composer
- **run-control:** Add stop-requested stopWhen condition
- **run-control:** Wire run-control into invokeModel (Task 5)
- **hooks:** Block @ts-expect-error inline suppressions
- **run-control:** Manage run lifecycle, stop summary, and leftover re-enqueue in processMessage
- **run-control:** Route mid-run messages to the steer queue with an ack
- **message-queue:** Serialize different-user group flush for one-run-per-thread
- **commands:** Add /stop command with graceful and force-abort escalation
- **system-prompt:** Add mid-run steering guidance fragment
- **db:** Add guest_mode column to authorized_groups (migration 059)
- **groups:** IsGuestModeEnabled/setGuestMode store helpers
- **auth:** Allow unknown group users as read-only guests when guest mode is on
- **queue:** Thread actorRole from auth through message coalescing
- **orchestrator:** Thread actorRole into processMessage and invocation options
- **tools:** Hard read-only tool filter for guest actors
- **memory:** Exclude guest turns from long-term memory capture and extraction
- **settings-api:** GET/PATCH group guest-mode route
- **settings-ui:** Guest-mode fetchers + schema
- **settings-ui:** Group guest-mode toggle section
- **chat:** Capture prompt handle, redact on timeout, return handle on resolve
- **chat:** Tool-named ephemeral confirmation with edit-in-place fallback
- **telegram:** Self-removing prompt + ephemeral callback toast
- **discord:** Self-removing prompt + ephemeral follow-up confirmation
- **mattermost:** Self-removing prompt post + ephemeral confirmation
- **mattermost:** Add thread post + post-list schemas
- **mattermost:** Add permalink parser with host validation
- **mattermost:** ResolveChatLink single-post path with membership gate
- **mattermost:** ResolveChatLink thread path, identity cache, 100-post cap
- **tools:** Add fetch_chat_link tool over the Mattermost resolver
- **tools:** Classify fetch_chat_link as open-world history-read
- **tools:** Gate + register fetch_chat_link for Mattermost contexts
- **system-prompt:** Add fetch_chat_link usage fragment
- **chat:** Add StatusHandle capability to ReplyFn
- **live-status:** Tool status label + argument registry
- **live-status:** LiveStatusReporter lifecycle
- **live-status:** Drive reporter from tool-call hooks
- **live-status:** Create and dismiss reporter in callLlm
- **chat/telegram:** CreateStatus implementation
- **chat/discord:** CreateStatus implementation
- **chat/mattermost:** CreateStatus implementation

### Changed

- **tools:** Simplify riskDefaultsEqual and co-locate PRESET_KEYS
- **settings-client:** Extract shared StoredConfigValueSchema base, remove duplication
- **settings-client:** Revert unnecessary fetcher-schemas split (max-lines is off), keep preset additions
- **settings-client:** Extract Tools schemas to own module (proper split, no blank-line gaming, knip-clean)
- **memory:** Always-on provisional capture executor (drop flagEnabled)
- **memory:** Always arm debounced capture (drop flagEnabled)
- **tools:** Register recall unconditionally in normal mode
- **flags:** Remove crossThreadMemory from ReductionFlags and admin surfaces
- **settings-ui:** Drop cross_thread_memory flag from admin UI
- **tools:** Remove recall tool (search_memory is now the single retriever)
- **prompt:** Retarget memory fragment from recall to search_memory
- **users:** IsBlocked debug log + unblockUser no-row test
- **auth:** Hoist isAuthorized; test clarity + blocked-group coverage
- **start:** Drop demo-mode auto-add; welcome-only handler
- **settings:** Export tools-route view/setter helpers
- **tools:** Canonical isToolDomain guard; clarify admin tool validation + test
- **settings-ui:** Parameterize ToolsSection (section id, header, fetchers)
- **settings-ui:** Tidy admin tool-defaults fetcher signature + comments
- **chat:** Move Embed types to context-types module
- **auth:** Extract tryOpenDmAccessAuth helper
- **chat:** Add PromptHandle + messages.ephemeral; widen buttons return type
- **mattermost:** Extract makeMattermostApiFetch with status-carrying error
- **live-status:** Drop unused exports for knip

### Documentation

- Spec for admin/debug dashboard fixes
- Record dashboard-fix decisions and implementation status
- Tool permission presets design (read-only/non-destructive/allow-all)
- Implementation plan for tool permission presets
- Document riskDefaults tier + permission presets in CLAUDE.md files
- **youtrack:** Design spec for structured /links relation linking fix
- **youtrack:** Implementation plan for structured /links relation linking fix
- **specs:** Beta-onboarding designs — open DM access, admin tool defaults, settings Advanced grouping
- **spec:** Design to remove cross_thread_memory flag (make behavior default-on)
- **plan:** Implementation plan to remove cross_thread_memory flag
- Cross-thread memory bridge is now always-on (flag removed)
- **flags:** Correct reduction-flag count in resolveReductionFlags JSDoc (four→three)
- **spec:** Consolidate recall + search_memory into one cascade-backed tool
- **plan:** Implementation plan to consolidate recall into search_memory
- Search_memory is the single cascade-backed memory retriever
- **plans:** Implementation plan for admin open DM access (Spec 1)
- **plans:** Implementation plan for admin default tool permissions (Spec 2)
- **plans:** Implementation plan for settings UI Advanced grouping (Spec 3)
- **env:** Replace DEMO_MODE note with open DM access
- Admin default tool permissions
- **spec:** Add agent interruption & steering design
- **plan:** Add agent interruption & steering implementation plan
- **spec:** Ephemeral/self-removing ask permission prompts
- **spec:** Guest mode for group chats design
- **plan:** Guest mode for group chats implementation plan
- **plan:** Ephemeral/self-removing ask permission prompts implementation plan
- Document mid-run steering, /stop, run-control, and one-run-per-thread
- Document group guest mode behavior
- **plan:** Follow Mattermost chat links design
- **chat:** Explain register-before-send invariant in askPermissionViaChat
- **chat:** Document self-removing permission prompts + perm callback routing
- **plan:** Follow Mattermost chat links implementation plan
- **spec:** Live task status design
- **plan:** Live task status implementation plan
- **live-status:** Document createStatus capability and live status behavior

### Fixed

- **providers:** Make link-type-not-found message provider-neutral, tighten guidance test assertion
- **youtrack:** Add relations via structured /links/{linkID}/issues endpoint
- **youtrack:** Read issue resource for link discovery, drop suffix for undirected link types
- **settings-memory:** Surface provisional group records in settings UI
- **youtrack:** Accept null for requested-but-empty API scalar fields
- **memory:** Tolerate per-record extractor failures and pin kind enum in prompt
- **settings-client:** Added_by is required on AdminUserRow
- **settings-ui:** Correct toggle toast wording; guard remove during block; parallelize load
- **settings-ui:** Propagate activePreset on toggle; reset pendingPreset on reload; derive input type
- **settings-ui:** Track sectionIds in activeId-reset effect
- Resolve checks failing on the merged tree
- **run-control:** Guarantee run cleanup via finally; test error-path cleanup
- **commands:** Capitalize /stop help description for consistency
- **chat:** Deny immediately when permission prompt fails to send
- **telegram:** Answer callback query exactly once on ephemeral confirm path
- **chat/mattermost:** CreateStatus never rejects on post failure

### Miscellaneous

- Purge DEMO_MODE from tests/docs; add regression guard
- **knip:** Stage run-control modules ahead of wiring
- **knip:** Stage run-control/summary ahead of wiring
- **knip:** Stage run-control/steering-prepare-step ahead of wiring
- **knip:** Stage run-control/stop-condition ahead of wiring
- **knip:** Remove run-control staged ignores now that modules are fully wired
- **knip:** Stage fetch_chat_link modules ahead of wiring
- **knip:** Stage fetch-chat-link tool ahead of wiring
- **knip:** Drop fetch_chat_link staging + unused MattermostPostList type

### Testing

- **settings:** Preset riskDefaults survives a later domain toggle
- **youtrack:** Align provider updateRelation test with structured /links flow
- **memory:** Cover recall cascade DM path (active-only, no provisional/promotion)
- **db:** Idempotency coverage for migration 058
- **announcements:** Include migration 058 in local migration list
- **run-control:** Assert steer-queue drain idempotency and compose drain
- **run-control:** Replace ts-expect-error with typed fakes in invoke-wiring test
- **run-control:** Assert RunAbortedError propagates completed effects
- **message-queue:** Make serialization test genuinely prove one-run-per-thread; fix stale comment
- **guest-mode:** Blocked-not-guest + buildFullToolSet guest-branch coverage; doc/comment fixups
- **mattermost:** Cover reply scope, 429/5xx mapping, identity dedup, gating
- **live-status:** Kontur omits createStatus; heartbeat passthrough
- **run-control:** Set up test DB for invoke-wiring suite
## [6.3.3] - 2026-06-16

### Added

- **debug:** Add allowlist log redactor for /debug egress (C)
- **debug:** SSE heartbeat + retry hint to survive idle proxies (#6)
- **debug:** Stamp server startedAt on turn:start (#11 server)
- **youtrack:** Fetch project field defaultValues + bundle-element schema
- **youtrack:** Cached bundle-element fetcher
- **youtrack:** Schema-driven custom-field engine with safe-exact value resolution
- **youtrack:** Required-field detection honors defaultValues + teaching errors
- **youtrack:** Route create_task fields through the resolution engine
- **youtrack:** DescribeProjectFields operation + provider delegate
- **tools:** Describe_project tool for YouTrack field discovery
- **tools:** Steer create_task toward describe_project for YouTrack field values
- **youtrack:** Teaching error listing available field names
- **youtrack:** Resolve dedicated params to real fields by type
- **youtrack:** Unify create/update on schema-driven field engine
- **memory:** Provisional record tier + extraction-state schema (056)
- **memory:** Persist thread_context_id + listProvisionalRecords
- **memory:** Cross_thread_memory feature flag
- **memory:** Cosine semantic ranking over record embeddings
- **memory:** Save records with populated embeddings
- **memory:** Extraction-state watermark store
- **memory:** Provisional capture executor
- **memory:** Idle-debounce capture armed from the turn path
- **memory:** Scheduler backstop sweep for dirty contexts
- **memory:** Promotion store mutations (promote/reject)
- **memory:** In-memory record ranking for recall layers
- **memory:** Hybrid promotion engine (threshold + LLM confirm)
- **memory:** 3-layer recall cascade with provenance
- **memory:** Recall tool wired into the cascade (normal mode, flag-gated)
- **memory:** Recall priority preamble in the system prompt
- **memory:** Promotion sweep + stop-rediscovering acceptance + flag-off parity
- **attachments:** Group_context_id columns (057)
- **attachments:** GroupContextId in drizzle schema
- **attachments:** Populate group_context_id at ingest
- **attachments:** Group-discoverable reads for group contexts
- **scope:** Declarative ENTITY_SCOPES registry + consistency test
- **settings:** Expose cross_thread_memory in the super-admin Feature flags UI

### Changed

- **youtrack:** Export normalize from field-engine for reuse
- **youtrack:** Address final-review findings

### Documentation

- **debug:** Design spec for /debug observability + privacy fixes
- **debug:** Implementation plan for /debug observability + privacy fixes
- **debug:** Clarify DEBUG_SERVER gate covers only live-observability paths (#10)
- **youtrack:** Design for custom-field reliability (discovery + field engine)
- **youtrack:** Implementation plan for custom-field reliability
- **youtrack:** Spec for dedicated-field localization & teaching errors
- **youtrack:** Implementation plan for dedicated-field localization & teaching errors
- **acp:** Add ACP agent sessions design spec
- **spec:** Cross-thread memory bridge & context-scope corrections design
- **plan:** Memory foundation implementation plan (1 of 3)
- **plan:** Recall cascade & promotion implementation plan (2 of 3)
- **plan:** Scope corrections & declarative registry plan (3 of 3)
- **plan:** Correct migration 056 note — CHECK constraint requires table recreation
- Document cross-thread memory bridge + scope corrections in CLAUDE.md

### Fixed

- **debug:** Emit llm:tool_result user-scoped to stop cross-context leak (A)
- **debug:** Key LLM traces on scope.userId so tool calls + userId populate (#2, B)
- **debug:** Redact log buffer at /logs and log:entry egress (C)
- **debug:** Unsubscribe onEvent when last SSE client dies on enqueue (#3)
- **test:** Update /logs text-search assertion after Task 4 redaction
- **debug:** Resolve in-flight turns in findTurnById (#5)
- **debug:** Newest-first init ordering + server turn startedAt (#4, #11 client)
- **debug:** Land dashboard sign-in on /debug, not /admin (#9)
- **youtrack:** Satisfy switch-exhaustiveness lint in field-engine
- **tools:** Address review findings on describe_project tool
- **youtrack:** Reject non-numeric values for integer/float custom fields
- **youtrack:** Derive field schema from a sample issue when admin endpoint is empty
- **youtrack:** Satisfy consistent-return in matchesType
- **youtrack:** Preserve provider binding in apply_youtrack_command
- **memory:** Rebuild FTS index after memory_records recreation (056)
- **memory:** Address Plan 1 review — semantic-search hydration, dead PRAGMAs, group no-op test
- **memory:** Term-based keyword recall for active records (layer 2)
- **memory:** Keep NULL-thread rows in sibling recall + recall tool registration parity tests
- **web:** Rate-limit web_fetch per user, not per group
- **attachments:** Make group-discovered files actionable (resolve/upload/delete) + correct web_rate_limit scope flag

### Miscellaneous

- **knip:** Register subscribeCountForTest test-only seam (Task 5)
- **memory:** Tag listProvisionalRecords @public (consumed by Plan 2)
- **memory:** Tag resolveCrossThreadMemoryFlag @public (consumed by T7/T8)
- **memory:** Tag listDirtyContexts @public (consumed by T9 sweep)
- **memory:** Drop stale knip file-ignores now that capture chain is wired
- **memory:** Drop stale knip file-ignores now that recall/promotion chain is wired

### Testing

- **debug:** Cover heartbeat dead-client drop path (#6)
- **debug:** Reset pendingTraces between trace-collector tests
- **debug:** Make SSE-lifecycle tests isolation-clean for serial CI
- **youtrack:** Isolate bundle-values cache test with unique config
- **youtrack:** Rename create tests to reflect bundle-less enum rejection
- **youtrack:** Update create/update mocks for schema-driven dedicated fields
- **attachments:** Update buildTools expectation for group-discoverable file tools
## [6.3.2] - 2026-06-13

### Fixed

- **plugins:** Lazy-require audio-transcribe zod modules so discovery accepts it
## [6.3.1] - 2026-06-13

### Fixed

- **dashboard:** Two-step claim consume to survive link-preview crawlers
## [6.3.0] - 2026-06-13

### Added

- **plugins:** Add attachments.read permission
- **plugins:** Expose attachments.read facade on tool runtime context
- **plugins:** Add audio-transcribe plugin with transcribe tool
- **attachments:** Add origin and forwarded_from columns (migration 054)
- **attachments:** Persist origin and forwarded_from through store and staged resolution
- **telegram:** Tag voice origin and capture forward attribution on extracted files
- **attachments:** Thread origin and forward attribution through ingest and staging
- **plugins:** Manifest schema for attachment transformers and config-sourced allowed hosts
- **plugins:** Attachment transformer contribution type and registration
- **plugins:** Context-scoped config facade and origin metadata on attachment records
- **plugins:** Admin-config-sourced dynamic hosts for plugin httpFetch
- **plugins:** Attachment transformer dispatch, timeout isolation, and line rendering
- **orchestrator:** Pre-turn attachment transforms, audio part suppression, unified turn text
- **bot:** Eagerly resolve voice-origin staged files before the turn
- **plugins:** Audio-transcribe v2 — voice transformer, execute-time config, cache pruning
- **plugins:** Context base_url override with strict credential pairing and two-tier host trust
- **deferred-prompts:** Mention-driven group reminder delivery + plugin docs

### Changed

- **plugins:** Split transcribe tool input parsing to satisfy function-size lint

### Documentation

- **specs:** Add audio-transcribe UX fixes design (attachment transformers)
- **plans:** Add audio-transcribe UX fixes implementation plan
- Attachment transformer hook — guide, ADR, supersede 2026-04-11 STT docs

### Fixed

- **plugins:** Pass lint/typecheck/format for audio-transcribe and split attachment types
- **db:** Idempotent migration 054 and test cleanups per review
- **attachments:** Review polish — mapping-convention comment, file-origin round-trip, static import
- **telegram:** Honest forward-attribution fallback, accurate docs, branch tests
- **plugins:** Close manifest schema gaps for transformers and config-sourced hosts
- **plugins:** Required transformer manifest field, registration permission guard, log scope
- **plugins:** Cross-plugin contextConfig isolation test and config-scope docs
- **plugins:** Redirect auth-stripping regression tests and dynamic-hosts operator feedback
- **plugins:** Bracket-injection sanitization and late-rejection handling in attachment transform
- **orchestrator:** Shared attachment-line rendering, transform budget, fast path, integration test
- **bot:** Resolve voice staged files post-coalescing with exception safety
- **bot:** Dedupe and bound voice staged resolution, gate lookup to groups
- **plugins:** Cache-before-quota in transcribe tool, richer failure reasons and tests
- **orchestrator:** Carry-over voice transcripts, config-before-quota, polish
- **plugins:** Address code-review issues from context base_url override
- **plugins:** Language normalization, user_config key index, base_url override docs and tests

### Miscellaneous

- Register audio-transcribe in knip ignore list and document attachments.read

### Testing

- **db:** Update last-migration assertion for 054
- **bot-attachments:** Exercise DM origin threading at the right layer; cover absent-field staging
## [6.2.0] - 2026-06-12

### Added

- **tools:** Per-context reduction feature flags with kill switch
- **compaction:** Envelope types and tuning constants
- **compaction:** Pure size-gate with failure/envelope/non-serializable guards
- **compaction:** Per-context TTL+LRU result store with injected clock
- **compaction:** Query-aware SMALL_MODEL summarizer with fallback
- **compaction:** Expand_result paging tool
- **compaction:** Per-turn result-compaction wrap layer
- **compaction:** Register expand_result when compaction flag is on
- **orchestrator:** Apply per-turn result compaction behind the flag
- **disclosure:** Core/meta tool-name constants and stall threshold
- **disclosure:** Tool-brief builder from descriptions + metadata
- **disclosure:** ToolRetriever interface + lexical implementation
- **disclosure:** Embedding-backed retriever with lexical fallback and brief cache
- **disclosure:** Turn-scoped DisclosureSession registry
- **disclosure:** Search_tools tool returning ranked schema-less briefs
- **disclosure:** Load_tool batch activation tool
- **disclosure:** PrepareStep factory with stall fallback
- **disclosure:** MaybeApplyDisclosure wiring helper
- **disclosure:** Discovery preamble in system prompt behind option
- **disclosure:** Thread DisclosureSession into generateText prepareStep
- **memory:** Token-based trim triggering and bounded trim prompt
- **memory:** Trust-labelled memory block with staleness and eviction (R-07)
- **admin:** Feature-flags snapshot and update module
- **admin:** Super-admin feature-flags settings API
- **settings-ui:** Feature-flags admin fetchers
- **settings-ui:** Super-admin feature-flags section
- **memory:** Add long-term memory schema
- **memory:** Normalize long-term memory scopes
- **memory:** Add long-term memory store
- **memory:** Inject bounded long-term context
- **memory:** Capture long-term memory in background
- **memory:** Expose long-term memory tools
- **memory:** Add settings API controls
- **memory:** Add settings memory controls
- **memory:** Retire stale long-term memories

### Changed

- **compaction:** Drop vestigial model field from summarizer DI contract
- **disclosure:** Document conditional expand_result membership, tighten union test
- **disclosure:** Distinct-term lexical scoring + rank contract docs
- **disclosure:** Require toolsForBriefs and hoist brief building
- **prompt:** Extract preference prompt lines into system-prompt-prefs
- **flags:** Export strict reduction-flags JSON parser

### Documentation

- **plan:** Re-anchor part 2 disclosure plan to post-part-1 code
- Document progressive disclosure flag behavior
- Design spec for PR #151 review-fix batch
- Implementation plan for PR #151 review-fix batch
- Reflect proactive gating, LRU store, and churn stall guard
- Note BYOK-aware semantic tool retrieval
- Design spec for admin feature-flags settings section
- Implementation plan for admin feature-flags section
- Feature flags managed in settings UI admin section
- Design long-term memory architecture
- Plan long-term memory implementation
- Clarify long-term memory schema split

### Fixed

- **compaction:** Require non-empty handle in envelope guard
- **compaction:** Type expand_result failure, kebab logger scope, TTL-expiry test
- **compaction:** Summarizer-dep rejection falls back to truncation envelope
- **config:** Invalidate tool descriptor cache on reduction-flag writes
- **compaction:** Clarify character-offset hint and evict empty context maps
- **disclosure:** First-sentence extraction skips single-letter abbreviations
- **disclosure:** Per-model embedding cache + dimension-mismatch guard
- **disclosure:** Expose defensive copy of session allNames
- **disclosure:** Only advertise expand_result in preamble when registered
- **disclosure:** Correlate fallback event with turnId
- **disclosure:** Stall guard ignores always-on loads; wrap meta tools in structured failures
- **compaction:** Expand_result failures carry the SDK toolCallId
- **disclosure:** One reduction-flag snapshot per turn
- **compaction:** True LRU result store and neutral unavailability message
- **disclosure:** Ask line no longer advertises ungated injected meta-tools
- **compaction:** Do not register expand_result on the proactive path
- **disclosure:** BYOK-aware tool retrieval with usage recording and throw-safe embeds
- **llm:** Shared memoized model builder; per-context summarizer credentials
- **llm:** Migrate remaining chat-model callsites; isolation-clean builder tests
- **llm:** Collision-proof provider cache key; cover default compaction deps
- **disclosure:** Catch post-load search/load churn with a latched stall guard
- **memory:** Preserve tool-call/result pairing during smart trim
- **conversation:** Guard against overlapping background trims
- **ci:** Run server test suite serially on CI runners
- **admin:** Exclude placeholder users from feature-flags roster
- **admin:** Feature-flags write uses PATCH; cover bot-admin write rejection
- **settings-ui:** Split sidebar builder; add feature-flags section test
- **memory:** Harden long-term memory schema
- **memory:** Isolate record store by scope type
- **memory:** Bound long-term record query
- **memory:** Isolate group memory profiles
- **memory:** Use group context for deferred memory
- **memory:** Bound memory tool inputs
- **memory:** Guard malformed settings record ids
- **memory:** Harden settings memory controls
- **memory:** Harden background memory extraction
- **settings-ui:** Drop duplicate ContextTaskInstanceResponseSchema alias

### Miscellaneous

- **compaction:** Lint/type/format/mutation cleanup for part 1
- **compaction:** Knip allowlist for store test seams + doc updates
- **disclosure:** Gate + mutation cleanup for part 2

### Testing

- **tools:** Pin reserved config key in feature-flags test
- **tools:** Cover scoped-context derivation and full corrupt-JSON shape
- **compaction:** Pin size-gate boundary, coherence, and undefined-serialization cases
- **orchestrator:** Harden compaction wiring test defaults and call assertion
- **disclosure:** Drop duplicate embedding retriever suite
- **disclosure:** All-unknown load batch + idempotent description
- **disclosure:** Reset emit mock per test and pin stall boundary
- **disclosure:** Pin load_tool registration and copy-on-write in wire
- **disclosure:** ActiveTools widening across a scripted loop
- **disclosure:** Flag-off keeps full eager tool set
- **disclosure:** Kill retriever and registry mutation survivors
- **disclosure:** Kill churn-guard mutants; log stall reason
- **settings-ui:** Pin feature-flags request body and wrong-type rejection
- Kill behavioral mutation survivors; fix client/ paired mutation support
- **admin:** Cover malformed-body 400 on feature-flags PATCH
- Replace leaky top-level mock.module with DI and real deps
## [6.1.7] - 2026-06-11

### Added

- **users:** Add pending-user placeholders and case-insensitive username binding
- **settings:** Shared user-id resolver with unresolved outcome
- **settings:** Pending user entries when username resolution fails
- **settings-ui:** Typed add-user response with pending flag
- **settings-ui:** Pending badge and first-contact message for username adds

### Changed

- **settings:** Share user-id resolution in group member route

### Documentation

- **specs:** Pending username entries design
- **plans:** Pending username entries implementation plan
- Document pending @username entries for authorized users

### Fixed

- **users:** Clarify pending-user dedupe log and exempt addPendingUser from knip until route lands
- **settings:** Treat empty username input as unresolved regardless of router
- **settings:** Distinguish already-authorized users from pending entries in add response

### Miscellaneous

- **mutation:** Ignore local agent-tool dirs in stryker sandbox copy

### Testing

- **settings:** Type resolver mock against ResolveUserContext and cover non-@ resolution
## [6.1.6] - 2026-06-10

### Fixed

- Pass platformInstanceId for username resolution in settings admin routes
## [6.1.5] - 2026-06-10

### Added

- **tools:** Add args to AskPermissionFn type
- **settings:** Support @username in admin users section
- **chat:** Add argument formatting functions
- **chat:** Update formatPrompt to include arguments
- Resolve @username to user ID server-side for admin and group member endpoints

### Fixed

- Add missing return type and void operator in test file
- Update tests for server-side username resolution

### Testing

- **chat:** Add unit tests for argument formatting
- **chat:** Update interaction router tests for args
## [6.1.4] - 2026-06-10

### Added

- **telegram:** Resolve usernames via getChat API
- **settings:** Support @username for member addition

### Changed

- Memoize expensive derivations in config-key, recurrence, and oracle
- Rewrite ai-progress-reporter formatting to use fenced code blocks and per-tool messages

### Documentation

- Add plans and specs for recent features

### Fixed

- Resolve no-await-in-loop lint error in progress reporter
- Restore formatError/formatErrorValue, sequential sends, formatCodeBlock reuse
- Update llm-orchestrator tests for new progress reporter format

### Miscellaneous

- **lint:** Remove papai-policy oxlint plugin and strict config

### Testing

- Enable parallel execution by default and fix isolation issues
- Add config-key memoization and recurrence edge-case coverage
- Eliminate fixed sleeps and public/ races in slow suites
- Cut fixed waits and per-test exec scans in slow suites
- Update ai-progress-reporter tests for new per-message format
## [6.1.3] - 2026-06-09

### Added

- **config:** Add AI-output keys and typed ConfigField controls
- **config:** Validate enum config fields against their options
- **config:** Surface AI-output fields from getConfigFieldsForContext
- **settings:** Forward control/options in config GET response
- **settings:** Parse control/options on client ConfigField schema
- **settings:** Render enum config controls via SegmentedControl
- **settings:** Add AI output settings section
- **settings:** Register AI output section in settings SPA

### Changed

- **config:** Exclude ai-output kind from required provider keys

### Documentation

- **spec:** AI output settings UI design
- **plan:** AI output settings UI implementation plan
- **adr:** Correct AI-output write-path reference (settings UI)
- Document AI output visibility settings (CLAUDE.md, README)

### Fixed

- **config:** Accept empty value for optional enum fields
- **settings:** Guard enum save re-entrancy; strengthen ConfigFieldRow tests

### Testing

- **config:** Cover isConfigKey for AI-output keys; clarify options field
- **settings:** Broaden AiOutputSection coverage; scope detail hint
- **settings:** Cover AI-output enum PATCH round-trip; fix plan doc
## [6.1.2] - 2026-06-09

### Added

- **byok:** Add llm credentials schema
- **byok:** Add encrypted llm credential store
- **byok:** Resolve effective llm config by context
- **byok:** Use context llm config in orchestrator
- **byok:** Use context llm config in helper calls
- Add isReplyToBot field to IncomingMessage type
- Process and observe group messages that reply to bot
- **telegram:** Set isReplyToBot when reply targets bot message
- **discord:** Add isReplyToBot parameter to mapDiscordMessage
- **discord:** Pre-fetch parent to detect reply-to-bot in groups
- **byok:** Add llm credentials schema
- **byok:** Add encrypted llm credential store
- **byok:** Resolve effective llm config by context
- **byok:** Use context llm config in orchestrator
- **byok:** Use context llm config in helper calls
- **settings:** Add byok llm api routes
- **settings:** Add byok client fetchers
- **settings:** Add byok llm UI

### Changed

- **instances:** Share encrypted secret payload crypto
- Remove getLlmConfig, update dashboard link format, revise reply-to-bot plan
- **instances:** Share encrypted secret payload crypto
- Remove getLlmConfig, update dashboard link format, revise reply-to-bot plan

### Documentation

- Add superpowers plans
- Clarify isReplyToBot undefined semantics
- Note reply-to-bot group processing for telegram and discord
- Note reply-to-bot group processing in README platform support
- Add superpowers plans

### Fixed

- **byok:** Require credential context id
- **byok:** Handle unreadable credential payloads
- **byok:** Sanitize unreadable credential errors
- **byok:** Pass config context to helper llm calls
- **discord:** Log parent-fetch failure and cover reply-to-bot negative branches
- **byok:** Require credential context id
- **byok:** Handle unreadable credential payloads
- **byok:** Sanitize unreadable credential errors
- **byok:** Pass config context to helper llm calls
- **byok:** Pass config context to conversation trim
- **byok:** Keep deferred context mode on main model
- **settings:** Preserve byok unreadable metadata
- **settings:** Clear byok drafts on context changes
- **byok:** Handle optional clears and unreadable context state

### Testing

- **byok:** Cover llm credential regressions
## [6.1.1] - 2026-06-08

### Added

- **settings:** Rename design tokens to spec vocabulary with legacy aliases
- **settings:** Add type-scale utilities, content-cap and rhythm layout classes
- **settings:** Grouped sidebar rail with aria-current + responsive jump menu
- **settings:** Group sections into Personal/Integrations/Admin with grouped rail
- **settings:** Collapse per-section Refresh to icon button; normalize Provision Kaneo
- **settings:** Approve=primary, reject=danger; audit status pills for green-only-primary
- **settings:** Segmented control for 3-state tool permissions
- **settings:** Bullet-mask secrets and use secondary Replace button
- **settings:** Compact System (LLM) kv inline-edit table
- **settings:** Separate instance create-card from instances table
- **settings:** Reusable SettingsTable with search, pagination, sticky header, hover
- **settings:** Destructive confirmations + middle-truncated copyable IDs
- **settings:** Admin danger zone + confirm steps for announce and secret keys
- **settings:** Eyebrow/contrast/focus consistency pass

### Changed

- **settings:** Use declarative onchange in jump menu; bubble change in test

### Documentation

- Add byok llm credentials design

### Fixed

- **settings:** Preserve --fg4 ghost shade, drift-proof --state-active, widen alias test
- **settings:** Keep LLM edit row open on save failure; cover cancel/empty/error paths
- **settings:** Confirm Instances stop; CopyButton awaits clipboard write
- **settings:** Guard CopyButton without clipboard; aria-current=page; stable confirm labels

### Miscellaneous

- Remove docs/architecture and architecture-refresh system
- **knip:** Ignore .svelte-only exports for settings mask/truncate utils

### Testing

- **settings:** Assert sidebar kickers specifically; clarify super-admin path
- **settings:** Cover SegmentedControl arrow-key cycling
## [6.1.0] - 2026-06-05

### Added

- **client/ui:** Map log levels and retriable in statusTone
- **client/ui:** Map warn and info log levels in statusTone
- Add providerless task tracker fallback
- **client/ui:** Add multiline (textarea) mode to Input
- **settings:** Bind context to task instance + HTTPS-gated session cookie
- **scripts:** Add architecture refresh config
- **scripts:** Render architecture refresh reports
- **group-settings:** Add listKnownGroupContextsForPlatform reader
- **settings:** Auto-scope raw group ids when authorizing a group
- **settings:** Return observed unauthorized groups from admin groups GET
- **settings:** Add observed groups to admin groups response schema
- **settings:** Observed-group pick-list and raw-id field in AdminGroupsSection
- **mattermost:** Add action signing secret
- **mattermost:** Sign action contexts
- **mattermost:** Render reply buttons
- **chat:** Route permission button callbacks
- **mattermost:** Add action callback registry
- **mattermost:** Dispatch action callbacks
- **mattermost:** Expose action callback route

### Changed

- **settings:** Dedup authorized-group lookup in admin groups GET

### Documentation

- **claude:** Condense CLAUDE.md to ~21k chars
- Write ADR-0124 through ADR-0167 for implemented plans, archive specs and plans
- Prune ADR 0001-0100, archive pre-May-20 specs; add commit hashes to ADR index
- Add dependency-cruiser architecture refresh design
- **settings:** Design spec for Admin Groups authorization UX
- **settings:** Implementation plan for Admin Groups authorization UX
- Add architecture refresh implementation plan
- Add Mattermost buttons design
- Add Mattermost implementation plan
- **specs:** Tool-context reduction design (progressive disclosure + result compaction + semantic tool retrieval)
- **plans:** Tool-context reduction implementation plans (part 1 flags+compaction, part 2 disclosure+retrieval)
- Reduce architecture refresh artifacts
- Reduce architecture refresh artifacts

### Fixed

- **telegram,tests:** Make dispatchCallbackQuery mockable, drop check.sh concurrency, tighten test isolation
- **admin:** Render system summary via SummaryList (B6)
- **debug:** Close control via Btn in DebugDetailRail
- **debug:** LogExplorer via Panel/Toolbar/Select/Input/Btn
- **debug:** NotificationsPanel via Panel/EmptyState/JsonCell
- **debug:** ToolFailuresPanel via Panel/EmptyState/StatusPill
- **debug:** LiveContextCard via Panel/EmptyState
- **debug:** SessionsList via Panel
- **debug:** TraceList via Panel/EmptyState + fmtNum duration
- **debug:** Explicit StatusPill for SessionCard active state
- **debug:** SessionDetail via SummaryList/KV/DataTable
- **debug:** TraceDetail via SummaryList/StatusPill + fmtNum
- **debug:** LogDetail meta via SummaryList with level pill
- **debug:** TurnsPanel empty via EmptyState
- **settings:** Adopt Secret/Input/Btn in ConfigFieldRow
- **settings:** Adopt Btn/EmptyState in ProfileSection
- **settings:** Adopt Btn/EmptyState/SummaryList/Secret in TaskProviderSection
- **settings:** Adopt Btn/Pill/EmptyState in ToolsSection (expand stays raw for aria)
- **settings:** Adopt Field/Input/Btn in IdentitySection
- **settings:** Adopt Field/Input/Btn/DataTable in MembersSection
- **settings:** Adopt Field/Select/Btn in GroupProviderSection
- **settings:** Adopt Btn/Pill/Field/Input/EmptyState in PluginsSection
- **settings:** Adopt Field/Input/Btn in McpSection (checkbox stays native)
- **settings:** Adopt Field/Input/Btn/DataTable in AdminAdminsSection
- **settings:** Adopt Field/Input/Btn/DataTable in AdminGroupsSection
- **settings:** Adopt Field/Input/Btn/DataTable in AdminUsersSection
- **settings:** Adopt multiline Input + Btn in AdminAnnounceSection
- **settings:** Adopt DataTable/StatusPill/Btn in AdminPluginsApprovalSection
- **settings:** Adopt Secret/Field/Input/Btn/EmptyState in AdminPluginsConfigSection
- **settings:** Adopt Secret/Field/Input/Btn in AdminSystemSection
- **settings:** Adopt Field/Input/Select/Btn/DataTable/StatusPill in AdminInstancesSection
- **settings:** Migrate all section headers to PageHeader (B1)
- **settings:** Show editor for unset secret config fields
- **scripts:** Tighten architecture refresh scope
- **scripts:** Restore architecture refresh runtime scope
- **scripts:** Share depcruise config
- **auth:** Key bot-admin DM context off user id, not channel id
- **tests:** Assert depcruise options identity
- **scripts:** Normalize architecture refresh graph
- **scripts:** Keep shared runtime buckets in normalize
- **tests:** Cover shared runtime allowlist
- **scripts:** Curate architecture refresh outputs
- **scripts:** Finalize architecture refresh generator
- **scripts:** Resolve graphviz dot from PATH
- **scripts:** Stabilize dot fallback selection
- **scripts:** Wait for child stdio close
- **scripts:** Fail architecture refresh without graphviz
- **scripts:** Preflight graphviz before writes
- **scripts:** Prove graphviz preflight render
- **workflows:** Serialize architecture refresh runs
- **workflows:** Watch architecture refresh inputs
- **scripts:** Align architecture refresh CI and mapping
- **scripts:** Align architecture refresh outputs
- **workflows:** Align architecture refresh scope
- **settings:** Normalize thread-scoped group ids to main context on authorize
- **deps:** Bump vite to ^6.4.2 to patch GHSA-4w7w-66w2-5vf9
- **server:** Start web UI server unconditionally
- **mattermost:** Reference action signing secret
- **mattermost:** Harden action signature verification
- **mattermost:** Compare canonical action signatures
- **chat:** Bind permission callbacks to context
- **mattermost:** Preserve action thread context
- **mattermost:** Bind actions to channel

### Miscellaneous

- Remove architecture inventory tooling
- **settings:** Remove dead shadow-styling rules superseded by the kit
- **knip:** Allow pending Mattermost action signing
- **mattermost:** Mark pending action verifier internal
- **mattermost:** Update action callback maintenance

### Testing

- **scripts:** Cover architecture refresh triggers
- **scripts:** Assert architecture refresh PR base
- **scripts:** Scope architecture refresh workflow checks
- **group-settings:** Cover empty-result case for platform reader
- **settings:** Assert observed group leaves list and renders parent after authorize
- **startup:** Reset startup guard mock
- **mattermost:** Update capability expectations
- **mattermost:** Cover permission action callbacks
- **mattermost:** Verify signed prompt content
- **mattermost:** Cover provider action dispatch
- **mattermost:** Assert action platform context
- **startup:** Restore debug server mock

### Ci

- **workflows:** Add architecture refresh workflow
## [6.0.6] - 2026-06-02

### Fixed

- **client/ui:** Only render Secret reveal button when onReveal is provided
- **plugins:** Apply approval changes without restart
- **db:** Scope legacy context ids left raw by migration 043
- **ci:** Set DB_PATH in docker smoke test so the bun user can write the db
- **ci:** Pin buildx to host docker driver so smoke test sees the built image

### Testing

- **admin:** Assert StatusPill renders for memos/reminders status (B4 guard)
## [6.0.5] - 2026-06-02

### Fixed

- **admin:** Contain Reminders filter + StatusPill status (A7/B2/B3/B4)
- **admin:** Adopt Input/Btn/StatusPill in MemosSection (B2/B3/B4)
- **admin:** Adopt Input/Btn in IdentitiesSection (B2/B3)
- **admin:** Adopt Btn for Groups refresh/revoke (B2)
- **admin:** Adopt Btn for Billing refresh (B2)
- **admin:** Render recent-request status as StatusPill (B4)
- **admin:** Adopt Secret/Input/Btn in CredentialsForm, drop duplicate heading (C2/B2/B3/B7)
- **admin:** Panel-wrap plugin groups, adopt Secret/Input/Btn (B7/B2/B3/C2)
- **deploy:** Use compose status filter for backup gate
## [6.0.4] - 2026-06-01

### Added

- **kaneo:** Export kaneoProvision hook for HTTP route dispatch
- **kaneo:** Register kaneoProvision hook via plugin registry
- **client/ui:** Add optional titleTestId prop to PageHeader
- **client/ui:** Add optional testid pass-through to Btn
- **client/ui:** Add password type and testid to Input
- **client/ui:** Add optional testid pass-through to Select

### Changed

- **plugins:** Thread TaskProviderProvision through registration pipeline
- **admin:** Consolidate byte formatting onto shared fmtBytes
- **admin:** Consolidate SubjectsTable tests, carry row subject ref (review fixes)
- **settings:** Dispatch provision via plugin registry, remove plugins/ import

### Documentation

- **plan:** Backstage phases 2.2-2.5 implementation plans
- **plan:** Backstage phase 3.1 /debug kit sweep implementation plan
- **plan:** Backstage phase 3.2 /settings user sections kit sweep
- **plan:** Backstage phase 3.3 /settings admin sections + cleanup
- **plan:** Record /stats aggregation verification findings (phase 2.1)
- **plugins:** Document kaneoProvision hook in developer guide

### Fixed

- **admin:** Render SubjectsTable via DataTable with right-aligned formatted numerics (A1/A4)
- **admin:** Render active subjects via Stat to flag over-capacity (A5)
- **admin:** Render surface mix via Meter with clamped over-capacity (A6)
- **admin:** Render Stats header via PageHeader (B1)
- **admin:** Render System header via PageHeader, drop duplicate eyebrow (B1)
- **admin:** Render Instances header via PageHeader (B1)
- **admin:** Render Plugin Config header via PageHeader (B1)
- **client/ui:** Restore controlled value + delegated oninput on Input (keep testid/password)
- **client/ui:** Restore delegated onchange on Select (keep testid)
- **admin:** Adopt Btn/Input/Select/StatusPill/JsonCell in InstancesSection (B2/B3/B4/B5)
- **kaneo:** Repair legacy plugin setup flow
- **startup:** Gate kaneo repair by activated plugins

### Miscellaneous

- **client:** Fix status-tone import and knip allowlist
- **check:** Parallelize test runs by cpu count

### Styling

- **admin:** Alphabetize PageHeader import in StatsPanel

### Testing

- **settings:** Reduce auth db setup scope
- **admin:** Regression guards for tool-calls chart/header (A2/A3); C1 covered by Bars tests
- **kaneo:** Cover kaneoProvision hook delegates to provisionAndConfigure
- **kaneo:** Verify kaneoProvision forwards all four fields

### Ci

- Smoke-test the built Docker image to catch boot-time crashes
- **smoke:** Move smoke into build job, tolerate created state, preflight image
## [6.0.3] - 2026-06-01

### Added

- **plugins:** Surface directoryMissing in DiscoveryResult
- **client/ui:** Add fmtNum and fmtBytes formatting helpers
- **client/ui:** Add statusTone status-string mapping
- **client/ui:** Add StatusPill component
- **client/ui:** Add PageHeader component
- **client/ui:** Add Field labeled-control component
- **client/ui:** Add FormRow component
- **client/ui:** Add Toolbar component
- **client/ui:** Add Tag attribute-badge component
- **client/ui:** Add Code value-chip component
- **client/ui:** Add JsonCell key-value chip component
- **client/ui:** Add Secret masked-value component
- **client/ui:** Add EmptyState component
- **client/ui:** Add Meter clamped ratio-bar component
- **client/ui:** Add Stat value-of-total component
- **client/ui:** Add SummaryList key-value component

### Changed

- **providers:** Add TaskProviderProvision hook to plugin-contributed registry

### Documentation

- Add plugins deployment safety plan
- **spec:** Backstage admin UI kit additions & audit fixes design
- **plan:** Backstage kit additions phase 1 implementation plan
- **plan:** Mark plugins deployment safety Task 1 complete
- **plan:** Backstage phase 2.1 numbers/tables/guards implementation plan

### Fixed

- **client:** Make shell body the scroll container so main content scrolls
- **settings:** Only disable plugin toggle for inactive plugins awaiting approval
- **plugins:** Fail fast at startup when DEBUG_SERVER=true and plugins/ is missing
- **client/ui:** Mono font for Meter value, .js extension on StatusPill import

### Miscellaneous

- Switch test script to bun test auto-discovery
- Include prior session dashboard.ts and CLAUDE.md changes
- Remove test suites from check:full stop hook, fix lint/format issues
- Add --skip-tests flag to check:full, stop hook skips tests
- **opencode:** Remove legacy pi wiring
- **knip:** Ignore forward-compat TaskProviderProvision export and svelte-consumed client ui

### Styling

- **client/ui:** Use mono font for Stat value per design system

### Testing

- **startup-guard:** Assert warn reason mentions degraded mode
- **providers:** Cover getTaskProviderProvision lookup
## [6.0.2] - 2026-06-01

### Fixed

- **docker:** Copy plugins directory into image
## [6.0.1] - 2026-06-01

### Miscellaneous

- **deps:** Move typescript from devDependencies to dependencies
## [6.0.0] - 2026-06-01

### Added

- **db:** Add drizzle schema for platform/task/context/admin instance tables
- **db:** Add migration 040 for platform/task/context/admin instance tables
- **db:** Register migration 040 in MIGRATIONS list
- **instances:** Add AES-256-GCM encryption helper with masking
- **instances:** Add encrypted CRUD for platform_instances
- **instances:** Add encrypted CRUD for task_instances
- **instances:** Add context_settings store with indexed lookups
- **instances:** Add admin store with super-/platform-admin union check
- **instances:** Add idempotent env→DB bootstrap for instance rows
- **startup:** Call bootstrapInstancesFromEnv after initDb
- Add context task provider resolver
- Derive config keys from context assignment
- Apply context config keys to setup UI
- Select task instance during setup
- Drive setup from context task assignment
- Resolve task provider by context for llm
- Resolve scheduled task providers by context
- Wire startup to task provider resolver
- **chat:** Require platform instance on inbound chat events
- **chat:** Create platform providers from instance config
- **chat:** Add multi-instance ChatRouter
- **chat:** Route command helpers through source platform instance
- **chat:** Resolve proactive delivery platform instances
- **chat:** Pass platform instance ids for proactive sends
- **chat:** Start runtime through ChatRouter
- **auth:** Scope authorized users by platform instance
- **auth:** Authorize admins from instance admin rows
- **commands:** Scope plugin admin actions
- **commands:** Scope user management by platform instance
- **commands:** Scope plugin admin actions
- **chat:** Expose runtime router for instance apply
- **debug:** Add instance management API routes
- **admin:** Add instance API client helpers
- **admin:** Add instances dashboard section
- **plugins:** Evaluate compatibility across instances
- **plugins:** Collect startup capabilities by instance
- **plugins:** Gate eligibility by context capabilities
- **plugins:** Guard scheduled jobs by eligibility
- **stories:** Phase A — storybook + vite scaffold
- **stories:** Phase B — mock layer (fixtures, MSW, SSE stub, decorators)
- **stories:** Phase C — vertical-slice stories proving every mock layer
- **stories:** PR 2 — shared/ui primitive stories
- **stories:** PR 3a — shared composite stories
- **stories:** PR 3b — admin component stories + SubjectStats fixture
- **stories:** PR 3c — debug component stories + debug fixtures
- **stories:** PR 4 — admin sections + DebugApp shell
- Add ai output settings model
- Add ai progress reporter
- Add ai output config controls
- Route tool progress through reporter
- Show configured ai output details
- **tools:** Add per-context tool preferences module + cache prefix clear
- **tools:** Filter disabled tools out of makeTools by context preferences
- **prompt:** Compose system prompt from tool-gated fragments + safety-net line
- **prompt:** Pass effective enabled tool set into system-prompt builders
- **config:** Add Tools toggle section to /config with tgl: interaction handler
- **plugins:** Add provider.task and identity permissions
- **plugins:** Add task provider type manifest fields and validation
- **providers:** Add contributed task provider registry map
- **plugins:** Add registerTaskProviderType to plugin registration
- **plugins:** Add provider.task-gated providerRuntime facade
- **plugins:** Add identity-gated ctx.identity facade
- **plugins:** Unregister contributed provider type on plugin teardown
- **time:** Add formatCurrentTimeTag helper
- **time:** Inject current_time tag into live user turns
- **time:** Document current_time tag in TIME system prompt
- **time:** Document current_time tag in TIME system prompt
- **ui:** Add icon Snippet prop to Btn
- **ui:** Add pad prop to Panel body
- **ui:** Accept Snippet for KV.v
- **ui:** Make TopBar.statusRow optional
- **providers:** Add TaskProviderTypeDescriptor + listTaskProviderTypes for built-ins
- **providers:** Contributed task provider types expose displayName and configSchema in catalog
- **instances:** Open TaskInstanceType union and resolve contributed types via instance config
- **admin:** Serve task provider type catalog and validate instance type against it
- **admin-client:** Add task provider type catalog fetcher and open task instance type
- **admin-client:** Drive task instance form from the provider type catalog
- **providers:** Add scope field to provider config requirements
- **providers:** Complete built-in provider descriptors with scoped fields
- **instances:** Descriptor-sensitive config masking
- **instances:** Invoke provider config validator before persisting task instances
- **providers:** Add papai/plugin-types stable import alias
- **admin:** Update instance configs in place
- **db:** Enforce multi-provider integrity
- **providers:** Split task provider descriptors
- **debug:** Expose split task provider catalog
- **chat:** Add platform provider catalog
- **admin:** Render platform instances from catalog
- **config:** Support dynamic provider context fields
- **providers:** Resolve plugin context credentials
- **tools:** Gate provider-specific behavior by traits
- **instances:** Standardize provider baseUrl config
- **debug:** Mask instance configs from provider schemas
- **mcp:** Add types and Zod schemas for MCP endpoint configs
- **mcp:** Add types and Zod schemas for MCP endpoint configs
- **mcp:** Add connection pool for MCP client management
- **mcp:** Add connection pool with idle timeout and reconnect
- **mcp:** Add tool adapter for MCP-to-AI-SDK tool conversion
- **mcp:** Add user-configured MCP endpoints with ToolSet builder
- **plugins:** Add mcp field to plugin manifest schema
- **mcp:** Add plugin-manifest endpoint resolution
- **mcp:** Wire MCP tool builders into makeTools pipeline (async)
- **tools:** Add 'mcp' domain to ToolDomain and detect mcp_* tools in getToolMetadata
- **debug:** Add MCP status read-only route
- **plugins:** Add http permission for outbound HTTP access
- **plugins:** Add admin-scoped plugin config with scope field and store functions
- **plugins:** Add adminConfig facade to PluginContext
- **plugins:** Check admin-scoped config in eligibility using system_config
- **plugins:** Expose rate limiter on plugin tool runtime context
- **debug:** Add admin plugin config routes for dashboard management
- **admin:** Add plugin config UI section
- **plugins:** Add synthetic-web-search plugin with search tool and prompt fragment
- **dashboard-auth:** Add dashboard_claims and dashboard_sessions tables
- **dashboard-auth:** Add session cookie parser and formatter
- **dashboard-auth:** Add claim and session DB store
- **dashboard-auth:** Public claim and session API
- **dashboard-auth:** Periodic sweeper for expired claims and sessions
- **debug-server:** Replace DEBUG_TOKEN gate with dashboard session auth
- **debug-server:** Add /auth/claim, /auth/logout, /auth/whoami
- **commands:** Add /dashboard claim-link issuer
- **startup:** Warn on legacy DEBUG_TOKEN; start dashboard-auth sweeper
- **client-admin:** Gate admin UI on /auth/whoami; add sign-in screen and logout
- **client-debug:** Gate debug UI on /auth/whoami
- **hooks:** Add changedSourceFiles and docReviewSuggested to session state
- **hooks:** Add doc mapping module for source file changes
- **hooks:** Add doc review prompt builder module
- **hooks:** Add source file tracking predicate module
- **hooks:** Add Claude Code doc-review stop hook
- **hooks:** Add OpenCode doc-review plugin
- **hooks:** Wire up source file tracking in existing TDD hooks
- **hooks:** Register doc-review hooks in configuration
- **plugins:** Expose identity facade to tools
- **hooks:** Add changedSourceFiles and docReviewSuggested to session state
- **hooks:** Add doc mapping module for source file changes
- **hooks:** Add doc review prompt builder module
- **hooks:** Add source file tracking predicate module
- **hooks:** Add Claude Code doc-review stop hook
- **hooks:** Add OpenCode doc-review plugin
- **hooks:** Wire up source file tracking in existing TDD hooks
- **hooks:** Register doc-review hooks in configuration
- **commands:** Add telegram publication catalog
- **telegram:** Derive command scopes from catalog
- **group-settings:** Surface newly authorized telegram groups
- **mattermost:** Require mention-prefixed commands
- **mattermost:** Guide mention-only messages
- **plugins:** Accept camelCase provider field keys in manifest schema
- **plugins:** Scaffold task-provider-kaneo manifest and entry shell
- **plugins:** Wire task-provider-kaneo factory and validateConfig
- **kaneo:** Migrate context credentials to plugin-namespaced config keys
- **instances:** Warn at startup about unresolvable task provider plugins
- **admin:** Label task instances whose provider plugin is not active
- **plugins:** Scaffold task-provider-youtrack manifest and entry shell
- **plugins:** Wire task-provider-youtrack factory and capabilities
- **youtrack:** Migrate context token to plugin-namespaced config key
- Add safe chat router config fingerprints
- Reconcile platform instances on apply
- Honor plugin provider metadata
- **tools:** Add resolveToolPermission for tri-state ToolPrefs
- **tools:** Lazy migration of legacy tool_prefs to tri-state
- **tools:** Tri-state cycle + domain summary in ToolPrefs
- **tools:** Permission_denied result shape
- **tools:** ExtendSchemaForAsk adds _permission_reason field
- **tools:** GatedExecute permission wrapper
- **tools:** MakeToolsOptions.askPermission
- **tools:** Apply tri-state preferences and gate ask tools
- **tools:** Cache descriptors; apply tri-state prefs per turn
- **chat:** AskPermissionViaChat with pending-request registry
- **chat:** HandlePermissionInteraction for perm: callbacks
- **chat:** Route perm: callbacks to permission handler
- **system-prompt:** Announce ask tools and require _permission_reason
- **commands:** 3-state markers and footer hint in tool config view
- **chat:** Tool/domain taps cycle through allow/ask/deny
- **commands:** External pseudo-domain in tool config view
- **commands:** /config Tools summary counts blocked and ask
- **chat:** Add Kontur Talk reply helpers
- **kontur-talk:** Add context renderer and label helpers
- **chat:** Add KonturTalkChatProvider main class with poll loop and sendMessage
- **kontur-talk:** Implement handleUpdate message handling
- **kontur-talk:** Register provider in registry, bootstrap, and env validation
- **kontur-talk:** Add admin dashboard and platform store support
- **mutation:** Add paired-config builder (ignoreStatic:false per file)
- **mutation:** Add per-file test-set override resolver
- **mutation:** Add per-file Stryker report aggregator
- **mutation:** Add paired-run orchestrator + test:mutate:file CLI
- **mutation:** Add changed-files paired runner + test:mutate:changed-paired CLI
- **mutation:** Repoint mutation scripts to paired runner
- **mutation:** Quiet paired runner output
- **plugins:** Add scheduled job runtime context
- **settings:** Add public base-url config and link builder
- **settings:** Add crypto helpers for codes and sessions
- **settings:** Add 047 migration and schema for auth codes, sessions, rate limit
- **settings:** Add single-use auth-code store
- **settings:** Add SQLite-backed session store with CSRF rotation
- **settings:** Add parameterized rate limiter
- **settings:** Log allowed quota consumption; test actor isolation
- **settings:** Add link-issuance service
- **settings:** Add per-request principal resolution
- **settings:** Add server-side scope guard
- **settings:** Add available-context listing
- **settings:** Add cookie helpers and request authentication
- **settings:** Add exchange, logout, and bootstrap route handlers
- **settings:** Wire trust-isolated /settings router into debug server
- **settings:** Issue settings link from /config when configured
- **settings:** Shared response/auth/scope helpers for /settings/api
- **settings:** /settings/api router skeleton wired into settings-router
- **settings:** Add principal display + /settings/api/bootstrap alias
- **settings:** Config GET/PATCH route backed by existing validators
- **settings:** Tools GET + toggle backed by tool-preferences
- **settings:** Structured MCP endpoint GET/PUT with masked-header preservation
- **settings:** Plugins GET + toggle + config (manifest-validated)
- **settings:** Identity GET/PUT/DELETE for manual provider linking
- **settings:** Kaneo auto-provision route with one-time credential reveal
- **settings:** Group members + group task-instance selection routes
- **settings:** Admin instance + provider-type wrappers (session-authorized)
- **settings:** Admin system/LLM + users + groups wrappers
- **settings:** Admin roster (SA) + plugin approval (SA) + announce wrappers
- **settings:** Serve client/settings bundle as public static assets
- **settings:** Response schemas for the settings SPA
- **settings:** Typed fetch layer with CSRF + 401 handling
- **settings:** Reactive session store with bootstrap + expiry
- **settings:** Scroll-spy hook
- **settings:** Top bar with context switcher
- **settings:** Role-gated sidebar navigation
- **settings:** Reusable config field row
- **settings:** Profile section
- **settings:** Task provider section with Kaneo provision
- **settings:** Tools section with domain drill-down
- **settings:** Structured MCP endpoints section
- **settings:** Plugins section (per-context enable + config)
- **settings:** Identity mapping section
- **settings:** Group members section
- **settings:** Group task-provider selection section
- **settings:** Admin instances section
- **settings:** Admin system/LLM section
- **settings:** Admin users section
- **settings:** Admin groups section
- **settings:** Admin roster section (SA)
- **settings:** Plugin approval section (SA)
- **settings:** Announce section
- **settings:** Root app shell with role + context gating
- **settings:** SPA entry point with session bootstrap
- **retirement:** /config is launcher-only (drop legacy in-chat editor)
- **retirement:** Remove /setup; delete wizard + group-settings selector
- **retirement:** Remove /plugin (admin plugin mgmt is UI-only)
- **retirement:** Remove /group and /groups (membership + auth move to UI)
- **retirement:** Remove /user, /users, /announce commands (keep broadcast fn)
- **settings:** MCP endpoint headers and tool-filter editing in the web UI
- **settings:** Admin plugin-config management in the web UI
- **shared/ui:** Add DataTable primitive
- **shared/ui:** Add MetricCard primitive
- **stories/msw:** Add pluginConfigHandlers family
- **stories/msw:** Wire plugin-config and instances into admin scenarios
- **stats:** Add tool-call totals and 30d growth to global stats
- **admin/llm:** Expose per-credential required flag
- **admin/identity:** Add admin-wide identity mappings list endpoint
- **admin/groups:** Add DELETE /auth/groups/:id route
- **config-keys:** Add descriptor-driven required provider key resolver

### Changed

- Let resolver handle kaneo workspace setup
- Remove task provider factory
- **chat:** Clean router lifecycle implementation
- **chat:** Split discord command matching
- **providers:** Merge TaskProviderPhaseFive into TaskProvider, split TaskCapability into dedicated module
- **providers:** Unify factory type and ignore staged contributed-registry exports in knip
- **time:** Assign hour once + cover midnight in formatCurrentTimeTag
- **admin:** Kill .panel CSS-class collision, hoist padding to .admin-section
- **providers:** Correct listTaskProviderTypes doc and tighten built-in catalog test
- **instances:** Centralize BuiltinTaskType guard and make types test behavioral
- **debug:** Share jsonResponse helper and name TaskProviderTypeView; tighten route tests
- **providers:** Descriptor-driven resolver merge; Kaneo credential branching in factory
- **providers:** Source built-in capabilities from descriptors
- **debug-server:** Drop DEBUG_TOKEN checks; rely on session auth
- **kaneo:** Single-source workspaceId in user_config
- **kaneo:** Move provider source into plugins/task-provider-kaneo
- **kaneo:** Move tests under tests/plugins/task-provider-kaneo
- **providers:** Drop inline kaneo factory and built-in descriptor
- **providers:** Drop resolver kaneo-workspaceId special case
- **instances:** Drop task-instance env bootstrap
- **kaneo:** Delete dead getKaneoWorkspace/setKaneoWorkspace helpers and workspace cache
- **youtrack:** Move provider source into plugins/task-provider-youtrack
- **youtrack:** Move tests under tests/plugins/task-provider-youtrack
- **providers:** Drop inline youtrack factory and built-in descriptor
- **providers:** Drop legacy descriptor.configSchema, legacyConfigSchema, and contributed configSchema fallback
- **providers:** Drop vestigial TaskProvider.configRequirements and dead ProviderConfigRequirement re-export
- Construct chat adapters from typed config
- Remove legacy provider config schema paths
- Remove unused chat registry export
- Remove obsolete multi-provider compatibility helpers
- Require explicit chat instance ids
- **tools:** Tri-state partitionToolNames; drop isToolEnabled
- **tools:** Drop temporary toggle/isToolEnabled shims
- **tools:** Drop redundant wrapToolExecution on ask path
- **plugins:** Extract discovery graph walker
- **providers:** Route auto provision through descriptors
- **settings:** Exercise schema barrel and export rate-limit row type
- **settings:** Build settings URL from a captured base, drop dead recheck
- **settings:** Drop redundant buildSettingsUrl in favor of buildSettingsUrlFromBase
- **settings:** Drop unused methodNotAllowed export from api-router
- **commands:** Extract reusable broadcastMessage from /announce
- **settings:** Shared admin guard; consistent 422 for unknown LLM key; cover admin paths
- **settings:** Hoist admin response types to fetcher-schemas (single source)
- **settings:** Top bar reuses shared Select + sign-out test
- **retirement:** Interaction router has no config-flow routes
- **retirement:** Non-command text goes straight to the orchestrator (remove interception)
- Require explicit provider instance config
- Remove stale multi-provider cleanup paths
- Remove unused platform store export
- **config:** Derive sensitivity from provider descriptors
- **wizard:** Drive prompts and validation from descriptor metadata
- **config-keys:** Use descriptor label, drop dead youtrack_token branch
- **types:** Drop legacy provider keys from canonical ConfigKey union
- **discord:** Remove env read and dead adminUserId threading
- **bootstrap:** Remove dead narrowing branch via typed collectMissing
- **router:** Rename removeInstanceStrict to removeInstance
- **apply:** Drop never-emitted 'stop' from ApplyFailureAction
- **resolver:** Early-return null on unknown provider descriptor
- **kaneo:** Read internalUrl through a typed accessor
- **plugins:** Thread validateConfig at registration instead of post-hoc mutation

### Documentation

- **plan:** Add Phase 1 instance data model implementation plan
- Apply markdown formatter normalization to multi-provider plan + specs
- **claude:** Document INSTANCE_CONFIG_KEY and src/instances module
- Align phase 2 resolver plan
- Adjust phase 2 config key sequencing
- Align task provider resolver phase
- Fix resolver plan log object
- Align resolver plan verification
- Plan multi-provider chat router phase
- Plan multi-provider phase 4 admin dashboard
- Align phase 4 admin dashboard spec
- Plan multi-provider phase 5 plugin alignment
- Plan multi-provider stabilization
- Sync stabilization migration scope
- Mark multi-provider stabilization implemented
- **spec:** Storybook harness design for dashboard UI
- **plan:** PR 1 (vertical slice) implementation plan for storybook harness
- **spec:** Provider-as-plugin designs + 3rd-party trust research
- **plan:** Task-provider-as-plugin Phase 1 implementation plan
- **spec:** Mutation measurement & test-quality investigation design
- **plan:** Mutation-measurement & test-quality investigation plan
- **spec:** User-configurable tool access (tool toggles) design
- **research:** Scaffold mutation measurement findings report
- **research:** A1 baseline mutant status breakdown
- **plan:** User-configurable tool access implementation plan
- **research:** A2 runner static-vs-perTest bucketing mechanism
- **plan:** Apply formatter to tool-access plan
- **research:** A3 reproduce static collapse on column-resource
- **spec:** Ai output visibility design
- **research:** A4 concurrency variable test
- **research:** A5 preload isolation variable test
- **research:** A6 per-file true-score probe (ignoreStatic:false)
- **research:** B1 preload architecture catalog
- **research:** B2 mock.module blast radius
- **research:** B3 DI adherence assessment
- **research:** B4 test-quality signals from mutation data
- **research:** B5 interaction synthesis + C1 root cause
- **research:** C2 quality assessment + C3 deferred options
- **research:** Executive summary + appendix + finalize
- **research:** Fix B4 NoCoverage-table survived-count notes
- **plan:** Ai output visibility implementation
- Add mutation measurement tooling design
- Document user-configurable tool access
- **plugins:** Note caller-header forwarding across provider redirect hops
- **spec:** Per-message current-time injection design
- Add missing plan license headers
- **plan:** Per-message current-time injection implementation plan
- Align multi-provider runtime guidance
- **design:** Dashboard UI audit + primitives-pass plan
- **design:** Mark primitives-pass items resolved in dashboard audit
- **plan:** Add task-provider-as-plugin Phase 2 (type catalog + admin UX) plan
- **providers:** Spec Phase-3 prerequisites for task-provider-as-plugin
- **plan:** Task-provider-plugin Phase 3 prerequisites implementation plan
- Document multi-provider remediation phases
- Align provider catalog phase 3 plan
- **spec:** MCP adapter design — core module with user-configured and declarative plugin endpoints
- **plan:** MCP adapter implementation plan — 11 tasks, TDD-driven
- Add synthetic web search plugin design spec
- Add synthetic web search plugin implementation plan
- **plugins:** Add design rationale comments to buildRateLimit
- **dashboard-auth:** Add session-cookie auth implementation plan
- **dashboard-auth:** Document session-cookie auth and deployment patterns
- Sync README/CLAUDE docs with MCP adapter and plugin changes
- Align markdown table column widths in README
- **plans:** Add hook, plugin remediation, and storage context sharing plans
- **plugins:** Complete provider plugin guide
- **plugins:** Remove stale provider limitations
- **specs:** Add chat command design docs
- **plans:** Add Telegram and Mattermost execution plans
- **plans:** Add multi-provider review fix plan
- **plans:** Add plugin review follow-up fix plan
- **spec:** Add task-provider-as-plugin Phases 3-5 combined design
- **plan:** Add task-provider-as-plugin Phases 3-5 implementation plan
- **plan:** Resync Phases 3-5 plan to shipped schema (namespaced keys)
- **plan:** Record Task 3.5 validateConfig correction + provision coupling in Drift Log
- **plan:** Drift Log — knip plugin scope + SENSITIVE_KEYS note
- **plugins:** Document Phase 3 Kaneo migration
- **plan:** Phase 3 complete; Drift Log checkRequiredProviderConfig follow-up
- **spec:** Task-provider-plugin follow-up design (deferred items)
- **plugins:** Document Phase 4 YouTrack migration; approve youtrack in E2E
- Add multi-provider review cleanup design
- Spec for tool `ask` permission
- Implementation plan for tool `ask` permission
- Add Kontur Talk chat provider design spec
- Add Kontur Talk chat provider implementation plan
- **mutation:** Add implementation plan for paired Stryker runner
- **mutation:** Document paired runner + CLI entries
- Add multi-provider review cleanup implementation plan
- **plugins:** Add remediation plan artifacts
- **settings-ui:** Scoped design specs for chat-command → web settings migration
- **settings-ui:** Consolidate settings web UI specs and resolve blocking OQs
- **settings:** Add access-model implementation plan
- **settings:** Document access-model module and SETTINGS_PUBLIC_BASE_URL
- **settings:** Document the /settings/api route family
- **settings:** Client SPA (Part B) implementation plan
- **retirement:** Command-retirement & migration implementation plan
- **retirement:** Parity-gate verification checklist
- **retirement:** /help points at /config; drops retired commands
- **retirement:** /start welcome points at /config
- **retirement:** Not-configured reply points at /config
- **retirement:** Document web-UI-only command surface
- **settings:** Admin plugin-config view is implemented (no longer deferred)
- **readme:** Actualize task-provider plugin migration and dashboard auth
- Reconcile merge — three-state tool permissions + plugin approval is UI-only (drop retired /plugin & /setup refs)
- **design:** Reconcile audit with 2026-05-30 visual sweep
- **design:** Mark visual-bug findings resolved
- **claude:** Note new admin/stats endpoints and toolMix fields
- **superpowers:** Add dashboard visual-bugs fix plan and design spec
- Actualize README + CLAUDE.md against settings-web-UI branch
- Surface kontur-talk chat provider in README + CLAUDE.md
- Add multi-provider validated findings remediation spec
- Add multi-provider remediation implementation plan
- Actualize multi-provider docs
- Add verified multi-provider remediation design spec
- Add multi-provider remediation implementation plan
- **plugins:** Correct validator comments about merged config at resolver time
- **adr:** Update ADR-0009 to plugin-contributed provider architecture
- **plugins:** Document #15 provider host allowlist enforcement gap

### Fixed

- **instances:** Wrap bootstrap seed in a sqlite transaction (spec compliance)
- Run kaneo provisioning after setup assignment
- Require kaneo workspace before provider resolution
- Group alert polling by delivery context
- Scope alert snapshots to delivery context
- Group alerts by storage context
- **chat:** Propagate adapter platform instance ids
- **chat:** Harden router lifecycle edges
- **chat:** Type instance context rendering
- **chat:** Route threaded proactive delivery contexts
- **chat:** Keep undelivered proactive prompts pending
- **chat:** Preserve alert transitions after failed delivery
- **chat:** Keep stale routed prompts retryable
- **chat:** Preflight proactive delivery routing
- **chat:** Avoid guessed announcement platform ids
- **chat:** Isolate startup platform instance loading
- **chat:** Assign setup contexts to source platform
- **chat:** Use source instance metadata for commands
- **chat:** Scope group username capability checks
- **chat:** Scope wizard button capability checks
- **auth:** Preserve platform-scoped user rows
- **auth:** Remove legacy user auth fallbacks
- **db:** Satisfy user migration strict lint
- **test:** Satisfy migration registration strict lint
- **cache:** Persist context workspaces outside users
- **cache:** Backfill workspace config from users
- **db:** Make workspace backfill non-destructive
- **auth:** Scope demo user checks by platform
- **auth:** Remove env admin command authority
- **auth:** Constrain scoped admin commands
- **auth:** Finish admin row authority cleanup
- **chat:** Remove legacy adapter instance defaults
- **test:** Clean adapter default strict lint
- **debug:** Clear runtime router before shutdown
- **debug:** Complete instance route reconciliation
- **debug:** Match instance route error contract
- **admin:** Tighten instance client contracts
- **admin:** Guard instance dashboard actions
- **admin:** Address final phase 4 review gaps
- **tests:** Restore plugin registry module mock
- **tests:** Restore startup module mocks
- **plugins:** Isolate scheduled job guard failures
- **plugins:** Ignore stopped chat instances for capabilities
- **chat:** Scope storage context ids by platform instance
- **db:** Migrate context-owned rows to platform scoped ids
- **db:** Harden scoped context migration
- **db:** Include telemetry context ids in scoped migration
- **db:** Handle staged file scoped migration conflicts
- **db:** Preserve plugin context rows during scoped migration
- **db:** Scope direct upgrades before instance bootstrap
- **db:** Migrate legacy users to inferred platform scope
- **db:** Migrate web rate limit context ids
- **auth:** Use scoped context ids for runtime storage
- **auth:** Complete scoped group runtime flow
- **auth:** Normalize scoped group context usage
- **auth:** Normalize native and scoped group ids
- **auth:** Harden scoped context parsing
- **tools:** Use scoped owners for storage tools
- **deferred:** Preserve native delivery ids with scoped storage
- **deferred:** Split scoped storage from native delivery
- **deferred:** Preserve scoped routing for legacy rows
- **chat:** Scope command and interaction storage contexts
- **chat:** Accept legacy interaction targets with scoped routing
- **chat:** Resolve scoped thread routing via config context
- **group-settings:** Scope manageable group lookup
- **db:** Preserve legacy thread context shape
- **chat:** Avoid legacy scoped-context leaks
- **attachments:** Route staged downloads by platform instance
- **attachments:** Recover legacy staged source instance
- **users:** Constrain user cleanup and username resolution by platform
- **users:** Tighten username placeholder detection
- **kaneo:** Provision from assigned task instance config
- **kaneo:** Report missing task instance URL
- **kaneo:** Disable global admin auto-provisioning
- **chat:** Skip proactive delivery to stopped instances
- **chat:** Guard routed sends by instance status
- **chat:** Report refused routed sends
- **chat:** Propagate routed send refusal
- **scheduler:** Log refused recurring notifications
- **scheduler:** Send recurring notifications to native ids
- Tighten ai output setting types
- Enforce ai output setting pairs
- Harden ai progress sanitization
- Prevent progress reporter leaks
- Redact secret-like progress strings
- Validate ai output callback targets
- Reject invalid ai callback utf8
- Harden tool progress hook handling
- Isolate ai output detail failures
- Stabilize ai output visibility
- Sanitize reasoning progress output
- Restrict ai output visibility controls
- Align reasoning visibility tests
- Resolve ai output visibility checks
- **tools:** Cache empty tool set so all-disabled contexts skip rebuild
- **tools:** Classify file tools + scope proactive prompt to delivery context
- **plugins:** Tighten provider host and config-validator manifest validation
- **plugins:** Harden provider-runtime httpFetch against SSRF and runtime mutation
- **time:** Address Task 2 review — logger scope + real timezone assertion
- **time:** Address Task 2 review — logger scope + real timezone assertion
- **ui:** Add Btn :hover styles for all five variants
- **ui:** Define status-success and truncation-banner CSS
- **admin:** Define masked-value and masked-hint CSS
- **ui:** Add scoped styles to TreeView
- **ui:** Add scoped styles to PropertiesTable
- **admin-client:** Check response status in fetchTaskProviderTypes like sibling fetchers
- **admin-client:** Require non-empty plugin id in TaskProviderTypeViewSchema source
- **config:** Contributed task providers require no per-user credential key
- **providers:** Reject contributed types that shadow built-in providers
- **providers:** First-wins on duplicate contributed task provider type
- **providers:** Default per-context source for contributed user-scoped config fields
- **instances:** Clean up platform admin rows
- **instances:** Preserve super admins during cleanup
- **instances:** Clear tool caches on context changes
- **admin:** Make platform delete apply-only
- **debug:** Bound platform apply concurrency
- Address phase 1 hardening verification
- **test:** Seed instance parents for integrity
- **chat:** Accept mattermost descriptor base url
- **config:** Compact dynamic config callbacks
- **config:** Make compact callbacks deterministic
- **config:** Bound all config callbacks
- **config:** Bound tool menu callbacks
- **providers:** Keep runtime traits aligned with descriptors
- **admin:** Align platform provider traits schema
- **mcp:** Use sanitizeServerId in tool name generation
- **tests:** Rename stale providerRuntime test after http permission addition
- **plugins:** Add logging to setPluginAdminConfig for observability consistency
- **tests:** Add adminConfig freeze assertion to context test
- **debug:** Guard maskSensitive against short values leaking secrets
- **admin:** Align sensitive value display with server masking and strengthen ordering test
- **plugins:** Add ZodError handling, missing tests, and grammar fix to synthetic-web-search
- **test:** Isolate startup plugin wiring
- **plugins:** Remove dead null checks in resolveAndReadEntryPoint (code quality bot)
- Resolve lint, format, and knip failures
- **checks:** Remove unused validation exports
- **dashboard-auth:** Treat empty cookie value as absent
- **dashboard-auth:** TouchSession ignores revoked/expired; tighten store tests
- **dashboard-auth:** Make sha256 module-private
- **dashboard-auth:** Tighten env TTL parsing and XFF handling
- **dashboard-auth:** Guard unref(), use error log key, test sweep throw
- **debug-server:** Rename test export to avoid lint allowlist edit
- **debug-server:** Whoami records activity; parse multi-value X-Forwarded-Proto
- **commands/dashboard:** Wrap claim URL in backticks; handle issueClaim errors
- **startup:** Stop dashboard-auth sweeper on graceful shutdown
- **auth-routes:** Handle mintSession failure; cache-no-store on claim redirect
- **hooks:** Remove phantom src/instances doc dir and duplicate tracking in tdd-enforcement
- Share durable group thread tool state
- **plugins:** Fail closed for unknown task providers
- **plugins:** Stop orphaned contributed task instances
- **plugins:** Gate and register plugin commands correctly
- **plugins:** Evaluate pre-start chat capabilities
- **plugins:** Honor default enabled scheduled jobs
- **plugins:** Cover default scheduled contexts
- **plugins:** Tighten runtime identity exposure
- **plugins:** Share target authorization
- **plugins:** Scope interaction target authorization
- **plugins:** Isolate prompt fragment failures
- **plugins:** Preserve provider runtime host error
- **plugins:** Preserve provider instances on shutdown
- Inherit group thread configuration
- Migrate shared group thread entities
- Preserve shared thread config during migration
- Invalidate shared thread tool caches
- **hooks:** Remove phantom src/instances doc dir and duplicate tracking in tdd-enforcement
- **group-settings:** Align fallback target validation
- **telegram:** Log scope publication failures
- **mattermost:** Preserve non-command mentions
- **mattermost:** Detect later standalone mentions
- **mattermost:** Keep mention guidance scoped
- **mattermost:** Use runtime username in guidance
- **chat:** Fail loudly on command publication errors
- **chat:** Log sync command publication failures
- **commands:** Remove dead catalog export
- Validate platform instance config
- Validate platform instance patch config
- Validate task instance patch config
- Read admin system providers from instances
- Handle ambiguous admin system providers
- **plugins:** Reject invalid disable targets
- **plugins:** Surface tool collisions in runtime events
- **plugins:** Dedupe tool collision events
- **hooks:** Add missing fs import in verify-test-import.mjs
- **plugins:** Harden discovery hashing
- **plugins:** Stabilize discovery contracts
- **plugins:** Make discovery paths portable
- **plugins:** Import entrypoints via file urls
- **plugins:** Make manifest validation strict
- **plugins:** Tighten manifest path checks
- **plugins:** Validate provider manifest fields
- **plugins:** Handle commented dynamic imports
- **plugins:** Harden discovery import parsing
- **plugins:** Use parser-backed import discovery
- **plugins:** Refine manifest path validation
- **plugins:** Tighten mcp-only manifest validation
- **plugins:** Reject raw parent path segments
- **plugins:** Stage activation side effects
- **plugins:** Tighten activation registration guards
- **plugins:** Close registration after activation
- **plugins:** Tighten registration lifecycle
- **plugins:** Resolve provider validator exports
- **plugins:** Tighten validator activation checks
- **plugins:** Harden validator error handling
- **plugins:** Scope validator inputs to instance config
- **plugins:** Validate provider config validators
- **plugins:** Allow http host allowlists
- **plugins:** Make admin config live at runtime
- **plugins:** Cover runtime permission guards
- **plugins:** Cap tiny synthetic search budgets
- **plugins:** Unify missing config resolution
- **plugins:** Scope plugin target error messages
- **plugins:** Tighten context eligibility toggles
- **plugins:** Expose editable plugin config in /config
- **plugins:** Accept plugin context config callbacks
- **config-editor:** Fail closed for stale compact callbacks
- **config-editor:** Bind compact non-field callbacks
- **config-editor:** Bind save actions to active field session
- **config-editor:** Bind save actions to active sessions
- **config-editor:** Rotate save tokens on value changes
- **config-editor:** Invalidate staged save after invalid input
- **config-editor:** Reject legacy dm callbacks
- **plugins:** Enforce https-only provider fetch
- **plugins:** Align provider redirect handling
- **plugins:** Correct redirect replay semantics
- **plugins:** Strip auth on cross-origin redirects
- **tools:** Classify plugin tools in preferences
- **tools:** Wire plugin tool toggles end to end
- **plugins:** Align review remediation with runtime contract
- **tools:** Surface plugin toggles in config
- **config-editor:** Preserve compact callback session tokens
- Use safe chat config fingerprints
- Harden chat config fingerprint digest
- Report apply reconciliation failures accurately
- Surface platform apply failures
- Harden instance route mutations
- Validate task provider config during resolution
- Contain task provider validator failures
- Honor plugin provider storage keys
- Use plugin provider storage keys in setup
- Align plugin provider storage metadata
- Align admin provider storage submission
- Preserve legacy mattermost instance config reads
- Preserve mattermost constructor url config
- **tools:** Tighten PERMISSIONS type and clarify tool_prefs log
- **tools:** New-shape tool_prefs wins over legacy on conflict
- **chat:** Use storage context id for permission auth check
- **tools:** Preserve MCP tool schemas when adding _permission_reason
- **system-prompt:** Suppress ask fragment on proactive turns
- **kontur-talk:** Skip non-text messages in MVP
- **kontur-talk:** Resolve knip issues — use label helpers, validate send response, remove unused error schema
- **tests:** Migrate master's scoped-context test to tri-state semantics
- **chat:** Escape markdown in LLM-supplied _permission_reason
- **mutation:** Preserve paired-config threshold bands
- **mutation:** Surface pending mutants in paired score merger
- **mutation:** Validate paired-run threshold handling
- **mutation:** Reject empty paired-run threshold
- **mutation:** Reject duplicate paired-run thresholds
- **mutation:** Prevent stale paired-run reports
- **mutation:** Reject short paired-run flags
- **mutation:** Tolerate stryker nonzero with report
- **mutation:** Constrain paired-run threshold range
- **mutation:** Align changed-files dependency API
- **mutation:** Exclude deleted changed-file targets
- **ci:** Avoid mutation scan shell injection
- **mutation:** Stream progress and pause CI gate
- **providers:** Validate resolved plugin config
- **plugins:** Tighten context settings nullability
- **hooks:** Normalize doc review paths
- **plugins:** Dedupe activation lifecycle order
- **plugins:** Bind identity claims to runtime actor
- **plugins:** Narrow activation identity facade
- **plugins:** Re-export scheduled job runtime type
- **plugins:** Enforce command and scheduler permissions
- **plugins:** Preserve legacy approval state
- **plugins:** Persist runtime registry state
- **plugins:** Harden discovery path verification
- **plugins:** Complete strict discovery migration
- **plugins:** Remove src refs from strict entry files
- **plugins:** Hash local runtime bridge imports
- **plugins:** Close bare require discovery hole
- **plugins:** Restore synthetic search input schema
- **plugins:** Reject computed import.meta.require
- **commands:** Route setup auto provision through descriptors
- **commands:** Isolate auto provision failures
- **plugins:** Align operator surfaces with runtime state
- **settings:** Reject CSRF rotation for expired sessions
- **settings:** Deny system sentinel via group path; exhaustive scope guard
- **settings:** Rate-limit on proxy-trusted client IP; test 429 and code replay
- **settings:** Enforce live authorization on bootstrap; mark revoke-all-sessions @public
- **settings:** Stable alphabetical domain ordering in tools GET
- **settings:** Reject enabling a non-active plugin; cover plugin route branches
- **settings:** Authenticate identity PUT before parsing body
- **settings:** Do not return Kaneo apiKey in provision response
- **settings:** Provision username mirrors wizard; log failure reason; add 405 test
- **settings:** 405 on non-GET provider-types; tighten types; cover admin write paths
- **settings:** Plugin approval via registry; audit DELETE; cover roster/approval/announce
- **settings:** Treat masked secret resubmission as no-change in config and plugin config
- **settings:** Identity schema nullability + matchedAt to match server contract
- **settings:** Config field row re-syncs draft on prop change + cover replace/cancel
- **settings:** Profile section gates placeholder on load/error + error test
- **settings:** Clear Kaneo provision reveal on context switch
- **settings:** Tools section additive errors, collapsed drill-down, context-safe expand
- **settings:** Mcp section collision-free row ids + status feedback + tests
- **settings:** Plugins section clears error before toggle/config actions
- **settings:** Identity section guards empty user id + 422 form-hidden test
- **settings:** Members section clears error on actions + remove/error tests
- **settings:** Group provider clamps selection to available + status feedback
- **settings:** Admin instances clears error on load + delete confirm ordering + additive-error test
- **settings:** Admin system password input + empty-save guard + status reset + tests
- **settings:** Admin users success status feedback + username-path test
- **settings:** App inits activeId from hash + clamps to visible sections
- **settings:** Plugin required-config guard, identity loading state, scrollspy tick
- **retirement:** Group-settings dispatch default config-render stub throws instead of silent no-op
- **retirement:** Restore recordRuntimeEvent assertions; drop stale supportsInteractiveButtons references
- **retirement:** Point remaining user-facing config prompts at /config (drop /setup references)
- **settings:** Scope guard denies bot-admin access to other users' personal contexts
- **shared/ui:** Harden Bars against undefined and degenerate data
- **shared/ui:** Harden DataTable click guard and Bars geometry
- **admin/overview:** Rebuild section with MetricCard chrome
- **admin/stats:** Rebuild with MetricCards, DataTable, and tool-calls panel
- **admin/billing:** Wrap subjects table and detail in Panel chrome
- **admin/memos:** Rebuild with Panel + Seg + DataTable chrome
- **admin/reminders:** Rebuild with two-Panel grid layout
- **admin/identity:** Rebuild with Panel + DataTable over admin-wide list
- **admin/groups:** Rebuild with Panel + DataTable + revoke action
- **admin/system:** Panel chrome + surface credential required flag
- **admin/instances:** Minimal Panel wrap + Btn/Seg swap
- **debug/turns:** Restore 6-column table layout
- **debug/session-card:** Repair row line-bleed when stacked
- **shared/treeview:** Pad story bodies to stop top-row clipping
- Replace retired-command references in user/operator-facing strings
- Harden instance config key derivation
- Isolate unreadable instance rows
- Use safe task decoding at startup
- Handle unreadable instance diagnostics in admin client
- Report platform apply desired status
- Preserve platform apply compatibility
- Preserve strict removal state
- Split task provider config validation
- Isolate unreadable platform apply rows
- **hooks:** Simplify idle rerun guidance
- **hooks:** Clarify check-full failure prompt
- **orchestrator:** Restore required-config guard via descriptor keys
- **migration:** Isolate undecryptable rows in 045 baseUrl backfill
- **instances:** Use safe decode on admin/setup/lifecycle list paths
- **apply:** Preserve running instances whose DB row is unreadable
- **router:** Always remove instance on stop failure to allow retry

### Miscellaneous

- **deps:** Bump @opencode-ai/plugin to 1.15.7
- **chat:** Satisfy final verification checks
- **chat:** Format final router changes
- **instances:** Clean unused platform setup helper
- **instances:** Remove unused key length constant
- **auth:** Format scoped user changes
- **test:** Format plugin admin coverage
- **format:** Order router runtime imports
- **stories:** Phase D — production-bundle isolation guard + docs
- **docs:** Format Phase 1 plan
- Ignore client/assets build output
- **tsconfig:** Exclude storybook-static build output from typecheck
- Remove unused types, functions, and knip suppressions
- Add plugin config fetchers to knip ignore list for Svelte consumption
- **client-admin:** Update UI copy after DEBUG_TOKEN removal
- **dashboard-auth:** Remove residual DEBUG_TOKEN references
- **plugins:** Remove stale compatibility API
- **plugins:** Remove unused plugin command parameter
- **providers:** Remove test-only registry lookup
- **providers:** Remove stale registry knip ignore
- **knip:** Transitionally ignore setKaneoWorkspace unused export
- **knip:** Scan plugins/ so plugin->src usage is tracked
- Satisfy strict lint for plugin follow-up
- Bump opencode plugin
- **knip:** Suppress test-only seam exports from knip strict mode
- **settings:** Register client/settings bundle entry + svelte export ignores in knip
- **retirement:** Delete message-interception modules
- **retirement:** Delete tool/plugin/ai-output interaction handlers
- **retirement:** Delete config-editor presentation (keep validation.ts)
- **retirement:** Sever wizard/selector from non-command callers
- **retirement:** Finalize command menu catalog (/config launcher description + telegram menu)
- **retirement:** Knip dead-code sweep (remove orphaned chat-config modules + exports)
- **debug/story:** Rename DebugApp story Populated -> Default
- **claude:** Add launch config for storybook and assets servers

### Styling

- **attachments:** Satisfy strict lint for staged files
- **spec:** Normalize markdown table alignment
- **tools:** Apply oxfmt formatting to tool-access source files
- Apply repo-wide oxfmt reformat and split files over max-lines

### Testing

- **index:** Mock src/instances/bootstrap.js in startup-wiring test
- **mock-reset:** Restore src/instances/bootstrap.js after process-wide mock
- Update config tests for dynamic keys
- Fix config editor dynamic key lint
- Update context assignment fixtures
- **chat:** Cover router delegation edge cases
- **chat:** Update chat router contract coverage
- **plugins:** Cover scheduled job guard triggers
- **plugins:** Cover context resolved provider eligibility
- **auth:** Resolve usernames from placeholders
- **chat:** Align legacy tests with scoped contexts
- **config:** Cover tgl: tool/open/back paths; log malformed tool-toggle context
- **tools:** Fix tools/index mock leak and youtrack DB setup
- **plugins:** Assert registerTaskProviderType error messages and enrich undeclared-type error
- **plugins:** Cover identity facade cleared-mapping null branch
- **providers:** Assert contributed capabilities and mock logger in catalog test
- **admin:** Cover sensitive-field rendering and provider-type switch in InstancesSection
- **plugins:** Use non-built-in type name in registerTaskProviderType success test
- **debug:** Cover task delete cache invalidation
- **debug:** Tighten task delete cache assertions
- **providers:** Isolate plugin resolver registry entry
- **plugins:** Clean up provider context registry
- **tools:** Use traited Kaneo mocks for label tools
- **bot:** Update auto setup wizard expectation
- **dashboard-auth:** Tighten migration 046 tests; update registration assertion
- **startup:** Remove duplicate debug-token-warn test file
- **client-admin:** Remove duplicate whoami-bootstrap test file
- Cover group thread deferred prompt ownership
- **commands:** Enforce catalog assertion metadata
- **commands:** Tighten catalog registration assertions
- **commands:** Strengthen catalog coverage
- **bot:** Lock command registration to catalog
- **bot:** Strengthen command registration drift check
- **telegram:** Tighten command scope assertions
- **group-settings:** Complete fallback selector flow
- **mattermost:** Cover mention-prefixed command syntax
- **mattermost:** Expand mention syntax coverage
- Fix rebased instance route null guard
- **e2e:** Approve task-provider-kaneo plugin in setup
- **dashboard:** Make issueClaim-failure test deterministic
- **plugins:** Cover raw parent path segments
- **plugins:** Align main contract fixtures
- **config-editor:** Align plugin config alias expectation
- Update provider validator wrapper expectation
- Update provider baseUrl fixtures
- **kontur-talk:** Improve schema and config test coverage
- **plugins:** Cover repeated loader activation
- **settings:** Cover auth-code expiry boundary
- **settings:** Cover platform-admin principal; log platformUserId
- **settings:** Harden cookie/session auth coverage; trim cookie value
- **settings:** Assert single reply and rate-limit message for /config link
- **settings:** Cover parseJsonBody and requireCsrf success path
- **settings:** Dedup api-router test to hook-mirror path
- **settings:** Cover config masking, unchanged, and unknown-field paths
- **settings:** Assert MCP mask form and masked-header roundtrip
- **settings:** Cover identity DELETE clearing, no-CSRF, and no-provider paths
- **settings:** Cover group member + task-instance write paths
- **settings:** Harden static-serving tests + build guard
- **settings:** Reset session fields between tests + cover exchange 401
- **settings:** Cover plugin reject path + approval status banner
- **settings:** Strengthen announce result + error assertions
- **settings:** Make session exchange assertion resilient to cross-test fetch pollution
- **settings:** Route entry mount mock by url + cover failed-exchange gate path
- **retirement:** Config-field + authorization parity gate
- **retirement:** Characterize normal-message orchestrator path before interception removal
- **retirement:** Restore command-path observation/denial/reply coverage on surviving commands
- Cover migration completion logs
- Stabilize verification suite
- **orchestrator:** Set namespaced youtrack token now that the guard is live
- **instances:** Instance is evicted on stop failure (removeInstance retry semantics)

### Build

- **stryker:** Add typescript-checker plugin
- **settings:** Add client/settings bundle entry and isolation guard

### Ci

- Re-enable mutation testing as warn-only paired changed-files job
- Run paired mutation gate on pull requests only
- Provision INSTANCE_CONFIG_KEY + SETTINGS_PUBLIC_BASE_URL, drop dead TASK_PROVIDER

### Merge

- Resolve conflicts with origin/master (adopt handleClientFile, preserve MCP routes)
## [5.7.0] - 2026-05-23

### Added

- Implement plugin system (phases 1-13)
- Implement trusted local plugin system
- **shared:** Extract shared client skeleton
- **build:** Extract shared base styles and generalize client build script
- **debug:** Carve out live DebugApp
- **debug:** Rename dashboard route to debug
- **admin:** Add empty admin bundle
- **admin:** Add system credentials section
- **admin:** Add billing section
- **admin:** Restore stats section
- **admin:** Add memo reminder identity group sections
- **admin:** Add confirm modal primitive
- **client:** Add Telemetry design tokens
- **ui:** Add Dot primitive
- **ui:** Add HR primitive
- **ui:** Add Caption primitive
- **ui:** Add KV primitive
- **ui:** Add Pill primitive
- **ui:** Add Btn primitive
- **ui:** Add Input primitive
- **ui:** Add Select primitive
- **ui:** Add Seg primitive
- **ui:** Add Panel primitive
- **ui:** Add Spark sparkline primitive
- **ui:** Add Bars chart primitive
- **ui:** Add Shell primitive
- **ui:** Add TopBar primitive
- **debug:** Add DebugTopBar with brand, status row, and scope Seg
- **debug:** Add DebugDetailRail discriminated-union view
- **debug:** Rebuild DebugApp around DebugTopBar and DebugDetailRail
- **usage:** Add listRecentRequests query helper
- **admin:** Add GET /admin/subjects/:id/recent-requests
- **admin:** Add adminGlobals + refreshGlobals data layer
- **admin:** Extend adminState with window + lastRefreshedAt helpers
- **admin:** Add useScrollSpy hook + IntersectionObserver test stub
- **admin:** Add AdminTopBar with brand, window Seg, refresh meta
- **admin:** Add AdminSidebarPanel with anchor links + quick stats
- **admin:** Add OverviewSection with KPI cards + growth + mix
- **admin:** Wire SubjectDetail to /admin/subjects/:id/recent-requests
- **admin:** Lazy-load section data via IntersectionObserver
- **admin:** Rebuild AdminApp as one-page scrolling shell
- **admin:** Align global-stats schema with /stats/global nested shape
- **ui:** Add optional sub-label prop to KV primitive
- **admin:** Wire OverviewSection KPIs to real /stats/global fields
- **stats:** Add llmUsage to /stats/global and Overview KPI

### Changed

- **debug:** Migrate debug dashboard to consume shared client primitives
- **debug:** Trim admin-only dashboard state
- **client:** Migrate base.css to design tokens
- **admin:** Migrate admin.css to design tokens
- **debug:** Migrate debug.css to design tokens
- **debug:** Replace activeContext with scopeFilter and add selectedDetail
- **debug:** Replace legacy CSS with three-column grid
- **admin:** Inline BillingSection subject detail; drop modal
- **admin:** Replace legacy page-frame CSS with .admin-grid two-column layout

### Documentation

- Rebaseline plugin system implementation plan
- Document trusted local plugin system in README and CLAUDE.md
- **admin:** Document debug and admin split
- **admin:** Fix system credentials and token docs
- **dashboard:** Brainstorm Telemetry redesign spec
- **dashboard:** Fix spec markdown table mangled by oxfmt
- **dashboard:** Add PR1 plan for tokens and shared primitives
- **dashboard:** Apply oxfmt to PR1 plan
- **admin:** Add PR2 debug shell implementation plan
- **admin:** Add PR3 admin shell implementation plan
- **admin:** Surface DEBUG_TOKEN requirement on System section
- **admin:** Add PR4 polish implementation plan
- Format merged plugin docs
- **spec:** Align multi-provider router design with implemented plugin system
- **plan:** Add multi-provider router implementation plan
- **spec:** Split multi-provider router design into five phase specs
- **superpowers:** Add remaining brief for consolidate-keywords-agent mock cleanup
- **adr:** ADR-0120 central LLM credentials, billing, stats (phases 1-5)
- **plan:** Sync kaneo-label-semantics plan with branch state
- **adr:** ADR-0121 dashboard split, ADR-0122 Kaneo label semantics
- **plan:** Sync plugin system plan with merged implementation
- **adr:** ADR-0123 trusted-local plugin system; archive plans and specs

### Fixed

- Satisfy checks after master merge
- **shared:** Align StatusDot and expand shared helper and type test suites
- **debug:** Use two-column panel grid
- **debug:** Narrow legacy admin component state
- **admin:** Constrain system provider summary
- **admin:** Satisfy strict lint for system section
- **admin:** Hide stats section until task 10
- **admin:** Align billing stats ownership
- **admin:** Align identity contract with server
- **admin:** Clean split dashboard leftovers
- **admin:** Remove stale debug app test
- **admin:** Restore admin panel styling
- **admin:** Preserve modal legacy default width
- **ui:** Use generic querySelector to satisfy no-unsafe-type-assertion
- **ui:** Add explicit return types to Caption test snippet
- **debug:** Align smoke + topbar tests with new shell
- **admin:** Align window seg with server contract (24h → 1d)

### Miscellaneous

- **debug:** Remove Header and ContextChips components
- **admin:** Remove NavSidebar and WindowSelect components
- **admin:** Fix format + knip for PR 3 verification
- **knip:** Suppress SubjectGrowthPoint type false positive from Svelte blind spot
- **docs:** Add BUSL-1.1 headers to new dashboard plans/spec
- **docs:** Consolidate superpowers archive and drop obsolete remaining briefs
- **docs:** Finish pi-migration archive consolidation
- **docs:** Format multi-provider router plan and specs
- **docs:** Format ADR-0120 and README
- **docs:** Format dashboard redesign plan files

### Styling

- **docs:** Oxfmt PR4 plan

### Testing

- **recurrence:** Remove obsolete timezone validation check in spec-schema
- **admin:** Move subject stats panel coverage
- **admin:** Move stats fetcher coverage
- **admin:** Tighten memo filters and error contracts
- **admin:** Lock Spark wiring to growthLast30d in OverviewSection
- **behavior-audit:** Replace last mock.module in classify-agent suite
- **behavior-audit:** Replace mock.module in consolidate-keywords-agent suite

### Build

- **check:** Skip deleted-in-worktree files in license-headers gate

### Merge

- Merge origin/master and resolve conflicts
- Resolve origin/master conflicts
## [5.6.2] - 2026-05-22

### Documentation

- Convert design specs to superpowers format with notes
- Sync design docs and superpowers specs/notes
- **design:** Verify, align design spec and write implementation plan for dashboard-admin split
- Add Kaneo label semantics plan

### Fixed

- **telegram:** Eagerly initialize file fetcher for group chat staged files
- **kaneo:** Distinguish reusable and task labels
- **tools:** Prevent duplicate Kaneo label creation
- **tools:** Add Kaneo task-label status handling
- **tools:** Clarify Kaneo already-absent label results
- **kaneo:** Resolve task label removal from workspace ids
- **kaneo:** Keep reusable labels when taskId is omitted
- **kaneo:** Detect already-present labels by workspace id
- Satisfy full check after Kaneo label changes

### Miscellaneous

- **sql:** Add Kaneo label dedup scripts
- **tools:** Tighten Kaneo label helper usage
- **sql:** Drop uncommitted Kaneo dedup scripts

### Testing

- Verify Kaneo label semantics changes

### License

- Add BUSL-1.1 headers to docs and extend tooling for markdown files
## [5.6.1] - 2026-05-21

### Documentation

- **design:** LLM rate limiting and plans spec + phase decomposition
- **design:** Rework quotas — day/week/month windows, refill algo, attachment storage, 80% notice, deferred-prompt fallback
- **design:** Align phase decomposition with reworked quota spec
- **design:** Rework deferred-prompt fallback — fire time is sacred, proactive small-model degrade at notify_pct, per-type templates
- **design:** Split /dashboard into /debug and /admin — design + phase plan

### Fixed

- **auth:** Include actual group id in unauthorized-group hints

### Miscellaneous

- Format

### Styling

- **docs:** Oxfmt pass on rate-limiting design + phases
## [5.6.0] - 2026-05-20

### Added

- **billing:** Central LLM credentials in system_config (Phase 1)
- **billing:** Migration 035 + usage recorder + query module (Phase 2)
- **billing:** Thread chatUserId and contextType into llm:end and llm:error
- **billing:** Subscribe usage recorder to the debug event bus
- **billing:** Record embedding usage from tryGetEmbedding callsites
- **billing:** Record web/distill usage with modelRole='small'
- **billing:** Server helpers for Phase 3 billing dashboard
- **billing:** Wire /billing and /admin/llm routes (Phase 3)
- **billing:** Client state types and fetchers (Phase 3)
- **billing:** Billing dashboard panel and components (Phase 3)
- **billing:** Drizzle schema for tool_call_events + outbox fields
- **billing:** Deterministic SHA-256 event_id for usage rows
- **orchestrator:** Extend tool lifecycle event payloads
- **billing:** Tool-call recorder + bus subscriber
- **billing:** Tool-call query helpers (read surface)
- **stats:** Types + aggregate helpers (Phase 5)
- **stats:** Keyed hashing with lazy salt (Phase 5)
- **stats:** Per-subject helpers — batch A (Phase 5)
- **stats:** Per-subject content helpers — batch B (Phase 5)
- **stats:** Per-subject identity/staged/user+group helpers — batch C (Phase 5)
- **stats:** Per-subject web/usage/tool-call helpers — batch D (Phase 5)
- **stats:** Global query helpers (Phase 5)
- **stats:** Orchestrator + 60s global-view cache (Phase 5)
- **stats:** /stats routes behind DEBUG_TOKEN (Phase 5)
- **stats:** Client fetchers + types (Phase 5)
- **stats:** SubjectStatsPanel + StatsTab + dashboard wiring (Phase 5)

### Changed

- **debug:** Extract resolveDmDisplayNames helper (Phase 5)

### Documentation

- **billing:** Design initial migration from BYOK to central LLM + usage telemetry
- **billing:** Split central-llm rollout into three phases
- **billing:** Add phase 5 — anonymous DB-wide statistics
- **billing:** Add Phase 1 brainstorm, per-phase design, and plan
- **billing:** Add Phase 2 brainstorm, per-phase design, and plan
- **billing:** Phase 3 brainstorm + design + plan
- Note Phase 3 dashboard credentials surface in CLAUDE.md
- **billing:** Phase 4 brainstorm — tool-call rows + idempotency
- **billing:** Phase 4 design + implementation plan
- **billing:** Note Phase 4 tool_call_events + outbox slots in CLAUDE.md
- **billing:** Phase 5 brainstorm — anonymous DB-wide stats
- **billing:** Phase 5 design + implementation plan
- **stats:** Document /stats anonymity contract + src/stats module (Phase 5)
- Align README, .env.example, CLAUDE.md with central-llm rollout

### Fixed

- **/context:** Apply tool routing to reflect actual exposed surface
- **billing:** Include occurredAt in usage event_id hash
- **billing:** Resolve group display names + mark masked credentials

### Miscellaneous

- **billing:** Mark usage module exports as Phase-3-pending in knip
- **billing:** Ignore .svelte-only exports in client/debug/billing/fetchers.ts
- **billing:** Migrations 037 + 038 for Phase 4 tables
- **docs:** Apply oxfmt formatting to Phase 4 doc set
- **cleanup:** Clear pre-existing knip orphans

### Testing

- **stats:** Forbidden-substring anonymity contract (Phase 5)
- **stats:** 1k subjects + 100k messages perf bench (Phase 5)

### Ci

- Verify docker image build in build job
- Tag docker build validation image
- **deploy:** Propagate S3 + central LLM env to deployed .env
## [5.5.3] - 2026-05-19

### Fixed

- **deps:** Install devDependencies in Docker build stage for Svelte dashboard

## [5.5.2] - 2026-05-19

### Added

- Normalize timezone config and scheduling reads
- **dashboard:** Migrate debug dashboard from vanilla HTML to Svelte 5
- **dashboard:** Apply review recommendations from Svelte 5 migration

### Documentation

- **adr:** Add ADR-0087 for debug dashboard expansion
- Remove debug dashboard expansion spec and plan from active directories
- **adr:** Add ADR-0088 for Kaneo doc-first API migration
- **adr:** Add ADR-0089 for codeindex portability and test isolation
- **adr:** Decline /context tool catalog emission; document completed knip cleanup
- ADR-0091 for staged attachments and archive spec/plan
- **adr:** Archive architecture inventory spec/plan; add ADR-0092
- **adr:** ADR-0093 for tool surface benchmark implementation
- **adr:** Add ADR-0094 for single proxy tool deprecation; archive design and plan
- **archive:** Move stale 2026-05-09-bun-check-full-remediation plan to archive
- **adr:** ADR-0095 telegram-specific group and user label resolution
- **adr:** ADR-0096 for opencode TPS meter local removal; archive spec and plan
- **adr:** ADR-0097 for Pi migration partial implementation; archive plan and document divergences
- **adr:** Add ADR-0098 for RRULE library adoption, archive spec and plan
- **adr:** Add ADR-0099 for embedding clustering linkage-mode improvements
- **adr:** Add ADR-0100 for embedding clustering profiling and acceleration
- Add ADR-0101 for compact-tools pi extension, archive spec+plan
- **adr-0102:** Add ADR for behavior audit progress reporting with structured events
- **adr:** Add ADR-0103 for behavior-audit keyword consolidation
- **adr:** ADR-0105 — fix check:verbose SIGINT cascade remediation
- **adr:** ADR-0106 for DRY duplicate test code refactoring
- **adr:** Archive behavior-audit progress UX plan and add ADR-0107
- **adr:** Add ADR-0108 for behavior-audit JSON extraction cleanup, archive plan and remaining tracker
- **adr:** Add ADR-0109 for behavior-audit artifact model migration
- **adr:** Add ADR-0110 for behavior-audit legacy cleanup; archive plan
- **adr:** Add ADR-0111 for behavior-audit mock.module cleanup; archive plan
- **adr:** Add review-loop enhancements ADR, archive spec and plan
- **adr:** Write ADR-0113 for OpenCode TPS Meter security hardening, archive plan and spec
- **adr:** Add ADR-0114 for behavior audit phase 2 redesign
- Archive superseded 3-phase behavior-audit plan
- **adr:** Add ADR-0115 for readable group and user labels; archive spec and plan
- **adr:** Add ADR-0116 for deferred prompt delivery redesign with same-context delivery
- **archive:** Relocate deferred prompt delivery design spec and implementation plan
- **adr:** Archive superseded proactive group messaging spec/plan, add divergence notes
- ADR-0117 — YouTrack tool parity closure
- **adr:** Add ADR-0118 for codeindex Tier 1 completion, archive spec+plan, add future tiers note
- **adr:** Add ADR-0119 for shared attachment pipeline completion
- Add execution order recommendation for provider abstraction, architecture violations, and plugin system plans

### Fixed

- **checks:** Resolve all failing checks from check:full

### Miscellaneous

- **docs:** Move embedding clustering profile results to archive, update ADR-0100 references and index
- **adr:** Add ADR-0104 for codeindex lint fix, archive plan

### Testing

- Cover timezone normalization regressions

## [5.5.1] - 2026-05-16

### Documentation

- **adr:** Add ADR-0086 for Kaneo E2E compatibility gap coverage

### Fixed

- **kaneo:** Rely on upstream image healthcheck

## [5.5.0] - 2026-05-16

### Added

- **debug:** Add Scope type and typed emit helpers to event-bus
- **debug:** Add AdminVisibility type and isVisibleToAdmin filter
- **debug:** Replace isAdminEvent with scope-based isVisibleToAdmin
- **debug:** Migrate all emit sites to typed helpers
- **debug:** Mint turnId, emit turn:start/end and queue:\* events
- **debug:** Thread turnId through orchestrator, add tool/reply/typing/notify events
- **debug:** Add Turn assembly, ring buffers, and /turns/:id endpoint
- **debug:** Add context switcher, panel grid, Turns/Notifications/Tool-failures panels
- **debug:** Add recurring:_, deferred:_, memo:\* lifecycle events
- **debug:** Add recurring/deferred/memo REST endpoints and Reminders/Memos panels
- **debug:** Add Context panel, turnId log filter, remove bare emit()

### Changed

- **message-queue:** Replace mock.module() with DI for event-bus deps

### Documentation

- Capture verified implementation plans
- Align README license badge with BSL 1.1

### Fixed

- Avoid pulling papai image during E2E setup
- **/context:** Remove tool catalog follow-up from context command output
- Resolve lint and knip failures in debug-dashboard-expansion
- **debug:** Unblock lint and knip after dashboard expansion
- Expand Kaneo E2E compatibility coverage
- Restore full check suite
- Tolerate null Kaneo session in E2E helper
- Add BUSL-1.1 license headers and extract llm-trace-collector
- **tests:** Restore mock.module state after debug-server tests
- Resolve codeindex worktree path resolution

### Miscellaneous

- Relicense from MIT to Business Source License 1.1
- Add BUSL-1.1 SPDX license headers to all source files
- Enforce BUSL license headers across the repo
- Bump .opencode plugin dependency
- **deps:** Update oxlint, ai SDK, and fix all new lint errors

### Styling

- Format remaining docs and tests
- Add spacing after license headers

### Testing

- Isolate debug server module mocks

## [5.4.2] - 2026-05-14

### Fixed

- Restore GHCR deploy access after repo move
- Prevent duplicate Telegram handler registration

## [5.4.1] - 2026-05-14

### Documentation

- Add codeindex portability design and plan
- Add Paper & Papaya landing-page design system
- Shift design palette away from Anthropic warm-cream signature

### Fixed

- Restore lint and test checks
- Align codeindex references with external repo layout
- Align Kaneo task schemas with latest docs
- Tighten Kaneo task timestamp schemas
- Restore Kaneo task list envelope support
- Validate Kaneo list task priorities
- Pass Kaneo start dates through provider tasks
- Add startDate to shared task provider contract
- Preserve Kaneo start dates in normalized tasks
- Align Kaneo search with grouped API contract
- Accept null Kaneo search task dates
- Move Kaneo search grouped adaptation upstream
- Align Kaneo provider with verified runtime behavior
- Restore Kaneo check suite

### Styling

- Format codeindex portability files

### Testing

- Restore message queue preload mocks

### Build

- Add portable codeindex wrapper
- Handle codeindex wrapper spawn failures
- Make codeindex integration portable
- Fix pi codeindex reindex parity
- Finish portable codeindex resolution

## [5.4.0] - 2026-05-14

### Changed

- Extract codeindex workspace into standalone project

### Fixed

- **telegram:** Register bot handlers before startup
- **kaneo:** Align self-hosted stack with single-image deploy

## [5.3.0] - 2026-05-13

### Added

- **attachments:** Add attachment workspace schema and migration 028
- **attachments:** Add S3-backed blob store and durable attachment store
- **attachments:** Add workspace ingest and clear helpers
- **attachments:** Add resolver and prompt manifest
- **llm:** Add multimodal attachment input
- **behavior-audit:** Add embedding cache module
- **behavior-audit:** Add EMBEDDING_CACHE_PATH config
- **behavior-audit:** Use embedding cache in Phase 1b
- **behavior-audit:** Use embedding cache in tune-embedding script
- **skills:** Add syncing-plan-with-code skill
- **behavior-audit:** Add average and complete linkage similarity helpers
- **behavior-audit:** Add buildClustersAdvanced with average and complete linkage
- **behavior-audit:** Add subdivideOversizedClusters for iterative threshold increase
- **behavior-audit:** Add gap threshold to buildClustersAdvanced
- **behavior-audit:** Add linkage, maxClusterSize, gapThreshold config
- **behavior-audit:** Wire linkage, maxClusterSize, gapThreshold into tune-embedding CLI
- **behavior-audit:** Wire new clustering params into consolidation pipeline
- Instrument embedding clustering profiles
- Expose clustering profile output
- Add tool schema formatting
- Add tool metadata extraction
- Add papai tool proxy modes
- Expose papai tools through single proxy
- Add Pi project scaffold, extensions, and tooling config
- Add compact-tools pi extension
- Add cached group user observations
- Record observed group user labels
- Add telegram group display resolver
- Use cached telegram labels in group commands
- Add staged_files migration, schema, and tests
- Add staged file types and IncomingFileCandidate for metadata-only group files
- Add staged file cache module (stage, search, resolve, purge)
- Add staged download factory with platform-specific delegation
- Stage group files before auth gate, use thread-scoped context IDs for lookups
- Telegram adapter produces file candidates for groups (no eager download)
- Mattermost adapter produces file candidates for groups (no eager download)
- Add search_staged_files and resolve_staged_file LLM tools
- Wire platform-specific staged downloader through orchestrator to tools
- Register hourly staged files purge background job
- Make S3 storage optional — disable file capabilities when S3 env vars are missing
- **attachments:** Add S3 docs, workspace-files tool, and update /clear command
- **behavior-audit:** Add average and complete linkage similarity helpers
- Add tool surface benchmark scenarios
- Add tool surface benchmark runner
- Add architecture inventory tooling
- Surface live tool definitions in context output

### Changed

- **bot:** Persist incoming files into the workspace and queue stable IDs
- **attachments:** Replace file-relay with workspace lookups
- Add trust-aware behavior audit extraction
- **behavior-audit:** Add pre-normalized clustering with Float64Array dot product
- **behavior-audit:** Add condensed distance helpers for advanced clustering
- **behavior-audit:** Limit advanced clustering helper visibility
- **behavior-audit:** Replace non-single linkage clustering with nearest-neighbor chain
- **plan-adr-workflow:** Extract AI helpers and add remaining-work doc generation
- Remove OpenCode instruction files, add Pi workflow to CLAUDE.md
- Replace sorted nearest-neighbor scans
- Remove string blocked-pair keys
- Reuse active cluster snapshots

### Documentation

- **attachments:** Switch design to S3-compatible blob storage
- **attachments:** Update plan to use S3-compatible storage and migration 028
- **attachments:** Reformat plan/design after lint pass
- Add single proxy tool design
- Add single proxy tool implementation plan
- Record clustering profile evidence
- Add clustering acceleration plan
- Add telegram group label resolution design spec
- Update remediation and clustering plans
- Add tool surface benchmark design
- Update tool surface benchmark plan status
- Mark tool introspection cleanup plan complete

### Fixed

- **behavior-audit:** Update EMBEDDING_MODEL default in config test
- **behavior-audit:** Clamp recluster threshold ceiling
- **behavior-audit:** Keep scanning after rejected gap merge
- **behavior-audit:** Preserve gap-aware reclustering in tune-embedding
- **behavior-audit:** Isolate tune-embedding wiring regression
- **behavior-audit:** Invalidate phase1b on clustering config changes
- **behavior-audit:** Migrate legacy v5 phase1b progress
- **behavior-audit:** Persist phase1b clustering settings
- **behavior-audit:** Invalidate phase1b when embedding identity changes
- **behavior-audit:** Include embedding base url in phase1b identity
- **behavior-audit:** Include embedding provider identity in cache validation
- **behavior-audit:** Enforce pairwise gap checks for single linkage
- Accumulate clustering timings
- Wire tune clustering profile flags
- Separate tune profiling samples
- Avoid duplicate tune profile runs
- Persist clustering profile runs incrementally
- Validate profile runner flag values
- Report unknown profile flags correctly
- Satisfy strict schema formatter lint
- Handle unrepresentable tool schemas
- Accept schema-like formatter inputs
- Satisfy strict tool metadata lint
- Refine papai tool proxy search
- Validate tool proxy benchmark scenarios
- Harden tool proxy benchmark validation
- Reject empty benchmark default models
- Honor empty benchmark model env
- Let benchmark CLI models override env
- Validate proxied tool arguments
- Execute proxied tools with parsed args
- Preserve proxied tool behavior
- Persist facts from multi-step tool calls
- Exclude pi extension from project typecheck and lint
- Stop trimming bash tool output in compact-tools extension
- Add 1-char left padding to all interaction containers
- Move compact-tools extension to .pi/extensions for auto-discovery
- Remove project-local compact-tools, fix codeindex-reindex bun import
- Preserve nearest-cluster NaN ordering
- Preserve nearest-cluster sort barriers
- Handle infinite nearest distances
- Preserve Bun nearest sort semantics for non-finite distances
- Keep infinite nearest distances on fast path
- Restore active snapshot profiling counters
- Scope cached group observations by provider
- **attachments:** Drop unreliable changes() and $client usage in purgeExpiredStagedFiles
- **attachments:** Handle missing staged_files table in purgeExpiredStagedFiles
- **tools:** Strengthen resolve_staged_file type guard and clean up lint
- **attachments:** Eliminate staged downloader singleton, atomic upserts, Discord docs
- Clean routing branch lint and scope drift
- Verify tool surface benchmark
- Align context tool catalog with degraded tool state
- Prefer live context tool catalogs
- Tighten context catalog fallback behavior
- Fall back to cached context tools
- Keep degraded context tools cache-only
- Align context summary tool wiring
- Align context tool snapshot state
- Clean up context tool resolution seams
- Avoid context tool rebuild fallback
- Align context tool surface resolution
- Isolate youtrack bundle cache tests
- Narrow behavior audit exports
- Trim helper barrel exports
- Finish behavior-audit task 3 cleanup
- Align advanced clustering test imports
- Wait for review-loop command advertisements
- Update YouTrack tools integration test for direct tool surface
- Default behavior audit linkage to complete
- **codeindex:** Reuse parser runtime initialization

### Miscellaneous

- **attachments:** Underscore-prefix the test-only blob-store DI hooks
- Remove local opencode TPS meter integration
- Add clustering profile runner
- Commit all current changes
- Add tool proxy benchmark
- Bump opencode plugin version, format compact-tools spec
- Format telegram group label plan
- Format telegram group label plan
- Configure knip for behavior audit entrypoints
- Format knip config
- Satisfy registry lint rules
- Align knip with production tool surfaces
- Simplify knip workspace config

### Testing

- **behavior-audit:** Cover complete linkage conservatism
- **behavior-audit:** Cover gapThreshold wiring in tune-embedding
- **behavior-audit:** Cover provider-matched embedding cache reuse
- Add clustering profiling primitives
- Cover clustering profile defaults
- Update makeTools proxy expectations
- Add Pi extension tests for codeindex-reindex and tdd-enforcement
- Update youtrack tools integration for proxy tool
- Cover telegram resolver live user precedence
- **attachments:** Lock down staged file resolution edge cases
- Isolate context command cache state
- Pin hyphenated context tool ordering

### Merge

- Origin/master into copilot/research-tools-pollution-reduction

### Plan

- Compact tools extension implementation

### Spec

- Compact tools extension design

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
- **helpers:** Replace mockDrizzle mock.module with \_setDrizzleDb setter
- Remove mockDrizzle calls (setupTestDb auto-sets drizzle)
- Replace drizzle mock.module with \_setDrizzleDb in all test files
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
- Rename unused reply param to \_reply in bot-auth.test.ts (TS6133)
- Complete logger mock in recurring and cron tests to fix failing logger tests
- Simplify test command to use bun test auto-discovery
- Remove tests from ignorePatterns so tests are copied to sandbox
- **scripts:** Fix shell escaping in detect-duplicates.ts
- Await rejects assertion in propagates provider errors test
- **cron:** Validate step > 0 to prevent infinite loop on \*/0
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
- **cron:** Add test for negative step value (\*/-1)

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

[3.0.3]: https://github.com/yourpapai/papai/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/yourpapai/papai/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/yourpapai/papai/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/yourpapai/papai/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/yourpapai/papai/compare/v1.0...v2.0.0
[1.0]: https://github.com/yourpapai/papai/compare/v0.9...v1.0
[0.9]: https://github.com/yourpapai/papai/compare/v0.8...v0.9
[0.1]: https://github.com/yourpapai/papai/compare/v0.0.0...v0.1
