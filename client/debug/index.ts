// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { mount } from 'svelte'

import { dashboard } from './debug.svelte.js'
import DebugApp from './DebugApp.svelte'

export function mountApp(target: Element): ReturnType<typeof mount> {
  return mount(DebugApp, { target, props: { dashboard } })
}

const appTarget = typeof document === 'undefined' ? null : document.querySelector('#app')

if (appTarget !== null) {
  mountApp(appTarget)
}
