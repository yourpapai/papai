// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  discoverFilesystemPieceCandidates,
  extractTopDownPieceCandidates,
} from '../../scripts/architecture-inventory-discovery.js'
import {
  MANDATORY_SCOPE_FAMILIES,
  PIECE_STATUSES,
  PIECE_TYPES,
  SIGNAL_NAMES,
  slugifyPieceName,
} from '../../scripts/architecture-inventory-model.js'

const expectNamesToInclude = (actualNames: readonly string[], expectedNames: readonly string[]): void => {
  for (const expectedName of expectedNames) {
    expect(actualNames).toContain(expectedName)
  }
}

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
    expect(SIGNAL_NAMES).toEqual([
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
    ])
    expect(slugifyPieceName('Debug Server and Dashboard Client')).toBe('debug-server-and-dashboard-client')
    expectNamesToInclude(
      MANDATORY_SCOPE_FAMILIES.map((piece) => piece.name),
      [
        'bot runtime and startup',
        'chat provider adapters',
        'task provider adapters',
        'tool registry and capability gating',
        'codeindex workspace',
        'review-loop workspace',
        'behavior-audit scripts',
      ],
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
        workspaces: ['codeindex', 'review-loop', 'experiments-lab'],
        scripts: {
          'audit:behavior': 'bun scripts/behavior-audit/index.ts',
          'benchmark:tool-surface': 'bun scripts/tool-surface-benchmark.ts',
          'codeindex:test': 'bun run --filter codeindex test',
          duplicates: 'bun run scripts/detect-duplicates.ts',
        },
      },
    })

    expectNamesToInclude(
      pieces.map((piece) => piece.name),
      [
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
        'benchmark scripts',
      ],
    )
    expect(pieces.map((piece) => piece.name)).not.toContain('duplicates')
    expect(pieces.map((piece) => piece.name)).not.toContain('experiments-lab workspace')
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

    expectNamesToInclude(
      pieces.map((piece) => piece.name),
      [
        'bot runtime and startup',
        'tool registry and capability gating',
        'task provider adapters',
        'message queue',
        'identity mapping',
        'web fetch',
        'debug server and dashboard client',
        'ADR planning workflow',
        'client build workflow',
        'benchmark scripts',
        'behavior-audit scripts',
        'provider capability architecture',
      ],
    )

    expect(pieces.find((piece) => piece.name === 'provider capability architecture')?.status).toBe('legacy')
  })
})
