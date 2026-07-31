// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Regenerates src/analytics/generated/tool-slugs.ts from the registered
 * first-party tool descriptors (core builtins, disclosure/compaction meta
 * tools, bundled plugin manifests). Run: bun scripts/generate-analytics-tool-slugs.ts
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { collectAnalyticsToolSlugs, renderToolSlugsModule } from '../src/analytics/tool-slug-generation.js'

const outputPath = fileURLToPath(new URL('../src/analytics/generated/tool-slugs.ts', import.meta.url))
const slugs = collectAnalyticsToolSlugs()
writeFileSync(outputPath, renderToolSlugsModule(slugs))
console.log(`generated ${outputPath} with ${slugs.length} tool slugs`)
