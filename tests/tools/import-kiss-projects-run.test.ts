// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { NervProjectDoc } from '../../tools/import-kiss-projects-mapping.js'
import type { KissProjectDoc } from '../../tools/import-kiss-projects-mapping.js'
import { runImport } from '../../tools/import-kiss-projects-run.js'
import type { RunImportPorts } from '../../tools/import-kiss-projects-run.js'

const OPTS = { gitlabBaseUrl: 'https://gitlab.corp.example', platformInstanceId: 'pi-1' }

function makeFakePorts(): RunImportPorts & { nervStore: Map<string, NervProjectDoc>; guardrailsSet: boolean } {
  const nervStore = new Map<string, NervProjectDoc>()
  let guardrailsSet = false
  return {
    nervStore,
    get guardrailsSet(): boolean {
      return guardrailsSet
    },
    nervFindByRepoPath: (projectPath) => Promise.resolve(nervStore.has(projectPath) ? {} : null),
    nervUpsert: (projectPath, doc) => {
      nervStore.set(projectPath, doc)
      return Promise.resolve()
    },
    guardrailsHas: () => guardrailsSet,
    guardrailsSetDefault: () => {
      guardrailsSet = true
    },
  } as RunImportPorts & { nervStore: Map<string, NervProjectDoc>; guardrailsSet: boolean }
}

const DEMO: KissProjectDoc = {
  _id: 'p1',
  title: 'Demo',
  repositories: [{ projectPath: 'team/demo', description: 'Demo repo' }],
}

describe('runImport', () => {
  test('dry-run makes no writes, reports would-create and would-set-default', async () => {
    const ports = makeFakePorts()
    const report = await runImport([DEMO], ports, { ...OPTS, apply: false })
    expect(ports.nervStore.size).toBe(0)
    expect(ports.guardrailsSet).toBe(false)
    expect(report.projects).toEqual([
      { label: 'Demo', primaryProjectPath: 'team/demo', warnings: [], action: 'would-create' },
    ])
    expect(report.guardrailsAction).toBe('would-set-default')
    expect(report.bindCommands).toEqual(['/nerv bind team/demo'])
  })

  test('apply creates a new project and sets default guardrails', async () => {
    const ports = makeFakePorts()
    const report = await runImport([DEMO], ports, { ...OPTS, apply: true })
    expect(ports.nervStore.has('team/demo')).toBe(true)
    expect(ports.guardrailsSet).toBe(true)
    expect(report.projects[0]?.action).toBe('created')
    expect(report.guardrailsAction).toBe('set-default')
  })

  test('a second apply run is idempotent: updates instead of creates, leaves existing guardrails', async () => {
    const ports = makeFakePorts()
    await runImport([DEMO], ports, { ...OPTS, apply: true })
    const second = await runImport([DEMO], ports, { ...OPTS, apply: true })
    expect(second.projects[0]?.action).toBe('updated')
    expect(second.guardrailsAction).toBe('left-existing')
    expect(ports.nervStore.size).toBe(1)
  })

  test('never overwrites existing guardrails on dry-run either', async () => {
    const ports = makeFakePorts()
    ports.guardrailsSetDefault(OPTS.platformInstanceId)
    const report = await runImport([DEMO], ports, { ...OPTS, apply: false })
    expect(report.guardrailsAction).toBe('no-op-dry-run-existing')
  })

  test('skips a project with zero repositories and emits no bind command', async () => {
    const ports = makeFakePorts()
    const noRepos: KissProjectDoc = { _id: 'p2', title: 'Empty' }
    const report = await runImport([noRepos], ports, { ...OPTS, apply: true })
    expect(report.projects).toEqual([
      { label: 'Empty', primaryProjectPath: '', warnings: [], action: 'skipped-no-repos' },
    ])
    expect(report.bindCommands).toEqual([])
    expect(ports.nervStore.size).toBe(0)
  })

  test('propagates mapping warnings into the per-project report', async () => {
    const ports = makeFakePorts()
    const withDroppedField: KissProjectDoc = { ...DEMO, proxy: 'http://proxy.internal' }
    const report = await runImport([withDroppedField], ports, { ...OPTS, apply: false })
    expect(report.projects[0]?.warnings).toEqual(['project "Demo": dropping kiss field "proxy" (no nerv target)'])
  })

  test('prints one bind command per imported project, in order', async () => {
    const ports = makeFakePorts()
    const second: KissProjectDoc = {
      _id: 'p2',
      title: 'Second',
      repositories: [{ projectPath: 'team/second', description: 'd' }],
    }
    const report = await runImport([DEMO, second], ports, { ...OPTS, apply: false })
    expect(report.bindCommands).toEqual(['/nerv bind team/demo', '/nerv bind team/second'])
  })
})
