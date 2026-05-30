// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type ZodModule = typeof import('zod')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isZodModule(value: unknown): value is ZodModule {
  return isRecord(value) && isRecord(value['z']) && typeof value['ZodError'] === 'function'
}

export function getZod(): ZodModule {
  const moduleValue: unknown = import.meta.require('zod')
  if (!isZodModule(moduleValue)) {
    throw new Error('Invalid zod module contract')
  }
  return moduleValue
}
