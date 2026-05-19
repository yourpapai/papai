# Papai Pi Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace papai's OpenCode-specific agent setup with a Pi-based setup that preserves MCP access, provider/model availability, `obra/superpowers` skill workflows, `pi-subagents`, TDD safety gates, codeindex reindexing, and a Pi-native TPS status display.

**Architecture:** Keep the migration incremental and reversible. Reuse the existing repo-local `.hooks/` checks, keep secrets in user-scope Pi files instead of project config, move shared project behavior into `.pi/` and `.mcp.json`, explicitly wire Pi to the already-installed `obra/superpowers` skills, and port the OpenCode plugins that enforce repository behavior. Replace the OpenCode TPS meter with a small Pi-native status extension that uses Pi's footer/status APIs instead of toast-heavy UI.

**Tech Stack:** Pi coding agent, TypeScript Pi extensions, `pi-mcp-adapter`, `pi-subagents`, `obra/superpowers` skills via `~/.agents/skills`, Bun, existing papai `.hooks/*`, `@upstash/context7-mcp`, `synthetic-search-mcp`, local `codeindex` MCP

---

## Validation Summary

- Validated: papai currently uses OpenCode project config in `opencode.json` with three local/plugin behaviors that matter to migration: `./.opencode/plugins/tdd-enforcement.ts`, `./.opencode/plugins/codeindex-reindex.ts`, and `./.opencode/plugins/opencode-tps-meter`.
- Validated: the TDD and safety logic already lives in shared repo files under `.hooks/`; both the OpenCode plugin and Claude hooks are thin wrappers around `enforce-tdd.mjs`, `enforce-write-policy.mjs`, `track-test-write.mjs`, `verify-test-import.mjs`, `check-full.mjs`, and the git safety checks.
- Validated: papai does not currently have a `.pi/` project directory or `.mcp.json`, so the Pi migration can be introduced cleanly without colliding with existing project-local Pi config.
- Validated: papai already has strong root instructions in `CLAUDE.md`, plus `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`. Pi natively loads `AGENTS.md` and `CLAUDE.md`, but it does not natively auto-apply GitHub Copilot instruction files, so migration must either compensate in `CLAUDE.md` or add a custom extension. This plan chooses the smaller first step: strengthen `CLAUDE.md` and defer any instruction-loader extension.
- Validated: Pi already exists on this machine and already uses a global custom provider extension at `~/.pi/agent/extensions/drowbridge/index.ts`, with `~/.pi/agent/settings.json` defaulting to provider `drowbridge` and model `gemma-4-26b`.
- Validated: OpenCode credentials currently live in `~/.local/share/opencode/auth.json`, while Pi stores API keys and OAuth tokens in `~/.pi/agent/auth.json` and resolves additional custom providers through `~/.pi/agent/models.json` or provider extensions.
- Validated: Pi does not ship built-in MCP support; the current maintained path is `pi-mcp-adapter`, which reads `.mcp.json` and `~/.config/mcp/mcp.json`, supports lazy connections, and can promote MCP tools to direct Pi tools via `directTools`.
- Validated: `pi-subagents` is current and maintained, and Pi already discovers skills from `~/.agents/skills/`. On this machine, that directory already contains the core `obra/superpowers` skills used in the current workflow, including `using-superpowers`, `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, and `subagent-driven-development`.
- Validated: upstream `obra/superpowers` Pi support is still experimental and not merged upstream, but that does not block papai because Pi can already consume the installed superpowers skills directly from `~/.agents/skills/`. For papai, preserve those skills explicitly in Pi settings and instructions instead of waiting for upstream Pi support to finish.
- Validated: `roach-pi` explicitly conflicts with superpowers skill names, so it is incompatible with preserving the existing `obra/superpowers` workflow in this repo.
- Validated: Pi exposes clean TUI extension APIs for footer/status rendering, including `ctx.ui.setStatus`, `ctx.ui.setWidget`, and `ctx.ui.setFooter`, plus streaming hooks such as `message_update`. That is sufficient to implement a Pi-native TPS display without depending on OpenCode-specific toast APIs.
- Decision: port the useful parts of `opencode-tps-meter` into a dedicated Pi TPS extension in this migration, but keep it small. Reuse the tracker/tokenizer/config concepts and Pi's status/footer APIs; do not port the old OpenCode toast/publish client abstraction or full multi-surface compatibility layer.
- Decision: do not use remote Context7 MCP config that depends on undocumented adapter header behavior. Use the supported local stdio server `@upstash/context7-mcp` with `CONTEXT7_API_KEY` in the environment.

## File Structure

| Path                                         | Responsibility                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `.pi/settings.json`                          | Project-local Pi package configuration so papai auto-loads `pi-mcp-adapter`, `pi-subagents`, and explicit skill paths when needed |
| `.mcp.json`                                  | Shared project MCP configuration for `context7`, `synthetic`, and `codeindex`                                                     |
| `.pi/extensions/tdd-enforcement/index.ts`    | Pi extension that reuses existing `.hooks/` checks for TDD and destructive-git blocking                                           |
| `.pi/extensions/codeindex-reindex/index.ts`  | Pi extension that triggers debounced `codeindex` reindex after implementation edits                                               |
| `.pi/extensions/tps-meter/index.ts`          | Pi-native TPS meter extension that shows live throughput in the footer/status bar                                                 |
| `.pi/extensions/tps-meter/tracker.ts`        | Rolling-window TPS tracker reused or adapted from the OpenCode TPS meter implementation                                           |
| `.pi/extensions/tps-meter/token-counter.ts`  | Heuristic token counting for assistant text and reasoning deltas                                                                  |
| `.pi/extensions/tps-meter/config.ts`         | Pi TPS meter config loading from `.pi/tps-meter.json`, `~/.pi/agent/tps-meter.json`, and `TPS_METER_*` env vars                   |
| `.pi/tps-meter.json`                         | Project-local shared configuration for the Pi TPS extension                                                                       |
| `.gitignore`                                 | Ignore project-local Pi install state while keeping shared `.pi` config committed                                                 |
| `CLAUDE.md`                                  | Strengthen path-scoped instruction guidance and tell Pi to preserve the superpowers workflow                                      |
| `docs/guides/pi-agent.md`                    | Repo-local operator guide mapping OpenCode habits to Pi commands and documenting the papai-specific setup                         |
| `~/.pi/agent/auth.json`                      | User-scope API keys and OAuth tokens for Pi providers                                                                             |
| `~/.pi/agent/AGENTS.md`                      | Global Pi instruction file that explicitly loads `using-superpowers` at session start                                             |
| `~/.pi/agent/extensions/drowbridge/index.ts` | Existing global provider extension that should stop embedding a literal API key                                                   |
| `~/.pi/agent/models.json`                    | Optional user-scope custom provider definitions for parity with OpenCode's `macbook` provider                                     |

---

### Task 1: Add The Project Pi Scaffold And Preserve Superpowers Skills

**Files:**

- Create: `.pi/settings.json`
- Modify: `.gitignore`
- Modify: `~/.pi/agent/settings.json`
- Create: `~/.pi/agent/AGENTS.md`
- Test: `pi list`

- [ ] **Step 1: Create the shared project Pi settings file**

```json
{
  "packages": ["npm:pi-mcp-adapter", "npm:pi-subagents"],
  "skills": ["~/.agents/skills"],
  "enableSkillCommands": true
}
```

- [ ] **Step 2: Ignore only project-local Pi install state, not shared config**

```gitignore
# Pi project-local package installs and overrides
.pi/git/
.pi/npm/
.pi/mcp.json
```

- [ ] **Step 3: Install the project-local Pi packages**

Run:

```bash
pi install -l npm:pi-mcp-adapter
pi install -l npm:pi-subagents
```

Expected: `.pi/settings.json` contains both package entries plus the shared superpowers skill path, and project-local install state appears under `.pi/npm/` or `.pi/git/`.

- [ ] **Step 4: Make Pi's global settings explicitly include the shared superpowers skills path**

```json
{
  "defaultProvider": "drowbridge",
  "defaultModel": "gemma-4-26b",
  "skills": ["~/.agents/skills"],
  "enableSkillCommands": true
}
```

- [ ] **Step 5: Add a global Pi instruction to start with `using-superpowers`**

```md
At the start of every conversation, load and follow the `using-superpowers` skill before taking action.

