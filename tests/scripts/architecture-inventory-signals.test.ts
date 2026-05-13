import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import type { PieceRecord } from '../../scripts/architecture-inventory-model.js'
import { collectPieceSignals, loadCodeindexSummary } from '../../scripts/architecture-inventory-signals.js'

const expectSignalNamesToContain = (actualNames: readonly string[], expectedNames: readonly string[]): void => {
  for (const expectedName of expectedNames) {
    expect(actualNames).toContain(expectedName)
  }
}

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
    db.run('CREATE TABLE files (id INTEGER PRIMARY KEY, file_path TEXT NOT NULL, parse_status TEXT NOT NULL)')
    db.run(`
      CREATE TABLE symbol_references (
        id INTEGER PRIMARY KEY,
        source_file_id INTEGER NOT NULL,
        target_symbol_id INTEGER
      )
    `)
    db.run(`
      INSERT INTO files (id, file_path, parse_status) VALUES
        (1, 'src/tools/index.ts', 'indexed'),
        (2, 'scripts/behavior-audit/index.ts', 'indexed'),
        (3, 'src/providers/types.ts', 'indexed')
    `)
    db.run(`
      INSERT INTO symbol_references (id, source_file_id, target_symbol_id) VALUES
        (1, 2, 10),
        (2, 2, 11),
        (3, 1, 12)
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

    expectSignalNamesToContain(
      signals.map((signal) => signal.name),
      ['no-tests-found', 'historical-docs-only', 'audit-only-existence', 'wired-but-lightly-referenced'],
    )
  })

  test('aggregates reference counts from nested indexed files under owned directory paths', () => {
    const signals = collectPieceSignals({
      piece: makePiece({
        primaryPaths: ['src/providers'],
        secondaryPaths: [],
        entrypoints: ['src/index.ts'],
        relatedDocs: ['README.md'],
        relatedTests: ['tests/providers/youtrack/index.test.ts'],
        tags: [],
      }),
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts', 'src/providers/youtrack/index.ts', 'src/tools/index.ts']),
        referenceCountsByFile: {
          'src/providers/types.ts': 2,
          'src/providers/youtrack/index.ts': 3,
          'src/tools/index.ts': 1,
        },
      },
      providerCapabilities: [],
      toolKeys: ['create_task', 'search_tasks'],
    })

    expect(signals.map((signal) => signal.name)).not.toContain('wired-but-lightly-referenced')
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

  test('marks omitted agile and sprint capability families as not surfaced', () => {
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
        tags: [],
      }),
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['agiles.list', 'sprints.list', 'sprints.create', 'sprints.update', 'sprints.assign'],
      toolKeys: ['create_task', 'search_tasks', 'add_comment'],
    })

    const capabilitySignal = signals.find((signal) => signal.name === 'provider-capability-not-surfaced')
    expect(capabilitySignal?.evidence.join(' ')).toContain('agiles.list')
    expect(capabilitySignal?.evidence.join(' ')).toContain('sprints.list')
    expect(capabilitySignal?.evidence.join(' ')).toContain('sprints.create')
    expect(capabilitySignal?.evidence.join(' ')).toContain('sprints.update')
    expect(capabilitySignal?.evidence.join(' ')).toContain('sprints.assign')
  })

  test('does not mark benchmark-only or audit-only when a piece has no owned paths and no matching tags', () => {
    const signals = collectPieceSignals({
      piece: makePiece({
        name: 'deferred prompts',
        pieceId: 'deferred-prompts',
        type: 'product-feature',
        tags: [],
        primaryPaths: [],
        secondaryPaths: [],
        entrypoints: ['src/index.ts'],
        relatedDocs: ['README.md'],
        relatedTests: ['tests/deferred-prompts/tools.test.ts'],
        relatedScripts: [],
      }),
      codeindexSummary: {
        indexedFiles: new Set(['src/index.ts']),
        referenceCountsByFile: { 'src/index.ts': 3 },
      },
      providerCapabilities: [],
      toolKeys: ['create_deferred_prompt'],
    })

    const signalNames = signals.map((signal) => signal.name)
    expect(signalNames).not.toContain('benchmark-only-existence')
    expect(signalNames).not.toContain('audit-only-existence')
  })

  test('distinguishes sibling capability tool keys precisely', () => {
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
        tags: [],
      }),
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['attachments.delete', 'workItems.update'],
      toolKeys: ['list_attachments', 'list_work', 'log_work'],
    })

    const capabilitySignal = signals.find((signal) => signal.name === 'provider-capability-not-surfaced')
    expect(capabilitySignal?.evidence.join(' ')).toContain('attachments.delete')
    expect(capabilitySignal?.evidence.join(' ')).toContain('workItems.update')
  })

  test('treats activities.read as surfaced only by the actual history tool key', () => {
    const piece = makePiece({
      pieceId: 'task-provider-adapters',
      name: 'task provider adapters',
      type: 'integration-provider',
      status: 'active',
      primaryPaths: ['src/providers'],
      relatedDocs: ['README.md'],
      relatedTests: ['tests/providers/youtrack/index.test.ts'],
      relatedScripts: [],
      entrypoints: ['src/index.ts'],
      tags: [],
    })

    const missingSignals = collectPieceSignals({
      piece,
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['activities.read'],
      toolKeys: ['list_saved_queries'],
    })

    const surfacedSignals = collectPieceSignals({
      piece,
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['activities.read'],
      toolKeys: ['get_task_history'],
    })

    expect(
      missingSignals.find((signal) => signal.name === 'provider-capability-not-surfaced')?.evidence.join(' '),
    ).toContain('activities.read')
    expect(surfacedSignals.map((signal) => signal.name)).not.toContain('provider-capability-not-surfaced')
  })

  test('treats queries.saved as surfaced by actual saved-query tool keys', () => {
    const piece = makePiece({
      pieceId: 'task-provider-adapters',
      name: 'task provider adapters',
      type: 'integration-provider',
      status: 'active',
      primaryPaths: ['src/providers'],
      relatedDocs: ['README.md'],
      relatedTests: ['tests/providers/youtrack/index.test.ts'],
      relatedScripts: [],
      entrypoints: ['src/index.ts'],
      tags: [],
    })

    const missingSignals = collectPieceSignals({
      piece,
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['queries.saved'],
      toolKeys: ['get_task_history'],
    })

    const surfacedByListSignals = collectPieceSignals({
      piece,
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['queries.saved'],
      toolKeys: ['list_saved_queries'],
    })

    const surfacedByRunSignals = collectPieceSignals({
      piece,
      codeindexSummary: {
        indexedFiles: new Set(['src/providers/types.ts']),
        referenceCountsByFile: { 'src/providers/types.ts': 5 },
      },
      providerCapabilities: ['queries.saved'],
      toolKeys: ['run_saved_query'],
    })

    expect(
      missingSignals.find((signal) => signal.name === 'provider-capability-not-surfaced')?.evidence.join(' '),
    ).toContain('queries.saved')
    expect(surfacedByListSignals.map((signal) => signal.name)).not.toContain('provider-capability-not-surfaced')
    expect(surfacedByRunSignals.map((signal) => signal.name)).not.toContain('provider-capability-not-surfaced')
  })
})
