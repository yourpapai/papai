/// <reference lib="dom" />
import { handlers } from './handlers.js'
import { state } from './state.js'

function getMessageEventData(e: Event): string | undefined {
  const candidate = e as unknown
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    'data' in candidate &&
    typeof candidate['data'] === 'string'
  ) {
    return candidate['data']
  }
  return undefined
}

export function setupEventSource(): EventSource {
  const evtSource = new EventSource('/events')

  evtSource.addEventListener('open', () => {
    state.connected = true
    window.dashboard.renderConnection(true)
  })

  evtSource.addEventListener('error', () => {
    state.connected = false
    window.dashboard.renderConnection(false)
  })

  for (const [type, handler] of Object.entries(handlers)) {
    evtSource.addEventListener(type, (e: Event) => {
      const data = getMessageEventData(e)
      if (data === undefined) return
      try {
        const parsed: unknown = JSON.parse(data)
        const eventData =
          parsed !== null && typeof parsed === 'object' && 'data' in parsed && parsed['data'] !== undefined
            ? (parsed as { data: unknown }).data
            : parsed
        const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
        if (isRecord(eventData)) {
          handler(eventData)
        }
      } catch {
        // Skip malformed events
      }
    })
  }

  return evtSource
}
