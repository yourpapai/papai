// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import ReposSection from '../../../client/settings/sections/ReposSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const emptyPayload = { repos: [] }

const populatedPayload = {
  repos: [
    {
      repoId: 'r1',
      name: 'demo',
      repoUrl: 'https://github.com/acme/demo.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
    {
      repoId: 'r2',
      name: 'backend',
      repoUrl: 'https://github.com/acme/backend.git',
      baseBranch: 'dev',
      permissionPreset: 'autonomous',
    },
  ],
}

let capturedPostBody = ''
let capturedDeleteUrl = ''

const routeMock = (_url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (_url.includes('/settings/api/coding-repos')) {
    if (method === 'POST') {
      capturedPostBody = typeof init?.body === 'string' ? init.body : ''
      return Promise.resolve(json({ ok: true, repoId: 'r-new', contextId: 'pi:telegram:ctx:u1' }))
    }
    if (method === 'DELETE') {
      capturedDeleteUrl = _url
      return Promise.resolve(json({ ok: true, contextId: 'pi:telegram:ctx:u1' }))
    }
    // GET — return populated after add/delete to test list refresh
    return Promise.resolve(json(populatedPayload))
  }
  return Promise.resolve(json(emptyPayload))
}

afterEach(() => {
  capturedPostBody = ''
  capturedDeleteUrl = ''
  restoreFetch()
  setCsrfToken('')
})

describe('ReposSection', () => {
  test('renders the section with id repos', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('#repos')).not.toBeNull()
    void unmount(component)
  })

  test('renders repo list with name and repoUrl', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.textContent).toContain('demo')
    expect(target.textContent).toContain('https://github.com/acme/demo.git')
    expect(target.textContent).toContain('backend')
    void unmount(component)
  })

  test('renders delete buttons for each repo', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('[data-testid="repos-delete-r1"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="repos-delete-r2"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders the add form with name, repoUrl, baseBranch, and preset select', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('[data-testid="repos-add-name"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="repos-add-url"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="repos-add-branch"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="repos-add-preset"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="repos-add-submit"]')).not.toBeNull()
    void unmount(component)
  })

  test('add form POSTs to the repos endpoint with the form values', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const nameInput = target.querySelector<HTMLInputElement>('[data-testid="repos-add-name"]')!
    nameInput.value = 'my-project'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))

    const urlInput = target.querySelector<HTMLInputElement>('[data-testid="repos-add-url"]')!
    urlInput.value = 'https://github.com/acme/my-project.git'
    urlInput.dispatchEvent(new Event('input', { bubbles: true }))

    const branchInput = target.querySelector<HTMLInputElement>('[data-testid="repos-add-branch"]')!
    branchInput.value = 'main'
    branchInput.dispatchEvent(new Event('input', { bubbles: true }))

    const presetSelect = target.querySelector<HTMLSelectElement>('[data-testid="repos-add-preset"]')!
    presetSelect.value = 'autonomous'
    presetSelect.dispatchEvent(new Event('change', { bubbles: true }))

    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="repos-add-submit"]')!.click()
    await drain()

    expect(JSON.parse(capturedPostBody)).toMatchObject({
      contextId: 'pi:telegram:ctx:u1',
      name: 'my-project',
      repoUrl: 'https://github.com/acme/my-project.git',
      baseBranch: 'main',
      permissionPreset: 'autonomous',
    })
    void unmount(component)
  })

  test('delete button issues DELETE with repoId', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()

    expect(capturedDeleteUrl).toContain('repoId=r1')
    expect(capturedDeleteUrl).toContain('contextId=pi%3Atelegram%3Actx%3Au1')
    void unmount(component)
  })
})
