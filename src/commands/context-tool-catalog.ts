import type { ToolSet } from 'ai'

import {
  buildToolMetadata,
  findToolMetadata,
  getToolMetadata,
  TOOL_METADATA,
  type ToolMetadata,
} from '../tools/tool-metadata.js'
import { formatToolSchema } from '../tools/tool-schema-format.js'

const MAX_PAGE_LENGTH = 3500
const EMPTY_CATALOG_PAGE = '_No active tools._'

function orderToolMetadata(metadata: readonly ToolMetadata[]): readonly ToolMetadata[] {
  const catalogNames = Object.keys(TOOL_METADATA)
  const orderedKnown = catalogNames.flatMap((toolName) => {
    const match = findToolMetadata(metadata, toolName)
    return match === undefined ? [] : [match]
  })

  const knownNames = new Set(orderedKnown.map((tool) => tool.name))
  const extras = metadata.filter((tool) => !knownNames.has(tool.name))
  return [...orderedKnown, ...extras]
}

function formatClassification(toolName: string): string {
  const metadata = getToolMetadata(toolName)
  const domain = metadata?.domain ?? 'unknown'
  const operation = metadata?.operation ?? 'unknown'
  const risk = metadata?.risk ?? 'unknown'
  return [`Domain: \`${domain}\``, `Operation: \`${operation}\``, `Risk: \`${risk}\``].join(' · ')
}

function formatToolEntry(tool: ToolMetadata): string {
  const description = tool.description.length > 0 ? tool.description : '_No description._'

  return [
    `\`${tool.name}\``,
    formatClassification(tool.name),
    `Description: ${description}`,
    'Parameters:',
    formatToolSchema(tool.inputSchema),
  ].join('\n')
}

function buildPageTitle(pageNumber: number, totalPages: number): string {
  return `**Direct Tools** (${pageNumber}/${totalPages})`
}

function paginateEntries(entries: readonly string[]): readonly string[] {
  if (entries.length === 0) return [EMPTY_CATALOG_PAGE]

  const pages = entries.reduce<readonly string[][]>(
    (currentPages, entry) => {
      const lastPage = currentPages.at(-1) ?? []
      const nextCandidate = [...lastPage, entry]
      const candidateBody = nextCandidate.join('\n\n')
      const candidateText = [buildPageTitle(currentPages.length, currentPages.length), candidateBody].join('\n\n')

      if (candidateText.length <= MAX_PAGE_LENGTH || lastPage.length === 0) {
        return [...currentPages.slice(0, -1), nextCandidate]
      }

      return [...currentPages, [entry]]
    },
    [[]],
  )

  return pages.map((pageEntries, index) => {
    const body = pageEntries.join('\n\n')
    return [buildPageTitle(index + 1, pages.length), body].join('\n\n')
  })
}

export function buildContextToolCatalogPages(tools: ToolSet): readonly string[] {
  const metadata = buildToolMetadata(tools)
  if (metadata.length === 0) return [EMPTY_CATALOG_PAGE]

  const entries = orderToolMetadata(metadata).map(formatToolEntry)
  return paginateEntries(entries)
}