If another `obra/superpowers` skill applies, load it explicitly before responding, editing files, or running commands.

Do not rely on memory of skill contents. Load the current skill each time.
```

- [ ] **Step 6: Verify package and skill discovery**

Run:

```bash
pi list
```

Then inside Pi:

```text
/skill:writing-plans
/skill:test-driven-development
```

Expected: the project lists `pi-mcp-adapter` and `pi-subagents` as installed resources, and Pi can load the installed superpowers skills directly.

---

### Task 2: Move Shared MCP Configuration Into `.mcp.json`

**Files:**

- Create: `.mcp.json`
- Test: start Pi in the repo and use `/mcp reconnect context7`, `/mcp reconnect synthetic`, `/mcp reconnect codeindex`

- [ ] **Step 1: Create the shared MCP config with direct-tool exposure**

```json
{
  "settings": {
    "directTools": false,
    "idleTimeout": 10
  },
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"],
      "env": {
        "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"
      },
      "lifecycle": "lazy",
      "directTools": true
    },
    "synthetic": {
      "command": "bunx",
      "args": ["-y", "synthetic-search-mcp"],
      "env": {
        "SYNTHETIC_API_KEY": "${SYNTHETIC_API_KEY}"
      },
      "lifecycle": "lazy",
      "directTools": true
    },
    "codeindex": {
      "command": "bun",
      "args": ["run", "codeindex/src/cli.ts", "mcp"],
      "cwd": ".",
      "lifecycle": "lazy",
      "directTools": true
    }
  }
}
```

- [ ] **Step 2: Export the MCP credentials from the user shell or secret manager**

```bash
export CONTEXT7_API_KEY='ctx7sk-...'
export SYNTHETIC_API_KEY='syn_...'
```

Expected: no API keys are committed to `.mcp.json`.

- [ ] **Step 3: Reconnect and verify all three MCP servers**

Run inside Pi:

```text
/mcp reconnect context7
/mcp reconnect synthetic
/mcp reconnect codeindex
```

Expected: all three servers report connected or ready-to-use status with no authentication errors.

- [ ] **Step 4: Verify that direct MCP tools are actually callable**

Run inside Pi:

```text
Use code_search to find wrapToolExecution.
Use context7 to look up Bun test docs.
Use synthetic search to find recent pi-subagents documentation.
```

Expected: the agent calls direct MCP tools instead of falling back to a generic proxy-only flow.

---

### Task 3: Migrate User-Scope Providers And Credentials

**Files:**

- Modify: `~/.pi/agent/auth.json`
- Modify: `~/.pi/agent/extensions/drowbridge/index.ts`
- Create: `~/.pi/agent/models.json`
- Test: `pi --list-models | rg 'drowbridge|macbook|openrouter|deepseek'`

- [ ] **Step 1: Create Pi auth entries for API-key providers you actually use**

```json
{
  "openrouter": { "type": "api_key", "key": "OPENROUTER_API_KEY" },
  "google": { "type": "api_key", "key": "GEMINI_API_KEY" },
  "deepseek": { "type": "api_key", "key": "DEEPSEEK_API_KEY" },
  "opencode": { "type": "api_key", "key": "OPENCODE_API_KEY" }
}
```

Expected: `~/.pi/agent/auth.json` no longer stays empty, and Pi can resolve API-key providers without reading OpenCode files.

- [ ] **Step 2: Re-authenticate subscription providers natively in Pi instead of copying raw OAuth tokens**

Run inside Pi:

```text
/login
```

Choose `GitHub Copilot` if you want the same subscription-backed access Pi supports. Do not manually copy `github-copilot` OAuth tokens from `~/.local/share/opencode/auth.json` into Pi.

- [ ] **Step 3: Remove the hardcoded drowbridge API key from the global Pi provider extension**

```ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

