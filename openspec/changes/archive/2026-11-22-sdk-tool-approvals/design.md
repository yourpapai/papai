<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design

## Context

See `proposal.md` — Why, and `specs/tool-permissions/spec.md` for the behavior contract.

Current path:

- `makeTools` runs `applyToolPreferences` (`src/tools/index.ts:40`), which resolves each tool's permission from `tool_prefs` keyed by the config context id, drops `deny` tools, and wraps every `ask` tool with an extended schema plus `gatedExecute` (`src/tools/permission-gate.ts:122`).
- `gatedExecute` awaits `askPermission` → `askPermissionViaChat` (`src/chat/permission-prompt.ts:216`) → `perm:a:`/`perm:d:` buttons, 5-minute timeout. On deny it returns `{ status: 'permission_denied' }` as the tool result.
- `classifyToolTerminal` (`src/llm-orchestrator-tool-terminal.ts:65`) turns that result into the `permission_denied` execution outcome; `detectToolFailure` (`src/completion/verified-completion.ts:31`) does not see it as a `ToolFailureResult`, so a denial today reaches the risky-turn path only through the model's own result payload.

Probed on the pinned `ai` 7.0.179 with a mock model and an explicit `stopWhen`:

- A `toolApproval` resolver may be **async**: awaiting it inside the call keeps the loop alive, and the turn keeps one steering target, one budget, one usage row.
- `'approved'` → the tool executes and the loop continues with a normal `tool-result`.
- `{ type: 'denied', reason }` → nothing executes and the SDK writes `tool-result` with `output: { type: 'execution-denied', reason }`, which the provider receives and the model reads.
- The alternative `user-approval` status **returns** from `generateText` with a `tool-approval-request` part and requires a replay turn.

## Goals / Non-Goals

**Goals:**

- Move the approval boundary in front of execution without splitting the model turn.
- Make a denial a first-class, model-visible result while preserving today's prompt, timeout, analytics, and scope behavior.
- Delete the in-`execute` gate and its fabricated result shape.

**Non-Goals:**

- Approvals that outlive the model call (`user-approval` suspension, persisted approvals, signed approval replay).
- Provider-executed tool approvals, a new prompt design, or changing permission resolution.

## Decisions

### D1: Await the existing prompt from a `toolApproval` resolver, not from a suspension

`callGenerateText` passes `toolApproval: buildToolApproval(...)` to `generateText`. The resolver awaits the same chat prompt and returns `'approved'` or `{ type: 'denied', reason }`; every non-`ask` tool returns `'not-applicable'`.

Alternatives considered:

- `user-approval` + approval-replay turn — rejected: it ends the run at the boundary, so mid-run steering has no target, `/stop` has nothing to abort, `finishReason: 'tool-calls'` makes the turn look truncated (the verifier would fire), history holds a call with no result (`validateToolResults` would inject a synthetic error, `src/llm-orchestrator-validation.ts:93`), and one user turn becomes two model calls with two budgets and two usage rows. The awaited resolver delivers the same model-visible denial without any of that.
- Keeping `gatedExecute` — rejected: it is the behavior this change exists to remove.

### D2: Assembly stops gating; it keeps only the schema and the reason strip

`applyToolPreferences` still extends an `ask` tool's schema with `_permission_reason` and still drops `deny` tools, but the wrapper now only strips the reason field before calling `execute`. `gatedExecute`, `buildPermissionDenied` and the no-surface denial branch move out of `permission-gate.ts`; the module instead exports `buildToolApproval`.

The reason stays model-authored so the prompt keeps its current explanation; stripping keeps the field out of execution, compaction, and analytics.

Alternative considered: `experimental_refineToolInput` to drop the field — rejected: experimental, per-call config, and it must preserve the input shape.

### D3: One resolver per model call, resolution re-read at call time

