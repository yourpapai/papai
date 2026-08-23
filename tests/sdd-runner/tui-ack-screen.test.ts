// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'

import { runAckScreen } from '../../sdd-runner/src/tui-ack-screen.js'
import type { AckMount } from '../../sdd-runner/src/tui-ack-screen.js'

const testingMount: AckMount = (element) => {
  const instance = render(element)
  return { unmount: (): void => instance.unmount(), lastFrame: (): string | undefined => instance.lastFrame() }
}

describe('runAckScreen', () => {
  it('shows the lines plus the return hint and resolves once any key arrives', async () => {
    const outcome = await runAckScreen({
      lines: ['## Report', 'body of report'],
      keyScript: 'x',
      mount: testingMount,
    })
    expect(outcome.frames[0]).toContain('## Report')
    expect(outcome.frames[0]).toContain('body of report')
    expect(outcome.frames[0]).toContain('(any key) back to sessions')
  })

  it('an exhausted script still resolves, so the loop can never hang on it', async () => {
    const outcome = await runAckScreen({ lines: ['! something failed'], keyScript: '', mount: testingMount })
    expect(outcome.frames[0]).toContain('something failed')
  })
})
