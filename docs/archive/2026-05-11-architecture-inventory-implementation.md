<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Architecture Inventory And Deletion Candidate Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable repository-local tool that inventories papai architectural pieces, attaches evidence relevant to later deletion review, and writes a complete `docs/architecture/` package without recommending deletions.

**Architecture:** Implement the workflow as a semi-automated root script pipeline under `scripts/` with small focused modules for taxonomy, discovery, registry normalization, signal collection, reporting, and orchestration. Reuse the existing repository boundaries and treat `codeindex` as an external analysis dependency via its existing database and CLI surface, rather than importing workspace internals into root scripts.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Node `fs/promises`, existing `codeindex` database and CLI, Bun test runner, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-05-11-architecture-inventory-and-deletion-candidate-identification-design.md`

**Execution Note:** Commit steps are included for teams that want granular history. During actual execution, only run the commit steps if the user has explicitly asked for commits in that session.

---

## Scope Check

This should stay as one implementation plan. The taxonomy, discovery rules, canonical registry, signal collection, report rendering, and CLI orchestration are tightly coupled and all feed the same `docs/architecture/` package. Splitting them would force later implementers to guess shared record shapes and output contracts.

## File Structure

- Create: `scripts/architecture-inventory-model.ts`
  Shared taxonomy, record types, mandatory families, and stable slug helpers.
- Create: `scripts/architecture-inventory-discovery.ts`
  Top-down document/script/workspace extraction plus bottom-up filesystem candidate discovery.
- Create: `scripts/architecture-inventory-registry.ts`
  Canonical registry normalization, ownership mapping, and related asset attachment.
- Create: `scripts/architecture-inventory-signals.ts`
  Codeindex-backed reference summary loading and per-piece non-destructive signal collection.
- Create: `scripts/architecture-inventory-report.ts`
  Markdown and JSON rendering for inventory index, review queue, matrices, and per-piece dossiers.
- Create: `scripts/architecture-inventory.ts`
  CLI entrypoint, dependency injection boundary, filesystem reads, optional codeindex reindex, and output writing.
- Create: `tests/scripts/architecture-inventory-discovery.test.ts`
  Deterministic tests for taxonomy, top-down extraction, and bottom-up discovery heuristics.
- Create: `tests/scripts/architecture-inventory-registry.test.ts`
  Deterministic tests for canonical registry merging and asset ownership mapping.
- Create: `tests/scripts/architecture-inventory-signals.test.ts`
  Deterministic tests for codeindex summary loading and signal generation.
- Create: `tests/scripts/architecture-inventory-report.test.ts`
  Deterministic tests for inventory markdown, queue ordering, and dossier rendering.
- Create: `tests/scripts/architecture-inventory.test.ts`
  Deterministic orchestration tests for CLI parsing, optional reindex behavior, and output-file writing.
- Modify: `package.json`
  Add a root script entry for running the inventory pipeline.

---

### Task 1: Shared Taxonomy And Discovery Rules

**Files:**

- Create: `tests/scripts/architecture-inventory-discovery.test.ts`
- Create: `scripts/architecture-inventory-model.ts`
- Create: `scripts/architecture-inventory-discovery.ts`

- [ ] **Step 1: Write the failing taxonomy and discovery tests**

Create `tests/scripts/architecture-inventory-discovery.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import {
  MANDATORY_SCOPE_FAMILIES,
  PIECE_STATUSES,
  PIECE_TYPES,
  slugifyPieceName,
} from '../../scripts/architecture-inventory-model.js'
import {
  discoverFilesystemPieceCandidates,
  extractTopDownPieceCandidates,
} from '../../scripts/architecture-inventory-discovery.js'

describe('architecture inventory discovery', () => {
  test('defines the canonical taxonomy and stable slugs', () => {
    expect(PIECE_TYPES).toEqual([
      'runtime-subsystem',
      'product-feature',
      'integration-provider',
      'developer-workflow',
      'analysis-tool',
      'experimental-or-legacy-variant',
      'cross-cutting-concept',
    ])

    expect(PIECE_STATUSES).toEqual(['active', 'experimental', 'legacy', 'unclear'])
    expect(slugifyPieceName('Debug Server and Dashboard Client')).toBe('debug-server-and-dashboard-client')
    expect(MANDATORY_SCOPE_FAMILIES.map((piece) => piece.name)).toEqual(
      expect.arrayContaining([
        'bot runtime and startup',
        'chat provider adapters',
        'task provider adapters',
        'tool registry and capability gating',
        'codeindex workspace',
        'review-loop workspace',
        'behavior-audit scripts',
      ]),
    )
  })

  test('extracts top-down pieces from docs, workspaces, and scripts', () => {
    const pieces = extractTopDownPieceCandidates({
      readme: [
        '| `src/tools/` | Context-aware, capability-gated tool assembly |',
        '| `src/providers/` | Kaneo and YouTrack provider adapters |',
        '| `src/debug/` and `client/debug/` | Optional local debug server and dashboard UI |',
      ].join('\n'),
      claude: [
        '- `src/message-queue/` — message coalescing and orderly orchestrator dispatch',
        '- `src/web/` — safe public HTTP(S) fetch, extraction, distillation, rate limiting, cache',
        '- `src/group-settings/` — DM selection of personal vs group settings target',
      ].join('\n'),
      roadmap: [
        '## Phase 7: Deferred Prompts',
        '- [x] Execution history logging — deferred prompt results appended to conversation history',
        '## Phase 8: Recurring Work Automation',
        '- [ ] Fixed-schedule recurrence — every Monday, first business day of month, etc.',
      ].join('\n'),
      packageJson: {
        workspaces: ['codeindex', 'review-loop'],
        scripts: {
          'audit:behavior': 'bun scripts/behavior-audit/index.ts',
          'benchmark:tool-surface': 'bun scripts/tool-surface-benchmark.ts',
          'codeindex:test': 'bun run --filter codeindex test',
          duplicates: 'bun run scripts/detect-duplicates.ts',
        },
      },
    })

    expect(pieces.map((piece) => piece.name)).toEqual(
      expect.arrayContaining([
        'tool registry and capability gating',
        'task provider adapters',
        'debug server and dashboard client',
        'message queue',
        'web fetch',
        'group settings and configuration flows',
        'deferred prompts',
        'recurring tasks',
        'codeindex workspace',
        'review-loop workspace',
        'behavior-audit scripts',
        'tool-surface benchmark',
      ]),
    )
  })

  test('discovers bottom-up pieces from repository paths', () => {
    const pieces = discoverFilesystemPieceCandidates({
      topLevelEntries: ['src', 'client', 'scripts', 'tests', 'codeindex', 'review-loop', 'docs'],
      srcEntries: [
        'src/bot.ts',
        'src/index.ts',
        'src/tools',
        'src/providers',
        'src/message-queue',
        'src/identity',
        'src/web',
      ],
      clientEntries: ['client/debug'],
      scriptEntries: [
        'scripts/plan-adr-workflow.ts',
        'scripts/build-client.ts',
        'scripts/tool-surface-benchmark.ts',
        'scripts/behavior-audit/index.ts',
      ],
      testEntries: [
        'tests/scripts/behavior-audit/entrypoint.test.ts',
        'tests/scripts/plan-adr-workflow.test.ts',
        'tests/tools/create-task.test.ts',
      ],
      historicalDocEntries: [
        'docs/archive/provider-capability-architecture-design-2026-04-10.md',
        'docs/superpowers/remaining/2026-04-23-behavior-audit-legacy-cleanup.md',
      ],
    })

    expect(pieces.map((piece) => piece.name)).toEqual(
      expect.arrayContaining([
        'bot runtime and startup',
        'tool registry and capability gating',
        'task provider adapters',
        'message queue',
        'identity mapping',
        'web fetch',
        'debug server and dashboard client',
        'ADR planning workflow',
        'client build workflow',
        'tool-surface benchmark',
        'behavior-audit scripts',
        'provider capability architecture',
      ]),
    )

    expect(pieces.find((piece) => piece.name === 'provider capability architecture')?.status).toBe('legacy')
  })
})
```

- [ ] **Step 2: Run the discovery tests to verify they fail**

Run: `bun test tests/scripts/architecture-inventory-discovery.test.ts`

Expected: FAIL because `scripts/architecture-inventory-model.ts` and `scripts/architecture-inventory-discovery.ts` do not exist yet.

- [ ] **Step 3: Implement the shared model and discovery modules**

Create `scripts/architecture-inventory-model.ts`:

```typescript
export const PIECE_TYPES = [
  'runtime-subsystem',
  'product-feature',
  'integration-provider',
  'developer-workflow',
  'analysis-tool',
  'experimental-or-legacy-variant',
  'cross-cutting-concept',
] as const

export const PIECE_STATUSES = ['active', 'experimental', 'legacy', 'unclear'] as const

export const SIGNAL_NAMES = [
  'no-current-runtime-entrypoint',
  'no-current-script-entrypoint',
  'no-tests-found',
  'no-current-docs-found',
  'docs-code-mismatch',
  'historical-docs-only',
  'overlapping-implementation-detected',
  'provider-capability-not-surfaced',
  'script-only-existence',
  'benchmark-only-existence',
  'audit-only-existence',
  'declared-but-not-wired',
  'wired-but-lightly-referenced',
  'variant-with-same-purpose',
  'status-unclear',
] as const

