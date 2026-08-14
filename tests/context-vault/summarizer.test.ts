// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { LanguageModel } from 'ai'
import { and, eq } from 'drizzle-orm'

import { applyPush } from '../../src/context-vault/spec-store.js'
import {
  drainSpecSummarizations,
  enqueueSpecSummarization,
  type EnqueueSummarizationInput,
  type SummarizerDeps,
} from '../../src/context-vault/summarizer.js'
import { contextVaultSpecs, type ContextVaultSpecRow } from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import type { EffectiveLlmConfig } from '../../src/llm-providers/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'pi:telegram:grp:a'

interface GenerateTextArgs {
  model: LanguageModel
  prompt: string
}

const llmConfig = (source: 'global' | 'byok'): EffectiveLlmConfig => ({
  ok: true,
  source,
  main: { apiKey: 'central-key', baseUrl: 'https://llm.example', model: 'main', source },
  small: { apiKey: 'small-key-0001', baseUrl: 'https://llm.example', model: 'small', source },
  embedding: { apiKey: 'central-key', baseUrl: 'https://llm.example', model: 'emb', source },
})

const makeScheduler = (): {
  schedule: SummarizerDeps['schedule']
  clear: SummarizerDeps['clear']
  fireAll: () => void
  pendingCount: () => number
  clearedCount: () => number
} => {
  const active = new Map<ReturnType<typeof setTimeout>, () => void>()
  let cleared = 0
  const schedule = (fn: () => void): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => undefined, 9_999_999)
    active.set(timer, fn)
    return timer
  }
  const clear = (timer: ReturnType<typeof setTimeout>): void => {
    clearTimeout(timer)
    if (active.delete(timer)) cleared += 1
  }
  const fireAll = (): void => {
    for (const [timer, fn] of [...active.entries()]) {
      clearTimeout(timer)
      fn()
    }
  }
  return { schedule, clear, fireAll, pendingCount: () => active.size, clearedCount: () => cleared }
}

const makeDeps = (
  overrides: Partial<SummarizerDeps> = {},
): {
  deps: SummarizerDeps
  fireAll: () => void
  pendingCount: () => number
  clearedCount: () => number
} => {
  const scheduler = makeScheduler()
  const deps: SummarizerDeps = {
    resolveConfig: () => llmConfig('global'),
    buildModel: (): LanguageModel => 'test-model',
    generateText: () => Promise.resolve({ text: '{"one_line":"generated one-liner","summary":"generated summary"}' }),
    schedule: scheduler.schedule,
    clear: scheduler.clear,
    debounceMs: 5_000,
    ...overrides,
  }
  return {
    deps,
    fireAll: scheduler.fireAll,
    pendingCount: scheduler.pendingCount,
    clearedCount: scheduler.clearedCount,
  }
}

const getSpec = (ctx: string, id: string): ContextVaultSpecRow | undefined =>
  getDrizzleDb()
    .select()
    .from(contextVaultSpecs)
    .where(and(eq(contextVaultSpecs.configContextId, ctx), eq(contextVaultSpecs.id, id)))
    .get()

const seedSpec = (changeName = 'x'): void => {
  // No-op enqueue: seeding must not schedule the production debounced summarizer.
  applyPush(
    CTX,
    {
      repo: 'papai',
      changeName,
      files: [{ path: `a/${changeName}/proposal.md`, kind: 'proposal', hash: 'h1', mtime: 1, text: '# P\n' }],
      deletions: [],
    },
    { enqueueSummarization: () => undefined },
  )
}

const presetSummary = (specId: string, oneLine: string, summary: string): void => {
  getDrizzleDb()
    .update(contextVaultSpecs)
    .set({ oneLine, summary })
    .where(and(eq(contextVaultSpecs.configContextId, CTX), eq(contextVaultSpecs.id, specId)))
    .run()
}

const enqueueInput = (
  changedFiles: EnqueueSummarizationInput['changedFiles'],
  changeName = 'x',
  deletedPaths: string[] = [],
): EnqueueSummarizationInput => ({
  configContextId: CTX,
  specId: `papai:${changeName}`,
  changeName,
  changedFiles,
  deletedPaths,
})

