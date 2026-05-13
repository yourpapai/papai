import { describe, expect, test } from 'bun:test'

import type { PieceCandidate, PieceRecord } from '../../scripts/architecture-inventory-model.js'
import { attachRepositoryAssets, buildCanonicalRegistry } from '../../scripts/architecture-inventory-registry.js'

const expectStringArraysToContain = (
  actualValues: readonly (readonly string[])[],
  expectedValues: readonly (readonly string[])[],
): void => {
  for (const expectedValue of expectedValues) {
    expect(actualValues).toContainEqual(expectedValue)
  }
}

const expectStringsToContain = (actualValues: readonly string[], expectedValues: readonly string[]): void => {
  for (const expectedValue of expectedValues) {
    expect(actualValues).toContain(expectedValue)
  }
}

const requirePiece = (piece: PieceRecord | undefined): PieceRecord => {
  expect(piece).toBeDefined()
  if (piece === undefined) {
    throw new Error('Expected piece to be defined')
  }
  return piece
}

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

  test('keeps same-named candidates separate when ownership boundaries do not align', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/tool-surface-benchmark.ts'],
        status: 'experimental',
        tags: ['benchmark'],
      }),
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/benchmarks/tool-surface-scenarios.ts'],
        status: 'legacy',
        tags: ['benchmark'],
      }),
    ])

    expect(pieces).toHaveLength(2)
    expectStringArraysToContain(
      pieces.map((piece) => piece.primaryPaths),
      [['scripts/tool-surface-benchmark.ts'], ['scripts/benchmarks/tool-surface-scenarios.ts']],
    )
  })

  test('marks merged candidates unclear when overlapping evidence conflicts on status', () => {
    const [piece] = buildCanonicalRegistry([
      baseCandidate({
        status: 'active',
        declaredPaths: ['src/tools'],
      }),
      baseCandidate({
        status: 'legacy',
        declaredPaths: ['src/tools/index.ts'],
        sources: [{ kind: 'filesystem', location: 'src/tools/index.ts' }],
      }),
    ])

    expect(piece?.status).toBe('unclear')
  })

  test('keeps same-name candidates separate when neither side has boundary evidence', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({
        name: 'recurring tasks',
        type: 'product-feature',
        declaredPaths: [],
        status: 'active',
        sources: [{ kind: 'roadmap', location: 'Phase 8' }],
      }),
      baseCandidate({
        name: 'recurring tasks',
        type: 'product-feature',
        declaredPaths: [],
        status: 'experimental',
        sources: [{ kind: 'claude', location: 'CLAUDE.md' }],
      }),
    ])

    expect(pieces).toHaveLength(2)
    expectStringsToContain(
      pieces.map((piece) => piece.status),
      ['active', 'experimental'],
    )
  })

  test('merges a pathless mention when exactly one concrete variant exists', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/tool-surface-benchmark.ts'],
        status: 'experimental',
      }),
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: [],
        status: 'active',
        sources: [{ kind: 'roadmap', location: 'Phase benchmark mention' }],
      }),
    ])

    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.primaryPaths).toEqual(['scripts/tool-surface-benchmark.ts'])
    expect(pieces[0]?.status).toBe('unclear')
  })

  test('does not assign a pathless mention to one concrete variant when multiple variants exist', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/tool-surface-benchmark.ts'],
        status: 'experimental',
        sources: [{ kind: 'filesystem', location: 'scripts/tool-surface-benchmark.ts' }],
      }),
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/benchmarks/tool-surface-scenarios.ts'],
        status: 'legacy',
        sources: [{ kind: 'archive-doc', location: 'docs/archive/tool-surface.md' }],
      }),
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: [],
        status: 'active',
        sources: [{ kind: 'roadmap', location: 'Phase benchmark mention' }],
      }),
    ])

    expect(pieces).toHaveLength(3)
    expect(pieces.map((piece) => piece.primaryPaths)).toContainEqual([])
  })

  test('keeps a pathless mention separate when a second concrete variant appears later', () => {
    const pieces = buildCanonicalRegistry([
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/tool-surface-benchmark.ts'],
        status: 'experimental',
      }),
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: [],
        status: 'active',
        sources: [{ kind: 'roadmap', location: 'Phase benchmark mention' }],
      }),
      baseCandidate({
        name: 'tool-surface benchmark',
        type: 'analysis-tool',
        declaredPaths: ['scripts/benchmarks/tool-surface-scenarios.ts'],
        status: 'legacy',
      }),
    ])

    expect(pieces).toHaveLength(3)
    expect(pieces.map((piece) => piece.primaryPaths)).toContainEqual([])
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
    expectStringsToContain(
      pieces.map((piece) => piece.pieceId),
      ['behavior-audit-scripts', 'archived-behavior-audit-variants'],
    )
  })

  test('attaches tests, docs, scripts, source files, and entrypoints by path ownership', () => {
    const [piece] = attachRepositoryAssets(
      buildCanonicalRegistry([
        baseCandidate({
          name: 'behavior-audit scripts',
          type: 'analysis-tool',
          declaredPaths: ['scripts/behavior-audit'],
          tags: ['audit'],
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

    const resolvedPiece = requirePiece(piece)
    const relatedDocs = resolvedPiece.relatedDocs

    expect(resolvedPiece).toMatchObject({
      primaryPaths: ['scripts/behavior-audit'],
      secondaryPaths: ['scripts/behavior-audit/index.ts', 'scripts/behavior-audit/progress.ts'],
      relatedScripts: ['scripts/behavior-audit/index.ts'],
      relatedTests: ['tests/scripts/behavior-audit/entrypoint.test.ts'],
    })
    expectStringsToContain(relatedDocs, [
      'docs/superpowers/specs/2026-04-27-behavior-audit-phase1-trust-design.md',
      'docs/archive/2026-04-17-behavior-audit-incremental-implementation.md',
    ])
    expect(resolvedPiece.entrypoints).toEqual(['scripts/behavior-audit/index.ts'])
  })

  test('infers named script entrypoints when the owned script is not an index file', () => {
    const [piece] = attachRepositoryAssets(
      buildCanonicalRegistry([
        baseCandidate({
          name: 'client build workflow',
          type: 'developer-workflow',
          declaredPaths: ['scripts/build-client.ts'],
          tags: ['workflow'],
        }),
      ]),
      {
        sourcePaths: ['scripts/build-client.ts'],
        scriptPaths: ['scripts/build-client.ts'],
        testPaths: ['tests/scripts/build-client.test.ts'],
        docPaths: [],
      },
    )

    expect(piece?.entrypoints).toEqual(['scripts/build-client.ts'])
  })

  test('does not attach unrelated assets through generic token collisions', () => {
    const [piece] = attachRepositoryAssets(
      buildCanonicalRegistry([
        baseCandidate({
          name: 'release workflow',
          type: 'developer-workflow',
          declaredPaths: [],
          aliases: ['workflow'],
          tags: ['workflow'],
        }),
      ]),
      {
        sourcePaths: ['src/tools/index.ts', 'review-loop/src/workflow-runner.ts'],
        scriptPaths: ['scripts/build-client.ts'],
        testPaths: ['tests/scripts/build-client.test.ts'],
        docPaths: ['docs/architecture/review-loop-workflow.md'],
      },
    )

    expect(piece).toMatchObject({
      secondaryPaths: [],
      relatedScripts: [],
      relatedTests: [],
      relatedDocs: [],
      entrypoints: [],
    })
  })

  test('requires stronger fallback token evidence than a single common token', () => {
    const [piece] = attachRepositoryAssets(
      buildCanonicalRegistry([
        baseCandidate({
          name: 'identity mapping',
          type: 'product-feature',
          declaredPaths: [],
          tags: ['identity', 'mapping'],
        }),
      ]),
      {
        sourcePaths: ['src/chat/identity-provider.ts', 'src/utils/id-mapping.ts'],
        scriptPaths: [],
        testPaths: ['tests/chat/identity-provider.test.ts'],
        docPaths: ['docs/architecture/identity-overview.md'],
      },
    )

    expect(piece).toMatchObject({
      secondaryPaths: [],
      relatedTests: [],
      relatedDocs: [],
    })
  })

  test('adds manual review questions when ownership evidence is incomplete', () => {
    const [piece] = attachRepositoryAssets(
      buildCanonicalRegistry([
        baseCandidate({
          name: 'recurring tasks',
          type: 'product-feature',
          declaredPaths: [],
          tags: ['recurring'],
        }),
      ]),
      {
        sourcePaths: [],
        scriptPaths: [],
        testPaths: [],
        docPaths: [],
      },
    )

    const resolvedPiece = requirePiece(piece)
    const manualReviewQuestions = resolvedPiece.manualReviewQuestions

    expectStringsToContain(manualReviewQuestions, [
      'Which source path is the primary owner of recurring tasks?',
      'Is recurring tasks intentionally untested, or is test coverage missing?',
      'Should recurring tasks gain a stable architecture or user-facing document?',
    ])
  })
})
