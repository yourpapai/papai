# Codeindex Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `codeindex/` Bun workspace package that indexes TS/JS repositories into a symbol-first SQLite database, exposes structural search and impact lookup through MCP, and supports incremental reindexing.

**Architecture:** Implement `codeindex/` as a real nested Bun workspace package so it can own its dependencies, tests, and scripts while still living in the papai monorepo. Build the feature vertically: package scaffolding and parser loading first, then schema and storage, then extraction and resolution, then search and MCP, and finally incremental reindexing plus repo-level quality-gate integration.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `web-tree-sitter` + `tree-sitter-wasms` (prebuilt WASM grammars for ts/tsx/js), `ignore`, `zod`, `@modelcontextprotocol/sdk` v1.x, Bun test, oxlint, oxfmt, knip

**Alignment notes (applied during spec/plan sync):**

- the `symbol_references` table is named with a `symbol_` prefix because `REFERENCES` is a reserved keyword in SQLite; unquoted use of `references` as a table identifier is brittle
- grammars are loaded from `tree-sitter-wasms/out/*.wasm` (prebuilt WASM) because the native `tree-sitter-typescript` / `tree-sitter-javascript` npm packages do not ship `.wasm` files
- `codeindex/bunfig.toml` overrides the root preloads so codeindex tests do not pull in `tests/setup.ts` / `tests/mock-reset.ts`
- `typescript` and `@typescript/native-preview` live under `devDependencies` in `codeindex/package.json` (developer-only)
- context7 verification is a required step before pinning `web-tree-sitter`, `tree-sitter-wasms`, and `@modelcontextprotocol/sdk`
- TDD hooks (`.hooks/tdd/test-resolver.mjs`) and agent guidance (`CLAUDE.md`, `codeindex/CLAUDE.md`) are updated explicitly in Task 13 so the workspace is not silently exempt

---

## Scope Check

This should stay as one implementation plan. The workspace packaging, parser/runtime loading, SQLite schema, symbol extraction, resolver, search ranking, MCP surface, and incremental reindexing are tightly coupled. Splitting them into separate plans would force the implementer to guess shared storage contracts, parser output shapes, and MCP result schemas.

## File Structure

| Path                                           | Responsibility                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `package.json`                                 | Add Bun workspace support and root scripts that can target `codeindex/`                         |
| `knip.jsonc`                                   | Extend project and entry coverage to include the new workspace package                          |
| `.gitignore`                                   | Ignore `codeindex/.codeindex/` database artifacts                                               |
| `codeindex/package.json`                       | Workspace-local dependencies and scripts                                                        |
| `codeindex/tsconfig.json`                      | Workspace TypeScript config extending the repo base                                             |
| `codeindex/bunfig.toml`                        | Override root preloads so codeindex tests do not pull in papai-only test setup                  |
| `codeindex/CLAUDE.md`                          | Workspace-scoped agent guidance for codeindex                                                   |
| `CLAUDE.md`                                    | Add `codeindex/` row to the Path-Scoped Conventions table and list `codeindex:*` scripts        |
| `.hooks/tdd/test-resolver.mjs`                 | Extend resolver to map `codeindex/src/**` ↔ `tests/codeindex/**` (or document exemption)        |
| `scripts/check.sh`                             | Extend full-check run to include codeindex workspace checks                                     |
| `codeindex/src/cli.ts`                         | CLI entrypoint for `index`, `reindex`, `search`, `symbol`, `impact`, `stats`, and `mcp`         |
| `codeindex/src/config.ts`                      | Zod-backed `.codeindex.json` parsing and defaults                                               |
| `codeindex/src/types.ts`                       | Shared readonly data shapes for files, symbols, references, search results, and index summaries |
| `codeindex/src/storage/db.ts`                  | SQLite connection and PRAGMA setup                                                              |
| `codeindex/src/storage/schema.ts`              | Table creation and FTS trigger setup                                                            |
| `codeindex/src/storage/queries.ts`             | Storage helpers for upserts, lookups, and search queries                                        |
| `codeindex/src/indexer/discover.ts`            | Root walking plus `.gitignore` and config exclude handling                                      |
| `codeindex/src/indexer/parser.ts`              | `web-tree-sitter` bootstrap and language selection                                              |
| `codeindex/src/indexer/extract-symbols.ts`     | Symbol extraction, qualified names, identifier normalization, doc comments                      |
| `codeindex/src/indexer/extract-references.ts`  | Import/export/reference candidate extraction                                                    |
| `codeindex/src/resolver/module-specifiers.ts`  | Canonical module keys, alias generation, relative specifier normalization                       |
| `codeindex/src/resolver/tsconfig-paths.ts`     | `baseUrl` and `paths` loading and alias expansion                                               |
| `codeindex/src/resolver/resolve-references.ts` | Symbol and file resolution with confidence scoring                                              |
| `codeindex/src/indexer/index-codebase.ts`      | Full and incremental indexing orchestration                                                     |
| `codeindex/src/search/exact.ts`                | Exact symbol and path matching pass                                                             |
| `codeindex/src/search/fts.ts`                  | FTS5 query building and `bm25` weighting                                                        |
| `codeindex/src/search/rank.ts`                 | Deterministic structural reranking                                                              |
| `codeindex/src/search/index.ts`                | High-level search, symbol resolution, and impact APIs                                           |
| `codeindex/src/mcp/server.ts`                  | `McpServer` wiring and stdio transport                                                          |
| `codeindex/src/mcp/tools.ts`                   | MCP tool registration and response shaping                                                      |
| `codeindex/.codeindex.json.example`            | Example local configuration                                                                     |
| `tests/codeindex/config.test.ts`               | Config loading tests                                                                            |
| `tests/codeindex/parser.test.ts`               | Parser bootstrapping and language selection tests                                               |
| `tests/codeindex/discover.test.ts`             | File discovery and ignore behavior tests                                                        |
| `tests/codeindex/extract-symbols.test.ts`      | Symbol extraction and normalization tests                                                       |
| `tests/codeindex/extract-references.test.ts`   | Reference candidate extraction tests                                                            |
| `tests/codeindex/module-specifiers.test.ts`    | Module key and alias generation tests                                                           |
| `tests/codeindex/tsconfig-paths.test.ts`       | `tsconfig` path alias loading tests                                                             |
| `tests/codeindex/resolve-references.test.ts`   | Resolver confidence and symbol matching tests                                                   |
| `tests/codeindex/storage.test.ts`              | Schema creation, triggers, and storage round-trip tests                                         |
| `tests/codeindex/search.test.ts`               | Exact search, FTS search, and reranking tests                                                   |
| `tests/codeindex/impact.test.ts`               | `code_symbol` and `code_impact` logic tests                                                     |
| `tests/codeindex/index-codebase.test.ts`       | Full and incremental indexing tests                                                             |
| `tests/codeindex/mcp.test.ts`                  | MCP tool registration and stdio-safe output tests                                               |
| `tests/codeindex/fixtures/**`                  | Small fixture repos used by parser, resolver, and indexing tests                                |

---

### Task 1: Create the `codeindex/` workspace package and root wiring

**Files:**

- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `knip.jsonc`
- Create: `codeindex/package.json`
- Create: `codeindex/tsconfig.json`
- Create: `codeindex/.codeindex.json.example`
- Test: `tests/codeindex/config.test.ts`

- [ ] **Step 1: Write the failing config/bootstrap test**

```typescript
// tests/codeindex/config.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { loadCodeindexConfig } from '../../codeindex/src/config.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-config-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('loadCodeindexConfig', () => {
  test('loads defaults and resolves repo-relative paths', async () => {
    const repoRoot = makeTempDir()
    const configPath = path.join(repoRoot, '.codeindex.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        roots: ['src', 'client'],
        tsconfigPaths: ['tsconfig.json'],
      }),
    )

    const config = await loadCodeindexConfig({
      configPath,
      repoRoot,
    })

    expect(config.repoRoot).toBe(repoRoot)
    expect(config.dbPath).toBe(path.join(repoRoot, '.codeindex', 'index.db'))
    expect(config.indexLocals).toBe(true)
    expect(config.languages).toEqual(['ts', 'tsx', 'js', 'jsx'])
    expect(config.tsconfigPaths).toEqual([path.join(repoRoot, 'tsconfig.json')])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/config.test.ts
```

Expected: FAIL with `Cannot find module '../../codeindex/src/config.js'`.

- [ ] **Step 3: Add root workspace, ignore, and knip wiring**

```jsonc
// package.json — merge into the existing root package.json; do not overwrite.
// Add `workspaces` if not present and merge the `codeindex:*` scripts into the existing `scripts` block.
{
  "private": true,
  "workspaces": ["codeindex"],
  "scripts": {
    "codeindex:test": "bun run --filter codeindex test",
    "codeindex:typecheck": "bun run --filter codeindex typecheck",
    "codeindex:lint": "bun run --filter codeindex lint",
    "codeindex:format:check": "bun run --filter codeindex format:check",
  },
}
```

```gitignore
# .gitignore — append this line to the existing file; do not overwrite surrounding rules.
codeindex/.codeindex/
```

```jsonc
// knip.jsonc (merge with existing file — do not overwrite the surrounding keys)
{
  "entry": [
    "src/scripts/*.ts!",
    "scripts/build-client.ts!",
    "client/debug/index.ts!",
    "tests/providers/youtrack/test-helpers.ts!",
    "codeindex/src/cli.ts!",
  ],
  "project": ["src/**/*.ts!", "client/**/*.ts!", "codeindex/src/**/*.ts!"],
  // Extend the existing ignore list so codeindex runtime artifacts never trip knip under `--no-gitignore`.
  "ignore": ["src/db/migrations/**", "codeindex/.codeindex/**"],
}
```

- [ ] **Step 4: Create the workspace package files and config loader**

```json
// codeindex/package.json
{
  "name": "codeindex",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test ../tests/codeindex",
    "typecheck": "tsgo --project tsconfig.json --noEmit",
    "lint": "oxlint --config ../.oxlintrc.json src ../tests/codeindex",
    "format": "oxfmt --write src ../tests/codeindex",
    "format:check": "oxfmt --check src ../tests/codeindex",
    "start": "bun run src/cli.ts"
  },
  "dependencies": {
    "ignore": "^7.0.5",
    "web-tree-sitter": "^0.26.8",
    "tree-sitter-wasms": "^0.1.13",
    "zod": "^4.0.0",
    "@modelcontextprotocol/sdk": "^1.29.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0",
    "@typescript/native-preview": "^7.0.0-dev.20260409.1"
  }
}
```

> **Dependency rationale:** `tree-sitter-wasms` publishes prebuilt `.wasm` grammar files under `tree-sitter-wasms/out/` for both `typescript`, `tsx`, and `javascript`. The native `tree-sitter-javascript` / `tree-sitter-typescript` packages do **not** ship `.wasm` files and would require a `tree-sitter build --wasm` step per grammar. `typescript` and `@typescript/native-preview` are devDependencies because the resolver uses `ts.readConfigFile` (developer-only) and typecheck runs via `tsgo`.
>
> Before committing these versions, verify current release metadata via `context7` (per workflow protocol): resolve `tree-sitter-wasms`, `web-tree-sitter`, and `@modelcontextprotocol/sdk` and confirm the exports surface still matches what this plan assumes.

```json
// codeindex/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"]
}
```

```toml
# codeindex/bunfig.toml
# Override the root bunfig.toml preloads so codeindex tests do not pull in
# ./tests/setup.ts and ./tests/mock-reset.ts (which depend on papai-only modules).
[test]
preload = []
pathIgnorePatterns = []
```

```json
// codeindex/.codeindex.json.example
{
  "roots": ["src", "client"],
  "exclude": ["node_modules", "dist", ".git", "coverage", "**/*.test.*", "**/*.spec.*"],
  "languages": ["ts", "tsx", "js", "jsx"],
  "dbPath": ".codeindex/index.db",
  "indexLocals": true,
  "indexVariables": true,
  "includeDocComments": true,
  "maxStoredBodyLines": 120,
  "tsconfigPaths": ["tsconfig.json"]
}
```

