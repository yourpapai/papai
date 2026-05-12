import { describe, expect, test } from 'bun:test'

import { scheduler } from '../src/scheduler-instance.js'

describe('scheduler-instance', () => {
  test('registers staged-files-purge task', () => {
    expect(scheduler.hasTask('staged-files-purge')).toBe(true)
  })
})
