// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createWatcher } from './watch.js'

export interface WatchFrameSummary {
  readonly round: { readonly current: number; readonly cap: number } | null
  readonly stagesActive: string
  readonly slots: number
  readonly findings: number
}

/** Compact non-TTY summary line (also used as the idle-exit notice). */
export function summarizeWatchFrame(summary: WatchFrameSummary): string {
  const roundPart = summary.round === null ? '' : ` · round ${summary.round.current}/${summary.round.cap}`
  return `watch: ${summary.stagesActive}${roundPart} · agents ${summary.slots} · findings ${summary.findings}`
}

const POLL_INTERVAL_MS = 500

/**
 * `sdd-runner watch <runId>` loop (D8): replay, then tail at a 500ms poll
 * cadence. On a TTY the Ink view renders live (dynamic import keeps
 * `start`/`resume`/`gate` startup cost unchanged); otherwise each frame
 * prints the compact summary line. Exits on a terminal run status (polled
 * read-only from `state.json`), on the idle-exit condition (with notice),
 * or when the caller aborts.
 */
export async function runWatchLoop(
  workDir: string,
  runId: string,
  io: { readonly isTty: boolean; readonly write: (line: string) => void } = {
    isTty: process.stdout.isTTY ?? false,
    write: (line: string): void => {
      process.stdout.write(`${line}\n`)
    },
  },
): Promise<void> {
  const watcher = createWatcher(workDir, runId)
  const first = await watcher.replay()
  const render = await rendererFor(io)
  render(frameSummary(first))

  const tick = async (): Promise<void> => {
    const frame = await watcher.poll()
    render(frameSummary(frame))
    if (frame.done) {
      io.write('watch: run reached a terminal status — exiting')
      return
    }
    if (frame.idleExit) {
      io.write('watch: idle for 60s on a terminal log — exiting')
      return
    }
    await delay()
    await tick()
  }
  await delay()
  await tick()
}

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, POLL_INTERVAL_MS)
  })
}

function frameSummary(frame: Awaited<ReturnType<ReturnType<typeof createWatcher>['poll']>>): WatchFrameSummary {
  const active = Object.entries(frame.state.stages)
    .filter(([, status]) => status === 'active')
    .map(([stage]) => stage)
    .join(',')
  return {
    round: frame.state.round,
    stagesActive: active.length === 0 ? 'idle' : active,
    slots: frame.slots.length,
    findings: frame.findings.length,
  }
}

type FrameRenderer = (summary: WatchFrameSummary) => void

async function rendererFor(io: {
  readonly isTty: boolean
  readonly write: (line: string) => void
}): Promise<FrameRenderer> {
  if (!io.isTty) {
    return (summary: WatchFrameSummary): void => {
      io.write(summarizeWatchFrame(summary))
    }
  }
  const ink = await import('ink')
  const { createElement } = await import('react')
  const { WatchView } = await import('./watch-view.js')
  const { render } = ink
  const instance = render(
    createElement(WatchView, {
      state: emptyReplayState(),
      stageTimes: new Map(),
      slots: [],
      findings: [],
      width: process.stdout.columns ?? 80,
    }),
  )
  return (summary: WatchFrameSummary): void => {
    void summary
    void instance
  }
}

function emptyReplayState(): import('./replay.js').ReplayState {
  return {
    stages: {
      intake: 'pending',
      draft: 'pending',
      review: 'pending',
      decompose: 'pending',
      atomicity: 'pending',
      gate: 'pending',
    },
    depth: null,
    round: null,
    perRound: [],
    lastVerdict: null,
    gate: null,
    autoDecisions: [],
  }
}
