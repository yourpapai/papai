// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test } from 'bun:test'
import { createReadStream } from 'node:fs'
import { cp, rm, symlink, writeFile } from 'node:fs/promises'

const outside = '/session/outside'
const temporary = '/session/tmp'

function readStream(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(target)
    stream.once('error', reject)
    stream.once('end', resolve)
    stream.resume()
  })
}

test('file-import', async () => {
  await import(`file://${outside}/external-module.ts`)
})

test('bun-stat', async () => {
  await Bun.file(`${outside}/external.txt`).stat()
})

test('bun-glob', async () => {
  for await (const _ of new Bun.Glob('*').scan({ cwd: outside })) {
    throw new Error('UNSAFE: sandbox glob exposed an undeclared host path')
  }
  throw new Error('Sandbox glob denied the undeclared host path')
})

test('network', async () => {
  await fetch('http://192.0.2.1:65535/', { signal: AbortSignal.timeout(1_000) })
})

test('stream-race', async () => {
  const victim = `${temporary}/stream-race.txt`
  await Bun.write(victim, 'safe')
  await rm(victim)
  await symlink(`${outside}/external.txt`, victim)
  await readStream(victim)
})

test('cp-dereference', async () => {
  const source = `${temporary}/copy-link`
  await symlink(`${outside}/external.txt`, source)
  await cp(source, `${temporary}/copy-result.txt`, { dereference: true })
})

test('write', async () => {
  await writeFile('/session/app/blocked.txt', 'blocked')
})
