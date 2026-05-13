import { z } from 'zod'

import type { IndexSummary } from '../indexer/index-codebase.js'
import type { ImpactResult } from '../search/index.js'
import type { RankedSearchResult, SearchResult } from '../types.js'

export interface CodeindexToolDeps {
  readonly codeSearch: (input: {
    query: string
    limit: number
    kinds?: readonly string[]
    scopeTiers?: readonly SearchResult['scopeTier'][]
    pathPrefix?: string
  }) => Promise<readonly RankedSearchResult[]>
  readonly codeSymbol: (
    query: string,
    limit: number,
  ) => Promise<readonly SearchResult[] | readonly RankedSearchResult[]>
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
export type CodeSearchInput = z.infer<typeof CodeSearchInputSchema>

export const CodeSymbolInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(10),
})
export type CodeSymbolInput = z.infer<typeof CodeSymbolInputSchema>

export const CodeImpactInputSchema = z
  .object({
    symbolKey: z.string().min(1).optional(),
    qualifiedName: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).default(20),
  })
  .refine((value) => value.symbolKey !== undefined || value.qualifiedName !== undefined, {
    message: 'Either symbolKey or qualifiedName is required',
  })
export type CodeImpactInput = z.infer<typeof CodeImpactInputSchema>

export const CodeIndexInputSchema = z.object({
  path: z.string().min(1),
  mode: z.enum(['full', 'incremental']).default('incremental'),
})
export type CodeIndexInput = z.infer<typeof CodeIndexInputSchema>

const RankedSearchResultSchema = z.object({
  symbolKey: z.string(),
  qualifiedName: z.string(),
  localName: z.string(),
  kind: z.string(),
  scopeTier: z.enum(['exported', 'module', 'member', 'local']),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  exportNames: z.array(z.string()),
  matchReason: z.string(),
  confidence: z.string(),
  snippet: z.string(),
  rankScore: z.number(),
})

export const CodeSearchOutputSchema = z.object({
  query: z.string(),
  resultCount: z.number(),
  results: z.array(RankedSearchResultSchema),
  guidance: z.string().optional(),
})

export const CodeSymbolOutputSchema = z.object({
  results: z.array(RankedSearchResultSchema),
})

const ImpactResultSchema = z.object({
  sourceQualifiedName: z.string().nullable(),
  sourceFilePath: z.string(),
  edgeType: z.string(),
  confidence: z.string(),
  lineNumber: z.number(),
})

export const CodeImpactOutputSchema = z.object({
  results: z.array(ImpactResultSchema),
})

export const CodeIndexOutputSchema = z.object({
  filesIndexed: z.number(),
  filesFailed: z.number(),
  filesPruned: z.number(),
  symbolsIndexed: z.number(),
  referencesIndexed: z.number(),
  referencesUnresolved: z.number(),
  elapsedMs: z.number(),
})

export const buildStructuredToolResult = <S extends z.ZodType>(
  schema: S,
  output: unknown,
): { content: Array<{ type: 'text'; text: string }>; structuredContent: z.output<S> } => {
  const parsed = schema.parse(output)
  return {
    content: [{ type: 'text', text: JSON.stringify(parsed) }],
    structuredContent: parsed,
  }
}
