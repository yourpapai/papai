// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { mount } from 'svelte'

import { bootstrapSession, registerExpiryHandler } from './session.svelte.js'
import SettingsApp from './SettingsApp.svelte'

export function readCodeFromLocation(search: string): string | null {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  return code !== null && code.length > 0 ? code : null
}

export function stripCodeFromUrl(): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('code')) return
  params.delete('code')
  const newSearch = params.size > 0 ? `?${params.toString()}` : ''
  window.history.replaceState(null, '', `${window.location.pathname}${newSearch}${window.location.hash}`)
}

export async function start(target: Element): Promise<void> {
  registerExpiryHandler()
  // Mount first: bootstrap is a network round trip, and until the component exists
  // the page is settings.html's empty <div id="app"> -- a blank screen with no text.
  // Mounting first puts the loading gate on screen for the whole wait.
  mount(SettingsApp, { target })
  const code = readCodeFromLocation(window.location.search)
  await bootstrapSession(code)
  if (code !== null) stripCodeFromUrl()
}

if (typeof document !== 'undefined' && document.getElementById('app') !== null) {
  void start(document.getElementById('app')!)
}
