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

const failDeleteMock = (_url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const isCodingRepos = _url.includes('/settings/api/coding-repos')
  const isFailingDelete = isCodingRepos && method === 'DELETE'
  return isFailingDelete
    ? Promise.resolve(new Response('nope', { status: 500 }))
    : Promise.resolve(json(isCodingRepos ? populatedPayload : emptyPayload))
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

  test('the row delete button opens a confirm dialog without issuing DELETE', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()

    const modal = target.querySelector<HTMLElement>('.modal')!
    expect(modal.textContent).toContain('Delete repository')
    expect(modal.textContent).toContain('demo')
    expect(capturedDeleteUrl).toBe('')
    void unmount(component)
  })

  test('confirming the dialog issues DELETE with repoId', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    await drain()

    expect(capturedDeleteUrl).toContain('repoId=r1')
    expect(capturedDeleteUrl).toContain('contextId=pi%3Atelegram%3Actx%3Au1')
    expect(target.querySelector('.modal')).toBeNull()
    void unmount(component)
  })

  test('a failed DELETE closes the dialog and surfaces the error', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(failDeleteMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    await drain()

    expect(target.querySelector('.modal')).toBeNull()
    const errorEl = target.querySelector<HTMLElement>('.status-error')!
    expect(errorEl).not.toBeNull()
    expect(Boolean(errorEl.textContent)).toBe(true)
    void unmount(component)
  })

  test('cancelling the dialog leaves the repository in place', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--secondary')!.click()
    await drain()

    expect(capturedDeleteUrl).toBe('')
    expect(target.querySelector('.modal')).toBeNull()
    expect(target.querySelector('[data-testid="repos-row-r1"]')).not.toBeNull()
    void unmount(component)
  })

  test('add form parses newline/comma domains and POSTs additionalEgressDomains', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const set = (testid: string, value: string): void => {
      const el = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)!
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('repos-add-name', 'my-project')
    set('repos-add-url', 'https://github.com/acme/my-project.git')
    set('repos-add-branch', 'main')
    set('repos-add-egress', 'pypi.org, files.pythonhosted.org\nnpm.pkg.dev')

    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="repos-add-submit"]')!.click()
    await drain()

    const parsed: unknown = JSON.parse(capturedPostBody)
    expect(parsed).toMatchObject({
      additionalEgressDomains: ['pypi.org', 'files.pythonhosted.org', 'npm.pkg.dev'],
    })
    void unmount(component)
  })

  test('the preset control renders through the shared Select primitive and is labelled', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const preset = target.querySelector<HTMLSelectElement>('[data-testid="repos-add-preset"]')!
    expect(preset.closest('.ui-select')).not.toBeNull()
    expect(preset.getAttribute('aria-labelledby')).not.toBeNull()
    void unmount(component)
  })

  test('the egress control renders through the shared multiline Input and is labelled', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const egress = target.querySelector<HTMLTextAreaElement>('[data-testid="repos-add-egress"]')!
    expect(egress.closest('.ui-input--multiline')).not.toBeNull()
    expect(egress.getAttribute('aria-labelledby')).not.toBeNull()
    void unmount(component)
  })

  test('preset options run from most to least restricted', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const preset = target.querySelector<HTMLSelectElement>('[data-testid="repos-add-preset"]')!
    expect([...preset.options].map((o) => o.value)).toEqual(['readonly', 'cautious', 'autonomous'])
    expect(preset.value).toBe('cautious')
    void unmount(component)
  })

  test('a context with no repositories renders an empty state', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('.ui-empty')).not.toBeNull()
    expect(target.textContent).toContain('No repositories connected')
    void unmount(component)
  })

  test('a populated context renders no empty state', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('.ui-empty')).toBeNull()
    void unmount(component)
  })

  test('the three mandatory fields are marked required and the optional ones are not', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const labelFor = (testid: string): HTMLElement =>
      target
        .querySelector<HTMLElement>(`[data-testid="${testid}"]`)!
        .closest('.ui-field')!
        .querySelector<HTMLElement>('.ui-field__label')!

    expect(labelFor('repos-add-name').querySelector('.ui-field__req')).not.toBeNull()
    expect(labelFor('repos-add-url').querySelector('.ui-field__req')).not.toBeNull()
    expect(labelFor('repos-add-branch').querySelector('.ui-field__req')).not.toBeNull()
    expect(labelFor('repos-add-preset').querySelector('.ui-field__req')).toBeNull()
    expect(labelFor('repos-add-egress').querySelector('.ui-field__req')).toBeNull()
    void unmount(component)
  })

  test('a failed load renders framed copy in an announced alert', async () => {
    setMockFetch(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const alert = target.querySelector<HTMLElement>('.status-error')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Something went wrong on the server')
    expect(alert.textContent).not.toContain('boom')
    void unmount(component)
  })

  test('a successful add announces its status', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const set = (testid: string, value: string): void => {
      const el = target.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('repos-add-name', 'my-project')
    set('repos-add-url', 'https://github.com/acme/my-project.git')
    set('repos-add-branch', 'main')

    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="repos-add-submit"]')!.click()
    await drain()
    await drain()

    const status = target.querySelector<HTMLElement>('.status-success')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toContain('Repository added.')
    void unmount(component)
  })
})
