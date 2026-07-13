// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from './types.js'

type CommandDecorator = (name: string, handler: CommandHandler) => CommandHandler

/** Wrap command registration to decorate handlers and reject ambiguous duplicate command routes. */
export function createObservedCommandProvider(chat: ChatProvider, decorate: CommandDecorator): ChatProvider {
  const registerCommand = chat.registerCommand.bind(chat)
  const registeredCommandNames = new Set<string>()
  return new Proxy(chat, {
    get(target, prop: keyof ChatProvider) {
      if (prop !== 'registerCommand') return target[prop]
      return (name: string, handler: CommandHandler): void => {
        if (registeredCommandNames.has(name)) throw new Error(`Duplicate command registration '${name}'`)
        registeredCommandNames.add(name)
        registerCommand(name, decorate(name, handler))
      }
    },
  })
}
