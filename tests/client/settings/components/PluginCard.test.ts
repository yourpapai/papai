// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import PluginCard from '../../../../client/settings/components/PluginCard.svelte'
import type { PluginEntry } from '../../../../client/settings/fetcher-schemas.js'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  id: 'my-plugin',
  name: 'My Plugin',
  active: true,
  enabled: false,
  eligibility: { eligible: true },
  contextConfig: [],
  ...over,
})

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return {
    component: mount(PluginCard, {
      target,
      props: { contextId: 'user:1', onChanged: () => Promise.resolve(), onRequestClear: () => {}, ...props },
    }),
    target,
  }
}

// Conditional mock logic must live outside test() bodies — oxlint's
// no-conditional-in-test forbids if/ternary/?? directly inside a test.
const makePatchTracker = (): {
  mock: (url: string, init: RequestInit) => Promise<Response>
  wasPatched: () => boolean
} => {
  let patched = false
  return {
    mock: (url, init) => {
      if (url.includes('/plugins/config') && init.method === 'PATCH') patched = true
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    },
    wasPatched: () => patched,
  }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('PluginCard', () => {
  test('the toggle stays busy across the request and the reload that follows', async () => {
    setCsrfToken('c')
    let releaseToggle: (() => void) | undefined
    setMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          releaseToggle = (): void => resolve(json({ ok: true, contextId: 'user:1' }))
        }),
    )
    let releaseReload: (() => void) | undefined
    const { component, target } = render({
      plugin: entry(),
      onChanged: () =>
        new Promise<void>((resolve) => {
          releaseReload = resolve
        }),
    })
    flushSync()

    const btn = target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!
    btn.click()
    await drain()
    expect(btn.getAttribute('aria-busy')).toBe('true')

    releaseToggle!()
    await drain()
    // The request resolved but the parent is still re-fetching — a second click here
    // would send a contradictory toggle against stale data.
    expect(btn.getAttribute('aria-busy')).toBe('true')

    releaseReload!()
    await drain()
    expect(btn.getAttribute('aria-busy')).toBe('false')
    void unmount(component)
  })

  test('a failed toggle shows the error on the card, not on the section', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(new Response('Server Error', { status: 500 })))
    const { component, target } = render({ plugin: entry() })
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="plugin-card-error-my-plugin"]')).not.toBeNull()
    void unmount(component)
  })

  test('saving an empty required field shows the error on that field and does not PATCH', async () => {
    setCsrfToken('c')
    const tracker = makePatchTracker()
    setMockFetch(tracker.mock)
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-token"]')!.click()
    await drain()

    const row = target.querySelector('[data-testid="plugin-cfg-row-my-plugin-token"]')!
    const alert = row.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('required')
    expect(tracker.wasPatched()).toBe(false)
    void unmount(component)
  })

  test('saving an empty required field clears any earlier card-level error', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(new Response('Server Error', { status: 500 })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!.click()
    await drain()
    expect(target.querySelector('[data-testid="plugin-card-error-my-plugin"]')).not.toBeNull()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-token"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="plugin-card-error-my-plugin"]')).toBeNull()
    const row = target.querySelector('[data-testid="plugin-cfg-row-my-plugin-token"]')!
    const alert = row.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('required')
    void unmount(component)
  })

  test('a successful save acknowledges with a Saved marker', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'note', label: 'Note', required: false, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-note"]')!
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-note"]')!.click()
    await drain()

    const note = target.querySelector('[data-testid="plugin-cfg-note-my-plugin-note"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toContain('Saved')
    void unmount(component)
  })

  test('an unchanged response says so instead of claiming a save', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1', unchanged: true })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'note', label: 'Note', required: false, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-note"]')!
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-note"]')!.click()
    await drain()

    const note = target.querySelector('[data-testid="plugin-cfg-note-my-plugin-note"]')!
    expect(note.textContent).toContain('No change')
    void unmount(component)
  })

  test('a sensitive field with a stored value rests masked behind Replace', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [
          { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****WvfQ' },
        ],
      }),
    })
    flushSync()

    expect(target.querySelector('.ui-secret')).not.toBeNull()
    expect(target.querySelector('.ui-secret__value')!.textContent).toBe('••••WvfQ')
    expect(target.querySelector('[data-testid="plugin-cfg-input-my-plugin-api_key"]')).toBeNull()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-replace-my-plugin-api_key"]')!.click()
    flushSync()
    expect(target.querySelector('[data-testid="plugin-cfg-input-my-plugin-api_key"]')).not.toBeNull()
    void unmount(component)
  })

  test('a non-sensitive stored value is readable in the editor, not hidden behind "(set)"', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [
          {
            key: 'base_url',
            label: 'Base URL',
            required: false,
            sensitive: false,
            hasValue: true,
            value: 'https://example.test',
          },
        ],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-base_url"]')!
    expect(input.value).toBe('https://example.test')
    expect(target.textContent).not.toContain('(set)')
    void unmount(component)
  })

  test('a required field marks its control aria-required instead of appending an asterisk to the label', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-token"]')!
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(target.querySelector('.settings-field__label')!.textContent).toBe('Token*')
    expect(target.querySelector('.settings-field__req')!.getAttribute('aria-hidden')).toBe('true')
    void unmount(component)
  })
})
