// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { render, useInput, useStdout } from 'ink'
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { KeyFlags } from './gate-session-state.js'
import type { RemoveRunResult } from './remove-run.js'
import { removeRunMessage } from './remove-run.js'
import { routeOfRow } from './session-flow.js'
import type { SessionTargetAction } from './session-flow.js'
import { listSessions } from './session-list.js'
import type { SessionRow } from './session-list.js'
import { runAckScreen } from './tui-ack-screen.js'
import type { AckInstance, AckMount } from './tui-ack-screen.js'
import { reduceHelpOverlay } from './tui-chrome.js'
import type { OverlayState } from './tui-chrome.js'
import { createKeyFeed } from './tui-gate-session.js'
import type { KeyFeed } from './tui-gate-session.js'
import { createScriptKeys, pumpScript } from './tui-session-keys.js'
import type { ScriptKeys } from './tui-session-keys.js'
import { initialSessionScreenState, reduceSessionScreen, SessionScreen } from './tui-session-screen.js'
import type { SessionScreenAction, SessionScreenState } from './tui-session-screen.js'
import { colorModeFromStdout } from './tui-tokens.js'
import { useTerminalWidth } from './tui-width.js'

/**
 * Live driver for the session screen loop: re-read rows → render → settle a
 * decision → execute it (through the session-flow seam or the creation
 * starter) → loop. Only an explicit quit (or an exhausted script) exits;
 * failures surface as a notice with any-key return. Tests pass `keyScript`
 * and get one shared scripted key stream across every iteration.
 */

type ListDecision = Extract<
  SessionScreenAction,
  { kind: 'route' | 'stop' | 'reopen' | 'delete' | 'refuseDelete' | 'submitCreate' }
>

export interface SessionPickerDeps {
  /** Defaults to listing the work dir's runs. */
  readonly listRows?: () => Promise<readonly SessionRow[]>
  readonly workDir?: string
  /** Scripted key source standing in for a live terminal. */
  readonly keyScript?: string
  /** First iteration's screen; defaults to the list. */
  readonly initial?: 'list' | 'create'
  /** Executes gate/resume/stop/reopen through the session-flow seam. */
  readonly execute: (action: SessionTargetAction) => Promise<void>
  /** Builds a completed run's report for in-shell display. */
  readonly buildReport: (runId: string) => Promise<string>
  /** Starts a new run from the creation form's composed task text. */
  readonly createRun: (taskText: string) => Promise<void>
  /** Guarded removal seam: one run dir, fresh state read + owner liveness. */
  readonly removeRun: (runId: string) => Promise<RemoveRunResult>
  /** Injectable list-screen mount (tests); defaults to the live ink renderer. */
  readonly mount?: AckMount
}

function SessionPicker(props: {
  readonly rows: readonly SessionRow[]
  readonly initial: SessionScreenState
  readonly now: Date
  readonly onSettle: (decision: ListDecision | null) => void
  readonly keys?: KeyFeed
}): ReturnType<typeof createElement> {
  const { stdout } = useStdout()
  const width = useTerminalWidth()
  const colorMode = useMemo(() => colorModeFromStdout(stdout), [stdout])
  const [state, setState] = useState<SessionScreenState>(props.initial)
  const stateRef = useRef(state)
  const [overlay, setOverlay] = useState<OverlayState>({ open: false })
  const overlayRef = useRef(overlay)
  const handle = useCallback(
    (input: string, key: KeyFlags): void => {
      if (stateRef.current.screen !== 'confirmDelete') {
        const routing = reduceHelpOverlay(overlayRef.current, stateRef.current.screen === 'create', input, key)
        if (routing.kind === 'state') {
          overlayRef.current = routing.state
          setOverlay(routing.state)
          return
        }
        if (routing.kind === 'consume') return
      }
      const action = reduceSessionScreen(stateRef.current, props.rows, input, key)
      if (action.kind === 'none') return
      if (action.kind === 'state') {
        stateRef.current = action.state
        setState(action.state)
        return
      }
      if (action.kind === 'abandon') {
        props.onSettle(null)
        return
      }
      props.onSettle(action)
    },
    [props],
  )
  useInput(handle, { isActive: props.keys === undefined })
  useEffect(() => {
    if (props.keys === undefined) return undefined
    return props.keys.onKey(handle)
  }, [props.keys, handle])
  return createElement(SessionScreen, { rows: props.rows, state, now: props.now, width, colorMode, overlay })
}