const BASE_URL = 'https://ai.drowbridge.uk/v1'
const API_KEY = process.env.DROWBRIDGE_API_KEY

if (!API_KEY) {
  throw new Error('DROWBRIDGE_API_KEY is not set')
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const response = await fetch(`${BASE_URL}/models`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  })

  const payload = (await response.json()) as {
    data: Array<{
      id: string
      name?: string
      context_window?: number
      max_tokens?: number
      supports_vision?: boolean
      supports_reasoning?: boolean
    }>
  }

  pi.registerProvider('drowbridge', {
    baseUrl: BASE_URL,
    apiKey: 'DROWBRIDGE_API_KEY',
    api: 'openai-completions',
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: model.supports_reasoning ?? false,
      input: (model.supports_vision ? ['text', 'image'] : ['text']) as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window ?? 128000,
      maxTokens: model.max_tokens ?? 4096,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: 'max_tokens' as const,
      },
    })),
  })
}
```

- [ ] **Step 4: Add a `models.json` entry for the local `macbook` provider if you still need parity with OpenCode**

```json
{
  "providers": {
    "macbook": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "api": "openai-completions",
      "apiKey": "LOCAL_MACBOOK_API_KEY",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "Gemma-4-26B-A4B",
          "name": "Gemma 4 26B A4B",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "Qwen3.6-35B-A3B",
          "name": "Qwen 3.6 35B A3B",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

- [ ] **Step 5: Verify provider parity from Pi itself**

Run:

```bash
pi --list-models | rg 'drowbridge|macbook|openrouter|deepseek'
```

Expected: the custom providers and API-key providers appear in Pi's model registry.

---

### Task 4: Port The Repo-Enforced OpenCode Plugins To Pi Extensions

**Files:**

- Create: `.pi/extensions/tdd-enforcement/index.ts`
- Create: `.pi/extensions/codeindex-reindex/index.ts`
- Test: start Pi and trigger both a blocked implementation edit and a codeindex reindex path

- [ ] **Step 1: Port the destructive-git and TDD preflight checks to a Pi `tool_call` extension**

```ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { isToolCallEventType } from '@mariozechner/pi-coding-agent'

import { blockGitCheckoutDiscard } from '../../../.hooks/git/checks/block-git-checkout-discard.mjs'
import { blockGitStash } from '../../../.hooks/git/checks/block-git-stash.mjs'
import { enforceTdd } from '../../../.hooks/tdd/checks/enforce-tdd.mjs'
import { enforceWritePolicy } from '../../../.hooks/tdd/checks/enforce-write-policy.mjs'
import { getSessionsDir } from '../../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../../.hooks/tdd/session-state.mjs'

const getFilePath = (toolName: string, input: Record<string, unknown>): string | null => {
  if (toolName === 'write' && typeof input.path === 'string') return input.path
  if (toolName === 'edit' && typeof input.path === 'string') return input.path
  return null
}

export default function (pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    if (isToolCallEventType('bash', event)) {
      const bashCtx = { tool_name: 'bash', tool_input: { command: event.input.command } }
      const gitStash = blockGitStash(bashCtx)
      if (gitStash) return { block: true, reason: gitStash.reason }
      const gitCheckout = blockGitCheckoutDiscard(bashCtx)
      if (gitCheckout) return { block: true, reason: gitCheckout.reason }
      return
    }

    const filePath = getFilePath(event.toolName, event.input as Record<string, unknown>)
    if (!filePath) return

    const hookCtx = {
      tool_name: event.toolName,
      tool_input: { ...(event.input as Record<string, unknown>), file_path: filePath },
      session_id: ctx.sessionManager.getSessionId(),
      cwd: ctx.cwd,
    }

    const writePolicy = enforceWritePolicy(hookCtx)
    if (writePolicy) return { block: true, reason: writePolicy.reason }

    const tddGate = enforceTdd(hookCtx)
    if (tddGate) return { block: true, reason: tddGate.reason }

    const state = new SessionState(ctx.sessionManager.getSessionId(), getSessionsDir(ctx.cwd))
    state.setNeedsRecheck(true)
  })
}
```

- [ ] **Step 2: Port post-edit tracking and post-turn full-check reporting**

```ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

import { checkFull } from '../../../.hooks/tdd/checks/check-full.mjs'
import { trackTestWrite } from '../../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyTestImport } from '../../../.hooks/tdd/checks/verify-test-import.mjs'
import { getSessionsDir } from '../../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../../.hooks/tdd/session-state.mjs'

export default function (pi: ExtensionAPI): void {
  pi.on('tool_execution_end', async (event, ctx) => {
    if (!['write', 'edit'].includes(event.toolName)) return
    if (typeof event.args.path !== 'string') return

    const hookCtx = {
      tool_input: { file_path: event.args.path },
      session_id: ctx.sessionManager.getSessionId(),
      cwd: ctx.cwd,
    }

    trackTestWrite(hookCtx)
    const importResult = verifyTestImport(hookCtx)
    if (importResult) {
      ctx.ui.notify(importResult.reason, 'error')
    }
  })

  pi.on('agent_end', async (_event, ctx) => {
    const state = new SessionState(ctx.sessionManager.getSessionId(), getSessionsDir(ctx.cwd))
    if (!state.getNeedsRecheck()) {
      state.setNeedsRecheck(true)
      return
    }

    const result = checkFull({ cwd: ctx.cwd, session_id: ctx.sessionManager.getSessionId() })
    if (result) {
      state.setNeedsRecheck(false)
      ctx.ui.notify(result.reason, 'error')
      return
    }

    state.setNeedsRecheck(true)
  })
}
```

Notes: Pi's public extension docs expose blocking `tool_call`, but not a blocking end-of-agent stop hook. Preserve the strong pre-edit gate exactly; preserve the post-edit/full-check behavior as an immediately visible failure notification at `agent_end` rather than pretending Pi can enforce a true stop-block there.

- [ ] **Step 3: Port the debounced codeindex reindex behavior**

```ts
import { spawn } from 'node:child_process'
import path from 'node:path'

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

const INDEXED_ROOTS = ['src', 'client']
const INDEXED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

const shouldReindex = (filePath: string): boolean => {
  const ext = path.extname(filePath)
  if (!INDEXED_EXTS.has(ext)) return false
  if (!INDEXED_ROOTS.some((root) => filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`))) {
    return false
  }
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return false
  return true
}

