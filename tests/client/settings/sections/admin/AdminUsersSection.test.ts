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

const openAccessOnMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOn))
  return Promise.resolve(json(usersPayload))
}

const pendingPayloadMock = (url: string): Promise<Response> => {
  if (url.includes('/admin/open-access')) return Promise.resolve(json(openAccessOff))
  return Promise.resolve(json(pendingPayload))
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

afterEach(() => {
  capturedPostBody = undefined
  capturedDeleteBody = undefined
  capturedBlockBody = undefined
  enableToggleGetCount = 0
  disableToggleGetCount = 0
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
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="user-remove-42"]')).not.toBeNull()
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

  test('renders a pending badge instead of the placeholder id', async () => {
    setMockFetch(pendingPayloadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="user-pending-badge"]')).not.toBeNull()
    expect(target.textContent).toContain('ghost')
    // the only row is pending → no IdCell rendered
    expect(target.querySelector('.id-cell')).toBeNull()
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

  test('a user row with added_by open-access shows a source badge', async () => {
    setMockFetch(openAccessUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const badge = target.querySelector('[data-testid="user-source-99"]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toContain('open-access')
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
    expect(target.querySelector('.modal .status-error')).not.toBeNull()
    void unmount(component)
  })
})
