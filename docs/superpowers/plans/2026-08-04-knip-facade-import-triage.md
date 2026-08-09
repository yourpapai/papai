<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Knip Facade Import Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 34 of the 39 facade `ignoreIssues` entries in `knip.config.ts` with import-structure fixes (repoint production imports to facades, repoint test imports to concrete modules, prune dead re-export bindings) so knip 6.28+ passes on code structure alone.

**Architecture:** A disposable Bun codemod (`scripts/knip-facade-triage/triage.ts`, never committed) derives the triage from first principles (facade export bindings minus production via-facade consumers), classifies each of 162 in-scope bindings as A (repoint prod imports → facade), B (repoint test imports → concrete, prune binding), or C (prune dead binding), and applies the edits mechanically. Four commits: C pruning, B test repointing, A production repointing, knip.config cleanup.

**Tech Stack:** Bun (runtime + `bun:test`), TypeScript (strict, `.js` import specifiers), knip 6.29, oxlint, tsgo, oxfmt.

**Spec:** `docs/superpowers/specs/2026-08-04-knip-facade-import-triage-design.md`

## Cascade rule (all apply tasks)

Pruning (or repointing away) a facade's re-export can orphan an UPSTREAM re-export layer whose only consumer was that facade (observed in Task 2: `client/debug/dashboard-types.ts` was the sole consumer of 8 type re-exports in `client/shared/api-types.ts`). After each apply task's edits and BEFORE its verification gate, run `bun run knip`: any NEW unused re-export findings in files without an existing ignore entry are cascade prunings — apply the same class mechanics to them in the SAME commit (prune the binding, clean up unused imports), and record them in the task report. Re-run knip after each cascade pass until clean; cascades terminate because concrete source modules have other consumers. Never fix a cascade by adding an ignore entry.

## Global Constraints

- Runtime **Bun**; scripts run via `bun <file>`. Strict TypeScript; **`.js` extension in all import specifiers**.
- **Never edit frozen files** (0Q refactor qualification freeze, byte-for-byte): `tests/stories/**`, `scripts/story/**`, `scripts/coverage/**`, `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`, `bunfig.toml`.
- **No new tests and no production-logic changes**: this is a behavior-preserving refactor; the existing suites are the safety net. The only test edit allowed is the single contract-test trim in Task 3.
- **Never add lint-disable or type-ignore comments** — repo hook policy blocks them.
- Run `bunx oxfmt <edited files>` after mechanical edits, before lint.
- Pre-commit hooks automatically run lint / typecheck / format:check / license-headers on staged files; commit only with explicit `git add <paths>`.
- All commits land on branch `dependabot/bun/bun-dependencies-aec7b819e5` (current worktree).
- The codemod stays **uncommitted** for the whole plan and is deleted in Task 5. It must still be typecheck-clean (tsgo checks the whole tree).
- Error extraction convention: `error instanceof Error ? error.message : String(error)`.

## Anchor Data (classification ground truth — authoritative, from Task 1 codemod)

Derived by the knip-report-driven codemod against a live knip run with the pre-ignore config (totals **A=70, B=46, C=46**; invariants verified: 166 knip-flagged bindings in scope, exactly 4 frozen-kept bindings, A+B+C = 162). Tasks 2–4 consume `triage.json`; this table is the human-readable reference of the same data. Whole-facade exclusions (script skips): `src/providers/public-types.ts` (published surface), `src/coding-sessions/session-record.ts` (compat boundary). Frozen-kept (never pruned; facades keep ignore entries): `SessionRecord` in `src/coding-sessions/store.ts`, `pollAlertsOnce` in `src/deferred-prompts/poller.ts`, `recentLlm` + `pendingTraces` in `src/debug/state-collector.ts`.

| Facade | A (repoint prod → facade) | B (repoint tests → concrete; prune) | C (prune dead) |
| --- | --- | --- | --- |
| client/debug/dashboard-types.ts | AdminLlmSnapshot, BillingDetail, BillingRoleTotals, BillingSubject, BillingWindow, DeferredPrompt, IdentityMappingEntry, Memo, RecurringTask | AdminLlmKeyState, BillingRequestRow, Fact, Instruction, TokenInfo, ToolCall, Wizard | CacheEvent, GlobalStats, MessageCacheEvent, PollerEvent, SchedulerTickEvent, StateInitEvent, StateStatsEvent, StatsWindow, SubjectStats, UserIdEvent |
| plugins/task-provider-kaneo/provider.ts | KaneoConfig | — | — |
| plugins/task-provider-kaneo/provision.ts | — | — | ProvisionResult |
| plugins/task-provider-youtrack/task-helpers.ts | mapYouTrackDueDateValue | — | — |
| scripts/behavior-audit/consolidate-agent.ts | EntryPointHint | — | — |
| scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts | — | activeIndices, buildCondensedDistanceMatrix, condensedIndex, createActiveState, getDistance, isActive, setDistance | ActiveState, MutableDistanceMatrix |
| scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts | MutableDistanceMatrix | — | ActiveState |
| scripts/behavior-audit/consolidate-keywords.ts | emptyPhase1b | — | — |
| scripts/behavior-audit/extract.ts | BehaviorAuditProgressReporter | — | — |
| scripts/behavior-audit/incremental.ts | — | — | SelectIncrementalWorkInput |
| scripts/behavior-audit/progress.ts | invalidatePhase3ForReevaluation, loadProgress, resetPhase2AndPhase3, resetPhase3 | resetPhase1bAndBelow | — |
| scripts/behavior-audit/report-writer.ts | DomainSummary, FailedItem | — | — |
| src/attachments/index.ts | AttachmentRef, AttachmentSourceProvider, StagedFileDownloadFn, StoredAttachment, buildAttachmentManifest, getBlobStore, purgeExpiredStagedFiles, sanitizeForBracket, searchStagedFiles | InMemoryBlobStore, StageFileParams, StagedFileRef, StagedFileStatus, StagedResolutionError, buildBlobKey, createInMemoryBlobStoreForTesting, resetBlobStoreForTesting, saveAttachment, setBlobStoreForTesting | AttachmentStatus, BlobStore, SaveAttachmentInput, createS3BlobStore |
| src/bot.ts | getThreadScopedStorageContextId | — | — |
| src/chat/telegram/index.ts | — | extractReplyContext | — |
| src/chat/types.ts | — | AuthorizationDenyReason | ChatProviderConfigField |
| src/commands/context-collector.ts | resolveMaxTokens | — | EncodingName |
| src/debug/schemas.ts | — | — | NotificationSchema, ToolFailureSchema, TurnReplySchema, TurnSchema, TurnToolCallSchema |
| src/debug/state-collector.ts | resetTurnBuffers | LlmTrace, inFlightTurns, recentNotifications, recentToolFailures, recentTurns | — |
| src/group-settings/registry-helpers.ts | UpsertGroupAdminObservationInput, UpsertGroupUserObservationInput, UpsertKnownGroupContextInput | — | — |
| src/instances/encryption.ts | resolveInstanceConfigKey | resolveInstanceConfigKeyInfo | InstanceConfigKeyDeps, InstanceConfigKeyInfo, InstanceConfigKeyMode |
| src/llm-orchestrator-invoke.ts | — | handleToolCallFinishEvent, handleToolCallStart | ToolCallFinishEvent, ToolCallStartEvent |
| src/long-term-memory/store.ts | — | — | ListProvisionalFilter, rowToProfile |
| src/mcp-server/index.ts | mintPluginMcpToken | PLUGIN_MCP_TOKEN_TTL_SECONDS, verifyPluginMcpToken | PluginMcpTokenClaims |
| src/mcp/index.ts | McpEndpointConfig, McpPluginConfig, mcpPool | McpServerInfo, PluginMcpDescriptor, convertMcpToolsToToolSet | McpConnectionPool, McpServerStatus, PluginPoolAdapter |
| src/message-cache/index.ts | CachedMessage, MessageScope, SearchFilters, cacheMessage, getMessage, getMessageByContext, getMessageContext, searchMessages | — | MessageContextMode, MessageContextResult, ReplyChainResult, rowToCachedMessage |
| src/plugins/contributions.ts | namespacedToolName, sanitizePluginId | namespacedJobName | — |
| src/plugins/loader.ts | — | toPluginImportSpecifier | — |
| src/plugins/registry.ts | — | checkPluginCompatibility | — |
| src/plugins/types.ts | — | — | PluginScheduledJobRuntimeContext |
| src/providers/membership/index.ts | — | MemberOutcome, MembershipDeps | BackfillResult, SubscriberHandlers |
| src/recurrence.ts | — | parseRrule | ParseResult |
| src/recurring.ts | TriggerType, findTemplateByTaskId, isCompletionStatus, recordOccurrence | — | COMPLETION_STATUSES |
| src/tools/index.ts | ToolMode | — | — |
| src/utils/scheduler.ts | ErrorEvent, ErrorHandler, FatalError, FatalErrorEvent, FatalErrorHandler, RetryEvent, RetryHandler, RetryableError, SchedulerError, TaskAlreadyExistsError, TaskNotFoundError, TaskOptions, TickEvent, TickHandler | — | — |

