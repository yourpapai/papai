<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2025 03 24 prompt injection defense

**Status:** not_implemented
**Generated:** 2026-08-07
**Plan:** `docs/superpowers/plans/2025-03-24-prompt-injection-defense.md`

## Completed

- None — 0/8 tasks implemented. Existing mitigations predate the plan (authorization gate in src/bot.ts, confirmation gate in src/tools/confirmation-gate.ts, stepCountIs limit, per-user isolation, sanitizeValue in src/deferred-prompts/alerts.ts) but these are plan context, not plan deliverables.

## Remaining

- Task 1: Create src/security/prompt-boundary.ts (wrapUserMessage, wrapExternalData, SECURITY_BOUNDARY) + tests/security/prompt-boundary.test.ts — src/security/ directory is absent
- Task 2: Create src/security/audit.ts (logSecurityEvent) + tests/security/audit.test.ts — missing
- Task 3: Integrate XML delimiters into src/llm-orchestrator.ts — buildSystemPrompt does not append SECURITY_BOUNDARY; processMessage does not wrap user content via wrapUserMessage
- Task 4: Sanitize task titles in src/deferred-prompts/poller.ts executeSingleAlert — no wrapExternalData on t.title/alert.prompt; no SECURITY line in alert system prompt; tests/deferred-prompts/poller-security.test.ts missing
- Task 5: Wrap memory fact titles in src/memory.ts buildMemoryContextMessage — no wrapExternalData on f.title
- Task 6: Add audit logging to src/tools/confirmation-gate.ts checkConfidence (logSecurityEvent for high_confidence_destructive and confirmation_gate_triggered; optional userId param) — not present
- Task 7: Harden executeScheduledPrompt in src/deferred-prompts/poller.ts — prompt.prompt not wrapped via wrapUserMessage; no SECURITY line in scheduled system prompt
- Task 8: Final verification — bun test, bun lint, bun typecheck, bun security, bun knip have no new security modules to validate

## Suggested Next Steps

1. 1. Task 1 first (TDD): write tests/security/prompt-boundary.test.ts, then src/security/prompt-boundary.ts — every later task depends on wrapUserMessage/wrapExternalData/SECURITY_BOUNDARY; verify with bun test tests/security/prompt-boundary.test.ts
2. 2. Task 2: create src/security/audit.ts with logSecurityEvent + tests/security/audit.test.ts
3. 3. Task 3: modify src/llm-orchestrator.ts (import prompt-boundary, append SECURITY_BOUNDARY in buildSystemPrompt, wrap userText in processMessage); re-run bun test to keep orchestrator tests green
4. 4. Tasks 4 and 7 together (both touch src/deferred-prompts/poller.ts): wrap task titles/alert.prompt in executeSingleAlert, wrap prompt.prompt in executeScheduledPrompt, add SECURITY lines to both system prompts; add tests/deferred-prompts/poller-security.test.ts
5. 5. Task 5: wrap fact titles in src/memory.ts buildMemoryContextMessage; run bun test tests/memory.test.ts
6. 6. Task 6: add logSecurityEvent calls + optional userId to checkConfidence in src/tools/confirmation-gate.ts; update callers (archive-task.ts, delete-task.ts, archive-project.ts, delete-status.ts, remove-label.ts)
7. 7. Task 8: run bun test, bun lint, bun typecheck, bun security, bun knip; then consider porting the plan into OpenSpec per docs/operations/legacy-migration-runbook.md
