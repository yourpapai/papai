// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/settings/scrollspy.js'

interface Recorded {
  root: Element | Document | null
  rootMargin: string | undefined
}

const observed: Recorded[] = []
const RealObserver = globalThis.IntersectionObserver

class RecordingObserver {
  constructor(_cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observed.push({ root: options?.root ?? null, rootMargin: options?.rootMargin })
  }
  observe(): void {}
  disconnect(): void {}
}

afterEach(() => {
  observed.length = 0
  globalThis.IntersectionObserver = RealObserver
  document.body.innerHTML = ''
})

describe('useScrollSpy', () => {
  test('start and stop are idempotent and return a handle', () => {
    const spy = useScrollSpy(['profile', 'tools'], () => undefined)
    expect(typeof spy.start).toBe('function')
    expect(typeof spy.stop).toBe('function')
    spy.start()
    spy.start()
    spy.stop()
    spy.stop()
  })

  test('observes the viewport when no root is given', () => {
    Reflect.set(globalThis, 'IntersectionObserver', RecordingObserver)
    useScrollSpy(['profile'], () => undefined).start()
    expect(observed).toHaveLength(1)
    expect(observed[0]!.root).toBeNull()
    expect(observed[0]!.rootMargin).toBe('-30% 0px -60% 0px')
  })

  test('observes the given element when a root is passed', () => {
    document.body.innerHTML = '<div id="scroller"></div>'
    const scroller = document.querySelector<HTMLElement>('#scroller')!
    Reflect.set(globalThis, 'IntersectionObserver', RecordingObserver)
    useScrollSpy(['profile'], () => undefined, scroller).start()
    expect(observed).toHaveLength(1)
    expect(observed[0]!.root).toBe(scroller)
  })
})
