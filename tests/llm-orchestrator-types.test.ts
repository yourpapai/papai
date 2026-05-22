// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { LlmOrchestratorDeps, InvokeModelArgs, StepInput, StepOutput } from '../src/llm-orchestrator-types.js'

describe('llm-orchestrator-types', () => {
  it('should export type definitions', () => {
    // Type-only verification - these are compile-time checks
    // Using the types ensures the module is importable
    // Assign to a variable with underscore prefix to indicate intentional unused
    const depsTypeCheck: LlmOrchestratorDeps | undefined = undefined
    const invokeTypeCheck: InvokeModelArgs | undefined = undefined
    const stepInputTypeCheck: StepInput | undefined = undefined
    const stepOutputTypeCheck: StepOutput | undefined = undefined

    // Use the variables to avoid unused warnings
    expect(depsTypeCheck).toBeUndefined()
    expect(invokeTypeCheck).toBeUndefined()
    expect(stepInputTypeCheck).toBeUndefined()
    expect(stepOutputTypeCheck).toBeUndefined()
  })
})
