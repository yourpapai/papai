import type { Database } from 'bun:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { loadCodeindexConfig, type CodeindexConfig } from './config.js'
import { indexCodebase } from './indexer/index-codebase.js'
import { createCodeindexServer } from './mcp/server.js'
import { findIncomingReferences, findSymbolCandidates, searchSymbols } from './search/index.js'
import { openDatabase } from './storage/db.js'

export const resolveRepoRoot = (targetPath?: string): string => {
  if (targetPath !== undefined) return path.resolve(targetPath)

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(scriptDir, '..', '..')
}

export const loadConfigForPath = (targetPath?: string): Promise<CodeindexConfig> => {
  const repoRoot = resolveRepoRoot(targetPath)
  return loadCodeindexConfig({
    configPath: path.join(repoRoot, '.codeindex.json'),
    repoRoot,
  })
}

const withDatabase = <T>(config: CodeindexConfig, callback: (db: Database) => T): T => {
  const db = openDatabase(config.dbPath)
  try {
    return callback(db)
  } finally {
    db.close()
  }
}

const logJson = (value: unknown): void => {
  console.log(JSON.stringify(value, null, 2))
}

const runSearchCommand = (config: CodeindexConfig, query: string): void => {
  logJson(withDatabase(config, (db) => searchSymbols(db, { query, limit: 10 })))
}

const runSymbolCommand = (config: CodeindexConfig, query: string): void => {
  logJson(withDatabase(config, (db) => findSymbolCandidates(db, query, 10)))
}

const runImpactCommand = (config: CodeindexConfig, qualifiedName: string): void => {
  logJson(withDatabase(config, (db) => findIncomingReferences(db, { qualifiedName, limit: 20 })))
}

const runStatsCommand = (config: CodeindexConfig): void => {
  logJson(
    withDatabase(config, (db) =>
      db
        .query<{ files: number; symbols: number; symbol_references: number }, []>(
          `SELECT
             (SELECT COUNT(*) FROM files WHERE parse_status = 'indexed') AS files,
             (SELECT COUNT(*) FROM symbols) AS symbols,
             (SELECT COUNT(*) FROM symbol_references) AS symbol_references`,
        )
        .get(),
    ),
  )
}

const buildMcpDeps = (config: CodeindexConfig): Parameters<typeof createCodeindexServer>[0] => ({
  codeSearch: (input: Parameters<typeof searchSymbols>[1]): Promise<ReturnType<typeof searchSymbols>> =>
    Promise.resolve(withDatabase(config, (db) => searchSymbols(db, input))),
  codeSymbol: (query: string, limit: number): Promise<ReturnType<typeof findSymbolCandidates>> =>
    Promise.resolve(withDatabase(config, (db) => findSymbolCandidates(db, query, limit))),
  codeImpact: (
    input: Parameters<typeof findIncomingReferences>[1],
  ): Promise<ReturnType<typeof findIncomingReferences>> =>
    Promise.resolve(withDatabase(config, (db) => findIncomingReferences(db, input))),
  codeIndex: async ({
    path: targetPath,
    mode,
  }: {
    path: string
    mode: 'full' | 'incremental'
  }): Promise<Awaited<ReturnType<typeof indexCodebase>>> => {
    const targetConfig = await loadConfigForPath(targetPath)
    return indexCodebase({ config: targetConfig, mode })
  },
})

const runMcpCommand = async (config: CodeindexConfig): Promise<void> => {
  const server = createCodeindexServer(buildMcpDeps(config))
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('codeindex MCP server listening on stdio')
}

const main = async (): Promise<void> => {
  const [, , command = 'index', rawArg] = process.argv
  const config = await loadConfigForPath()

  switch (command) {
    case 'index':
      logJson(await indexCodebase({ config, mode: 'full' }))
      return
    case 'reindex':
      logJson(await indexCodebase({ config, mode: 'incremental' }))
      return
    case 'search':
      runSearchCommand(config, rawArg ?? '')
      return
    case 'symbol':
      runSymbolCommand(config, rawArg ?? '')
      return
    case 'impact':
      runImpactCommand(config, rawArg ?? '')
      return
    case 'stats':
      runStatsCommand(config)
      return
    case 'mcp':
      await runMcpCommand(config)
      return
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