<details>
<summary>Superseded preliminary table (A=58, B=65, C=39) — kept for audit trail</summary>

The first prototype classifier produced A=58/B=65/C=39 with known errors (e.g. `ChatProviderConfigField` as B, `saveAttachment` as A, `verifyPluginMcpToken` as A, `PluginScheduledJobRuntimeContext` as A). The Task 1 knip-report-driven codemod corrected these; the authoritative table above replaces it in full.

</details>


---

### Task 1: Triage codemod and classification dataset

**Files:**
- Create: `scripts/knip-facade-triage/triage.ts` (uncommitted tooling; deleted in Task 5)
- Create: `scripts/knip-facade-triage/triage.json` (generated output)

**Interfaces:**
- Consumes: the repo tree at commit `d599caa53` or later (the 40-facade report scope is hardcoded).
- Produces: `triage.json` consumed by Tasks 2–4. The authoritative member is `items`: a flat array of `{ facade, symbol, isType, source, cls: "A"|"B"|"C", prodConsumers: [{file, kind}], testConsumersViaFacade: [{file, kind}], manual: [{file, kind}] }` (`source` = concrete module path; `kind` = `named|namespace|dynamic`). The file also carries a top-level `manual` array (`{file, symbol, reason}` entries for consumers needing hand edits in Task 3 Step 3) and a `counts` summary.

- [ ] **Step 1: Create the codemod**

Create `scripts/knip-facade-triage/triage.ts` with this exact content:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Disposable codemod for the knip facade import triage.
// Spec: docs/superpowers/specs/2026-08-04-knip-facade-import-triage-design.md
// Usage: bun scripts/knip-facade-triage/triage.ts <analyze|apply-c|apply-b|apply-a> [--dry-run]
// Delete this directory when the refactor lands (plan Task 5).

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TRIAGE_JSON = 'scripts/knip-facade-triage/triage.json'
const DRY_RUN = process.argv.includes('--dry-run')
const MODE = process.argv[2]

// ---- Scope ---------------------------------------------------------------

const FACADES = [
  'client/debug/dashboard-types.ts',
  'plugins/task-provider-kaneo/provider.ts',
  'plugins/task-provider-kaneo/provision.ts',
  'plugins/task-provider-kaneo/search-tasks.ts',
  'plugins/task-provider-youtrack/task-helpers.ts',
  'scripts/behavior-audit/consolidate-agent.ts',
  'scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts',
  'scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts',
  'scripts/behavior-audit/consolidate-keywords.ts',
  'scripts/behavior-audit/extract.ts',
  'scripts/behavior-audit/incremental.ts',
  'scripts/behavior-audit/progress.ts',
  'scripts/behavior-audit/report-writer.ts',
  'src/attachments/index.ts',
  'src/bot.ts',
  'src/chat/telegram/index.ts',
  'src/chat/types.ts',
  'src/coding-sessions/session-record.ts',
  'src/coding-sessions/store.ts',
  'src/commands/context-collector.ts',
  'src/debug/schemas.ts',
  'src/debug/state-collector.ts',
  'src/deferred-prompts/poller.ts',
  'src/group-settings/registry-helpers.ts',
  'src/instances/encryption.ts',
  'src/llm-orchestrator-invoke.ts',
  'src/long-term-memory/store.ts',
  'src/mcp-server/index.ts',
  'src/mcp/index.ts',
  'src/message-cache/index.ts',
  'src/plugins/contributions.ts',
  'src/plugins/loader.ts',
  'src/plugins/registry.ts',
  'src/plugins/types.ts',
  'src/providers/membership/index.ts',
  'src/providers/public-types.ts',
  'src/recurrence.ts',
  'src/recurring.ts',
  'src/tools/index.ts',
  'src/utils/scheduler.ts',
] as const

const EXCLUDE_FACADES = new Set([
  'src/providers/public-types.ts', // published papai/plugin-types surface
  'src/coding-sessions/session-record.ts', // declared compat boundary
])

const FROZEN_FILES = new Set([
  'tests/setup.ts',
  'tests/mock-reset.ts',
  'tests/utils/test-helpers.ts',
  'tests/utils/logger-mock.ts',
])
const FROZEN_PREFIXES = ['tests/stories/', 'scripts/story/', 'scripts/coverage/']

const CONTRACT_TESTS = new Set([
  'tests/attachments/index.test.ts',
  'tests/mcp/index.test.ts',
  'tests/mcp-server/index.test.ts',
  'tests/message-cache/index.test.ts',
])

const PACKAGE_SPEC_ALIASES: Record<string, string> = {
  papai: 'src/index.ts',
  'papai/plugin-types': 'src/providers/public-types.ts',
}

// ---- Parsing ---------------------------------------------------------------

interface NamedBinding {
  imported: string
  local: string
  isType: boolean
}

interface ExportStatement {
  start: number
  end: number
  text: string
  from: string | null
  bindings: NamedBinding[]
}

interface ImportStatement {
  start: number
  end: number
  text: string
  spec: string
  resolved: string | null
  allType: boolean
  isRuntime: boolean
  defaultName: string | null
  namespace: string | null
  named: NamedBinding[]
}

