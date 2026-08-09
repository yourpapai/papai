// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { Glob } from 'bun'

// A live region announces a change only if the element existed before the text arrived.
// LiveRegion.svelte is the one component allowed to build that markup; everywhere else,
// `role="alert"` / `role="status"` / `aria-live` means a hand-rolled region that is almost
// certainly mounted together with its message.
//
// These files are knowingly still on the old shape. The list is the checked-in form of a
// deliberate scope decision, not a backlog of unknowns -- it shrinks as sections convert.
// See docs/superpowers/specs/2026-08-09-live-region-adoption-design.md.
const ALLOWLIST = [
  'debug/DebugApp.svelte',
  'settings/components/PluginCard.svelte',
  'settings/components/SettingsGate.svelte',
  'settings/sections/ByokSection.svelte',
  'settings/sections/CodeHostSection.svelte',
  'settings/sections/CodingCredentialsSection.svelte',
  'settings/sections/CodingIdentitySection.svelte',
  'settings/sections/GroupProviderSection.svelte',
  'settings/sections/GuestModeSection.svelte',
  'settings/sections/IdentitySection.svelte',
  'settings/sections/ReleaseSubscriptionSection.svelte',
  'settings/sections/ReposSection.svelte',
  'settings/sections/TaskProviderSection.svelte',
  'settings/sections/admin/AdminAnalyticsSection.svelte',
  'settings/sections/admin/AdminInstancesSection.svelte',
  'settings/sections/admin/AdminModelsSection.svelte',
  'settings/sections/admin/AdminPluginsConfigSection.svelte',
  'shared/ui/ErrorState.svelte',
  'transcript/TranscriptView.svelte',
  'transcript/components/StatusBanner.svelte',
]

const OWNER = 'shared/ui/LiveRegion.svelte'
const PATTERN = /role="(?:alert|status)"|aria-live/u

const offenders = async (): Promise<string[]> => {
  const found: string[] = []
  for await (const path of new Glob('**/*.svelte').scan({ cwd: 'client' })) {
    const normalized = path.replaceAll('\\', '/')
    if (normalized === OWNER) continue
    const source = await Bun.file(`client/${normalized}`).text()
    if (PATTERN.test(source)) found.push(normalized)
  }
  return found.sort()
}

describe('live-region guard', () => {
  test('no file outside the allowlist hand-rolls live-region markup', async () => {
    const unexpected = (await offenders()).filter((p) => !ALLOWLIST.includes(p))
    expect(unexpected).toEqual([])
  })

  // Without this, a converted file could sit on the list forever and the list would stop
  // describing anything real.
  test('every allowlist entry still hand-rolls live-region markup', async () => {
    const found = await offenders()
    const stale = ALLOWLIST.filter((p) => !found.includes(p))
    expect(stale).toEqual([])
  })

  test('the allowlist is sorted and free of duplicates', () => {
    expect(ALLOWLIST).toEqual([...new Set(ALLOWLIST)].sort())
  })
})
