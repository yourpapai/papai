// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { plugin } from 'bun'

import { sveltePlugin } from '../scripts/svelte-plugin.js'

GlobalRegistrator.register({ url: 'http://localhost' })
void plugin(sveltePlugin({ dev: true }))

// happy-dom doesn't ship EventSource; stub it so dashboard code that opens
// an SSE connection during mount doesn't blow up in unit tests.
if (typeof globalThis.EventSource === 'undefined') {
  class StubEventSource {
    url: string
    readyState = 0
    constructor(url: string) {
      this.url = url
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  // @ts-expect-error – minimal stub
  globalThis.EventSource = StubEventSource
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  // @ts-expect-error – minimal stub
  globalThis.IntersectionObserver = function StubIntersectionObserver(
    this: IntersectionObserver,
    _callback: IntersectionObserverCallback,
  ): void {
    Object.assign(this, {
      observe(): void {},
      unobserve(): void {},
      disconnect(): void {},
      takeRecords(): IntersectionObserverEntry[] {
        return []
      },
      root: null,
      rootMargin: '',
      thresholds: [],
    })
  }
}
