// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import {
  broadcastReleaseNotes,
  fetchReleaseNotes,
  regenerateReleaseNotes,
  saveReleaseNotes,
} from '../../../client/settings/admin-fetchers.js'
import { ReleaseNotesResponseSchema } from '../../../client/settings/fetcher-schemas-release.js'
import AdminReleaseNotesSection from '../../../client/settings/sections/admin/AdminReleaseNotesSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const bodyOf = (init: RequestInit): unknown => JSON.parse(typeof init.body === 'string' ? init.body : '')
const bodyOrNull = (init: RequestInit | undefined): unknown =>
  init?.body === undefined || init?.body === null ? null : bodyOf(init)

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const releaseNotesPayload = {
  version: '1.2.3',
  bodies: { en: 'This release includes new features.', ru: 'В этом релизе новые функции.' },
  broadcastAt: null,
  counts: { dm: 5, group: 3 },
}

afterEach(() => {
  restoreFetch()
})

describe('ReleaseNotesResponseSchema per-locale bodies', () => {
  test('parses a bodies map response', () => {
    const parsed = ReleaseNotesResponseSchema.parse(releaseNotesPayload)
    expect(parsed.bodies).toEqual({ en: 'This release includes new features.', ru: 'В этом релизе новые функции.' })
  })

  test('accepts null per-locale bodies and an optional rawBody', () => {
    const parsed = ReleaseNotesResponseSchema.parse({
      version: '1.2.3',
      bodies: { en: null, ru: null },
      rawBody: 'raw section',
      broadcastAt: null,
      counts: { dm: 0, group: 0 },
    })
    expect(parsed.bodies.en).toBeNull()
    expect(parsed.bodies.ru).toBeNull()
  })

  test('rejects an unsupported locale key', () => {
    const result = ReleaseNotesResponseSchema.safeParse({
      ...releaseNotesPayload,
      bodies: { en: 'x', ru: 'y', fr: 'z' },
    })
    expect(result.success).toBe(false)
  })
})

describe('release notes fetchers pass locale', () => {
  test('saveReleaseNotes sends the locale with the save action', async () => {
    const inits: RequestInit[] = []
    setMockFetch((_input, init) => {
      inits.push(init)
      return Promise.resolve(json(releaseNotesPayload))
    })
    await saveReleaseNotes('сохранённый текст', 'ru')
    expect(inits).toHaveLength(1)
    expect(bodyOf(inits[0]!)).toEqual({ action: 'save', locale: 'ru', body: 'сохранённый текст' })
  })

  test('regenerateReleaseNotes sends the locale with the regenerate action', async () => {
    const inits: RequestInit[] = []
    setMockFetch((_input, init) => {
      inits.push(init)
      return Promise.resolve(json(releaseNotesPayload))
    })
    await regenerateReleaseNotes('ru')
    expect(bodyOf(inits[0]!)).toEqual({ action: 'regenerate', locale: 'ru' })
  })

  test('fetchReleaseNotes parses the per-locale bodies map', async () => {
    setMockFetch(() => Promise.resolve(json(releaseNotesPayload)))
    const data = await fetchReleaseNotes()
    expect(data.bodies.ru).toBe('В этом релизе новые функции.')
  })

  test('broadcastReleaseNotes still posts the broadcast action', async () => {
    const inits: RequestInit[] = []
    setMockFetch((_input, init) => {
      inits.push(init)
      return Promise.resolve(
        json({ version: '1.2.3', broadcast: { sent: 1, failed: 0, skipped: 0 }, counts: { dm: 1, group: 0 } }),
      )
    })
    await broadcastReleaseNotes()
    expect(bodyOf(inits[0]!)).toEqual({ action: 'broadcast' })
  })
})

