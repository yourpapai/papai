import type { ToolSet } from 'ai'

import { seededTasks } from './tool-surface-benchmark-scenarios-data.js'

export { createBenchmarkStore, scenarios, snapshotFromStore } from './tool-surface-benchmark-scenarios-data.js'

export type BenchmarkMode = 'direct_full' | 'direct_routed'
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
const mutationToolNames = new Set(['create_task', 'update_task', 'add_comment', 'delete_task'])
const hasOnlyAllowedCalls = (snapshot: BenchmarkScenarioSnapshot, allowedToolNames: readonly string[]): boolean =>
  snapshot.toolCalls.every((toolName) => allowedToolNames.includes(toolName))
const firstCallIndex = (snapshot: BenchmarkScenarioSnapshot, toolName: string): number =>
  snapshot.toolCalls.indexOf(toolName)
const firstMutationIndex = (snapshot: BenchmarkScenarioSnapshot): number =>
  snapshot.toolCalls.findIndex((toolName) => mutationToolNames.has(toolName))
const mutationHappensAfter = (
  snapshot: BenchmarkScenarioSnapshot,
  requiredDiscoveryCalls: readonly string[],
): boolean => {
  const mutationIndex = firstMutationIndex(snapshot)
  return (
    mutationIndex !== -1 &&
    requiredDiscoveryCalls.every((toolName) => firstCallIndex(snapshot, toolName) < mutationIndex)
  )
}
const findTask = (snapshot: BenchmarkScenarioSnapshot, taskId: string): BenchmarkTask | undefined =>
  snapshot.tasks.find((task) => task.id === taskId)
const findTaskByTitle = (snapshot: BenchmarkScenarioSnapshot, title: string): BenchmarkTask | undefined =>
  snapshot.tasks.find((task) => task.title === title)
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
const hasNoExtraEntries = (snapshot: BenchmarkScenarioSnapshot): boolean =>
  snapshot.recurringEntries.length === 0 && snapshot.deferredEntries.length === 0
const hasExactlyOneNewTask = (snapshot: BenchmarkScenarioSnapshot, expectedTask: BenchmarkTask): boolean => {
  const matchingTasks = snapshot.tasks.filter(
    (task) =>
      task.title === expectedTask.title &&
      task.priority === expectedTask.priority &&
      task.status === expectedTask.status &&
      task.assigneeId === expectedTask.assigneeId &&
      task.deleted === expectedTask.deleted &&
      task.comments.length === expectedTask.comments.length,
  )
  const matchingTask = matchingTasks[0]

  return (
    snapshot.tasks.length === seededTasks.length + 1 &&
    hasUnchangedSeededTasks({ ...snapshot, tasks: snapshot.tasks.filter((task) => task.id !== expectedTask.id) }) &&
    matchingTasks.length === 1 &&
    matchingTask !== undefined &&
    !seededTasks.some((task) => task.id === matchingTask.id)
  )
}
const hasOnlyExpectedDeferredEntry = (
  snapshot: BenchmarkScenarioSnapshot,
  expectedPrompt: string,
  expectedWhen: string,
): boolean => {
  const entry = snapshot.deferredEntries[0]
  return (
    snapshot.recurringEntries.length === 0 &&
    snapshot.deferredEntries.length === 1 &&
    entry !== undefined &&
    entry.prompt === expectedPrompt &&
    entry.when === expectedWhen
  )
}
const hasOnlyExpectedRecurringEntry = (
  snapshot: BenchmarkScenarioSnapshot,
  expectedTitle: string,
  expectedCadence: string,
): boolean => {
  const entry = snapshot.recurringEntries[0]
  return (
    snapshot.deferredEntries.length === 0 &&
    snapshot.recurringEntries.length === 1 &&
    entry !== undefined &&
    entry.title === expectedTitle &&
    entry.cadence === expectedCadence
  )
}
const hasOnlyExpectedTaskMutation = (
  snapshot: BenchmarkScenarioSnapshot,
  expectedTaskId: string,
  matchesExpectedMutation: (task: BenchmarkTask) => boolean,
): boolean =>
  hasNoExtraEntries(snapshot) &&
  snapshot.tasks.length === seededTasks.length &&
  seededTasks.every((task) => {
    const actualTask = findTask(snapshot, task.id)
    if (actualTask === undefined) return false
    if (task.id === expectedTaskId) return matchesExpectedMutation(actualTask)
    return matchesSeededTask(snapshot, task)
  })
