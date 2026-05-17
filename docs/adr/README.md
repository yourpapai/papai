# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the **papai** (Personal Adroit Proactive AI) project.

ADRs capture the context, options considered, and rationale behind significant architectural decisions. Each ADR is derived from an implementation plan in `docs/plans/done/` and verified against the current codebase.

## Index

| ADR                                                                  | Title                                                                                       | Date       | Implementation Status                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| [0001](0001-youtrack-zod-schema-library.md)                          | YouTrack Zod Schema Library                                                                 | 2025-03-18 | Implemented (with divergence)                       |
| [0002](0002-youtrack-runtime-validation-and-types-removal.md)        | YouTrack Runtime Validation via Zod Parse and types.ts Removal                              | 2026-03-18 | Implemented (via direct schema reuse)               |
| [0003](0003-e2e-test-harness-with-docker.md)                         | E2E Test Harness with Docker Compose                                                        | 2026-03-13 | Implemented (with deviations)                       |
| [0004](0004-comprehensive-e2e-test-coverage.md)                      | Comprehensive E2E Test Coverage for Kaneo Operations                                        | 2026-03-13 | Implemented                                         |
| [0005](0005-e2e-test-failure-remediation.md)                         | E2E Test Failure Remediation Strategy                                                       | 2026-03-13 | Implemented (partial deviation)                     |
| [0007](0007-layered-architecture-enforcement.md)                     | Layered Architecture Enforcement                                                            | 2026-03-13 | Implemented                                         |
| [0008](0008-ddd-tactical-patterns.md)                                | DDD Tactical Patterns                                                                       | 2026-03-13 | Partially Implemented                               |
| [0009](0009-multi-provider-task-tracker-support.md)                  | Multi-Provider Task Tracker Support                                                         | 2026-03-13 | Implemented                                         |
| [0010](0010-drizzle-orm-migration.md)                                | Drizzle ORM for Database Access                                                             | 2025-03-20 | Implemented                                         |
| [0011](0011-knip-dead-code-detection.md)                             | Knip for Dead Code Detection and Enforced Export Hygiene                                    | 2026-03-18 | Implemented                                         |
| [0013](0013-semgrep-security-scanning.md)                            | Semgrep Security Scanning Integration                                                       | 2026-03-18 | Implemented                                         |
| [0014](0014-multi-chat-provider-abstraction.md)                      | Multi-Chat Provider Abstraction                                                             | 2026-03-19 | Implemented                                         |
| [0015](0015-enhanced-tool-capabilities.md)                           | Enhanced Tool Capabilities (Phase 02)                                                       | 2026-03-20 | Implemented                                         |
| [0016](0016-conversation-persistence-and-context.md)                 | Conversation Persistence and Context Management (Phase 03)                                  | 2026-03-20 | Implemented                                         |
| [0017](0017-mutation-testing-strykerjs.md)                           | Mutation Testing with StrykerJS                                                             | 2026-03-19 | Implemented (with divergence)                       |
| [0018](0018-group-chat-support.md)                                   | Group Chat Support                                                                          | 2026-03-20 | Implemented (with divergence)                       |
| [0019](0019-recurring-task-automation.md)                            | Recurring Task Automation                                                                   | 2026-03-20 | Implemented (with divergence)                       |
| [0020](0020-error-classification-improvements.md)                    | Error Classification Improvements (Phase 01)                                                | 2026-03-20 | Implemented                                         |
| [0021](0021-fix-false-confidence-tests.md)                           | Fix False-Confidence Tests (Phase 1)                                                        | 2026-03-22 | Implemented                                         |
| [0022](0022-fill-critical-module-test-gaps.md)                       | Fill Critical Module Test Gaps (Phase 2)                                                    | 2026-03-22 | Implemented                                         |
| [0023](0023-strengthen-schema-validation-tests.md)                   | Strengthen Schema & Validation Test Suites (Phase 3)                                        | 2026-03-22 | Implemented                                         |
| [0024](0024-common-sense-scenario-test-gaps.md)                      | Common-Sense Scenario Test Gaps (Phase 4)                                                   | 2026-03-22 | Implemented                                         |
| [0025](0025-e2e-test-hardening.md)                                   | E2E Test Hardening (Phase 5)                                                                | 2026-03-22 | Implemented                                         |
| [0026](0026-proactive-assistance.md)                                 | Proactive Assistance (Phase 7)                                                              | 2026-03-20 | Implemented                                         |
| [0027](0027-proactive-assistance-review-fixes.md)                    | Proactive Assistance Review Fixes                                                           | 2026-03-22 | Implemented                                         |
| [0028](0028-staged-only-pre-commit-checks.md)                        | Staged-Only Pre-Commit Checks                                                               | 2025-03-24 | Implemented                                         |
| [0029](0029-custom-instructions-system.md)                           | Custom Instructions System                                                                  | 2026-03-22 | Implemented                                         |
| [0030](0030-deferred-prompts-system.md)                              | Deferred Prompts System                                                                     | 2026-03-23 | Implemented (Supersedes 0026)                       |
| [0031](0031-provider-agnostic-status-vs-column-abstraction.md)       | Provider-Agnostic Status vs Column Abstraction                                              | 2026-03-18 | Implemented                                         |
| [0032](0032-timezone-tool-layer-conversion.md)                       | Timezone Tool-Layer Conversion                                                              | 2026-03-24 | Implemented                                         |
| [0033](0033-proactive-delivery-mode-recursive-loop-fix.md)           | Proactive Delivery Mode — Fix Recursive Scheduling Loop                                     | 2026-03-25 | Approved                                            |
| [0034](0034-deferred-prompt-execution-modes.md)                      | Deferred Prompt Execution Modes                                                             | 2026-03-26 | Approved                                            |
| [0036](0036-centralized-scheduler-utility.md)                        | Centralized Scheduler Utility                                                               | 2026-04-04 | Implemented                                         |
| [0037](0037-debug-server-session1.md)                                | Debug Tracing Tool — Session 1: Event Bus + Server Skeleton                                 | 2026-03-28 | Implemented (with extensions)                       |
| [0038](0038-pino-log-pipeline-session2.md)                           | Debug Tracing Tool — Session 2: Pino Log Pipeline                                           | 2026-03-28 | Implemented                                         |
| [0039](0039-debug-instrumentation-session3.md)                       | Debug Tracing Tool — Session 3: Instrument Source Modules                                   | 2026-04-04 | Implemented                                         |
| [0040](0040-debug-dashboard-html-session4.md)                        | Debug Dashboard HTML — Session 4: Live Debug Dashboard UI                                   | 2026-04-04 | Implemented                                         |
| [0041](0041-unique-kaneo-email-generation.md)                        | Unique Kaneo Email and Slug Generation                                                      | 2025-04-04 | Implemented                                         |
| [0042](0042-bot-configuration-wizard.md)                             | Bot Configuration Wizard UX                                                                 | 2026-03-27 | Implemented                                         |
| [0043](0043-tdd-hooks-integration.md)                                | TDD Hooks Integration for Multi-Platform AI Enforcement                                     | 2026-04-04 | Implemented                                         |
| [0044](0044-rename-mock-pollution-to-test-health.md)                 | Rename Mock-Pollution to Test-Health                                                        | 2026-03-30 | Implemented (with divergence)                       |
| [0045](0045-wizard-validation-approach.md)                           | End-of-Wizard Validation Instead of Per-Step Live Validation                                | 2026-03-28 | Implemented                                         |
| [0046](0046-demo-auto-provisioning.md)                               | Demo Mode Auto-Provisioning                                                                 | 2026-04-04 | Implemented                                         |
| [0047](0047-session-level-mutation-testing.md)                       | Session-Level Mutation Testing via OpenCode Plugin Events                                   | 2026-04-04 | Rejected (Research Error)                           |
| [0049](0049-client-build-pipeline.md)                                | Client Build Pipeline for Debug Dashboard                                                   | 2026-04-06 | Implemented                                         |
| [0050](0050-e2e-planning-workflow.md)                                | E2E Planning Workflow with Realism Tiers                                                    | 2026-04-10 | Implemented                                         |
| [0051](0051-discord-chat-provider.md)                                | Discord Chat Provider                                                                       | 2026-04-09 | Implemented                                         |
| [0052](0052-youtrack-full-api-implementation.md)                     | YouTrack Full API Implementation                                                            | 2026-04-08 | Implemented                                         |
| [0053](0053-llm-trace-detail-modal.md)                               | LLM Trace Detail Modal                                                                      | 2026-04-05 | Implemented                                         |
| [0054](0054-mock-isolation-guardrails.md)                            | Guardrail-First Mock Isolation for Bun Tests                                                | 2026-04-11 | Partially Implemented                               |
| [0055](0055-fix-cross-user-impersonation.md)                         | Fix Cross-User Impersonation in Group Chats                                                 | 2025-01-21 | Implemented                                         |
| [0056](0056-missing-tool-results-error-prevention.md)                | Missing Tool Results Error Prevention                                                       | 2025-04-13 | Implemented (with divergence)                       |
| [0057](0057-dependency-injection-test-refactor.md)                   | Incremental Dependency Injection for Test Isolation                                         | 2026-04-05 | Implemented                                         |
| [0058](0058-provider-capability-architecture.md)                     | Provider Capability Architecture                                                            | 2026-04-10 | Accepted                                            |
| [0059](0059-thread-aware-group-chat.md)                              | Thread-Aware Group Chat                                                                     | 2026-04-10 | Implemented                                         |
| [0060](0060-user-identity-mapping.md)                                | User Identity Mapping for Group Chats                                                       | 2026-04-10 | Implemented (with divergence)                       |
| [0061](0061-context-command-redesign.md)                             | /context Command Redesign                                                                   | 2026-04-11 | Accepted                                            |
| [0062](0062-message-queue-implementation.md)                         | Per-Context Message Queue with Debounced Coalescing                                         | 2026-04-11 | Implemented                                         |
| [0063](0063-web-fetch-mvp.md)                                        | Web Fetch MVP — Safe Public-URL Tool for LLM Enrichment                                     | 2026-04-11 | Accepted                                            |
| [0064](0064-acp-review-automation.md)                                | ACP Review Automation — Multi-Agent Review/Verify/Fix Loop                                  | 2026-04-12 | Accepted                                            |
| [0065](0065-discord-oninteraction-refactor.md)                       | Discord onInteraction Refactor                                                              | 2026-04-12 | Accepted                                            |
| [0066](0066-wire-auto-link-flow.md)                                  | Wire Auto-Link Flow on First Group Interaction                                              | 2026-04-12 | Implemented                                         |
| [0067](0067-youtrack-bulk-command-safety-boundary.md)                | YouTrack Bulk Command Safety Boundary                                                       | 2026-04-15 | Implemented                                         |
| [0068](0068-youtrack-gap-closure.md)                                 | YouTrack Gap Closure — Phase-Five Tools, Custom Fields, Command Tool                        | 2026-04-15 | Accepted                                            |
| [0069](0069-dm-only-group-settings.md)                               | DM-Only Group Settings                                                                      | 2026-04-11 | Accepted                                            |
| [0070](0070-silent-post-hooks-stop-gate.md)                          | Silent PostToolUse + Stop-Gated Full Check                                                  | 2026-04-16 | Implemented                                         |
| [0071](0071-wizard-deferred-fixes.md)                                | Wizard Deferred Fixes                                                                       | 2026-04-16 | Partially Implemented                               |
| [0072](0072-interaction-menu-replacement.md)                         | Interaction Menu Replacement                                                                | 2026-04-16 | Implemented                                         |
| [0073](0073-behavior-audit-incremental-runs.md)                      | Behavior Audit Incremental Runs                                                             | 2026-04-17 | Accepted                                            |
| [0074](0074-group-kaneo-provisioning.md)                             | Group Kaneo Provisioning with Explicit Authorization                                        | 2026-04-17 | Accepted                                            |
| [0075](0075-sensitive-message-cleanup.md)                            | Sensitive Message Cleanup During Setup/Config                                               | 2026-04-18 | Implemented                                         |
| [0076](0076-discord-thread-capabilities-documentation.md)            | Discord Thread Capabilities Documentation                                                   | 2026-04-18 | Implemented                                         |
| [0077](0077-behavior-audit-implementation.md)                        | Behavior Audit — Test-Driven UX Evaluation                                                  | 2026-04-16 | Implemented                                         |
| [0078](0078-youtrack-remaining-parity-gaps.md)                       | YouTrack Remaining Parity Gaps — Pagination Controls                                        | 2026-04-16 | Accepted                                            |
| [0086](0086-kaneo-compatibility-gap-e2e-coverage.md)                 | Kaneo Compatibility Gap — Tier 1 E2E Coverage Extension                                     | 2026-05-15 | Implemented                                         |
| [0087](0087-debug-dashboard-expansion.md)                            | Debug Dashboard Expansion — Memo, Recurring, Deferred, Turn, Context, Tool-Failure Analysis | 2026-05-15 | Implemented (with divergence)                       |
| [0090](0090-context-tool-catalog-declined-knip-cleanup-completed.md) | Decline Full Tool Catalog Emission in `/context`; Complete KNIP Cleanup                     | 2026-05-16 | Declined (tool catalog), Implemented (KNIP cleanup) |
| [0088](0088-kaneo-doc-first-api-migration.md)                        | Kaneo Doc-First API Migration                                                               | 2026-05-16 | Implemented (with divergence)                       |
| [0092](0092-architecture-inventory-generator.md)                     | Architecture Inventory Generator with Deletion-Candidate Identification                     | 2026-05-11 | Implemented (with file-structure deviation)         |

