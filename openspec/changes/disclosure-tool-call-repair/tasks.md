# Tasks: disclosure-tool-call-repair

## 1. Repair builder (core)

- [ ] 1.1 Write failing unit tests in `tests/tools/disclosure/repair-tool-call.test.ts`: builder over a real `createDisclosureSession` fixture — (a) `NoSuchToolError` for a registered-but-inactive name returns `{ toolCallId: original, toolName: 'load_tool', input: JSON.stringify({ names: [name] }) }` and the session reports the name active; (b) unregistered name returns `null` and activates nothing; (c) already-active name returns `null`; (d) `InvalidToolInputError` returns `null`; (e) two repairs for the same name are idempotent. Verify: `bun test tests/tools/disclosure/repair-tool-call.test.ts` (expect fail — module missing)
- [ ] 1.2 Implement `src/tools/disclosure/repair-tool-call.ts` (`createRepairToolCall(session, contextId)` per design D1; debug log per repair with the repaired name, no payloads). Verify: `bun test tests/tools/disclosure/repair-tool-call.test.ts`

## 2. Wire the repair into both generation paths

- [ ] 2.1 Write failing test in `tests/llm-orchestrator-invoke.test.ts`: `callGenerateText`/`invokeModel` options include `repairToolCall` when `disclosure` is present and omit the key when `disclosure` is undefined (DI `generateText` spy captures options). Verify: `bun test tests/llm-orchestrator-invoke.test.ts` (expect fail)
- [ ] 2.2 Write failing test in `tests/deferred-prompts/proactive-llm.test.ts`: the proactive full-generation `generateText` options include `repairToolCall` bound to the prepared disclosure session. Verify: `bun test tests/deferred-prompts/proactive-llm.test.ts` (expect fail)
- [ ] 2.3 Attach the repair in `src/llm-orchestrator-invoke.ts` (`callGenerateText`, only when `disclosure !== undefined`) and `src/deferred-prompts/proactive-llm.ts` (`runFullGeneration`). Verify: `bun test tests/llm-orchestrator-invoke.test.ts tests/deferred-prompts/proactive-llm.test.ts`

## 3. Anomalous empty-turn warn

- [ ] 3.1 Write failing test in `tests/llm-orchestrator-support.test.ts`: after `invokeWithLiveStatus`, a synthetic result with `usage.outputTokens >= 64`, empty `text`, and `toolCalls: []` produces one warn-level entry carrying `{ outputTokens, finishReason }` and no message content; a result with non-empty text or a tool call or `outputTokens < 64` produces none. Verify: `bun test tests/llm-orchestrator-support.test.ts` (expect fail)
- [ ] 3.2 Implement the warn in `src/llm-orchestrator-support.ts` next to "LLM response received" (design D2: fixed threshold 64, counts only). Verify: `bun test tests/llm-orchestrator-support.test.ts`

## 4. Disclosure protocol expiry line

- [ ] 4.1 Write failing test in `tests/system-prompt-disclosure.test.ts`: the assembled disclosure fragment states in en (and ru, where a locale fixture exists) that activations do not persist across turns and a tool must be re-activated before reuse. Verify: `bun test tests/system-prompt-disclosure.test.ts` (expect fail)
- [ ] 4.2 Append the expiry sentence to `disclosureProtocol` in `src/i18n/locales/en-system-prompt.ts` and `ru-system-prompt.ts`. Verify: `bun test tests/system-prompt-disclosure.test.ts`

## 5. Full verification and docs

- [ ] 5.1 Update the disclosure section of `docs/architecture/tools.md`: misdirected-call repair, anomaly warn, protocol expiry line. Verify: `bun run lint`
- [ ] 5.2 Run the full gate: `bun run test`, `bun run typecheck`, `bun run lint`; fix fallout, then `bun run test:mutate:changed` for the touched `src/` files and ratchet the mutation baseline if scores regressed. Verify: `bun run test && bun run typecheck && bun run lint`
