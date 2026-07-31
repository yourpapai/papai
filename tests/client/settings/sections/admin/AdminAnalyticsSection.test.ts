// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminAnalyticsSection from '../../../../../client/settings/sections/admin/AdminAnalyticsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const sinkView = {
  sinkVersionId: 'ext:v1',
  logicalSinkId: 'ext',
  version: 1,
  kind: 'webhook',
  egressMode: 'pseudonymous',
  state: 'pending_verification',
  payloadSchemaVersion: 1,
  configFingerprint: 'fp-deadbeef',
  verifiedAtMs: null,
  createdAtMs: 100,
  disabledAtMs: null,
} as const

const adminPayload = {
  configVersion: 3,
  mode: { localMode: 'local_aggregate', externalAggregateEnabled: false, externalPseudonymousEnabled: false },
  effective: {
    killSwitchActive: false,
    localMode: 'local_aggregate',
    externalAggregateEnabled: false,
    externalPseudonymousEnabled: false,
  },
  policy: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    retainedEventHorizonDays: 30,
    reviewDateMs: 100,
    acknowledgedAtMs: null,
    policyEffectiveAtMs: null,
    subjectRightsLookupHorizonDays: 90,
  },
  readiness: { ready: false, missing: ['operator_acknowledgement', 'analytics_keyring'] },
  sinks: [],
  openPanel: { blocked: true, reasons: ['missing_caller_controlled_idempotency', 'missing_delete_actor'] },
  snapshot: { snapshotId: 'snap-1', publishedAtMs: 1000, ageMs: 5000 },
} as const

const reconcilePayload = {
  status: 'reconciled',
  liveEpochs: [],
  delivery: { total: 0, uniquePairs: 0, byState: {}, excludedNonActiveGeneration: 0, conserved: true },
  associationViolations: 0,
  eventsByName: {},
  eventsByAttributionQuality: {},
} as const

const drain = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(AdminAnalyticsSection, { target }) }
}

const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

const failThenOk = (responses: readonly Response[]): (() => Promise<Response>) => {
  let n = 0
  return () => Promise.resolve(responses[n++] ?? json(adminPayload))
}

const routeReconcile = (url: string, init: RequestInit): Promise<Response> => {
  if (methodOf(init) === 'POST' && url.endsWith('/reconcile')) return Promise.resolve(json(reconcilePayload))
  return Promise.resolve(json(adminPayload))
}

interface SinkActionState {
  seen: string[]
  sinkState: string
}

const currentSinkOf = (state: SinkActionState): Omit<typeof sinkView, 'state'> & { state: string } => ({
  ...sinkView,
  state: state.sinkState,
})

const routePatchCapture =
  (seen: string[]) =>
  (url: string, init: RequestInit): Promise<Response> => {
    seen.push(`${methodOf(init)} ${url}`)
    return Promise.resolve(json(adminPayload))
  }

const routePatchGateRefusal = (_url: string, init: RequestInit): Promise<Response> => {
  if (methodOf(init) === 'PATCH') {
    return Promise.resolve(json({ error: 'no enabled pseudonymous sink', code: 'no_enabled_pseudonymous_sink' }, 422))
  }
  return Promise.resolve(json(adminPayload))
}

const routeSinkCreate =
  (seen: string[], withSink: unknown) =>
  (url: string, init: RequestInit): Promise<Response> => {
    seen.push(`${methodOf(init)} ${url}`)
    if (methodOf(init) === 'POST' && url.endsWith('/sinks')) {
      return Promise.resolve(json({ status: 'created', sink: sinkView }))
    }
    return Promise.resolve(json(withSink))
  }

