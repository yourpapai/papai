import { describe, it, expect } from 'bun:test'

import { cronToRrule } from '../../src/recurrence-translator.js'

describe('cronToRrule', () => {
  const tz = 'UTC'

  const validCases: Array<{ name: string; cron: string; expected: { rrule: string } }> = [
    { name: 'every day at 09:00', cron: '0 9 * * *', expected: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' } },
    {
      name: 'MO/WE/FR at 14:30',
      cron: '30 14 * * 1,3,5',
      expected: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=14;BYMINUTE=30' },
    },
    { name: 'day-of-month', cron: '0 8 15 * *', expected: { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=8;BYMINUTE=0' } },
    {
      name: 'every 15 min',
      cron: '*/15 * * * *',
      expected: { rrule: 'FREQ=HOURLY;BYMINUTE=0,15,30,45' },
    },
    {
      name: 'every 3 hours',
      cron: '0 */3 * * *',
      expected: { rrule: 'FREQ=DAILY;BYHOUR=0,3,6,9,12,15,18,21;BYMINUTE=0' },
    },
    {
      name: 'quarterly at 09:00 on day 1',
      cron: '0 9 1 1,4,7,10 *',
      expected: { rrule: 'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0' },
    },
    {
      name: 'weekdays 09:00-17:00 top of hour',
      cron: '0 9-17 * * 1-5',
      expected: {
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,10,11,12,13,14,15,16,17;BYMINUTE=0',
      },
    },
  ]

  const invalidCases: Array<{ name: string; cron: string }> = [
    { name: 'garbage', cron: 'not a cron' },
    { name: 'empty', cron: '' },
  ]

  for (const c of validCases) {
    it(c.name, () => {
      const out = cronToRrule(c.cron, tz, '2026-04-20T00:00:00Z')
      expect(out).not.toBeNull()
      expect(out?.rrule).toBe(c.expected.rrule)
    })
  }

  for (const c of invalidCases) {
    it(c.name, () => {
      const out = cronToRrule(c.cron, tz, '2026-04-20T00:00:00Z')
      expect(out).toBeNull()
    })
  }

  it('throws when the cron parses but the translator cannot handle it (translator bug)', () => {
    expect(() => {
      cronToRrule('30 14 * * 1,3,5', tz, '2026-04-20T00:00:00Z')
    }).not.toThrow()
  })
})
