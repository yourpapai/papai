// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import AnalyticsPreferencesSection from '../../../../client/settings/sections/AnalyticsPreferencesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const preferencesPayload = {
  notice: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    policyEffectiveAtMs: null,
  },
  preference: { localLongitudinal: 'unknown', externalPseudonymous: 'unknown', effectiveAtMs: null },
  explanation: 'Aggregate analytics count events in daily totals that never identify you.',
  subjectRightsAvailable: true,
} as const

const rightsUnavailablePayload = {
  ...preferencesPayload,
  preference: { localLongitudinal: 'unknown', externalPseudonymous: 'unknown', effectiveAtMs: null },
  subjectRightsAvailable: false,
} as const

const deleteFailedPayload = { status: 'failed', coverage: 'analytics_only' } as const

const routeDeleteFailed = (url: string, init: RequestInit): Promise<Response> => {
  if (init.method === 'POST' && url.endsWith('/delete')) return Promise.resolve(json(deleteFailedPayload))
  return Promise.resolve(getBody())
}

const withdrawPayload = { status: 'completed', eventsRemoved: 2, deliveryRowsRemoved: 0, censorsApplied: 1 } as const
const deletePayload = { status: 'completed', coverage: 'analytics_only' } as const
const exportPayload = {
  productAnalytics: { events: [], sessions: [], deliveries: [] },
  governance: { preference: null, audit: [] },
  coverage: 'analytics_only',
  outOfScope: 'analytics only',
} as const

const drain = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(AnalyticsPreferencesSection, { target }) }
}

const clickConfirmButton = (label: string): void => {
  const button = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.includes(label))
  expect(button, `confirm button "${label}"`).toBeDefined()
  button!.click()
}

const getBody = (): Response => json(preferencesPayload)
const putBody = (): Response =>
  json({ ok: true, preference: { localLongitudinal: 'allow', externalPseudonymous: 'unknown', effectiveAtMs: 5 } })

const routePutCapture =
  (bodies: string[]) =>
  (_url: string, init: RequestInit): Promise<Response> => {
    if (init.method === 'PUT') {
      bodies.push(typeof init.body === 'string' ? init.body : '')
      return Promise.resolve(putBody())
    }
    return Promise.resolve(getBody())
  }

const routePutPending = (_url: string, init: RequestInit): Promise<Response> => {
  if (init.method === 'PUT') return new Promise<Response>(() => {})
  return Promise.resolve(getBody())
}

const routePutFailure = (_url: string, init: RequestInit): Promise<Response> => {
  if (init.method === 'PUT') return Promise.resolve(json({ error: 'nope' }, 500))
  return Promise.resolve(getBody())
}

// The first GET is the mount-time load; every later GET is a refresh click. `after` is what the
// refresh resolves to, so a test can hold it in flight or fail it without a conditional of its own.
const routeRefresh = (after: () => Promise<Response>): (() => Promise<Response>) => {
  let calls = 0
  return () => {
    calls += 1
    return calls === 1 ? Promise.resolve(getBody()) : after()
  }
}

const refreshNeverSettles = (): Promise<Response> => new Promise<Response>(() => {})
const refreshFails = (): Promise<Response> => Promise.resolve(json({ error: 'boom' }, 500))

const isGroupishTestId = (el: Element): boolean => {
  const id = el.getAttribute('data-testid') ?? ''
  return id.includes('group') || id.includes('member') || id.includes('context')
}

const failThenOk = (responses: readonly Response[]): (() => Promise<Response>) => {
  let n = 0
  return () => Promise.resolve(responses[n++] ?? getBody())
}

const routeDelete = (url: string, init: RequestInit): Promise<Response> => {
  if (init.method === 'POST' && url.endsWith('/delete')) return Promise.resolve(json(deletePayload))
  return Promise.resolve(getBody())
}

const routeExport =
  (seen: string[]) =>
  (url: string, init: RequestInit): Promise<Response> => {
    seen.push(`${init.method ?? 'GET'} ${url}`)
    if (url.endsWith('/export')) {
      return Promise.resolve(
        json(exportPayload, 200, {
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="papai-analytics-export.json"',
        }),
      )
    }
    return Promise.resolve(getBody())
  }