const routeSinkActions =
  (state: SinkActionState) =>
  (url: string, init: RequestInit): Promise<Response> => {
    state.seen.push(`${methodOf(init)} ${url}`)
    if (methodOf(init) === 'POST' && url.includes('/verify')) {
      state.sinkState = 'enabled'
      return Promise.resolve(json({ status: 'enabled', sink: currentSinkOf(state) }))
    }
    if (methodOf(init) === 'POST' && url.includes('/disable')) {
      state.sinkState = 'disabled'
      return Promise.resolve(json({ status: 'disabled', sink: currentSinkOf(state) }))
    }
    return Promise.resolve(json({ ...adminPayload, sinks: [currentSinkOf(state)] }))
  }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminAnalyticsSection', () => {
  test('shows a loading placeholder before the first response', () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    const { target, component } = render()
    flushSync()
    expect(target.querySelector('[data-testid="analytics-admin-loading"]')).not.toBeNull()
    void unmount(component)
  })

  test('a failed load renders ErrorState with retry', async () => {
    const responses: Response[] = [json({ error: 'boom' }, 500), json(adminPayload)]
    setMockFetch(failThenOk(responses))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click()
    await drain()
    expect(target.querySelector('[data-testid="analytics-admin-mode"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders mode, readiness checklist, retention, horizon evidence, and OpenPanel block reason', async () => {
    setMockFetch(() => Promise.resolve(json(adminPayload)))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('[data-testid="analytics-admin-mode"]')).not.toBeNull()
    const readiness = target.querySelector('[data-testid="analytics-admin-readiness"]')!
    expect(readiness.textContent).toContain('operator_acknowledgement')
    expect(readiness.textContent).toContain('analytics_keyring')
    const horizon = target.querySelector('[data-testid="analytics-admin-horizon"]')!
    expect(horizon.textContent).toContain('90')
    expect(horizon.textContent).toContain('read-only')
    expect(target.querySelector('[data-testid="analytics-admin-retention"]')).not.toBeNull()
    const openpanel = target.querySelector('[data-testid="analytics-admin-openpanel"]')!
    expect(openpanel.textContent).toContain('missing_delete_actor')
    expect(target.querySelector('[data-testid="analytics-admin-snapshot"]')!.textContent).toContain('snap-1')
    void unmount(component)
  })

  test('shows the kill switch as authoritative over stored settings', async () => {
    const kill = {
      ...adminPayload,
      effective: { ...adminPayload.effective, killSwitchActive: true, localMode: 'off' },
    }
    setMockFetch(() => Promise.resolve(json(kill)))
    const { target, component } = render()
    await drain()
    const banner = target.querySelector('[data-testid="analytics-admin-killswitch"]')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('authoritative')
    void unmount(component)
  })

  test('saving the mode PATCHes with the config version and reloads', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    setMockFetch(routePatchCapture(seen))
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-admin-save"]')!.click()
    await drain()
    expect(seen.some((entry) => entry === 'PATCH /settings/api/admin/analytics')).toBe(true)
    void unmount(component)
  })

  test('a pseudonymous gate refusal renders the controlled gate code', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePatchGateRefusal)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-admin-save"]')!.click()
    await drain()
    const alert = target.querySelector('[data-testid="analytics-admin-error"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute('role')).toBe('alert')
    void unmount(component)
  })

  test('sink creation clears the write-only secret inputs and renders the public view', async () => {
    setCsrfToken('csrf-an')
    const seen: string[] = []
    setMockFetch(routeSinkCreate(seen, { ...adminPayload, sinks: [sinkView] }))
    const { target, component } = render()
    await drain()
    const logicalId = target.querySelector<HTMLInputElement>('input[data-testid="sink-logical-id"]')!
    logicalId.value = 'ext'
    logicalId.dispatchEvent(new Event('input', { bubbles: true }))
    const endpoint = target.querySelector<HTMLInputElement>('input[data-testid="sink-endpoint"]')!
    const secret = target.querySelector<HTMLInputElement>('input[data-testid="sink-secret"]')!
    endpoint.value = 'https://sink.example.net/hook'
    endpoint.dispatchEvent(new Event('input', { bubbles: true }))
    secret.value = 'write-only-secret'
    secret.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="sink-create"]')!.click()
    await drain()
    expect(seen.some((entry) => entry === 'POST /settings/api/admin/analytics/sinks')).toBe(true)
    expect(target.querySelector<HTMLInputElement>('input[data-testid="sink-endpoint"]')!.value).toBe('')
    expect(target.querySelector<HTMLInputElement>('input[data-testid="sink-secret"]')!.value).toBe('')
    const row = target.querySelector('[data-testid="sink-row-ext:v1"]')!
    expect(row.textContent).toContain('fp-deadbeef')
    expect(row.textContent).toContain('pending_verification')
    expect(row.textContent).not.toContain('write-only-secret')
    void unmount(component)
  })

  test('verify and disable actions call the versioned endpoints', async () => {
    setCsrfToken('csrf-an')
    const state: SinkActionState = { seen: [], sinkState: sinkView.state }
    setMockFetch(routeSinkActions(state))
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="sink-verify-ext:v1"]')!.click()
    await drain()
    expect(state.seen.some((entry) => entry.includes('/sinks/ext%3Av1/verify'))).toBe(true)
    target.querySelector<HTMLButtonElement>('[data-testid="sink-disable-ext:v1"]')!.click()
    await drain()
    expect(state.seen.some((entry) => entry.includes('/sinks/ext%3Av1/disable'))).toBe(true)
    void unmount(component)
  })

  test('reconcile renders the counts-only report', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routeReconcile)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-admin-reconcile"]')!.click()
    await drain()
    const report = target.querySelector('[data-testid="analytics-admin-reconcile-result"]')
    expect(report).not.toBeNull()
    expect(report!.textContent).toContain('reconciled')
    void unmount(component)
  })
})
