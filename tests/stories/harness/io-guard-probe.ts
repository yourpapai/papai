// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'
import { execFile, execFileSync } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { symlinkSync, writeFile as writeFileCallback, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { connect, createServer, Socket } from 'node:net'

import { scenario } from './scenario.js'

const phase = (world: { events: { setPhase(value: string): void } }): void => world.events.setPhase('when.ioProbe')

scenario('rejects undeclared fetch', async ({ world }) => {
  phase(world)
  await fetch('https://undeclared.invalid/')
})

scenario('rejects Bun.spawn', ({ world }) => {
  phase(world)
  Bun.spawn(['true'])
})

scenario('rejects Bun.spawnSync', ({ world }) => {
  phase(world)
  Bun.spawnSync(['true'])
})

scenario('rejects child_process execFile', ({ world }) => {
  phase(world)
  execFile('true')
})

scenario('rejects child_process execFileSync', ({ world }) => {
  phase(world)
  execFileSync('true')
})

scenario('rejects child_process spawn', ({ world }) => {
  phase(world)
  spawn('true')
})

scenario('rejects child_process spawnSync', ({ world }) => {
  phase(world)
  spawnSync('true')
})

scenario('rejects socket connect', ({ world }) => {
  phase(world)
  connect(9)
})

scenario('rejects socket instance connect', ({ world }) => {
  phase(world)
  new Socket().connect(9)
})

scenario('rejects server listen', ({ world }) => {
  phase(world)
  createServer().listen(0)
})

scenario('rejects Bun.serve', ({ world }) => {
  phase(world)
  Bun.serve({ port: 0, fetch: () => new Response('no') })
})

scenario('rejects Bun.write', async ({ world }) => {
  phase(world)
  await Bun.write(`${world.tempRoot}/bun.txt`, 'no')
})

scenario('rejects fs write outside root', ({ world }) => {
  phase(world)
  writeFileSync(`${world.tempRoot}/../escape.txt`, 'no')
})

scenario('rejects fs promises write outside root', async ({ world }) => {
  phase(world)
  await writeFile(`${world.tempRoot}/../escape.txt`, 'no')
})

scenario('rejects fs callback write outside root', ({ world }) => {
  phase(world)
  writeFileCallback(`${world.tempRoot}/../escape.txt`, 'no', () => undefined)
})

scenario('rejects symlink escape', ({ world }) => {
  phase(world)
  symlinkSync(world.tempRoot, `${world.tempRoot}/link`)
  symlinkSync(`${world.tempRoot}/..`, `${world.tempRoot}/escape-link`)
  writeFileSync(`${world.tempRoot}/escape-link/escaped.txt`, 'no')
})

scenario('rejects timer leak', ({ world }) => {
  phase(world)
  setInterval(() => undefined, 60_000).unref()
})

scenario('rejects environment mutation', ({ world }) => {
  phase(world)
  process.env['PAPAI_MUTATED'] = 'yes'
})

scenario('allows declared fetch', async ({ world }) => {
  phase(world)
  world.http.expect({ method: 'GET', url: 'https://declared.invalid/' }, () => new Response('ok'))
  const response = await fetch('https://declared.invalid/')
  expect(await response.text()).toBe('ok')
})

scenario('allows write inside root', async ({ world }) => {
  phase(world)
  writeFileSync(`${world.tempRoot}/inside.txt`, 'ok')
  expect(await Bun.file(`${world.tempRoot}/inside.txt`).text()).toBe('ok')
})

scenario('uses sanitized environment', () => {
  expect(process.env['PAPAI_STORY_RUNNER']).toBe('1')
  expect(process.env['PAPAI_IO_SENTINEL']).toBeUndefined()
  expect(process.env['PAPAI_DOTENV_SENTINEL']).toBeUndefined()
  expect(process.env['TZ']).toBe('UTC')
})
