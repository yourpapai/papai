// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { sveltePlugin } from './svelte-plugin.js'

// The relocated loader is what lets the Bun test runner (client lane and the
// Stryker paired-run path) import .svelte components and .svelte.ts modules
// directly from source. Verified end-to-end through Bun.build with real temp
// files: a literal template marker must survive compilation, and the raw
// $state rune must be transformed away.
describe('svelte-plugin (test-runner loader)', () => {
  test('compiles .svelte components and .svelte.ts modules for the browser', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-plugin-test-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'Marker.svelte'),
        '<script lang="ts">\n  let n: number = $state(41)\n</script>\n\n<h1>plugh-marker-{n}</h1>\n',
      )
      fs.writeFileSync(path.join(dir, 'counter.svelte.ts'), 'export const store = $state({ v: 0 })\n')
      fs.writeFileSync(
        path.join(dir, 'entry.ts'),
        [
          "import Comp from './Marker.svelte'",
          "import { store } from './counter.svelte.ts'",
          '',
          'globalThis.__comp = Comp',
          'globalThis.__store = store',
          '',
        ].join('\n'),
      )

      const result = await Bun.build({
        entrypoints: [path.join(dir, 'entry.ts')],
        format: 'esm',
        // The temp dir has no node_modules; the compiled component's svelte
        // runtime imports are irrelevant to the transform under test.
        external: ['svelte/internal/client', 'svelte/internal/disclose-version'],
        plugins: [sveltePlugin({ dev: true })],
      })

      expect(result.success).toBe(true)
      const js = (await Promise.all(result.outputs.map((output) => output.text()))).join('\n')
      // Both modules were loaded and kept alive by the entry's assignments.
      expect(js).toContain('__comp')
      expect(js).toContain('__store')
      // The component's literal template text survives compilation.
      expect(js).toContain('plugh-marker-')
      // The $state rune was compiled to the internal runtime call.
      expect(js).not.toContain('$state(')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
