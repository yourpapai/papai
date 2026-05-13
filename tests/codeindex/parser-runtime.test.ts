import { expect, mock, test } from 'bun:test'

import { createParserLoader } from '../../codeindex/src/indexer/parser.js'

const parserInit = mock((_options?: unknown) => Promise.resolve())
const loadLanguage = mock((wasmPath: string) => Promise.resolve({ wasmPath }))
const setLanguage = mock((_language: unknown) => {})

class FakeParser {
  static init(options?: unknown): Promise<void> {
    void options
    return parserInit()
  }

  parse(): null {
    return null
  }

  setLanguage(language: unknown): void {
    setLanguage(language)
  }
}

interface FakeTreeSitterModule {
  readonly Parser: typeof FakeParser
  readonly Language: {
    readonly load: typeof loadLanguage
  }
}

const loadModule = (): Promise<FakeTreeSitterModule> =>
  Promise.resolve({
    Parser: FakeParser,
    Language: {
      load: loadLanguage,
    },
  })

test('createParserLoader initializes the parser runtime once across loader instances', async () => {
  parserInit.mockClear()
  loadLanguage.mockClear()
  setLanguage.mockClear()

  const [firstLoader, secondLoader] = await Promise.all([
    createParserLoader({ loadModule }),
    createParserLoader({ loadModule }),
  ])

  await Promise.all([firstLoader.createParserForExtension('.ts'), secondLoader.createParserForExtension('.js')])

  expect(parserInit).toHaveBeenCalledTimes(1)
  expect(setLanguage).toHaveBeenCalledTimes(2)
})
