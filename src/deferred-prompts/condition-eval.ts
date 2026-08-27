// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'
import type { AlertCondition, LeafCondition } from './types.js'

const log = logger.child({ scope: 'deferred:condition-eval' })

const getFieldValue = (task: Task, field: string): string | string[] | null | undefined => {
  switch (field) {
    case 'task.id':
      return task.id
    case 'task.status':
      return task.status ?? null
    case 'task.priority':
      return task.priority ?? null
    case 'task.assignee':
      return task.assignee ?? null
    case 'task.dueDate':
      return task.dueDate ?? null
    case 'task.project':
      return task.projectId ?? null
    case 'task.labels':
      return (task.labels ?? []).map((l) => l.name)
    default:
      return undefined
  }
}

const evaluateLeaf = (leaf: LeafCondition, task: Task, snapshots: Map<string, string>, now: Date): boolean => {
  const { field, op, value } = leaf
  const fieldValue = getFieldValue(task, field)

  switch (op) {
    case 'eq':
      return fieldValue === String(value)
    case 'neq':
      return fieldValue !== String(value)
    case 'changed_to': {
      const prev = snapshots.get(`${task.id}:${field.replace('task.', '')}`)
      if (prev === undefined) return false
      return prev !== String(value) && fieldValue === String(value)
    }
    case 'overdue': {
      if (typeof fieldValue !== 'string' || fieldValue === '') return false
      return new Date(fieldValue) < now
    }
    case 'gt': {
      if (typeof fieldValue !== 'string' || fieldValue === '') return false
      return new Date(fieldValue) > new Date(String(value))
    }
    case 'lt': {
      if (typeof fieldValue !== 'string' || fieldValue === '') return false
      return new Date(fieldValue) < new Date(String(value))
    }
    case 'contains':
      return Array.isArray(fieldValue) && fieldValue.includes(String(value))
    case 'not_contains':
      return Array.isArray(fieldValue) && !fieldValue.includes(String(value))
    default:
      log.warn({ op, field }, 'Unknown operator')
      return false
  }
}

export const evaluateCondition = (
  condition: AlertCondition,
  task: Task,
  snapshots: Map<string, string>,
  now: Date = new Date(),
): boolean => {
  if ('and' in condition) return condition.and.every((c) => evaluateCondition(c, task, snapshots, now))
  if ('or' in condition) return condition.or.some((c) => evaluateCondition(c, task, snapshots, now))
  if ('kind' in condition) return false
  return evaluateLeaf(condition, task, snapshots, now)
}

const isWatchLeaf = (leaf: LeafCondition): boolean =>
  leaf.field === 'task.id' && leaf.op === 'eq' && leaf.value !== undefined

export const extractWatchedTaskIds = (condition: AlertCondition): string[] => {
  const ids = new Set<string>()
  const walk = (node: AlertCondition): void => {
    if ('and' in node) {
      for (const child of node.and) walk(child)
      return
    }
    if ('or' in node) {
      for (const child of node.or) walk(child)
      return
    }
    if ('kind' in node) return
    if (isWatchLeaf(node)) ids.add(String(node.value))
  }
  walk(condition)
  return [...ids]
}

export const isPureWatchCondition = (condition: AlertCondition): boolean => {
  if ('and' in condition) return condition.and.every(isPureWatchCondition)
  if ('or' in condition) return condition.or.every(isPureWatchCondition)
  if ('kind' in condition) return false
  return isWatchLeaf(condition)
}

export const extractActivityTaskIds = (condition: AlertCondition): string[] => {
  const ids = new Set<string>()
  const walk = (node: AlertCondition): void => {
    if ('and' in node) {
      for (const child of node.and) walk(child)
      return
    }
    if ('or' in node) {
      for (const child of node.or) walk(child)
      return
    }
    if ('kind' in node) ids.add(node.taskId)
  }
  walk(condition)
  return [...ids]
}

export const isPureActivityCondition = (condition: AlertCondition): boolean => {
  if ('and' in condition) return condition.and.every(isPureActivityCondition)
  if ('or' in condition) return condition.or.every(isPureActivityCondition)
  return 'kind' in condition
}

const sanitizeValue = (value: string | number): string => {
  const str = String(value)
  const clean = str.replaceAll(/[\n\r]/gu, ' ').slice(0, 200)
  return `"${clean}"`
}

export const describeCondition = (condition: AlertCondition): string => {
  if ('and' in condition) return `(${condition.and.map(describeCondition).join(' AND ')})`
  if ('or' in condition) return `(${condition.or.map(describeCondition).join(' OR ')})`
  if ('kind' in condition) {
    const categories = condition.categories === undefined ? '' : ` (categories: ${condition.categories.join(', ')})`
    return `activity on task ${sanitizeValue(condition.taskId)}${categories}`
  }
  const { field, op, value } = condition
  return value === undefined ? `${field} ${op}` : `${field} ${op} ${sanitizeValue(value)}`
}
