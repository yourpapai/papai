// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SourceFile } from 'typescript/unstable/ast'
import { API, type Project } from 'typescript/unstable/async'
import type { FileSystem } from 'typescript/unstable/fs'

const VIRTUAL_ROOT = '/papai-ast'

/**
 * TypeScript 7 exposes no standalone parser: the only way to reach a
 * `SourceFile` is to ask a project, and a project is served by a `tsgo` child
 * process over RPC. Every AST scanner in this repo wants the opposite — a tree
 * for a string it already holds — so this module rebuilds that shape on top of
 * the project API: sources live in an in-memory store, and each one is opened
 * into `tsgo`'s *inferred* project.
 *
 * Opening files is what makes repeated use work. A synthetic `tsconfig.json`
 * listing the sources looks like the obvious route and silently is not: `tsgo`
 * parses a config once and keeps the file list, so a source added after the
 * first snapshot never joins the program however hard the snapshot is
 * invalidated. `openFiles` carries no such cache.
 *
 * The store is authoritative. `readFile` answers `null` (not `undefined`) for a
 * path it does not know under the virtual root, so a source we did not put
 * there can never be read off the real disk — plugin discovery depends on that
 * to stay hermetic. Paths outside the root fall through to the real filesystem
 * so `tsgo` can still find its own files.
 */
/**
 * Reported when tearing down the `tsgo` process fails. Injected rather than
 * logged directly: the frozen story-enforcement snapshot imports this module,
 * and pulling in the application logger would drag its whole graph along, so
 * this stays a leaf with no repository imports.
 */
export type SourceParserOptions = Readonly<{ onCloseError?: (error: unknown) => void }>

export type SourceParser = {
  /** Parse one source, adding it to the project. Later parses see earlier files. */
  parse(fileName: string, source: string): Promise<SourceFile>
  /** Parse a batch in a single re-snapshot — one round trip instead of N. */
  parseAll(sources: ReadonlyMap<string, string>): Promise<ReadonlyMap<string, SourceFile>>
  close(): Promise<void>
}

/**
 * Every source is placed directly under the virtual root, never in a
 * subdirectory: `tsgo` caches directory existence across snapshots, so a source
 * introduced under a *new* directory stays invisible. Nothing here resolves
 * imports through the virtual filesystem — the scanners read specifier strings
 * and resolve them themselves — so a flat layout costs nothing. The extension
 * is preserved because it selects the parser (`.js` sources are real JS).
 *
 * The ordinal makes each name single-use. An open file's text is pinned for the
 * life of the session — neither `invalidateAll` nor an explicit `changed` entry
 * re-reads it — so parsing the same path twice under one name would hand back
 * the first source. A fresh name per parse makes name-to-text immutable, which
 * is the property that keeps a re-parse honest.
 */
function virtualNameFor(fileName: string, ordinal: number): string {
  const extension = /\.[cm]?[jt]sx?$/u.exec(fileName)?.[0] ?? '.ts'
  return `${VIRTUAL_ROOT}/s${ordinal}${extension}`
}

function isUnderRoot(name: string): boolean {
  return name === VIRTUAL_ROOT || name.startsWith(`${VIRTUAL_ROOT}/`)
}

function createFileSystem(store: ReadonlyMap<string, string>): FileSystem {
  return {
    // `null` = "does not exist, do not fall back"; `undefined` = "use the real FS".
    readFile: (name) => (isUnderRoot(name) ? (store.get(name) ?? null) : undefined),
    fileExists: (name) => (isUnderRoot(name) ? store.has(name) : undefined),
    directoryExists: (name) => (name === VIRTUAL_ROOT ? true : isUnderRoot(name) ? false : undefined),
    getAccessibleEntries: (name) =>
      name === VIRTUAL_ROOT
        ? { files: [...store.keys()].map((key) => key.slice(VIRTUAL_ROOT.length + 1)), directories: [] }
        : isUnderRoot(name)
          ? { files: [], directories: [] }
          : undefined,
    realpath: (name) => (isUnderRoot(name) ? name : undefined),
  }
}

type ParserState = {
  readonly store: Map<string, string>
  readonly onCloseError: ((error: unknown) => void) | undefined
  staged: number
  api: API | undefined
  connecting: Promise<API> | undefined
}

/** Add a source under a fresh single-use virtual name. */
function stage(state: ParserState, fileName: string, source: string): string {
  const name = virtualNameFor(fileName, state.staged)
  state.staged += 1
  state.store.set(name, source)
  return name
}