function parseNamedList(body: string, clauseIsType = false): NamedBinding[] {
  const out: NamedBinding[] = []
  for (const part of body.split(',')) {
    const p = part.trim()
    if (p === '') continue
    const isType = clauseIsType || p.startsWith('type ')
    const stripped = p.startsWith('type ') ? p.slice(5).trim() : p
    const seg = stripped.split(/\s+as\s+/)
    const imported = (seg[0] ?? '').trim()
    const local = (seg[seg.length - 1] ?? '').trim()
    if (imported !== '') out.push({ imported, local, isType })
  }
  return out
}

function parseExportStatements(text: string): ExportStatement[] {
  const re = /export\s+(?:type\s+)?\{[^{}]*\}(?:\s*from\s*['"][^'"]+['"])?/gs
  const out: ExportStatement[] = []
  for (const m of text.matchAll(re)) {
    const stmt = m[0]
    const fromM = /from\s*['"]([^'"]+)['"]/.exec(stmt)
    const bodyM = /\{([^{}]*)\}/s.exec(stmt)
    // Whole-clause `export type { ... }` marks every binding a type (required
    // for correct isType metadata under verbatimModuleSyntax).
    const clauseIsType = /^export\s+type\s+\{/.test(stmt)
    out.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + stmt.length,
      text: stmt,
      from: fromM?.[1] ?? null,
      bindings: parseNamedList(bodyM?.[1] ?? '', clauseIsType),
    })
  }
  return out
}

function resolveSpec(importer: string, spec: string): string | null {
  if (spec in PACKAGE_SPEC_ALIASES) return PACKAGE_SPEC_ALIASES[spec] ?? null
  if (!spec.startsWith('.')) return null
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec))
  if (p.endsWith('.js')) return p.slice(0, -3) + '.ts'
  return p
}

function parseImportStatements(file: string, text: string): ImportStatement[] {
  const re = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/gs
  const out: ImportStatement[] = []
  for (const m of text.matchAll(re)) {
    const clause = (m[1] ?? '').trim()
    const spec = m[2] ?? ''
    const allType = clause.startsWith('type ')
    const nsM = /\*\s+as\s+(\w+)/.exec(clause)
    const bodyM = /\{([^{}]*)\}/s.exec(clause)
    const named = parseNamedList(bodyM?.[1] ?? '', allType)
    const defM = /^(\w+)\s*,/.exec(clause) ?? (/^\w+$/.test(clause) && bodyM === null && nsM === null ? /(\w+)/.exec(clause) : null)
    const hasDefault = defM !== null
    const valueNamed = named.some((b) => !b.isType)
    const isRuntime = !allType && (hasDefault || nsM !== null || valueNamed || named.length === 0)
    out.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      text: m[0],
      spec,
      resolved: resolveSpec(file, spec),
      allType,
      isRuntime,
      defaultName: defM?.[1] ?? null,
      namespace: nsM?.[1] ?? null,
      named,
    })
  }
  return out
}

function listTsFiles(): string[] {
  const out = execFileSync('rg', ['--files', '-t', 'ts', '-g', '!node_modules'], { cwd: ROOT })
    .toString()
    .split('\n')
  return out.filter((f) => f !== '')
}

function isFrozen(file: string): boolean {
  return FROZEN_FILES.has(file) || FROZEN_PREFIXES.some((p) => file.startsWith(p))
}

function isTestFile(file: string): boolean {
  return file.startsWith('tests/') || file.startsWith('review-loop/')
}

// ---- Analysis --------------------------------------------------------------

interface Consumer {
  file: string
  kind: 'named' | 'namespace' | 'dynamic'
}

interface FacadeBinding {
  symbol: string
  isType: boolean
  source: string | null // concrete module the facade re-exports from
}

function facadeBindings(facade: string): FacadeBinding[] {
  const text = readFileSync(path.join(ROOT, facade), 'utf8')
  const out: FacadeBinding[] = []
  for (const stmt of parseExportStatements(text)) {
    for (const b of stmt.bindings) {
      let source: string | null = null
      if (stmt.from !== null) {
        source = resolveSpec(facade, stmt.from)
      } else {
        // local re-export: resolve through the facade's own import of `imported`
        for (const imp of parseImportStatements(facade, text)) {
          if (imp.named.some((n) => n.local === b.imported)) source = imp.resolved
        }
      }
      out.push({ symbol: b.local, isType: b.isType, source })
    }
  }
  return out
}

function scanConsumers(
  facades: ReadonlySet<string>,
): Map<string, Map<string, Consumer[]>> {
  // target module -> imported symbol -> consumers
  const result = new Map<string, Map<string, Consumer[]>>()
  const facadeSources = new Set<string>()
  for (const f of facades) {
    facadeSources.add(f)
    for (const b of facadeBindings(f)) if (b.source !== null) facadeSources.add(b.source)
  }
  for (const file of listTsFiles()) {
    if (facadeSources.has(file)) continue
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    const add = (target: string, symbol: string, kind: Consumer['kind']): void => {
      if (!facadeSources.has(target)) return
      let bySymbol = result.get(target)
      if (bySymbol === undefined) {
        bySymbol = new Map()
        result.set(target, bySymbol)
      }
      const list = bySymbol.get(symbol) ?? []
      list.push({ file, kind })
      bySymbol.set(symbol, list)
    }
    for (const imp of parseImportStatements(file, text)) {
      if (imp.resolved === null) continue
      for (const n of imp.named) add(imp.resolved, n.imported, 'named')
      if (imp.namespace !== null) {
        for (const b of facadeBindings(imp.resolved)) {
          if (new RegExp(`\\b${imp.namespace}\\s*\\.\\s*${b.symbol}\\b`).test(text)) {
            add(imp.resolved, b.symbol, 'namespace')
          }
        }
      }
    }
    const dynRe = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g
    for (const m of text.matchAll(dynRe)) {
      const target = resolveSpec(file, m[1] ?? '')
      if (target === null || !facadeSources.has(target)) continue
      for (const b of facadeBindings(target)) {
        if (new RegExp(`\\.\\s*${b.symbol}\\b`).test(text)) add(target, b.symbol, 'dynamic')
      }
    }
  }
  return result
}

type ClassLetter = 'A' | 'B' | 'C'

interface Classified {
  facade: string
  symbol: string
  isType: boolean
  source: string
  cls: ClassLetter
  prodConsumers: Consumer[]
  testConsumersViaFacade: Consumer[]
  manual: Consumer[]
}

interface FrozenKeep {
  facade: string
  symbol: string
  files: string[]
}

// ---- knip-grounded flagged set ---------------------------------------------

// Runs knip with the pre-ignore config extracted from git history and parses
// its Unused exports/types report. The current knip.config.ts (which contains
// the facade ignore entries this refactor removes) is swapped out for the
// duration of the run and always restored. The flagged set MUST come from
// knip itself: its used-in-file and type/value semantics are not cheaply
// reproducible (a self-derived version misclassified bindings knip never
// flagged, e.g. locally-referenced type re-exports).
function flaggedFromKnip(): Map<string, Set<string>> {
  const configPath = path.join(ROOT, 'knip.config.ts')
  const current = readFileSync(configPath, 'utf8')
  // 2c8e04b9b is the commit that added the facade ignore entries; its parent
  // holds the pre-ignore config. If the branch was rebased, rediscover it via
  // git log --oneline --grep="adapt to msw-storybook-addon" and use that
  // commit's parent.
  const prev = execFileSync('git', ['show', '2c8e04b9b^:knip.config.ts'], { cwd: ROOT }).toString()
  let out = ''
  writeFileSync(configPath, prev)
  try {
    try {
      out = execFileSync('bunx', ['knip-bun', '--strict', '--no-gitignore'], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
      }).toString()
    } catch (error) {
      const stdout = (error as { stdout?: Buffer | string }).stdout
      out = (stdout ?? '').toString()
      if (out === '') throw error
    }
  } finally {
    writeFileSync(configPath, current)
  }
  const flagged = new Map<string, Set<string>>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(?:type\s+)?([\w/.-]+\.ts):\d+:\d+\s*$/.exec(line.trim())
    if (m === null) continue
    const file = m[2] ?? ''
    const set = flagged.get(file) ?? new Set<string>()
    set.add(m[1] ?? '')
    flagged.set(file, set)
  }
  return flagged
}