const routeWithdraw =
  (seen: string[]) =>
  (url: string, init: RequestInit): Promise<Response> => {
    seen.push(`${init.method ?? 'GET'} ${url}`)
    if (url.endsWith('/withdraw')) return Promise.resolve(json(withdrawPayload))
    return Promise.resolve(getBody())
  }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AnalyticsPreferencesSection', () => {
  test('shows a loading placeholder before the first response', () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    const { target, component } = render()
    flushSync()
    expect(target.querySelector('[data-testid="analytics-loading"]')).not.toBeNull()
    void unmount(component)
  })

  test('a failed load renders ErrorState with retry', async () => {
    const responses: Response[] = [json({ error: 'boom' }, 500), getBody()]
    setMockFetch(failThenOk(responses))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click()
    await drain()
    expect(target.querySelector('[data-testid="analytics-local-allow"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders notice, explanation, and both actor-only choices once loaded', async () => {
    setMockFetch(() => Promise.resolve(getBody()))
    const { target, component } = render()
    await drain()
    expect(target.textContent).toContain('product improvement')
    expect(target.textContent).toContain('privacy@example.com')
    expect(target.textContent).toContain('daily totals')
    for (const id of [
      'analytics-local-allow',
      'analytics-local-deny',
      'analytics-external-allow',
      'analytics-external-deny',
    ]) {
      expect(target.querySelector(`[data-testid="${id}"]`), id).not.toBeNull()
    }
    expect(target.querySelector('[data-testid="analytics-field-local"]')!.textContent).toContain('No choice recorded')
    expect(target.querySelector('[data-testid="analytics-field-external"]')!.textContent).toContain(
      'external analytics stay off',
    )
    void unmount(component)
  })

  test('contains no control for another member or group-wide consent', async () => {
    setMockFetch(() => Promise.resolve(getBody()))
    const { target, component } = render()
    await drain()
    const groupish = Array.from(target.querySelectorAll('[data-testid]')).filter(isGroupishTestId)
    expect(groupish).toEqual([])
    void unmount(component)
  })

  test('choosing a lane PUTs only that lane for the signed-in actor', async () => {
    setCsrfToken('csrf-an')
    const bodies: string[] = []
    setMockFetch(routePutCapture(bodies))
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-allow"]')!.click()
    await drain()
    expect(bodies).toEqual([JSON.stringify({ localLongitudinal: 'allow' })])
    expect(target.querySelector('[data-testid="analytics-field-local"]')!.textContent).toContain('Allowed since')
    expect(target.querySelector('[data-testid="analytics-success"]')!.getAttribute('role')).toBe('status')
    void unmount(component)
  })

  test('a failed choice reports under the lane it failed on and says nothing changed', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePutFailure)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-deny"]')!.click()
    await drain()
    const field = target.querySelector('[data-testid="analytics-field-local"]')!
    const fieldError = field.querySelector('.settings-field__error')
    expect(fieldError).not.toBeNull()
    expect(fieldError!.getAttribute('role')).toBe('alert')
    expect(fieldError!.textContent).toContain('The setting was not changed.')
    expect(
      target.querySelector('[data-testid="analytics-field-external"]')!.querySelector('.settings-field__error'),
    ).toBeNull()
    void unmount(component)
  })

  test('export POSTs and announces the analytics-only download', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    const originalCreateObjectURL: unknown = Reflect.get(URL, 'createObjectURL')
    // happy-dom's blob-anchor click leaks async navigation state into later files
    // sharing this process; the component no-ops without createObjectURL.
    Reflect.set(URL, 'createObjectURL', undefined)
    setMockFetch(routeExport(seen))
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-export"]')!.click()
    await drain()
    expect(seen.some((entry) => entry === 'POST /settings/api/analytics/export')).toBe(true)
    expect(target.querySelector('[data-testid="analytics-success"]')!.textContent).toContain('analytics')
    Reflect.set(URL, 'createObjectURL', originalCreateObjectURL)
    void unmount(component)
  })

  test('withdraw requires destructive confirmation and announces the result', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    setMockFetch(routeWithdraw(seen))
    const { target, component } = render()
    await drain()
    expect(seen.some((entry) => entry.includes('/withdraw'))).toBe(false)

    target.querySelector<HTMLButtonElement>('[data-testid="analytics-withdraw"]')!.click()
    await drain()
    clickConfirmButton('Withdraw analytics consent')
    await drain()
    expect(seen.some((entry) => entry === 'POST /settings/api/analytics/withdraw')).toBe(true)
    expect(target.querySelector('[data-testid="analytics-success"]')!.textContent).toContain('Withdrawn')
    void unmount(component)
  })

  test('delete requires destructive confirmation and reports the queued status', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routeDelete)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-delete"]')!.click()
    await drain()
    clickConfirmButton('Delete my analytics data')
    await drain()
    expect(target.querySelector('[data-testid="analytics-success"]')!.textContent).toContain('has been deleted')
    void unmount(component)
  })

  test('buttons disable and go busy while an action is pending', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePutPending)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-allow"]')!.click()
    flushSync()
    for (const id of ['analytics-export', 'analytics-withdraw', 'analytics-delete']) {
      const btn = target.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
      expect(btn.disabled, id).toBe(true)
      expect(btn.getAttribute('aria-busy'), id).toBe('true')
      expect(btn.classList.contains('ui-btn--busy'), id).toBe(true)
    }
    void unmount(component)
  })

  test('the live regions exist before there is anything to announce', async () => {
    setMockFetch(() => Promise.resolve(getBody()))
    const { target, component } = render()
    await drain()
    const success = target.querySelector('[data-testid="analytics-success"]')
    const error = target.querySelector('[data-testid="analytics-error"]')
    expect(success).not.toBeNull()
    expect(error).not.toBeNull()
    expect(success!.textContent).toBe('')
    expect(error!.textContent).toBe('')
    expect(success!.getAttribute('aria-live')).toBe('polite')
    expect(error!.getAttribute('aria-live')).toBe('assertive')
    void unmount(component)
  })

  test('a failed deletion is announced as an alert, not as a success', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routeDeleteFailed)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-delete"]')!.click()
    await drain()
    clickConfirmButton('Delete my analytics data')
    await drain()
    expect(target.querySelector('[data-testid="analytics-error"]')!.textContent).toContain('Deletion failed')
    expect(target.querySelector('[data-testid="analytics-success"]')!.textContent).toBe('')
    void unmount(component)
  })

  test('unavailable subject rights disable export alongside withdraw and delete', async () => {
    setMockFetch(() => Promise.resolve(json(rightsUnavailablePayload)))
    const { target, component } = render()
    await drain()
    for (const id of ['analytics-export', 'analytics-withdraw', 'analytics-delete']) {
      expect(target.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.disabled, id).toBe(true)
    }
    void unmount(component)
  })

  test('unavailable subject rights explain the deployment without claiming nothing is collected', async () => {
    setMockFetch(() => Promise.resolve(json(rightsUnavailablePayload)))
    const { target, component } = render()
    await drain()
    const notice = target.querySelector('[data-testid="analytics-rights-unavailable"]')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain('operator')
    expect(notice!.textContent).toContain('Aggregate analytics')
    expect(target.querySelector('[data-testid="analytics-field-local"]')!.textContent).not.toContain(
      'No choice recorded',
    )
    void unmount(component)
  })

  test('the local lane radiogroup is described by its own status line', async () => {
    setMockFetch(() => Promise.resolve(getBody()))
    const { target, component } = render()
    await drain()
    const field = target.querySelector('[data-testid="analytics-field-local"]')!
    const describedBy = field.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(field.querySelector(`#${describedBy}`)!.textContent).toContain('No choice recorded')
    void unmount(component)
  })

  test('a failed lane save describes the radiogroup by its own error line', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePutFailure)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-deny"]')!.click()
    await drain()
    const field = target.querySelector('[data-testid="analytics-field-local"]')!
    const describedBy = field.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    const errorEl = field.querySelector('.settings-field__error')!
    expect(errorEl.getAttribute('id')).toBe(describedBy)
    expect(field.querySelector(`#${describedBy}`)).toBe(errorEl)
    expect(field.querySelector(`#${describedBy}`)!.textContent).toContain('The setting was not changed.')
    void unmount(component)
  })

  test('a refresh click marks the header IconButton busy while in flight', async () => {
    setMockFetch(routeRefresh(refreshNeverSettles))
    const { target, component } = render()
    await drain()
    const refreshBtn = target.querySelector<HTMLButtonElement>('[data-testid="analytics-refresh"]')!
    expect(refreshBtn.getAttribute('aria-busy')).toBeNull()
    refreshBtn.click()
    flushSync()
    expect(refreshBtn.getAttribute('aria-busy')).toBe('true')
    expect(refreshBtn.classList.contains('ui-iconbtn--busy')).toBe(true)
    void unmount(component)
  })

  test('a failed refresh after a successful load is announced and keeps the loaded data visible', async () => {
    setMockFetch(routeRefresh(refreshFails))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-refresh"]')!.click()
    await drain()
    expect(target.querySelector('.ui-error')).toBeNull()
    expect(target.querySelector('[data-testid="analytics-field-local"]')).not.toBeNull()
    const error = target.querySelector('[data-testid="analytics-error"]')!
    expect(error.textContent).toContain('Something went wrong on the server')
    expect(error.getAttribute('role')).toBe('alert')
    void unmount(component)
  })

  test('an in-flight save marks the radiogroup busy', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePutPending)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-allow"]')!.click()
    flushSync()
    const group = target.querySelector('[data-testid="analytics-field-local"]')!.querySelector('[role="radiogroup"]')!
    expect(group.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })
})
