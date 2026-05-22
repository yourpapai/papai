// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function resolveInvocationText(
  prefix: string | null,
  availableCommands: readonly string[],
  body: string,
  required: boolean,
): string {
  if (prefix === null) {
    return body
  }

  if (!prefix.startsWith('/')) {
    return `${prefix}\n\n${body}`
  }

  const commandName = prefix.slice(1).split(/\s+/u, 1)[0] ?? ''
  if (availableCommands.length === 0) {
    if (required) {
      throw new Error(`Required command /${commandName} is not advertised by the agent`)
    }
    return body
  }

  if (availableCommands.includes(commandName)) {
    return `${prefix} ${body}`.trim()
  }

  if (required) {
    throw new Error(`Required command /${commandName} is not advertised by the agent`)
  }

  return body
}
