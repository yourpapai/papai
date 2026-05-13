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

const expectContainsAll = (actual: readonly string[], expected: readonly string[]): void => {
  expected.forEach((value) => {
    expect(actual).toContain(value)
  })
}

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
    expect(markdown).toContain('## Name')
    expect(markdown).toContain('message queue')
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

    expectContainsAll(
      files.map((file) => file.relativePath),
      [
        'inventory.md',
        'inventory.json',
        'candidate-review-queue.md',
        'overlap-matrix.md',
        'orphan-matrix.md',
        'docs-code-mismatch.md',
        'test-presence-report.md',
        'pieces/message-queue.md',
      ],
    )
  })
})