export type PieceType = (typeof PIECE_TYPES)[number]
export type PieceStatus = (typeof PIECE_STATUSES)[number]
export type SignalName = (typeof SIGNAL_NAMES)[number]

export type PieceSourceKind =
  | 'readme'
  | 'claude'
  | 'roadmap'
  | 'package-workspace'
  | 'package-script'
  | 'filesystem'
  | 'tests'
  | 'archive-doc'

export interface PieceSource {
  readonly kind: PieceSourceKind
  readonly location: string
}

export interface PieceCandidate {
  readonly name: string
  readonly type: PieceType
  readonly status: PieceStatus
  readonly summary: string
  readonly declaredPaths: readonly string[]
  readonly aliases: readonly string[]
  readonly tags: readonly string[]
  readonly sources: readonly PieceSource[]
}

export interface PieceSignal {
  readonly name: SignalName
  readonly evidence: readonly string[]
}

export interface PieceRecord extends PieceCandidate {
  readonly pieceId: string
  readonly primaryPaths: readonly string[]
  readonly secondaryPaths: readonly string[]
  readonly entrypoints: readonly string[]
  readonly relatedTests: readonly string[]
  readonly relatedDocs: readonly string[]
  readonly relatedScripts: readonly string[]
  readonly configOrEnvDependencies: readonly string[]
  readonly runtimeDependencies: readonly string[]
  readonly dependents: readonly string[]
  readonly signals: readonly PieceSignal[]
  readonly manualReviewQuestions: readonly string[]
}

