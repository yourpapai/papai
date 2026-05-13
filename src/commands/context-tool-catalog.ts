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
const MAX_TITLE_LENGTH = buildPageTitle(999, 999).length + 2
const MAX_ENTRY_LENGTH = MAX_PAGE_LENGTH - MAX_TITLE_LENGTH

function lookupToolMetadata(toolName: string): ReturnType<typeof getToolMetadata> {
  return getToolMetadata(toolName) ?? getToolMetadata(toolName.replaceAll('-', '_'))
}

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
  const metadata = lookupToolMetadata(toolName)
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

function splitTextAtCap(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text]

  const chunks = text.split('\n').reduce<readonly string[]>(
    (pages, line) => {
      const current = pages.at(-1) ?? ''
      const separator = current.length === 0 ? '' : '\n'
      const next = `${current}${separator}${line}`

      if (next.length <= maxLength) {
        return [...pages.slice(0, -1), next]
      }

      if (line.length > maxLength) {
        const lineChunks = Array.from({ length: Math.ceil(line.length / maxLength) }, (_value, index) =>
          line.slice(index * maxLength, (index + 1) * maxLength),
        )

        return current.length === 0 ? [...pages.slice(0, -1), ...lineChunks] : [...pages, ...lineChunks]
      }

      return [...pages, line]
    },
    [''],
  )

  return chunks.filter((chunk) => chunk.length > 0)
}

function splitOversizedEntry(entry: string): readonly string[] {
  const lines = entry.split('\n')
  const [headerLine, classificationLine, descriptionLine, parametersLine, ...schemaLines] = lines

  if (
    headerLine === undefined ||
    classificationLine === undefined ||
    descriptionLine === undefined ||
    parametersLine === undefined
  ) {
    return splitTextAtCap(entry, MAX_ENTRY_LENGTH)
  }

  const baseBlock = [headerLine, classificationLine, descriptionLine, parametersLine].join('\n')
  const remainingBudget = MAX_ENTRY_LENGTH - baseBlock.length - 2
  if (remainingBudget <= 0) return splitTextAtCap(entry, MAX_ENTRY_LENGTH)

  const schemaChunks = splitTextAtCap(schemaLines.join('\n'), remainingBudget)
  return schemaChunks.map((schemaChunk) => [baseBlock, schemaChunk].join('\n'))
}

function normalizeEntries(entries: readonly string[]): readonly string[] {
  return entries.flatMap((entry) => (entry.length <= MAX_ENTRY_LENGTH ? [entry] : splitOversizedEntry(entry)))
}

function paginateWithTitleLimit(entries: readonly string[], totalPages: number): readonly string[][] {
  return entries.reduce<readonly string[][]>(
    (currentPages, entry) => {
      const lastPage = currentPages.at(-1) ?? []
      const nextCandidate = [...lastPage, entry]
      const candidateBody = nextCandidate.join('\n\n')
      const pageIndex = currentPages.length
      const candidateText = [buildPageTitle(pageIndex, totalPages), candidateBody].join('\n\n')

      if (candidateText.length <= MAX_PAGE_LENGTH || lastPage.length === 0) {
        return [...currentPages.slice(0, -1), nextCandidate]
      }

      return [...currentPages, [entry]]
    },
    [[]],
  )
}

function stabilizePagination(entries: readonly string[]): readonly string[][] {
  let totalPages = 1

  while (true) {
    const pages = paginateWithTitleLimit(entries, totalPages)
    if (pages.length === totalPages) return pages
    totalPages = pages.length
  }
}

function paginateEntries(entries: readonly string[]): readonly string[] {
  if (entries.length === 0) return [EMPTY_CATALOG_PAGE]

  const normalizedEntries = normalizeEntries(entries)
  const finalPages = stabilizePagination(normalizedEntries)

  return finalPages.map((pageEntries, index) => {
    const body = pageEntries.join('\n\n')
    return [buildPageTitle(index + 1, finalPages.length), body].join('\n\n')
  })
}

export function buildContextToolCatalogPages(tools: ToolSet): readonly string[] {
  const metadata = buildToolMetadata(tools)
  if (metadata.length === 0) return [EMPTY_CATALOG_PAGE]

  const entries = orderToolMetadata(metadata).map(formatToolEntry)
  return paginateEntries(entries)
}
