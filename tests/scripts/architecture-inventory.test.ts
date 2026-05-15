// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

import {
  parseArchitectureInventoryArgs,
  runArchitectureInventory,
  type ArchitectureInventoryDeps,
} from '../../scripts/architecture-inventory.js'

const defaultPackageJsonText = JSON.stringify({
  workspaces: ['codeindex'],
  scripts: { 'audit:behavior': 'bun scripts/behavior-audit/index.ts' },
})

const defaultProviderTypesText = "export type TaskCapability = 'tasks.watchers' | 'comments.create'"

const defaultToolsBuilderText = [
  "tools['create_task'] = makeCreateTaskTool(provider)",
  'tools.search_tasks = makeSearchTasksTool(provider)',
  "tools['add_comment'] = makeAddCommentTool(provider)",
].join('\n')

const defaultReadTextFileEntries = {
  'package.json': defaultPackageJsonText,
  'src/providers/types.ts': defaultProviderTypesText,
  'src/tools/tools-builder.ts': defaultToolsBuilderText,
} satisfies Readonly<Record<string, string>>

const readTextFileEntries = (overrides: Readonly<Record<string, string>>): Readonly<Record<string, string>> => ({
  ...defaultReadTextFileEntries,
  ...overrides,
})

const readTextFileFromEntries = (
  entries: Readonly<Record<string, string>>,
): ArchitectureInventoryDeps['readTextFile'] => {
  const matchingEntry = (filePath: string): string | undefined => {
    const entry = Object.entries(entries).find(([suffix]) => filePath.endsWith(suffix))
    if (entry === undefined) {
      return undefined
    }

    return entry[1]
  }

  return (filePath: string): Promise<string> => {
    const entry = matchingEntry(filePath)
    if (entry === undefined) {
      return Promise.resolve('')
    }

    return Promise.resolve(entry)
  }
}

const baseReadTextFile = readTextFileFromEntries(readTextFileEntries({}))

const initializeCodeindexDb = (database: Database): void => {
  database.run('CREATE TABLE files (id INTEGER PRIMARY KEY, file_path TEXT NOT NULL, parse_status TEXT NOT NULL)')
  database.run('CREATE TABLE symbol_references (id INTEGER PRIMARY KEY, source_file_id INTEGER NOT NULL)')
}

const makeOpenCodeindexDb =
  (): ArchitectureInventoryDeps['openCodeindexDb'] =>
  (_dbPath: string): Database => {
    const database = new Database(':memory:')
    initializeCodeindexDb(database)
    return database
  }

const expectContainsAll = (actual: readonly string[], expected: readonly string[]): void => {
  expected.forEach((value) => {
    expect(actual).toContain(value)
  })
}

const captureWritesBySuffix =
  (suffix: string, writes: string[]): ArchitectureInventoryDeps['writeTextFile'] =>
  (filePath: string, content: string): Promise<void> => {
    if (filePath.endsWith(suffix)) {
      writes.push(content)
    }

    return Promise.resolve()
  }

const inventoryWriteContent = (writes: readonly { path: string; content: string }[], outputPath: string): string => {
  const inventoryWrite = writes.find((write) => write.path === outputPath)
  expect(inventoryWrite).toBeDefined()
  if (inventoryWrite === undefined) {
    throw new Error(`Missing write for ${outputPath}`)
  }

  return inventoryWrite.content
}

const makeDeps = (
  relativePaths: readonly string[],
  overrides: Partial<ArchitectureInventoryDeps>,
): Readonly<{
  deps: ArchitectureInventoryDeps
  writes: Array<{ path: string; content: string }>
}> => {
  const writes: Array<{ path: string; content: string }> = []
  const deps: ArchitectureInventoryDeps = {
    readTextFile: baseReadTextFile,
    listRelativePaths: () => Promise.resolve(relativePaths),
    mkdirp: () => Promise.resolve(),
    writeTextFile: (filePath, content) => {
      writes.push({ path: filePath, content })
      return Promise.resolve()
    },
    runCodeindexReindex: mock(() => Promise.resolve()),
    openCodeindexDb: makeOpenCodeindexDb(),
    ...overrides,
  }

  return { deps, writes }
}