```typescript
// codeindex/src/config.ts
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

const CodeindexConfigSchema = z.object({
  roots: z.array(z.string().min(1)).default(['src']),
  exclude: z
    .array(z.string().min(1))
    .default(['node_modules', 'dist', '.git', 'coverage', '**/*.test.*', '**/*.spec.*']),
  languages: z.array(z.enum(['ts', 'tsx', 'js', 'jsx'])).default(['ts', 'tsx', 'js', 'jsx']),
  dbPath: z.string().min(1).default('.codeindex/index.db'),
  indexLocals: z.boolean().default(true),
  indexVariables: z.boolean().default(true),
  includeDocComments: z.boolean().default(true),
  maxStoredBodyLines: z.number().int().positive().default(120),
  tsconfigPaths: z.array(z.string().min(1)).default(['tsconfig.json']),
})

export type CodeindexConfig = Readonly<
  z.infer<typeof CodeindexConfigSchema> & {
    repoRoot: string
    configPath: string
    dbPath: string
    roots: readonly string[]
    tsconfigPaths: readonly string[]
  }
>

export interface LoadCodeindexConfigInput {
  configPath: string
  repoRoot?: string
}

export const loadCodeindexConfig = async (input: Readonly<LoadCodeindexConfigInput>): Promise<CodeindexConfig> => {
  const configPath = path.resolve(input.configPath)
  const configDir = path.dirname(configPath)
  const repoRoot = input.repoRoot === undefined ? configDir : path.resolve(input.repoRoot)
  const fileContents = await readFile(configPath, 'utf8')
  const parsed = CodeindexConfigSchema.parse(JSON.parse(fileContents) as unknown)
  const resolvedDbPath = path.resolve(repoRoot, parsed.dbPath)

  await mkdir(path.dirname(resolvedDbPath), { recursive: true })

  return {
    ...parsed,
    configPath,
    repoRoot,
    dbPath: resolvedDbPath,
    roots: parsed.roots.map((entry) => path.resolve(repoRoot, entry)),
    tsconfigPaths: parsed.tsconfigPaths.map((entry) => path.resolve(repoRoot, entry)),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore knip.jsonc codeindex/package.json codeindex/tsconfig.json codeindex/bunfig.toml codeindex/.codeindex.json.example codeindex/src/config.ts tests/codeindex/config.test.ts
git commit -m "feat(codeindex): scaffold workspace package"
```

---

### Task 2: Add shared types and parser bootstrapping

**Files:**

- Create: `codeindex/src/types.ts`
- Create: `codeindex/src/indexer/parser.ts`
- Test: `tests/codeindex/parser.test.ts`

- [ ] **Step 0: Verify current versions and export surface via `context7`**

Resolve these library IDs and confirm the published surface still matches what this plan assumes (grammar wasm paths under `tree-sitter-wasms/out/`, named exports `Parser` + `Language` from `web-tree-sitter`, `Parser.init()` + `Language.load()`). Adjust versions and imports if upstream has moved. As of verification, `web-tree-sitter@^0.26` exposes `Parser` and `Language` as named exports; the older `Parser.Language.load(...)` path is no longer the documented surface.

- `web-tree-sitter`
- `tree-sitter-wasms`

Record the resolved versions in `codeindex/package.json` before proceeding.

- [ ] **Step 1: Write the failing parser bootstrap test**

```typescript
// tests/codeindex/parser.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const parserInit = mock(async () => {})
const loadLanguage = mock(async (wasmPath: string) => ({ wasmPath }))
const setLanguage = mock(() => {})

describe('createParserLoader', () => {
  beforeEach(() => {
    mock.restore()
    parserInit.mockClear()
    loadLanguage.mockClear()
    setLanguage.mockClear()

    // Delayed import is required because Bun evaluates static imports before mock.module().
    void mock.module('web-tree-sitter', () => {
      class FakeParser {
        static init = parserInit
        setLanguage(language: unknown): void {
          setLanguage(language)
        }
      }

      return {
        Parser: FakeParser,
        Language: {
          load: loadLanguage,
        },
      }
    })
  })

  test('loads javascript and typescript-family grammars once', async () => {
    const { createParserLoader } = await import('../../codeindex/src/indexer/parser.js')
    const loader = await createParserLoader()

    await loader.createParserForExtension('.ts')
    await loader.createParserForExtension('.tsx')
    await loader.createParserForExtension('.js')

    expect(parserInit).toHaveBeenCalledTimes(1)
    expect(loadLanguage.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('tree-sitter-wasms/out/tree-sitter-typescript.wasm'),
      expect.stringContaining('tree-sitter-wasms/out/tree-sitter-tsx.wasm'),
      expect.stringContaining('tree-sitter-wasms/out/tree-sitter-javascript.wasm'),
    ])
    expect(setLanguage).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/parser.test.ts
```

Expected: FAIL with `Cannot find module '../../codeindex/src/indexer/parser.js'`.

- [ ] **Step 3: Add shared types and parser loader implementation**

```typescript
// codeindex/src/types.ts
export type SupportedLanguage = 'ts' | 'tsx' | 'js' | 'jsx'

export type ParseStatus = 'indexed' | 'parse_failed' | 'unsupported' | 'skipped'

export type ScopeTier = 'exported' | 'module' | 'member' | 'local'

export type ExportKind = 'named' | 'default' | 'namespace' | 'reexport'

export type ReferenceEdgeType = 'imports' | 'reexports' | 'calls' | 'extends' | 'implements' | 'references'

export type ReferenceConfidence = 'resolved' | 'file_resolved' | 'name_only'

export interface FileRecord {
  readonly id: number
  readonly filePath: string
  readonly moduleKey: string
  readonly language: SupportedLanguage
  readonly fileHash: string
  readonly parseStatus: ParseStatus
  readonly parseError: string | null
  readonly indexedAt: string
}

export interface SearchResult {
  readonly symbolKey: string
  readonly qualifiedName: string
  readonly localName: string
  readonly kind: string
  readonly scopeTier: ScopeTier
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly exportNames: readonly string[]
  readonly matchReason: string
  readonly confidence: ReferenceConfidence | 'exact'
  readonly snippet: string
}
```

```typescript
// codeindex/src/indexer/parser.ts
import { Language, Parser } from 'web-tree-sitter'

import type { SupportedLanguage } from '../types.js'

export interface LoadedParser {
  readonly parser: Parser
  readonly language: SupportedLanguage
}

export interface ParserLoader {
  createParserForExtension(extension: string): Promise<LoadedParser>
}

const extensionToLanguage = (extension: string): SupportedLanguage => {
  switch (extension) {
    case '.ts':
      return 'ts'
    case '.tsx':
      return 'tsx'
    case '.js':
      return 'js'
    case '.jsx':
      return 'jsx'
    default:
      throw new Error(`Unsupported extension: ${extension}`)
  }
}

const wasmSpecifierFor = (language: SupportedLanguage): string => {
  switch (language) {
    case 'ts':
      return 'tree-sitter-wasms/out/tree-sitter-typescript.wasm'
    case 'tsx':
      return 'tree-sitter-wasms/out/tree-sitter-tsx.wasm'
    case 'js':
    case 'jsx':
      return 'tree-sitter-wasms/out/tree-sitter-javascript.wasm'
  }
}

const resolveWasmPath = (language: SupportedLanguage): string =>
  Bun.fileURLToPath(import.meta.resolve(wasmSpecifierFor(language)))

export const createParserLoader = async (): Promise<ParserLoader> => {
  await Parser.init()
  const cache = new Map<SupportedLanguage, Promise<Language>>()

  const loadLanguage = (language: SupportedLanguage): Promise<Language> => {
    const cached = cache.get(language)
    if (cached !== undefined) return cached

    const resolved = Promise.resolve(Language.load(resolveWasmPath(language)))
    cache.set(language, resolved)
    return resolved
  }

  return {
    createParserForExtension: async (extension: string): Promise<LoadedParser> => {
      const language = extensionToLanguage(extension)
      const parser = new Parser()
      parser.setLanguage(await loadLanguage(language))
      return { parser, language }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/types.ts codeindex/src/indexer/parser.ts tests/codeindex/parser.test.ts
git commit -m "feat(codeindex): bootstrap parser loader"
```

---

### Task 3: Implement file discovery with `.gitignore` and config excludes

**Files:**

- Create: `codeindex/src/indexer/discover.ts`
- Test: `tests/codeindex/discover.test.ts`

- [ ] **Step 1: Write the failing discovery test**

```typescript
// tests/codeindex/discover.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { discoverSourceFiles } from '../../codeindex/src/indexer/discover.js'

const tempDirs: string[] = []

const makeTempRepo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-discover-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('discoverSourceFiles', () => {
  test('respects gitignore and explicit excludes', async () => {
    const repoRoot = makeTempRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'coverage'), { recursive: true })
    writeFileSync(path.join(repoRoot, '.gitignore'), 'ignored.ts\n')
    writeFileSync(path.join(repoRoot, 'src', 'kept.ts'), 'export const kept = 1\n')
    writeFileSync(path.join(repoRoot, 'ignored.ts'), 'export const ignored = 1\n')
    writeFileSync(path.join(repoRoot, 'coverage', 'skip.ts'), 'export const skip = 1\n')
    writeFileSync(path.join(repoRoot, 'src', 'skip.test.ts'), 'export const testOnly = 1\n')

    const files = await discoverSourceFiles({
      repoRoot,
      roots: [path.join(repoRoot, 'src')],
      exclude: ['coverage', '**/*.test.*'],
      languages: ['ts', 'tsx', 'js', 'jsx'],
    })

    expect(files.map((entry) => path.relative(repoRoot, entry.absolutePath))).toEqual(['src/kept.ts'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/discover.test.ts
```

Expected: FAIL with `Cannot find module '../../codeindex/src/indexer/discover.js'`.

- [ ] **Step 3: Implement discovery with gitignore matching**

```typescript
// codeindex/src/indexer/discover.ts
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import ignore from 'ignore'

import type { SupportedLanguage } from '../types.js'

export interface DiscoverSourceFilesInput {
  readonly repoRoot: string
  readonly roots: readonly string[]
  readonly exclude: readonly string[]
  readonly languages: readonly SupportedLanguage[]
}

export interface DiscoveredFile {
  readonly absolutePath: string
  readonly relativePath: string
  readonly extension: string
}

const supportedExtensionsFor = (languages: readonly SupportedLanguage[]): ReadonlySet<string> =>
  new Set(languages.map((language) => `.${language}`))

const readGitignore = async (repoRoot: string): Promise<string> => {
  try {
    return await readFile(path.join(repoRoot, '.gitignore'), 'utf8')
  } catch {
    return ''
  }
}

const walk = async (dir: string, repoRoot: string, matcher: ReturnType<typeof ignore>): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const discovered = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(repoRoot, absolutePath)

      if (matcher.ignores(relativePath)) return []
      if (entry.isDirectory()) return walk(absolutePath, repoRoot, matcher)
      if (entry.isFile()) return [absolutePath]
      return []
    }),
  )

  return discovered.flat()
}

export const discoverSourceFiles = async (
  input: Readonly<DiscoverSourceFilesInput>,
): Promise<readonly DiscoveredFile[]> => {
  const matcher = ignore()
    .add(await readGitignore(input.repoRoot))
    .add([...input.exclude])
  const supportedExtensions = supportedExtensionsFor(input.languages)
  const files = await Promise.all(input.roots.map((root) => walk(root, input.repoRoot, matcher)))

  return files
    .flat()
    .map((absolutePath) => {
      const relativePath = path.relative(input.repoRoot, absolutePath)
      return {
        absolutePath,
        relativePath,
        extension: path.extname(absolutePath),
      }
    })
    .filter((entry) => supportedExtensions.has(entry.extension))
    .filter((entry) => !matcher.ignores(entry.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/discover.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/indexer/discover.ts tests/codeindex/discover.test.ts
git commit -m "feat(codeindex): add source discovery"
```

