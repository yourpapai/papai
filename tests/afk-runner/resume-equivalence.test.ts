// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { SddEvent } from '../../afk-runner/src/events.js'
import { readEvents } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import { resumeRun } from '../../afk-runner/src/run-resume.js'
import { startRun } from '../../afk-runner/src/run.js'
import { TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

const MemoShapeSchema = z.object({
  status: z.string(),
  stage: z.string(),
  depth: z.string().nullable(),
  round: z.number(),
  roundCap: z.number(),
  gate: z.object({ mode: z.string(), version: z.number() }).nullable(),
})
type MemoShape = z.infer<typeof MemoShapeSchema>

function memoOf(statePath: string): MemoShape {
  return MemoShapeSchema.parse(JSON.parse(fs.readFileSync(statePath, 'utf8')))
}

function gateEvents(events: readonly SddEvent[], action: 'presented' | 'answered'): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === action)
}

function finalValueOf(logPath: string): string {
  const snapshot = foldEvents(pipelineMachine, readEvents(logPath)).snapshot
  return typeof snapshot.value === 'string' ? snapshot.value : Object.values(snapshot.value).join('.')
}

/** One deterministic poll tick: answer any pending gate file, then yield. */
async function answeringTick(runDir: () => string): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 1)
  })
  const logPath = path.join(runDir(), 'events.ndjson')
  if (!existsSync(logPath)) return
  const events = readEvents(logPath)
  const pending = gateEvents(events, 'presented').length > gateEvents(events, 'answered').length
  if (!pending) return
  const last = gateEvents(events, 'presented').at(-1)
  const version = last !== undefined && last.type === 'gate' ? last.version : 1
  const gateMd = path.join(runDir(), `gate-${version}.md`)
  if (existsSync(gateMd)) {
    const md = fs.readFileSync(gateMd, 'utf8')
    if (!md.includes('## Gate response')) {
      fs.writeFileSync(gateMd, `${md}\n## Gate response\n\n- [x] T1 acknowledged\n`)
    }
  }
}

/** A kill -9 leaves every scratch file on disk — only the log truncates. */
function copyScratchFiles(fromDir: string, toDir: string): void {
  for (const entry of fs.readdirSync(fromDir)) {
    if (entry === 'events.ndjson' || entry === 'state.json' || entry === 'holder.json') continue
    fs.cpSync(path.join(fromDir, entry), path.join(toDir, entry), { recursive: true })
  }
}

/** Resume with a bounded, self-answering foreground waiter. */
async function resumeToCompletion(deps: Parameters<typeof resumeRun>[0], runId: string, runDir: string): Promise<void> {
  const result = await resumeRun({ ...deps, gateWait: { tick: () => answeringTick(() => runDir) } }, runId)
  expect(result.halted).toBe('final')
}

/**
 * The kill -9 drill, dynamic half (C6 D10): a deterministic fake-agent run
 * completes uninterrupted; resuming a fresh copy from EVERY event prefix
 * reaches the same terminal state and the same memo.
 */
describe('resume equivalence — every prefix converges to the uninterrupted terminal (C6 D10)', () => {
  it("a fresh copy resumed from each of the run's event prefixes reaches the same final state and memo", async () => {
    const pipeline = makeFakePipeline()
    const uninterrupted = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const originalRunDir = pipeline.runDirOf(uninterrupted.runId)
    const events = readEvents(path.join(originalRunDir, 'events.ndjson'))
    expect(finalValueOf(path.join(originalRunDir, 'events.ndjson'))).toBe('completed')
    const expectedMemo = memoOf(path.join(originalRunDir, 'state.json'))
    expect(expectedMemo.status).toBe('completed')

    for (let cut = 0; cut <= events.length; cut += 1) {
      const workDir = fs.mkdtempSync(path.join(path.dirname(originalRunDir), 'resume-prefix-'))
      const runDir = path.join(workDir, 'runs', uninterrupted.runId)
      fs.mkdirSync(runDir, { recursive: true })
      copyScratchFiles(originalRunDir, runDir)
      const prefix = events.slice(0, cut)
      fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${prefix.map((e) => JSON.stringify(e)).join('\n')}\n`)
      const prefixDeps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

      await resumeToCompletion(prefixDeps, uninterrupted.runId, runDir)

      const logPath = path.join(runDir, 'events.ndjson')
      expect(finalValueOf(logPath)).toBe('completed')
      expect(memoOf(path.join(runDir, 'state.json'))).toEqual(expectedMemo)
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })
})
