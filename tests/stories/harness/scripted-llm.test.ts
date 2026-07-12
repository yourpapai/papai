// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'

import { createScenarioEvents } from './events.js'
import { answer, callCapability, createScriptedModel } from './scripted-llm.js'

const resolveCapability = (capabilityId: string): string => {
  if (capabilityId === 'tasks.create') return 'provider_tasks__create_task'
  throw new Error(`Unknown tool capability id '${capabilityId}'`)
}

const advertisedTool = {
  type: 'function' as const,
  name: 'provider_tasks__create_task',
  inputSchema: { type: 'object' as const },
}

const promptWithoutToolResult = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'create it' }] }]

const promptWithToolResult = (toolCallId: string, toolName = 'provider_tasks__create_task'): LanguageModelV3Prompt => [
  ...promptWithoutToolResult,
  {
    role: 'tool' as const,
    content: [
      {
        type: 'tool-result' as const,
        toolCallId,
        toolName,
        output: { type: 'json' as const, value: { id: 'task-1' } },
      },
    ],
  },
]

const captureError = (operation: PromiseLike<unknown>): Promise<Error> =>
  Promise.resolve(operation).then(
    () => Promise.reject(new Error('Expected operation to fail')),
    (error: unknown) => Promise.resolve(error instanceof Error ? error : new Error(String(error))),
  )

