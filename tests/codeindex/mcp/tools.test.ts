import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import {
  buildStructuredToolResult,
  CodeIndexOutputSchema,
  CodeImpactOutputSchema,
  CodeSearchOutputSchema,
  CodeSymbolOutputSchema,
} from '../../../codeindex/src/mcp/tools.js'

describe('output schemas', () => {
  test('CodeSearchOutputSchema validates a search envelope', () => {
    const data = {
      query: 'helper',
      resultCount: 1,
      results: [
        {
          symbolKey: 'a',
          qualifiedName: 'src/foo#helper',
          localName: 'helper',
          kind: 'function_declaration',
          scopeTier: 'exported',
          filePath: 'src/foo.ts',
          startLine: 1,
          endLine: 1,
          exportNames: ['helper'],
          matchReason: 'exact export_names',
          confidence: 'resolved',
          snippet: 'export function helper() {}',
          rankScore: 900,
        },
      ],
    }
    expect(CodeSearchOutputSchema.safeParse(data).success).toBe(true)
  })

  test('CodeSearchOutputSchema accepts guidance field', () => {
    const data = {
      query: 'missing',
      resultCount: 0,
      results: [],
      guidance: 'No symbol matches. Retry with broader terms.',
    }
    expect(CodeSearchOutputSchema.safeParse(data).success).toBe(true)
  })

  test('CodeSymbolOutputSchema validates symbol results', () => {
    const data = {
      results: [
        {
          symbolKey: 'a',
          qualifiedName: 'src/foo#helper',
          localName: 'helper',
          kind: 'function_declaration',
          scopeTier: 'exported',
          filePath: 'src/foo.ts',
          startLine: 1,
          endLine: 1,
          exportNames: ['helper'],
          matchReason: 'exact export_names',
          confidence: 'resolved',
          snippet: 'export function helper() {}',
          rankScore: 900,
        },
      ],
    }
    expect(CodeSymbolOutputSchema.safeParse(data).success).toBe(true)
  })

  test('CodeImpactOutputSchema validates impact results', () => {
    const data = {
      results: [
        {
          sourceQualifiedName: 'src/app#main',
          sourceFilePath: 'src/app.ts',
          edgeType: 'imports',
          confidence: 'resolved',
          lineNumber: 1,
        },
      ],
    }
    expect(CodeImpactOutputSchema.safeParse(data).success).toBe(true)
  })

  test('CodeIndexOutputSchema validates index summary', () => {
    const data = {
      filesIndexed: 10,
      filesFailed: 0,
      filesPruned: 0,
      symbolsIndexed: 50,
      referencesIndexed: 100,
      referencesUnresolved: 2,
      elapsedMs: 1234,
    }
    expect(CodeIndexOutputSchema.safeParse(data).success).toBe(true)
  })
})

describe('buildStructuredToolResult', () => {
  test('returns both content and structuredContent', () => {
    const schema = z.object({ value: z.number() })
    const output = { value: 42 }
    const result = buildStructuredToolResult(schema, output)

    expect(result.content).toBeDefined()
    expect(result.content[0]!.type).toBe('text')
    expect(result.structuredContent).toEqual({ value: 42 })
  })

  test('serializes content as JSON', () => {
    const schema = z.object({ items: z.array(z.string()) })
    const output = { items: ['a', 'b'] }
    const result = buildStructuredToolResult(schema, output)

    expect(JSON.parse(result.content[0]!.text)).toEqual({ items: ['a', 'b'] })
  })
})
