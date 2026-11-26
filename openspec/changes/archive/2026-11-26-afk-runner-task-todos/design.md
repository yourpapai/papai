# afk-runner-task-todos — Design

## Context

See proposal.md — Why. The surfaces this rides all exist: `TaskEvent.detail` is an optional field already carried by `task failed` (execution-schemas.ts); todo capture fires through the line-handler hook into `createAgentReporter` (agent-todos-capture D1/D4); the walk's started event is appended in `runImplementWork` with the item in hand; `TaskRecord` is non-projected residue the parity oracle never compares (kernel/types.ts — "like children"); the board's detail projection already scans events for the todos panel.

## Goals / Non-Goals

**Goals:** walk/feed/memo name tasks from the log alone; implementer todo usage mandated at the one prompt seam; honest zero-snapshot marks; every change additive (old logs, memos, and folds byte-equivalent).

**Non-Goals:** think-half mandates (proposal Non-goals), `analyze` compliance metrics, runner-synthesized todos, the board reading `tasks.md`, hard enforcement of any kind.

## Decisions

**D1 — Started events carry the item text in the existing `detail` field.** `runImplementWork`'s `task started` append gains `detail`: the item's `tasks.md` line collapsed to one line and truncated at 200 chars (the `sanitizeRowGap`/todo-content bound precedent — a shared helper if one more consumer appears). Reuse over a distinct `text` field: zero schema change, and the field's contract — "context for this task fact" — holds for both the started text and the failed tail. `task failed`'s tail and `task done`'s shape are untouched.

**D2 — The fold stamps and preserves `TaskRecord.text`; parity is untouched by construction.** `toKernelEvent` maps `task.started` with `detail`; the kernel event union grows `readonly detail?: string`; `TaskRecord` grows optional `text`. `startTask` stamps `text: event.detail` (last-wins — a retry re-stamps the same text); `finishTask`, which currently rebuilds the record bare (`{status, attempts}`), carries `prior?.text` forward — a test pins text surviving done and failed. The legacy fold tolerates `task` events wholesale (U3-era vocabulary) and the tasks record is parity-excluded residue, so no fixture or oracle changes. The memo's tasks-record schema grows the optional `text` (zod optional — pre-change memos parse unchanged; the additivity pin extends).

**D3 — The mandate rides `spawnPromptOf`'s shared guard lines.** One backend-neutral line — plan with the todo tool before editing, keep it current — joins the existing guard array, so fresh, fix, and validation-retry prompts all carry it (retry appends to the full prompt) with no per-branch edits. Continuation prompts (`buildContinuationPrompt`, agent-layer) restate the output target only and are untouched: the continued session already holds the mandate in context.

**D4 — The mark is detected at the reporter, emitted at the `done` seam, role-gated.** `createAgentReporter` returns `ProgressReporter & { sawTodos(): boolean }` — the closure already tracks the last snapshot for dedup; the flag is whether the todos hook ever fired. No review-loop type changes. In `attemptStageAgent`'s success path, after the `done` event, when `options.role === 'implementer'` and `!reporter.sawTodos()`: emit one L0 `todos_missing {agent: label}`. Per-attempt reporters make the semantics exact — the mark means "this completed spawn session emitted nothing". Validation-failed attempts emit no `done` and no mark; killed attempts take the catch path and emit no mark (a crash is not non-compliance). Non-implementer roles never mark.

**D5 — `todos_missing` is a new tolerated L0 noise event.** Declared in `agent-noise-schemas.ts` beside `agent_todos`, unioned into the event union; both folds skip it unmapped (`tolerated += 1`); the tolerance-accounting pin covers it like `agent_todos`. It never drives state, retries, or gates.

**D6 — Board rendering: three small extensions, one scan.** `TaskWalkEntry` grows `text: string | null` (from the folded record); `summarizeEvent`'s task line appends `boundedDetail(event.detail)` when present (started text and failed tail become feed-visible — the tail is currently captured but rendered nowhere); the detail view grows `missingTodos: readonly string[]` — labels carrying a `todos_missing` event, deduped last-wins — rendered in the todos panel as a no-todos-emitted note, no synthesized items. All three ride the event array the projection already holds. The panel keeps label-keyed headers; joining `implement-t<n>` to the walk's `t<n>` text client-side is declined — the walk rows already name the items.

## Risks / Trade-offs

- [Mandate compliance stays model-dependent] → the mark makes absence visible; `analyze` can quantify later without new events.
- [`detail` carries two meanings by action] → contextual contract documented in D1; both readers bound length; no reader branches on the field across actions.
- [`finishTask` rebuild could drop text] → D2's preservation pin; mutation gate covers the rebuilt-record branch.
- [Prompt line drift between fresh/fix branches] → D3 rides the shared guard array; a prompt-content test pins presence in both.

## Migration Plan

Purely additive: one reused optional event field, one optional record/memo field, one tolerated noise event, one prompt line. Old logs fold byte-equivalently; old memos validate; rollback is `git revert` — already-written marks and details are harmless tolerated noise.

## Hook/TDD interactions

Gateable files under `afk-runner/src/**`, test-first order: (1) kernel fold/machine — `TaskRecord.text` stamp + preservation + `todos_missing` tolerance (`tests/afk-runner/`); (2) implement work module — started `detail` bound, mandate line present in fresh and fix prompts (fake-pipeline harness captures the prompt); (3) agent-reporter — `sawTodos` flag; (4) agent-layer — mark emission matrix (implementer×zero-snapshot only; success path only); (5) run-state/memo — text projection + pre-change memo parse; (6) serve run-detail — walk text, feed detail, `missingTodos`. `static/index.html` is not gateable; its render change rides the detail-view tests plus a manual board check.
