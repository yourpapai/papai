import type { ToolSet } from 'ai'

export type BenchmarkMode = 'direct_full' | 'proxy' | 'direct_routed'
export type BenchmarkTask = Readonly<{
  id: string
  title: string
  priority: string
  status: string
  assigneeId: string | null
  comments: readonly string[]
  deleted: boolean
}>
export type BenchmarkRecurringEntry = Readonly<{ id: string; title: string; cadence: string }>
export type BenchmarkDeferredEntry = Readonly<{ id: string; prompt: string; when: string }>
export type BenchmarkScenarioSnapshot = Readonly<{
  tasks: readonly BenchmarkTask[]
  recurringEntries: readonly BenchmarkRecurringEntry[]
  deferredEntries: readonly BenchmarkDeferredEntry[]
  toolCalls: readonly string[]
}>
export type BenchmarkEvaluation = Readonly<{ success: boolean; failureCategory: string | null }>
export type BenchmarkScenario = Readonly<{ id: string; prompt: string }>
export type BenchmarkToolSetup = Readonly<{ tools: ToolSet; fullToolCount: number; exposedToolCount: number }>
export type BenchmarkStore = {
  tasks: Map<string, BenchmarkTask>
  recurringEntries: Map<string, BenchmarkRecurringEntry>
  deferredEntries: Map<string, BenchmarkDeferredEntry>
  toolCalls: string[]
  nextTaskId: number
  nextRecurringId: number
  nextDeferredId: number
}

type ScenarioEntry = Readonly<{ id: string; prompt: string }>
type ScenarioEvaluator = (snapshot: BenchmarkScenarioSnapshot) => BenchmarkEvaluation

const ok = (): BenchmarkEvaluation => ({ success: true, failureCategory: null })
const validationFailed = (): BenchmarkEvaluation => ({ success: false, failureCategory: 'validation_failed' })
const confirmationFailed = (): BenchmarkEvaluation => ({ success: false, failureCategory: 'confirmation_error' })
const hasCall = (snapshot: BenchmarkScenarioSnapshot, toolName: string): boolean =>
  snapshot.toolCalls.includes(toolName)
const hasCalls = (snapshot: BenchmarkScenarioSnapshot, names: readonly string[]): boolean =>
  names.every((toolName) => hasCall(snapshot, toolName))
const callOccursBefore = (snapshot: BenchmarkScenarioSnapshot, first: string, second: string): boolean => {
  const firstIndex = snapshot.toolCalls.indexOf(first)
  const secondIndex = snapshot.toolCalls.lastIndexOf(second)
  return firstIndex !== -1 && secondIndex !== -1 && firstIndex < secondIndex
}
const readOnlyToolNames: readonly string[] = ['list_tasks', 'search_tasks']
const mutationToolNames: readonly string[] = ['create_task', 'update_task', 'add_comment', 'delete_task']
const hasOnlyAllowedCalls = (snapshot: BenchmarkScenarioSnapshot, allowedToolNames: readonly string[]): boolean =>
  snapshot.toolCalls.every((toolName) => allowedToolNames.includes(toolName))
const firstCallIndex = (snapshot: BenchmarkScenarioSnapshot, toolName: string): number =>
  snapshot.toolCalls.indexOf(toolName)
const firstMutationIndex = (snapshot: BenchmarkScenarioSnapshot): number =>
  snapshot.toolCalls.findIndex((toolName) => mutationToolNames.includes(toolName))
const findTask = (snapshot: BenchmarkScenarioSnapshot, taskId: string): BenchmarkTask | undefined =>
  snapshot.tasks.find((task) => task.id === taskId)
const findTaskByTitle = (snapshot: BenchmarkScenarioSnapshot, title: string): BenchmarkTask | undefined =>
  snapshot.tasks.find((task) => task.title === title)
const seedTask = (id: string, title: string, priority: string): BenchmarkTask => ({
  id,
  title,
  priority,
  status: 'todo',
  assigneeId: null,
  comments: [],
  deleted: false,
})
const seededTasks = [
  seedTask('task-1', 'Prepare benchmark report', 'medium'),
  seedTask('task-2', 'Review release notes', 'low'),
  seedTask('task-3', 'Confirm benchmark routing prompts', 'high'),
] as const satisfies readonly BenchmarkTask[]
const matchesSeededTask = (snapshot: BenchmarkScenarioSnapshot, expectedTask: BenchmarkTask): boolean => {
  const actualTask = findTask(snapshot, expectedTask.id)
  return (
    actualTask !== undefined &&
    actualTask.title === expectedTask.title &&
    actualTask.priority === expectedTask.priority &&
    actualTask.status === expectedTask.status &&
    actualTask.assigneeId === expectedTask.assigneeId &&
    actualTask.deleted === expectedTask.deleted &&
    actualTask.comments.length === expectedTask.comments.length &&
    actualTask.comments.every((comment, index) => comment === expectedTask.comments[index])
  )
}
const hasUnchangedSeededTasks = (snapshot: BenchmarkScenarioSnapshot): boolean =>
  snapshot.tasks.length === seededTasks.length && seededTasks.every((task) => matchesSeededTask(snapshot, task))

