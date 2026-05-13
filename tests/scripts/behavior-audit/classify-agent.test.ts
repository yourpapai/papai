import { afterEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import * as realAi from 'ai'
import { stepCountIs } from 'ai'
import { Output } from 'ai'

import type { ClassifyAgentDeps, ClassificationResult } from '../../../scripts/behavior-audit/classify-agent.js'
import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import { cleanupTempDirs, restoreBehaviorAuditEnv } from '../behavior-audit-integration.runtime-helpers.js'
import { loadClassifyAgentModule } from '../behavior-audit-integration.support.js'

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

function startCountingFailureServer(): {
  readonly url: string
  readonly getRequestCount: () => number
  readonly stop: () => void
} {
  let requestCount = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requestCount += 1
      return new Response('upstream failure', { status: 500 })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    getRequestCount: () => requestCount,
    stop: () => {
      void server.stop(true)
    },
  }
}

type GenerateTextResult = Awaited<ReturnType<ClassifyAgentDeps['generateText']>>

function makeSequencedGenerateText(
  results: Array<Promise<GenerateTextResult>>,
  events: string[],
): ClassifyAgentDeps['generateText'] {
  let callIndex = 0
  return (_input) => {
    const index = callIndex
    callIndex += 1
    events.push(`generate:${callIndex}`)
    return results[index]!
  }
}

describe('behavior-audit phase 2a classify agent', () => {
  test('classifyBehaviorWithRetry does not sleep before the first resumed retry attempt', async () => {
    const events: string[] = []
    const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
    const output: ClassificationResult = {
      visibility: 'user-facing',
      featureKey: 'task-creation',
      featureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'Immediate resumed success.',
    }
    const generateText: ClassifyAgentDeps['generateText'] = (_input) => {
      events.push('generate')
      return Promise.resolve({ output, totalUsage: { inputTokens: 100, outputTokens: 50 }, steps: [] })
    }
    const sleep: ClassifyAgentDeps['sleep'] = (ms) => {
      events.push('sleep')
      return Promise.resolve(ms).then((): void => undefined)
    }

    const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1, {
      config: {
        BASE_URL: 'http://localhost:1234/v1',
        MODEL: 'qwen3-30b-a3b',
        PHASE2_TIMEOUT_MS: 300_000,
        MAX_RETRIES: 3,
        RETRY_BACKOFF_MS: [25, 50, 75] as const,
        MAX_STEPS: 20,
      },
      generateText,
      outputObject: ({ schema }) => Output.object({ schema }),
      buildModel: () => 'mock-model',
      stepCountIs,
      sleep,
      createAbortSignal: () => AbortSignal.timeout(1),
    })

    assert(result !== null)
    expect(result.result.featureKey).toBe('task-creation')
    expect(events).toEqual(['generate'])
  })

  test('classifyBehaviorWithRetry sleeps before the next resumed retry attempt after a failure', async () => {
    const events: string[] = []
    const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())
    const output: ClassificationResult = {
      visibility: 'user-facing',
      featureKey: 'task-creation',
      featureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'Succeeded after one resumed retry.',
    }
    const successResult = { output, totalUsage: { inputTokens: 100, outputTokens: 50 }, steps: [] as never[] }
    const generateText = makeSequencedGenerateText(
      [Promise.reject(new Error('temporary failure')), Promise.resolve(successResult)],
      events,
    )
    const sleep: ClassifyAgentDeps['sleep'] = (ms) => {
      events.push(`sleep:${ms}`)
      return Promise.resolve(ms).then((): void => undefined)
    }

    const result = await classifyAgent.classifyBehaviorWithRetry('prompt', 1, {
      config: {
        BASE_URL: 'http://localhost:1234/v1',
        MODEL: 'qwen3-30b-a3b',
        PHASE2_TIMEOUT_MS: 300_000,
        MAX_RETRIES: 4,
        RETRY_BACKOFF_MS: [25, 50, 75] as const,
        MAX_STEPS: 20,
      },
      generateText,
      outputObject: ({ schema }) => Output.object({ schema }),
      buildModel: () => 'mock-model',
      stepCountIs,
      sleep,
      createAbortSignal: () => AbortSignal.timeout(1),
    })

    assert(result !== null)
    expect(result.result.featureKey).toBe('task-creation')
    expect(events).toEqual(['generate:1', 'sleep:50', 'generate:2'])
  })

  test('classifyBehaviorWithRetry default path reads reloaded config after module import', async () => {
    const initialServer = startCountingFailureServer()
    const reloadedServer = startCountingFailureServer()
    let capturedBaseUrl: string | null = null
    let capturedModelValue: unknown = null
    let generateTextCalls = 0

    try {
      process.env['BEHAVIOR_AUDIT_BASE_URL'] = initialServer.url
      process.env['BEHAVIOR_AUDIT_PHASE2_TIMEOUT_MS'] = '100'
      process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '1'
      reloadBehaviorAuditConfig()

      void mock.module('@ai-sdk/openai-compatible', () => ({
        createOpenAICompatible:
          ({ baseURL }: { readonly baseURL: string }) =>
          (model: string): string => {
            capturedBaseUrl = baseURL
            return `mock-model:${baseURL}:${model}`
          },
      }))
      void mock.module('ai', () => ({
        ...realAi,
        generateText: (input: { readonly model: unknown }): Promise<never> => {
          generateTextCalls += 1
          capturedModelValue = input.model
          return Promise.reject(new Error('forced failure'))
        },
      }))

      const classifyAgent = await loadClassifyAgentModule(crypto.randomUUID())

      process.env['BEHAVIOR_AUDIT_BASE_URL'] = reloadedServer.url
      reloadBehaviorAuditConfig()

      await expect(classifyAgent.classifyBehaviorWithRetry('prompt', 0)).resolves.toBeNull()
      expect(generateTextCalls).toBe(1)
      expect(initialServer.getRequestCount()).toBe(0)
      expect(reloadedServer.getRequestCount()).toBe(0)
      expect(capturedBaseUrl).not.toBeNull()
      assert(capturedBaseUrl !== null)
      const resolvedBaseUrl: string = capturedBaseUrl
      expect(resolvedBaseUrl).toBe(reloadedServer.url)
      expect(typeof capturedModelValue).toBe('string')
      expect(String(capturedModelValue)).toContain(reloadedServer.url)
    } finally {
      initialServer.stop()
      reloadedServer.stop()
    }
  })
})
