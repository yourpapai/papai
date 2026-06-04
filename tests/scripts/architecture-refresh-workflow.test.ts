// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

describe('architecture refresh workflow', () => {
  test('targets master pushes with runtime/config path filters and creates a dedicated PR', async () => {
    const workflow = await readFile('.github/workflows/architecture-refresh.yml', 'utf8')

    expect(workflow).toContain('branches: [master]')
    expect(workflow).toContain("- 'src/**'")
    expect(workflow).toContain("- 'client/**'")
    expect(workflow).toContain("- 'package.json'")
    expect(workflow).toContain("- 'bun.lock'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('pull-requests: write')
    expect(workflow).toContain('graphviz')
    expect(workflow).toContain('bun run architecture:refresh')
    expect(workflow).toContain('peter-evans/create-pull-request@v8')
    expect(workflow).toContain('automation/architecture-refresh')
    expect(workflow).toContain('docs/architecture/**')
  })
})
