// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ScrollSpyHandle {
  start: () => void
  stop: () => void
}

export const useScrollSpy = (sectionIds: readonly string[], onChange: (id: string) => void): ScrollSpyHandle => {
  let observer: IntersectionObserver | null = null

  const start = (): void => {
    if (observer !== null) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.id
          if (sectionIds.includes(id)) onChange(id)
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    for (const id of sectionIds) {
      const el = document.getElementById(id)
      if (el !== null) observer.observe(el)
    }
  }

  const stop = (): void => {
    observer?.disconnect()
    observer = null
  }

  return { start, stop }
}