type Snapshot = Awaited<ReturnType<API['updateSnapshot']>>

/**
 * Open the staged sources, read their trees, and release the snapshot.
 *
 * Disposal is not optional bookkeeping: an undisposed snapshot holds server-side
 * handles, and concurrent parses through one parser leave enough of them alive
 * that the `tsgo` connection never closes and the host process cannot exit.
 * Trees are materialized client-side, so they stay usable after the release.
 */
/**
 * Connect exactly once, even under concurrent callers.
 *
 * The 7.0.2 async client guards `connect()` on a flag it only sets after the
 * spawn resolves, so two requests that arrive before the first connection
 * completes each start a `tsgo` process. Only the last is retained; the rest
 * are orphaned with live stdio pipes, and under Bun those keep the event loop
 * alive so the host process never exits. Funnelling the first request through
 * one shared promise keeps that race from ever opening.
 */
function connectedApi(state: ParserState): Promise<API> {
  state.connecting ??= (async (): Promise<API> => {
    const api = new API({ cwd: VIRTUAL_ROOT, fs: createFileSystem(state.store) })
    await api.updateSnapshot({ openFiles: [] })
    state.api = api
    return api
  })()
  return state.connecting
}

async function withSnapshot<T>(
  state: ParserState,
  openFiles: readonly string[],
  read: (snapshot: Snapshot) => Promise<T>,
): Promise<T> {
  const api = await connectedApi(state)
  // Opens are ref-counted and outlive their snapshot, so each call must release
  // its own. Leaving them open makes every later snapshot carry every source
  // ever parsed — quadratic work that turns a parser reused across a test file
  // into a multi-minute stall.
  //
  // Each call releases exactly what it opened, and only once it is done reading.
  // Deferring the release to the *next* call would be one round trip cheaper and
  // is wrong: parses run concurrently, so the next call would close files a
  // still-running one is reading, and its sources vanish mid-parse.
  //
  // No invalidation is requested: a virtual name is used once and its text never
  // changes, so nothing the server already holds can go stale. The snapshot is
  // likewise not disposed — `close()` tears the whole API down.
  const snapshot = await api.updateSnapshot({ openFiles: [...openFiles] })
  try {
    return await read(snapshot)
  } finally {
    for (const name of openFiles) state.store.delete(name)
    await api.updateSnapshot({ closeFiles: [...openFiles] })
  }
}

async function sourceFileOf(snapshot: Snapshot, virtualName: string, fileName: string): Promise<SourceFile> {
  const project: Project | undefined = await snapshot.getDefaultProjectForFile(virtualName)
  const sourceFile = await project?.program.getSourceFile(virtualName)
  if (sourceFile === undefined) throw new Error(`TypeScript did not parse ${fileName}`)
  return sourceFile
}

async function closeApi(state: ParserState): Promise<void> {
  if (state.api === undefined) return
  try {
    await state.api.close()
  } catch (error) {
    state.onCloseError?.(error)
  }
  state.api = undefined
  state.connecting = undefined
  state.store.clear()
  state.staged = 0
}

export function createSourceParser(options: SourceParserOptions = {}): SourceParser {
  const state: ParserState = {
    store: new Map(),
    onCloseError: options.onCloseError,
    staged: 0,
    api: undefined,
    connecting: undefined,
  }

  return {
    parse(fileName, source) {
      const name = stage(state, fileName, source)
      return withSnapshot(state, [name], (snapshot) => sourceFileOf(snapshot, name, fileName))
    },

    parseAll(sources) {
      const staged = [...sources].map(([fileName, source]) => [fileName, stage(state, fileName, source)] as const)
      return withSnapshot(
        state,
        staged.map(([, name]) => name),
        async (snapshot) =>
          new Map(
            await Promise.all(
              staged.map(async ([fileName, name]): Promise<readonly [string, SourceFile]> => [
                fileName,
                await sourceFileOf(snapshot, name, fileName),
              ]),
            ),
          ),
      )
    },

    close: () => closeApi(state),
  }
}

/** Run `use` against a parser whose `tsgo` process is always torn down after. */
export async function withSourceParser<T>(
  use: (parser: SourceParser) => Promise<T>,
  options: SourceParserOptions = {},
): Promise<T> {
  const parser = createSourceParser(options)
  try {
    return await use(parser)
  } finally {
    await parser.close()
  }
}
