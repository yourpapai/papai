// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/admin/scrollspy.js'

type MockEntry = Pick<IntersectionObserverEntry, 'isIntersecting' | 'target' | 'intersectionRatio'>

let observers: { callback: (entries: MockEntry[]) => void; targets: Element[] }[] = []

class TrackingObserver {
  callback: (entries: MockEntry[]) => void
  targets: Element[] = []
  constructor(cb: (entries: MockEntry[]) => void) {
    this.callback = cb
    observers.push({ callback: this.callback, targets: this.targets })
  }
  observe(el: Element): void {
    this.targets.push(el)
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
}

describe('useScrollSpy', () => {
  beforeEach(() => {
    observers = []
    document.body.innerHTML = `
      <section id="overview"></section>
      <section id="billing"></section>
      <section id="stats"></section>
    `
    // @ts-expect-error – override the stub for this test
    globalThis.IntersectionObserver = TrackingObserver
  })

  test('observes every provided id and forwards the active one', () => {
    const seen: string[] = []
    const spy = useScrollSpy(['overview', 'billing', 'stats'], (id) => {
      seen.push(id)
    })
    spy.start()
    expect(observers).toHaveLength(1)
    expect(observers[0]?.targets).toHaveLength(3)
    const billingEl = document.querySelector('#billing')!
    observers[0]?.callback([{ isIntersecting: true, intersectionRatio: 1, target: billingEl } satisfies MockEntry])
    expect(seen).toEqual(['billing'])
    spy.stop()
  })

  test('ignores non-intersecting entries', () => {
    let active: string | null = 'overview'
    const spy = useScrollSpy(['overview', 'billing'], (id) => {
      active = id
    })
    spy.start()
    const billingEl = document.querySelector('#billing')!
    observers[0]?.callback([{ isIntersecting: false, intersectionRatio: 0, target: billingEl } satisfies MockEntry])
    expect(active).toBe('overview')
    spy.stop()
  })
})