`buildToolApproval({ contextId, askPermission })` returns the generic resolver: for each tool call it resolves the permission again (`resolveToolPermission` over the context's `tool_prefs`) and asks only when the result is `ask`. That keeps assembly and the resolver from needing a shared tool-name set, and it fails safe: a preference tightened mid-turn still prompts.

`askPermission` is already bound to the reply surface in `buildLlmInvocationOpts` (`src/llm-orchestrator-tools.ts:125`), so the resolver is built there and carried on `InvokeModelArgs` → `GenerateArgs` → the `generateText` options. It is a required field on those types so a missing wiring is a typecheck failure, not a silently ungated path.

Call sites that offer a toolset to a model must pass it:

- the interactive turn (`callGenerateText`);
- the verifier turn, built from the same `InvokeModelArgs` (`buildTurnVerifier`, `src/llm-orchestrator-support.ts`);
- the proactive turn, which has no chat surface and therefore denies.

Alternative considered: have `applyToolPreferences` return `{ tools, askToolNames }` — rejected: it changes a widely used assembly signature (`makeTools`, verifier, proactive, stories) for a list the resolver can rebuild from the same pure resolution it already needs.

### D4: Denial wording and timeout are preserved

The resolver maps the prompt's decision to the current user-visible text: user denial, timeout (`ignored` after five minutes), and no surface each produce a `{ type: 'denied', reason }` whose reason matches today's messages. No prompt copy, masking, or timeout constant changes.

### D5: Analytics parity is emitted by the resolver

A denied call never reaches `onToolExecutionEnd`, so `classifyToolTerminal` cannot classify it. The resolver emits the same tool-execution analytics fact with `outcome: 'permission_denied'` (reusing the tool-metadata lookup and the builder used by `src/llm-orchestrator-tool-events.ts`), and the existing `confirmation_requested`/`confirmation_resolved` facts stay where they are.

`detectToolFailure` learns the `execution-denied` tool-result output as a denial, so the risky-turn verdict and the verified-completion path keep their current outcome.

Alternative considered: drop `permission_denied` from execution analytics and rely on the confirmation facts — rejected: it silently changes the dashboard contract.

### D6: No new module, state, or dependency

Everything stays in `src/tools/permission-gate.ts` plus threading through the orchestrator types. No persisted approval state: the pending prompt is the existing in-memory map in `src/chat/permission-prompt.ts` keyed by request id, so the scope model is untouched — `tool_prefs` remains keyed by the config context id (group-shared across a group's threads), approvals are per turn, and no user, platform-instance, or task-instance key is introduced. The AI SDK already provides the approval hook, so no dependency is added.

### D7: Test-first order and hook interactions

New behavior is gated by the Write/Edit TDD hook (new `tests/tools/permission-approval*.test.ts` and additions to the existing orchestrator/permission tests):

1. failing tests for `buildToolApproval` (ask → prompt, allow/not-applicable, denial reasons, timeout, no surface);
2. failing wiring tests asserting `toolApproval` reaches `generateText` for the interactive and verifier calls and denies in proactive;
3. failing analytics/verdict tests for `execution-denied`;
4. implementation, then deletion of the `gatedExecute` tests with the code they pin.

## Risks / Trade-offs

- **SDK approval-hook drift** → the resolver is built in one module and typed against the SDK's generic function; typecheck and the approval tests fail loudly on a shape change.
- **A second prompt for the same call** → the probe showed one resolver invocation per tool call and the SDK does not retry tool calls; a test pins one prompt per call.
- **Ungated path from a forgotten call site** → the resolver is a required field on the invocation types, so forgetting it is a compile error; a wiring test asserts each of the three call sites passes it.
- **Reason leaked into execution** → the strip wrapper is the only path from an `ask` tool to `execute`; a test asserts the executed input has no reason field.
- **Analytics drift** → `permission_denied` is emitted by the resolver and asserted in the same suite as `classifyToolTerminal`, so a regression in either shows up together.
- **Preference changed mid-turn** → the resolver re-reads at call time and fails safe (prompts when now `ask`); assembly's exposure decision is never looser than the resolver's.

## Migration Plan

Code-only, no data migration, no feature flag. Deploy with the normal build. Rollback is `git revert` of the implementation commit, which restores `gatedExecute` and the fabricated denial shape together.
