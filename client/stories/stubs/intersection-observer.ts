// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

let original: typeof globalThis.IntersectionObserver | undefined

class StubIntersectionObserver {
  observe(): void {
    // no-op: stories never need real intersection callbacks
  }

  unobserve(): void {
    // no-op
  }

  disconnect(): void {
    // no-op
  }

  takeRecords(): readonly IntersectionObserverEntry[] {
    return []
  }
}

export function installIntersectionObserverStub(): void {
  original ??= globalThis.IntersectionObserver
  Reflect.set(globalThis, 'IntersectionObserver', StubIntersectionObserver)
}

export function uninstallIntersectionObserverStub(): void {
  if (original !== undefined) Reflect.set(globalThis, 'IntersectionObserver', original)
  original = undefined
}
