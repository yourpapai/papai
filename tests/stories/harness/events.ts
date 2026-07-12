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
  currentPhase(): string
  formatFailure(message: string): string
}>

const REDACTED = '[REDACTED]'
const ENCODED_REDACTED = '%5BREDACTED%5D'
const TRANSCRIPT_PATH = /^\/t\/[^/]+(\/(?:transcript|stream))?$/u
const ABSOLUTE_URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/giu
const RELATIVE_TRANSCRIPT_IN_TEXT = /(^|[^A-Za-z0-9_/-])\/t\/[^/\s?#]+(\/(?:transcript|stream))?(?=$|[\s?#)"'<.,;!])/gu

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  const isDescriptor = ['algorithm', 'policy', 'status', 'type', 'version'].some((suffix) =>
    normalized.endsWith(suffix),
  )
  if (isDescriptor) return false
  const isCredential = normalized.endsWith('credential') || normalized.endsWith('credentials')
  const isSignature = normalized === 'sig' || normalized.endsWith('signature')
  return (
    normalized === 'authorization' ||
    normalized === 'proxyauthorization' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized.includes('csrf') ||
    normalized === 'xapikey' ||
    normalized === 'apikey' ||
    normalized === 'key' ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('privatekey') ||
    isCredential ||
    isSignature
  )
}

const redactTranscriptPathname = (pathname: string): string => {
  const match = TRANSCRIPT_PATH.exec(pathname)
  if (match === null) return pathname
  return `/t/${REDACTED}${match[1] ?? ''}`
}

const sanitizeUrl = (url: URL): string => {
  const sanitized = new URL(url.toString())
  const redactedPathname = redactTranscriptPathname(sanitized.pathname)
  const hasTranscriptBearer = redactedPathname !== sanitized.pathname
  sanitized.pathname = redactedPathname
  if (sanitized.username !== '') sanitized.username = REDACTED
  if (sanitized.password !== '') sanitized.password = REDACTED
  const query = [...sanitized.searchParams.entries()].map(([key, value]): string[] => [
    key,
    isSensitiveKey(key) ? REDACTED : value,
  ])
  sanitized.search = new URLSearchParams(query).toString()
  const serialized = sanitized.toString()
  return hasTranscriptBearer ? serialized.replace(`/t/${ENCODED_REDACTED}`, `/t/${REDACTED}`) : serialized
}

const shouldSanitizeUrl = (url: URL): boolean =>
  url.username !== '' ||
  url.password !== '' ||
  [...url.searchParams.keys()].some(isSensitiveKey) ||
  TRANSCRIPT_PATH.test(url.pathname)

const sanitizeAbsoluteUrlsInText = (value: string): string =>
  value.replace(ABSOLUTE_URL_IN_TEXT, (candidate): string => {
    const punctuation = /[.,;!]+$/u.exec(candidate)?.[0] ?? ''
    const rawUrl = punctuation === '' ? candidate : candidate.slice(0, -punctuation.length)
    try {
      const parsed = new URL(rawUrl)
      return shouldSanitizeUrl(parsed) ? `${sanitizeUrl(parsed)}${punctuation}` : candidate
    } catch {
      return candidate
    }
  })

const sanitizeRelativeTranscriptPaths = (value: string): string =>
  value.replace(
    RELATIVE_TRANSCRIPT_IN_TEXT,
    (_match, prefix: string, suffix: string | undefined): string => `${prefix}/t/${REDACTED}${suffix ?? ''}`,
  )

const sanitizeString = (value: string): string => {
  try {
    const parsed = new URL(value)
    if (shouldSanitizeUrl(parsed)) return sanitizeUrl(parsed)
  } catch {
    // Non-URL text may still contain absolute or relative transcript bearer links.
  }
  return sanitizeRelativeTranscriptPaths(sanitizeAbsoluteUrlsInText(value))
}

const sanitizeObject = (value: object, seen: ReadonlySet<object>): unknown => {
  if (seen.has(value)) return '[Circular]'
  const descendants = new Set(seen)
  descendants.add(value)

  if (value instanceof Headers) {
    return Object.fromEntries(
      [...value.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, item]) => [name, sanitize(item, name, descendants)]),
    )
  }
  if (value instanceof URL) return sanitizeUrl(value)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (Buffer.isBuffer(value)) return { type: 'Buffer', byteLength: value.byteLength, data: '[Binary]' }
  if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength, data: '[Binary]' }
  if (ArrayBuffer.isView(value)) {
    return {
      type: Object.prototype.toString.call(value).slice(8, -1),
      byteLength: value.byteLength,
      data: '[Binary]',
    }
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, '', descendants))

  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Object.fromEntries(
    Object.entries(descriptors)
      .filter(([, descriptor]) => descriptor.enumerable === true)
      .map(([name, descriptor]) => [
        name,
        'value' in descriptor ? sanitize(descriptor.value, name, descendants) : '[Accessor]',
      ]),
  )
}

const sanitize = (value: unknown, key = '', seen: ReadonlySet<object> = new Set<object>()): unknown => {
  if (isSensitiveKey(key)) return REDACTED
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'function') return '[Function]'
  if (typeof value === 'symbol') return '[Symbol]'
  if (value !== null && typeof value === 'object') return sanitizeObject(value, seen)
  return value === undefined ? '[Undefined]' : value
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
        data: sanitize(data),
      } as const satisfies ScenarioEvent
      recorded = [...recorded, event]
      return snapshot(event)
    },
    all,
    recent,
    setPhase(nextPhase): void {
      phase = nextPhase
    },
    currentPhase: (): string => phase,
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
