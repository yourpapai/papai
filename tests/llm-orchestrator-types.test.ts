import { describe, expect, it } from 'bun:test'

import type { LlmOrchestratorDeps, InvokeModelArgs, StepInput, StepOutput } from '../src/llm-orchestrator-types.js'

describe('llm-orchestrator-types', () => {
  it('should export type definitions', () => {
    // Type-only verification - these are compile-time checks
    // Using the types ensures the module is importable
    // Assign to a variable with underscore prefix to indicate intentional unused
    const __deps: LlmOrchestratorDeps | undefined = undefined
    const __invoke: InvokeModelArgs | undefined = undefined
    const __stepIn: StepInput | undefined = undefined
    const __stepOut: StepOutput | undefined = undefined

    // Use the variables to avoid unused warnings
    expect(__deps).toBeUndefined()
    expect(__invoke).toBeUndefined()
    expect(__stepIn).toBeUndefined()
    expect(__stepOut).toBeUndefined()
  })
})
