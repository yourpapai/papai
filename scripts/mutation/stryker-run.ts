// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface StrykerRunnerDeps {
  readonly runStryker: (configPath: string, projectRoot: string, options: { readonly verbose: boolean }) => void
}

export type StrykerRunResult = { readonly kind: 'ok' } | { readonly kind: 'failed'; readonly error: unknown }

export const runStrykerWithCapturedFailure = (
  deps: StrykerRunnerDeps,
  configPath: string,
  projectRoot: string,
  verbose: boolean,
): StrykerRunResult => {
  try {
    deps.runStryker(configPath, projectRoot, { verbose })
    return { kind: 'ok' }
  } catch (error) {
    // Stryker returns non-zero for threshold failures even when it wrote a usable report.
    return { kind: 'failed', error }
  }
}
