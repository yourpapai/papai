// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ScenarioEvent = Readonly<{
  seq: number
  phase: string
  kind: string
  data: unknown
}>

export type ScenarioEvents = Readonly<{
  record(kind: string, data?: unknown): ScenarioEvent
  all(): readonly ScenarioEvent[]
  recent(limit: number): readonly ScenarioEvent[]
  setPhase(phase: string): void
  formatFailure(message: string): string
}>

const REDACTED = '[REDACTED]'

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  return (
    normalized === 'authorization' ||
    normalized === 'proxyauthorization' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized === 'xapikey' ||
    normalized === 'apikey' ||
    normalized.includes('token') ||
    normalized.includes('secret')
  )
}

const sanitize = (value: unknown, key = ''): unknown => {
  if (isSensitiveKey(key)) return REDACTED
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (value instanceof Headers) {
    return Object.fromEntries([...value.entries()].map(([name, item]) => [name, sanitize(item, name)]))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]))
  }
  return value
}

const snapshot = <T>(value: T): T => structuredClone(value)

export function createScenarioEvents(scenarioName: string): ScenarioEvents {
  let phase = 'setup'
  let recorded: readonly ScenarioEvent[] = []

  const all = (): readonly ScenarioEvent[] => snapshot(recorded)
  const recent = (limit: number): readonly ScenarioEvent[] => {
    const count = Math.max(0, Math.trunc(limit))
    return snapshot(recorded.slice(Math.max(0, recorded.length - count)))
  }

  return {
    record(kind, data = {}): ScenarioEvent {
      const event = {
        seq: recorded.length + 1,
        phase,
        kind,
        data: sanitize(snapshot(data)),
      } as const satisfies ScenarioEvent
      recorded = [...recorded, event]
      return snapshot(event)
    },
    all,
    recent,
    setPhase(nextPhase): void {
      phase = nextPhase
    },
    formatFailure(message): string {
      return [
        message,
        `scenario: ${scenarioName}`,
        `phase: ${phase}`,
        'recent events:',
        JSON.stringify(recent(10), null, 2),
      ].join('\n')
    },
  }
}
