// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const getSection = (workflow: string, startPattern: RegExp, endPattern: RegExp): string | null => {
  const startMatch = workflow.match(startPattern)
  const endMatch = workflow.match(endPattern)

  if (!startMatch || startMatch.index === undefined) {
    return null
  }

  const startIndex = startMatch.index
  const endIndex =
    endMatch && endMatch.index !== undefined && endMatch.index > startIndex ? endMatch.index : workflow.length

  return workflow.slice(startIndex, endIndex)
}

describe('architecture refresh workflow', () => {
  test('targets master pushes with runtime/config path filters and creates a dedicated PR', async () => {
    const workflow = await readFile('.github/workflows/architecture-refresh.yml', 'utf8')
    const concurrencySection = getSection(workflow, /^concurrency:\n/mu, /^jobs:\n/mu)
    const checkoutStep = getSection(
      workflow,
      /^\s+- uses: actions\/checkout@v4\n/mu,
      /^\s+- uses: oven-sh\/setup-bun@v2\n/mu,
    )

    expect(workflow).toContain('branches: [master]')
    expect(workflow).toContain("- 'src/**'")
    expect(workflow).toContain("- 'client/**'")
    expect(workflow).toContain("- 'package.json'")
    expect(workflow).toContain("- 'bun.lock'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('pull-requests: write')
    expect(concurrencySection).not.toBeNull()
    expect(concurrencySection).toContain('group: architecture-refresh-${{ github.workflow }}-${{ github.ref }}')
    expect(concurrencySection).not.toContain('github.sha')
    expect(checkoutStep).not.toBeNull()
    expect(checkoutStep).toContain('- uses: actions/checkout@v4')
    expect(checkoutStep).not.toContain('ref:')
    expect(workflow).toContain('graphviz')
    expect(workflow).toContain('bun run architecture:refresh')
    expect(workflow).toContain('peter-evans/create-pull-request@v8')
    expect(workflow).toContain('automation/architecture-refresh')
    expect(workflow).toContain('docs/architecture/**')
  })
})
