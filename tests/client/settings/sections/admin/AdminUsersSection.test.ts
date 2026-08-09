// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminUsersSection from '../../../../../client/settings/sections/admin/AdminUsersSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await Promise.resolve()
  flushSync()
}

const usersPayload = {
  users: [{ platform_user_id: '42', platform_instance_id: 'tg', username: 'jane', added_by: 'admin' }],
}
const openAccessOff = { openDmAccess: false }
const openAccessOn = { openDmAccess: true }

const openAccessUserPayload = {
  users: [
    {
      platform_user_id: '99',
      platform_instance_id: 'tg',
      username: 'auto-user',
      added_by: 'open-access',
      blocked_at: null,
    },
  ],
}

const sortCheckPayload = {
  users: [
    { platform_user_id: '30', platform_instance_id: 'tg', username: 'zoe', added_by: 'admin' },
    { platform_user_id: '10', platform_instance_id: 'tg', username: 'amy', added_by: 'admin' },
    { platform_user_id: '20', platform_instance_id: 'tg', username: 'mike', added_by: 'admin' },
  ],
}

const sortCheckMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(sortCheckPayload))
}

const usernamesInOrder = (target: HTMLElement): string[] =>
  [...target.querySelectorAll<HTMLElement>('tbody tr [data-testid^="user-username-"]')].map((el) =>
    el.textContent.trim(),
  )

const blockedUserPayload = {
  users: [
    {
      platform_user_id: '77',
      platform_instance_id: 'tg',
      username: 'blocked-user',
      added_by: 'open-access',
      blocked_at: '2026-06-18T12:00:00',
    },
  ],
}

let capturedPostBody: string | undefined
let capturedDeleteBody: string | undefined
let capturedBlockBody: string | undefined

/**
 * Route-aware mock: dispatches on URL/method to serve the right payload.
 * The component's load() calls both /admin/users (GET) and /admin/open-access (GET).
 */
const captureUsersMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'DELETE') {
    capturedDeleteBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/users') && init.method === 'POST') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

const postErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'POST')
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

const deleteErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'DELETE')
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

const pendingPayload = {
  users: [
    {
      platform_user_id: 'placeholder-123e4567-e89b-12d3-a456-426614174000',
      platform_instance_id: 'tg',
      username: 'ghost',
      added_by: 'admin',
    },
  ],
}

const pendingAddMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'POST') return Promise.resolve(json({ ok: true, pending: true }))
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

const pendingDeleteMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'DELETE') {
    capturedDeleteBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(pendingPayload))
}

const openAccessOffMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

const noUsersMock = (url: string): Promise<Response> => {
  if (url.includes('/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json({ users: [] }))
}

const openAccessOnMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOn))
  return Promise.resolve(json(usersPayload))
}

// Distinct from `pendingPayload` above (which `pendingDeleteMock` also relies on for its
// UUID-shaped id) so the status-pill test can assert against a realistic @handle-derived
// placeholder id without disturbing that other test's fixture.
const ghostPendingPayload = {
  users: [
    {
      platform_user_id: 'placeholder-@ghost',
      platform_instance_id: 'tg',
      username: 'ghost',
      added_by: 'admin',
    },
  ],
}

const ghostPendingMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(ghostPendingPayload))
}

// For the remove-confirmation label test: an @-handle-style username paired with the
// placeholder id, so `removeUserLabel` has a name to render instead of falling back to
// "this pending user". Distinct from the UUID-shaped `pendingPayload` above, which
// `pendingDeleteMock` relies on.
const handlePendingPayload = {
  users: [
    {
      platform_user_id: 'placeholder-@ghost',
      platform_instance_id: 'tg',
      username: '@ghost',
      added_by: 'admin',
    },
  ],
}

const pendingPayloadMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(handlePendingPayload))
}

const openAccessUserMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(openAccessUserPayload))
}

const blockedUserMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(blockedUserPayload))
}

const toggleOpenAccessMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/open-access') && init.method === 'POST') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, openDmAccess: true }))
  }
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

const unblockUserMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users/block') && init.method === 'POST') {
    capturedBlockBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(blockedUserPayload))
}

const blockUserMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users/block') && init.method === 'POST') {
    capturedBlockBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

// Stateful mock: first GET /admin/open-access returns off, reload after toggle returns on.
let enableToggleGetCount = 0
const enableToggleMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/open-access') && init.method === 'POST') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/open-access')) {
    enableToggleGetCount++
    return Promise.resolve(json(enableToggleGetCount === 1 ? openAccessOff : openAccessOn))
  }
  return Promise.resolve(json(usersPayload))
}

// Stateful mock: first GET /admin/open-access returns on, reload after toggle returns off.
let disableToggleGetCount = 0
const disableToggleMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/open-access') && init.method === 'POST') {
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/open-access')) {
    disableToggleGetCount++
    return Promise.resolve(json(disableToggleGetCount === 1 ? openAccessOn : openAccessOff))
  }
  return Promise.resolve(json(usersPayload))
}

const usersFailMock = (url: string): Promise<Response> => {
  if (url.includes('/open-access')) return Promise.resolve(json(openAccessOn))
  return Promise.resolve(new Response(JSON.stringify({ error: 'users boom' }), { status: 500 }))
}

const openAccessFailMock = (url: string): Promise<Response> => {
  if (url.includes('/open-access')) {
    return Promise.resolve(new Response(JSON.stringify({ error: 'access boom' }), { status: 500 }))
  }
  return Promise.resolve(json(usersPayload))
}

const neverResolvingMock = (): Promise<Response> => new Promise<Response>(() => {})

const hangingTogglePostMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/open-access') && init.method === 'POST') return new Promise<Response>(() => {})
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(usersPayload))
}

let addPostCount = 0
const countingAddMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/open-access')) return Promise.resolve(json(openAccessOff))
  if (init.method === 'POST') {
    addPostCount += 1
    return new Promise<Response>((resolve) => {
      setTimeout(() => resolve(json({ ok: true, pending: false })), 5)
    })
  }
  return Promise.resolve(json(usersPayload))
}

afterEach(() => {
  capturedPostBody = undefined
  capturedDeleteBody = undefined
  capturedBlockBody = undefined
  enableToggleGetCount = 0
  disableToggleGetCount = 0
  addPostCount = 0
  restoreFetch()
  setCsrfToken('')
})

