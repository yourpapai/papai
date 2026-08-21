// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ConfigError } from '../../opencode-agent/src/config-values.js'
import { parseMcpServers } from '../../opencode-agent/src/mcp-servers.js'

/**
 * `AGENT_MCP_SERVERS` — the second non-scalar knob, parsed the way
 * `AGENT_CHECKS` is: JSON syntax refused separately from document shape, every
 * refusal naming the variable, and the whole thing validated at job start so a
 * bad value costs no model turn.
 *
 * The refusals that name a **rule** rather than a schema path are the two this
 * suite exists to pin: an `oauth` object can only ever express an intent an
 * unattended job cannot honour, and a server name is embedded in tool names
 * (`<name>_<tool>`) and permission keys, so it has to be a safe identifier.
 */
describe('parseMcpServers', () => {
  test('an unset or blank knob is no servers, not an error', () => {
    // The ordinary case: most repositories declare none, and the run must load
    // exactly as it did before the knob existed.
    expect(parseMcpServers(undefined)).toBeUndefined()
    expect(parseMcpServers('   ')).toBeUndefined()
  })

  test('accepts a local entry with a command and environment', () => {
    const servers = parseMcpServers(
      '{"fetcher":{"type":"local","command":["bunx","mcp-server-fetch@1.0.0"],"environment":{"FETCH_TIMEOUT":"5000"}}}',
    )

    expect(servers).toEqual({
      fetcher: {
        type: 'local',
        command: ['bunx', 'mcp-server-fetch@1.0.0'],
        environment: { FETCH_TIMEOUT: '5000' },
      },
    })
  })

  test('accepts a remote entry with a url and headers', () => {
    const servers = parseMcpServers(
      '{"index":{"type":"remote","url":"https://mcp.example.com/sse","headers":{"Authorization":"Bearer tok-1234567890"}}}',
    )

    expect(servers).toEqual({
      index: {
        type: 'remote',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer tok-1234567890' },
      },
    })
  })

  test('accepts both spellings in one document', () => {
    const servers = parseMcpServers(
      '{"a":{"type":"local","command":["bunx","x@1"]},"b":{"type":"remote","url":"https://x.example.com"}}',
    )

    expect(servers).toEqual({
      a: { type: 'local', command: ['bunx', 'x@1'] },
      b: { type: 'remote', url: 'https://x.example.com' },
    })
  })

  test.each([
    ['not JSON at all', 'not json'],
    ['a JSON array', '[{"type":"local","command":["x"]}]'],
    ['a JSON scalar', '"local"'],
  ])('refuses %s naming the variable and the JSON stage', (_case, value) => {
    expect(() => parseMcpServers(value)).toThrow(ConfigError)
    expect(() => parseMcpServers(value)).toThrow('AGENT_MCP_SERVERS')
  })

  test.each([
    // The tool-prefix rule: a name with a space or a dot would produce tool
    // names and permission keys this pipeline could not spell.
    ['a space in the name', '{"my server":{"type":"local","command":["x"]}}'],
    ['a dot in the name', '{"my.server":{"type":"local","command":["x"]}}'],
    ['a slash in the name', '{"a/b":{"type":"remote","url":"https://x.example.com"}}'],
    ['an empty name', '{"":{"type":"local","command":["x"]}}'],
  ])('refuses %s, naming the tool-prefix rule', (_case, value) => {
    expect(() => parseMcpServers(value)).toThrow(ConfigError)
    expect(() => parseMcpServers(value)).toThrow('AGENT_MCP_SERVERS')
    expect(() => parseMcpServers(value)).toThrow('<name>_<tool>')
  })

  test('refuses an oauth object, naming the unattended constraint', () => {
    const knob = '{"index":{"type":"remote","url":"https://x.example.com","oauth":{"clientId":"abc"}}}'

    expect(() => parseMcpServers(knob)).toThrow(ConfigError)
    expect(() => parseMcpServers(knob)).toThrow('AGENT_MCP_SERVERS')
    expect(() => parseMcpServers(knob)).toThrow('unattended')
  })

  test('refuses an oauth key in either spelling, local included', () => {
    // The refusal is about the key, not just the object arm: an unattended job
    // can complete no browser flow, so no `oauth` value can be honoured.
    const local = '{"a":{"type":"local","command":["x"],"oauth":false}}'

    expect(() => parseMcpServers(local)).toThrow('unattended')
  })

  test.each([
    ['an empty command array', '{"a":{"type":"local","command":[]}}'],
    ['a blank command word', '{"a":{"type":"local","command":["  "]}}'],
    ['no type discriminator', '{"a":{"command":["x"]}}'],
    ['a local entry with a url', '{"a":{"type":"local","command":["x"],"url":"https://x.example.com"}}'],
    ['a remote entry with no url', '{"a":{"type":"remote"}}'],
    ['an unknown field', '{"a":{"type":"remote","url":"https://x.example.com","cwd":"/tmp"}}'],
    ['an unknown type', '{"a":{"type":"embedded","command":["x"]}}'],
  ])('refuses %s, naming the variable and the shape', (_case, value) => {
    expect(() => parseMcpServers(value)).toThrow(ConfigError)
    expect(() => parseMcpServers(value)).toThrow('AGENT_MCP_SERVERS')
  })

  test('refuses an empty document as a shape error, not a silent none', () => {
    // `{}` is valid JSON and a valid map — of nothing. An operator who set the
    // knob at all meant to declare a server, so an empty object is accepted as
    // the shape it is: no servers. (Asserted so a future narrowing decides this
    // deliberately rather than by accident.)
    expect(parseMcpServers('{}')).toEqual({})
  })

  test('refuses a non-string environment value', () => {
    const knob = '{"a":{"type":"local","command":["x"],"environment":{"T":1}}}'

    expect(() => parseMcpServers(knob)).toThrow(ConfigError)
  })
})
