// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export {
  createResearchSourceInventory,
  createScenarioSelection,
  discoverResearchSourcePaths,
  FROZEN_RESEARCH_SOURCE_PATHS_SHA256,
  hashResearchSourceFiles,
  implementationDigest,
  resolveResearchSourcePaths,
  selectionDigest,
  sourceInventoryErrors,
  sourcePathInventoryDigest,
} from './report-identity.js'
export { renderReportMarkdown, stableReportJson } from './report-render.js'
export {
  CandidateResearchResultSchema,
  CandidateWorkerResultSchema,
  GateStateSchema,
  LifecycleEntrySchema,
  RawQueryEvaluationSchema,
  RebuildAgreementSchema,
  RebuildProbeSchema,
  REPORT_SCHEMA_VERSION,
  ResearchReportSchema,
  ResearchSourceFileSchema,
  ResearchSourceInventorySchema,
  RunFailureSchema,
  ScenarioEvaluationSchema,
  ScenarioSelectionSchema,
} from './report-schema.js'
export { validateResearchReport } from './report-validation.js'
export type {
  CandidateResearchResult,
  CandidateWorkerResult,
  LifecycleEntry,
  RawQueryEvaluation,
  RebuildAgreement,
  RebuildProbe,
  ResearchReport,
  ResearchSourceFile,
  ResearchSourceInventory,
  RunFailure,
  ScenarioEvaluation,
  ScenarioSelection,
} from './report-schema.js'