export default function (pi: ExtensionAPI): void {
  pi.on('tool_execution_end', async (event, ctx) => {
    if (!['write', 'edit'].includes(event.toolName)) return
    if (typeof event.args.path !== 'string') return
    if (!shouldReindex(event.args.path)) return

    const sessionId = ctx.sessionManager.getSessionId()
    const existing = debounceMap.get(sessionId)
    if (existing) clearTimeout(existing)

    const timeout = setTimeout(() => {
      debounceMap.delete(sessionId)
      const child = spawn('bun', ['run', 'codeindex/src/cli.ts', 'reindex'], {
        cwd: ctx.cwd,
        stdio: 'ignore',
        detached: true,
      })
      child.unref()
    }, 600)

    debounceMap.set(sessionId, timeout)
  })
}
```

- [ ] **Step 4: Verify the migrated Pi extensions**

Run inside Pi:

```text
Try `git stash`.
Try editing `src/...` before writing the matching test.
Edit a `src/...` file that should trigger codeindex reindex.
```

Expected: `git stash` is refused, implementation-first writes are refused, and codeindex reindex runs after qualifying implementation edits.

---

### Task 5: Port The OpenCode TPS Meter To A Pi-Native Footer Extension

**Files:**

- Create: `.pi/extensions/tps-meter/index.ts`
- Create: `.pi/extensions/tps-meter/tracker.ts`
- Create: `.pi/extensions/tps-meter/token-counter.ts`
- Create: `.pi/extensions/tps-meter/config.ts`
- Create: `.pi/extensions/tps-meter/types.ts`
- Create: `.pi/tps-meter.json`
- Test: start Pi, stream a response, and confirm live TPS appears in the footer/status area

- [ ] **Step 1: Keep the extension design intentionally smaller than the OpenCode plugin**

Use this design:

```text
Pi TPS meter design
  input source: `message_update` events
    - count only `text_delta` and `thinking_delta`
    - ignore tool-call argument deltas and user/system messages
  token counting: fast heuristic counter (`chars/4` default, `chars/3` optional for code-heavy models)
  tracking: one rolling tracker for the active assistant stream
  UI: primary output via `ctx.ui.setStatus("tps-meter", ...)`
  optional richer mode: `ctx.ui.setWidget("tps-meter", ...)` for multi-line display
  cleanup: clear status on `message_end` / `agent_end`, optionally keep last-session summary
