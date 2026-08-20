// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import ContextVaultSection from '../../../../client/settings/sections/ContextVaultSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const emptyPayload = { tokens: [] }

const populatedPayload = {
  tokens: [
    { tokenId: 't1', label: 'laptop indexer', createdAt: 1700000000000, lastUsedAt: null, revokedAt: null },
    { tokenId: 't2', label: 'ci indexer', createdAt: 1700000100000, lastUsedAt: 1700000200000, revokedAt: null },
  ],
}

let capturedPostBody = ''
let capturedDeleteUrl = ''

const routeMock = (url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (url.includes('/settings/api/context-vault/tokens')) {
    if (method === 'POST') {
      capturedPostBody = typeof init?.body === 'string' ? init.body : ''
      return Promise.resolve(
        json({ ok: true, tokenId: 't-new', plaintext: 'cv-secret-plaintext-value', contextId: 'pi:telegram:ctx:u1' }),
      )
    }
    if (method === 'DELETE') {
      capturedDeleteUrl = url
      return Promise.resolve(json({ ok: true, contextId: 'pi:telegram:ctx:u1' }))
    }
    return Promise.resolve(json(populatedPayload))
  }
  return Promise.resolve(json(emptyPayload))
}

const failDeleteMock = (url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const isTokens = url.includes('/settings/api/context-vault/tokens')
  const isFailingDelete = isTokens && method === 'DELETE'
  return isFailingDelete
    ? Promise.resolve(new Response('nope', { status: 500 }))
    : Promise.resolve(json(isTokens ? populatedPayload : emptyPayload))
}

const mountSection = (target: HTMLElement): ReturnType<typeof mount> =>
  mount(ContextVaultSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

afterEach(() => {
  capturedPostBody = ''
  capturedDeleteUrl = ''
  restoreFetch()
  setCsrfToken('')
})

describe('ContextVaultSection', () => {
  test('renders the section with id context-vault', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    expect(target.querySelector('#context-vault')).not.toBeNull()
    void unmount(component)
  })

  test('renders the token list masked: labels are visible and no plaintext ever appears', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    expect(target.querySelector('[data-testid="vault-token-row-t1"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="vault-token-row-t2"]')).not.toBeNull()
    expect(target.textContent).toContain('laptop indexer')
    expect(target.textContent).toContain('ci indexer')
    expect(target.textContent).not.toContain('cv-secret')
    void unmount(component)
  })

  test('a context with no tokens renders an empty state', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(component)
  })

  test('the create form POSTs the label and contextId to the tokens endpoint', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    const labelInput = target.querySelector<HTMLInputElement>('[data-testid="vault-create-label"]')!
    labelInput.value = 'workstation indexer'
    labelInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="vault-create-submit"]')!.click()
    await drain()

    expect(JSON.parse(capturedPostBody)).toMatchObject({
      contextId: 'pi:telegram:ctx:u1',
      label: 'workstation indexer',
    })
    void unmount(component)
  })

  test('a created token shows its plaintext exactly once in a reveal panel', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()
    expect(target.querySelector('[data-testid="vault-created-plaintext"]')).toBeNull()

    const labelInput = target.querySelector<HTMLInputElement>('[data-testid="vault-create-label"]')!
    labelInput.value = 'workstation indexer'
    labelInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="vault-create-submit"]')!.click()
    await drain()
    await drain()

    const reveal = target.querySelector<HTMLElement>('[data-testid="vault-created-plaintext"]')!
    expect(reveal).not.toBeNull()
    expect(reveal.textContent).toContain('cv-secret-plaintext-value')
    expect(target.textContent).toContain('shown only once')

    // The list reload that follows the create renders rows without the plaintext.
    const row = target.querySelector<HTMLElement>('[data-testid="vault-token-row-t1"]')!
    expect(row).not.toBeNull()
    expect(row.textContent).not.toContain('cv-secret-plaintext-value')
    void unmount(component)
  })

  test('the revoke button opens a confirm dialog without issuing DELETE', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="vault-revoke-t1"]')!.click()
    await drain()

    const modal = target.querySelector<HTMLElement>('.modal')!
    expect(modal).not.toBeNull()
    expect(modal.textContent).toContain('laptop indexer')
    expect(capturedDeleteUrl).toBe('')
    void unmount(component)
  })

  test('confirming the dialog issues DELETE with tokenId and closes the modal', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="vault-revoke-t1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!.click()
    await drain()
    await drain()

    expect(capturedDeleteUrl).toContain('tokenId=t1')
    expect(capturedDeleteUrl).toContain('contextId=pi%3Atelegram%3Actx%3Au1')
    expect(target.querySelector('.modal')).toBeNull()
    void unmount(component)
  })

  test('a failed DELETE closes the dialog and surfaces the error', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(failDeleteMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="vault-revoke-t1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!.click()
    await drain()

    expect(target.querySelector('.modal')).toBeNull()
    const errorEl = target.querySelector<HTMLElement>('.status-error')!
    expect(errorEl).not.toBeNull()
    expect(errorEl.textContent).toContain('Something went wrong on the server')
    void unmount(component)
  })

  test('a failed load renders framed copy in an announced alert without leaking the server body', async () => {
    setMockFetch(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)

    await drain()

    const alert = target.querySelector<HTMLElement>('.status-error')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Something went wrong on the server')
    expect(alert.textContent).not.toContain('boom')
    void unmount(component)
  })
})
