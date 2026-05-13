export type SupportedLanguage = 'ts' | 'tsx' | 'js' | 'jsx'

export type ScopeTier = 'exported' | 'module' | 'member' | 'local'

export type ExportKind = 'named' | 'default' | 'namespace' | 'reexport'

export type ReferenceEdgeType = 'imports' | 'reexports' | 'calls' | 'extends' | 'implements' | 'references'

export type ReferenceConfidence = 'resolved' | 'file_resolved' | 'name_only'

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

export interface RankedSearchResult extends SearchResult {
  readonly rankScore: number
}