const commonRelativePaths = [
  'README.md',
  'CLAUDE.md',
  'docs/ROADMAP.md',
  'src/index.ts',
  'src/bot.ts',
  'src/tools/tools-builder.ts',
  'src/providers/types.ts',
  'scripts/behavior-audit/index.ts',
  'tests/scripts/behavior-audit/entrypoint.test.ts',
] as const

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
    const { deps, writes } = makeDeps(commonRelativePaths, {})

    await runArchitectureInventory(
      { repoRoot: '/tmp/papai', outputDir: 'docs/architecture', reindexCodeindex: true },
      deps,
    )

    expect(deps.runCodeindexReindex).toHaveBeenCalledTimes(1)
    expectContainsAll(
      writes.map((write) => write.path),
      [
        '/tmp/papai/docs/architecture/inventory.md',
        '/tmp/papai/docs/architecture/inventory.json',
        '/tmp/papai/docs/architecture/candidate-review-queue.md',
      ],
    )
  })

  test('writes to an absolute output directory without repo-root prefixing', async () => {
    const { deps, writes } = makeDeps(commonRelativePaths, {})

    await runArchitectureInventory(
      { repoRoot: '/tmp/papai', outputDir: '/tmp/architecture-output', reindexCodeindex: false },
      deps,
    )

    expect(deps.runCodeindexReindex).toHaveBeenCalledTimes(0)
    expectContainsAll(
      writes.map((write) => write.path),
      [
        '/tmp/architecture-output/inventory.md',
        '/tmp/architecture-output/inventory.json',
        '/tmp/architecture-output/candidate-review-queue.md',
      ],
    )
  })

  test('ignores rerun output paths and irrelevant directories when building inputs', async () => {
    const { deps, writes } = makeDeps(
      [
        ...commonRelativePaths,
        'docs/architecture/inventory.md',
        'docs/architecture/pieces/message-queue.md',
        '.git/config',
        'node_modules/pkg/index.js',
      ],
      {},
    )

    await runArchitectureInventory(
      { repoRoot: '/tmp/papai', outputDir: 'docs/architecture', reindexCodeindex: false },
      deps,
    )

    const inventoryContent = inventoryWriteContent(writes, '/tmp/papai/docs/architecture/inventory.md')
    expect(inventoryContent).not.toContain('docs/architecture/inventory.md')
    expect(inventoryContent).not.toContain('.git/config')
    expect(inventoryContent).not.toContain('node_modules/pkg/index.js')
  })

  test('derives tool keys from the current builder shape in code', async () => {
    const candidateQueueWrites: string[] = []
    const { deps } = makeDeps(
      [
        'README.md',
        'CLAUDE.md',
        'docs/ROADMAP.md',
        'src/index.ts',
        'src/bot.ts',
        'src/tools/tools-builder.ts',
        'src/providers/types.ts',
        'tests/providers/youtrack/index.test.ts',
      ],
      {
        writeTextFile: captureWritesBySuffix('candidate-review-queue.md', candidateQueueWrites),
        readTextFile: readTextFileFromEntries(
          readTextFileEntries({
            'src/tools/tools-builder.ts': [
              'tools.create_task = makeCreateTaskTool(provider)',
              "tools['search_tasks'] = makeSearchTasksTool(provider)",
              'tools.add_comment = makeAddCommentTool(provider)',
            ].join('\n'),
          }),
        ),
      },
    )

    await runArchitectureInventory(
      { repoRoot: '/tmp/papai', outputDir: 'docs/architecture', reindexCodeindex: false },
      deps,
    )

    expect(candidateQueueWrites[0]).toContain('provider-capability-not-surfaced')
  })
})
