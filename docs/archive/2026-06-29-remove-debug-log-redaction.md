<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remove Debug Log Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the debug dashboard's log surface (`/logs` REST + `log:entry` SSE) return full, unredacted log content to the authenticated admin, and delete the now-unused redaction module.

**Architecture:** Privacy for logs shifts from _content redaction_ to _access control + network boundary_ (dashboard session cookie + localhost binding + `DEBUG_SERVER` flag). Turns and all other SSE panels are untouched — they remain gated by `isVisibleToAdmin` at `src/debug/state-collector.ts:155`, which already covers both the live SSE stream and the in-memory buffers. The two log egress points stop calling `redactLogEntry`, and `src/debug/log-redaction.ts` is deleted.

**Tech Stack:** Bun runtime + `bun:test`, TypeScript (strict, `.js` import paths), pino logging, SSE event bus.

**Spec:** `docs/superpowers/specs/2026-06-29-remove-debug-log-redaction-design.md`

---

## File Structure

**Modified:**

- `src/debug/log-buffer.ts` — remove redaction import + emit raw entry on `log:entry` (egress point 1).
- `src/debug/server.ts` — remove redaction import + return raw `/logs` results (egress point 2).

**Deleted:**

- `src/debug/log-redaction.ts` — the redactor (sole export `redactLogEntry`; internal `ALLOWED_FIELDS`, `SAFE_MSG_TEMPLATES`).
- `tests/debug/log-redaction.test.ts` — unit tests for the deleted function.

**Tests modified:**

- `tests/debug/logs-route-redaction.test.ts` → renamed to `tests/debug/logs-route-content.test.ts`, assertions inverted to prove content passes through.
- `tests/debug/log-buffer.test.ts` — replace the `'log:entry emit redaction'` describe block with an unredacted-emit test.

**Docs:**

- `docs/adr/0224-remove-debug-log-redaction.md` — new ADR (created).
- `docs/adr/0223-turns-lookup-scope-enforcement.md` — amend two redaction references.
- `docs/adr/README.md` — append ADR-0223 + ADR-0224 table rows.
- `docs/design/admin-debug-dashboard-fixes-spec.md` — add a superseded banner.

---

## Task 1: `/logs` REST route returns full content

Invert the route-level redaction test first (it will fail because redaction still strips `userText`), then remove redaction from the `/logs` handler to make it pass.

**Files:**

- Rename + rewrite: `tests/debug/logs-route-redaction.test.ts` → `tests/debug/logs-route-content.test.ts`
- Modify: `src/debug/server.ts:16` (remove import), `src/debug/server.ts:92-103` (`handleLogs`)

- [ ] **Step 1: Rename the test file**

```bash
git mv tests/debug/logs-route-redaction.test.ts tests/debug/logs-route-content.test.ts
```

- [ ] **Step 2: Rewrite the test to assert content passes through**

Replace the entire `describe('/logs redaction', ...)` block in `tests/debug/logs-route-content.test.ts` (lines 29-71) with the following. The pushed entry now uses a **non-template** `msg` (`searchTasks called`) so the test also proves arbitrary messages are no longer turned into `[redacted]`:

```typescript
describe('/logs content (unredacted)', () => {
  let cookie: string

  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    setStoreDb(getTestDb().$client)
    // getPort() reads DEBUG_PORT; bind a unique port for this worker
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer(ADMIN, { debugEnabled: true })
    const { cookieValue } = mintSession(ADMIN, { secure: false })
    cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`
    logBuffer.clear()
    logBuffer.push({
      level: 30,
      time: '2026-06-15T00:00:00.000Z',
      msg: 'searchTasks called',
      userText: 'top secret',
      scope: 'bot',
      messageLength: 10,
    })
  })

  afterAll(() => {
    stopDebugServer()
    setStoreDb(null)
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('returns full fields and the verbatim msg', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/logs`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await readJsonArray(res)
    expect(body).toHaveLength(1)
    const entry = body[0]
    expect(pick(entry, 'userText')).toBe('top secret')
    expect(pick(entry, 'messageLength')).toBe(10)
    expect(pick(entry, 'msg')).toBe('searchTasks called')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/debug/logs-route-content.test.ts`
Expected: FAIL — `userText` is `undefined` (redaction drops it) and `msg` is `'[redacted]'` (non-template), so both assertions fail.

- [ ] **Step 4: Remove redaction from the `/logs` handler**

In `src/debug/server.ts`, delete the import at line 16:

```typescript
import { redactLogEntry } from './log-redaction.js'
```

Then change the return at line 102 (inside `handleLogs`) from:

```typescript
return jsonResponse(results.map(redactLogEntry))
```

to:

```typescript
return jsonResponse(results)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/logs-route-content.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/debug/logs-route-content.test.ts src/debug/server.ts
git commit -m "feat(debug): return unredacted logs from /logs route"
```

---

## Task 2: `log:entry` SSE emits the full entry

The `LogRingBuffer.push` egress still redacts the broadcast copy. Replace the redaction-focused buffer test with one asserting the emitted payload is the full entry, then remove redaction from `push`.

**Files:**

- Modify: `tests/debug/log-buffer.test.ts:267-294` (replace describe block)
- Modify: `src/debug/log-buffer.ts:7` (remove import), `src/debug/log-buffer.ts:63` (emit raw)

- [ ] **Step 1: Replace the redaction describe block with an unredacted-emit test**

In `tests/debug/log-buffer.test.ts`, replace the entire block at lines 267-294 (`describe('log:entry emit redaction', ...)`) with:

```typescript
describe('log:entry emit (unredacted)', () => {
  test('emits the full entry verbatim and keeps it in the buffer', () => {
    const buf = new LogRingBuffer(10)
    const events: DebugEvent[] = []
    const listener = (e: DebugEvent): void => {
      events.push(e)
    }
    subscribe(listener)
    try {
      buf.push(
        makeEntry({
          msg: 'searchTasks called',
          userText: 'secret',
          scope: 'bot',
          messageLength: 6,
        }),
      )
    } finally {
      unsubscribe(listener)
    }

    expect(events).toHaveLength(1)
    expect(events[0]!.data['userText']).toBe('secret')
    expect(events[0]!.data['msg']).toBe('searchTasks called')
    expect(events[0]!.data['messageLength']).toBe(6)
    // Buffer still retains the full entry
    expect(buf.entries()[0]).toHaveProperty('userText', 'secret')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/log-buffer.test.ts`
Expected: FAIL in `log:entry emit (unredacted)` — `events[0].data.userText` is `undefined` and `msg` is `'[redacted]'` because `push` still calls `redactLogEntry`.

- [ ] **Step 3: Remove redaction from `push`**

In `src/debug/log-buffer.ts`, delete the import at line 7:

```typescript
import { redactLogEntry } from './log-redaction.js'
```

Then change line 63 (inside `push`) from:

```typescript
emitGlobal('log:entry', redactLogEntry(entry) as Record<string, unknown>)
```

to:

```typescript
emitGlobal('log:entry', entry as Record<string, unknown>)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/log-buffer.test.ts`
Expected: PASS (all describes, including `SSE emission` and the new `log:entry emit (unredacted)`).

- [ ] **Step 5: Commit**

```bash
git add tests/debug/log-buffer.test.ts src/debug/log-buffer.ts
git commit -m "feat(debug): emit unredacted log entries on the SSE stream"
```

---

## Task 3: Delete the redaction module and its unit test

Both egress points no longer import `redactLogEntry`; the module is now dead code.

**Files:**

- Delete: `src/debug/log-redaction.ts`
- Delete: `tests/debug/log-redaction.test.ts`

- [ ] **Step 1: Delete both files**

```bash
git rm src/debug/log-redaction.ts tests/debug/log-redaction.test.ts
```

- [ ] **Step 2: Verify no remaining references**

Run: `grep -rn "log-redaction\|redactLogEntry\|ALLOWED_FIELDS\|SAFE_MSG_TEMPLATES" src/ tests/ client/`
Expected: no matches (exit status 1, no output). If anything prints, remove that reference before continuing.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS — no dangling imports of the deleted module.

- [ ] **Step 4: Run the full debug test suite**

Run: `bun test tests/debug/`
Expected: PASS. (Confirms nothing else depended on redaction behavior.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(debug): delete unused log-redaction module"
```

---

## Task 4: New ADR + doc updates

Record the decision and de-stale the docs that describe redaction.

**Files:**

- Create: `docs/adr/0224-remove-debug-log-redaction.md`
- Modify: `docs/adr/0223-turns-lookup-scope-enforcement.md` (lines 29, 68)
- Modify: `docs/adr/README.md` (append rows after line 227)
- Modify: `docs/design/admin-debug-dashboard-fixes-spec.md` (superseded banner)

- [ ] **Step 1: Create ADR-0224**

Create `docs/adr/0224-remove-debug-log-redaction.md` with exactly this content:

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0224: Remove Debug Log Redaction

## Status

Implemented

## Date

2026-06-29

## Context

The debug dashboard's Log Explorer was effectively unreadable: `redactLogEntry`
(`src/debug/log-redaction.ts`) applied a default-deny allowlist of ~20 structured fields
plus a 2-entry `SAFE_MSG_TEMPLATES` set, so almost every log line rendered as `[redacted]`.
The allowlist was hardcoded, not runtime-configurable, and drifted.

Redaction was also the only privacy control that worked by hiding _content_. Every other
dashboard panel (Turns, Sessions, LLM Trace, Notifications, Tool Failures, Live Context) is
fed by SSE events gated on _scope visibility_ (`isVisibleToAdmin`, `state-collector.ts:155`),
showing full content for scopes the admin may see. Redaction was a lone, inconsistent gate
on one panel while the rest of the same dashboard streamed full content.

## Decision

Remove log redaction entirely (supersedes ADR-0197 Decision 3, the centralized egress
redactor). Both log egress points — `log:entry` SSE emission (`log-buffer.ts`) and the
`/logs` REST route (`server.ts`) — now return raw entries. `src/debug/log-redaction.ts` is
deleted.

The privacy model for logs becomes _access control + network boundary_:

1. Dashboard session cookie (minted only via the `/dashboard` bot-DM single-use nonce).
2. `DEBUG_HOSTNAME` defaults to `127.0.0.1` (localhost-only).
3. `DEBUG_SERVER` flag (off → `/logs`, `/events`, `/turns/*`, `/debug` return 404).

Turns and all other SSE panels are unchanged: the `isVisibleToAdmin` gate at
`state-collector.ts:155` already covers both the live SSE stream and the buffers. ADR-0223
(`/turns/:id` scope enforcement) stands on its own and is retained.

## Consequences

### Positive

- The Log Explorer shows real content; search/filter become useful.
- One coherent privacy model: scope-visibility for SSE panels, auth + binding for logs.
- Less code; no hardcoded allowlist to drift.

### Negative / Risks

- **Admin sees all users' content.** Anyone holding the admin session reads every user's
  raw messages, tool args, and errors in the log stream. This knowingly reverses the
  multi-tenant-strict posture: suitable for single-tenant / fully-trusted-operator
  deployments, **not** for shared instances whose end-users expect privacy from the operator.
- **No safety net for accidentally-logged secrets.** The `CLAUDE.md` "never log tokens, API
  keys, session cookies, or other sensitive data" rule is now a load-bearing control, not a
  convention with a backstop. A secret-key ingest serializer is recommended future work.

### Unchanged

The in-memory ring buffer already held unredacted entries, so at-rest exposure is identical;
this only aligns egress with what was already in memory. Still in-memory-only, no external
sink, lost on restart.

## Related Decisions

- ADR-0197: Debug Observability Fixes (introduced the redactor; Decision 3 superseded here).
- ADR-0223: `/turns/:id` Scope Enforcement (turn scope-visibility, retained).
```

- [ ] **Step 2: Amend ADR-0223 redaction references**

In `docs/adr/0223-turns-lookup-scope-enforcement.md`, change line 29 from:

```markdown
— the same free-text fields `redactLogEntry` drops elsewhere.
```

to:

```markdown
— free-text fields that were also dropped by log redaction (removed in ADR-0224).
```

Then change line 68 from:

```markdown
- ADR-0197: Debug Observability Fixes (the `isVisibleToAdmin` invariant and egress redaction).
```

to:

```markdown
- ADR-0197: Debug Observability Fixes (the `isVisibleToAdmin` invariant; its egress redaction was removed in ADR-0224).
- ADR-0224: Remove Debug Log Redaction (turn scope-enforcement here is independent and retained).
```

- [ ] **Step 3: Append ADR table rows**

In `docs/adr/README.md`, after the ADR-0222 row (line 227), add these two rows (the table currently stops at 0222; 0223 was never added):

```markdown
| [0223](0223-turns-lookup-scope-enforcement.md) | `/turns/:id` Scope Enforcement | 2026-06-28 | Implemented | |
| [0224](0224-remove-debug-log-redaction.md) | Remove Debug Log Redaction | 2026-06-29 | Implemented | |
```

- [ ] **Step 4: Add a superseded banner to the admin-debug spec**

In `docs/design/admin-debug-dashboard-fixes-spec.md`, insert this blockquote immediately after the top-level `# ` title line (so readers see it before the stale redaction guidance further down):

```markdown
> **Superseded (2026-06-29):** Log redaction (`redactLogEntry` / `log-redaction.ts`) was removed in **ADR-0224**. Sections below that describe `[redacted]` log content or the `ALLOWED_FIELDS` allowlist no longer reflect the code; logs are now returned unredacted to the authenticated admin. Turn/SSE scope filtering (`isVisibleToAdmin`) is unchanged.
```

- [ ] **Step 5: Verify formatting and license headers, then commit**

Run: `bun run check`
Expected: PASS (lint, typecheck, format:check, license-headers all green for staged files).
If `format:check` fails, run `bun run format` and re-stage. If `license-headers` fails on the new ADR, run `bun license:headers`.

```bash
git add docs/adr/0224-remove-debug-log-redaction.md docs/adr/0223-turns-lookup-scope-enforcement.md docs/adr/README.md docs/design/admin-debug-dashboard-fixes-spec.md
git commit -m "docs(adr): record ADR-0224 removing debug log redaction"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full debug suite + typecheck + lint**

Run: `bun test tests/debug/ && bun run typecheck && bun run lint`
Expected: all PASS. This run includes the retained guard for the surviving privacy layer — `tests/debug/admin-visibility.test.ts` (asserts `isVisibleToAdmin` returns `false` for foreign user/group scopes), `tests/debug/scope-visibility.test.ts`, and `tests/debug/server.test.ts`. These must still pass unchanged, proving that removing log redaction did not loosen turn/SSE scope filtering. No new guard test is needed.

- [ ] **Step 2: Confirm redaction is fully gone**

Run: `grep -rn "redactLogEntry\|log-redaction\|ALLOWED_FIELDS\|SAFE_MSG_TEMPLATES" src/ tests/ client/`
Expected: no matches.

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Start the app with the debug server enabled, open `/debug`, and confirm the Log Explorer panel shows real log messages and structured fields instead of `[redacted]`. (Requires a `/dashboard` session per the normal auth flow.)