```

Expected: the extension is footer-first and does not attempt to replicate OpenCode's toast-oriented UI stack.

- [ ] **Step 2: Reuse the tracker and token counter logic with minimal renaming**

```ts
// .pi/extensions/tps-meter/token-counter.ts
export type TokenizerAlgorithm = 'heuristic' | 'word' | 'code'

const countByChars = (text: string, divisor: number): number =>
  text.length === 0 ? 0 : Math.ceil(text.length / divisor)

const countByWords = (text: string, divisor: number): number => {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : Math.ceil(trimmed.split(/\s+/).length / divisor)
}

export const createTokenizer = (algorithm: TokenizerAlgorithm = 'heuristic') => ({
  count: (text: string): number =>
    algorithm === 'word'
      ? countByWords(text, 0.75)
      : algorithm === 'code'
        ? countByChars(text, 3)
        : countByChars(text, 4),
})
```

```ts
// .pi/extensions/tps-meter/tracker.ts
export interface Tracker {
  readonly recordTokens: (count: number, timestamp?: number) => void
  readonly getInstantTps: () => number
  readonly getAverageTps: () => number
  readonly getTotalTokens: () => number
  readonly getElapsedMs: () => number
  readonly reset: () => void
}
```

Expected: the Pi extension reuses the proven throughput math from `opencode-tps-meter` instead of inventing a second TPS algorithm.

- [ ] **Step 3: Add Pi-native config loading and a shared project config file**

```json
{
  "enabled": true,
  "rollingWindowMs": 1000,
  "showAverage": true,
  "showInstant": true,
  "showTotalTokens": true,
  "showElapsed": false,
  "format": "compact",
  "minVisibleTps": 0,
  "fallbackTokenHeuristic": "chars_div_4",
  "showLastSessionInStatus": true,
  "uiMode": "status"
}
```

And load config in this order:

```text
1. built-in defaults
2. ~/.pi/agent/tps-meter.json
3. .pi/tps-meter.json
4. TPS_METER_* environment variables
```

Expected: TPS config is shared in-project, overridable per-user, and does not depend on the old `.opencode/tps-meter.json` path.

- [ ] **Step 4: Implement the Pi extension using streaming events and footer/status APIs**

```ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