export const scenarios: readonly BenchmarkScenario[] = [
  { id: 'create_basic_task', prompt: 'Create a high priority task named Draft tool benchmark summary.' },
  { id: 'search_then_update_status', prompt: 'Search for the benchmark report task and mark it in progress.' },
  { id: 'search_then_comment', prompt: 'Find the benchmark report task and add a comment about routed mode.' },
  { id: 'search_then_assign_user', prompt: 'Find the benchmark report task and assign it to Alex.' },
  { id: 'list_or_search_read_only', prompt: 'List the current benchmark tasks.' },
  { id: 'delete_needs_confirmation', prompt: 'Delete the benchmark report task.' },
  { id: 'time_plus_web_lookup', prompt: 'Check https://example.com/release-notes and tell me the current time.' },
  { id: 'recurring_task_creation', prompt: 'Create a weekly recurring task to send a benchmark summary.' },
  { id: 'deferred_prompt_creation', prompt: 'Remind me tomorrow about benchmark results.' },
  { id: 'ambiguous_but_solvable_task_update', prompt: 'Update the benchmark item that still needs progress.' },
] as const satisfies readonly ScenarioEntry[]

export const createBenchmarkStore = (): BenchmarkStore => ({
  tasks: new Map(seededTasks.map((task) => [task.id, task])),
  recurringEntries: new Map(),
  deferredEntries: new Map(),
  toolCalls: [],
  nextTaskId: 4,
  nextRecurringId: 1,
  nextDeferredId: 1,
})

export const snapshotFromStore = (store: BenchmarkStore): BenchmarkScenarioSnapshot => ({
  tasks: [...store.tasks.values()],
  recurringEntries: [...store.recurringEntries.values()],
  deferredEntries: [...store.deferredEntries.values()],
  toolCalls: [...store.toolCalls],
})

const evaluators: Readonly<Record<string, ScenarioEvaluator>> = {
  create_basic_task: (snapshot) => {
    const task = findTaskByTitle(snapshot, 'Draft tool benchmark summary')
    return hasCall(snapshot, 'create_task') && task?.priority === 'high' && task.status === 'todo'
      ? ok()
      : validationFailed()
  },
  search_then_update_status: (snapshot) =>
    hasCalls(snapshot, ['search_tasks', 'update_task']) && findTask(snapshot, 'task-1')?.status === 'in_progress'
      ? ok()
      : validationFailed(),
  search_then_comment: (snapshot) => {
    const task = findTask(snapshot, 'task-1')
    return hasCalls(snapshot, ['search_tasks', 'add_comment']) &&
      task !== undefined &&
      task.comments.includes('Route this through the smaller tool set.')
      ? ok()
      : validationFailed()
  },
  search_then_assign_user: (snapshot) =>
    hasCalls(snapshot, ['search_tasks', 'find_user', 'update_task']) &&
    findTask(snapshot, 'task-1')?.assigneeId === 'user-alex'
      ? ok()
      : validationFailed(),
  list_or_search_read_only: (snapshot) =>
    (hasCall(snapshot, 'list_tasks') || hasCall(snapshot, 'search_tasks')) &&
    hasOnlyAllowedCalls(snapshot, readOnlyToolNames) &&
    hasUnchangedSeededTasks(snapshot) &&
    snapshot.recurringEntries.length === 0 &&
    snapshot.deferredEntries.length === 0
      ? ok()
      : validationFailed(),
  delete_needs_confirmation: (snapshot) =>
    hasCall(snapshot, 'delete_task') && findTask(snapshot, 'task-1')?.deleted === false ? ok() : confirmationFailed(),
  time_plus_web_lookup: (snapshot) =>
    hasCalls(snapshot, ['get_current_time', 'web_fetch']) ? ok() : validationFailed(),
  recurring_task_creation: (snapshot) =>
    hasCall(snapshot, 'create_recurring_task') &&
    snapshot.recurringEntries.find((entry) => entry.title === 'Send weekly benchmark summary')?.cadence === 'weekly'
      ? ok()
      : validationFailed(),
  deferred_prompt_creation: (snapshot) =>
    hasCall(snapshot, 'create_deferred_prompt') &&
    snapshot.deferredEntries.find((entry) => entry.prompt === 'Review benchmark results')?.when === 'tomorrow 09:00'
      ? ok()
      : validationFailed(),
  ambiguous_but_solvable_task_update: (snapshot) => {
    const discoveryIndex = firstCallIndex(snapshot, 'search_tasks')
    const mutationIndex = firstMutationIndex(snapshot)
    return hasCalls(snapshot, ['search_tasks', 'update_task']) &&
      discoveryIndex !== -1 &&
      mutationIndex !== -1 &&
      discoveryIndex < mutationIndex &&
      callOccursBefore(snapshot, 'search_tasks', 'update_task') &&
      findTask(snapshot, 'task-1')?.status === 'in_progress'
      ? ok()
      : validationFailed()
  },
}

export function evaluateBenchmarkScenario(
  scenarioId: string,
  snapshot: BenchmarkScenarioSnapshot,
): BenchmarkEvaluation {
  return evaluators[scenarioId]?.(snapshot) ?? validationFailed()
}
