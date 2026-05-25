// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Guards the design invariant that the dev-only Storybook story/mock harness
// (client/stories/**, .stories.svelte, @storybook/*, msw) never reaches the
// production debug/admin bundles. Run after `bun build:client`; it greps the
// emitted IIFE bundles for marker identifiers that only exist in the harness.
//
// This is a content check, not a byte-size check: a leak pulls in MSW + the
// fixture/decorator layer and leaves these distinctive (unminified) symbols
// behind, while ordinary client changes never introduce them. If build-client
// ever enables minification, swap these identifier markers for surviving
// string literals.

import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

const BUNDLES = ['public/debug.js', 'public/admin.js'] as const

// Identifiers/specifiers that exist only in the story + mock harness.
const FORBIDDEN_MARKERS = [
  'makeBillingSubject',
  'makeGlobalStats',
  'assertFixturesMatchSchemas',
  'fixturesLoader',
  'resetAllSingletons',
  'installSseStub',
  'StubEventSource',
  'msw-storybook-addon',
  'defineMeta',
  'client/stories',
] as const

interface Violation {
  bundle: string
  marker: string
}

const violations: Violation[] = []

const sources = await Promise.all(
  BUNDLES.map(async (rel) => {
    const file = Bun.file(path.join(ROOT, rel))
    if (!(await file.exists())) {
      console.error(`Missing ${rel}. Run \`bun build:client\` before this check.`)
      process.exit(1)
    }
    return { rel, source: await file.text() }
  }),
)

for (const { rel, source } of sources) {
  for (const marker of FORBIDDEN_MARKERS) {
    if (source.includes(marker)) violations.push({ bundle: rel, marker })
  }
}

if (violations.length > 0) {
  console.error('Story/mock harness leaked into a production bundle:')
  for (const { bundle, marker } of violations) {
    console.error(`  ${bundle} contains \`${marker}\``)
  }
  console.error('\nThe client/stories/** harness must never be imported by production client code.')
  process.exit(1)
}
