import { makeToolProxy } from '../src/tools/tool-proxy.js'
import { routeToolsForMessage } from '../src/tools/tool-router.js'
import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  snapshotFromStore,
  type BenchmarkDeferredEntry,
  type BenchmarkEvaluation,
  type BenchmarkMode,
  type BenchmarkRecurringEntry,
  type BenchmarkScenario,
  type BenchmarkScenarioSnapshot,
  type BenchmarkStore,
  type BenchmarkTask,
  type BenchmarkToolSetup,
} from './tool-surface-benchmark-scenarios-support.js'
import { buildDirectTools } from './tool-surface-benchmark-scenarios-tools.js'

export {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  snapshotFromStore,
  type BenchmarkDeferredEntry,
  type BenchmarkEvaluation,
  type BenchmarkMode,
  type BenchmarkRecurringEntry,
  type BenchmarkScenario,
  type BenchmarkScenarioSnapshot,
  type BenchmarkStore,
  type BenchmarkTask,
  type BenchmarkToolSetup,
}

export const toolsForMode = (mode: BenchmarkMode, prompt: string, store: BenchmarkStore): BenchmarkToolSetup => {
  const directTools = buildDirectTools(store)
  const fullToolCount = Object.keys(directTools).length

  if (mode === 'proxy') {
    return { tools: { papai_tool: makeToolProxy(directTools) }, fullToolCount, exposedToolCount: 1 }
  }

  if (mode === 'direct_routed') {
    const routed = routeToolsForMessage(prompt, directTools)
    return { tools: routed.tools, fullToolCount: routed.fullToolCount, exposedToolCount: routed.exposedToolCount }
  }

  return { tools: directTools, fullToolCount, exposedToolCount: fullToolCount }
}
