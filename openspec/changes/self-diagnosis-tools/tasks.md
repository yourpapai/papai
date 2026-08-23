## 1. Leaf buffer exports

- [x] 1.1 Red test: capacity constants of the turn/notification/tool-failure buffers and the LLM trace buffer are exported from `src/debug/turn-assembly.ts` / `src/debug/llm-trace-collector.ts` (assert exported values equal the internal capacities; fails first on missing exports). Verify: `bun test tests/debug/turn-assembly.test.ts tests/debug/llm-trace-collector.test.ts` (or the existing closest test files, extended)
- [x] 1.2 Export `RECENT_TURNS_CAPACITY`, `RECENT_TOOL_FAILURES_CAPACITY` from `turn-assembly.ts` and `LLM_TRACE_CAPACITY` from `llm-trace-collector.ts`; no behavior change. Verify: `bun test tests/debug/ && bun run typecheck`

## 2. read_recent_logs

- [ ] 2.1 Red test `tests/tools/diagnostics-logs.test.ts` with injected fake buffers: own entries (explicit `chatUserId` match and `ownTurnIds` turn attribution) verbatim; foreign and unattributed entries shaped to structural + numeric/boolean fields; shape-then-filter ordering (a `msg` text filter cannot match content stripping removes); level/scope/turnId filters; limit default 50 and hard cap 200; `distinct_scopes: true` returns scope/count pairs; result carries `stats` (count/capacity/oldest/newest) and `history_starts_at_process_start: true`; throwing probe degrades to `probe_error`; buffers byte-identical after invocation. Verify: `bun test tests/tools/diagnostics-logs.test.ts`
- [ ] 2.2 Implement `src/tools/diagnostics-logs.ts` (`makeReadRecentLogsTool`, DI deps, `LogFilter`-based shape-then-filter mirroring `handleLogs`, `ownTurnIdsForAdmin` resolved once per call, per-probe try/catch, metadata-only logging). Verify: `bun test tests/tools/diagnostics-logs.test.ts && bun run typecheck`

## 3. read_llm_traces

- [ ] 3.1 Red test `tests/tools/diagnostics-llm-traces.test.ts`: own traces (`chatUserId` match) verbatim; foreign/unattributed traces lose `generatedText`, `stepsDetail`, tool `args`/`result`, identity fields, keep model ids/durations/token+step counters/tool names/`error`; `errors_only` and `model` filters; limit default 25, cap 100, sliced from the tail; missing `chatUserId` shapes everything; no mutation of `recentLlm`. Verify: `bun test tests/tools/diagnostics-llm-traces.test.ts`
- [ ] 3.2 Implement `src/tools/diagnostics-llm-traces.ts` (`makeReadLlmTracesTool`, DI deps, `shapeLlmTrace` per trace, tail slice, probe_error degradation). Verify: `bun test tests/tools/diagnostics-llm-traces.test.ts && bun run typecheck`

## 4. read_recent_turns

- [ ] 4.1 Red test `tests/tools/diagnostics-turns.test.ts`: listings exclude turns whose scope fails `isVisibleToAdmin`; `status` filter over visible turns; `turn_id` fetch of own turn returns the anonymous payload (timings/status/tool names/durations/failureReason/error); foreign, invisible, and unknown `turn_id` all return `{ status: 'not_found' }` with indistinguishable shape; limit default 25, cap 512; in-flight turns included via `findTurnById`; running turns observable; no buffer mutation. Verify: `bun test tests/tools/diagnostics-turns.test.ts`
- [ ] 4.2 Implement `src/tools/diagnostics-turns.ts` (`makeReadRecentTurnsTool`, DI deps, visibility filter, not_found fetch contract, derived stats incl. capacity constant). Verify: `bun test tests/tools/diagnostics-turns.test.ts && bun run typecheck`

## 5. read_recent_tool_failures

- [ ] 5.1 Red test `tests/tools/diagnostics-tool-failures.test.ts`: entries filtered by `isVisibleToAdmin`; whitelisted egress fields only (timestamp, scope, toolName, durationMs, ok, failureReason, turnId); limit default 25, cap 1024; derived stats; no mutation. Verify: `bun test tests/tools/diagnostics-tool-failures.test.ts`
- [ ] 5.2 Implement `src/tools/diagnostics-tool-failures.ts` (`makeReadRecentToolFailuresTool`, DI deps, probe_error degradation). Verify: `bun test tests/tools/diagnostics-tool-failures.test.ts && bun run typecheck`

## 6. Assembly, gating, tool_prefs

- [ ] 6.1 Red: extend `tests/tools/diagnostics.test.ts` — family absent when `isBotAdmin !== true`, `contextType !== 'dm'`, `mode === 'proactive'`, or `mode` omitted-and-non-normal; present for admin DM normal mode; each tool bound to `options.chatUserId` as visibility principal. Verify: `bun test tests/tools/diagnostics.test.ts`
- [ ] 6.2 Extend `maybeAddDiagnosticsTools` in `src/tools/diagnostics.ts` to assemble the four factories beside `run_diagnostics` (fail-closed gate unchanged). Verify: `bun test tests/tools/diagnostics.test.ts && bun run typecheck`
- [ ] 6.3 Red test for prefs resolution: `deny` removes each reader from the resolved `ToolSet`, `ask` wraps per call (approve → executes, decline → structured `permission_denied`), implicit `allow` default, for the diagnostics domain preset tier. Verify: `bun test tests/tools/tool-preferences.test.ts`
- [ ] 6.4 Register the four names in `TOOL_METADATA` (`src/tools/tool-metadata.ts`) as `read('diagnostics')`. Verify: `bun test tests/tools/tool-preferences.test.ts tests/tools/diagnostics.test.ts && bun run typecheck`

## 7. Docs and full verification

- [ ] 7.1 Update `src/tools/CLAUDE.md` and `docs/architecture/tools.md` to surface the reader family (gate, shaping contract, volatility markers, prefs behavior). Verify: manual read-through against shipped behavior
- [ ] 7.2 Full gates: `bun run test`, `bun run typecheck`, `bun run lint`, `bun check:full`; mutation ratchet `bun run test:mutate:changed` on the PR. Verify: all green in `reports/`
