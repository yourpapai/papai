// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  evaluateStoryCoverage,
  formatStoryCoverageEvaluation,
  readCoverageFloor,
  STORY_COVERAGE_FLOOR_PATH,
} from '../coverage/story-coverage-gate.js'
import { STORY_COVERAGE_LCOV_PATH } from './reports.js'
import type { StoryRunnerSession } from './session.js'

export async function gateStoryCoverage(
  dependencies: Readonly<{ cwd: string }>,
  session: StoryRunnerSession,
  childExitCode: number,
): Promise<number> {
  const copied = await session.copyCoverage()
  if (!copied) {
    console.warn('T0 coverage requested but no lcov was produced by the child run')
    return childExitCode
  }
  const lcov = await readFile(path.join(dependencies.cwd, STORY_COVERAGE_LCOV_PATH), 'utf8')
  const floor = await readCoverageFloor(path.join(dependencies.cwd, STORY_COVERAGE_FLOOR_PATH))
  const evaluation = evaluateStoryCoverage(lcov, floor)
  console.log(formatStoryCoverageEvaluation(evaluation))
  if (!evaluation.pass && childExitCode === 0) return 1
  return childExitCode
}
