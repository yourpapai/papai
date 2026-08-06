// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/shared/scrollspy.js'

type MockEntry = Pick<IntersectionObserverEntry, 'isIntersecting' | 'target' | 'intersectionRatio'>

interface Recorded {
  callback: (entries: MockEntry[]) => void
  targets: Element[]
  root: Element | Document | null
  rootMargin: string | undefined
}

let observers: Recorded[] = []
const RealObserver = globalThis.IntersectionObserver

class TrackingObserver {
  private readonly record: Recorded
  constructor(cb: (entries: MockEntry[]) => void, options?: IntersectionObserverInit) {
    this.record = {
      callback: cb,
      targets: [],
      root: options?.root ?? null,
      rootMargin: options?.rootMargin,
    }
    observers.push(this.record)
  }
  observe(el: Element): void {
    this.record.targets.push(el)
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

beforeEach(() => {
  observers = []
  document.body.innerHTML = `
    <section id="overview"></section>
    <section id="billing"></section>
    <section id="stats"></section>
  `
  Reflect.set(globalThis, 'IntersectionObserver', TrackingObserver)
})

afterEach(() => {
  observers = []
  globalThis.IntersectionObserver = RealObserver
  document.body.innerHTML = ''
})

describe('useScrollSpy', () => {
  test('start and stop are idempotent and return a handle', () => {
    const spy = useScrollSpy(['overview', 'billing'], () => undefined)
    expect(typeof spy.start).toBe('function')
    expect(typeof spy.stop).toBe('function')
    spy.start()
    spy.start()
    expect(observers).toHaveLength(1)
    spy.stop()
    spy.stop()
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

  test('observes the viewport when no root is given', () => {
    useScrollSpy(['overview'], () => undefined).start()
    expect(observers).toHaveLength(1)
    expect(observers[0]!.root).toBeNull()
    expect(observers[0]!.rootMargin).toBe('-30% 0px -60% 0px')
  })

  test('observes the given element when a root is passed', () => {
    document.body.innerHTML = '<div id="scroller"><section id="overview"></section></div>'
    const scroller = document.querySelector<HTMLElement>('#scroller')!
    useScrollSpy(['overview'], () => undefined, scroller).start()
    expect(observers).toHaveLength(1)
    expect(observers[0]!.root).toBe(scroller)
  })
})