import { loadConfig } from './config.js'
import { createTokenizer } from './token-counter.js'
import { createTracker } from './tracker.js'

export default function (pi: ExtensionAPI): void {
  const config = loadConfig()
  if (!config.enabled) return

  const tokenizer = createTokenizer(
    config.fallbackTokenHeuristic === 'chars_div_3'
      ? 'code'
      : config.fallbackTokenHeuristic === 'words_div_0_75'
        ? 'word'
        : 'heuristic',
  )

  const tracker = createTracker({ rollingWindowMs: config.rollingWindowMs })

  const renderStatus = (): string => {
    const parts = [] as string[]
    if (config.showInstant) parts.push(`TPS ${tracker.getInstantTps().toFixed(1)}`)
    if (config.showAverage) parts.push(`avg ${tracker.getAverageTps().toFixed(1)}`)
    if (config.showTotalTokens) parts.push(`tok ${tracker.getTotalTokens()}`)
    if (config.showElapsed) parts.push(`${Math.floor(tracker.getElapsedMs() / 1000)}s`)
    return parts.join(' | ')
  }

  const refresh = (ctx: Parameters<Parameters<ExtensionAPI['on']>[1]>[1]): void => {
    const text = renderStatus()
    if (text.length === 0) return
    ctx.ui.setStatus('tps-meter', text)
  }

  pi.on('message_update', async (event, ctx) => {
    const deltaEvent = event.assistantMessageEvent
    if (deltaEvent.type !== 'text_delta' && deltaEvent.type !== 'thinking_delta') return

    const delta = typeof deltaEvent.delta === 'string' ? deltaEvent.delta : ''
    const count = tokenizer.count(delta)
    if (count <= 0) return

    tracker.recordTokens(count)
    if (tracker.getInstantTps() < config.minVisibleTps) return
    refresh(ctx)
  })

  pi.on('message_end', async (_event, ctx) => {
    if (config.showLastSessionInStatus) {
      refresh(ctx)
      return
    }
    ctx.ui.setStatus('tps-meter', undefined)
    tracker.reset()
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (!config.showLastSessionInStatus) {
      ctx.ui.setStatus('tps-meter', undefined)
      tracker.reset()
      return
    }
    refresh(ctx)
  })
}
```

Expected: assistant output updates the footer/status live during streaming, and the extension stays Pi-native by using `message_update` plus `ctx.ui.setStatus`.

- [ ] **Step 5: Add an optional richer widget mode without replacing the whole footer**

```ts
const refreshWidget = (ctx: Parameters<Parameters<ExtensionAPI['on']>[1]>[1]): void => {
  ctx.ui.setWidget('tps-meter', [
    `TPS ${tracker.getInstantTps().toFixed(1)} | avg ${tracker.getAverageTps().toFixed(1)}`,
    `tokens ${tracker.getTotalTokens()} | elapsed ${Math.floor(tracker.getElapsedMs() / 1000)}s`,
  ])
}
```

Use this only when `uiMode === 'widget'`. Do not replace the full footer in phase 1 unless the status slot proves too cramped in real usage.

- [ ] **Step 6: Verify the Pi TPS extension manually**

Run:

```bash
pi
```

Then ask for a response long enough to stream for a few seconds.

Expected: a live TPS status appears in the footer/status area, updates during assistant streaming, and either clears or preserves the last-session summary according to config.

---

### Task 6: Close The Instruction And Workflow Gap Left By OpenCode Plugins

**Files:**

- Modify: `CLAUDE.md`
- Create: `docs/guides/pi-agent.md`
- Test: start Pi and confirm the instructions are visible in the startup context list

- [ ] **Step 1: Strengthen `CLAUDE.md` so Pi users still consult path-scoped GitHub instructions**

```md
## Path-Scoped Instruction Loading

