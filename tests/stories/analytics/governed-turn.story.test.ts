// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { eq } from 'drizzle-orm'

import { ANALYTICS_KILL_SWITCH_ENV } from '../../../src/analytics/governance/policy-store.js'
import { getActiveAnalyticsRuntime } from '../../../src/analytics/start-analytics.js'
import { analyticsDailyCounters, analyticsProcessEpochs } from '../../../src/db/analytics-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { scenario } from '../harness/scenario.js'
import { answer } from '../harness/scripted-llm.js'

const messageAcceptedValues = (): readonly number[] =>
  getDrizzleDb()
    .select({ value: analyticsDailyCounters.value })
    .from(analyticsDailyCounters)
    .where(eq(analyticsDailyCounters.metric, 'message_accepted'))
    .all()
    .map(({ value }) => value)

const openEpochCount = (): number =>
  getDrizzleDb()
    .select({ state: analyticsProcessEpochs.state })
    .from(analyticsProcessEpochs)
    .where(eq(analyticsProcessEpochs.state, 'open'))
    .all().length

const flushAnalytics = async (): Promise<void> => {
  await getActiveAnalyticsRuntime()?.observer.flush()
}

scenario(
  'SCN-analytics-governed-turn: a governed turn records one epoch-bound message aggregate and the kill switch stops collection without blocking replies',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.analyticsRuntime('governed')

    given.llm([answer('First reply.')])
    await when.message(alice, dm, 'hello')
    then.replyTo(alice).equals('First reply.')

    await flushAnalytics()
    expect(messageAcceptedValues()).toEqual([1])
    expect(openEpochCount()).toBe(1)

    process.env[ANALYTICS_KILL_SWITCH_ENV] = '1'

    given.llm([answer('Second reply.')])
    await when.message(alice, dm, 'still there?')
    then.replyTo(alice).equals('Second reply.')

    await flushAnalytics()
    expect(messageAcceptedValues()).toEqual([1])
  },
)