const evaluators: Readonly<Record<string, ScenarioEvaluator>> = {
  create_basic_task: (snapshot) => {
    const createdTask = findTaskByTitle(snapshot, 'Draft tool benchmark summary')
    return hasCall(snapshot, 'create_task') &&
      createdTask !== undefined &&
      hasExactlyOneNewTask(snapshot, {
        id: createdTask.id,
        title: 'Draft tool benchmark summary',
        priority: 'high',
        status: 'todo',
        assigneeId: null,
        comments: [],
        deleted: false,
      })
      ? ok()
      : validationFailed()
  },
  search_then_update_status: (snapshot) =>
    hasCalls(snapshot, ['search_tasks', 'update_task']) &&
    mutationHappensAfter(snapshot, ['search_tasks']) &&
    callOccursBefore(snapshot, 'search_tasks', 'update_task') &&
    hasOnlyExpectedTaskMutation(
      snapshot,
      'task-1',
      (task) =>
        task.status === 'in_progress' &&
        task.title === seededTasks[0].title &&
        task.priority === seededTasks[0].priority &&
        task.assigneeId === seededTasks[0].assigneeId &&
        task.deleted === seededTasks[0].deleted &&
        task.comments.length === seededTasks[0].comments.length,
    )
      ? ok()
      : validationFailed(),
  search_then_comment: (snapshot) => {
    const task = findTask(snapshot, 'task-1')
    return hasCalls(snapshot, ['search_tasks', 'add_comment']) &&
      mutationHappensAfter(snapshot, ['search_tasks']) &&
      callOccursBefore(snapshot, 'search_tasks', 'add_comment') &&
      hasNoExtraEntries(snapshot) &&
      snapshot.tasks.length === seededTasks.length &&
      task !== undefined &&
      task.title === seededTasks[0].title &&
      task.priority === seededTasks[0].priority &&
      task.status === seededTasks[0].status &&
      task.assigneeId === seededTasks[0].assigneeId &&
      task.deleted === seededTasks[0].deleted &&
      task.comments.length === seededTasks[0].comments.length + 1 &&
      task.comments.includes('Route this through the smaller tool set.') &&
      matchesSeededTask(snapshot, seededTasks[1]) &&
      matchesSeededTask(snapshot, seededTasks[2])
      ? ok()
      : validationFailed()
  },
  search_then_assign_user: (snapshot) =>
    hasCalls(snapshot, ['search_tasks', 'find_user', 'update_task']) &&
    mutationHappensAfter(snapshot, ['search_tasks', 'find_user']) &&
    callOccursBefore(snapshot, 'search_tasks', 'update_task') &&
    callOccursBefore(snapshot, 'find_user', 'update_task') &&
    hasOnlyExpectedTaskMutation(
      snapshot,
      'task-1',
      (task) =>
        task.assigneeId === 'user-alex' &&
        task.title === seededTasks[0].title &&
        task.priority === seededTasks[0].priority &&
        task.status === seededTasks[0].status &&
        task.deleted === seededTasks[0].deleted &&
        task.comments.length === seededTasks[0].comments.length,
    )
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
    hasCall(snapshot, 'delete_task') && hasUnchangedSeededTasks(snapshot) && hasNoExtraEntries(snapshot)
      ? ok()
      : confirmationFailed(),
  time_plus_web_lookup: (snapshot) =>
    hasCalls(snapshot, ['get_current_time', 'web_fetch']) &&
    hasUnchangedSeededTasks(snapshot) &&
    hasNoExtraEntries(snapshot)
      ? ok()
      : validationFailed(),
  recurring_task_creation: (snapshot) =>
    hasCall(snapshot, 'create_recurring_task') &&
    hasUnchangedSeededTasks(snapshot) &&
    hasOnlyExpectedRecurringEntry(snapshot, 'Send weekly benchmark summary', 'weekly')
      ? ok()
      : validationFailed(),
  deferred_prompt_creation: (snapshot) =>
    hasCall(snapshot, 'create_deferred_prompt') &&
    hasUnchangedSeededTasks(snapshot) &&
    hasOnlyExpectedDeferredEntry(snapshot, 'Review benchmark results', 'tomorrow 09:00')
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
      hasOnlyExpectedTaskMutation(
        snapshot,
        'task-1',
        (task) =>
          task.status === 'in_progress' &&
          task.title === seededTasks[0].title &&
          task.priority === seededTasks[0].priority &&
          task.assigneeId === seededTasks[0].assigneeId &&
          task.deleted === seededTasks[0].deleted &&
          task.comments.length === seededTasks[0].comments.length,
      )
      ? ok()
      : validationFailed()
  },
}

export function evaluateBenchmarkScenario(
  scenarioId: string,
  snapshot: BenchmarkScenarioSnapshot,
): BenchmarkEvaluation {
  const evaluator = evaluators[scenarioId]
  if (evaluator === undefined) return validationFailed()
  return evaluator(snapshot)
}
