// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { AggregateCounterV1Schema, AggregateHistogramV1Schema, EventNameV1Schema } from './controlled-types.js'
import type { EventNameV1 } from './controlled-types.js'
import { propsByEventName } from './event-props.js'
import {
  ANALYTICS_EVENTS_METADATA_V1,
  type AnalyticsEventMetadataV1,
  type PrivacyClassV1,
  type RqV1,
  type SourceFamilyV1,
} from './registry-events.js'

export const SourceFamilyV1Schema = z.enum([
  'chat',
  'auth',
  'turn',
  'reply',
  'llm',
  'agent_tool',
  'confirmation',
  'steering',
  'stop',
  'clarification',
  'rephrase',
  'disclosure',
  'settings',
  'task',
  'intent',
  'feature',
  'live_status',
  'provider',
  'rate_limit',
  'unconfigured',
  'mcp',
  'guest',
])

export type { RqV1 }

export type AnalyticsEventMetricMappingV1 = AnalyticsEventMetadataV1['metricMapping']

export type AnalyticsEventRegistryV1 = Readonly<{
  events: Readonly<Record<EventNameV1, AnalyticsEventMetadataV1>>
  eventNames: readonly EventNameV1[]
  propsByEventName: typeof propsByEventName
  sourceFamilyMap: ReadonlyMap<EventNameV1, SourceFamilyV1>
  metricMapping: ReadonlyMap<EventNameV1, AnalyticsEventMetricMappingV1>
  rqCoverageMap: ReadonlyMap<EventNameV1, readonly RqV1[]>
  privacyClassMap: ReadonlyMap<EventNameV1, PrivacyClassV1>
  eventNameSchema: typeof EventNameV1Schema
  sourceFamilySchema: typeof SourceFamilyV1Schema
  counterMetricSchema: typeof AggregateCounterV1Schema
  histogramMetricSchema: typeof AggregateHistogramV1Schema
}>

const eventNames = EventNameV1Schema.options

const sourceFamilyMap = new Map(eventNames.map((name) => [name, ANALYTICS_EVENTS_METADATA_V1[name].sourceFamily]))

const metricMapping = new Map(eventNames.map((name) => [name, ANALYTICS_EVENTS_METADATA_V1[name].metricMapping]))

const rqCoverageMap = new Map(eventNames.map((name) => [name, ANALYTICS_EVENTS_METADATA_V1[name].rqCoverage]))

const privacyClassMap = new Map(eventNames.map((name) => [name, ANALYTICS_EVENTS_METADATA_V1[name].privacyClass]))

export const ANALYTICS_EVENT_REGISTRY_V1: AnalyticsEventRegistryV1 = Object.freeze({
  events: ANALYTICS_EVENTS_METADATA_V1,
  eventNames,
  propsByEventName,
  sourceFamilyMap,
  metricMapping,
  rqCoverageMap,
  privacyClassMap,
  eventNameSchema: EventNameV1Schema,
  sourceFamilySchema: SourceFamilyV1Schema,
  counterMetricSchema: AggregateCounterV1Schema,
  histogramMetricSchema: AggregateHistogramV1Schema,
})
