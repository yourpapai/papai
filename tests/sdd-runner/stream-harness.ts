// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Socket } from 'node:net'

import { Box, render, Static, Text } from 'ink'
import { createElement } from 'react'
import type { ReactElement } from 'react'

/**
 * Stream-observability harness (fancy-ui 1.1): live Ink `render` over an
 * injectable fake stdout, the `AckMount` seam pattern. ink-testing-library
 * exposes debug frames (which repeat `Static` output every frame), the live
 * ink instance does not — counting writes on the stream is the only way to
 * prove once-only emission. `columns`/`rows` are mutable and `resizeTo`
 * emits `resize`, so the same seam drives scripted width changes. Both
 * fakes are real `net.Socket`s carrying the tty member set, so they satisfy
 * ink's `NodeJS.WriteStream`/`NodeJS.ReadStream` options structurally.
 */

export class FakeStdout extends Socket implements NodeJS.WriteStream {
  public columns = 100
  public rows = 24
  public readonly isTTY = true
  public readonly writes: string[] = []
  public override write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ): boolean {
    this.writes.push(String(chunk))
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    if (done !== undefined) queueMicrotask(() => done(null))
    return true
  }
  public cursorTo(): boolean {
    return true
  }
  public moveCursor(): boolean {
    return true
  }
  public clearLine(): boolean {
    return true
  }
  public clearScreenDown(): boolean {
    return true
  }
  public getColorDepth(): number {
    return 8
  }
  public hasColors(): boolean {
    return true
  }
  public getWindowSize(): [number, number] {
    return [this.columns, this.rows]
  }
  public resizeTo(columns: number, rows: number): void {
    this.columns = columns
    this.rows = rows
    this.emit('resize')
  }
}

export function createFakeStdin(): NodeJS.ReadStream {
  const stdin: NodeJS.ReadStream = Object.assign(new Socket(), {
    isTTY: true,
    isRaw: false,
    setRawMode(): NodeJS.ReadStream {
      return stdin
    },
  })
  return stdin
}

export interface StreamMount {
  readonly rerender: (element: ReactElement) => void
  readonly unmount: () => void
  readonly waitUntilRenderFlush: () => Promise<void>
  readonly stdout: FakeStdout
  readonly streamText: () => string
}

export function mountToStream(element: ReactElement, stdout: FakeStdout = new FakeStdout()): StreamMount {
  const instance = render(element, {
    stdout,
    stdin: createFakeStdin(),
    stderr: new FakeStdout(),
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
    maxFps: 200,
  })
  return {
    rerender: (next: ReactElement): void => {
      instance.rerender(next)
    },
    unmount: (): void => {
      instance.unmount()
      instance.cleanup()
    },
    waitUntilRenderFlush: (): Promise<void> => instance.waitUntilRenderFlush(),
    stdout,
    streamText: (): string => stdout.writes.join(''),
  }
}

/** Poll until the condition holds; fails after the deadline instead of hanging. */
export async function waitFor(predicate: () => boolean, deadlineMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > deadlineMs) throw new Error('stream-observability condition not met before deadline')
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
  }
}

/** Non-overlapping substring count over the raw write stream. */
export function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Toy factory mirroring the screen factories (`createRunView` et al). */
export function toyStaticScreen(): (props: { readonly items: readonly string[] }) => ReactElement {
  return function ToyScreen(props: { readonly items: readonly string[] }): ReactElement {
    return createElement(
      Box,
      { flexDirection: 'column' },
      createElement(Static, {
        items: [...props.items],
        children: (item: unknown): ReactElement => createElement(Text, { key: String(item) }, String(item)),
      }),
      createElement(Text, null, `live count ${String(props.items.length)}`),
    )
  }
}
