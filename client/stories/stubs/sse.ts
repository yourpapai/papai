// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type Listener = (event: MessageEvent) => void

interface SeedEvent {
  type: string
  payload: unknown
}

const openConnections = new Set<StubEventSource>()
const eventHistory: SeedEvent[] = []
let originalEventSource: typeof globalThis.EventSource | undefined

class StubEventSource {
  readonly url: string
  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    openConnections.add(this)
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (set === undefined) {
      set = new Set<Listener>()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.listeners.clear()
    openConnections.delete(this)
  }

  dispatch(type: string, payload: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

export interface SseStub {
  emit: (type: string, payload: unknown) => void
  seed: (events: readonly SeedEvent[]) => void
  reset: () => void
  history: () => readonly SeedEvent[]
}

export const sseStub: SseStub = {
  emit(type, payload) {
    eventHistory.push({ type, payload })
    for (const conn of openConnections) conn.dispatch(type, payload)
  },
  seed(events) {
    for (const event of events) sseStub.emit(event.type, event.payload)
  },
  reset() {
    eventHistory.length = 0
    for (const conn of openConnections) conn.close()
    openConnections.clear()
  },
  history() {
    return eventHistory
  },
}

export function installSseStub(): void {
  originalEventSource ??= globalThis.EventSource
  Reflect.set(globalThis, 'EventSource', StubEventSource)
}

export function uninstallSseStub(): void {
  sseStub.reset()
  if (originalEventSource !== undefined) Reflect.set(globalThis, 'EventSource', originalEventSource)
  originalEventSource = undefined
}
