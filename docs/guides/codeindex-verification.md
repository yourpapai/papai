# codeindex Verification Checklist

**Project:** papai  
**Date:** 2026-04-25  
**Scope:** Verify codeindex MCP server is operational, efficient, and correctly preferred by agents

---

## 1. Infrastructure

- [x] `.codeindex.json` exists at repo root
- [x] `.codeindex/index.db` exists and is non-empty
- [x] Initial full index completed successfully
- [x] Incremental reindex completes without errors

### Verify Database

```bash
bun run scripts/codeindex-cli.ts stats
```

Expected output:

```json
{
  "files": 445,
  "symbols": 5532,
  "symbol_references": 13291
}
```

---

## 2. MCP Server Registration

- [x] MCP server exposes `codeindex_code_search`
- [x] MCP server exposes `codeindex_code_symbol`
- [x] MCP server exposes `codeindex_code_impact`
- [x] MCP server exposes `codeindex_code_index`
- [x] MCP stdio transport responds to JSON-RPC initialize

### Verify Server Health

On standard macOS shells, `timeout` is usually not installed unless GNU coreutils is present. Use the direct command below, then stop it with `Ctrl-C` after the initialize response prints. If you have GNU coreutils installed, `gtimeout 5` is a drop-in substitute.

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n' | bun run scripts/codeindex-cli.ts mcp
```

Expected: `{"result":{"protocolVersion":"2024-11-05",...,"serverInfo":{"name":"codeindex","version":"0.1.0"}}...}`

### Verify OpenCode Registration

```bash
opencode mcp list
```

Expected output:

```
codeindex      local    stdio  enabled
```

---

## 3. Tool-Level Functionality

### 3.1 Exact Symbol Lookup (`code_symbol`)

- [x] Find function by local name: `makeCreateTaskTool`
- [x] Find type by name: `IncomingMessage`
- [x] Returns `matchReason: "exact"` for direct matches

#### Test Command

```bash
bun run scripts/codeindex-cli.ts symbol "makeCreateTaskTool"
```

Expected: Returns `src/tools/create-task.ts` with kind `function_declaration`, scopeTier `exported`, exportNames `["makeCreateTaskTool"]`.

**Benchmark:** ~180 ms for exact name resolution.

### 3.2 FTS Keyword Search (`code_search`)

- [x] Keyword search for string literal: `create_task`
- [x] Concept search: `web fetch` returns camelCase symbols
- [x] Concept search: `bot authentication`

#### Test Commands

```bash
bun run scripts/codeindex-cli.ts search "create_task"
bun run scripts/codeindex-cli.ts search "web fetch"
```

Expected for `web fetch`:

- `SafeFetchDeps` (interface)
- `WebFetchResult` (type_alias)
- `throwWebFetchError` (function)
- `migration021WebFetch` (variable)

**Benchmark:** ~190–360 ms depending on result set.

Compare with `grep -rn "web fetch" src/` — `grep` returns only **2 log message strings** because it cannot match camelCase identifiers.

### 3.3 Cross-Reference Impact (`code_impact`)

- [x] Find who imports a symbol
- [x] Find who calls a symbol
- [x] Edge types classified (`imports`, `calls`, etc.)
- [x] Confidence levels attached (`resolved`, `file_resolved`, `name_only`)

#### Test Command

```bash
bun run scripts/codeindex-cli.ts impact "src/tools/create-task#makeCreateTaskTool"
```

Expected:

```json
[
  { "sourceFilePath": "src/tools/core-tools.ts", "edgeType": "imports", "confidence": "resolved", "lineNumber": 5 },
  { "sourceFilePath": "src/tools/core-tools.ts", "edgeType": "calls", "confidence": "resolved", "lineNumber": 14 }
]
```

**Benchmark:** ~190 ms.

Compare with `grep -rn "makeCreateTaskTool" src/` — `grep` returns raw lines with **no type information** about whether each is an import, call, or re-export.

### 3.4 Incremental Reindex (`code_index`)

- [x] `reindex` command parses only changed files + dependents
- [x] With no file changes: completes in < 100 ms
- [x] With single file change: completes in < 300 ms

#### Test Commands

```bash
bun run scripts/codeindex-cli.ts reindex
bun run scripts/codeindex-cli.ts stats
```

Expected: Same `files` count, faster elapsed time than `index`.

---

## 4. Performance Benchmarks

| Query Type                   | codeindex     | grep/rg    | Advantage                              |
| ---------------------------- | ------------- | ---------- | -------------------------------------- |
| Exact symbol lookup          | **180 ms**    | N/A        | Symbol metadata (kind, scope, exports) |
| Keyword search `create_task` | **360 ms**    | 10 ms      | Returns symbols, not raw lines         |
| Concept search `web fetch`   | **190 ms**    | **Misses** | FTS matches camelCase identifiers      |
| Impact analysis              | **190 ms**    | N/A        | Typed edges (import/call), confidence  |
| Incremental reindex          | **50–300 ms** | N/A        | Narrow dependency fan-out              |
| Full index rebuild           | **3.2 s**     | N/A        | Build once, query many                 |

---

## 5. Agent Behavior Verification

### 5.1 Instruction Source

- [x] `CLAUDE.md` contains `## Codebase Search Protocol`
- [x] Protocol specifies tool priority: `code_search` > `code_symbol` > `code_impact` > `code_index`
- [x] "Never do" rules explicitly ban `grep`/`glob`/`task explore` for structural queries inside `src/` and `client/`