When working in `src/**`, `src/providers/**`, `src/tools/**`, `src/chat/**`, `src/commands/**`, `tests/**`, or `tests/e2e/**`, read the matching `.github/instructions/*.instructions.md` file before editing code in that scope.

The `.github/copilot-instructions.md` file is part of the repository's instruction set even when the current agent does not auto-load GitHub Copilot instruction files natively.
```

- [ ] **Step 2: Add an operator guide that maps OpenCode habits to Pi commands**

```md
# Papai Pi Guide

## Session workflow

- Continue last session: `pi -c`
- Browse sessions: `pi -r` or `/resume`
- Tree navigation in-place: `/tree`
- Fork to a new session: `/fork`
- Clone current active branch: `/clone`

## MCP workflow

- Shared config lives in `.mcp.json`
- Use `/mcp` to inspect and reconnect servers
- `context7`, `synthetic`, and `codeindex` are exposed as direct tools via `pi-mcp-adapter`

## Superpowers workflow

- Pi loads `obra/superpowers` skills from `~/.agents/skills`
- `~/.pi/agent/AGENTS.md` should tell Pi to begin with `using-superpowers`
- Use `/skill:name` for deterministic loading when needed

## Subagents

- `pi-subagents` is the supported multi-agent layer
- Do not install `roach-pi` in this repo; it conflicts with superpowers skill names

## TPS meter

- Use the Pi-native TPS extension under `.pi/extensions/tps-meter`
- Prefer footer/status rendering over toast-heavy UI
- Keep the first version compact and assistant-stream focused

## Non-goals for phase 1