---

### Task 4: Create SQLite schema, triggers, and low-level storage helpers

**Files:**

- Create: `codeindex/src/storage/db.ts`
- Create: `codeindex/src/storage/schema.ts`
- Create: `codeindex/src/storage/queries.ts`
- Test: `tests/codeindex/storage.test.ts`

- [ ] **Step 1: Write the failing storage schema test**

```typescript
// tests/codeindex/storage.test.ts
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import { ensureSchema } from '../../codeindex/src/storage/schema.js'

describe('ensureSchema', () => {
  test('creates symbol tables and FTS triggers', () => {
    const db = new Database(':memory:')

    ensureSchema(db)

    const tableNames = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    const triggerNames = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((row) => row.name)

    expect(tableNames).toContain('files')
    expect(tableNames).toContain('module_aliases')
    expect(tableNames).toContain('symbols')
    expect(tableNames).toContain('module_exports')
    expect(tableNames).toContain('symbol_references')
    expect(tableNames).toContain('symbol_fts')
    expect(triggerNames).toEqual(expect.arrayContaining(['symbols_ad', 'symbols_ai', 'symbols_au']))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/storage.test.ts
```

Expected: FAIL with `Cannot find module '../../codeindex/src/storage/schema.js'`.

- [ ] **Step 3: Add the SQLite schema and connection helpers**

```typescript
// codeindex/src/storage/db.ts
import { Database } from 'bun:sqlite'

export const openDatabase = (dbPath: string): Database => {
  const db = new Database(dbPath, { create: true })
  db.run('PRAGMA journal_mode = WAL;')
  db.run('PRAGMA foreign_keys = ON;')
  return db
}
```

```typescript
// codeindex/src/storage/schema.ts
import type { Database } from 'bun:sqlite'

export const ensureSchema = (db: Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      module_key TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      parse_error TEXT,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_aliases (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      alias_key TEXT NOT NULL,
      alias_kind TEXT NOT NULL,
      precedence INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      module_key TEXT NOT NULL,
      symbol_key TEXT NOT NULL UNIQUE,
      local_name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope_tier TEXT NOT NULL,
      parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
      is_exported INTEGER NOT NULL,
      export_names TEXT NOT NULL,
      signature_text TEXT NOT NULL,
      doc_text TEXT NOT NULL,
      body_text TEXT NOT NULL,
      identifier_terms TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      start_byte INTEGER NOT NULL,
      end_byte INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_exports (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      export_name TEXT NOT NULL,
      export_kind TEXT NOT NULL,
      symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
      target_module_specifier TEXT,
      resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS symbol_references (
      id INTEGER PRIMARY KEY,
      source_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
      source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      target_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
      target_name TEXT NOT NULL,
      target_export_name TEXT,
      target_module_specifier TEXT,
      edge_type TEXT NOT NULL,
      confidence TEXT NOT NULL,
      line_number INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_module_aliases_alias_key ON module_aliases(alias_key);
    CREATE INDEX IF NOT EXISTS idx_module_aliases_file_id ON module_aliases(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_local_name ON symbols(local_name);
    CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name);
    CREATE INDEX IF NOT EXISTS idx_symbols_scope_tier ON symbols(scope_tier);
    CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_parent_symbol_id ON symbols(parent_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_module_exports_file_id ON module_exports(file_id);
    CREATE INDEX IF NOT EXISTS idx_module_exports_export_name ON module_exports(export_name);
    CREATE INDEX IF NOT EXISTS idx_module_exports_symbol_id ON module_exports(symbol_id);
    CREATE INDEX IF NOT EXISTS idx_module_exports_resolved_file_id ON module_exports(resolved_file_id);
    CREATE INDEX IF NOT EXISTS idx_symbol_references_source_symbol_id ON symbol_references(source_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_symbol_references_target_symbol_id ON symbol_references(target_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_symbol_references_target_name ON symbol_references(target_name);
    CREATE INDEX IF NOT EXISTS idx_symbol_references_edge_type ON symbol_references(edge_type);
    CREATE INDEX IF NOT EXISTS idx_symbol_references_confidence ON symbol_references(confidence);

    CREATE VIRTUAL TABLE IF NOT EXISTS symbol_fts USING fts5(
      local_name,
      qualified_name,
      export_names,
      identifier_terms,
      signature_text,
      doc_text,
      body_text,
      file_path,
      content='symbols',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1 tokenchars ''_-''',
      prefix='2 3'
    );

    CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
      INSERT INTO symbol_fts(rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
      VALUES (new.id, new.local_name, new.qualified_name, new.export_names, new.identifier_terms, new.signature_text, new.doc_text, new.body_text, new.file_path);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
      INSERT INTO symbol_fts(symbol_fts, rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
      VALUES ('delete', old.id, old.local_name, old.qualified_name, old.export_names, old.identifier_terms, old.signature_text, old.doc_text, old.body_text, old.file_path);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
      INSERT INTO symbol_fts(symbol_fts, rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
      VALUES ('delete', old.id, old.local_name, old.qualified_name, old.export_names, old.identifier_terms, old.signature_text, old.doc_text, old.body_text, old.file_path);
      INSERT INTO symbol_fts(rowid, local_name, qualified_name, export_names, identifier_terms, signature_text, doc_text, body_text, file_path)
      VALUES (new.id, new.local_name, new.qualified_name, new.export_names, new.identifier_terms, new.signature_text, new.doc_text, new.body_text, new.file_path);
    END;
  `)
}
```

```typescript
// codeindex/src/storage/queries.ts
import type { Database } from 'bun:sqlite'

export const clearFileRows = (db: Database, fileId: number): void => {
  db.query('DELETE FROM module_aliases WHERE file_id = ?').run(fileId)
  db.query('DELETE FROM module_exports WHERE file_id = ?').run(fileId)
  db.query('DELETE FROM symbol_references WHERE source_file_id = ?').run(fileId)
  db.query('DELETE FROM symbols WHERE file_id = ?').run(fileId)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/storage/db.ts codeindex/src/storage/schema.ts codeindex/src/storage/queries.ts tests/codeindex/storage.test.ts
git commit -m "feat(codeindex): add sqlite schema"
```

---

### Task 5: Implement module key, alias, and `tsconfig` path helpers

**Files:**

- Create: `codeindex/src/resolver/module-specifiers.ts`
- Create: `codeindex/src/resolver/tsconfig-paths.ts`
- Test: `tests/codeindex/module-specifiers.test.ts`
- Test: `tests/codeindex/tsconfig-paths.test.ts`

- [ ] **Step 1: Write the failing module alias tests**

```typescript
// tests/codeindex/module-specifiers.test.ts
import { describe, expect, test } from 'bun:test'

import { buildModuleIdentity } from '../../codeindex/src/resolver/module-specifiers.js'

describe('buildModuleIdentity', () => {
  test('keeps canonical index module keys and adds import-facing alias', () => {
    const identity = buildModuleIdentity('src/foo/index.ts')

    expect(identity.moduleKey).toBe('src/foo/index')
    expect(identity.aliases).toEqual([
      { aliasKey: 'src/foo/index', aliasKind: 'extensionless', precedence: 100 },
      { aliasKey: 'src/foo', aliasKind: 'index_collapse', precedence: 90 },
    ])
  })
})
```

```typescript
// tests/codeindex/tsconfig-paths.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { expandTsconfigAliasesForFile, loadTsconfigPathAliases } from '../../codeindex/src/resolver/tsconfig-paths.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-tsconfig-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('loadTsconfigPathAliases', () => {
  test('expands baseUrl and paths into alias rules', async () => {
    const repoRoot = makeTempDir()
    const tsconfigPath = path.join(repoRoot, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
      }),
    )

    const aliases = await loadTsconfigPathAliases([tsconfigPath])

    expect(aliases).toEqual([
      {
        pattern: '@/*',
        replacements: [path.join(repoRoot, 'src/*')],
      },
    ])

    expect(expandTsconfigAliasesForFile(path.join(repoRoot, 'src', 'db', 'drizzle.ts'), aliases)).toEqual([
      { aliasKey: '@/db/drizzle', aliasKind: 'tsconfig_path', precedence: 80 },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/codeindex/module-specifiers.test.ts tests/codeindex/tsconfig-paths.test.ts
```

Expected: FAIL with missing modules under `codeindex/src/resolver/`.

- [ ] **Step 3: Implement module identity and tsconfig alias loading**

```typescript
// codeindex/src/resolver/module-specifiers.ts
import path from 'node:path'

export interface ModuleAlias {
  readonly aliasKey: string
  readonly aliasKind: 'extensionless' | 'index_collapse' | 'tsconfig_path'
  readonly precedence: number
}

export interface ModuleIdentity {
  readonly moduleKey: string
  readonly aliases: readonly ModuleAlias[]
}

const stripExtension = (filePath: string): string => filePath.replace(/\.[^.]+$/, '')

export const buildModuleIdentity = (relativeFilePath: string): ModuleIdentity => {
  const normalized = relativeFilePath.split(path.sep).join('/')
  const moduleKey = stripExtension(normalized)
  const aliases: ModuleAlias[] = [
    {
      aliasKey: moduleKey,
      aliasKind: 'extensionless',
      precedence: 100,
    },
  ]

  if (moduleKey.endsWith('/index')) {
    aliases.push({
      aliasKey: moduleKey.slice(0, -'/index'.length),
      aliasKind: 'index_collapse',
      precedence: 90,
    })
  }

  return {
    moduleKey,
    aliases,
  }
}
```

```typescript
// codeindex/src/resolver/tsconfig-paths.ts
import path from 'node:path'
import * as ts from 'typescript'

export interface TsconfigAliasRule {
  readonly pattern: string
  readonly replacements: readonly string[]
}

interface TsconfigJson {
  readonly compilerOptions?: {
    readonly baseUrl?: string
    readonly paths?: Readonly<Record<string, readonly string[]>>
  }
}

const readTsconfig = (tsconfigPath: string): TsconfigJson => {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath), {}, tsconfigPath)
  const firstError = parsed.errors[0]
  if (firstError !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(firstError.messageText, '\n'))
  }

  return {
    compilerOptions: {
      baseUrl: parsed.options.baseUrl,
      paths: (parsed.options.paths ?? {}) as Readonly<Record<string, readonly string[]>>,
    },
  }
}

export const loadTsconfigPathAliases = async (
  tsconfigPaths: readonly string[],
): Promise<readonly TsconfigAliasRule[]> => {
  const ruleSets = await Promise.all(
    tsconfigPaths.map(async (tsconfigPath): Promise<readonly TsconfigAliasRule[]> => {
      const parsed = readTsconfig(tsconfigPath)
      const baseDir = path.dirname(tsconfigPath)
      const baseUrl = parsed.compilerOptions?.baseUrl ?? baseDir
      const resolvedBase = path.resolve(baseUrl)
      const paths = parsed.compilerOptions?.paths ?? {}

      return Object.entries(paths).map(([pattern, replacements]) => ({
        pattern,
        replacements: replacements.map((replacement) => path.resolve(resolvedBase, replacement)),
      }))
    }),
  )

  return ruleSets.flat()
}

