// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { EventNameV1 } from './controlled-types.js'
import { BehaviorEventPropsSchemas } from './event-props-behavior.js'
import { CommonEventPropsSchemas } from './event-props-common.js'
import { ExecutionEventPropsSchemas } from './event-props-execution.js'

export const propsByEventName = {
  ...CommonEventPropsSchemas,
  ...ExecutionEventPropsSchemas,
  ...BehaviorEventPropsSchemas,
}

export type PropsByEventName = {
  [K in EventNameV1]: z.infer<(typeof propsByEventName)[K]>
}

export const PropsUnionSchema = z.union(Object.values(propsByEventName))
