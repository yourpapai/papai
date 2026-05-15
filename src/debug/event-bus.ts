export type Scope =
  | { kind: 'user'; userId: string }
  | { kind: 'group'; groupId: string; threadId?: string }
  | { kind: 'global' }

export type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
  __scope: Scope
  turnId?: string
}

type Listener = (event: DebugEvent) => void

const listeners = new Set<Listener>()
const warnedTypes = new Set<string>()

function makeEvent(type: string, data: Record<string, unknown>, scope: Scope, turnId?: string): DebugEvent {
  const event: DebugEvent = { type, timestamp: Date.now(), data, __scope: scope }
  if (turnId !== undefined) event.turnId = turnId
  return event
}

function dispatch(event: DebugEvent): void {
  for (const fn of listeners) fn(event)
}

/** @public -- consumed by source modules in Session 3 */
export function emit(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return
  if (!warnedTypes.has(type)) {
    warnedTypes.add(type)
    console.warn(`[event-bus] bare emit("${type}") is deprecated — use emitUser, emitGroup, or emitGlobal instead`)
  }
  dispatch(makeEvent(type, data, { kind: 'global' }))
}

export function emitUser(type: string, userId: string, data: Record<string, unknown>, turnId?: string): void {
  if (listeners.size === 0) return
  dispatch(makeEvent(type, data, { kind: 'user', userId }, turnId))
}

export function emitGroup(
  type: string,
  groupId: string,
  data: Record<string, unknown>,
  turnId?: string,
  threadId?: string,
): void {
  if (listeners.size === 0) return
  dispatch(makeEvent(type, data, { kind: 'group', groupId, threadId }, turnId))
}

export function emitGlobal(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return
  dispatch(makeEvent(type, data, { kind: 'global' }))
}

export function subscribe(fn: Listener): void {
  listeners.add(fn)
}

export function unsubscribe(fn: Listener): void {
  listeners.delete(fn)
}
