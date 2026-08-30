// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// knip's built-in Svelte plugin enables but never registers its compiler:
// its hasDependency('svelte') probe fails under bun's node_modules-less
// install layout. Register an equivalent script-body extractor here.
export const svelteCompiler = (source: string): string => {
  const scripts: string[] = []
  for (const m of source.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/gmu)) {
    if (m[1] !== undefined && m[1] !== '') scripts.push(m[1])
  }
  return scripts.join(';\n')
}