describe('context-vault summarizer', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await drainSpecSummarizations()
  })

  test('a semantic file pushed with a new hash enqueues summarization and stores one_line + summary', async () => {
    seedSpec()
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"External spec memory","summary":"A vault for coding specs."}' })
    })
    const { deps, fireAll } = makeDeps({ generateText })

    enqueueSpecSummarization(
      enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: '# Proposal\n\nAdds a vault.' }]),
      deps,
    )
    expect(generateText).not.toHaveBeenCalled()

    fireAll()
    await drainSpecSummarizations()

    expect(generateText).toHaveBeenCalledTimes(1)
    const spec = getSpec(CTX, 'papai:x')
    expect(spec?.oneLine).toBe('External spec memory')
    expect(spec?.summary).toBe('A vault for coding specs.')
  })

  test('the model prompt carries the change name and the pushed file text', async () => {
    seedSpec()
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll } = makeDeps({ generateText })

    enqueueSpecSummarization(
      enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'UNIQUE PROPOSAL BODY' }]),
      deps,
    )
    fireAll()
    await drainSpecSummarizations()

    const prompt = generateText.mock.calls[0]?.[0].prompt
    expect(prompt).toContain('papai:x')
    expect(prompt).toContain('UNIQUE PROPOSAL BODY')
  })

  test('a throwing credential resolver keeps the previous summary and drains cleanly', async () => {
    seedSpec()
    presetSummary('papai:x', 'previous one-liner', 'previous summary')
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll } = makeDeps({
      generateText,
      resolveConfig: (): never => {
        throw new Error('database is gone')
      },
    })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: '# V2\n' }]), deps)
    fireAll()
    await drainSpecSummarizations()

    expect(generateText).not.toHaveBeenCalled()
    const spec = getSpec(CTX, 'papai:x')
    expect(spec?.oneLine).toBe('previous one-liner')
    expect(spec?.summary).toBe('previous summary')
  })

  test('a mechanical-only change enqueues no summarization', async () => {
    seedSpec()
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, pendingCount } = makeDeps({ generateText })

    enqueueSpecSummarization(
      enqueueInput([{ path: 'a/x/tasks.md', kind: 'tasks', text: '- [x] one\n- [ ] two\n' }]),
      deps,
    )

    expect(pendingCount()).toBe(0)
    await drainSpecSummarizations()
    expect(generateText).not.toHaveBeenCalled()
  })

  test('a semantic change without text enqueues no summarization', () => {
    seedSpec()
    const { deps, pendingCount } = makeDeps()

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal' }]), deps)

    expect(pendingCount()).toBe(0)
  })

  test('rapid pushes of the same change collapse into one LLM call with all texts', async () => {
    seedSpec()
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll, pendingCount, clearedCount } = makeDeps({ generateText })

    enqueueSpecSummarization(
      enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'PROPOSAL V2 BODY' }]),
      deps,
    )
    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/design.md', kind: 'design', text: 'DESIGN V1 BODY' }]), deps)

    expect(pendingCount()).toBe(1)
    expect(clearedCount()).toBe(1)

    fireAll()
    await drainSpecSummarizations()

    expect(generateText).toHaveBeenCalledTimes(1)
    const prompt = generateText.mock.calls[0]?.[0].prompt
    expect(prompt).toContain('PROPOSAL V2 BODY')
    expect(prompt).toContain('DESIGN V1 BODY')
  })

  test('a deletion push drops the deleted path from a pending job and cancels it when nothing remains', async () => {
    seedSpec()
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll, pendingCount, clearedCount } = makeDeps({ generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/design.md', kind: 'design', text: 'DESIGN V1 BODY' }]), deps)
    enqueueSpecSummarization(enqueueInput([], 'x', ['a/x/design.md']), deps)

    expect(pendingCount()).toBe(0)
    expect(clearedCount()).toBe(1)

    fireAll()
    await drainSpecSummarizations()
    expect(generateText).not.toHaveBeenCalled()
  })

  test('a deletion push removes only the deleted path from a pending job', async () => {
    seedSpec()
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll } = makeDeps({ generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/design.md', kind: 'design', text: 'DESIGN V1 BODY' }]), deps)
    enqueueSpecSummarization(
      enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'PROPOSAL V2 BODY' }], 'x', ['a/x/design.md']),
      deps,
    )

    fireAll()
    await drainSpecSummarizations()

    expect(generateText).toHaveBeenCalledTimes(1)
    const prompt = generateText.mock.calls[0]?.[0].prompt
    expect(prompt).toContain('PROPOSAL V2 BODY')
    expect(prompt).not.toContain('DESIGN V1 BODY')
  })

  test('pushes for different changes schedule independent jobs', async () => {
    seedSpec()
    seedSpec('y')
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll, pendingCount } = makeDeps({ generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'X BODY' }]), deps)
    enqueueSpecSummarization(enqueueInput([{ path: 'a/y/proposal.md', kind: 'proposal', text: 'Y BODY' }], 'y'), deps)

    expect(pendingCount()).toBe(2)
    fireAll()
    await drainSpecSummarizations()
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  test('an in-flight job superseded by a newer push drops its stale summary', async () => {
    seedSpec()
    presetSummary('papai:x', 'previous one-liner', 'previous summary')
    let resolveGenerate: (value: { text: string }) => void = () => undefined
    const generateText = mock(
      (args: GenerateTextArgs) =>
        new Promise<{ text: string }>((resolve) => {
          void args
          resolveGenerate = resolve
        }),
    )
    const { deps, fireAll } = makeDeps({ generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'STALE BODY' }]), deps)
    fireAll()
    expect(generateText).toHaveBeenCalledTimes(1)

    applyPush(
      CTX,
      {
        repo: 'papai',
        changeName: 'x',
        files: [{ path: 'a/x/proposal.md', kind: 'proposal', hash: 'h2', mtime: 2, text: '# V2\n' }],
        deletions: [],
      },
      { enqueueSummarization: () => undefined },
    )

    resolveGenerate({ text: '{"one_line":"stale one-liner","summary":"stale summary"}' })
    await drainSpecSummarizations()

    const spec = getSpec(CTX, 'papai:x')
    expect(spec?.oneLine).toBe('previous one-liner')
    expect(spec?.summary).toBe('previous summary')
  })

  test('a failed summarization keeps the previous summary', async () => {
    seedSpec()
    presetSummary('papai:x', 'previous one-liner', 'previous summary')
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.reject(new Error('llm unavailable'))
    })
    const { deps, fireAll } = makeDeps({ generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'NEW BODY' }]), deps)
    fireAll()
    await drainSpecSummarizations()

    const spec = getSpec(CTX, 'papai:x')
    expect(spec?.oneLine).toBe('previous one-liner')
    expect(spec?.summary).toBe('previous summary')
  })

  test('unusable model output keeps the previous summary', async () => {
    seedSpec()
    presetSummary('papai:x', 'previous one-liner', 'previous summary')
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: 'sorry, I cannot help with that' })
    })
    const { deps, fireAll } = makeDeps({ generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'NEW BODY' }]), deps)
    fireAll()
    await drainSpecSummarizations()

    const spec = getSpec(CTX, 'papai:x')
    expect(spec?.oneLine).toBe('previous one-liner')
    expect(spec?.summary).toBe('previous summary')
  })

  test('the worker resolves LLM creds through the DI seam and builds the model from them', async () => {
    seedSpec()
    const byokConfig = llmConfig('byok')
    const resolveConfig = mock((configContextId: string): EffectiveLlmConfig => {
      void configContextId
      return byokConfig
    })
    const buildModel = mock((config: EffectiveLlmConfig): LanguageModel => {
      void config
      return 'byok-model'
    })
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll } = makeDeps({ resolveConfig, buildModel, generateText })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'BODY' }]), deps)
    fireAll()
    await drainSpecSummarizations()

    expect(resolveConfig).toHaveBeenCalledWith(CTX)
    expect(buildModel).toHaveBeenCalledWith(byokConfig)
    expect(generateText.mock.calls[0]?.[0].model).toBe('byok-model')
  })

  test('summarization is skipped when no LLM config is available', async () => {
    seedSpec()
    presetSummary('papai:x', 'previous one-liner', 'previous summary')
    const generateText = mock((args: GenerateTextArgs) => {
      void args
      return Promise.resolve({ text: '{"one_line":"o","summary":"s"}' })
    })
    const { deps, fireAll } = makeDeps({
      resolveConfig: () => ({ ok: false, type: 'missing', source: 'global', missing: ['PAPAI_LLM_API_KEY'] }),
      generateText,
    })

    enqueueSpecSummarization(enqueueInput([{ path: 'a/x/proposal.md', kind: 'proposal', text: 'NEW BODY' }]), deps)
    fireAll()
    await drainSpecSummarizations()

    expect(generateText).not.toHaveBeenCalled()
    const spec = getSpec(CTX, 'papai:x')
    expect(spec?.oneLine).toBe('previous one-liner')
    expect(spec?.summary).toBe('previous summary')
  })
})
