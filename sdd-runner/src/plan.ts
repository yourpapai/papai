// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const PlanChildSchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  deps: z.array(z.string().min(1)).default([]),
  capabilities: z.array(z.string().min(1)).optional(),
})
export type PlanChild = z.infer<typeof PlanChildSchema>

export const PlanSchema = z.object({
  children: z.array(PlanChildSchema).min(1),
})
export type Plan = z.infer<typeof PlanSchema>

function joinIds(ids: Iterable<string>): string {
  return [...ids].join(', ')
}

export function validatePlan(input: unknown): Plan {
  const plan = PlanSchema.parse(input)
  const problems: string[] = []

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const child of plan.children) {
    if (seen.has(child.id)) duplicates.add(child.id)
    seen.add(child.id)
  }
  if (duplicates.size > 0) problems.push(`duplicate child ids: ${joinIds(duplicates)}`)

  const unknownDeps = new Set<string>()
  const selfDeps = new Set<string>()
  for (const child of plan.children) {
    for (const dep of child.deps) {
      if (dep === child.id) selfDeps.add(child.id)
      else if (!seen.has(dep)) unknownDeps.add(dep)
    }
  }
  if (unknownDeps.size > 0) problems.push(`unknown deps: ${joinIds(unknownDeps)}`)
  if (selfDeps.size > 0) problems.push(`self-dependencies: ${joinIds(selfDeps)}`)

  if (problems.length > 0) throw new Error(`invalid plan: ${problems.join('; ')}`)
  return plan
}

export function topoSortChildren(input: unknown): PlanChild[] {
  const plan = validatePlan(input)
  const done = new Set<string>()
  const remaining = [...plan.children]
  const sorted: PlanChild[] = []
  while (remaining.length > 0) {
    const next = remaining.find((candidate) => candidate.deps.every((dep) => done.has(dep)))
    if (next === undefined) {
      throw new Error(`dependency cycle among: ${remaining.map((child) => child.id).join(', ')}`)
    }
    done.add(next.id)
    sorted.push(next)
    remaining.splice(remaining.indexOf(next), 1)
  }
  return sorted
}