function liveListMount(element: ReturnType<typeof createElement>): AckInstance {
  const instance = render(element, { stdin: process.stdin, exitOnCtrlC: false })
  return {
    unmount: (): void => {
      instance.unmount()
    },
    lastFrame: (): undefined => undefined,
  }
}

function runListScreen(deps: {
  readonly rows: readonly SessionRow[]
  readonly initial: SessionScreenState
  readonly script: ScriptKeys | undefined
  readonly mount: AckMount
}): Promise<ListDecision | null> {
  const keys = deps.script === undefined ? undefined : createKeyFeed()
  return new Promise<ListDecision | null>((resolve) => {
    let settled = false
    const finish = (outcome: ListDecision | null): void => {
      if (settled) return
      settled = true
      instance.unmount()
      resolve(outcome)
    }
    const instance = deps.mount(
      createElement(SessionPicker, {
        rows: deps.rows,
        initial: deps.initial,
        now: new Date(),
        ...(keys === undefined ? {} : { keys }),
        onSettle: finish,
      }),
    )
    if (keys === undefined || deps.script === undefined) return
    void pumpScript(keys, deps.script, (): boolean => settled).then(() => {
      finish(null)
    })
  })
}

function targetOf(
  decision: Extract<ListDecision, { kind: 'route' | 'stop' | 'reopen' | 'delete' }>,
  rows: readonly SessionRow[],
): SessionTargetAction {
  if (decision.kind === 'route') {
    const row = rows.find((candidate) => candidate.runId === decision.runId)
    return { kind: row === undefined ? 'resume' : routeOfRow(row), runId: decision.runId }
  }
  return { kind: decision.kind, runId: decision.runId }
}

async function runGuarded(script: ScriptKeys | undefined, action: () => Promise<string[] | null>): Promise<void> {
  try {
    const lines = await action()
    if (lines !== null) await runAckScreen({ lines, script })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await runAckScreen({ lines: [`! ${message}`], script })
  }
}

async function runIteration(deps: SessionPickerDeps, script: ScriptKeys | undefined, first: boolean): Promise<boolean> {
  const rows = await (deps.listRows?.() ?? listSessions(deps.workDir ?? '.'))
  const initialScreen =
    first && deps.initial === 'create' ? initialSessionScreenState('create') : initialSessionScreenState()
  const decision = await runListScreen({ rows, initial: initialScreen, script, mount: deps.mount ?? liveListMount })
  if (decision === null) return false
  if (decision.kind === 'submitCreate') {
    const taskText = decision.taskText
    await runGuarded(script, async (): Promise<null> => {
      await deps.createRun(taskText)
      return null
    })
    return true
  }
  if (decision.kind === 'refuseDelete') {
    await runGuarded(script, (): Promise<string[]> =>
      Promise.resolve([removeRunMessage({ kind: 'refused', runId: decision.runId, reason: 'running' })]),
    )
    return true
  }
  const target = targetOf(decision, rows)
  if (target.kind === 'report') {
    await runGuarded(script, async (): Promise<string[]> => {
      const body = await deps.buildReport(target.runId)
      return body.split('\n')
    })
    return true
  }
  if (target.kind === 'delete') {
    await runGuarded(script, async (): Promise<string[]> => {
      const result = await deps.removeRun(target.runId)
      return [removeRunMessage(result)]
    })
    return true
  }
  await runGuarded(script, async (): Promise<null> => {
    await deps.execute(target)
    return null
  })
  return true
}

/**
 * The loop: each iteration re-reads rows, settles one decision, and runs its
 * action guarded (failures become any-key notices); only a quit decision (or
 * an exhausted script) ends it. Chained via `.then` rather than `await` in a
 * loop body — sequential by nature, O(1) per pending link.
 */
export function runSessionPicker(deps: SessionPickerDeps): Promise<'quit'> {
  const script = deps.keyScript === undefined ? undefined : createScriptKeys(deps.keyScript)
  const iterate = (first: boolean): Promise<'quit'> =>
    runIteration(deps, script, first).then((more) => (more ? iterate(false) : 'quit'))
  return iterate(true)
}
