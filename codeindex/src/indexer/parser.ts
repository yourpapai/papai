import javascriptWasmPath from 'tree-sitter-javascript/tree-sitter-javascript.wasm'
import tsxWasmPath from 'tree-sitter-typescript/tree-sitter-tsx.wasm'
import typescriptWasmPath from 'tree-sitter-typescript/tree-sitter-typescript.wasm'
import type { Tree } from 'web-tree-sitter'

import type { SupportedLanguage } from '../types.js'

interface ParserLike {
  parse(source: string): Tree | null
  setLanguage(language: unknown): void
}

interface ParserConstructor {
  new (): ParserLike
  init(options?: unknown): Promise<void>
}

interface LanguageLoader {
  load(wasmPath: string): Promise<unknown>
}

interface TreeSitterModule {
  readonly Parser: ParserConstructor
  readonly Language: LanguageLoader
}

const parserInitPromises = new WeakMap<ParserConstructor, Promise<void>>()

export interface LoadedParser {
  readonly parser: ParserLike
  readonly language: SupportedLanguage
}

export interface ParserLoader {
  createParserForExtension(extension: string): Promise<LoadedParser>
}

export interface CreateParserLoaderDeps {
  readonly loadModule?: () => Promise<TreeSitterModule>
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
      return typescriptWasmPath
    case 'tsx':
      return tsxWasmPath
    case 'js':
    case 'jsx':
      return javascriptWasmPath
    default:
      throw new Error(`Unsupported language: ${String(language)}`)
  }
}

const loadDefaultModule = async (): Promise<TreeSitterModule> => {
  const module = await import('web-tree-sitter')
  return {
    Parser: module.Parser,
    Language: {
      load: (wasmPath: string) => module.Language.load(wasmPath),
    },
  }
}

const locateParserWasm = (fileName: string): string =>
  Bun.fileURLToPath(
    import.meta.resolve(`web-tree-sitter/${fileName === 'tree-sitter.wasm' ? 'web-tree-sitter.wasm' : fileName}`),
  )

const initializeParserRuntime = (Parser: ParserConstructor): Promise<void> => {
  const cached = parserInitPromises.get(Parser)
  if (cached !== undefined) {
    return cached
  }

  const initialized = Parser.init({
    locateFile: locateParserWasm,
  }).catch((error: unknown) => {
    parserInitPromises.delete(Parser)
    throw error
  })

  parserInitPromises.set(Parser, initialized)
  return initialized
}

export const createParserLoader = async (deps: Readonly<CreateParserLoaderDeps> = {}): Promise<ParserLoader> => {
  const treeSitterModule = await (deps.loadModule?.() ?? loadDefaultModule())
  const { Language, Parser } = treeSitterModule

  await initializeParserRuntime(Parser)

  const cache = new Map<SupportedLanguage, Promise<unknown>>()

  const loadLanguage = (language: SupportedLanguage): Promise<unknown> => {
    const cached = cache.get(language)
    if (cached !== undefined) {
      return cached
    }

    const resolved = Promise.resolve(Language.load(wasmSpecifierFor(language)))
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
