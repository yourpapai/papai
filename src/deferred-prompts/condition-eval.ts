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
  return evaluateLeaf(condition, task, snapshots, now)
}

const sanitizeValue = (value: string | number): string => {
  const str = String(value)
  const clean = str.replaceAll(/[\n\r]/gu, ' ').slice(0, 200)
  return `"${clean}"`
}

export const describeCondition = (condition: AlertCondition): string => {
  if ('and' in condition) return `(${condition.and.map(describeCondition).join(' AND ')})`
  if ('or' in condition) return `(${condition.or.map(describeCondition).join(' OR ')})`
  const { field, op, value } = condition
  return value === undefined ? `${field} ${op}` : `${field} ${op} ${sanitizeValue(value)}`
}