export const MANDATORY_SCOPE_FAMILIES: readonly PieceCandidate[] = [
  {
    name: 'bot runtime and startup',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Entry-point runtime and bot orchestration.',
    declaredPaths: ['src/index.ts', 'src/bot.ts'],
    aliases: ['runtime', 'bot'],
    tags: ['runtime'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'chat provider adapters',
    type: 'integration-provider',
    status: 'active',
    summary: 'Telegram, Mattermost, and Discord adapter layer.',
    declaredPaths: ['src/chat'],
    aliases: ['chat providers'],
    tags: ['chat'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'task provider adapters',
    type: 'integration-provider',
    status: 'active',
    summary: 'Kaneo and YouTrack normalized provider layer.',
    declaredPaths: ['src/providers'],
    aliases: ['task providers'],
    tags: ['provider'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'tool registry and capability gating',
    type: 'cross-cutting-concept',
    status: 'active',
    summary: 'Tool assembly and capability-based exposure rules.',
    declaredPaths: ['src/tools'],
    aliases: ['tool registry'],
    tags: ['tools'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'conversation history, memory, and context storage',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Conversation state, memory, and storage-context logic.',
    declaredPaths: ['src/conversation.ts', 'src/history.ts', 'src/memory.ts'],
    aliases: ['conversation memory'],
    tags: ['memory'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'identity mapping',
    type: 'product-feature',
    status: 'active',
    summary: 'Chat identity to provider identity resolution.',
    declaredPaths: ['src/identity'],
    aliases: ['identity'],
    tags: ['identity'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'group settings and configuration flows',
    type: 'product-feature',
    status: 'active',
    summary: 'Setup, config, and group-target selection flows.',
    declaredPaths: ['src/group-settings', 'src/commands'],
    aliases: ['group settings'],
    tags: ['config'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'message queue',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Queued prompt handling and orderly dispatch.',
    declaredPaths: ['src/message-queue'],
    aliases: ['message queueing'],
    tags: ['queue'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'file relay',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Turn-scoped file relay for attachments.',
    declaredPaths: ['src/file-relay.ts'],
    aliases: ['attachments relay'],
    tags: ['files'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'web fetch',
    type: 'product-feature',
    status: 'active',
    summary: 'Public web fetch, extraction, and caching behavior.',
    declaredPaths: ['src/web'],
    aliases: ['web_fetch'],
    tags: ['web'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'recurring tasks',
    type: 'product-feature',
    status: 'active',
    summary: 'Recurring work automation feature family.',
    declaredPaths: [],
    aliases: ['recurrence'],
    tags: ['recurring'],
    sources: [{ kind: 'roadmap', location: 'mandatory-scope-family' }],
  },
  {
    name: 'deferred prompts',
    type: 'product-feature',
    status: 'active',
    summary: 'Scheduled prompt and delayed proactive assistance feature family.',
    declaredPaths: [],
    aliases: ['scheduled prompts'],
    tags: ['deferred'],
    sources: [{ kind: 'roadmap', location: 'mandatory-scope-family' }],
  },
  {
    name: 'debug server and dashboard client',
    type: 'runtime-subsystem',
    status: 'active',
    summary: 'Optional debug server and local dashboard UI.',
    declaredPaths: ['src/debug', 'client/debug'],
    aliases: ['debug dashboard'],
    tags: ['debug'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
  {
    name: 'codeindex workspace',
    type: 'analysis-tool',
    status: 'active',
    summary: 'Symbol-first code indexing workspace.',
    declaredPaths: ['codeindex'],
    aliases: ['codeindex'],
    tags: ['workspace'],
    sources: [{ kind: 'package-workspace', location: 'mandatory-scope-family' }],
  },
  {
    name: 'review-loop workspace',
    type: 'analysis-tool',
    status: 'active',
    summary: 'Review-loop workflow workspace.',
    declaredPaths: ['review-loop'],
    aliases: ['review-loop'],
    tags: ['workspace'],
    sources: [{ kind: 'package-workspace', location: 'mandatory-scope-family' }],
  },
  {
    name: 'benchmark scripts',
    type: 'analysis-tool',
    status: 'experimental',
    summary: 'Advisory benchmark scripts and supporting scenarios.',
    declaredPaths: ['scripts'],
    aliases: ['benchmarks'],
    tags: ['benchmark'],
    sources: [{ kind: 'package-script', location: 'mandatory-scope-family' }],
  },
  {
    name: 'behavior-audit scripts',
    type: 'analysis-tool',
    status: 'experimental',
    summary: 'Behavior-audit extraction, classification, and reporting workflow.',
    declaredPaths: ['scripts/behavior-audit'],
    aliases: ['behavior audit'],
    tags: ['audit'],
    sources: [{ kind: 'package-script', location: 'mandatory-scope-family' }],
  },
  {
    name: 'release, deploy, and verification workflows',
    type: 'developer-workflow',
    status: 'active',
    summary: 'Release, deployment, verification, and repo-maintenance workflows.',
    declaredPaths: ['scripts', '.github'],
    aliases: ['release workflow'],
    tags: ['workflow'],
    sources: [{ kind: 'package-script', location: 'mandatory-scope-family' }],
  },
  {
    name: 'archived or alternate behavior implementations',
    type: 'experimental-or-legacy-variant',
    status: 'legacy',
    summary: 'Historical or alternate implementations retained for reference.',
    declaredPaths: ['docs/archive', 'docs/superpowers/remaining'],
    aliases: ['legacy variants'],
    tags: ['legacy'],
    sources: [{ kind: 'archive-doc', location: 'mandatory-scope-family' }],
  },
  {
    name: 'provider capabilities not surfaced at tool level',
    type: 'cross-cutting-concept',
    status: 'unclear',
    summary: 'Provider capabilities available in the provider layer but not exposed as tools.',
    declaredPaths: ['src/providers/types.ts', 'src/tools'],
    aliases: ['provider capability surface'],
    tags: ['capabilities'],
    sources: [{ kind: 'claude', location: 'mandatory-scope-family' }],
  },
] as const

export const slugifyPieceName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/g, '')
    .replace(/-+$/g, '')
```

Create `scripts/architecture-inventory-discovery.ts`:

```typescript
import type { PieceCandidate, PieceSource, PieceStatus, PieceType } from './architecture-inventory-model.js'
import { MANDATORY_SCOPE_FAMILIES, slugifyPieceName } from './architecture-inventory-model.js'

export interface TopDownDiscoveryInput {
  readonly readme: string
  readonly claude: string
  readonly roadmap: string
  readonly packageJson: Readonly<{
    workspaces?: readonly string[]
    scripts?: Readonly<Record<string, string>>
  }>
}

export interface FilesystemDiscoveryInput {
  readonly topLevelEntries: readonly string[]
  readonly srcEntries: readonly string[]
  readonly clientEntries: readonly string[]
  readonly scriptEntries: readonly string[]
  readonly testEntries: readonly string[]
  readonly historicalDocEntries: readonly string[]
}

const uniqueCandidates = (candidates: readonly PieceCandidate[]): readonly PieceCandidate[] =>
  Object.values(
    candidates.reduce<Record<string, PieceCandidate>>((acc, candidate) => {
      const key = `${slugifyPieceName(candidate.name)}:${candidate.type}`
      const existing = acc[key]
      if (existing === undefined) {
        return { ...acc, [key]: candidate }
      }

      return {
        ...acc,
        [key]: {
          ...existing,
          declaredPaths: [...new Set([...existing.declaredPaths, ...candidate.declaredPaths])],
          aliases: [...new Set([...existing.aliases, ...candidate.aliases])],
          tags: [...new Set([...existing.tags, ...candidate.tags])],
          sources: [...existing.sources, ...candidate.sources],
        },
      }
    }, {}),
  )

const makeCandidate = (
  name: string,
  type: PieceType,
  status: PieceStatus,
  summary: string,
  declaredPaths: readonly string[],
  source: PieceSource,
  tags: readonly string[] = [],
): PieceCandidate => ({
  name,
  type,
  status,
  summary,
  declaredPaths,
  aliases: [],
  tags,
  sources: [source],
})

const extractBacktickedPaths = (markdown: string): readonly string[] =>
  [...markdown.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '').filter((value) => value.length > 0)

const extractRoadmapFamilies = (roadmap: string): readonly PieceCandidate[] => {
  const lines = roadmap.split('\n')
  return lines.flatMap((line): readonly PieceCandidate[] => {
    if (line.includes('Deferred Prompt') || line.includes('deferred prompt')) {
      return [
        makeCandidate(
          'deferred prompts',
          'product-feature',
          'active',
          'Deferred prompt feature family.',
          [],
          { kind: 'roadmap', location: line },
          ['deferred'],
        ),
      ]
    }

    if (line.includes('Recurring Work') || line.includes('recurring')) {
      return [
        makeCandidate(
          'recurring tasks',
          'product-feature',
          'active',
          'Recurring task feature family.',
          [],
          { kind: 'roadmap', location: line },
          ['recurring'],
        ),
      ]
    }

    return []
  })
}

const candidateFromDocumentPath = (rawPath: string, sourceKind: PieceSource['kind']): PieceCandidate | null => {
  if (rawPath.includes('src/tools')) {
    return makeCandidate(
      'tool registry and capability gating',
      'cross-cutting-concept',
      'active',
      'Tool assembly and capability gating.',
      ['src/tools'],
      { kind: sourceKind, location: rawPath },
      ['tools'],
    )
  }

  if (rawPath.includes('src/providers')) {
    return makeCandidate(
      'task provider adapters',
      'integration-provider',
      'active',
      'Task provider adapter layer.',
      ['src/providers'],
      { kind: sourceKind, location: rawPath },
      ['provider'],
    )
  }

  if (rawPath.includes('src/debug') || rawPath.includes('client/debug')) {
    return makeCandidate(
      'debug server and dashboard client',
      'runtime-subsystem',
      'active',
      'Optional local debug server and dashboard client.',
      ['src/debug', 'client/debug'],
      { kind: sourceKind, location: rawPath },
      ['debug'],
    )
  }

  if (rawPath.includes('src/message-queue')) {
    return makeCandidate(
      'message queue',
      'runtime-subsystem',
      'active',
      'Queued prompt handling.',
      ['src/message-queue'],
      {
        kind: sourceKind,
        location: rawPath,
      },
    )
  }

  if (rawPath.includes('src/web')) {
    return makeCandidate('web fetch', 'product-feature', 'active', 'Web fetch and extraction pipeline.', ['src/web'], {
      kind: sourceKind,
      location: rawPath,
    })
  }

  if (rawPath.includes('src/group-settings')) {
    return makeCandidate(
      'group settings and configuration flows',
      'product-feature',
      'active',
      'Setup and group-target configuration flows.',
      ['src/group-settings'],
      { kind: sourceKind, location: rawPath },
      ['config'],
    )
  }

  return null
}

const candidateFromWorkspace = (workspace: string): PieceCandidate =>
  makeCandidate(
    workspace === 'codeindex' ? 'codeindex workspace' : 'review-loop workspace',
    'analysis-tool',
    'active',
    `${workspace} workspace.`,
    [workspace],
    { kind: 'package-workspace', location: workspace },
    ['workspace'],
  )

const candidateFromScript = (name: string, command: string): PieceCandidate => {
  if (name.startsWith('audit:behavior') || command.includes('behavior-audit')) {
    return makeCandidate(
      'behavior-audit scripts',
      'analysis-tool',
      'experimental',
      'Behavior-audit workflow scripts.',
      ['scripts/behavior-audit'],
      { kind: 'package-script', location: name },
      ['audit'],
    )
  }

  if (name.includes('benchmark') || command.includes('benchmark')) {
    return makeCandidate(
      'tool-surface benchmark',
      'analysis-tool',
      'experimental',
      'Benchmark script family.',
      ['scripts'],
      { kind: 'package-script', location: name },
      ['benchmark'],
    )
  }

  return makeCandidate(
    name.replace(/[:.]/g, ' '),
    'developer-workflow',
    'active',
    `Developer workflow script ${name}.`,
    ['scripts'],
    { kind: 'package-script', location: name },
    ['workflow'],
  )
}

export const extractTopDownPieceCandidates = (input: Readonly<TopDownDiscoveryInput>): readonly PieceCandidate[] => {
  const docCandidates = [
    ...extractBacktickedPaths(input.readme).flatMap((rawPath) => {
      const candidate = candidateFromDocumentPath(rawPath, 'readme')
      return candidate === null ? [] : [candidate]
    }),
    ...extractBacktickedPaths(input.claude).flatMap((rawPath) => {
      const candidate = candidateFromDocumentPath(rawPath, 'claude')
      return candidate === null ? [] : [candidate]
    }),
  ]

  const workspaceCandidates = (input.packageJson.workspaces ?? []).map(candidateFromWorkspace)
  const scriptCandidates = Object.entries(input.packageJson.scripts ?? {}).map(([name, command]) =>
    candidateFromScript(name, command),
  )

  return uniqueCandidates([
    ...MANDATORY_SCOPE_FAMILIES,
    ...docCandidates,
    ...extractRoadmapFamilies(input.roadmap),
    ...workspaceCandidates,
    ...scriptCandidates,
  ])
}

const candidateFromSrcPath = (entry: string): PieceCandidate | null => {
  if (entry === 'src/index.ts' || entry === 'src/bot.ts') {
    return makeCandidate(
      'bot runtime and startup',
      'runtime-subsystem',
      'active',
      'Runtime entrypoint and bot orchestration.',
      [entry],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'src/tools') {
    return makeCandidate(
      'tool registry and capability gating',
      'cross-cutting-concept',
      'active',
      'Tool assembly and gating.',
      ['src/tools'],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'src/providers') {
    return makeCandidate(
      'task provider adapters',
      'integration-provider',
      'active',
      'Provider adapter layer.',
      ['src/providers'],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'src/message-queue') {
    return makeCandidate(
      'message queue',
      'runtime-subsystem',
      'active',
      'Queued prompt subsystem.',
      ['src/message-queue'],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'src/identity') {
    return makeCandidate(
      'identity mapping',
      'product-feature',
      'active',
      'Identity mapping subsystem.',
      ['src/identity'],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'src/web') {
    return makeCandidate('web fetch', 'product-feature', 'active', 'Web fetch subsystem.', ['src/web'], {
      kind: 'filesystem',
      location: entry,
    })
  }

  return null
}

const candidateFromFilesystemScript = (entry: string): PieceCandidate | null => {
  if (entry === 'scripts/plan-adr-workflow.ts') {
    return makeCandidate(
      'ADR planning workflow',
      'developer-workflow',
      'active',
      'Plan to ADR archiving workflow.',
      [entry],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry === 'scripts/build-client.ts') {
    return makeCandidate(
      'client build workflow',
      'developer-workflow',
      'active',
      'Debug dashboard build workflow.',
      [entry],
      {
        kind: 'filesystem',
        location: entry,
      },
    )
  }

  if (entry.includes('tool-surface-benchmark')) {
    return makeCandidate(
      'tool-surface benchmark',
      'analysis-tool',
      'experimental',
      'Tool-surface benchmark script family.',
      ['scripts'],
      {
        kind: 'filesystem',
        location: entry,
      },
      ['benchmark'],
    )
  }

  if (entry.includes('behavior-audit')) {
    return makeCandidate(
      'behavior-audit scripts',
      'analysis-tool',
      'experimental',
      'Behavior-audit script family.',
      ['scripts/behavior-audit'],
      {
        kind: 'filesystem',
        location: entry,
      },
      ['audit'],
    )
  }

  return null
}

const candidateFromHistoricalDoc = (entry: string): PieceCandidate | null => {
  if (entry.includes('provider-capability-architecture')) {
    return makeCandidate(
      'provider capability architecture',
      'experimental-or-legacy-variant',
      'legacy',
      'Archived provider capability architecture design and plan.',
      [entry],
      { kind: 'archive-doc', location: entry },
      ['legacy'],
    )
  }

  if (entry.includes('behavior-audit')) {
    return makeCandidate(
      'archived behavior-audit variants',
      'experimental-or-legacy-variant',
      'legacy',
      'Archived or remaining behavior-audit design work.',
      [entry],
      { kind: 'archive-doc', location: entry },
      ['legacy', 'audit'],
    )
  }

  return null
}

export const discoverFilesystemPieceCandidates = (
  input: Readonly<FilesystemDiscoveryInput>,
): readonly PieceCandidate[] =>
  uniqueCandidates([
    ...input.srcEntries.flatMap((entry) => {
      const candidate = candidateFromSrcPath(entry)
      return candidate === null ? [] : [candidate]
    }),
    ...input.clientEntries.flatMap((entry) =>
      entry === 'client/debug'
        ? [
            makeCandidate(
              'debug server and dashboard client',
              'runtime-subsystem',
              'active',
              'Debug dashboard client.',
              ['client/debug'],
              {
                kind: 'filesystem',
                location: entry,
              },
              ['debug'],
            ),
          ]
        : [],
    ),
    ...input.scriptEntries.flatMap((entry) => {
      const candidate = candidateFromFilesystemScript(entry)
      return candidate === null ? [] : [candidate]
    }),
    ...input.testEntries.flatMap((entry) =>
      entry.includes('behavior-audit')
        ? [
            makeCandidate(
              'behavior-audit scripts',
              'analysis-tool',
              'experimental',
              'Behavior-audit scripts confirmed by tests.',
              ['scripts/behavior-audit'],
              {
                kind: 'tests',
                location: entry,
              },
              ['audit'],
            ),
          ]
        : [],
    ),
    ...input.topLevelEntries.flatMap((entry) =>
      entry === 'codeindex'
        ? [candidateFromWorkspace('codeindex')]
        : entry === 'review-loop'
          ? [candidateFromWorkspace('review-loop')]
          : [],
    ),
    ...input.historicalDocEntries.flatMap((entry) => {
      const candidate = candidateFromHistoricalDoc(entry)
      return candidate === null ? [] : [candidate]
    }),
  ])
```

- [ ] **Step 4: Run the discovery tests to verify they pass**

Run: `bun test tests/scripts/architecture-inventory-discovery.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the taxonomy and discovery modules**

```bash
git add tests/scripts/architecture-inventory-discovery.test.ts scripts/architecture-inventory-model.ts scripts/architecture-inventory-discovery.ts
git commit -m "feat: add architecture inventory discovery rules"
```

---

### Task 2: Canonical Registry And Asset Ownership Mapping

**Files:**

- Create: `tests/scripts/architecture-inventory-registry.test.ts`
- Create: `scripts/architecture-inventory-registry.ts`

- [ ] **Step 1: Write the failing registry and ownership tests**

Create `tests/scripts/architecture-inventory-registry.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { PieceCandidate } from '../../scripts/architecture-inventory-model.js'
import { attachRepositoryAssets, buildCanonicalRegistry } from '../../scripts/architecture-inventory-registry.js'

const baseCandidate = (overrides: Partial<PieceCandidate>): PieceCandidate => ({
  name: 'tool registry and capability gating',
  type: 'cross-cutting-concept',
  status: 'active',
  summary: 'Tool assembly and capability gating.',
  declaredPaths: ['src/tools'],
  aliases: [],
  tags: ['tools'],
  sources: [{ kind: 'claude', location: 'CLAUDE.md' }],
  ...overrides,
})

describe('architecture inventory registry', () => {
  test('merges duplicate candidates into one canonical piece', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({}),
      baseCandidate({
        declaredPaths: ['src/tools', 'src/tools/index.ts'],
        aliases: ['tool registry'],
        sources: [{ kind: 'filesystem', location: 'src/tools' }],
      }),
    ])

    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({
      pieceId: 'tool-registry-and-capability-gating',
      aliases: ['tool registry'],
      primaryPaths: ['src/tools', 'src/tools/index.ts'],
    })
    expect(pieces[0]?.sources).toHaveLength(2)
  })

  test('keeps similarly named variants separate when their paths do not overlap', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({
        name: 'behavior-audit scripts',
        type: 'analysis-tool',
        declaredPaths: ['scripts/behavior-audit'],
      }),
      baseCandidate({
        name: 'archived behavior-audit variants',
        type: 'experimental-or-legacy-variant',
        status: 'legacy',
        declaredPaths: ['docs/archive/2026-04-17-behavior-audit-incremental-implementation.md'],
      }),
    ])

    expect(pieces).toHaveLength(2)
    expect(pieces.map((piece) => piece.pieceId)).toEqual(
      expect.arrayContaining(['behavior-audit-scripts', 'archived-behavior-audit-variants']),
    )
  })

  test('attaches tests, docs, scripts, and entrypoints by path ownership', () => {
    const [piece] = attachRepositoryAssets(
      buildCanonicalRegistry([
        baseCandidate({
          name: 'behavior-audit scripts',
          type: 'analysis-tool',
          declaredPaths: ['scripts/behavior-audit'],
        }),
      ]),
      {
        sourcePaths: ['scripts/behavior-audit/index.ts', 'scripts/behavior-audit/progress.ts'],
        scriptPaths: ['scripts/behavior-audit/index.ts'],
        testPaths: ['tests/scripts/behavior-audit/entrypoint.test.ts'],
        docPaths: [
          'docs/superpowers/specs/2026-04-27-behavior-audit-phase1-trust-design.md',
          'docs/archive/2026-04-17-behavior-audit-incremental-implementation.md',
        ],
      },
    )

    expect(piece).toMatchObject({
      primaryPaths: ['scripts/behavior-audit'],
      relatedScripts: ['scripts/behavior-audit/index.ts'],
      relatedTests: ['tests/scripts/behavior-audit/entrypoint.test.ts'],
    })
    expect(piece?.relatedDocs).toEqual(
      expect.arrayContaining([
        'docs/superpowers/specs/2026-04-27-behavior-audit-phase1-trust-design.md',
        'docs/archive/2026-04-17-behavior-audit-incremental-implementation.md',
      ]),
    )
    expect(piece?.entrypoints).toEqual(['scripts/behavior-audit/index.ts'])
  })
})
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run: `bun test tests/scripts/architecture-inventory-registry.test.ts`

Expected: FAIL because `scripts/architecture-inventory-registry.ts` does not exist yet.

- [ ] **Step 3: Implement the canonical registry and asset mapping module**

Create `scripts/architecture-inventory-registry.ts`:

```typescript
import type { PieceCandidate, PieceRecord } from './architecture-inventory-model.js'
import { slugifyPieceName } from './architecture-inventory-model.js'

export interface RepositoryAssetMap {
  readonly sourcePaths: readonly string[]
  readonly scriptPaths: readonly string[]
  readonly testPaths: readonly string[]
  readonly docPaths: readonly string[]
}

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)].toSorted()

const pieceKey = (candidate: PieceCandidate): string => `${slugifyPieceName(candidate.name)}:${candidate.type}`

const mergeCandidates = (left: PieceCandidate, right: PieceCandidate): PieceCandidate => ({
  ...left,
  declaredPaths: uniqueStrings([...left.declaredPaths, ...right.declaredPaths]),
  aliases: uniqueStrings([...left.aliases, ...right.aliases]),
  tags: uniqueStrings([...left.tags, ...right.tags]),
  sources: [...left.sources, ...right.sources],
  summary: left.summary.length >= right.summary.length ? left.summary : right.summary,
  status: left.status === 'unclear' ? right.status : left.status,
})

const tokenSetForPiece = (piece: Pick<PieceCandidate, 'name' | 'aliases' | 'tags'>): readonly string[] =>
  uniqueStrings(
    [piece.name, ...piece.aliases, ...piece.tags]
      .flatMap((value) => slugifyPieceName(value).split('-'))
      .filter((token) => token.length >= 4),
  )

const pathMatchesPiece = (piece: PieceRecord, relativePath: string): boolean => {
  const declaredMatch = piece.primaryPaths.some((pathPrefix) => relativePath.startsWith(pathPrefix.replace(/\/$/u, '')))
  if (declaredMatch) return true

  const tokens = tokenSetForPiece(piece)
  return tokens.some((token) => relativePath.includes(token))
}

const entrypointsForPiece = (piece: PieceRecord, assets: Readonly<RepositoryAssetMap>): readonly string[] =>
  uniqueStrings(
    [...assets.sourcePaths, ...assets.scriptPaths].filter(
      (relativePath) =>
        pathMatchesPiece(piece, relativePath) &&
        (/\/index\.(ts|js)$/u.test(relativePath) ||
          ['src/index.ts', 'src/bot.ts', 'codeindex/src/cli.ts'].includes(relativePath)),
    ),
  )

const manualReviewQuestionsFor = (piece: PieceRecord): readonly string[] => {
  const questions = [
    piece.primaryPaths.length === 0 ? `Which source path is the primary owner of ${piece.name}?` : null,
    piece.relatedTests.length === 0 ? `Is ${piece.name} intentionally untested, or is test coverage missing?` : null,
    piece.relatedDocs.length === 0 ? `Should ${piece.name} gain a stable architecture or user-facing document?` : null,
  ].filter((value): value is string => value !== null)

  return questions.length === 0 ? [`Does ${piece.name} still reflect the current architecture boundary?`] : questions
}

export const buildCanonicalRegistry = (candidates: readonly PieceCandidate[]): readonly PieceRecord[] =>
  Object.values(
    candidates.reduce<Record<string, PieceCandidate>>((acc, candidate) => {
      const key = pieceKey(candidate)
      const existing = acc[key]
      return {
        ...acc,
        [key]: existing === undefined ? candidate : mergeCandidates(existing, candidate),
      }
    }, {}),
  )
    .map<PieceRecord>((candidate) => ({
      ...candidate,
      pieceId: slugifyPieceName(candidate.name),
      primaryPaths: uniqueStrings(candidate.declaredPaths),
      secondaryPaths: [],
      entrypoints: [],
      relatedTests: [],
      relatedDocs: [],
      relatedScripts: [],
      configOrEnvDependencies: [],
      runtimeDependencies: [],
      dependents: [],
      signals: [],
      manualReviewQuestions: [],
    }))
    .toSorted((left, right) => left.pieceId.localeCompare(right.pieceId))

export const attachRepositoryAssets = (
  pieces: readonly PieceRecord[],
  assets: Readonly<RepositoryAssetMap>,
): readonly PieceRecord[] =>
  pieces.map((piece) => {
    const relatedScripts = uniqueStrings(
      assets.scriptPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)),
    )
    const relatedTests = uniqueStrings(assets.testPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)))
    const relatedDocs = uniqueStrings(assets.docPaths.filter((relativePath) => pathMatchesPiece(piece, relativePath)))
    const secondaryPaths = uniqueStrings(
      assets.sourcePaths.filter(
        (relativePath) =>
          pathMatchesPiece(piece, relativePath) &&
          !piece.primaryPaths.some((prefix) => relativePath.startsWith(prefix)),
      ),
    )
    const enriched: PieceRecord = {
      ...piece,
      secondaryPaths,
      relatedScripts,
      relatedTests,
      relatedDocs,
      entrypoints: entrypointsForPiece(piece, assets),
    }

    return {
      ...enriched,
      manualReviewQuestions: manualReviewQuestionsFor(enriched),
    }
  })
```

- [ ] **Step 4: Run the registry tests to verify they pass**

Run: `bun test tests/scripts/architecture-inventory-registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the registry module**

```bash
git add tests/scripts/architecture-inventory-registry.test.ts scripts/architecture-inventory-registry.ts
git commit -m "feat: add architecture inventory registry"
```

---

### Task 3: Codeindex Summary Loading And Signal Collection

**Files:**

- Create: `tests/scripts/architecture-inventory-signals.test.ts`
- Create: `scripts/architecture-inventory-signals.ts`

- [ ] **Step 1: Write the failing signal tests**

Create `tests/scripts/architecture-inventory-signals.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import type { PieceRecord } from '../../scripts/architecture-inventory-model.js'
import { collectPieceSignals, loadCodeindexSummary } from '../../scripts/architecture-inventory-signals.js'

const makePiece = (overrides: Partial<PieceRecord>): PieceRecord => ({
  pieceId: 'behavior-audit-scripts',
  name: 'behavior-audit scripts',
  type: 'analysis-tool',
  status: 'experimental',
  summary: 'Behavior-audit workflow scripts.',
  declaredPaths: ['scripts/behavior-audit'],
  aliases: [],
  tags: ['audit'],
  sources: [{ kind: 'filesystem', location: 'scripts/behavior-audit/index.ts' }],
  primaryPaths: ['scripts/behavior-audit'],
  secondaryPaths: ['scripts/behavior-audit/progress.ts'],
  entrypoints: ['scripts/behavior-audit/index.ts'],
  relatedTests: [],
  relatedDocs: ['docs/archive/2026-04-17-behavior-audit-incremental-implementation.md'],
  relatedScripts: ['scripts/behavior-audit/index.ts'],
  configOrEnvDependencies: [],
  runtimeDependencies: [],
  dependents: [],
  signals: [],
  manualReviewQuestions: [],
  ...overrides,
})

describe('architecture inventory signals', () => {
  test('loads indexed files and per-file reference counts from codeindex tables', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE files (id INTEGER PRIMARY KEY, file_path TEXT NOT NULL, parse_status TEXT NOT NULL);
      CREATE TABLE symbol_references (
        id INTEGER PRIMARY KEY,
        source_file_id INTEGER NOT NULL,
        target_symbol_id INTEGER
      );
      INSERT INTO files (id, file_path, parse_status) VALUES
        (1, 'src/tools/index.ts', 'indexed'),
        (2, 'scripts/behavior-audit/index.ts', 'indexed'),
        (3, 'src/providers/types.ts', 'indexed');
      INSERT INTO symbol_references (id, source_file_id, target_symbol_id) VALUES
        (1, 2, 10),
        (2, 2, 11),
        (3, 1, 12);
    `)

    const summary = loadCodeindexSummary(db)

    expect([...summary.indexedFiles]).toEqual([
      'scripts/behavior-audit/index.ts',
      'src/providers/types.ts',
      'src/tools/index.ts',
    ])
    expect(summary.referenceCountsByFile).toEqual({
      'scripts/behavior-audit/index.ts': 2,
      'src/providers/types.ts': 0,
      'src/tools/index.ts': 1,
    })
  })

  test('collects historical, untested, audit-only, and lightly-referenced signals', () => {
    const signals = collectPieceSignals({
      piece: makePiece({}),
      codeindexSummary: {
        indexedFiles: new Set(['scripts/behavior-audit/index.ts', 'scripts/behavior-audit/progress.ts']),
        referenceCountsByFile: {
          'scripts/behavior-audit/index.ts': 1,
          'scripts/behavior-audit/progress.ts': 0,
        },
      },
      providerCapabilities: ['tasks.watchers', 'comments.create'],
      toolKeys: ['create_task', 'search_tasks', 'add_comment'],
    })

    expect(signals.map((signal) => signal.name)).toEqual(
      expect.arrayContaining([
        'no-tests-found',
        'historical-docs-only',
        'audit-only-existence',
        'wired-but-lightly-referenced',
      ]),
    )
  })

  test('marks provider pieces when capabilities exist without matching tool families', () => {
    const signals = collectPieceSignals({
      piece: makePiece({
        pieceId: 'task-provider-adapters',
        name: 'task provider adapters',
        type: 'integration-provider',
        status: 'active',
        primaryPaths: ['src/providers'],
        relatedDocs: ['README.md'],
        relatedTests: ['tests/providers/youtrack/index.test.ts'],
        relatedScripts: [],
        entrypoints: ['src/index.ts'],
      }),
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['tasks.watchers', 'tasks.votes', 'comments.create'],
      toolKeys: ['create_task', 'search_tasks', 'add_comment'],
    })

    const capabilitySignal = signals.find((signal) => signal.name === 'provider-capability-not-surfaced')
    expect(capabilitySignal?.evidence.join(' ')).toContain('tasks.watchers')
    expect(capabilitySignal?.evidence.join(' ')).toContain('tasks.votes')
  })
})
```

- [ ] **Step 2: Run the signal tests to verify they fail**

Run: `bun test tests/scripts/architecture-inventory-signals.test.ts`

Expected: FAIL because `scripts/architecture-inventory-signals.ts` does not exist yet.

- [ ] **Step 3: Implement codeindex summary loading and signal collection**

Create `scripts/architecture-inventory-signals.ts`:

```typescript
import type { Database } from 'bun:sqlite'

import type { PieceRecord, PieceSignal } from './architecture-inventory-model.js'

export interface CodeindexSummary {
  readonly indexedFiles: ReadonlySet<string>
  readonly referenceCountsByFile: Readonly<Record<string, number>>
}

export interface CollectSignalsInput {
  readonly piece: PieceRecord
  readonly codeindexSummary: Readonly<CodeindexSummary>
  readonly providerCapabilities: readonly string[]
  readonly toolKeys: readonly string[]
}

const uniqueSignals = (signals: readonly PieceSignal[]): readonly PieceSignal[] =>
  Object.values(
    signals.reduce<Record<string, PieceSignal>>((acc, signal) => {
      const existing = acc[signal.name]
      if (existing === undefined) {
        return { ...acc, [signal.name]: signal }
      }

      return {
        ...acc,
        [signal.name]: {
          ...existing,
          evidence: [...new Set([...existing.evidence, ...signal.evidence])],
        },
      }
    }, {}),
  )

const nonEmptySignal = (name: PieceSignal['name'], evidence: readonly string[]): readonly PieceSignal[] =>
  evidence.length === 0 ? [] : [{ name, evidence }]

const lower = (value: string): string => value.toLowerCase()

const onlyHistoricalDocs = (docs: readonly string[]): boolean =>
  docs.length > 0 &&
  docs.every((docPath) => docPath.startsWith('docs/archive/') || docPath.startsWith('docs/superpowers/remaining/'))

const onlyPrefixedPaths = (paths: readonly string[], prefix: string): boolean =>
  paths.length > 0 && paths.every((path) => path.startsWith(prefix))

const totalReferenceCount = (piece: PieceRecord, summary: Readonly<CodeindexSummary>): number =>
  [...piece.primaryPaths, ...piece.secondaryPaths].reduce(
    (total, relativePath) => total + (summary.referenceCountsByFile[relativePath] ?? 0),
    0,
  )

const CAPABILITY_TOOL_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'tasks.watchers': ['watcher'],
  'tasks.votes': ['vote'],
  'tasks.visibility': ['visibility'],
  'tasks.count': ['count_tasks'],
  'attachments.upload': ['attachment'],
  'attachments.remove': ['attachment'],
  'workItems.log': ['work'],
  'workItems.update': ['work'],
}

const unsurfacedCapabilities = (
  providerCapabilities: readonly string[],
  toolKeys: readonly string[],
): readonly string[] => {
  const joinedTools = toolKeys.map(lower).join(' ')
  return providerCapabilities.filter((capability) => {
    const requiredKeywords = CAPABILITY_TOOL_KEYWORDS[capability]
    if (requiredKeywords === undefined) {
      return false
    }

    return requiredKeywords.every((keyword) => !joinedTools.includes(lower(keyword)))
  })
}

export const loadCodeindexSummary = (db: Database): CodeindexSummary => {
  const indexedFiles = db
    .query<{ file_path: string }, [string]>('SELECT file_path FROM files WHERE parse_status = ? ORDER BY file_path ASC')
    .all('indexed')
    .map((row) => row.file_path)

  const referenceCountsByFile = Object.fromEntries(
    db
      .query<{ file_path: string; reference_count: number }, []>(
        `SELECT files.file_path AS file_path,
                COUNT(symbol_references.id) AS reference_count
         FROM files
         LEFT JOIN symbol_references ON symbol_references.source_file_id = files.id
         WHERE files.parse_status = 'indexed'
         GROUP BY files.file_path
         ORDER BY files.file_path ASC`,
      )
      .all()
      .map((row) => [row.file_path, row.reference_count] as const),
  )

  return {
    indexedFiles: new Set(indexedFiles),
    referenceCountsByFile,
  }
}

export const collectPieceSignals = (input: Readonly<CollectSignalsInput>): readonly PieceSignal[] => {
  const referenceCount = totalReferenceCount(input.piece, input.codeindexSummary)
  const providerSurfaceGaps =
    input.piece.type === 'integration-provider'
      ? unsurfacedCapabilities(input.providerCapabilities, input.toolKeys)
      : []

  return uniqueSignals([
    ...nonEmptySignal(
      'no-current-runtime-entrypoint',
      input.piece.type === 'runtime-subsystem' || input.piece.type === 'product-feature'
        ? input.piece.entrypoints.length === 0
          ? [`${input.piece.name} has no runtime entrypoints.`]
          : []
        : [],
    ),
    ...nonEmptySignal(
      'no-current-script-entrypoint',
      input.piece.type === 'analysis-tool' || input.piece.type === 'developer-workflow'
        ? input.piece.relatedScripts.length === 0
          ? [`${input.piece.name} has no current script entrypoint.`]
          : []
        : [],
    ),
    ...nonEmptySignal(
      'no-tests-found',
      input.piece.relatedTests.length === 0 ? [`${input.piece.name} has no related tests.`] : [],
    ),
    ...nonEmptySignal(
      'no-current-docs-found',
      input.piece.relatedDocs.length === 0 ? [`${input.piece.name} has no current docs.`] : [],
    ),
    ...nonEmptySignal(
      'historical-docs-only',
      onlyHistoricalDocs(input.piece.relatedDocs)
        ? [`${input.piece.name} is only documented in archived or remaining docs.`]
        : [],
    ),
    ...nonEmptySignal(
      'script-only-existence',
      onlyPrefixedPaths(input.piece.primaryPaths, 'scripts/')
        ? [`${input.piece.name} only exists under scripts/.`]
        : [],
    ),
    ...nonEmptySignal(
      'benchmark-only-existence',
      input.piece.tags.includes('benchmark') || input.piece.primaryPaths.every((path) => path.includes('benchmark'))
        ? [`${input.piece.name} appears benchmark-only.`]
        : [],
    ),
    ...nonEmptySignal(
      'audit-only-existence',
      input.piece.tags.includes('audit') || input.piece.primaryPaths.every((path) => path.includes('behavior-audit'))
        ? [`${input.piece.name} appears audit-only.`]
        : [],
    ),
    ...nonEmptySignal(
      'declared-but-not-wired',
      input.piece.primaryPaths.length > 0 && input.piece.entrypoints.length === 0 && input.piece.dependents.length === 0
        ? [`${input.piece.name} is declared but no activation or dependents were attached.`]
        : [],
    ),
    ...nonEmptySignal(
      'wired-but-lightly-referenced',
      input.piece.entrypoints.length > 0 && referenceCount <= 1
        ? [`${input.piece.name} has entrypoints but only ${referenceCount} codeindex references across owned paths.`]
        : [],
    ),
    ...nonEmptySignal(
      'status-unclear',
      input.piece.status === 'unclear' ? [`${input.piece.name} is marked unclear.`] : [],
    ),
    ...nonEmptySignal(
      'provider-capability-not-surfaced',
      providerSurfaceGaps.map(
        (capability) => `${input.piece.name} exposes ${capability} without a matching tool family.`,
      ),
    ),
  ])
}
```

- [ ] **Step 4: Run the signal tests to verify they pass**

Run: `bun test tests/scripts/architecture-inventory-signals.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the signal module**

```bash
git add tests/scripts/architecture-inventory-signals.test.ts scripts/architecture-inventory-signals.ts
git commit -m "feat: add architecture inventory signals"
```

---

### Task 4: Report Rendering, CLI Orchestration, And Package Script

**Files:**

- Create: `tests/scripts/architecture-inventory-report.test.ts`
- Create: `tests/scripts/architecture-inventory.test.ts`
- Create: `scripts/architecture-inventory-report.ts`
- Create: `scripts/architecture-inventory.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing report and orchestration tests**

Create `tests/scripts/architecture-inventory-report.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { PieceRecord } from '../../scripts/architecture-inventory-model.js'
import {
  buildInventoryOutputFiles,
  renderCandidateReviewQueue,
  renderPieceDossier,
} from '../../scripts/architecture-inventory-report.js'

const makePiece = (overrides: Partial<PieceRecord>): PieceRecord => ({
  pieceId: 'message-queue',
  name: 'message queue',
  type: 'runtime-subsystem',
  status: 'active',
  summary: 'Queued prompt handling.',
  declaredPaths: ['src/message-queue'],
  aliases: [],
  tags: ['queue'],
  sources: [{ kind: 'filesystem', location: 'src/message-queue' }],
  primaryPaths: ['src/message-queue'],
  secondaryPaths: ['src/bot.ts'],
  entrypoints: ['src/bot.ts'],
  relatedTests: ['tests/utils/message-queue.test.ts'],
  relatedDocs: ['README.md'],
  relatedScripts: [],
  configOrEnvDependencies: [],
  runtimeDependencies: ['bot runtime and startup'],
  dependents: ['tool registry and capability gating'],
  signals: [],
  manualReviewQuestions: ['Does this still match the current queue boundary?'],
  ...overrides,
})

describe('architecture inventory reporting', () => {
  test('renders a piece dossier with required sections', () => {
    const markdown = renderPieceDossier(
      makePiece({
        signals: [
          {
            name: 'wired-but-lightly-referenced',
            evidence: ['message queue has entrypoints but only 1 codeindex references across owned paths.'],
          },
        ],
      }),
    )

    expect(markdown).toContain('# message queue')
    expect(markdown).toContain('## Type')
    expect(markdown).toContain('## Entrypoints And Activation')
    expect(markdown).toContain('## Deletion-Candidate Signals')
    expect(markdown).toContain('wired-but-lightly-referenced')
  })

  test('sorts the review queue by ambiguity and signal density', () => {
    const queue = renderCandidateReviewQueue([
      makePiece({
        pieceId: 'legacy-thing',
        name: 'legacy thing',
        status: 'unclear',
        signals: [{ name: 'status-unclear', evidence: ['unclear'] }],
      }),
      makePiece({
        pieceId: 'script-only-tool',
        name: 'script only tool',
        type: 'analysis-tool',
        signals: [
          { name: 'script-only-existence', evidence: ['script only'] },
          { name: 'no-tests-found', evidence: ['no tests'] },
        ],
      }),
    ])

    expect(queue.indexOf('legacy thing')).toBeLessThan(queue.indexOf('script only tool'))
  })

  test('builds the full output file set', () => {
    const files = buildInventoryOutputFiles({
      generatedAt: '2026-05-11T12:00:00.000Z',
      pieces: [
        makePiece({}),
        makePiece({ pieceId: 'tool-registry', name: 'tool registry', primaryPaths: ['src/tools'] }),
      ],
    })

    expect(files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        'inventory.md',
        'inventory.json',
        'candidate-review-queue.md',
        'overlap-matrix.md',
        'orphan-matrix.md',
        'docs-code-mismatch.md',
        'test-presence-report.md',
        'pieces/message-queue.md',
      ]),
    )
  })
})
```

Create `tests/scripts/architecture-inventory.test.ts`:

```typescript
import { describe, expect, mock, test } from 'bun:test'

import {
  parseArchitectureInventoryArgs,
  runArchitectureInventory,
  type ArchitectureInventoryDeps,
} from '../../scripts/architecture-inventory.js'

describe('architecture inventory CLI', () => {
  test('parses repo root, output dir, and skip-reindex flag', () => {
    expect(
      parseArchitectureInventoryArgs([
        '--repo-root',
        '/tmp/papai',
        '--output-dir',
        'docs/architecture-smoke',
        '--skip-codeindex-reindex',
      ]),
    ).toEqual({
      repoRoot: '/tmp/papai',
      outputDir: 'docs/architecture-smoke',
      reindexCodeindex: false,
    })
  })

  test('orchestrates reads, optional reindex, and output writes', async () => {
    const writes: Array<{ path: string; content: string }> = []
    const deps: ArchitectureInventoryDeps = {
      readTextFile: (filePath) =>
        Promise.resolve(
          filePath.endsWith('package.json')
            ? JSON.stringify({
                workspaces: ['codeindex'],
                scripts: { 'audit:behavior': 'bun scripts/behavior-audit/index.ts' },
              })
            : '',
        ),
      listRelativePaths: () =>
        Promise.resolve([
          'src/index.ts',
          'src/bot.ts',
          'src/tools/index.ts',
          'src/providers/types.ts',
          'scripts/behavior-audit/index.ts',
          'tests/scripts/behavior-audit/entrypoint.test.ts',
        ]),
      mkdirp: () => Promise.resolve(),
      writeTextFile: (filePath, content) => {
        writes.push({ path: filePath, content })
        return Promise.resolve()
      },
      runCodeindexReindex: mock(async () => undefined),
      openCodeindexDb: () =>
        ({
          query: () => ({ all: () => [], get: () => null }),
          close: () => undefined,
        }) as never,
    }

    await runArchitectureInventory(
      { repoRoot: '/tmp/papai', outputDir: 'docs/architecture', reindexCodeindex: true },
      deps,
    )

    expect(deps.runCodeindexReindex).toHaveBeenCalledTimes(1)
    expect(writes.map((write) => write.path)).toEqual(
      expect.arrayContaining([
        '/tmp/papai/docs/architecture/inventory.md',
        '/tmp/papai/docs/architecture/inventory.json',
        '/tmp/papai/docs/architecture/candidate-review-queue.md',
      ]),
    )
  })
})
```

- [ ] **Step 2: Run the report and CLI tests to verify they fail**

Run:

```bash
bun test tests/scripts/architecture-inventory-report.test.ts tests/scripts/architecture-inventory.test.ts
```

Expected: FAIL because `scripts/architecture-inventory-report.ts` and `scripts/architecture-inventory.ts` do not exist yet.

- [ ] **Step 3: Implement the report renderer and CLI entrypoint**

Create `scripts/architecture-inventory-report.ts`:

```typescript
import type { PieceRecord } from './architecture-inventory-model.js'

export interface InventoryOutputFile {
  readonly relativePath: string
  readonly content: string
}

export interface BuildInventoryOutputInput {
  readonly generatedAt: string
  readonly pieces: readonly PieceRecord[]
}

const signalCount = (piece: PieceRecord): number => piece.signals.length

const reviewRank = (piece: PieceRecord): number => {
  const unclearScore = piece.status === 'unclear' ? 100 : 0
  const overlapScore = piece.signals.some((signal) => signal.name === 'overlapping-implementation-detected') ? 50 : 0
  return unclearScore + overlapScore + signalCount(piece)
}

const listOrNone = (values: readonly string[]): string => (values.length === 0 ? '_None._' : values.map((value) => `- ${value}`).join('\n'))

export const renderPieceDossier = (piece: PieceRecord): string =>
  [
    `# ${piece.name}`,
    '',
    '## Type',
    '',
    piece.type,
    '',
    '## Status',
    '',
    piece.status,
    '',
    '## Summary',
    '',
    piece.summary,
    '',
    '## Why It Exists',
    '',
    piece.sources.map((source) => `- ${source.kind}: ${source.location}`).join('\n'),
    '',
    '## Primary Paths',
    '',
    listOrNone(piece.primaryPaths),
    '',
    '## Secondary Paths',
    '',
    listOrNone(piece.secondaryPaths),
    '',
    '## Entrypoints And Activation',
    '',
    listOrNone(piece.entrypoints),
    '',
    '## Runtime And Config Dependencies',
    '',
    listOrNone([...piece.runtimeDependencies, ...piece.configOrEnvDependencies]),
    '',
    '## Related Tests',
    '',
    listOrNone(piece.relatedTests),
    '',
    '## Related Docs',
    '',
    listOrNone(piece.relatedDocs),
    '',
    '## Dependents And Consumers',
    '',
    listOrNone(piece.dependents),
    '',
    '## Variants Or Overlapping Pieces',
    '',
    listOrNone(piece.signals.filter((signal) => signal.name === 'variant-with-same-purpose').flatMap((signal) => signal.evidence)),
    '',
    '## Deletion-Candidate Signals',
    '',
    piece.signals.length === 0
      ? '- no concerning signals currently observed'
      : piece.signals.map((signal) => [`- `${signal.name}``, ...signal.evidence.map((evidence) => `  - ${evidence}`)].join('\n')).join('\n'),
    '',
    '## Open Questions For Manual Review',
    '',
    listOrNone(piece.manualReviewQuestions),
    '',
  ].join('\n')

export const renderCandidateReviewQueue = (pieces: readonly PieceRecord[]): string => {
  const rows = [...pieces]
    .filter((piece) => piece.signals.length > 0)
    .toSorted((left, right) => reviewRank(right) - reviewRank(left) || left.pieceId.localeCompare(right.pieceId))
    .map(
      (piece) =>
        `| ${piece.name} | ${piece.type} | ${piece.status} | ${piece.signals.map((signal) => signal.name).join(', ')} | pieces/${piece.pieceId}.md |`,
    )

  return [
    '# Candidate Review Queue',
    '',
    '| Piece | Type | Status | Signals | Dossier |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

const renderInventoryIndex = (input: Readonly<BuildInventoryOutputInput>): string => {
  const rows = input.pieces.map(
    (piece) =>
      `| ${piece.name} | ${piece.type} | ${piece.status} | ${piece.primaryPaths.join(', ') || '_none_'} | pieces/${piece.pieceId}.md |`,
  )

  return [
    '# Architecture Inventory',
    '',
    `Generated: ${input.generatedAt}`,
    '',
    '| Piece | Type | Status | Primary Paths | Dossier |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

const renderSimpleMatrix = (title: string, pieces: readonly PieceRecord[], filter: (piece: PieceRecord) => boolean): string =>
  [
    `# ${title}`,
    '',
    '| Piece | Status | Notes |',
    '| --- | --- | --- |',
    ...pieces.filter(filter).map((piece) => `| ${piece.name} | ${piece.status} | ${piece.signals.map((signal) => signal.name).join(', ') || 'none'} |`),
    '',
  ].join('\n')

export const buildInventoryOutputFiles = (input: Readonly<BuildInventoryOutputInput>): readonly InventoryOutputFile[] => [
  {
    relativePath: 'inventory.md',
    content: renderInventoryIndex(input),
  },
  {
    relativePath: 'inventory.json',
    content: `${JSON.stringify(input, null, 2)}\n`,
  },
  {
    relativePath: 'candidate-review-queue.md',
    content: renderCandidateReviewQueue(input.pieces),
  },
  {
    relativePath: 'overlap-matrix.md',
    content: renderSimpleMatrix('Overlap Matrix', input.pieces, (piece) =>
      piece.signals.some((signal) => signal.name === 'overlapping-implementation-detected' || signal.name === 'variant-with-same-purpose'),
    ),
  },
  {
    relativePath: 'orphan-matrix.md',
    content: renderSimpleMatrix('Orphan Matrix', input.pieces, (piece) => piece.entrypoints.length === 0 && piece.dependents.length === 0),
  },
  {
    relativePath: 'docs-code-mismatch.md',
    content: renderSimpleMatrix('Docs Code Mismatch', input.pieces, (piece) =>
      piece.signals.some((signal) => signal.name === 'docs-code-mismatch' || signal.name === 'historical-docs-only'),
    ),
  },
  {
    relativePath: 'test-presence-report.md',
    content: renderSimpleMatrix('Test Presence Report', input.pieces, (piece) => piece.relatedTests.length === 0),
  },
  ...input.pieces.map((piece) => ({
    relativePath: `pieces/${piece.pieceId}.md`,
    content: renderPieceDossier(piece),
  })),
]
```

Create `scripts/architecture-inventory.ts`:

```typescript
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Database } from 'bun:sqlite'

import { discoverFilesystemPieceCandidates, extractTopDownPieceCandidates } from './architecture-inventory-discovery.js'
import { buildInventoryOutputFiles } from './architecture-inventory-report.js'
import { attachRepositoryAssets, buildCanonicalRegistry } from './architecture-inventory-registry.js'
import { collectPieceSignals, loadCodeindexSummary } from './architecture-inventory-signals.js'

export interface ArchitectureInventoryArgs {
  readonly repoRoot: string
  readonly outputDir: string
  readonly reindexCodeindex: boolean
}

export interface ArchitectureInventoryDeps {
  readonly readTextFile: (filePath: string) => Promise<string>
  readonly listRelativePaths: (repoRoot: string) => Promise<readonly string[]>
  readonly mkdirp: (dirPath: string) => Promise<void>
  readonly writeTextFile: (filePath: string, content: string) => Promise<void>
  readonly runCodeindexReindex: (repoRoot: string) => Promise<void>
  readonly openCodeindexDb: (dbPath: string) => Database
}

const defaultDeps: ArchitectureInventoryDeps = {
  readTextFile: (filePath) => readFile(filePath, 'utf-8'),
  listRelativePaths: async (repoRoot) => {
    const walk = async (dirPath: string): Promise<readonly string[]> => {
      const entries = await readdir(dirPath, { withFileTypes: true })
      const childPaths = await Promise.all(
        entries.map(async (entry): Promise<readonly string[]> => {
          const absolutePath = path.join(dirPath, entry.name)
          if (entry.isDirectory()) {
            return walk(absolutePath)
          }

          return [path.relative(repoRoot, absolutePath).split(path.sep).join('/')]
        }),
      )

      return childPaths.flat()
    }

    return walk(repoRoot)
  },
  mkdirp: (dirPath) => mkdir(dirPath, { recursive: true }),
  writeTextFile: (filePath, content) => writeFile(filePath, content, 'utf-8'),
  runCodeindexReindex: async (repoRoot) => {
    const proc = Bun.spawn(['bun', 'run', 'codeindex/src/cli.ts', 'reindex'], {
      cwd: repoRoot,
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || 'codeindex reindex failed')
    }
  },
  openCodeindexDb: (dbPath) => new Database(dbPath, { readonly: true }),
}

export const parseArchitectureInventoryArgs = (args: readonly string[]): ArchitectureInventoryArgs => {
  const flagValue = (flag: string): string => {
    const index = args.indexOf(flag)
    const value = index === -1 ? undefined : args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`)
    }
    return value
  }

  return {
    repoRoot: args.includes('--repo-root') ? flagValue('--repo-root') : process.cwd(),
    outputDir: args.includes('--output-dir') ? flagValue('--output-dir') : 'docs/architecture',
    reindexCodeindex: !args.includes('--skip-codeindex-reindex'),
  }
}

const byPrefix = (relativePaths: readonly string[], prefix: string): readonly string[] =>
  relativePaths.filter((relativePath) => relativePath.startsWith(prefix)).toSorted()

const extractCapabilityStrings = (source: string): readonly string[] =>
  [...source.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((match) => match[1] ?? '').filter((value) => value.length > 0)

const extractToolKeys = (source: string): readonly string[] =>
  [...source.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? '').filter((value) => value.includes('_'))

export const runArchitectureInventory = async (
  args: Readonly<ArchitectureInventoryArgs>,
  deps: ArchitectureInventoryDeps = defaultDeps,
): Promise<void> => {
  if (args.reindexCodeindex) {
    await deps.runCodeindexReindex(args.repoRoot)
  }

  const [readme, claude, roadmap, packageJsonText, providerTypes, toolClaude] = await Promise.all([
    deps.readTextFile(path.join(args.repoRoot, 'README.md')),
    deps.readTextFile(path.join(args.repoRoot, 'CLAUDE.md')),
    deps.readTextFile(path.join(args.repoRoot, 'docs/ROADMAP.md')),
    deps.readTextFile(path.join(args.repoRoot, 'package.json')),
    deps.readTextFile(path.join(args.repoRoot, 'src/providers/types.ts')),
    deps.readTextFile(path.join(args.repoRoot, 'src/tools/CLAUDE.md')),
  ])
  const packageJson = JSON.parse(packageJsonText) as Readonly<{
    workspaces?: readonly string[]
    scripts?: Readonly<Record<string, string>>
  }>
  const relativePaths = await deps.listRelativePaths(args.repoRoot)

  const candidates = [
    ...extractTopDownPieceCandidates({ readme, claude, roadmap, packageJson }),
    ...discoverFilesystemPieceCandidates({
      topLevelEntries: uniqueTopLevelDirectories(relativePaths),
      srcEntries: byPrefix(relativePaths, 'src/').filter((entry) => entry.split('/').length <= 2),
      clientEntries: byPrefix(relativePaths, 'client/').filter((entry) => entry.split('/').length <= 2),
      scriptEntries: byPrefix(relativePaths, 'scripts/'),
      testEntries: byPrefix(relativePaths, 'tests/'),
      historicalDocEntries: byPrefix(relativePaths, 'docs/archive/').concat(
        byPrefix(relativePaths, 'docs/superpowers/remaining/'),
      ),
    }),
  ]

  const registry = attachRepositoryAssets(buildCanonicalRegistry(candidates), {
    sourcePaths: relativePaths.filter(
      (relativePath) =>
        relativePath.startsWith('src/') ||
        relativePath.startsWith('client/') ||
        relativePath.startsWith('codeindex/') ||
        relativePath.startsWith('review-loop/'),
    ),
    scriptPaths: byPrefix(relativePaths, 'scripts/'),
    testPaths: byPrefix(relativePaths, 'tests/'),
    docPaths: relativePaths.filter(
      (relativePath) =>
        relativePath === 'README.md' || relativePath.startsWith('docs/') || relativePath === 'CLAUDE.md',
    ),
  })

  const codeindexDb = deps.openCodeindexDb(path.join(args.repoRoot, '.codeindex', 'index.db'))
  const codeindexSummary = loadCodeindexSummary(codeindexDb)
  codeindexDb.close()

  const providerCapabilities = extractCapabilityStrings(providerTypes)
  const toolKeys = extractToolKeys(toolClaude)
  const piecesWithSignals = registry.map((piece) => ({
    ...piece,
    signals: collectPieceSignals({ piece, codeindexSummary, providerCapabilities, toolKeys }),
  }))

  const outputFiles = buildInventoryOutputFiles({
    generatedAt: new Date().toISOString(),
    pieces: piecesWithSignals,
  })

  await Promise.all(
    outputFiles.map(async (file) => {
      const absolutePath = path.join(args.repoRoot, args.outputDir, file.relativePath)
      await deps.mkdirp(path.dirname(absolutePath))
      await deps.writeTextFile(absolutePath, file.content)
    }),
  )
}

const uniqueTopLevelDirectories = (relativePaths: readonly string[]): readonly string[] =>
  [
    ...new Set(
      relativePaths.map((relativePath) => relativePath.split('/')[0] ?? '').filter((value) => value.length > 0),
    ),
  ].toSorted()

if (process.argv[1] === import.meta.filename) {
  const args = parseArchitectureInventoryArgs(Bun.argv.slice(2))
  await runArchitectureInventory(args).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
```

Update `package.json` to add the root script near the existing audit and benchmark entries:

```json
{
  "scripts": {
    "audit:behavior": "bun scripts/behavior-audit/index.ts",
    "inventory:architecture": "bun scripts/architecture-inventory.ts",
    "benchmark:tool-surface": "bun scripts/tool-surface-benchmark.ts"
  }
}
```

- [ ] **Step 4: Run the report and CLI tests to verify they pass**

Run:

```bash
bun test tests/scripts/architecture-inventory-report.test.ts tests/scripts/architecture-inventory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the report, CLI, and package script changes**

```bash
git add tests/scripts/architecture-inventory-report.test.ts tests/scripts/architecture-inventory.test.ts scripts/architecture-inventory-report.ts scripts/architecture-inventory.ts package.json
git commit -m "feat: add architecture inventory generator"
```

---

### Task 5: Final Verification And Smoke Run

**Files:**

- Modify only files required to fix verification failures.

- [ ] **Step 1: Run the full targeted script test set**

Run:

```bash
bun test tests/scripts/architecture-inventory-discovery.test.ts tests/scripts/architecture-inventory-registry.test.ts tests/scripts/architecture-inventory-signals.test.ts tests/scripts/architecture-inventory-report.test.ts tests/scripts/architecture-inventory.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run type checking**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint for the touched implementation files**

Run:

```bash
bun lint:agent-strict -- scripts/architecture-inventory-model.ts scripts/architecture-inventory-discovery.ts scripts/architecture-inventory-registry.ts scripts/architecture-inventory-signals.ts scripts/architecture-inventory-report.ts scripts/architecture-inventory.ts
```

Expected: PASS.

- [ ] **Step 4: Run formatting check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 5: Run the inventory generator against a temporary output directory**

Run:

```bash
bun inventory:architecture -- --skip-codeindex-reindex --output-dir "/var/folders/bb/4_lkm1wx25q1vtz97xy66hd40000gn/T/opencode/architecture-inventory-smoke"
```

Expected:

- exit code `0`
- generated files under `/var/folders/bb/4_lkm1wx25q1vtz97xy66hd40000gn/T/opencode/architecture-inventory-smoke/`
- includes `inventory.md`, `inventory.json`, `candidate-review-queue.md`, and at least one `pieces/*.md` file

- [ ] **Step 6: Scan touched files for forbidden suppressions**

Run:

```bash
rg "eslint-disable|oxlint-disable|@ts-ignore|@ts-nocheck" scripts/architecture-inventory*.ts tests/scripts/architecture-inventory*.test.ts
```

Expected: no matches.

- [ ] **Step 7: Commit final fixes if verification changed files**

```bash
git add scripts/architecture-inventory-model.ts scripts/architecture-inventory-discovery.ts scripts/architecture-inventory-registry.ts scripts/architecture-inventory-signals.ts scripts/architecture-inventory-report.ts scripts/architecture-inventory.ts tests/scripts/architecture-inventory-discovery.test.ts tests/scripts/architecture-inventory-registry.test.ts tests/scripts/architecture-inventory-signals.test.ts tests/scripts/architecture-inventory-report.test.ts tests/scripts/architecture-inventory.test.ts package.json
git commit -m "fix: verify architecture inventory generator"
```

Only create this commit if verification required code changes. If no files changed, skip this step.

---

## Spec Coverage Check

- Canonical taxonomy, statuses, mandatory families, and stable piece identifiers are implemented in Task 1.
- Top-down and bottom-up discovery are implemented in Task 1.
- Canonical registry normalization, ownership mapping, and related asset attachment are implemented in Task 2.
- Codeindex-backed evidence loading and non-destructive signal collection are implemented in Task 3.
- Inventory index, candidate review queue, matrices, dossiers, and `inventory.json` output are implemented in Task 4.
- Root CLI orchestration, optional codeindex reindexing, and `package.json` script wiring are implemented in Task 4.
- Fresh verification, smoke generation, lint, format, and forbidden-pattern scanning are enforced in Task 5.