function analyze(): { items: Classified[]; counts: Record<ClassLetter, number>; frozenKept: FrozenKeep[] } {
  const flagged = flaggedFromKnip()
  const facadeSet = new Set(FACADES.filter((f) => !EXCLUDE_FACADES.has(f)))
  const consumers = scanConsumers(facadeSet)
  const items: Classified[] = []
  const frozenKept: FrozenKeep[] = []
  let flaggedInScope = 0
  for (const facade of facadeSet) {
    const flaggedHere = flagged.get(facade) ?? new Set<string>()
    const bindings = facadeBindings(facade)
    for (const symbol of flaggedHere) {
      flaggedInScope += 1
      const b = bindings.find((x) => x.symbol === symbol)
      if (b === undefined) {
        console.error(`WARN: knip-flagged ${symbol} not found among ${facade} export bindings; skipping`)
        continue
      }
      if (b.source === null) {
        console.error(`WARN: no concrete source for ${symbol} in ${facade}; skipping`)
        continue
      }
      const source = b.source
      const viaFacade = consumers.get(facade)?.get(symbol) ?? []
      const viaSource = consumers.get(source)?.get(symbol) ?? []
      // Frozen files cannot be edited: a binding they import VIA THE FACADE
      // can only be kept (its facade ignore entry stays). Class A repointing
      // is still safe (the binding survives); only B/C pruning is blocked.
      const frozenViaFacade = viaFacade.filter((c) => isFrozen(c.file))
      const prodViaSource = viaSource.filter((c) => !isTestFile(c.file))
      if (frozenViaFacade.length > 0 && prodViaSource.length === 0) {
        frozenKept.push({ facade, symbol, files: frozenViaFacade.map((c) => c.file) })
        continue
      }
      const prodViaFacade = viaFacade.filter((c) => !isTestFile(c.file))
      if (prodViaFacade.length > 0) continue // already used via facade; knip would not flag it
      const testViaFacade = viaFacade.filter((c) => isTestFile(c.file))
      const testViaSource = viaSource.filter((c) => isTestFile(c.file))
      const isManual = (c: Consumer): boolean => c.kind !== 'named' || CONTRACT_TESTS.has(c.file)
      if (prodViaSource.length > 0) {
        items.push({
          facade, symbol, isType: b.isType, source, cls: 'A',
          prodConsumers: prodViaSource.filter((c) => !isManual(c)),
          testConsumersViaFacade: [],
          manual: [...prodViaSource.filter(isManual), ...testViaFacade.filter(isManual)],
        })
      } else if (testViaFacade.length > 0 || testViaSource.length > 0) {
        items.push({
          facade, symbol, isType: b.isType, source, cls: 'B',
          prodConsumers: [],
          testConsumersViaFacade: testViaFacade.filter((c) => !isManual(c)),
          manual: [...testViaFacade.filter(isManual), ...testViaSource.filter(isManual)],
        })
      } else {
        items.push({ facade, symbol, isType: b.isType, source, cls: 'C', prodConsumers: [], testConsumersViaFacade: [], manual: [] })
      }
    }
  }
  const counts: Record<ClassLetter, number> = { A: 0, B: 0, C: 0 }
  for (const it of items) counts[it.cls] += 1
  console.log(`knip-flagged bindings in scope: ${flaggedInScope}`)
  return { items, counts, frozenKept }
}

// ---- Edit engine -----------------------------------------------------------

function removeBindingFromStatement(stmt: string, symbol: string): string {
  const m = /^(export\s+(?:type\s+)?\{)([^{}]*)(\}.*)$/s.exec(stmt)
  if (m === null) return stmt
  const head = m[1] ?? ''
  const body = m[2] ?? ''
  const tail = m[3] ?? ''
  const stmtIsType = /^export\s+type\s+\{/.test(stmt)
  const kept = parseNamedList(body).filter((b) => b.local !== symbol)
  if (kept.length === 0) return ''
  const raw: string[] = kept.map((b) => {
    // Whole-clause `export type { }` already marks bindings; inline `type`
    // prefixes are illegal there (TS1484).
    const typePrefix = b.isType && !stmtIsType ? 'type ' : ''
    return b.imported === b.local ? `${typePrefix}${b.local}` : `${typePrefix}${b.imported} as ${b.local}`
  })
  if (!body.includes('\n')) return `${head} ${raw.join(', ')} ${tail.trimStart()}`
  const firstLine = body.split('\n')[1] ?? '  '
  const indent = /^\s*/.exec(firstLine)?.[0] ?? '  '
  return `${head}\n${raw.map((r) => `${indent}${r},\n`).join('')}${tail}`
}

function pruneFacadeBinding(facade: string, symbol: string, dryRun: boolean): boolean {
  const file = path.join(ROOT, facade)
  const text = readFileSync(file, 'utf8')
  let changed = false
  const out: string[] = []
  let last = 0
  for (const stmt of parseExportStatements(text)) {
    if (!stmt.bindings.some((b) => b.local === symbol)) continue
    const next = removeBindingFromStatement(stmt.text, symbol)
    if (next === stmt.text) continue
    changed = true
    out.push(text.slice(last, stmt.start))
    if (next !== '') out.push(next)
    // if the statement was dropped entirely, swallow one following newline
    last = stmt.end + (next === '' && text[stmt.end] === '\n' ? 1 : 0)
  }
  out.push(text.slice(last))
  if (changed && !dryRun) writeFileSync(file, out.join(''))
  return changed
}

function removeNamedImport(fileText: string, spec: string, symbol: string): string {
  for (const imp of parseImportStatements('x.ts', fileText)) {
    if (imp.spec !== spec || !imp.named.some((n) => n.local === symbol)) continue
    const kept = imp.named.filter((n) => n.local !== symbol)
    if (kept.length === 0) {
      const dropEnd = fileText[imp.end] === '\n' ? imp.end + 1 : imp.end
      return fileText.slice(0, imp.start) + fileText.slice(dropEnd)
    }
    const raw = kept.map((b) => {
      // Whole-clause `import type { }` already marks bindings; inline `type`
      // prefixes are illegal there (TS1484).
      const typePrefix = b.isType && !imp.allType ? 'type ' : ''
      return b.imported === b.local ? `${typePrefix}${b.local}` : `${typePrefix}${b.imported} as ${b.local}`
    })
    const typeKw = imp.allType ? 'type ' : ''
    const def = imp.defaultName !== null ? `${imp.defaultName}, ` : ''
    const next = `import ${typeKw}${def}{ ${raw.join(', ')} } from '${spec}'`
    return fileText.slice(0, imp.start) + next + fileText.slice(imp.end)
  }
  return fileText
}

function addNamedImport(
  fileText: string,
  spec: string,
  binding: NamedBinding,
  beforeIndex: number,
): string {
  const rawFor = (allType: boolean): string => {
    // Whole-clause `import type { }` already marks bindings; inline `type`
    // prefixes are illegal there (TS1484).
    const typePrefix = binding.isType && !allType ? 'type ' : ''
    return binding.imported === binding.local
      ? `${typePrefix}${binding.local}`
      : `${typePrefix}${binding.imported} as ${binding.local}`
  }
  for (const imp of parseImportStatements('x.ts', fileText)) {
    if (imp.spec !== spec || imp.namespace !== null) continue
    if (imp.allType && !binding.isType) continue // never merge a value into an import-type statement
    const bodyM = /\{([^{}]*)\}/s.exec(imp.text)
    if (bodyM === null) break
    const open = imp.text.indexOf('{')
    const next = imp.text.slice(0, open + 1) + ` ${rawFor(imp.allType)},` + imp.text.slice(open + 1)
    return fileText.slice(0, imp.start) + next + fileText.slice(imp.end)
  }
  const stmt = `import { ${rawFor(false)} } from '${spec}'\n`
  return fileText.slice(0, beforeIndex) + stmt + fileText.slice(beforeIndex)
}

function jsSpec(fromFile: string, toModule: string): string {
  let rel = path.posix.relative(path.posix.dirname(fromFile), toModule)
  if (!rel.startsWith('.')) rel = './' + rel
  return rel.replace(/\.ts$/, '.js')
}

// ---- Cycle gate (apply-a) --------------------------------------------------

function buildRuntimeGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const file of listTsFiles()) {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    const edges = graph.get(file) ?? new Set<string>()
    for (const imp of parseImportStatements(file, text)) {
      if (imp.isRuntime && imp.resolved !== null) edges.add(imp.resolved)
    }
    const dynRe = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g
    for (const m of text.matchAll(dynRe)) {
      const t = resolveSpec(file, m[1] ?? '')
      if (t !== null) edges.add(t)
    }
    graph.set(file, edges)
  }
  return graph
}