describe('scripted language model', () => {
  test('emits deterministic V3 tool calls and then an answer after seeing the tool result', async () => {
    const script = createScriptedModel({ resolveCapability, nextId: () => 'scenario-7' })
    script.enqueue([
      callCapability('tasks.create', { title: 'Release 7', projectId: 'project-1' }),
      answer('Created “Release 7”.'),
    ])

    const first = await script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })
    expect(first).toEqual({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'scenario-7',
          toolName: 'provider_tasks__create_task',
          input: JSON.stringify({ title: 'Release 7', projectId: 'project-1' }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    })

    const second = await script.model.doGenerate({
      prompt: [
        ...promptWithoutToolResult,
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'scenario-7',
              toolName: 'provider_tasks__create_task',
              input: { title: 'Release 7', projectId: 'project-1' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'scenario-7',
              toolName: 'provider_tasks__create_task',
              output: { type: 'json', value: { id: 'task-1' } },
            },
          ],
        },
      ],
      tools: [advertisedTool],
    })

    expect(second.content).toEqual([{ type: 'text', text: 'Created “Release 7”.' }])
    expect(second.finishReason).toEqual({ unified: 'stop', raw: undefined })
    expect(() => script.verifyConsumed()).not.toThrow()
  })

  test('uses a deterministic local call-id sequence and appends enqueue calls', async () => {
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('tasks.create', { title: 'one' })])
    script.enqueue([callCapability('tasks.create', { title: 'two' })])

    const first = await script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })
    const second = await script.model.doGenerate({
      prompt: promptWithToolResult('tool-call-1'),
      tools: [advertisedTool],
    })

    expect(first.content[0]).toMatchObject({ toolCallId: 'tool-call-1' })
    expect(second.content[0]).toMatchObject({ toolCallId: 'tool-call-2' })
    expect(() => script.verifyConsumed()).toThrow(
      "Scripted model is awaiting tool result for 'provider_tasks__create_task' (tool-call-2, capability 'tasks.create')",
    )
  })

  test('keeps the pending call and next decision intact until both result id and name match', async () => {
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('tasks.create', { title: 'one' }), callCapability('tasks.create', { title: 'two' })])
    await script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })

    await expect(
      script.model.doGenerate({ prompt: promptWithToolResult('wrong-id'), tools: [advertisedTool] }),
    ).rejects.toThrow("Next tool decision expected tool result for 'provider_tasks__create_task' (tool-call-1)")
    await expect(
      script.model.doGenerate({ prompt: promptWithToolResult('tool-call-1', 'wrong_name'), tools: [advertisedTool] }),
    ).rejects.toThrow("Next tool decision expected tool result for 'provider_tasks__create_task' (tool-call-1)")
    expect(() => script.verifyConsumed()).toThrow(
      "Scripted model is awaiting tool result for 'provider_tasks__create_task' (tool-call-1, capability 'tasks.create'); 1 queued decision remains",
    )

    const next = await script.model.doGenerate({
      prompt: promptWithToolResult('tool-call-1'),
      tools: [advertisedTool],
    })
    expect(next.content[0]).toMatchObject({
      toolCallId: 'tool-call-2',
      input: JSON.stringify({ title: 'two' }),
    })
  })

  test('fails when a resolved tool is not advertised', async () => {
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('tasks.create', { title: 'Release 7' })])

    await expect(
      script.model.doGenerate({
        prompt: promptWithoutToolResult,
        tools: [{ ...advertisedTool, name: 'another_tool' }],
      }),
    ).rejects.toThrow(
      "Capability 'tasks.create' resolved to 'provider_tasks__create_task', but it was not advertised; available tools: another_tool",
    )
  })

  test('includes capability context when resolution fails', async () => {
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('unknown.capability', {})])

    await expect(script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })).rejects.toThrow(
      "Could not resolve capability 'unknown.capability': Unknown tool capability id 'unknown.capability'; available tools: provider_tasks__create_task",
    )
  })

  test('requires an answer step to observe the preceding tool result without consuming the answer', async () => {
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('tasks.create', {}), answer('done')])
    await script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })

    await expect(script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })).rejects.toThrow(
      "Next answer decision expected tool result for 'provider_tasks__create_task' (tool-call-1)",
    )
    expect(() => script.verifyConsumed()).toThrow(
      "Scripted model is awaiting tool result for 'provider_tasks__create_task' (tool-call-1, capability 'tasks.create'); 1 queued decision remains",
    )

    const result = await script.model.doGenerate({
      prompt: promptWithToolResult('tool-call-1'),
      tools: [advertisedTool],
    })
    expect(result.content).toEqual([{ type: 'text', text: 'done' }])
    expect(() => script.verifyConsumed()).not.toThrow()
  })

  test('preserves a cyclic-input decision and deterministic id when serialization fails', async () => {
    const cyclic: { title: string; self?: unknown } = { title: 'Release 7' }
    cyclic.self = cyclic
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('tasks.create', cyclic)])

    const failure = await captureError(
      script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] }),
    )
    expect(failure.message).toContain(
      "Could not serialize input for capability 'tasks.create' at generation 1 (tool decision)",
    )
    expect(failure.cause).toBeInstanceOf(TypeError)
    expect(() => script.verifyConsumed()).toThrow('Scripted model has 1 unused decision: tool')

    delete cyclic.self
    const retried = await script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })
    expect(retried.content[0]).toMatchObject({ toolCallId: 'tool-call-1' })
  })

  test('wraps BigInt serialization failures without consuming the decision', async () => {
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([callCapability('tasks.create', { sequence: 1n })])

    await expect(script.model.doGenerate({ prompt: promptWithoutToolResult, tools: [advertisedTool] })).rejects.toThrow(
      "Could not serialize input for capability 'tasks.create' at generation 1 (tool decision)",
    )
    expect(() => script.verifyConsumed()).toThrow('Scripted model has 1 unused decision: tool')
  })

  test('reports empty and unused scripts with actionable diagnostics', async () => {
    const empty = createScriptedModel({ resolveCapability })
    await expect(empty.model.doGenerate({ prompt: promptWithoutToolResult })).rejects.toThrow(
      'Scripted model has no queued decisions for generation 1',
    )

    const unused = createScriptedModel({ resolveCapability })
    unused.enqueue([answer('one'), answer('two')])
    await unused.model.doGenerate({ prompt: promptWithoutToolResult })
    expect(() => unused.verifyConsumed()).toThrow('Scripted model has 1 unused decision: answer')
  })

  test('records only sanitized prompt structure and tool metadata', async () => {
    const events = createScenarioEvents('prompt redaction')
    const script = createScriptedModel({ resolveCapability, events })
    script.enqueue([answer('safe')])

    await script.model.doGenerate({
      prompt: [
        { role: 'system', content: 'API key sk-secret-value' },
        { role: 'user', content: [{ type: 'text', text: 'password super-secret-value' }] },
      ],
      tools: [
        {
          ...advertisedTool,
          description: 'Authorization: Bearer provider-secret',
          inputSchema: { type: 'object', properties: { credential: { const: 'schema-secret' } } },
        },
      ],
      headers: { authorization: 'Bearer header-secret' },
    })

    const serialized = JSON.stringify(events.all())
    expect(serialized).not.toContain('sk-secret-value')
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('provider-secret')
    expect(serialized).not.toContain('schema-secret')
    expect(serialized).not.toContain('header-secret')
    expect(events.all()[0]?.data).toEqual({
      generation: 1,
      prompt: [
        { role: 'system', contentKinds: ['text'], contentCount: 1, toolNames: [], toolResultCount: 0 },
        { role: 'user', contentKinds: ['text'], contentCount: 1, toolNames: [], toolResultCount: 0 },
      ],
      availableTools: ['provider_tasks__create_task'],
    })
  })

  test('executes a real AI SDK tool loop before returning the scripted answer', async () => {
    const calls: unknown[] = []
    const script = createScriptedModel({ resolveCapability })
    script.enqueue([
      callCapability('tasks.create', { title: 'Release 7', projectId: 'project-1' }),
      answer('Created “Release 7”.'),
    ])

    const result = await generateText({
      model: script.model,
      tools: {
        provider_tasks__create_task: tool({
          description: 'Create a task',
          inputSchema: z.object({ title: z.string(), projectId: z.string() }),
          execute: (input) => {
            calls.push(input)
            return Promise.resolve({ id: 'task-1' })
          },
        }),
      },
      stopWhen: stepCountIs(5),
      messages: [{ role: 'user', content: 'Create Release 7' }],
    })

    expect(calls).toEqual([{ title: 'Release 7', projectId: 'project-1' }])
    expect(result.text).toBe('Created “Release 7”.')
    expect(script.inspections()).toHaveLength(2)
    expect(script.inspections()[1]?.hasToolResult).toBe(true)
    expect(() => script.verifyConsumed()).not.toThrow()
  })
})