## Declined

| Plan                                                                 | Title                                    | Date       | Reason                                                              |
| -------------------------------------------------------------------- | ---------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `2026-05-12-tool-introspection-production-usage-and-knip-cleanup.md` | Full Tool Catalog Emission in `/context` | 2026-05-16 | Chat spam, wrong abstraction for a diagnostic command; See ADR-0090 |

## Skipped / Not Written

| Plan                                          | Reason                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-03-16-fix-failing-tests.md`             | Bug fix and test hygiene — no architectural decision, no options considered                                                              |
| `2026-03-20-phase-04-developer-experience.md` | CI push trigger widening and tool unit test gap-fills — implementation detail with no architectural decision content                     |
| `2026-03-20-phase-05-advanced-features.md`    | Purely adds command-handler integration tests for already-implemented authorization and config features — no new architectural decisions |
| ADR-0006                                      | Merged into ADR-0005 (design + implementation of the same remediation effort)                                                            |
| ADR-0012                                      | Reserved slot; corresponding plan not architectural                                                                                      |

## ADR Status Legend

- **Implemented** — All key outcomes verified present in the codebase
- **Implemented (with divergence)** — Implemented but with notable deviations from the original plan
- **Partially Implemented** — Some planned items present; others not implemented or replaced
- **Not Implemented** — Plan was written but not executed

## Creating a New ADR

1. Copy an existing ADR file as a template
2. Increment the number from the last entry
3. Fill in all sections, including **Implementation Status** with codebase evidence
4. Add a row to this index

## ADR Lifecycle

```
Proposed → Accepted → Deprecated → Superseded
              ↓
           Rejected
```
