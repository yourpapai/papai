// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount } from 'svelte'

import { restoreFetch, setMockFetch, waitFor } from '../../../utils/test-helpers.js'
import ModelMetadataHintFixture from './ModelMetadataHintFixture.svelte'
type CapturedCall = Readonly<{ url: string; signal: AbortSignal | null | undefined }>

const captured: CapturedCall[] = []
const gate: { hold: boolean; release: (() => void) | null } = { hold: false, release: null }

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const hitPayload = (providerId: string, modelId: string, ctx: number, out: number): unknown => ({
  providerId,
  modelId,
  contextWindow: ctx,
  maxOutputTokens: out,
  source: 'models-dev',
  via: 'inferred',
  snapshotFetchedAt: 1_700_000_000_000,
})

const payloadFor = (model: string): unknown => {
  if (model === 'slow-model') return hitPayload('openai', 'slow-hit', 1, 1)
  if (model === 'fast-model')
    return {
      providerId: 'anthropic',
      modelId: 'claude-x',
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
      source: 'models-dev',
      via: 'override',
      snapshotFetchedAt: 1_700_000_000_000,
    }
  if (model === 'cached-model') return hitPayload('openai', 'cached-hit', 3, 4)
  if (model === 'gpt-4o') return hitPayload('openai', 'gpt-4o', 128_000, 16_384)
  if (model === 'padded-model') return hitPayload('openai', 'padded-hit', 128_000, 16_384)
  if (model === ' padded-model')
    return {
      providerId: null,
      modelId: null,
      contextWindow: null,
      maxOutputTokens: null,
      source: 'none',
      via: null,
      snapshotFetchedAt: 1_700_000_000_000,
    }
  if (model === 'mystery')
    return {
      providerId: null,
      modelId: null,
      contextWindow: null,
      maxOutputTokens: null,
      source: 'none',
      via: null,
      snapshotFetchedAt: 1_700_000_000_000,
    }
  return {
    providerId: null,
    modelId: null,
    contextWindow: null,
    maxOutputTokens: null,
    source: 'none',
    via: null,
    snapshotFetchedAt: null,
  }
}

const loadedHitsFor = (model: string): unknown => {
  if (model === 'pending-model') return hitPayload('openai', 'pending-hit', 64_000, 8_000)
  return hitPayload('openai', 'other-hit', 64_000, 8_000)
}

const installFetch = (): void => {
  setMockFetch((url, init) => {
    const parsed = new URL(url, 'https://x')
    const model = parsed.searchParams.get('model') ?? ''
    captured.push({ url: parsed.pathname + parsed.search, signal: init.signal })
    if (gate.hold && model === 'slow-model') {
      return new Promise<Response>((resolve) => {
        gate.release = (): void => {
          resolve(jsonResponse(payloadFor(model)))
        }
      })
    }
    return Promise.resolve(jsonResponse(payloadFor(model)))
  })
}

const installAbortableFetch = (): void => {
  setMockFetch((url, init) => {
    const parsed = new URL(url, 'https://x')
    const model = parsed.searchParams.get('model') ?? ''
    captured.push({ url: parsed.pathname + parsed.search, signal: init.signal })
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse(payloadFor(model))), 200)
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  })
}

afterEach(() => {
  restoreFetch()
  captured.length = 0
  gate.hold = false
  gate.release = null
  document.body.innerHTML = ''
})

interface FixtureComponent {
  setModel: (next: string) => void
  setBase: (next: { baseProvider: string; baseModel: string }) => void
}

const mountFixture = (props: Record<string, unknown>): { component: FixtureComponent; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount<Record<string, unknown>, FixtureComponent>(ModelMetadataHintFixture, {
    target,
    props: { debounceMs: 1, ...props },
  })
  flushSync()
  return { component, target }
}

const hintOf = (): string | null => document.querySelector('[data-testid="model-metadata-hint"]')?.textContent ?? null

const hintShows = (fragment: string): boolean => {
  flushSync()
  const text = hintOf()
  return text !== null && text.includes(fragment)
}

test('renders a catalogue hit with identity, context window, and output cap', async () => {
  installFetch()

  mountFixture({ providerType: 'openai', model: 'gpt-4o' })

  await waitFor(() => hintShows('models.dev · openai/gpt-4o'))
  const line = hintOf()
  expect(line).toContain('ctx 128000')
  expect(line).toContain('max out 16384')
  expect(line).not.toContain('via override')
})

test('marks an override-driven hit with via override', async () => {
  installFetch()

  const { component } = mountFixture({ providerType: 'openai', model: 'slow-model' })
  component.setBase({ baseProvider: 'anthropic', baseModel: 'claude-x' })
  flushSync()
  component.setModel('fast-model')
  flushSync()
  await waitFor(() => {
    flushSync()
    return captured.some((call) => call.url.includes('model=fast-model'))
  })
  await new Promise((resolve) => {
    setTimeout(resolve, 20)
  })

  expect(captured.at(-1)?.url).toBe(
    '/settings/api/llm-model-metadata?providerType=openai&baseProvider=anthropic&baseModel=claude-x&model=fast-model',
  )
  expect(hintOf()).toContain('models.dev · anthropic/claude-x')
  expect(hintOf()).toContain('via override')
})

