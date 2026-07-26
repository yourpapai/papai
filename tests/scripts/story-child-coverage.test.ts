// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { spawnStorySandboxedChild } from '../../scripts/story/child.js'
import { parseStoryRunnerArguments } from '../../scripts/story/cli.js'
import type { StoryManifest } from '../../scripts/story/manifest.js'
import type { StoryRunnerSession } from '../../scripts/story/session.js'

const FAKE_HASH = '0'.repeat(64)

function fakeManifest(): StoryManifest {
  return {
    version: 4,
    commit: '0000000',
    bunVersion: '1.0.0',
    seed: 0,
    treeHash: FAKE_HASH,
    files: [],
    runtimeInputs: { treeHash: FAKE_HASH, directories: [], files: [] },
    scenarios: [],
  }
}

function fakeSession(): StoryRunnerSession {
  return {
    root: '/s',
    appRoot: '/s/app',
    dependencyRoot: '/s/app/node_modules',
    tempRoot: '/s/tmp',
    manifest: fakeManifest(),
    childReporterArguments: [],
    childReportPaths: [],
    reportPaths: [],
    verifyIntegrity: () => Promise.resolve(),
    copyReports: () => Promise.resolve(),
    cleanup: () => Promise.resolve(),
  }
}

function captureCommand(parsedArgs: readonly string[]): readonly string[] {
  let captured: readonly string[] = []
  spawnStorySandboxedChild(
    parseStoryRunnerArguments(parsedArgs),
    {
      env: {},
      spawn: (command): { exited: Promise<number>; kill(): void } => {
        captured = command
        return { exited: Promise.resolve(0), kill: () => {} }
      },
      buildSandboxCommand: (request) => request.command,
      platform: 'linux',
      bunExecutable: '/s/app/bun',
    },
    ['tests/stories/a.story.test.ts'],
    fakeSession(),
  )
  return captured
}

describe('spawnStorySandboxedChild coverage flags', () => {
  it('omits coverage flags without --coverage', () => {
    const command = captureCommand([])
    expect(command).not.toContain('--coverage')
  })

  it('appends coverage flags with --coverage', () => {
    const command = captureCommand(['--coverage'])
    expect(command).toContain('--coverage')
    expect(command).toContain('--coverage-reporter=lcov')
    expect(command).toContain('--coverage-dir=/s/tmp/coverage')
  })
})
