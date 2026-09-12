# recurrence-strict-parsing — delta

## Purpose

The recurrence engine parses stored recurrence rules under RFC 5545 strict constraints, so that rule strings violating the standard (notably `COUNT` combined with `UNTIL`, or a DATE-valued `UNTIL` against a DATE-TIME `DTSTART`) are rejected at parse time and surface only through the established degrade-to-null failure contract instead of yielding undefined occurrence semantics.

## ADDED Requirements

### Requirement: Recurrence rules parse under RFC 5545 strict constraints
The recurrence engine SHALL construct every recurrence iterator in strict mode, so that rule strings violating RFC 5545 constraints enforced by the recurrence library — including combining `COUNT` with `UNTIL`, and a DATE-valued `UNTIL` paired with a DATE-TIME `DTSTART` — SHALL be rejected at parse time.

#### Scenario: COUNT and UNTIL combined is rejected
- **WHEN** a compiled recurrence carries a rule string containing both `COUNT` and `UNTIL`
- **THEN** parsing fails with a reason string and no iterator is produced

#### Scenario: DATE-valued UNTIL with DATE-TIME DTSTART is rejected
- **WHEN** a rule string carries `DTSTART;TZID=<zone>:<date-time>` and an `UNTIL` given as a bare DATE (`YYYYMMDD`, no time)
- **THEN** parsing fails with a reason string and no iterator is produced

#### Scenario: Rules papai emits remain valid
- **WHEN** a recurrence spec is compiled through the existing spec-to-rrule path (freq, interval, byDay/byMonthDay/byMonth, byHour/byMinute, `COUNT` alone, or `UNTIL` as a UTC DATE-TIME with trailing `Z`)
- **THEN** the rule parses successfully under strict mode and yields the same first occurrence as before

### Requirement: Strict-parse violations degrade through the failure contract only
A rule rejected by strict parsing SHALL follow the existing parse-failure contract: the failure is recorded with a structured warn log carrying the rule string and reason, `nextOccurrence` returns `null`, `occurrencesBetween` returns an empty list, and no exception escapes to callers. A recurring task whose rule no longer parses SHALL have its next run set to null and cease firing rather than crashing the scheduler or poller.

#### Scenario: Rejected rule does not throw
- **WHEN** `nextOccurrence` or `occurrencesBetween` is invoked with a compiled recurrence whose rule violates strict constraints
- **THEN** the call returns `null` / `[]` respectively, and a warn log names the reason, without any thrown error reaching the caller

#### Scenario: Persisted task stops firing on unparseable rule
- **WHEN** the recurring-task scheduler advances a task whose stored rule is rejected by strict parsing
- **THEN** the task's next run becomes null, the task ceases to fire on later polls, and the process stays healthy