test('renders a prefix guess without an output cap', async () => {
  installFetch()
  setMockFetch((url, init) => {
    const parsed = new URL(url, 'https://x')
    captured.push({ url: parsed.pathname + parsed.search, signal: init.signal })
    return Promise.resolve(
      jsonResponse({
        providerId: null,
        modelId: null,
        contextWindow: 128_000,
        maxOutputTokens: null,
        source: 'prefix-table',
        via: null,
        snapshotFetchedAt: 1_700_000_000_000,
      }),
    )
  })

  mountFixture({ model: 'gpt-4o' })

  await waitFor(() => hintShows('prefix guess'))
  const line = hintOf()
  expect(line).toContain('ctx 128000')
  expect(line).not.toContain('max out')
})

test('reports no limits known when the catalogue is loaded but the model is absent', async () => {
  installFetch()

  mountFixture({ model: 'mystery' })

  await waitFor(() => hintShows('no limits known'))
})

test('reports the catalogue as unavailable when no snapshot has ever been fetched', async () => {
  installFetch()

  mountFixture({ model: 'unknown-model' })

  await waitFor(() => hintShows('catalogue unavailable'))
})

test('renders nothing while the model field is empty', () => {
  installFetch()

  mountFixture({ model: '' })

  expect(hintOf()).toBeNull()
})

test('a superseded lookup never overwrites a newer result and is aborted', async () => {
  installFetch()
  gate.hold = true

  const { component } = mountFixture({ model: 'slow-model' })
  await waitFor(() => {
    flushSync()
    return captured.length >= 1
  })

  component.setModel('fast-model')
  flushSync()
  await waitFor(() => hintShows('claude-x'))

  gate.hold = false
  gate.release?.()
  await new Promise((resolve) => {
    setTimeout(resolve, 50)
  })

  expect(captured.map((call) => call.url)).toEqual([
    '/settings/api/llm-model-metadata?model=slow-model',
    '/settings/api/llm-model-metadata?model=fast-model',
  ])
  expect(hintOf()).toContain('claude-x')
  expect(hintOf()).not.toContain('slow-hit')
  expect(captured[0]?.signal?.aborted).toBe(true)
  expect(captured[1]?.signal?.aborted).toBe(false)
})

test('a per-key cache serves a repeated input without a second fetch', async () => {
  installFetch()

  const { component } = mountFixture({ model: 'cached-model' })
  await waitFor(() => hintShows('cached-hit'))

  component.setModel('mystery')
  flushSync()
  await waitFor(() => hintShows('no limits known'))

  component.setModel('cached-model')
  flushSync()
  await waitFor(() => hintShows('cached-hit'))

  expect(captured).toHaveLength(2)
})

test('a cache-hit run is not wiped by the aborted superseded lookup it just cancelled', async () => {
  installFetch()

  const { component } = mountFixture({ model: 'cached-model' })
  await waitFor(() => hintShows('cached-hit'))

  installAbortableFetch()

  component.setModel('slow-model')
  flushSync()
  await waitFor(() => {
    flushSync()
    return captured.length >= 2
  })

  component.setModel('cached-model')
  flushSync()
  expect(hintShows('cached-hit')).toBe(true)

  await new Promise((resolve) => {
    setTimeout(resolve, 50)
  })
  expect(hintShows('cached-hit')).toBe(true)
})

test('a padded model input fetches and caches under the trimmed model key', async () => {
  installFetch()

  const { component } = mountFixture({ model: ' padded-model' })
  await waitFor(() => hintShows('padded-hit'))
  expect(captured[0]?.url).toBe('/settings/api/llm-model-metadata?model=padded-model')

  component.setModel('padded-model')
  flushSync()
  await new Promise((resolve) => {
    setTimeout(resolve, 20)
  })

  expect(hintOf()).toContain('padded-hit')
  expect(captured).toHaveLength(1)
})

test('an unavailable answer is not cached, so a loaded snapshot is picked up on re-lookup', async () => {
  installFetch()

  const { component } = mountFixture({ model: 'pending-model' })
  await waitFor(() => hintShows('catalogue unavailable'))

  setMockFetch((url, init) => {
    const parsed = new URL(url, 'https://x')
    captured.push({ url: parsed.pathname + parsed.search, signal: init.signal })
    return Promise.resolve(jsonResponse(loadedHitsFor(String(parsed.searchParams.get('model')))))
  })

  component.setModel('other-model')
  flushSync()
  await waitFor(() => hintShows('other-hit'))

  component.setModel('pending-model')
  flushSync()
  await waitFor(() => hintShows('pending-hit'))

  expect(hintOf()).not.toContain('catalogue unavailable')
  expect(captured.map((call) => call.url)).toEqual([
    '/settings/api/llm-model-metadata?model=pending-model',
    '/settings/api/llm-model-metadata?model=other-model',
    '/settings/api/llm-model-metadata?model=pending-model',
  ])
})
