// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { mount } from 'svelte'

import AdminApp from './AdminApp.svelte'
import { ensureAuthenticated } from './auth.js'

export function mountAdminApp(target: Element): ReturnType<typeof mount> {
  return mount(AdminApp, { target })
}

if (typeof document !== 'undefined' && document.getElementById('app') !== null) {
  void ensureAuthenticated().then((state) => {
    if (state.authenticated) {
      mountAdminApp(document.getElementById('app')!)
    } else {
      document.body.innerHTML = `
    <main style="font-family: system-ui; max-width: 540px; margin: 4rem auto; padding: 1rem; line-height: 1.5;">
      <h1>Sign in required</h1>
      <p>DM <code>/dashboard</code> to the bot to receive a sign-in link.</p>
    </main>`
    }
  })
}