export const expandTsconfigAliasesForFile = (
  absoluteFilePath: string,
  rules: readonly TsconfigAliasRule[],
): readonly {
  aliasKey: string
  aliasKind: 'tsconfig_path'
  precedence: number
}[] =>
  rules.flatMap((rule) =>
    rule.replacements.flatMap((replacement) => {
      const wildcardIndex = replacement.indexOf('*')
      if (wildcardIndex === -1) return []

      const replacementPrefix = replacement.slice(0, wildcardIndex)
      if (!absoluteFilePath.startsWith(replacementPrefix)) return []

      const suffix = absoluteFilePath
        .slice(replacementPrefix.length)
        .split(path.sep)
        .join('/')
        .replace(/\.[^.]+$/, '')

      return [
        {
          aliasKey: rule.pattern.replace('*', suffix),
          aliasKind: 'tsconfig_path',
          precedence: 80,
        },
      ]
    }),
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/codeindex/module-specifiers.test.ts tests/codeindex/tsconfig-paths.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/resolver/module-specifiers.ts codeindex/src/resolver/tsconfig-paths.ts tests/codeindex/module-specifiers.test.ts tests/codeindex/tsconfig-paths.test.ts
git commit -m "feat(codeindex): add module resolution helpers"
```

---

### Task 6: Extract symbols, doc comments, and identifier terms

**Files:**

- Create: `codeindex/src/indexer/extract-symbols.ts`
- Test: `tests/codeindex/extract-symbols.test.ts`

> **Tier 1 fixture scope (accepted gaps, tracked as follow-up):** the extraction fixture below covers exported top-level declarations, member definitions, and local block scope on plain TS. Tier 1 intentionally does **not** cover: TypeScript decorators (`@Injectable` etc.), ambient declarations (`declare function`, `declare class`), `declare module 'name' { ... }` augmentations, standalone `.d.ts` files, and type-only `export type` / `import type` statements. These should still parse without throwing (tree-sitter-typescript handles the syntax), but they may be skipped, mis-tiered, or under-indexed. File a Tier 2 follow-up before relying on the index for decorator-heavy code or declaration-file workflows.
>
> When a fixture gap bites during implementation, add a dedicated test case rather than silently expanding `extractSymbolsFromSource` scope.

- [ ] **Step 1: Write the failing symbol extraction test**

```typescript
// tests/codeindex/extract-symbols.test.ts
import { describe, expect, test } from 'bun:test'

import { createParserLoader } from '../../codeindex/src/indexer/parser.js'
import { extractSymbolsFromSource } from '../../codeindex/src/indexer/extract-symbols.js'

describe('extractSymbolsFromSource', () => {
  test('extracts exported, member, and local symbols with normalized identifier terms', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      '/** Build database client */',
      'export function getDrizzleDb() {',
      '  function makeInnerHelper() {',
      '    const storage_context_id = 1',
      '    return storage_context_id',
      '  }',
      '  return makeInnerHelper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    const symbols = extractSymbolsFromSource({
      source,
      tree,
      relativeFilePath: 'src/db/drizzle.ts',
      moduleKey: 'src/db/drizzle',
      maxStoredBodyLines: 120,
      includeDocComments: true,
    })

    expect(symbols.map((symbol) => symbol.qualifiedName)).toEqual([
      'src/db/drizzle#getDrizzleDb',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper>storage_context_id',
    ])
    expect(symbols[0]?.scopeTier).toBe('exported')
    expect(symbols[0]?.docText).toContain('Build database client')
    expect(symbols[0]?.identifierTerms).toContain('get drizzle db')
    expect(symbols[2]?.identifierTerms).toContain('storage context id')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/extract-symbols.test.ts
```

Expected: FAIL with `Cannot find module '../../codeindex/src/indexer/extract-symbols.js'`.

- [ ] **Step 3: Implement symbol extraction and identifier normalization**

```typescript
// codeindex/src/indexer/extract-symbols.ts
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

import type { ScopeTier } from '../types.js'

export interface ExtractedSymbol {
  readonly symbolKey: string
  readonly localName: string
  readonly qualifiedName: string
  readonly kind: string
  readonly scopeTier: 'exported' | 'module' | 'member' | 'local'
  readonly exportNames: readonly string[]
  readonly signatureText: string
  readonly docText: string
  readonly bodyText: string
  readonly identifierTerms: string
  readonly startLine: number
  readonly endLine: number
  readonly startByte: number
  readonly endByte: number
  readonly parentQualifiedName: string | null
}

export interface ExtractSymbolsInput {
  readonly source: string
  readonly tree: Tree
  readonly relativeFilePath: string
  readonly moduleKey: string
  readonly maxStoredBodyLines: number
  readonly includeDocComments: boolean
}

interface WalkContext {
  readonly exported: boolean
  readonly parentQualifiedName: string | null
}

const declarationTypes = new Set([
  'class_declaration',
  'function_declaration',
  'interface_declaration',
  'lexical_declaration',
  'method_definition',
  'public_field_definition',
  'type_alias_declaration',
  'variable_declarator',
])

const memberTypes = new Set(['method_definition', 'public_field_definition'])

const normalizeIdentifierTerms = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim()

const sliceNodeText = (source: string, node: SyntaxNode): string => source.slice(node.startIndex, node.endIndex)

const clipBody = (body: string, maxLines: number): string => body.split('\n').slice(0, maxLines).join('\n')

const readLeadingDocComment = (sourceLines: readonly string[], startLine: number): string => {
  const collected: string[] = []

  for (let line = startLine - 1; line >= 0; line -= 1) {
    const current = sourceLines[line]?.trim() ?? ''
    if (current === '') break
    collected.unshift(current)
    if (current.startsWith('/**')) return collected.join('\n')
    if (!current.startsWith('*') && !current.endsWith('*/')) break
  }

  return ''
}

const nameForNode = (node: SyntaxNode): string | null => {
  if (node.type === 'lexical_declaration') return null
  return node.childForFieldName('name')?.text ?? null
}

const scopeTierForNode = (node: SyntaxNode, context: Readonly<WalkContext>): ScopeTier => {
  if (context.exported) return 'exported'
  if (memberTypes.has(node.type)) return 'member'
  return context.parentQualifiedName === null ? 'module' : 'local'
}

export const extractSymbolsFromSource = (input: Readonly<ExtractSymbolsInput>): readonly ExtractedSymbol[] => {
  const symbols: ExtractedSymbol[] = []
  const sourceLines = input.source.split('\n')

  const visit = (node: SyntaxNode, context: Readonly<WalkContext>): void => {
    if (node.type === 'export_statement') {
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (child !== null) visit(child, { ...context, exported: true })
      }
      return
    }

    const localName = declarationTypes.has(node.type) ? nameForNode(node) : null

    if (localName !== null) {
      const qualifiedName =
        context.parentQualifiedName === null
          ? `${input.moduleKey}#${localName}`
          : `${context.parentQualifiedName}>${localName}`
      const scopeTier = scopeTierForNode(node, context)
      const docText = input.includeDocComments ? readLeadingDocComment(sourceLines, node.startPosition.row) : ''

      symbols.push({
        symbolKey: `${input.relativeFilePath}#${node.startIndex}-${node.endIndex}`,
        localName,
        qualifiedName,
        kind: node.type,
        scopeTier,
        exportNames: context.exported ? [localName] : [],
        signatureText: sourceLines[node.startPosition.row]?.trim() ?? localName,
        docText,
        bodyText: clipBody(sliceNodeText(input.source, node), input.maxStoredBodyLines),
        identifierTerms: normalizeIdentifierTerms(localName),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        parentQualifiedName: context.parentQualifiedName,
      })

      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (child !== null) {
          visit(child, {
            exported: false,
            parentQualifiedName: qualifiedName,
          })
        }
      }

      return
    }

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index)
      if (child !== null) visit(child, context)
    }
  }

  visit(input.tree.rootNode, { exported: false, parentQualifiedName: null })

  return symbols.filter((symbol) => symbol.kind !== 'program')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/extract-symbols.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/indexer/extract-symbols.ts tests/codeindex/extract-symbols.test.ts
git commit -m "feat(codeindex): extract symbols and identifier terms"
```

---

### Task 7: Extract reference candidates and export metadata

**Files:**

- Create: `codeindex/src/indexer/extract-references.ts`
- Test: `tests/codeindex/extract-references.test.ts`

- [ ] **Step 1: Write the failing reference extraction test**

```typescript
// tests/codeindex/extract-references.test.ts
import { describe, expect, test } from 'bun:test'

import { createParserLoader } from '../../codeindex/src/indexer/parser.js'
import { extractReferenceCandidates } from '../../codeindex/src/indexer/extract-references.js'

describe('extractReferenceCandidates', () => {
  test('captures imports, reexports, and call references', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      "import { helper } from './helper.js'",
      "export { helper as publicHelper } from './helper.js'",
      'export function runTask() {',
      '  return helper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    const references = extractReferenceCandidates({
      source,
      tree,
      relativeFilePath: 'src/run-task.ts',
      moduleKey: 'src/run-task',
    })

    expect(references.moduleExports).toEqual([
      {
        exportName: 'publicHelper',
        exportKind: 'reexport',
        localName: 'helper',
        targetModuleSpecifier: './helper.js',
      },
      {
        exportName: 'runTask',
        exportKind: 'named',
        localName: 'runTask',
        targetModuleSpecifier: null,
      },
    ])
    expect(references.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeType: 'imports', targetName: 'helper', targetModuleSpecifier: './helper.js' }),
        expect.objectContaining({ edgeType: 'calls', targetName: 'helper' }),
      ]),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/extract-references.test.ts
```

Expected: FAIL with `Cannot find module '../../codeindex/src/indexer/extract-references.js'`.

- [ ] **Step 3: Implement reference candidate extraction**

```typescript
// codeindex/src/indexer/extract-references.ts
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

export interface ModuleExportCandidate {
  readonly exportName: string
  readonly exportKind: 'named' | 'default' | 'namespace' | 'reexport'
  readonly localName: string | null
  readonly targetModuleSpecifier: string | null
}

export interface ReferenceCandidate {
  readonly sourceQualifiedName: string | null
  readonly edgeType: 'imports' | 'reexports' | 'calls' | 'extends' | 'implements' | 'references'
  readonly targetName: string
  readonly targetExportName: string | null
  readonly targetModuleSpecifier: string | null
  readonly lineNumber: number
}

export interface ExtractReferenceCandidatesInput {
  readonly source: string
  readonly tree: Tree
  readonly relativeFilePath: string
  readonly moduleKey: string
}

export interface ExtractReferenceCandidatesResult {
  readonly moduleExports: readonly ModuleExportCandidate[]
  readonly references: readonly ReferenceCandidate[]
}

