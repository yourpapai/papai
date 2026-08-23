// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'

import { restoreStdinForPrompt } from '../../sdd-runner/src/session-create.js'
import type { TtyPromptStream } from '../../sdd-runner/src/session-create.js'
import { runSessionCreate } from '../../sdd-runner/src/session-create.js'

async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 5)
  })
}

async function waitFor(output: () => string, needle: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (!output().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`expected prompt to show: ${needle}`)
    await settle()
  }
}

interface Harness {
  readonly result: Promise<'started' | 'abandoned'>
  readonly startedWith: { readonly taskText: string }[]
  readonly lines: string[]
  readonly output: () => string
  readonly input: PassThrough
}

function drive(startImpl: ((taskText: string) => Promise<{ runId: string }>) | null): Harness {
  const input = new PassThrough()
  const chunks: string[] = []
  const outputWire = new PassThrough()
  outputWire.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString())
  })
  const startedWith: { taskText: string }[] = []
  const lines: string[] = []
  const result = runSessionCreate({
    start: (options): Promise<{ runId: string }> => {
      startedWith.push(options)
      const impl = startImpl ?? ((): Promise<{ runId: string }> => Promise.resolve({ runId: 'seeded-run-id' }))
      return impl(options.taskText)
    },
    stdout: (line) => {
      lines.push(line)
    },
    input,
    output: outputWire,
  })
  return { result, startedWith, lines, output: () => chunks.join(''), input }
}

describe('runSessionCreate', () => {
  it('turns title plus body into heading-led task text and starts the run', async () => {
    const harness = drive(null)
    await waitFor(harness.output, 'Session title:')
    harness.input.write('fix flaky auth test\n')
    await waitFor(harness.output, 'Task description')
    harness.input.write('the suite flakes under load\n')
    const outcome = await harness.result
    expect(outcome).toBe('started')
    expect(harness.startedWith[0]?.taskText).toBe('# fix flaky auth test\n\nthe suite flakes under load\n')
    expect(harness.lines).toContain('started seeded-run-id')
  })

  it('starts from the title alone when no body is given', async () => {
    const harness = drive(null)
    await waitFor(harness.output, 'Session title:')
    harness.input.write('solo title\n')
    await waitFor(harness.output, 'Task description')
    harness.input.write('\n')
    const outcome = await harness.result
    expect(outcome).toBe('started')
    expect(harness.startedWith[0]?.taskText).toBe('# solo title\n')
  })

  it('abandons without starting when the title is empty', async () => {
    const harness = drive(null)
    await waitFor(harness.output, 'Session title:')
    harness.input.write('\n')
    const outcome = await harness.result
    expect(outcome).toBe('abandoned')
    expect(harness.startedWith).toEqual([])
    expect(harness.lines.join('\n')).toMatch(/abandoned/u)
  })

  it('propagates start failures after closing the prompt', async () => {
    const harness = drive(() => Promise.reject(new Error('session id taken')))
    await waitFor(harness.output, 'Session title:')
    harness.input.write('taken-name\n')
    await waitFor(harness.output, 'Task description')
    harness.input.write('\n')
    await expect(harness.result).rejects.toThrow('session id taken')
  })
})

interface RestoreCalls {
  readonly rawModeOff: number
  readonly refs: number
  readonly resumes: number
}

function fakeStream(overrides: { readonly isTTY?: boolean; readonly isRaw?: boolean }): {
  readonly stream: TtyPromptStream
  readonly calls: RestoreCalls
} {
  const calls = { rawModeOff: 0, refs: 0, resumes: 0 }
  const stream = {
    isTTY: overrides.isTTY,
    isRaw: overrides.isRaw,
    setRawMode(mode: boolean): void {
      if (!mode) calls.rawModeOff += 1
    },
    ref(): void {
      calls.refs += 1
    },
    resume(): void {
      calls.resumes += 1
    },
  } as TtyPromptStream
  return { stream, calls }
}

describe('restoreStdinForPrompt (live-terminal seam)', () => {
  it('clears raw mode and re-refs a raw tty stdin for the readline prompt', () => {
    const { stream, calls } = fakeStream({ isTTY: true, isRaw: true })
    restoreStdinForPrompt(stream)
    expect(calls).toEqual({ rawModeOff: 1, refs: 1, resumes: 1 })
  })

  it('skips setRawMode when the tty is already cooked but still refs and resumes', () => {
    const { stream, calls } = fakeStream({ isTTY: true, isRaw: false })
    restoreStdinForPrompt(stream)
    expect(calls).toEqual({ rawModeOff: 0, refs: 1, resumes: 1 })
  })

  it('leaves non-tty streams untouched', () => {
    const { stream, calls } = fakeStream({ isTTY: false })
    restoreStdinForPrompt(stream)
    expect(calls).toEqual({ rawModeOff: 0, refs: 0, resumes: 0 })
  })
})

describe('runSessionCreate stdin seam guard', () => {
  it('never touches an injected stream, even a tty-shaped one', async () => {
    const injected = new PassThrough()
    let refCount = 0
    Object.assign(injected, {
      isTTY: true,
      ref: (): void => {
        refCount += 1
      },
    })
    const outputWire = new PassThrough()
    const chunks: string[] = []
    outputWire.on('data', (chunk: Buffer) => {
      chunks.push(chunk.toString())
    })
    const result = runSessionCreate({
      start: () => Promise.resolve({ runId: 'seeded-run-id' }),
      stdout: () => {},
      input: injected,
      output: outputWire,
    })
    await waitFor(() => chunks.join(''), 'Session title:')
    injected.write('\n')
    await result
    expect(refCount).toBe(0)
  })
})
