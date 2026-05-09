import type { ToolSet } from 'ai'

export type ToolMetadata = {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
  readonly executable: boolean
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function normalizeToolName(value: string): string {
  return value.replaceAll('-', '_')
}

export function buildToolMetadata(tools: ToolSet): readonly ToolMetadata[] {
  return Object.entries(tools).flatMap(([name, tool]) => {
    if (!isRecord(tool)) return []
    const description = typeof tool['description'] === 'string' ? tool['description'] : ''
    return [
      {
        name,
        description,
        inputSchema: tool['inputSchema'],
        executable: typeof tool['execute'] === 'function',
      },
    ]
  })
}

export function findToolMetadata(metadata: readonly ToolMetadata[], toolName: string): ToolMetadata | undefined {
  const exact = metadata.find((tool) => tool.name === toolName)
  if (exact !== undefined) return exact

  const normalized = normalizeToolName(toolName)
  return metadata.find((tool) => normalizeToolName(tool.name) === normalized)
}
