// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'
import { execFile, execFileSync } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  constants,
  copyFileSync,
  createWriteStream,
  openSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFile as writeFileCallback,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
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

scenario('rejects Bun.write outside root', async ({ world }) => {
  phase(world)
  await Bun.write(`${world.tempRoot}/../bun.txt`, 'no')
})

scenario('rejects Bun.write symlink escape', async ({ world }) => {
  phase(world)
  symlinkSync(`${world.tempRoot}/..`, `${world.tempRoot}/bun-escape`)
  await Bun.write(Bun.file(`${world.tempRoot}/bun-escape/bun.txt`), 'no')
})

scenario('rejects Bun.write unsupported target', ({ world }) => {
  phase(world)
  Reflect.apply(Bun.write, Bun, [123, 'no'])
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

scenario('rejects fs createWriteStream outside root', ({ world }) => {
  phase(world)
  createWriteStream(`${world.tempRoot}/../escape.txt`)
})

scenario('rejects write-capable fs open outside root', async ({ world }) => {
  phase(world)
  await open(`${world.tempRoot}/../escape.txt`, 'w')
})

scenario('rejects numeric write-capable fs open outside root', ({ world }) => {
  phase(world)
  openSync(`${world.tempRoot}/../escape.txt`, constants.O_WRONLY | constants.O_CREAT)
})

scenario('rejects raw fd write without write-capable open', ({ world }) => {
  phase(world)
  const path = `${world.tempRoot}/read-only.txt`
  writeFileSync(path, 'read only')
  const fd = openSync(path, 'r')
  try {
    writeSync(fd, 'no')
  } finally {
    closeSync(fd)
  }
})

scenario('rejects fs truncate outside root', ({ world }) => {
  phase(world)
  truncateSync(`${world.tempRoot}/../escape.txt`, 0)
})

scenario('rejects fs copy outside root', ({ world }) => {
  phase(world)
  const source = `${world.tempRoot}/source.txt`
  writeFileSync(source, 'source')
  copyFileSync(source, `${world.tempRoot}/../escape.txt`)
})

scenario('rejects fs removal outside root', ({ world }) => {
  phase(world)
  rmSync(`${world.tempRoot}/../escape.txt`, { force: true })
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

scenario('rejects process listener leak', ({ world }) => {
  phase(world)
  process.on('papai-story-probe', () => undefined)
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

scenario('allows Bun.write inside root', async ({ world }) => {
  phase(world)
  const path = `${world.tempRoot}/bun-inside.txt`
  await Bun.write(Bun.file(path), 'ok')
  expect(await Bun.file(path).text()).toBe('ok')
})

scenario('allows FileHandle write inside root', async ({ world }) => {
  phase(world)
  const path = `${world.tempRoot}/handle-inside.txt`
  const handle = await open(path, 'w')
  try {
    await handle.writeFile('ok')
  } finally {
    await handle.close()
  }
  expect(await Bun.file(path).text()).toBe('ok')
})

scenario('allows Bun.write URL inside root', async ({ world }) => {
  phase(world)
  const path = `${world.tempRoot}/bun-url-inside.txt`
  await Bun.write(new URL(`file://${path}`), 'ok')
  expect(await Bun.file(path).text()).toBe('ok')
})

scenario('allows tracked raw fd write inside root', async ({ world }) => {
  phase(world)
  const path = `${world.tempRoot}/raw-fd-inside.txt`
  const fd = openSync(path, 'w')
  try {
    writeSync(fd, 'ok')
  } finally {
    closeSync(fd)
  }
  expect(await Bun.file(path).text()).toBe('ok')
})

scenario('allows removed process listener', ({ world }) => {
  phase(world)
  const listener = (): void => undefined
  process.on('papai-story-probe-removed', listener)
  process.off('papai-story-probe-removed', listener)
})

scenario('allows fired process once listener', ({ world }) => {
  phase(world)
  let calls = 0
  process.once('papai-story-probe-once', () => {
    calls += 1
  })
  process.emit('papai-story-probe-once')
  expect(calls).toBe(1)
})

scenario('uses sanitized environment', () => {
  expect(process.env['PAPAI_STORY_RUNNER']).toBe('1')
  expect(process.env['PAPAI_IO_SENTINEL']).toBeUndefined()
  expect(process.env['PAPAI_DOTENV_SENTINEL']).toBeUndefined()
  expect(process.env['TZ']).toBe('UTC')
})