function reachableFrom(graph: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.pop()
    if (cur === undefined) break
    for (const next of graph.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

// ---- Apply modes -----------------------------------------------------------

function loadTriage(): { items: Classified[] } {
  return JSON.parse(readFileSync(path.join(ROOT, TRIAGE_JSON), 'utf8')) as { items: Classified[] }
}

function applyC(dryRun: boolean): void {
  const { items } = loadTriage()
  const edited = new Set<string>()
  for (const it of items.filter((i) => i.cls === 'C')) {
    if (pruneFacadeBinding(it.facade, it.symbol, dryRun)) edited.add(it.facade)
    console.log(`${dryRun ? '[dry] ' : ''}prune ${it.symbol} from ${it.facade}`)
  }
  console.log(`${edited.size} facade files ${dryRun ? 'would be ' : ''}edited; next: bunx oxfmt on them, then fix unused-import fallout reported by typecheck`)
}

function applyB(dryRun: boolean): void {
  const { items } = loadTriage()
  const editedConsumers = new Set<string>()
  for (const it of items.filter((i) => i.cls === 'B')) {
    for (const c of it.testConsumersViaFacade) {
      if (isFrozen(c.file)) throw new Error(`refusing to edit frozen file ${c.file}`)
      const file = path.join(ROOT, c.file)
      let text = readFileSync(file, 'utf8')
      const facadeSpec = jsSpec(c.file, it.facade)
      const imp = parseImportStatements(c.file, text).find(
        (i) => i.spec === facadeSpec && i.named.some((n) => n.local === it.symbol),
      )
      if (imp === undefined) continue
      const binding = imp.named.find((n) => n.local === it.symbol)
      if (binding === undefined) continue
      const sourceBinding: NamedBinding = { imported: it.symbol, local: binding.local, isType: binding.isType }
      text = removeNamedImport(text, facadeSpec, it.symbol)
      text = addNamedImport(text, jsSpec(c.file, it.source), sourceBinding, imp.start)
      if (!dryRun) writeFileSync(file, text)
      editedConsumers.add(c.file)
      console.log(`${dryRun ? '[dry] ' : ''}repoint ${it.symbol}: ${c.file} -> ${it.source}`)
    }
    if (pruneFacadeBinding(it.facade, it.symbol, dryRun)) {
      console.log(`${dryRun ? '[dry] ' : ''}prune ${it.symbol} from ${it.facade}`)
    }
  }
  console.log(`${editedConsumers.size} consumer files ${dryRun ? 'would be ' : ''}edited`)
}

function applyA(dryRun: boolean): void {
  const { items } = loadTriage()
  const graph = buildRuntimeGraph()
  const reachCache = new Map<string, Set<string>>()
  for (const it of items.filter((i) => i.cls === 'A')) {
    let reach = reachCache.get(it.facade)
    if (reach === undefined) {
      reach = reachableFrom(graph, it.facade)
      reachCache.set(it.facade, reach)
    }
    for (const c of it.prodConsumers) {
      const createsCycle = !it.isType && reach.has(c.file)
      if (createsCycle) {
        console.log(`CYCLE: skip repoint of ${it.symbol} into ${it.facade} for ${c.file}; treat as B (prune binding, prod keeps concrete import)`)
        continue
      }
      const file = path.join(ROOT, c.file)
      let text = readFileSync(file, 'utf8')
      const sourceSpec = jsSpec(c.file, it.source)
      const imp = parseImportStatements(c.file, text).find(
        (i) => i.spec === sourceSpec && i.named.some((n) => n.local === it.symbol),
      )
      if (imp === undefined) continue
      const binding = imp.named.find((n) => n.local === it.symbol)
      if (binding === undefined) continue
      text = removeNamedImport(text, sourceSpec, it.symbol)
      text = addNamedImport(text, jsSpec(c.file, it.facade), binding, imp.start)
      if (!dryRun) writeFileSync(file, text)
      console.log(`${dryRun ? '[dry] ' : ''}repoint ${it.symbol}: ${c.file} -> ${it.facade}`)
    }
  }
  console.log('next: bunx oxfmt on edited files, then typecheck/lint')
}

// ---- Main ------------------------------------------------------------------

if (MODE === 'analyze') {
  const { items, counts, frozenKept } = analyze()
  const manual = items.flatMap((i) => i.manual.map((c) => ({ file: c.file, symbol: i.symbol, reason: c.kind })))
  writeFileSync(path.join(ROOT, TRIAGE_JSON), JSON.stringify({ items, manual, counts, frozenKept }, null, 1))
  console.log(`counts: A=${counts.A} B=${counts.B} C=${counts.C} (expect A+B+C = 162)`)
  console.log(`frozen-kept bindings: ${frozenKept.length} (expected 4)`)
  for (const f of frozenKept) console.log(`  ${f.symbol}  ${f.facade} <- ${f.files.join(', ')}`)
  console.log(`manual consumers: ${manual.length}`)
  for (const m of manual) console.log(`  ${m.symbol} <- ${m.file} (${m.reason})`)
} else if (MODE === 'apply-c') {
  applyC(DRY_RUN)
} else if (MODE === 'apply-b') {
  applyB(DRY_RUN)
} else if (MODE === 'apply-a') {
  applyA(DRY_RUN)
} else {
  console.error('usage: bun scripts/knip-facade-triage/triage.ts <analyze|apply-c|apply-b|apply-a> [--dry-run]')
  process.exit(1)
}
```

Note: the script is written for this repo's strict tsconfig (`noUncheckedIndexedAccess`, `noUnusedLocals`) — it must stay typecheck-clean while present because `bun run typecheck` covers the whole tree.

Note on file layout: the embedded source is a single ~700-line monolith, which violates this repo's `max-lines: 300` / `max-lines-per-function: 50` lint rules. Split it into focused modules under `scripts/knip-facade-triage/` (e.g. `triage.ts` main + `types.ts`, `scope.ts`, `parse.ts`, `analyze.ts`, `edit.ts`, `cycle.ts`, `apply.ts`) keeping the logic byte-faithful — AGENTS.md sanctions splitting for max-lines. Verify the split by identical `analyze` output. The generated `triage.json` is a compact artifact; add `scripts/knip-facade-triage/triage.json` to `.oxfmtignore` to keep `format:check` green (reverted in Task 5).

- [ ] **Step 2: Run analysis**

Run: `bun scripts/knip-facade-triage/triage.ts analyze`
Expected:
- `knip-flagged bindings in scope: 166` — the codemod runs knip live with the pre-ignore config from git history, so the count reflects the current tree (179 knip findings across the 40 report files, minus the 13 bindings in the two excluded facades; the already-pruned `KaneoSearchResponseSchema` no longer appears). A different number means branch drift — stop and re-check.
- `frozen-kept bindings: 4 (expected 4)` — exactly `SessionRecord` (src/coding-sessions/store.ts), `pollAlertsOnce` (src/deferred-prompts/poller.ts), `recentLlm` + `pendingTraces` (src/debug/state-collector.ts). Any other frozen-kept binding is a STOP condition: a frozen file imports it via the facade and the Anchor Data does not know about it — re-check the freeze list.
- `counts: A=.. B=.. C=.. (expect A+B+C = 162)` — the split is the NEW authoritative anchor and replaces the preliminary table above (the codemod is knip-report-driven; the preliminary table's known classification errors, e.g. `ChatProviderConfigField` listed as B where `rg` shows zero consumers, do not recur). Record the actual split and the per-facade breakdown from `triage.json` in your report — the controller syncs the plan's Anchor Data from it before Task 2.
- No `WARN` lines. Any WARN (knip-flagged binding not found in a facade, or missing concrete source) requires explanation in the report.
- `manual consumers:` list printed. Expected members: the four contract-test files (for `PLUGIN_MCP_TOKEN_TTL_SECONDS` and any Class A/B bindings they reference) plus possibly a small number of namespace/dynamic consumers. Record the list for Task 3 Step 3.

- [ ] **Step 3: Verify codemod is typecheck-clean**

Run: `bun run typecheck 2>&1 | grep -c "triage.ts" || true`
Expected: `0` (no type errors in the script). The overall typecheck must stay green: `bun run typecheck 2>&1 | tail -2` prints no errors.

- [ ] **Step 4: Dry-run all three apply modes**

Run: `bun scripts/knip-facade-triage/triage.ts apply-c --dry-run && bun scripts/knip-facade-triage/triage.ts apply-b --dry-run && bun scripts/knip-facade-triage/triage.ts apply-a --dry-run`
Expected: prune/repoint lines for every anchored symbol; zero `CYCLE:` lines is ideal, but any `CYCLE:` line is acceptable — record those symbols; they get Class B treatment in Task 4 Step 3 instead of repointing. Confirm with `git status --porcelain` that no files changed (dry-run writes nothing except `triage.json` from analyze).

No commit in this task — tooling stays uncommitted.

---

### Task 2: Class C — prune 39 dead facade bindings

**Files:**
- Modify: the facades listed with a C column in the Anchor Data (10 files, incl. `client/debug/dashboard-types.ts`, `src/debug/schemas.ts`, `src/group-settings/registry-helpers.ts`)
- Modify (manual fallout): any facade left with unused imports, found by typecheck

**Interfaces:**
- Consumes: `triage.json` from Task 1 (C entries).
- Produces: facades whose export statements no longer contain the 39 Class C bindings; commit 1 of the spec's commit strategy.

- [ ] **Step 1: Apply pruning**

Run: `bun scripts/knip-facade-triage/triage.ts apply-c`
Expected: one `prune <symbol> from <facade>` line per Class C binding in `triage.json` (preliminary count: 39; the Task 1 report carries the authoritative number).

- [ ] **Step 2: Review the diff**

Run: `git diff --stat && git diff`
Expected: only export-statement changes in the 13 facades — removed bindings, dropped emptied statements. No logic edits. `client/debug/dashboard-types.ts` loses its 20 dead type bindings (both from the import block and the re-export block — verify the codemod pruned only re-export statements; the now-unused imports are handled in Step 4).

- [ ] **Step 3: Format**

Run: `bunx oxfmt $(git diff --name-only | tr '\n' ' ') --ignore-path=.oxfmtignore`
Expected: files normalized; no functional diff change.

- [ ] **Step 4: Fix unused-import fallout**

Run: `bun run typecheck 2>&1 | grep "TS6133\|TS6192\|TS6196" | sort -u`
For each reported facade file, remove the unused import binding (or the whole import statement if all its bindings are unused — TS6192). These are imports in the facade that only fed the pruned re-export. Expected hotspots: `client/debug/dashboard-types.ts` (import block from `../shared/api-types.js`), possibly `src/debug/schemas.ts`. Do not touch any consumer file; only facades.

- [ ] **Step 5: Verification gate**

Run: `bun run typecheck && bun run lint && bun run knip`
Expected: all three exit 0 (knip still passes — the ignore entries are still in place at this stage; this task's proof is typecheck/lint plus the diff review).

Run: `bun run test tests/client/ tests/plugins/ tests/scripts/ tests/debug/ tests/commands/ tests/instances/`
Expected: `0 fail`. (The wrapper prints its own short summary and persists the run; use `bun run test:failures` to list any failures instead of re-running.)

- [ ] **Step 6: Commit**

```bash
git add client/debug/dashboard-types.ts src/debug/schemas.ts src/group-settings/registry-helpers.ts \
  src/instances/encryption.ts src/llm-orchestrator-invoke.ts src/commands/context-collector.ts \
  plugins/task-provider-kaneo/provider.ts scripts/behavior-audit/consolidate-agent.ts \
  scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts \
  scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts
git commit -m "refactor: prune dead facade re-exports"
```
(Adjust the file list to `git diff --name-only` output if it differs; never add `scripts/knip-facade-triage/`.)

---

### Task 3: Class B — repoint test imports to concrete modules, prune bindings

**Files:**
- Modify: ~120 test files importing Class B symbols via facades (codemod edits them; `triage.json` B entries list them)
- Modify: facades with a B column in the Anchor Data (24 files)
- Modify: `tests/mcp-server/index.test.ts` (manual contract-test trim)

**Interfaces:**
- Consumes: `triage.json` (B entries with `testConsumersViaFacade`), the `manual` list from Task 1 Step 2.
- Produces: test files importing Class B symbols from their concrete source modules; facades pruned of the 65 Class B bindings; commit 2.

- [ ] **Step 1: Apply test repointing + facade pruning**

Run: `bun scripts/knip-facade-triage/triage.ts apply-b`
Expected: one `repoint` line per (symbol, test-file) pair and one `prune` line per symbol. The codemod refuses to touch frozen files (it throws) — a throw means the classification drifted; stop and investigate rather than bypassing.

- [ ] **Step 2: Review the diff**

Run: `git diff --stat | tail -3 && git diff -- tests/mcp/ tests/message-cache/ | head -40`
Expected: only import-statement changes in test files (symbol moved from facade specifier to concrete specifier, merged into existing imports where present) plus pruned facade export statements. No assertion or logic changes in any test.

- [ ] **Step 3: Manual edits for the `manual` consumer list**

For each entry in the Task 1 `manual` list. The authoritative classification makes exactly three contract-test edits necessary (the `tests/attachments/index.test.ts` and `tests/message-cache/index.test.ts` contract tests need NO edits — their pinned bindings are all Class A or unflagged and survive):

1. `tests/mcp-server/index.test.ts` — `verifyPluginMcpToken` (Class B) and `PLUGIN_MCP_TOKEN_TTL_SECONDS` (Class B) are pruned from the facade. Two edits:
   - In the test `'mintPluginMcpToken and verifyPluginMcpToken are exported from token'`, remove only the `verifyPluginMcpToken` assertion line, keeping the `mintPluginMcpToken` one (Class A, survives):
   ```ts
   // delete this line only:
   expect(typeof mod.verifyPluginMcpToken).toBe('function')
   ```
     and rename the test to `'mintPluginMcpToken is exported from token'`.
   - Delete this whole block:
   ```ts
     test('PLUGIN_MCP_TOKEN_TTL_SECONDS is exported from token', async () => {
       const mod = await import('../../src/mcp-server/index.js')
       expect(typeof mod.PLUGIN_MCP_TOKEN_TTL_SECONDS).toBe('number')
     })
   ```
2. `tests/mcp/index.test.ts` — `convertMcpToolsToToolSet` (Class B) is pruned from the facade. Delete this whole block:
   ```ts
     test('convertMcpToolsToToolSet is exported from tool-adapter', async () => {
       const mod = await import('../../src/mcp/index.js')
       expect(typeof mod.convertMcpToolsToToolSet).toBe('function')
     })
   ```
3. Any OTHER namespace consumer (`import * as x from '<facade>'` using `x.Symbol` for a Class B symbol): change the namespace import to the concrete source specifier, keeping the qualifier — e.g. `import * as token from '../../src/mcp-server/token.js'`. (The `cacheMessage` namespace consumer in `tests/message-cache/index.test.ts` is Class A — no edit.)
4. Any OTHER dynamic consumer (`await import('<facade>')` then `.Symbol` for a Class B symbol): repoint the specifier string to the concrete module path (`.js` extension), unless it is one of the four contract tests (handled above).

- [ ] **Step 4: Format**

Run: `bunx oxfmt $(git diff --name-only | tr '\n' ' ') --ignore-path=.oxfmtignore`

- [ ] **Step 5: Fix unused-import fallout in facades**

Run: `bun run typecheck 2>&1 | grep "TS6133\|TS6192\|TS6196" | sort -u`
Remove the newly-unused import bindings in the pruned facades only (expected: `src/bot.ts` line 9 loses `getThreadScopedStorageContextId`, `scripts/behavior-audit/consolidate-keywords.ts`, `src/plugins/loader.ts`, `src/tools/index.ts`, and facades whose pruned statements were their import's only consumer). Never edit consumers in this step.

- [ ] **Step 6: Verification gate**

Run: `bun run typecheck && bun run lint && bun run knip`
Expected: exit 0.

Run: `bun run test tests/attachments/ tests/mcp/ tests/mcp-server/ tests/message-cache/ tests/plugins/ tests/chat/ tests/debug/ tests/deferred-prompts/ tests/recurring.test.ts tests/recurrence.test.ts tests/providers/ tests/scripts/ tests/llm-orchestrator-invoke.test.ts tests/llm-orchestrator-tool-events.test.ts tests/llm-orchestrator-attachments.test.ts tests/commands/ tests/instances/ tests/long-term-memory/ tests/bot-unauthorized-reply.test.ts tests/utils/`
Expected: `0 fail`. (If a file in this list does not exist, drop it from the command.) The wrapper prints its own short summary and persists the run; use `bun run test:failures` to list any failures instead of re-running.

- [ ] **Step 7: Commit**

```bash
git add tests/ src/ client/ plugins/ scripts/behavior-audit/
git status --porcelain | grep -v '^M ' || true  # confirm nothing unexpected
git commit -m "test: import test-only symbols from concrete modules"
```
Verify `scripts/knip-facade-triage/` is NOT staged before committing.

---

### Task 4: Class A — repoint production imports to facades

**Files:**
- Modify: ~127 production import sites across src/plugins/scripts/client (codemod edits them; `triage.json` A entries list them)
- Modify: facades only if a cycle fallback converts a binding to Class B (then prune per Task 3 mechanics)

**Interfaces:**
- Consumes: `triage.json` (A entries with `prodConsumers`).
- Produces: production files importing Class A symbols through their module facades; commit 3.

- [ ] **Step 1: Dry-run and review cycle report**

Run: `bun scripts/knip-facade-triage/triage.ts apply-a --dry-run`
Expected: one `repoint` line per (Class A symbol, prod consumer) pair in `triage.json`. Scrutinize any `CYCLE:` lines: each names a (symbol, consumer) pair the codemod refuses to repoint. Accept the fallback (those bindings get pruned in Step 3) unless the cycle looks spurious — then investigate the facade's import graph before proceeding.

- [ ] **Step 2: Apply repointing**

Run: `bun scripts/knip-facade-triage/triage.ts apply-a`
Then: `git diff --stat | tail -3`
Expected: only import-statement changes in production files — a binding moved from a concrete-module import to the facade import. Zero logic edits.

- [ ] **Step 3: Prune cycle-fallback bindings**

For each symbol reported as `CYCLE:` in Step 1: prune it from its facade (`bun scripts/knip-facade-triage/triage.ts` has no per-symbol mode — do it by hand with the same mechanics: remove the binding from the facade's export statement, drop the statement if emptied). If any test consumed that binding via the facade, repoint the test import to the concrete source (same edit shape as Task 3 Step 3.2).

- [ ] **Step 4: Format + fallout**

Run: `bunx oxfmt $(git diff --name-only | tr '\n' ' ') --ignore-path=.oxfmtignore`
Run: `bun run typecheck 2>&1 | grep "TS6133\|TS6192\|TS6196" | sort -u`
Expected fallout: emptied concrete-module imports in consumer files (the codemod already drops empty import statements; this step catches leftovers such as default-plus-named mixes). Fix only import statements.

- [ ] **Step 5: Verification gate**

Run: `bun run typecheck && bun run lint && bun run knip`
Expected: exit 0.

Run the serial suite (avoids the known pre-existing `--parallel` contention flake documented in the spec):
Run: `bun run test --serial`
Expected: `0 fail`. Note this is the full 11k-test serial run (~5-10 min) — it persists to `reports/test/`, so inspect it with `bun run test:failures` / `bun run test:log <pattern>` rather than paying for it twice.

- [ ] **Step 6: Commit**

```bash
git add src/ client/ plugins/ scripts/behavior-audit/
git commit -m "refactor: import through module facades instead of concrete internals"
```
Verify `scripts/knip-facade-triage/` is NOT staged. If the diff is unwieldy for review, split by subsystem into two commits (`src/` + `client/`, then `plugins/` + `scripts/`) with the same message.

---

### Task 5: knip.config cleanup, tooling removal, final gate

**Files:**
- Modify: `knip.config.ts`
- Delete: `scripts/knip-facade-triage/` (triage.ts + triage.json)

**Interfaces:**
- Consumes: commits 1–3 (all triage edits landed).
- Produces: the spec's end-state config — 5 justified ignore entries, 32 removed, 2 reverted; commit 4.

- [ ] **Step 1: Reduce the ignoreIssues entries**

In `knip.config.ts`, delete these entries from `ignoreIssues` (32 lines):
`'src/attachments/index.ts'`, `'src/chat/telegram/index.ts'`, `'src/chat/types.ts'`, `'src/commands/context-collector.ts'`, `'src/debug/schemas.ts'`, `'src/group-settings/registry-helpers.ts'`, `'src/instances/encryption.ts'`, `'src/llm-orchestrator-invoke.ts'`, `'src/long-term-memory/store.ts'`, `'src/mcp/index.ts'`, `'src/mcp-server/index.ts'`, `'src/message-cache/index.ts'`, `'src/plugins/contributions.ts'`, `'src/plugins/loader.ts'`, `'src/plugins/registry.ts'`, `'src/plugins/types.ts'`, `'src/providers/membership/index.ts'`, `'src/recurrence.ts'`, `'src/recurring.ts'`, `'src/utils/scheduler.ts'`, `'client/debug/dashboard-types.ts'`, `'plugins/task-provider-kaneo/provider.ts'`, `'plugins/task-provider-kaneo/provision.ts'`, `'plugins/task-provider-youtrack/task-helpers.ts'`, `'scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts'`, `'scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts'`, `'scripts/behavior-audit/consolidate-keywords.ts'`, `'scripts/behavior-audit/extract.ts'`, `'scripts/behavior-audit/incremental.ts'`, `'scripts/behavior-audit/progress.ts'`, `'scripts/behavior-audit/report-writer.ts'`, `'src/bot.ts'`.

Revert the two expanded entries to their pre-bump scope:

```ts
    // parseConsolidationResult is consumed by the schema unit test only.
    'scripts/behavior-audit/consolidate-agent.ts': ['exports'],
```

```ts
    // listToolNames is consumed by the behavior-audit closure verifier via
    // dynamic import from scripts/behavior-audit/entry-point-maps.ts.
    'src/tools/index.ts': ['exports'],
```

Replace the remaining comment block so the kept entries read:

```ts
    // Re-export facades whose remaining flagged bindings knip cannot trace:
    // the published plugin-types package export, declared plugin-core-separation
    // compatibility boundaries, and bindings consumed by byte-frozen 0Q
    // qualification files (tests/stories/**, tests/utils/test-helpers.ts).
    // session-record.ts and store.ts are declared stable compatibility
    // boundaries for the plugin-core-separation refactor (see entry list);
    // store.ts is also consumed by the frozen story harness.
    'src/coding-sessions/session-record.ts': ['exports'],
    'src/coding-sessions/store.ts': ['types'],
    // state-collector re-exports recentLlm/pendingTraces for the frozen
    // tests/utils/test-helpers.ts.
    'src/debug/state-collector.ts': ['exports', 'types'],
    // pollAlertsOnce is consumed by frozen tests/stories/harness/scenario.ts.
    'src/deferred-prompts/poller.ts': ['exports'],
    // public-types.ts is published as the `papai/plugin-types` package export
    // (package.json `exports`) and consumed by external plugin authors knip
    // cannot trace, plus tests/providers/public-types.test.ts.
    'src/providers/public-types.ts': ['exports', 'types'],
    // AdminLlmSnapshot/AdminLlmKeyState model the BYOK system-key admin surface;
    // consumed by the BYOK-key contract tests (tests/client/**) and the dev-only
    // Storybook fixture harness (client/stories/**, knip-ignored by config).
    // Zero production consumers today; the types pin the 5 live BYOK keys.
    'client/shared/api-types.ts': ['types'],
```

(The 6th entry was added during execution: the `AdminLlmSnapshot` cascade surfaced in Task 5 and the controller ruled the BYOK drift-guard types stay — see the ledger. The dead `makeAdminLlmSnapshot` fixture factory was deleted in the same commit.)

- [ ] **Step 2: The proof — knip clean without the ignores**

Run: `bun run knip`
Expected: exit 0, no findings. This is the plan's success criterion: the 32 removed ignore entries stay removed because the code structure now satisfies knip. If findings appear, they name bindings the triage missed — fix by the same class rules (do NOT re-add ignores).

- [ ] **Step 3: Remove the codemod**

Run: `rm -rf scripts/knip-facade-triage`
Also revert the `.oxfmtignore` change from Task 1 (remove the `scripts/knip-facade-triage/triage.json` line — the artifact no longer exists).
Then: `bun run typecheck && bun run lint && bun run format:check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add knip.config.ts
git commit -m "chore(knip): drop facade ignoreIssues resolved by import triage"
```

- [ ] **Step 5: Full gate + CI**

Run: `bun check:full`
Expected: 12/12 or 11/12 with ONLY the `test` lane failing (inspect that lane with `bun run test:failures`; each other lane's output is in `reports/checks/<check>.log`) — that lane's intermittent `--parallel` contention failures reproduce on clean master in this environment (documented in the spec); the serial run in Task 4 Step 5 is the authoritative local signal. Then:

```bash
git push origin dependabot/bun/bun-dependencies-aec7b819e5
gh pr checks 216 --repo yourpapai/papai --watch
```

Expected: all PR checks green, including the `Checks` job (which runs the serial suite in CI).

---

## Self-Review Notes (completed)

- **Spec coverage:** triage classes (Tasks 2–4), contract-test trims (Task 3 Step 3), frozen-file constraint (codemod via-facade frozen guard + throw guard), cycle fallback (Task 4 Steps 1–3), config end state (Task 5 Step 1), verification incl. flake caveat (Task 5 Step 5), 4-commit strategy (Tasks 2–5) — all covered.
- **Deviation from spec (deliberate):** the spec's execution model gates per-facade in dependency order; the plan gates per-class batch (Tasks 2–4), matching the spec's own per-class commit strategy. Per-facade isolation is preserved inside each batch by the codemod's deterministic per-symbol edits plus the diff-review step before each gate.
- **Anchors:** A=58/B=65/C=39 totals plus per-facade table; Task 1 Step 2 halts on unexplained mismatch, preventing silent drift execution. A repo-wide scan confirmed zero aliased re-exports (`export { a as b }`) in the 40 facades, so the codemod's name mapping is identity everywhere; alias-handling code paths exist but are unused.
- **Type consistency:** `triage.json` `items` shape produced in Task 1 matches what `apply-*` modes consume (`Classified`); task Interfaces blocks reference the same field names.