### 5.2 Diagnostic Prompts for Manual Review

Run these prompts in OpenCode and observe tool calls via `OPENCODE_DEBUG=1` or TUI:

| Prompt                                                       | ✅ Correct Agent Behavior                                  | ❌ Incorrect Agent Behavior                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `Find the function that handles incoming Telegram messages.` | Calls `codeindex_code_search("incoming telegram message")` | `ls src/chat/`, `grep "telegram" src/`                        |
| `Where is makeCreateTaskTool defined?`                       | Calls `codeindex_code_symbol("makeCreateTaskTool")`        | `grep -rn "makeCreateTaskTool" src/`                          |
| `Which files call or import makeCreateTaskTool?`             | Calls `codeindex_code_impact(...)`                         | `grep -rn "makeCreateTaskTool" src/` then manual `read` loops |
| `Find all web fetch related types.`                          | Calls `codeindex_code_search("web fetch")`                 | `grep -rn "web fetch" src/` (misses camelCase)                |

### 5.3 Auto-Reindex Verification

- [x] Plugin `codeindex-reindex.ts` is registered in `opencode.json`
- [x] Plugin listens to `tool.execute.after` for `write`, `edit`, `multiedit`
- [x] Plugin filters to `src/` and `client/` `.ts/.tsx/.js/.jsx` files only
- [x] Plugin debounces per session (600 ms)
- [x] Plugin spawns `bun run scripts/codeindex-cli.ts reindex` in background

#### Test

On standard macOS shells, prefer a simple `pgrep` polling loop because `watch` is typically not installed by default.

```bash
# Terminal 1: poll for the short-lived reindex process
while true; do pgrep -fl 'scripts/codeindex-cli.ts reindex'; sleep 0.5; done

# Terminal 2: trigger write
bun -e "require('fs').writeFileSync('src/bot.ts', require('fs').readFileSync('src/bot.ts', 'utf8'))"
```

Expected: After ~600 ms, a `bun run scripts/codeindex-cli.ts reindex` process appears briefly.

---

## 6. Failure Scenarios & Remedies

| Symptom                                      | Root Cause                                                  | Fix                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `codeindex` not in `opencode mcp list`       | `opencode.json` missing `mcp.codeindex` or path typo        | Verify `"command": ["bun", "run", "scripts/codeindex-cli.ts", "mcp"]` and that the wrapper resolves the repo path        |
| `opencode mcp tools codeindex` shows nothing | Server crashes on startup                                   | Run `bun run scripts/codeindex-cli.ts mcp` directly; if needed, set `CODEINDEX_DIR` or clone the sibling repo at `../codeindex` |
| Agent still uses `grep`                      | Instructions were added to wrong config (global vs project) | Ensure `CLAUDE.md` is in repo root, not just `~/.config/opencode/AGENTS.md`                                              |
| `codeindex_code_search` returns empty        | DB stale or file not indexed                                | Run `codeindex_code_index incremental`; verify file is in `.codeindex.json` roots                                        |
| Reindex plugin not triggering                | Plugin not loaded                                           | Verify `opencode.json` `"plugin"` array includes `"./.opencode/plugins/codeindex-reindex.ts"`                            |
| Reindex plugin runs too often                | Debounce configured at 600 ms but sessions not isolated     | Check `debounceMap` uses `sessionID` key                                                                                 |

---

## 7. Sign-Off

| Person / Test                                      | Date       | Result | Notes                                |
| -------------------------------------------------- | ---------- | ------ | ------------------------------------ |
| Initial index: 445 files, 5532 symbols, 13291 refs | 2026-04-25 | PASS   | Full index in 3.2 s                  |
| Exact symbol: `makeCreateTaskTool`                 | 2026-04-25 | PASS   | 180 ms, exact match                  |
| Impact analysis: `makeCreateTaskTool`              | 2026-04-25 | PASS   | 190 ms, resolved import + call edges |
| Concept search: `web fetch`                        | 2026-04-25 | PASS   | Found camelCase symbols grep missed  |
| Incremental reindex: no changes                    | 2026-04-25 | PASS   | < 100 ms                             |
| MCP stdio init                                     | 2026-04-25 | PASS   | JSON-RPC response valid              |
| Agent instruction integration                      | —          | —      | Manual review via diagnostic prompts |
| Auto-reindex plugin trigger                        | —          | —      | `ps aux` observation after write     |

---

## 8. Maintenance

### Before Merging PRs That Touch `codeindex/`

1. Run `bun run scripts/codeindex-cli.ts index` (full rebuild if schema changed)
2. Run `bun run scripts/codeindex-cli.ts stats` — compare against baseline
3. Run smoke test (all test commands above)

### Weekly

1. `bun run scripts/codeindex-cli.ts reindex` — catch any missed file changes
2. `bun run scripts/codeindex-cli.ts stats` — watch for symbol drift
3. Review any `parse_failed` or `unsupported` file counts

---

## 9. One-Line Smoke Test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n' | bun run scripts/codeindex-cli.ts mcp
bun run scripts/codeindex-cli.ts stats
bun run scripts/codeindex-cli.ts symbol "makeCreateTaskTool"
bun run scripts/codeindex-cli.ts impact "src/tools/create-task#makeCreateTaskTool"
```

On macOS, stop the MCP command with `Ctrl-C` after the initialize response prints unless you already have GNU `gtimeout` installed.

If the wrapper cannot find the sibling checkout automatically, set `CODEINDEX_DIR` or clone the sibling repo at ../codeindex.

Expected: All sections print JSON without error.