describe('AdminUsersSection', () => {
  test('lists users', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('#users')).not.toBeNull()
    expect(target.textContent).toContain('jane')
    expect(target.querySelectorAll('tbody tr').length).toBe(1)
    void unmount(component)
  })

  test('renders search box for users table', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="settings-table-search"]')).not.toBeNull()
    void unmount(component)
  })

  test('adding a user posts userId', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ userId: '99' }))
    void unmount(component)
  })

  test('removing a user requires confirmation before DELETE fires', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    // click Remove — no DELETE yet
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-42"]')!.click()
    flushSync()
    expect(capturedDeleteBody).toBeUndefined()
    // confirm via the modal danger button
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(capturedDeleteBody).toBe(JSON.stringify({ userId: '42' }))
    void unmount(component)
  })

  test('adding a user with a username posts userId + username', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const idInput = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    idInput.value = '55'
    idInput.dispatchEvent(new Event('input', { bubbles: true }))
    const usernameInput = target.querySelectorAll<HTMLInputElement>('input')[1]!
    usernameInput.value = 'alice'
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ userId: '55', username: 'alice' }))
    void unmount(component)
  })

  test('a failed add keeps the users table visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '77'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')!.textContent).not.toBe('')
    expect(target.querySelector('[data-testid="user-remove-42"]')).not.toBeNull()
    void unmount(component)
  })

  test('a failed add re-enables the Add button and restores its label', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '77'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    const button = target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!
    button.click()
    await drain()
    expect(button.disabled).toBe(false)
    expect(button.textContent?.trim()).toBe('Add user')
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Users')
    void unmount(component)
  })

  test('renders the add form with Field/Input/Btn and users via DataTable', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="user-add-input"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="user-add"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    void unmount(component)
  })

  test('a pending user shows a pending status pill and keeps a readable handle', async () => {
    setMockFetch(ghostPendingMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const pill = target.querySelector('[data-testid="user-status-placeholder-@ghost"]')!
    expect(pill.textContent).toContain('pending')
    expect(target.textContent).toContain('ghost')
    // the placeholder prefix is machinery, not an identifier — it is not shown
    expect(target.querySelector('tbody')!.textContent).not.toContain('placeholder-')
    void unmount(component)
  })

  test('removing a pending user sends the placeholder id', async () => {
    setCsrfToken('c')
    setMockFetch(pendingDeleteMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target
      .querySelector<HTMLButtonElement>('[data-testid="user-remove-placeholder-123e4567-e89b-12d3-a456-426614174000"]')!
      .click()
    flushSync()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(capturedDeleteBody).toBe(JSON.stringify({ userId: 'placeholder-123e4567-e89b-12d3-a456-426614174000' }))
    void unmount(component)
  })

  test('a pending add shows the first-contact status message', async () => {
    setCsrfToken('c')
    setMockFetch(pendingAddMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '@ghost'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-success')?.textContent).toContain('first message the bot')
    void unmount(component)
  })

  // --- New tests: open-access toggle, source badge, block/unblock ---

  test('renders the open-access toggle card', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="open-access-card"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="open-access-toggle"]')).not.toBeNull()
    void unmount(component)
  })

  test('open-access toggle shows Enable when off', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!
    expect(toggle.textContent?.trim()).toBe('Enable')
    void unmount(component)
  })

  test('open-access toggle shows Disable when on', async () => {
    setMockFetch(openAccessOnMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!
    expect(toggle.textContent?.trim()).toBe('Disable')
    void unmount(component)
  })

  test('clicking the open-access toggle calls patchOpenAccess', async () => {
    setCsrfToken('c')
    setMockFetch(toggleOpenAccessMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ enabled: true }))
    void unmount(component)
  })

  test('the open-access toggle announces its in-flight state with aria-busy', async () => {
    setCsrfToken('c')
    setMockFetch(hangingTogglePostMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!
    expect(toggle.getAttribute('aria-busy')).toBe('false')
    toggle.click()
    await drain()
    expect(toggle.textContent.trim()).toBe('Saving…')
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('enabling open access shows "enabled" in the toast (not "disabled")', async () => {
    setCsrfToken('c')
    setMockFetch(enableToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    // Initial state: button reads "Enable" (access is off)
    expect(target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!.textContent?.trim()).toBe(
      'Enable',
    )
    target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!.click()
    await drain()
    expect(target.querySelector('.status-success')!.textContent).toContain('enabled')
    void unmount(component)
  })

  test('disabling open access shows "disabled" in the toast (not "enabled")', async () => {
    setCsrfToken('c')
    setMockFetch(disableToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    // Initial state: button reads "Disable" (access is on)
    expect(target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!.textContent?.trim()).toBe(
      'Disable',
    )
    target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!.click()
    await drain()
    expect(target.querySelector('.status-success')!.textContent).toContain('disabled')
    void unmount(component)
  })

  test('added_by open-access reads as a labelled provenance, not a raw value', async () => {
    setMockFetch(openAccessUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const cell = target.querySelector('[data-testid="user-added-by-99"]')!
    expect(cell.textContent).toContain('Open access')
    expect(cell.textContent).not.toContain('open-access')
    void unmount(component)
  })

  test('a blocked user gets a danger status pill', async () => {
    setMockFetch(blockedUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const pill = target.querySelector('.ui-pill--danger')!
    expect(pill.textContent).toContain('blocked')
    void unmount(component)
  })

  test('an active user gets an accent status pill', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('.ui-pill--accent')!.textContent).toContain('active')
    void unmount(component)
  })

  test('the username cell carries a title so a truncated name is readable', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="user-username-42"]')!.getAttribute('title')).toBe('jane')
    void unmount(component)
  })

  test('every column is width-pinned', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const headers = [...target.querySelectorAll('thead th')]
    expect(headers.length).toBe(5)
    const styles = headers.map((th) => String(th.getAttribute('style')))
    expect(styles.every((style) => style.includes('width'))).toBe(true)
    void unmount(component)
  })

  test('the four data columns render a sort control and the Actions column does not', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const headers = [...target.querySelectorAll('thead th')]
    expect(headers.length).toBe(5)
    expect(headers[0]!.querySelector('button.ui-datatable__sort')).not.toBeNull()
    expect(headers[1]!.querySelector('button.ui-datatable__sort')).not.toBeNull()
    expect(headers[2]!.querySelector('button.ui-datatable__sort')).not.toBeNull()
    expect(headers[3]!.querySelector('button.ui-datatable__sort')).not.toBeNull()
    expect(headers[4]!.querySelector('button.ui-datatable__sort')).toBeNull()
    void unmount(component)
  })

  test('the table arrives sorted by username ascending, per defaultSort', async () => {
    setMockFetch(sortCheckMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(usernamesInOrder(target)).toEqual(['amy', 'mike', 'zoe'])
    const usernameHeader = target.querySelectorAll('thead th')[1]!
    expect(usernameHeader.getAttribute('aria-sort')).toBe('ascending')
    void unmount(component)
  })

  test('activating the username sort control reverses row order, and again restores it', async () => {
    setMockFetch(sortCheckMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const usernameHeader = target.querySelectorAll('thead th')[1]!
    const sortButton = usernameHeader.querySelector<HTMLButtonElement>('button.ui-datatable__sort')!
    sortButton.click()
    flushSync()
    expect(usernamesInOrder(target)).toEqual(['zoe', 'mike', 'amy'])
    expect(usernameHeader.getAttribute('aria-sort')).toBe('descending')
    sortButton.click()
    flushSync()
    expect(usernamesInOrder(target)).toEqual(['amy', 'mike', 'zoe'])
    expect(usernameHeader.getAttribute('aria-sort')).toBe('ascending')
    void unmount(component)
  })

  test('a blocked user row shows Unblock action', async () => {
    setMockFetch(blockedUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const blockBtn = target.querySelector<HTMLButtonElement>('[data-testid="user-block-77"]')!
    expect(blockBtn.textContent?.trim()).toBe('Unblock')
    void unmount(component)
  })

  test('clicking Unblock on a blocked user calls setUserBlocked with blocked: false', async () => {
    setCsrfToken('c')
    setMockFetch(unblockUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-block-77"]')!.click()
    await drain()
    expect(capturedBlockBody).toBe(JSON.stringify({ userId: '77', blocked: false }))
    void unmount(component)
  })

  test('a non-blocked user row shows Block action', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const blockBtn = target.querySelector<HTMLButtonElement>('[data-testid="user-block-42"]')!
    expect(blockBtn.textContent?.trim()).toBe('Block')
    void unmount(component)
  })

  test('clicking Block on a non-blocked user calls setUserBlocked with blocked: true', async () => {
    setCsrfToken('c')
    setMockFetch(blockUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-block-42"]')!.click()
    await drain()
    expect(capturedBlockBody).toBe(JSON.stringify({ userId: '42', blocked: true }))
    void unmount(component)
  })

  test('a failed remove keeps the confirm dialog open and shows an inline error', async () => {
    setCsrfToken('c')
    setMockFetch(deleteErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-42"]')!.click()
    flushSync()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(target.querySelector('.modal')).not.toBeNull()
    expect(target.querySelector('.modal .status-error')!.textContent).not.toBe('')
    void unmount(component)
  })

  test('a failed user list replaces the body with a retryable error state', async () => {
    setMockFetch(usersFailMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('tbody')).toBeNull()
    expect(target.querySelector('[data-testid="user-add"]')).toBeNull()
    void unmount(component)
  })

  test('a failed open-access read keeps the user list and disables the toggle', async () => {
    setMockFetch(openAccessFailMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).toContain('jane')
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!
    expect(toggle.disabled).toBe(true)
    expect(toggle.textContent).toContain('Unavailable')
    expect(target.querySelector('[data-testid="open-access-error"]')!.textContent).toContain(
      'Could not read the open DM access setting',
    )
    void unmount(component)
  })

  test('the open-access state pill is hidden until the value loads', async () => {
    setMockFetch(openAccessFailMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="open-access-state"]')).toBeNull()
    void unmount(component)
  })

  test('a loaded open-access setting shows an enabled pill', async () => {
    setMockFetch(openAccessOnMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="open-access-state"]')!.textContent).toContain('enabled')
    void unmount(component)
  })

  test('the first load shows a loading placeholder rather than an empty table', async () => {
    setMockFetch(neverResolvingMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).toContain('Loading…')
    expect(target.textContent).not.toContain('No users')
    void unmount(component)
  })

  test('the remove confirmation names the person, not the storage id', async () => {
    setMockFetch(pendingPayloadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-placeholder-@ghost"]')!.click()
    flushSync()
    expect(document.body.textContent).toContain('@ghost (pending)')
    expect(document.body.textContent).not.toContain('placeholder-@ghost?')
    void unmount(component)
  })

  test('the remove confirmation contrasts removal with blocking', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-42"]')!.click()
    flushSync()
    const hint = document.querySelector('.modal .confirm-hint')!
    expect(hint.textContent.replace(/\s+/gu, ' ').trim()).toBe(
      'They lose access entirely and drop off this list. To keep the record and revoke access reversibly, Block them instead.',
    )
    void unmount(component)
  })

  test('block is weighted below remove', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const block = target.querySelector('[data-testid="user-block-42"]')!
    const remove = target.querySelector('[data-testid="user-remove-42"]')!
    expect(block.className).not.toContain('danger')
    expect(remove.className).toContain('danger')
    void unmount(component)
  })

  test('submitting a blank id explains why nothing happened', async () => {
    setCsrfToken('c')
    setMockFetch(countingAddMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target
      .querySelector<HTMLFormElement>('form.settings-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await drain()
    expect(target.textContent).toContain('Enter a numeric user ID or an @username.')
    expect(addPostCount).toBe(0)
    void unmount(component)
  })

  test('the add button is disabled while the id is blank', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.disabled).toBe(true)
    void unmount(component)
  })

  test('a pristine form shows no validation error', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).not.toContain('Enter a numeric user ID or an @username.')
    void unmount(component)
  })

  test('a double submit posts once', async () => {
    setCsrfToken('c')
    setMockFetch(countingAddMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    const button = target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!
    button.click()
    button.click()
    await drain()
    expect(addPostCount).toBe(1)
    void unmount(component)
  })

  test('the status line is announced politely', async () => {
    setCsrfToken('c')
    setMockFetch(unblockUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-block-77"]')!.click()
    await drain()
    const line = target.querySelector('.status-success')!
    expect(line.getAttribute('role')).toBe('status')
    void unmount(component)
  })

  test('the error line is announced assertively', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')!.getAttribute('role')).toBe('alert')
    void unmount(component)
  })

  test('an empty list points at the add form instead of dead-ending', async () => {
    setMockFetch(noUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).toContain('No users yet')
    expect(target.textContent).toContain('Add one above')
    void unmount(component)
  })

  test('the section status and error regions are mounted and empty on a clean load', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const err = target.querySelector<HTMLElement>('.status-error')!
    const ok = target.querySelector<HTMLElement>('.status-success')!
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.getAttribute('aria-live')).toBe('assertive')
    expect(err.textContent).toBe('')
    expect(ok.getAttribute('role')).toBe('status')
    expect(ok.getAttribute('aria-live')).toBe('polite')
    expect(ok.textContent).toBe('')
    void unmount(component)
  })
})