describe('AdminReleaseNotesSection per-locale editors', () => {
  test('renders a locale switcher: en editor first, ru editor after switching', async () => {
    setMockFetch(() => Promise.resolve(json(releaseNotesPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    expect(target.querySelector('#release-notes')).not.toBeNull()
    expect(target.textContent).toContain('1.2.3')
    expect(target.querySelector('[data-testid="release-notes-body-en"]')).not.toBeNull()

    target.querySelector<HTMLButtonElement>('[data-testid="release-notes-locale-ru"]')?.click()
    await drain()
    expect(target.querySelector('[data-testid="release-notes-body-ru"]')).not.toBeNull()
    void unmount(component)
  })

  test('each locale editor carries its own body', async () => {
    setMockFetch(() => Promise.resolve(json(releaseNotesPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    const enEditor = target.querySelector<HTMLInputElement>('[data-testid="release-notes-body-en"]')
    expect(enEditor?.value).toBe('This release includes new features.')

    target.querySelector<HTMLButtonElement>('[data-testid="release-notes-locale-ru"]')?.click()
    await drain()
    const ruEditor = target.querySelector<HTMLInputElement>('[data-testid="release-notes-body-ru"]')
    expect(ruEditor?.value).toBe('В этом релизе новые функции.')
    void unmount(component)
  })

  test('save posts only the edited locale when its button is clicked', async () => {
    const posts: unknown[] = []
    setMockFetch((_input, init) => {
      posts.push(bodyOrNull(init))
      return Promise.resolve(json(releaseNotesPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="release-notes-locale-ru"]')?.click()
    await drain()
    const ruSave = target.querySelector<HTMLButtonElement>('[data-testid="release-notes-save-ru"]')
    expect(ruSave).not.toBeNull()
    ruSave?.click()
    await drain()

    expect(posts).toContainEqual({ action: 'save', locale: 'ru', body: 'В этом релизе новые функции.' })
    void unmount(component)
  })

  test('regenerate posts the locale whose button is clicked', async () => {
    const posts: unknown[] = []
    setMockFetch((_input, init) => {
      posts.push(bodyOrNull(init))
      return Promise.resolve(json(releaseNotesPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    const enRegen = target.querySelector<HTMLButtonElement>('[data-testid="release-notes-regenerate-en"]')
    expect(enRegen).not.toBeNull()
    enRegen?.click()
    await drain()

    expect(posts).toContainEqual({ action: 'regenerate', locale: 'en' })
    void unmount(component)
  })

  test('a locale with no body disables its save button', async () => {
    setMockFetch(() => Promise.resolve(json({ ...releaseNotesPayload, bodies: { en: 'EN only', ru: null } })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="release-notes-locale-ru"]')?.click()
    await drain()
    const ruSave = target.querySelector<HTMLButtonElement>('[data-testid="release-notes-save-ru"]')
    expect(ruSave?.disabled).toBe(true)
    void unmount(component)
  })

  test('broadcast stays enabled on the empty ru tab when en has a body', async () => {
    setMockFetch(() => Promise.resolve(json({ ...releaseNotesPayload, bodies: { en: 'EN only', ru: null } })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="release-notes-locale-ru"]')?.click()
    await drain()
    const broadcast = target.querySelector<HTMLButtonElement>('[data-testid="release-notes-broadcast"]')
    expect(broadcast).not.toBeNull()
    expect(broadcast?.disabled).toBe(false)
    void unmount(component)
  })

  test('broadcast disables when no editor has any content', async () => {
    setMockFetch(() => Promise.resolve(json({ ...releaseNotesPayload, bodies: { en: null, ru: null }, rawBody: null })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    const broadcast = target.querySelector<HTMLButtonElement>('[data-testid="release-notes-broadcast"]')
    expect(broadcast?.disabled).toBe(true)
    void unmount(component)
  })

  test('shows already broadcast indicator when broadcastAt is set', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({
          ...releaseNotesPayload,
          broadcastAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    expect(target.textContent).toContain('already broadcast')
    void unmount(component)
  })
})
