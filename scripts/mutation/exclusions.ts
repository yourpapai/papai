// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * File-shape exclusions shared by the mutation gate: impl files that ARE
 * gateable in principle but must never be handed to the paired runner.
 * Each exclusion exists because a test reads the implementation's source
 * text off disk and would compare it against Stryker's INSTRUMENTED copy
 * inside the sandbox — failing the initial, unmutated run, which lands the
 * file in `errored` instead of producing a score and reds the gate.
 */
export const isGeneratedSourceFile = (relPath: string): boolean => relPath.split(/[/\\]/u).includes('generated')

/**
 * Files whose killing tests regex-check formatting-sensitive source shapes.
 * Stryker 10's Babel 8 instrumenter reprints these files' arrow-tail call
 * sites onto lines that fail the static settlement guard
 * (`tests/analytics/provider-request-scope-setup-paths.test.ts`)
 * **unmutated**, so every paired run lands in `errored`. The guard is worth
 * more than the mutation score of a delegation wrapper whose callees stay
 * in scope — same trade as {@link isGeneratedSourceFile}. Also excluded via
 * a `!` glob in `stryker.config.json` so full-scope runs skip it too.
 */
export const isInstrumentationIncompatibleFile = (relPath: string): boolean =>
  relPath === 'plugins/task-provider-kaneo/auto-provision.ts'