- No `oh-my-pi` fork adoption
- No dependency on experimental upstream `obra/superpowers` Pi support package integration
```

- [ ] **Step 3: Verify the instruction and workflow surface in Pi**

Run:

```bash
pi
```

Expected: the startup header shows the root `CLAUDE.md`, project packages, and repo-local extensions, and the guide gives users a stable command mapping away from OpenCode.

---

### Task 7: Run End-To-End Papai Verification In Pi

**Files:**

- Test only: repo root plus user-scope Pi config files

- [ ] **Step 1: Verify model/provider visibility**

Run:

```bash
pi --list-models | rg 'drowbridge|macbook|openrouter|deepseek'
```

Expected: the intended user-scope providers are listed.

- [ ] **Step 2: Verify MCP tools from inside the repo**

Run inside Pi:

```text
Use code_search to find buildTools.
Use context7 to look up `Bun.spawn` docs.
Use synthetic search to find recent `pi-mcp-adapter` documentation.
```

Expected: the agent successfully calls all three external tool surfaces.

- [ ] **Step 3: Verify TDD enforcement still protects the repository**

Run inside Pi:

```text
Edit an implementation file in `src/` before writing the matching test.
```

Expected: the extension refuses the write with the same repo-specific guidance the OpenCode/Claude hooks already use.

- [ ] **Step 4: Verify the git safety gate**

Run inside Pi:

```text
Run `git stash`.
Run `git checkout -- src/some-file.ts`.
```

Expected: both commands are refused by the migrated safety extension.

- [ ] **Step 5: Verify codeindex reindex after a qualifying implementation edit**

Run inside Pi:

```text
Edit a non-test file under `src/` or `client/`.
```

Then verify from the shell:

```bash
bun run codeindex/src/cli.ts reindex
```

Expected: the debounced auto-reindex path works, and the manual command still succeeds as a sanity check.

- [ ] **Step 6: Verify session workflow parity**

Run:

```bash
pi -c
pi -r
```

Then inside Pi:

```text
/tree
/fork
/clone
```

Expected: the team can continue, browse, branch in-place, fork to a new session, and clone the active branch without depending on OpenCode's session UI.

- [ ] **Step 7: Verify superpowers skill availability and subagent workflow**

Run inside Pi:

```text
/skill:writing-plans
/skill:verification-before-completion
Use a reviewer subagent to review the current diff.
```

Expected: Pi can load the installed `obra/superpowers` skills and delegate through `pi-subagents` in the same repo session.

- [ ] **Step 8: Verify the TPS footer/status behavior**

Run inside Pi:

```text
Generate a long streamed response and confirm the TPS meter updates live.
```

Expected: the Pi TPS extension shows live throughput in the footer/status area without relying on OpenCode toasts.

---

## Migration Notes

- `@ekroon/opencode-copilot-instructions` is intentionally not ported 1:1 in phase 1. Pi already loads `CLAUDE.md`, and papai's root `CLAUDE.md` can be tightened to explicitly require consulting `.github/copilot-instructions.md` and matching `.github/instructions/*.instructions.md` files. Build a custom Pi instruction-loader extension only if post-migration usage shows that this lighter approach is insufficient.
- `obra/superpowers` does not need to wait for upstream Pi support to finish. Pi already discovers skills from `~/.agents/skills`, so papai can preserve the existing workflow immediately by making that path explicit in Pi settings and AGENTS instructions.
- The Pi TPS extension should reuse the current tracker/token-counter ideas from `opencode-tps-meter`, but it should not inherit OpenCode's client-toast compatibility layer. Keep the design Pi-native and footer-first.
- Keep repo-shared MCP config in `.mcp.json`. Use `.pi/mcp.json` only for Pi-specific local overrides that should not be committed.
- Keep secrets out of repo files. Use environment variables, Pi auth storage, or shell-command key resolution in user-scope Pi files.

## Success Criteria

- Papai starts in Pi with working direct tools for `context7`, `synthetic`, and `codeindex`.
- Papai preserves the current `obra/superpowers` workflow in Pi through `~/.agents/skills` and explicit Pi instructions.
- `pi-subagents` remains available for multi-agent workflows that superpowers skills expect.
- The repo still blocks destructive `git stash` and `git checkout --` flows.
- The repo still enforces test-first edits for implementation files.
- `codeindex` still reindexes automatically after qualifying implementation edits.
- Pi shows live TPS stats in the footer/status area during assistant streaming.
- Users can reach their preferred providers and models from Pi without depending on OpenCode config or auth files.
- The day-to-day OpenCode workflow has a documented Pi equivalent for sessions, branching, MCP, superpowers skills, subagents, and TPS visibility.
