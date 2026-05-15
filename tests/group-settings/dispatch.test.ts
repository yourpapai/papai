// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ReplyFn } from '../../src/chat/types.js'
import type { DispatchGroupSelectorDeps } from '../../src/group-settings/dispatch.js'
import { dispatchGroupSelectorResult } from '../../src/group-settings/dispatch.js'
import type { GroupSettingsSelectorResult } from '../../src/group-settings/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeReply = (): ReplyFn => ({
  text: mock(() => Promise.resolve()),
  formatted: mock(() => Promise.resolve()),
  file: mock(() => Promise.resolve()),
  typing: mock((): void => {}),
  redactMessage: mock(() => Promise.resolve()),
  buttons: mock(() => Promise.resolve()),
})

const makeDeps = (): DispatchGroupSelectorDeps => ({
  renderConfigForTarget: mock(() => Promise.resolve()),
  startSetupForTarget: mock(() => Promise.resolve()),
})

describe('dispatchGroupSelectorResult', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns false for an unhandled result', async () => {
    const result: GroupSettingsSelectorResult = { handled: false }
    const handled = await dispatchGroupSelectorResult(result, makeReply(), 'user-1')
    expect(handled).toBe(false)
  })

  test('calls renderConfigForTarget for continueWith config command and returns true', async () => {
    const result: GroupSettingsSelectorResult = {
      handled: true,
      continueWith: { command: 'config', targetContextId: 'ctx-1' },
    }
    const reply = makeReply()
    const deps = makeDeps()
    const handled = await dispatchGroupSelectorResult(result, reply, 'user-1', true, deps)
    expect(handled).toBe(true)
    expect(deps.renderConfigForTarget).toHaveBeenCalledWith(reply, 'ctx-1', true)
    expect(deps.startSetupForTarget).not.toHaveBeenCalled()
  })

  test('forwards interactiveButtons flag to renderConfigForTarget', async () => {
    const result: GroupSettingsSelectorResult = {
      handled: true,
      continueWith: { command: 'config', targetContextId: 'ctx-1' },
    }
    const reply = makeReply()
    const deps = makeDeps()
    await dispatchGroupSelectorResult(result, reply, 'user-1', false, deps)
    expect(deps.renderConfigForTarget).toHaveBeenCalledWith(reply, 'ctx-1', false)
  })

  test('calls startSetupForTarget for continueWith setup command and returns true', async () => {
    const result: GroupSettingsSelectorResult = {
      handled: true,
      continueWith: { command: 'setup', targetContextId: 'ctx-2' },
    }
    const reply = makeReply()
    const deps = makeDeps()
    const handled = await dispatchGroupSelectorResult(result, reply, 'user-1', true, deps)
    expect(handled).toBe(true)
    expect(deps.startSetupForTarget).toHaveBeenCalledWith('user-1', reply, 'ctx-2')
    expect(deps.renderConfigForTarget).not.toHaveBeenCalled()
  })

  test('calls reply.buttons for a result with buttons and returns true', async () => {
    const buttons = [{ text: 'Option A', callbackData: 'opt:a' }]
    const result: GroupSettingsSelectorResult = {
      handled: true,
      response: 'Choose:',
      buttons,
    }
    const reply = makeReply()
    const handled = await dispatchGroupSelectorResult(result, reply, 'user-1')
    expect(handled).toBe(true)
    expect(reply.buttons).toHaveBeenCalledWith('Choose:', { buttons })
    expect(reply.text).not.toHaveBeenCalled()
  })

  test('calls reply.replaceButtons when available for a result with buttons', async () => {
    const buttons = [{ text: 'Option A', callbackData: 'opt:a' }]
    const replaceButtons = mock(() => Promise.resolve())
    const result: GroupSettingsSelectorResult = {
      handled: true,
      response: 'Choose:',
      buttons,
    }
    const reply = {
      ...makeReply(),
      replaceButtons,
    } as ReplyFn & {
      replaceButtons: typeof replaceButtons
    }

    const handled = await dispatchGroupSelectorResult(result, reply, 'user-1')

    expect(handled).toBe(true)
    expect(replaceButtons).toHaveBeenCalledWith('Choose:', { buttons })
    expect(reply.buttons).not.toHaveBeenCalled()
    expect(reply.text).not.toHaveBeenCalled()
  })

  test('calls reply.text for a plain response result and returns true', async () => {
    const result: GroupSettingsSelectorResult = {
      handled: true,
      response: 'Done.',
    }
    const reply = makeReply()
    const handled = await dispatchGroupSelectorResult(result, reply, 'user-1')
    expect(handled).toBe(true)
    expect(reply.text).toHaveBeenCalledWith('Done.')
    expect(reply.buttons).not.toHaveBeenCalled()
  })

  test('calls reply.replaceText when available for a plain response result', async () => {
    const replaceText = mock(() => Promise.resolve())
    const result: GroupSettingsSelectorResult = {
      handled: true,
      response: 'Done.',
    }
    const reply = {
      ...makeReply(),
      replaceText,
    } as ReplyFn & {
      replaceText: typeof replaceText
    }

    const handled = await dispatchGroupSelectorResult(result, reply, 'user-1')

    expect(handled).toBe(true)
    expect(replaceText).toHaveBeenCalledWith('Done.')
    expect(reply.text).not.toHaveBeenCalled()
    expect(reply.buttons).not.toHaveBeenCalled()
  })
})
