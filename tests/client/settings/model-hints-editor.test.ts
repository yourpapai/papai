// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ModelHintsEditor from '../../../client/settings/components/ModelHintsEditor.svelte'
import type { ModelHints } from '../../../client/settings/fetcher-schemas-llm-providers.js'
import { restoreFetch, setMockFetch, waitFor } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

interface CapturedRequest {
  url: string
  method: string
}

const captureCall = (calls: CapturedRequest[], url: string, init?: RequestInit): void => {
  calls.push({ url, method: init?.method ?? 'GET' })
}

const metadataRoute = (url: string): boolean => url.includes('/settings/api/llm-model-metadata')

const metadataHitPayload = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  source: 'models-dev',
  via: 'override',
  snapshotFetchedAt: 1_700_000_000_000,
}

const metadataMissPayload = {
  providerId: null,
  modelId: null,
  contextWindow: null,
  maxOutputTokens: null,
  source: 'none',
  via: null,
  snapshotFetchedAt: 1_700_000_000_000,
}

let target: HTMLElement
let instance: Record<string, unknown> | null = null

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (instance !== null) {
    void unmount(instance)
    instance = null
  }
  target.remove()
  restoreFetch()
})

const rows = (): Element[] => [...document.querySelectorAll('[data-testid="model-hints-row"]')]

const rowContaining = (text: string): Element | undefined => rows().find((row) => row.textContent?.includes(text))

const rowInput = (row: Element, testid: string): HTMLInputElement =>
  row.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!

const setInputValue = (input: HTMLInputElement, value: string): void => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ModelHintsEditor', () => {
  test('renders one row per hint with its model id, alias inputs, and remove control', () => {
    const hints: ModelHints = {
      'm-a': { baseProvider: 'openai', baseModel: 'gpt-4o' },
      'm-b': { baseProvider: 'anthropic', baseModel: 'claude-opus-4' },
    }
    instance = mount(ModelHintsEditor, { target, props: { modelHints: hints } })

    expect(rows()).toHaveLength(2)
    expect(rowContaining('m-a')).toBeDefined()
    expect(rowContaining('m-b')).toBeDefined()
    const rowA = rowContaining('m-a')!
    expect(rowInput(rowA, 'model-hints-base-provider').value).toBe('openai')
    expect(rowInput(rowA, 'model-hints-base-model').value).toBe('gpt-4o')
    expect(rowA.querySelector('[data-testid="model-hints-remove"]')).not.toBeNull()
    const rowB = rowContaining('m-b')!
    expect(rowInput(rowB, 'model-hints-base-provider').value).toBe('anthropic')
    expect(rowInput(rowB, 'model-hints-base-model').value).toBe('claude-opus-4')
  })

  test('the add-control offers only enumerated models that are not yet hinted', async () => {
    const hints: ModelHints = { 'm-a': { baseProvider: 'openai', baseModel: 'gpt-4o' } }
    const emitted: ModelHints[] = []
    instance = mount(ModelHintsEditor, {
      target,
      props: {
        modelHints: hints,
        enumeratedModels: ['m-a', 'm-b', 'm-c'],
        onHintsChange: (next: ModelHints) => emitted.push(next),
      },
    })

    const select = document.querySelector<HTMLSelectElement>('[data-testid="model-hints-add-model"]')!
    const offered = [...select.options].map((option) => option.value)
    expect(offered).toStrictEqual(['m-b', 'm-c'])

    select.value = 'm-b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await drain()

    expect(rowContaining('m-b')).toBeDefined()
    const last = emitted.at(-1)
    expect(last?.['m-b']).toStrictEqual({ baseProvider: '', baseModel: '' })
  })

  test('previews live metadata per row fed with the hint pair', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(metadataHitPayload))
    })
    const hints: ModelHints = { 'gateway-model': { baseProvider: 'openai', baseModel: 'gpt-4o' } }
    instance = mount(ModelHintsEditor, {
      target,
      props: { modelHints: hints, providerType: 'custom', baseUrl: 'https://gw.example.com/v1' },
    })

    await waitFor(() => {
      flushSync()
      return rowContaining('gateway-model')?.querySelector('[data-testid="model-metadata-hint"]') !== null
    })
    const hint = rowContaining('gateway-model')!.querySelector('[data-testid="model-metadata-hint"]')!
    expect(hint.textContent).toContain('models.dev · openai/gpt-4o')

    const metadataCalls = calls.filter((call) => metadataRoute(call.url))
    expect(metadataCalls.length).toBeGreaterThan(0)
    const urls = metadataCalls.map((call) => new URL(call.url, 'https://x'))
    for (const url of urls) {
      expect(url.searchParams.get('model')).toBe('gateway-model')
      expect(url.searchParams.get('baseProvider')).toBe('openai')
      expect(url.searchParams.get('baseModel')).toBe('gpt-4o')
      expect(url.searchParams.get('providerType')).toBe('custom')
      expect(url.searchParams.get('baseUrl')).toBe('https://gw.example.com/v1')
    }
  })

  test('shows an unresolved pair as unresolved rather than a catalogue hit', async () => {
    setMockFetch(() => Promise.resolve(json(metadataMissPayload)))
    const hints: ModelHints = { 'gateway-model': { baseProvider: 'openai', baseModel: 'absent-model' } }
    instance = mount(ModelHintsEditor, { target, props: { modelHints: hints } })

    await waitFor(() => {
      flushSync()
      return rowContaining('gateway-model')?.querySelector('[data-testid="model-metadata-hint"]') !== null
    })
    const hint = rowContaining('gateway-model')!.querySelector('[data-testid="model-metadata-hint"]')!
    expect(hint.textContent).not.toContain('models.dev')
    expect(hint.textContent).toContain('no limits known')
  })

  test('remove drops the row and emits the map without it', async () => {
    const hints: ModelHints = {
      'm-a': { baseProvider: 'openai', baseModel: 'gpt-4o' },
      'm-b': { baseProvider: 'anthropic', baseModel: 'claude-opus-4' },
    }
    const emitted: ModelHints[] = []
    instance = mount(ModelHintsEditor, {
      target,
      props: { modelHints: hints, onHintsChange: (next: ModelHints) => emitted.push(next) },
    })

    const removeA = rowContaining('m-a')!.querySelector<HTMLButtonElement>('[data-testid="model-hints-remove"]')!
    removeA.click()
    await drain()

    expect(rows()).toHaveLength(1)
    expect(rowContaining('m-a')).toBeUndefined()
    expect(rowContaining('m-b')).toBeDefined()
    const last = emitted.at(-1)
    expect(last?.['m-a']).toBeUndefined()
    expect(last?.['m-b']).toStrictEqual({ baseProvider: 'anthropic', baseModel: 'claude-opus-4' })
  })

  test('emitted map reflects alias edits and preserves the other fields', async () => {
    const hints: ModelHints = { 'm-a': { baseProvider: 'openai', baseModel: 'gpt-4o' } }
    const emitted: ModelHints[] = []
    instance = mount(ModelHintsEditor, {
      target,
      props: { modelHints: hints, onHintsChange: (next: ModelHints) => emitted.push(next) },
    })

    setInputValue(rowInput(rowContaining('m-a')!, 'model-hints-base-model'), 'gpt-4o-mini')
    await drain()

    const last = emitted.at(-1)
    expect(last?.['m-a']).toStrictEqual({ baseProvider: 'openai', baseModel: 'gpt-4o-mini' })
  })
})
