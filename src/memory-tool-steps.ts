export type FactToolCall = Readonly<{ toolName: string; input: unknown }>
export type FactToolResult = Readonly<{ toolName: string; output: unknown }>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFactToolCall = (value: unknown): value is FactToolCall =>
  isRecord(value) && typeof value['toolName'] === 'string' && 'input' in value

const isFactToolResult = (value: unknown): value is FactToolResult =>
  isRecord(value) && typeof value['toolName'] === 'string' && 'output' in value

const factToolSteps = (result: unknown): readonly Readonly<Record<string, unknown>>[] => {
  if (!isRecord(result)) return []
  const steps = result['steps']
  if (Array.isArray(steps) && steps.length > 0) return steps.filter((step) => isRecord(step))
  return [result]
}

export const extractFactToolCalls = (result: unknown): FactToolCall[] =>
  factToolSteps(result).flatMap((step) => {
    const toolCalls = step['toolCalls']
    return Array.isArray(toolCalls) ? toolCalls.filter((toolCall) => isFactToolCall(toolCall)) : []
  })

export const extractFactToolResults = (result: unknown): FactToolResult[] =>
  factToolSteps(result).flatMap((step) => {
    const toolResults = step['toolResults']
    return Array.isArray(toolResults) ? toolResults.filter((toolResult) => isFactToolResult(toolResult)) : []
  })
