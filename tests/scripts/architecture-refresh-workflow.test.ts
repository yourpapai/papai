// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const getSection = (workflow: string, startPattern: RegExp, endPattern?: RegExp): string | null => {
  const startMatch = workflow.match(startPattern)

  if (!startMatch || startMatch.index === undefined) {
    return null
  }

  const startIndex = startMatch.index
  const endMatch = endPattern ? workflow.slice(startIndex + 1).match(endPattern) : null
  const endIndex = endMatch && endMatch.index !== undefined ? startIndex + 1 + endMatch.index : workflow.length

  return workflow.slice(startIndex, endIndex)
}

const expectSectionToContainLines = (section: string | null, expectedLines: string[]): void => {
  expect(section).not.toBeNull()

  for (const expectedLine of expectedLines) {
    expect(section).toContain(expectedLine)
  }
}

describe('architecture refresh workflow', () => {
  test('targets master pushes with runtime/config path filters and creates a dedicated PR', async () => {
    const workflow = await readFile('.github/workflows/architecture-refresh.yml', 'utf8')
    const triggerSection = getSection(workflow, /^on:\n/mu, /^permissions:\n/mu)
    const permissionsSection = getSection(workflow, /^permissions:\n/mu, /^concurrency:\n/mu)
    const concurrencySection = getSection(workflow, /^concurrency:\n/mu, /^jobs:\n/mu)
    const checkoutStep = getSection(
      workflow,
      /^\s+- uses: actions\/checkout@v4\n/mu,
      /^\s+- uses: oven-sh\/setup-bun@v2\n/mu,
    )
    const createPullRequestStep = getSection(workflow, /^\s+- name: Create or update architecture refresh PR\n/mu)
    const installGraphvizStep = getSection(
      workflow,
      /^\s+- name: Install GraphViz\n/mu,
      /^\s+- name: Install dependencies\n/mu,
    )
    const generateArtifactsStep = getSection(
      workflow,
      /^\s+- name: Generate architecture artifacts\n/mu,
      /^\s+- name: Create or update architecture refresh PR\n/mu,
    )

    expectSectionToContainLines(triggerSection, [
      'push:',
      'branches: [master]',
      "- 'src/**'",
      "- 'client/admin/**'",
      "- 'client/debug/**'",
      "- 'client/settings/**'",
      "- 'client/shared/**'",
      "- 'client/assets/**'",
      "- '!client/**/*.stories.*'",
      "- '!client/stories/**'",
      "- 'package.json'",
      "- 'bun.lock'",
      "- '.dependency-cruiser.mjs'",
      "- 'scripts/architecture-refresh-dependency-cruiser-config.mjs'",
      "- 'scripts/architecture-refresh*.ts'",
      "- 'tsconfig.json'",
      "- '.github/workflows/architecture-refresh.yml'",
    ])
    expectSectionToContainLines(permissionsSection, ['contents: write', 'pull-requests: write'])
    expectSectionToContainLines(concurrencySection, [
      'group: architecture-refresh-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress: true',
    ])
    expect(concurrencySection).not.toContain('github.sha')
    expectSectionToContainLines(checkoutStep, ['- uses: actions/checkout@v4'])
    expect(checkoutStep).not.toContain('ref:')
    expectSectionToContainLines(installGraphvizStep, ['graphviz'])
    expectSectionToContainLines(generateArtifactsStep, ['bun run architecture:refresh'])
    expectSectionToContainLines(createPullRequestStep, [
      'peter-evans/create-pull-request@v8',
      'branch: automation/architecture-refresh',
      'base: master',
      "commit-message: 'docs: refresh architecture artifacts'",
      "title: 'docs: refresh architecture artifacts'",
      'add-paths: |',
      'docs/architecture/**',
      'delete-branch: false',
    ])
  })

  test('installs graphviz in the normal CI check job before bun check:full', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const checkJob = getSection(workflow, /^\s{2}check:\n/mu, /^\s{2}e2e:\n/mu)
    const installGraphvizStep = getSection(
      workflow,
      /^\s+- name: Install GraphViz\n/mu,
      /^\s+- name: Download build output\n/mu,
    )

    expectSectionToContainLines(checkJob, ['name: Checks', 'run: bun check:full'])
    expectSectionToContainLines(installGraphvizStep, ['graphviz'])
  })
})