export const extractReferenceCandidates = (
  input: Readonly<ExtractReferenceCandidatesInput>,
): ExtractReferenceCandidatesResult => {
  const moduleExports: ModuleExportCandidate[] = []
  const references: ReferenceCandidate[] = []

  const visit = (node: SyntaxNode, enclosingSymbol: string | null): void => {
    if (node.type === 'export_statement') {
      const sourceSpecifier = node.childForFieldName('source')?.text.replaceAll("'", '').replaceAll('"', '') ?? null

      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (child === null) continue

        if (child.type === 'function_declaration') {
          const functionName = child.childForFieldName('name')?.text
          if (functionName !== undefined) {
            moduleExports.push({
              exportName: functionName,
              exportKind: 'named',
              localName: functionName,
              targetModuleSpecifier: null,
            })
          }
          visit(child, enclosingSymbol)
          continue
        }

        if (child.type === 'export_specifier') {
          const localName = child.childForFieldName('name')?.text ?? null
          const exportName = child.childForFieldName('alias')?.text ?? localName ?? child.text
          moduleExports.push({
            exportName,
            exportKind: sourceSpecifier === null ? 'named' : 'reexport',
            localName,
            targetModuleSpecifier: sourceSpecifier,
          })
          continue
        }

        visit(child, enclosingSymbol)
      }

      return
    }

    if (node.type === 'import_specifier') {
      const imported = node.childForFieldName('name')?.text ?? node.text
      const importStatement = node.parent?.parent
      const moduleSpecifier =
        importStatement?.childForFieldName('source')?.text.replaceAll("'", '').replaceAll('"', '') ?? null
      references.push({
        sourceQualifiedName: null,
        edgeType: 'imports',
        targetName: imported,
        targetExportName: imported,
        targetModuleSpecifier: moduleSpecifier,
        lineNumber: node.startPosition.row + 1,
      })
    }

    if (node.type === 'function_declaration') {
      const functionName = node.childForFieldName('name')?.text
      const nextEnclosing =
        functionName === undefined
          ? enclosingSymbol
          : enclosingSymbol === null
            ? `${input.moduleKey}#${functionName}`
            : `${enclosingSymbol}>${functionName}`
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (child !== null) visit(child, nextEnclosing)
      }
      return
    }

    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function')
      const targetName = functionNode?.text ?? node.text
      references.push({
        sourceQualifiedName: enclosingSymbol,
        edgeType: 'calls',
        targetName,
        targetExportName: null,
        targetModuleSpecifier: null,
        lineNumber: node.startPosition.row + 1,
      })
    }

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index)
      if (child !== null) visit(child, enclosingSymbol)
    }
  }

  visit(input.tree.rootNode, null)

  return {
    moduleExports,
    references,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/extract-references.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/indexer/extract-references.ts tests/codeindex/extract-references.test.ts
git commit -m "feat(codeindex): extract reference candidates"
```

---

### Task 8: Implement resolver-backed symbol and reference resolution

**Files:**

- Create: `codeindex/src/resolver/resolve-references.ts`
- Test: `tests/codeindex/resolve-references.test.ts`

- [ ] **Step 1: Write the failing resolver test**

```typescript
// tests/codeindex/resolve-references.test.ts
import { describe, expect, test } from 'bun:test'

import { resolveReferenceCandidates } from '../../codeindex/src/resolver/resolve-references.js'

describe('resolveReferenceCandidates', () => {
  test('prefers exact module export matches over name-only fallback', () => {
    const resolved = resolveReferenceCandidates({
      symbols: [
        {
          id: 1,
          qualifiedName: 'src/helper#helper',
          localName: 'helper',
          moduleKey: 'src/helper',
          exportNames: ['helper'],
        },
      ],
      moduleAliases: [{ aliasKey: 'src/helper', fileId: 10 }],
      files: [{ id: 10, moduleKey: 'src/helper' }],
      references: [
        {
          sourceQualifiedName: 'src/run-task#runTask',
          edgeType: 'imports',
          targetName: 'helper',
          targetExportName: 'helper',
          targetModuleSpecifier: './helper',
          lineNumber: 1,
        },
        {
          sourceQualifiedName: 'src/run-task#runTask',
          edgeType: 'calls',
          targetName: 'helper',
          targetExportName: null,
          targetModuleSpecifier: null,
          lineNumber: 3,
        },
      ],
      currentModuleKey: 'src/run-task',
    })

    expect(resolved).toEqual([
      expect.objectContaining({ edgeType: 'imports', targetSymbolId: 1, confidence: 'resolved' }),
      expect.objectContaining({ edgeType: 'calls', targetSymbolId: 1, confidence: 'resolved' }),
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/resolve-references.test.ts
```

Expected: FAIL with missing `resolve-references.js`.

- [ ] **Step 3: Implement the resolver**

```typescript
// codeindex/src/resolver/resolve-references.ts
import path from 'node:path'

type SymbolSummary = {
  readonly id: number
  readonly qualifiedName: string
  readonly localName: string
  readonly moduleKey: string
  readonly exportNames: readonly string[]
}

type ModuleAliasSummary = {
  readonly aliasKey: string
  readonly fileId: number
}

type FileSummary = {
  readonly id: number
  readonly moduleKey: string
}

type ReferenceCandidate = {
  readonly sourceQualifiedName: string | null
  readonly edgeType: 'imports' | 'reexports' | 'calls' | 'extends' | 'implements' | 'references'
  readonly targetName: string
  readonly targetExportName: string | null
  readonly targetModuleSpecifier: string | null
  readonly lineNumber: number
}

export interface ResolveReferenceCandidatesInput {
  readonly symbols: readonly SymbolSummary[]
  readonly moduleAliases: readonly ModuleAliasSummary[]
  readonly files: readonly FileSummary[]
  readonly references: readonly ReferenceCandidate[]
  readonly currentModuleKey: string
}

export interface ResolvedReference {
  readonly sourceSymbolId: number | null
  readonly sourceQualifiedName: string | null
  readonly edgeType: ReferenceCandidate['edgeType']
  readonly targetName: string
  readonly targetExportName: string | null
  readonly targetModuleSpecifier: string | null
  readonly targetSymbolId: number | null
  readonly confidence: 'resolved' | 'file_resolved' | 'name_only'
  readonly lineNumber: number
}

const normalizeRelativeModule = (fromModuleKey: string, specifier: string): string => {
  if (!specifier.startsWith('.')) return specifier
  const parentDir = path.posix.dirname(fromModuleKey)
  return path.posix.normalize(path.posix.join(parentDir, specifier)).replace(/\.[^.]+$/, '')
}

export const resolveReferenceCandidates = (
  input: Readonly<ResolveReferenceCandidatesInput>,
): readonly ResolvedReference[] => {
  return input.references.map((reference) => {
    const sourceSymbol =
      reference.sourceQualifiedName === null
        ? undefined
        : input.symbols.find((symbol) => symbol.qualifiedName === reference.sourceQualifiedName)

    const normalizedSpecifier =
      reference.targetModuleSpecifier === null
        ? null
        : normalizeRelativeModule(input.currentModuleKey, reference.targetModuleSpecifier)

    const matchedFileId =
      normalizedSpecifier === null
        ? null
        : (input.moduleAliases.find((alias) => alias.aliasKey === normalizedSpecifier)?.fileId ??
          input.files.find((file) => file.moduleKey === normalizedSpecifier)?.id ??
          null)

    const resolvedByExport =
      matchedFileId === null
        ? undefined
        : input.symbols.find(
            (symbol) =>
              symbol.exportNames.includes(reference.targetExportName ?? reference.targetName) &&
              input.files.find((file) => file.id === matchedFileId)?.moduleKey === symbol.moduleKey,
          )

    const resolvedByName = input.symbols.find((symbol) => symbol.localName === reference.targetName)

    if (resolvedByExport !== undefined) {
      return {
        sourceSymbolId: sourceSymbol?.id ?? null,
        ...reference,
        targetSymbolId: resolvedByExport.id,
        confidence: 'resolved',
      }
    }

    if (resolvedByName !== undefined) {
      return {
        sourceSymbolId: sourceSymbol?.id ?? null,
        ...reference,
        targetSymbolId: resolvedByName.id,
        confidence: matchedFileId === null ? 'name_only' : 'file_resolved',
      }
    }

    return {
      sourceSymbolId: sourceSymbol?.id ?? null,
      ...reference,
      targetSymbolId: null,
      confidence: matchedFileId === null ? 'name_only' : 'file_resolved',
    }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/resolve-references.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/resolver/resolve-references.ts tests/codeindex/resolve-references.test.ts
git commit -m "feat(codeindex): resolve references with confidence"
```

---

### Task 9: Build full indexing and storage persistence

**Files:**

- Create: `codeindex/src/indexer/index-codebase.ts`
- Test: `tests/codeindex/index-codebase.test.ts`

- [ ] **Step 1: Write the failing full-indexing test**

```typescript
// tests/codeindex/index-codebase.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { indexCodebase } from '../../codeindex/src/indexer/index-codebase.js'
import { loadCodeindexConfig } from '../../codeindex/src/config.js'

const tempDirs: string[] = []

const makeRepo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-index-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('indexCodebase', () => {
  test('indexes a small repo and reports counts', async () => {
    const repoRoot = makeRepo()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
    writeFileSync(
      path.join(repoRoot, 'src', 'run-task.ts'),
      "import { helper } from './helper'\nexport function runTask() { return helper() }\n",
    )
    writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

    const config = await loadCodeindexConfig({
      configPath: path.join(repoRoot, '.codeindex.json'),
      repoRoot,
    })

    const summary = await indexCodebase({ config, mode: 'full' })

    expect(summary.filesIndexed).toBe(2)
    expect(summary.symbolsIndexed).toBeGreaterThanOrEqual(2)
    expect(summary.referencesIndexed).toBeGreaterThanOrEqual(1)
    expect(summary.filesFailed).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/index-codebase.test.ts
```

Expected: FAIL with missing `index-codebase.js`.

- [ ] **Step 3: Implement full indexing flow**

```typescript
// codeindex/src/indexer/index-codebase.ts
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Database } from 'bun:sqlite'

import type { CodeindexConfig } from '../config.js'
import { buildModuleIdentity, type ModuleAlias } from '../resolver/module-specifiers.js'
import { expandTsconfigAliasesForFile, loadTsconfigPathAliases } from '../resolver/tsconfig-paths.js'
import { openDatabase } from '../storage/db.js'
import { clearFileRows } from '../storage/queries.js'
import { ensureSchema } from '../storage/schema.js'
import { resolveReferenceCandidates } from '../resolver/resolve-references.js'
import { discoverSourceFiles } from './discover.js'
import { extractReferenceCandidates, type ExtractReferenceCandidatesResult } from './extract-references.js'
import { extractSymbolsFromSource, type ExtractedSymbol } from './extract-symbols.js'
import { createParserLoader } from './parser.js'

export interface IndexSummary {
  readonly filesIndexed: number
  readonly filesFailed: number
  readonly symbolsIndexed: number
  readonly referencesIndexed: number
  readonly referencesUnresolved: number
  readonly elapsedMs: number
}

export interface IndexCodebaseInput {
  readonly config: CodeindexConfig
  readonly mode: 'full' | 'incremental'
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

interface ParsedFileWorkItem {
  readonly aliases: readonly ModuleAlias[]
  readonly fileId: number
  readonly filePath: string
  readonly moduleKey: string
  readonly referenceCandidates: ExtractReferenceCandidatesResult
  readonly symbols: readonly ExtractedSymbol[]
}

const insertFile = (
  db: Database,
  values: { filePath: string; moduleKey: string; language: string; fileHash: string },
): number => {
  db.query(
    `INSERT INTO files (file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
       VALUES (?, ?, ?, ?, 'indexed', NULL, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET
         module_key = excluded.module_key,
         language = excluded.language,
         file_hash = excluded.file_hash,
         parse_status = 'indexed',
         parse_error = NULL,
         indexed_at = datetime('now')`,
  ).run(values.filePath, values.moduleKey, values.language, values.fileHash)

  const row = db.query<{ id: number }, [string]>('SELECT id FROM files WHERE file_path = ?').get(values.filePath)
  if (row === null) throw new Error(`Missing file row for ${values.filePath}`)
  return row.id
}

export const indexCodebase = async (input: Readonly<IndexCodebaseInput>): Promise<IndexSummary> => {
  const startedAt = Date.now()
  const db = openDatabase(input.config.dbPath)
  ensureSchema(db)
  const parserLoader = await createParserLoader()
  const tsconfigAliases = await loadTsconfigPathAliases(input.config.tsconfigPaths)

  const files = await discoverSourceFiles({
    repoRoot: input.config.repoRoot,
    roots: input.config.roots,
    exclude: input.config.exclude,
    languages: input.config.languages,
  })

  let filesIndexed = 0
  let filesFailed = 0
  let symbolsIndexed = 0
  let referencesIndexed = 0
  let referencesUnresolved = 0
  const parsedFiles: ParsedFileWorkItem[] = []

  for (const file of files) {
    try {
      const source = await readFile(file.absolutePath, 'utf8')
      const fileHash = sha256(source)
      const { moduleKey, aliases } = buildModuleIdentity(file.relativePath)
      const tsconfigPathAliases = expandTsconfigAliasesForFile(file.absolutePath, tsconfigAliases)
      const allAliases = [...aliases, ...tsconfigPathAliases]
      const parsed = await parserLoader.createParserForExtension(file.extension)
      const tree = parsed.parser.parse(source)
      const symbols = extractSymbolsFromSource({
        source,
        tree,
        relativeFilePath: file.relativePath,
        moduleKey,
        maxStoredBodyLines: input.config.maxStoredBodyLines,
        includeDocComments: input.config.includeDocComments,
      })
      const referenceCandidates = extractReferenceCandidates({
        source,
        tree,
        relativeFilePath: file.relativePath,
        moduleKey,
      })

      const fileId = insertFile(db, {
        filePath: file.relativePath,
        moduleKey,
        language: parsed.language,
        fileHash,
      })

      clearFileRows(db, fileId)

      for (const alias of allAliases) {
        db.query('INSERT INTO module_aliases (file_id, alias_key, alias_kind, precedence) VALUES (?, ?, ?, ?)').run(
          fileId,
          alias.aliasKey,
          alias.aliasKind,
          alias.precedence,
        )
      }

      for (const symbol of symbols) {
        db.query(
          `INSERT INTO symbols (
              file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier,
              parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms,
              start_line, end_line, start_byte, end_byte
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          fileId,
          file.relativePath,
          moduleKey,
          symbol.symbolKey,
          symbol.localName,
          symbol.qualifiedName,
          symbol.kind,
          symbol.scopeTier,
          symbol.scopeTier === 'exported' ? 1 : 0,
          JSON.stringify(symbol.exportNames),
          symbol.signatureText,
          symbol.docText,
          symbol.bodyText,
          symbol.identifierTerms,
          symbol.startLine,
          symbol.endLine,
          symbol.startByte,
          symbol.endByte,
        )
        symbolsIndexed += 1
      }

      const storedSymbols = db
        .query<
          { id: number; qualified_name: string; local_name: string; module_key: string; export_names: string },
          [number]
        >('SELECT id, qualified_name, local_name, module_key, export_names FROM symbols WHERE file_id = ?')
        .all(fileId)
        .map((row) => ({
          id: row.id,
          qualifiedName: row.qualified_name,
          localName: row.local_name,
          moduleKey: row.module_key,
          exportNames: JSON.parse(row.export_names) as readonly string[],
        }))

      for (const moduleExport of referenceCandidates.moduleExports) {
        const matchingSymbol = storedSymbols.find((symbol) => symbol.localName === moduleExport.localName)
        db.query(
          'INSERT INTO module_exports (file_id, export_name, export_kind, symbol_id, target_module_specifier, resolved_file_id) VALUES (?, ?, ?, ?, ?, NULL)',
        ).run(
          fileId,
          moduleExport.exportName,
          moduleExport.exportKind,
          matchingSymbol?.id ?? null,
          moduleExport.targetModuleSpecifier,
        )
      }

      parsedFiles.push({
        aliases: allAliases,
        fileId,
        filePath: file.relativePath,
        moduleKey,
        referenceCandidates,
        symbols,
      })

      filesIndexed += 1
    } catch (error) {
      filesFailed += 1
      const message = error instanceof Error ? error.message : String(error)
      db.query(
        `INSERT INTO files (file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
           VALUES (?, ?, ?, '', 'parse_failed', ?, datetime('now'))
           ON CONFLICT(file_path) DO UPDATE SET parse_status = 'parse_failed', parse_error = excluded.parse_error, indexed_at = datetime('now')`,
      ).run(file.relativePath, file.relativePath.replace(/\.[^.]+$/, ''), 'ts', message)
    }
  }

  const allSymbols = db
    .query<{ id: number; qualified_name: string; local_name: string; module_key: string; export_names: string }, []>(
      'SELECT id, qualified_name, local_name, module_key, export_names FROM symbols',
    )
    .all()
    .map((row) => ({
      id: row.id,
      qualifiedName: row.qualified_name,
      localName: row.local_name,
      moduleKey: row.module_key,
      exportNames: JSON.parse(row.export_names) as readonly string[],
    }))

  const allFiles = db
    .query<{ id: number; module_key: string }, [string]>('SELECT id, module_key FROM files WHERE parse_status = ?')
    .all('indexed')
    .map((row) => ({
      id: row.id,
      moduleKey: row.module_key,
    }))

  const allModuleAliases = db
    .query<{ alias_key: string; file_id: number }, []>('SELECT alias_key, file_id FROM module_aliases')
    .all()
    .map((row) => ({
      aliasKey: row.alias_key,
      fileId: row.file_id,
    }))

  for (const parsedFile of parsedFiles) {
    const resolvedReferences = resolveReferenceCandidates({
      symbols: allSymbols,
      moduleAliases: allModuleAliases,
      files: allFiles,
      references: parsedFile.referenceCandidates.references,
      currentModuleKey: parsedFile.moduleKey,
    })

    for (const reference of resolvedReferences) {
      db.query(
        'INSERT INTO symbol_references (source_symbol_id, source_file_id, target_symbol_id, target_name, target_export_name, target_module_specifier, edge_type, confidence, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        reference.sourceSymbolId,
        parsedFile.fileId,
        reference.targetSymbolId,
        reference.targetName,
        reference.targetExportName,
        reference.targetModuleSpecifier,
        reference.edgeType,
        reference.confidence,
        reference.lineNumber,
      )
      referencesIndexed += 1
      if (reference.targetSymbolId === null) referencesUnresolved += 1
    }
  }

  db.close()

  return {
    filesIndexed,
    filesFailed,
    symbolsIndexed,
    referencesIndexed,
    referencesUnresolved,
    elapsedMs: Date.now() - startedAt,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/index-codebase.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/indexer/index-codebase.ts tests/codeindex/index-codebase.test.ts
git commit -m "feat(codeindex): index symbols into sqlite"
```

---

### Task 10: Implement exact search, FTS search, and structural reranking

**Files:**

- Create: `codeindex/src/search/exact.ts`
- Create: `codeindex/src/search/fts.ts`
- Create: `codeindex/src/search/rank.ts`
- Create: `codeindex/src/search/index.ts`
- Test: `tests/codeindex/search.test.ts`

- [ ] **Step 1: Write the failing search ranking test**

```typescript
// tests/codeindex/search.test.ts
import { describe, expect, test } from 'bun:test'

import { rerankSearchResults } from '../../codeindex/src/search/rank.js'

describe('rerankSearchResults', () => {
  test('prefers exported and module-level hits over locals', () => {
    const ranked = rerankSearchResults([
      {
        symbolKey: 'a',
        qualifiedName: 'src/foo#helper',
        localName: 'helper',
        kind: 'function_declaration',
        scopeTier: 'local',
        filePath: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        exportNames: [],
        matchReason: 'exact local_name',
        confidence: 'resolved',
        snippet: 'function helper() {}',
      },
      {
        symbolKey: 'b',
        qualifiedName: 'src/bar#helper',
        localName: 'helper',
        kind: 'function_declaration',
        scopeTier: 'exported',
        filePath: 'src/bar.ts',
        startLine: 1,
        endLine: 1,
        exportNames: ['helper'],
        matchReason: 'exact export_names',
        confidence: 'resolved',
        snippet: 'export function helper() {}',
      },
    ])

    expect(ranked.map((entry) => entry.symbolKey)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/search.test.ts
```

Expected: FAIL with missing search modules.

- [ ] **Step 3: Implement search passes and reranking**

```typescript
// codeindex/src/search/rank.ts
import type { SearchResult } from '../types.js'

const scopeScore = (scopeTier: SearchResult['scopeTier']): number => {
  switch (scopeTier) {
    case 'exported':
      return 400
    case 'module':
      return 300
    case 'member':
      return 200
    case 'local':
      return 100
  }
}

const matchScore = (matchReason: string): number => {
  if (matchReason.includes('exact export_names')) return 500
  if (matchReason.includes('exact qualified_name')) return 450
  if (matchReason.includes('exact local_name')) return 425
  return 0
}

export const rerankSearchResults = (results: readonly SearchResult[]): readonly SearchResult[] =>
  [...results].sort(
    (left, right) =>
      matchScore(right.matchReason) +
      scopeScore(right.scopeTier) -
      (matchScore(left.matchReason) + scopeScore(left.scopeTier)),
  )
```

```typescript
// codeindex/src/search/exact.ts
import type { Database } from 'bun:sqlite'

import type { ScopeTier, SearchResult } from '../types.js'

export interface SearchFilters {
  readonly kinds?: readonly string[]
  readonly scopeTiers?: readonly ScopeTier[]
  readonly pathPrefix?: string
}

const applyFilters = <T extends Pick<SearchResult, 'filePath' | 'kind' | 'scopeTier'>>(
  results: readonly T[],
  filters: Readonly<SearchFilters>,
): readonly T[] =>
  results.filter((result) => {
    if (filters.kinds !== undefined && !filters.kinds.includes(result.kind)) return false
    if (filters.scopeTiers !== undefined && !filters.scopeTiers.includes(result.scopeTier)) return false
    if (filters.pathPrefix !== undefined && !result.filePath.startsWith(filters.pathPrefix)) return false
    return true
  })

export const runExactSearch = (
  db: Database,
  query: string,
  limit: number,
  filters: Readonly<SearchFilters>,
): readonly SearchResult[] =>
  applyFilters(
    db
      .query<
        {
          symbol_key: string
          qualified_name: string
          local_name: string
          kind: string
          scope_tier: SearchResult['scopeTier']
          file_path: string
          start_line: number
          end_line: number
          export_names: string
          matched_export_name: string | null
        },
        [string, string, string, string, string, number]
      >(
        `SELECT symbols.symbol_key, symbols.qualified_name, symbols.local_name, symbols.kind, symbols.scope_tier,
              symbols.file_path, symbols.start_line, symbols.end_line, symbols.export_names,
              module_exports.export_name AS matched_export_name
       FROM symbols
       LEFT JOIN module_exports ON module_exports.symbol_id = symbols.id AND module_exports.export_name = ?
       WHERE symbols.local_name = ?
          OR symbols.qualified_name = ?
          OR module_exports.export_name = ?
          OR symbols.file_path LIKE ?
       LIMIT ?`,
      )
      .all(query, query, query, query, `${query}%`, limit)
      .map((row) => ({
        symbolKey: row.symbol_key,
        qualifiedName: row.qualified_name,
        localName: row.local_name,
        kind: row.kind,
        scopeTier: row.scope_tier,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        exportNames: JSON.parse(row.export_names) as readonly string[],
        matchReason:
          row.matched_export_name === query
            ? 'exact export_names'
            : row.qualified_name === query
              ? 'exact qualified_name'
              : row.local_name === query
                ? 'exact local_name'
                : 'exact file_path',
        confidence: 'exact',
        snippet: row.qualified_name,
      })),
    filters,
  )
```

```typescript
// codeindex/src/search/fts.ts
import type { Database } from 'bun:sqlite'

import type { SearchResult } from '../types.js'

import type { SearchFilters } from './exact.js'

const applyFilters = (results: readonly SearchResult[], filters: Readonly<SearchFilters>): readonly SearchResult[] =>
  results.filter((result) => {
    if (filters.kinds !== undefined && !filters.kinds.includes(result.kind)) return false
    if (filters.scopeTiers !== undefined && !filters.scopeTiers.includes(result.scopeTier)) return false
    if (filters.pathPrefix !== undefined && !result.filePath.startsWith(filters.pathPrefix)) return false
    return true
  })

export const runFtsSearch = (
  db: Database,
  query: string,
  limit: number,
  filters: Readonly<SearchFilters>,
): readonly SearchResult[] =>
  applyFilters(
    db
      .query<
        {
          symbol_key: string
          qualified_name: string
          local_name: string
          kind: string
          scope_tier: SearchResult['scopeTier']
          file_path: string
          start_line: number
          end_line: number
          export_names: string
          snippet: string
        },
        [string, number]
      >(
        `SELECT symbols.symbol_key, symbols.qualified_name, symbols.local_name, symbols.kind, symbols.scope_tier,
              symbols.file_path, symbols.start_line, symbols.end_line, symbols.export_names,
              snippet(symbol_fts, 5, '[', ']', '...', 12) AS snippet
       FROM symbol_fts
       JOIN symbols ON symbols.id = symbol_fts.rowid
       WHERE symbol_fts MATCH ?
       ORDER BY bm25(symbol_fts, 10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 2.0, 1.0)
       LIMIT ?`,
      )
      .all(query, limit)
      .map((row) => ({
        symbolKey: row.symbol_key,
        qualifiedName: row.qualified_name,
        localName: row.local_name,
        kind: row.kind,
        scopeTier: row.scope_tier,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        exportNames: JSON.parse(row.export_names) as readonly string[],
        matchReason: 'fts identifier_terms/doc_text/body_text',
        confidence: 'resolved',
        snippet: row.snippet,
      })),
    filters,
  )
```

```typescript
// codeindex/src/search/index.ts
import { Database } from 'bun:sqlite'

import { runExactSearch, type SearchFilters } from './exact.js'
import { runFtsSearch } from './fts.js'
import { rerankSearchResults } from './rank.js'

export const searchSymbols = (
  db: Database,
  input: Readonly<{ query: string; limit: number } & SearchFilters>,
): ReturnType<typeof rerankSearchResults> => {
  const exactResults = runExactSearch(db, input.query, input.limit, input)
  const ftsResults = runFtsSearch(db, input.query, input.limit, input)
  const merged = [...exactResults]

  for (const result of ftsResults) {
    if (!merged.some((existing) => existing.symbolKey === result.symbolKey)) {
      merged.push(result)
    }
  }

  return rerankSearchResults(merged).slice(0, input.limit)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test tests/codeindex/search.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/search/exact.ts codeindex/src/search/fts.ts codeindex/src/search/rank.ts codeindex/src/search/index.ts tests/codeindex/search.test.ts
git commit -m "feat(codeindex): add ranked symbol search"
```

---

### Task 11: Implement `code_symbol`, `code_impact`, and MCP server surface

**Files:**

- Create: `codeindex/src/mcp/tools.ts`
- Create: `codeindex/src/mcp/server.ts`
- Modify: `codeindex/src/search/index.ts`
- Test: `tests/codeindex/impact.test.ts`
- Test: `tests/codeindex/mcp.test.ts`

- [ ] **Step 0: Verify MCP SDK surface via `context7`**

Resolve `@modelcontextprotocol/sdk` via `context7` and confirm:

- `McpServer` still lives at `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` still lives at `@modelcontextprotocol/sdk/server/stdio.js`
- `server.registerTool(name, { description, inputSchema }, handler)` is the documented registration API; the legacy `server.tool(name, description, zodShape, handler)` signature still works in `@modelcontextprotocol/sdk@^1.29` but is deprecated. The plan below uses `registerTool` with a full Zod object (not `.shape`) as the `inputSchema`.

Pin the actual installed version in `codeindex/package.json`.

- [ ] **Step 1: Write the failing impact and MCP tests**

```typescript
// tests/codeindex/impact.test.ts
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import { ensureSchema } from '../../codeindex/src/storage/schema.js'
import { findSymbolCandidates, findIncomingReferences } from '../../codeindex/src/search/index.js'

describe('symbol resolution and impact', () => {
  test('returns symbol candidates and module-level importers', () => {
    const db = new Database(':memory:')
    ensureSchema(db)

    db.query(
      `INSERT INTO files (id, file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at) VALUES (1, 'src/helper.ts', 'src/helper', 'ts', 'x', 'indexed', NULL, datetime('now'))`,
    ).run()
    db.query(
      `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier, parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms, start_line, end_line, start_byte, end_byte) VALUES (1, 1, 'src/helper.ts', 'src/helper', 'src/helper.ts#0-20', 'helper', 'src/helper#helper', 'function_declaration', 'exported', NULL, 1, '["helper"]', 'export function helper()', '', 'export function helper() {}', 'helper', 1, 1, 0, 20)`,
    ).run()
    db.query(
      `INSERT INTO symbol_references (source_symbol_id, source_file_id, target_symbol_id, target_name, target_export_name, target_module_specifier, edge_type, confidence, line_number) VALUES (NULL, 1, 1, 'helper', 'helper', './helper', 'imports', 'resolved', 1)`,
    ).run()

    expect(findSymbolCandidates(db, 'helper', 5)[0]?.qualifiedName).toBe('src/helper#helper')
    expect(findIncomingReferences(db, { qualifiedName: 'src/helper#helper', limit: 10 })[0]?.edgeType).toBe('imports')
  })
})
```

```typescript
// tests/codeindex/mcp.test.ts
import { describe, expect, test } from 'bun:test'

import { createCodeindexServer } from '../../codeindex/src/mcp/server.js'

describe('createCodeindexServer', () => {
  test('registers the Tier 1 MCP tools', () => {
    const server = createCodeindexServer({
      codeSearch: async () => [],
      codeSymbol: async () => [],
      codeImpact: async () => [],
      codeIndex: async () => ({
        filesIndexed: 0,
        filesFailed: 0,
        symbolsIndexed: 0,
        referencesIndexed: 0,
        referencesUnresolved: 0,
        elapsedMs: 0,
      }),
    })

    expect(server).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/codeindex/impact.test.ts tests/codeindex/mcp.test.ts
```

Expected: FAIL with missing search/MCP exports.

- [ ] **Step 3: Implement symbol lookup, impact queries, and MCP registration**

```typescript
// codeindex/src/search/index.ts
import type { Database } from 'bun:sqlite'

import type { SearchResult } from '../types.js'
import { runExactSearch, type SearchFilters } from './exact.js'
import { runFtsSearch } from './fts.js'
import { rerankSearchResults } from './rank.js'

export interface ImpactLookupInput {
  readonly symbolKey?: string
  readonly qualifiedName?: string
  readonly limit: number
}

export interface ImpactResult {
  readonly sourceQualifiedName: string | null
  readonly sourceFilePath: string
  readonly edgeType: string
  readonly confidence: string
  readonly lineNumber: number
}

export const searchSymbols = (
  db: Database,
  input: Readonly<{ query: string; limit: number } & SearchFilters>,
): readonly SearchResult[] => {
  const exactResults = runExactSearch(db, input.query, input.limit, input)
  const ftsResults = runFtsSearch(db, input.query, input.limit, input)
  const deduped = [...exactResults]
  for (const result of ftsResults) {
    if (!deduped.some((entry) => entry.symbolKey === result.symbolKey)) deduped.push(result)
  }
  return rerankSearchResults(deduped).slice(0, input.limit)
}

export const findSymbolCandidates = (db: Database, query: string, limit: number): readonly SearchResult[] =>
  searchSymbols(db, { query, limit })

export const findIncomingReferences = (db: Database, input: Readonly<ImpactLookupInput>): readonly ImpactResult[] => {
  if (input.symbolKey === undefined && input.qualifiedName === undefined) {
    throw new Error('Either symbolKey or qualifiedName is required')
  }

  const targetRow =
    input.symbolKey === undefined
      ? db
          .query<{ id: number }, [string]>('SELECT id FROM symbols WHERE qualified_name = ?')
          .get(input.qualifiedName ?? '')
      : db.query<{ id: number }, [string]>('SELECT id FROM symbols WHERE symbol_key = ?').get(input.symbolKey)

  if (targetRow === null) return []

  return db
    .query<
      {
        source_qualified_name: string | null
        source_file_path: string
        edge_type: string
        confidence: string
        line_number: number
      },
      [number, number]
    >(
      `SELECT source_symbols.qualified_name AS source_qualified_name,
              source_files.file_path AS source_file_path,
              symbol_references.edge_type,
              symbol_references.confidence,
              symbol_references.line_number
       FROM symbol_references
       JOIN files AS source_files ON source_files.id = symbol_references.source_file_id
       LEFT JOIN symbols AS source_symbols ON source_symbols.id = symbol_references.source_symbol_id
       WHERE symbol_references.target_symbol_id = ?
       ORDER BY symbol_references.confidence = 'resolved' DESC, symbol_references.line_number ASC
       LIMIT ?`,
    )
    .all(targetRow.id, input.limit)
    .map((row) => ({
      sourceQualifiedName: row.source_qualified_name,
      sourceFilePath: row.source_file_path,
      edgeType: row.edge_type,
      confidence: row.confidence,
      lineNumber: row.line_number,
    }))
}
```

```typescript
// codeindex/src/mcp/tools.ts
import { z } from 'zod'

import type { ImpactResult } from '../search/index.js'
import type { SearchResult } from '../types.js'
import type { IndexSummary } from '../indexer/index-codebase.js'

export interface CodeindexToolDeps {
  readonly codeSearch: (input: {
    query: string
    limit: number
    kinds?: readonly string[]
    scopeTiers?: readonly SearchResult['scopeTier'][]
    pathPrefix?: string
  }) => Promise<readonly SearchResult[]>
  readonly codeSymbol: (query: string, limit: number) => Promise<readonly SearchResult[]>
  readonly codeImpact: (input: {
    symbolKey?: string
    qualifiedName?: string
    limit: number
  }) => Promise<readonly ImpactResult[]>
  readonly codeIndex: (input: { path: string; mode: 'full' | 'incremental' }) => Promise<IndexSummary>
}

export const CodeSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
  kinds: z.array(z.string().min(1)).optional(),
  scopeTiers: z.array(z.enum(['exported', 'module', 'member', 'local'])).optional(),
  pathPrefix: z.string().min(1).optional(),
})

export const CodeSymbolInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
})

export const CodeImpactInputSchema = z
  .object({
    symbolKey: z.string().min(1).optional(),
    qualifiedName: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).default(20),
  })
  .refine((value) => value.symbolKey !== undefined || value.qualifiedName !== undefined, {
    message: 'Either symbolKey or qualifiedName is required',
  })

export const CodeIndexInputSchema = z.object({
  path: z.string().min(1),
  mode: z.enum(['full', 'incremental']).default('incremental'),
})
```

```typescript
// codeindex/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import {
  CodeImpactInputSchema,
  CodeIndexInputSchema,
  CodeSearchInputSchema,
  CodeSymbolInputSchema,
  type CodeindexToolDeps,
} from './tools.js'

export const createCodeindexServer = (deps: Readonly<CodeindexToolDeps>): McpServer => {
  const server = new McpServer({ name: 'codeindex', version: '0.1.0' })

  server.registerTool(
    'code_search',
    { description: 'Search indexed symbols', inputSchema: CodeSearchInputSchema },
    async ({ query, limit, kinds, scopeTiers, pathPrefix }) => ({
      content: [
        { type: 'text', text: JSON.stringify(await deps.codeSearch({ query, limit, kinds, scopeTiers, pathPrefix })) },
      ],
    }),
  )

  server.registerTool(
    'code_symbol',
    { description: 'Resolve a query to candidate symbols', inputSchema: CodeSymbolInputSchema },
    async ({ query, limit }) => ({
      content: [{ type: 'text', text: JSON.stringify(await deps.codeSymbol(query, limit)) }],
    }),
  )

  server.registerTool(
    'code_impact',
    { description: 'Find incoming references for a symbol', inputSchema: CodeImpactInputSchema },
    async ({ symbolKey, qualifiedName, limit }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(await deps.codeImpact({ symbolKey, qualifiedName, limit })),
        },
      ],
    }),
  )

  server.registerTool(
    'code_index',
    { description: 'Run full or incremental indexing', inputSchema: CodeIndexInputSchema },
    async ({ path, mode }) => ({
      content: [{ type: 'text', text: JSON.stringify(await deps.codeIndex({ path, mode })) }],
    }),
  )

  return server
}

export const runCodeindexMcpServer = async (deps: Readonly<CodeindexToolDeps>): Promise<void> => {
  const server = createCodeindexServer(deps)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('codeindex MCP server listening on stdio')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/codeindex/impact.test.ts tests/codeindex/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/search/index.ts codeindex/src/mcp/tools.ts codeindex/src/mcp/server.ts tests/codeindex/impact.test.ts tests/codeindex/mcp.test.ts
git commit -m "feat(codeindex): expose symbol and impact tools"
```

---

### Task 12: Implement CLI commands and incremental reindexing behavior

**Files:**

- Create: `codeindex/src/cli.ts`
- Modify: `codeindex/src/indexer/index-codebase.ts`
- Test: `tests/codeindex/index-codebase.test.ts`

- [ ] **Step 1: Extend the failing indexing test for incremental mode**

```typescript
// add to tests/codeindex/index-codebase.test.ts
test('incremental mode reindexes changed files and narrow dependents without full rebuild', async () => {
  const repoRoot = makeRepo()
  mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
  writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helper() { return 1 }\n')
  writeFileSync(
    path.join(repoRoot, 'src', 'run-task.ts'),
    "import { helper } from './helper'\nexport function runTask() { return helper() }\n",
  )
  writeFileSync(path.join(repoRoot, 'src', 'unrelated.ts'), 'export const unrelated = 1\n')
  writeFileSync(path.join(repoRoot, '.codeindex.json'), JSON.stringify({ roots: ['src'] }))

  const config = await loadCodeindexConfig({
    configPath: path.join(repoRoot, '.codeindex.json'),
    repoRoot,
  })

  await indexCodebase({ config, mode: 'full' })

  writeFileSync(path.join(repoRoot, 'src', 'helper.ts'), 'export function helperRenamed() { return 2 }\n')

  const summary = await indexCodebase({ config, mode: 'incremental' })
  expect(summary.filesIndexed).toBe(2)
  expect(summary.filesFailed).toBe(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/codeindex/index-codebase.test.ts
```

Expected: FAIL because incremental mode still only short-circuits unchanged files and does not add importer/re-export dependents of a changed module to the reindex set.

- [ ] **Step 3: Add file-hash short-circuiting, dependent-file fan-out, and CLI entrypoint**

```typescript
// add near the top of codeindex/src/indexer/index-codebase.ts
const findIncrementalFileSet = async (db: Database, files: readonly DiscoveredFile[]): Promise<ReadonlySet<string>> => {
  const changedFiles = new Set<string>()

  for (const file of files) {
    const source = await readFile(file.absolutePath, 'utf8')
    const fileHash = sha256(source)
    const existing = db
      .query<{ file_hash: string }, [string]>('SELECT file_hash FROM files WHERE file_path = ?')
      .get(file.relativePath)

    if (existing === null || existing.file_hash !== fileHash) {
      changedFiles.add(file.relativePath)
    }
  }

  const dependentFiles = [...changedFiles].flatMap((changedFilePath) =>
    db
      .query<{ file_path: string }, [string]>(
        `SELECT DISTINCT source_files.file_path
         FROM symbol_references
         JOIN files AS source_files ON source_files.id = symbol_references.source_file_id
         JOIN symbols AS target_symbols ON target_symbols.id = symbol_references.target_symbol_id
         JOIN files AS target_files ON target_files.id = target_symbols.file_id
         WHERE target_files.file_path = ?`,
      )
      .all(changedFilePath)
      .map((row) => row.file_path),
  )

  return new Set([...changedFiles, ...dependentFiles])
}

// replace the source-file selection in indexCodebase()
const incrementalSet = input.mode === 'incremental' ? await findIncrementalFileSet(db, files) : null
const filesToProcess = incrementalSet === null ? files : files.filter((file) => incrementalSet.has(file.relativePath))
```

> **Note:** `.filter()` callbacks are synchronous — computing the set inside a `.filter` with `await` is a syntax error. Compute `incrementalSet` once before filtering.

```typescript
// codeindex/src/cli.ts
import path from 'node:path'

import { loadCodeindexConfig } from './config.js'
import { indexCodebase } from './indexer/index-codebase.js'
import { openDatabase } from './storage/db.js'
import { searchSymbols, findIncomingReferences, findSymbolCandidates } from './search/index.js'
import { runCodeindexMcpServer } from './mcp/server.js'

const resolveConfigPath = (cwd: string): string => path.join(cwd, '.codeindex.json')

const loadConfigForPath = async (targetPath: string) => {
  const repoRoot = path.resolve(targetPath)
  return loadCodeindexConfig({
    configPath: resolveConfigPath(repoRoot),
    repoRoot,
  })
}

const main = async (): Promise<void> => {
  const [, , command = 'index', rawArg] = process.argv
  const cwd = process.cwd()
  const config = await loadConfigForPath(cwd)

  switch (command) {
    case 'index': {
      console.log(JSON.stringify(await indexCodebase({ config, mode: 'full' }), null, 2))
      return
    }
    case 'reindex': {
      console.log(JSON.stringify(await indexCodebase({ config, mode: 'incremental' }), null, 2))
      return
    }
    case 'search': {
      const db = openDatabase(config.dbPath)
      console.log(JSON.stringify(searchSymbols(db, { query: rawArg ?? '', limit: 10 }), null, 2))
      db.close()
      return
    }
    case 'symbol': {
      const db = openDatabase(config.dbPath)
      console.log(JSON.stringify(findSymbolCandidates(db, rawArg ?? '', 10), null, 2))
      db.close()
      return
    }
    case 'impact': {
      const db = openDatabase(config.dbPath)
      console.log(JSON.stringify(findIncomingReferences(db, { qualifiedName: rawArg ?? '', limit: 20 }), null, 2))
      db.close()
      return
    }
    case 'stats': {
      const db = openDatabase(config.dbPath)
      const stats = db
        .query<{ files: number; symbols: number; symbol_references: number }, []>(
          `SELECT
             (SELECT COUNT(*) FROM files WHERE parse_status = 'indexed') AS files,
             (SELECT COUNT(*) FROM symbols) AS symbols,
             (SELECT COUNT(*) FROM symbol_references) AS symbol_references`,
        )
        .get()
      console.log(JSON.stringify(stats, null, 2))
      db.close()
      return
    }
    case 'mcp': {
      await runCodeindexMcpServer({
        codeSearch: async (input) => {
          const db = openDatabase(config.dbPath)
          const result = searchSymbols(db, input)
          db.close()
          return result
        },
        codeSymbol: async (query, limit) => {
          const db = openDatabase(config.dbPath)
          const result = findSymbolCandidates(db, query, limit)
          db.close()
          return result
        },
        codeImpact: async (input) => {
          const db = openDatabase(config.dbPath)
          const result = findIncomingReferences(db, input)
          db.close()
          return result
        },
        codeIndex: async ({ path: targetPath, mode }) => {
          const targetConfig = await loadConfigForPath(targetPath)
          return indexCodebase({ config: targetConfig, mode })
        },
      })
      return
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

- [ ] **Step 4: Run the indexing test to verify it passes**

Run:

```bash
bun test tests/codeindex/index-codebase.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add codeindex/src/cli.ts codeindex/src/indexer/index-codebase.ts tests/codeindex/index-codebase.test.ts
git commit -m "feat(codeindex): add cli and incremental reindexing"
```

---

### Task 13: Extend TDD hooks and agent guidance for the codeindex workspace

**Files:**

- Modify: `.hooks/tdd/test-resolver.mjs`
- Create: `codeindex/CLAUDE.md`
- Modify: `CLAUDE.md`

The TDD pipeline in `.hooks/tdd/test-resolver.mjs` currently only gates files under `src/` and `client/`. Writes to `codeindex/src/**` would silently skip the TDD pipeline. Decide one of the following and apply it:

**Option A — extend the resolver (recommended if the workspace is meant to follow TDD).**

Update `isGateableImplementation()` and the impl-to-test-path mapping so that `codeindex/src/foo/bar.ts` maps to `tests/codeindex/foo/bar.test.ts` (mirroring the existing `src/ → tests/` rule). Add a corresponding reverse mapping for test-file writes.

**Option B — document the exemption.**

If the workspace is intentionally exempted from TDD hook enforcement (for instance because it is local dev tooling), add a comment block at the top of `.hooks/tdd/test-resolver.mjs` that explicitly lists `codeindex/` as exempt, and call it out in `codeindex/CLAUDE.md` so future agents do not assume the pipeline is running.

- [ ] **Step 1: Pick Option A or Option B and apply the corresponding change**

- [ ] **Step 2: Add `codeindex/CLAUDE.md` describing the workspace**

Topics to cover:

- purpose (symbol-first TS/JS code index + MCP server for agents)
- local-dev-only (not a papai runtime dependency)
- database location (`codeindex/.codeindex/index.db`) and WAL behavior
- workspace scripts (`bun run --filter codeindex ...`)
- whether TDD hooks apply (reference the Option chosen above)
- SQL table names (especially that the table is `symbol_references`, not `references`)

- [ ] **Step 3: Update root `CLAUDE.md`**

Add a row for `codeindex/` to the "Path-Scoped Conventions" table, and add the new `codeindex:test`, `codeindex:typecheck`, `codeindex:lint`, and `codeindex:format:check` scripts to the "Commands" section.

- [ ] **Step 4: Commit**

```bash
git add .hooks/tdd/test-resolver.mjs codeindex/CLAUDE.md CLAUDE.md
git commit -m "chore(codeindex): wire workspace into TDD hooks and agent guidance"
```

---

### Task 14: Run workspace verification and root quality gates

**Files:**

- Modify: `package.json`
- Modify: `scripts/check.sh`
- Test: existing repo and workspace commands

- [ ] **Step 1: Extend root verification scripts to cover `codeindex/`**

```json
// package.json
{
  "scripts": {
    "check:verbose": "bun run --parallel lint typecheck format:check knip test duplicates codeindex:lint codeindex:typecheck codeindex:format:check codeindex:test"
  }
}
```

- [ ] **Step 2: Extend `scripts/check.sh` (non-staged / full mode) to run codeindex checks**

`bun check:full` delegates to `scripts/check.sh`. Add `codeindex:lint`, `codeindex:typecheck`, `codeindex:format:check`, and `codeindex:test` to the parallel check set in that script so the repo-wide pre-push gate covers the workspace. Keep the staged-mode path unchanged.

- [ ] **Step 3: Run the workspace-local checks**

Run:

```bash
bun run codeindex:lint
bun run codeindex:typecheck
bun run codeindex:format:check
bun run codeindex:test
```

Expected: PASS for all four commands.

- [ ] **Step 4: Run repo-wide checks that should now include codeindex**

Run:

```bash
bun knip
bun run check:verbose
bun run check:full
```

Expected: PASS. `knip` should not report unused `codeindex` exports, unresolved dependencies, or unlisted binaries. `check:full` should invoke the codeindex scripts alongside the existing ones.

- [ ] **Step 5: Commit**

```bash
git add package.json knip.jsonc scripts/check.sh
git commit -m "chore(codeindex): wire workspace into repo checks"
```

---

## Self-Review

### Spec coverage

- Workspace package and repo fit: Task 1, Task 14
- Parser loading and TS/JS-first scope: Task 2 (WASM grammars via `tree-sitter-wasms`, `context7`-verified)
- Discovery and ignore handling: Task 3
- SQLite schema and FTS5 triggers, including `symbol_references` (renamed from `references` to avoid the SQLite reserved keyword): Task 4
- Module aliases and `tsconfig` path handling, including JSONC-safe `tsconfig` parsing: Task 5
- Symbol extraction, doc comments, and identifier normalization: Task 6
- Reference extraction and export metadata: Task 7
- Resolver-backed confidence scoring: Task 8
- Full indexing and persistence with repo-wide second-pass reference resolution: Task 9
- Exact search, FTS search, search filters, and structural reranking: Task 10
- `code_symbol`, `code_impact`, MCP tool surface (`context7`-verified SDK surface): Task 11
- Incremental reindexing, narrow dependent fan-out, CLI, and `stats`: Task 12
- TDD hook wiring and agent-guidance docs: Task 13
- Root quality-gate integration (including `scripts/check.sh`): Task 14

No spec sections are intentionally uncovered.

### Placeholder scan

- No `TBD`, `TODO`, or deferred “implement later” steps remain.
- Every task includes explicit files, code, commands, and expected outcomes.
- No “similar to Task N” shortcuts remain.

### Type consistency

- `ScopeTier`, `ReferenceConfidence`, `IndexSummary`, `SearchFilters`, and `SearchResult` shapes are introduced before later tasks use them.
- MCP tool names stay consistent with the approved design: `code_search`, `code_symbol`, `code_impact`, `code_index`.
- Resolver confidence values stay consistent with the spec: `resolved`, `file_resolved`, `name_only`.
- `code_search` now carries the approved filter inputs: `kinds`, `scopeTiers`, and `pathPrefix`.
