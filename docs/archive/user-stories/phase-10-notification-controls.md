<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 10: Notification Controls & User Preferences

> **Status**: Partially Implemented

---

# User Story 1: Setting a Timezone for Correct Local Times

**Status**: IMPLEMENTED — Timezone config key exists and is used by scheduler

**As a** remote worker based in a different timezone than the server
**I want** to tell the assistant my local timezone
**So that** all scheduled messages, briefings, and reminders arrive at the correct local time rather than at unexpected hours

## Acceptance Criteria

**Given** I have not yet configured a timezone
**When** I set my timezone to a specific region (e.g., "Europe/Warsaw")
**Then** all future assistant messages referencing times — such as morning briefings, deadline reminders, and quiet-hours enforcement — are calculated and displayed in that local timezone

---

**Given** I have previously set a timezone
**When** I update it to a new region
**Then** all scheduled messages immediately switch to the new local time without requiring any other changes

---

# User Story 2: Quiet Hours to Silence Messages at Night

**Status**: NOT IMPLEMENTED — Quiet hours system not yet built

**As a** user who receives assistant messages on a personal device
**I want** to define a range of hours during which the assistant stays silent
**So that** I am not woken up at night or disturbed during personal time by non-urgent notifications

## Acceptance Criteria

**Given** I have configured quiet hours (e.g., 22:00–07:00 in my local timezone)
**When** the assistant would otherwise send a proactive message during that window
**Then** the message is held and delivered only after quiet hours end

---

**Given** quiet hours are active
**When** a time-sensitive alert occurs that I have not suppressed (e.g., an imminent hard deadline)
**Then** the assistant still delivers the urgent message immediately, clearly marking it as urgent

---

**Given** I have set quiet hours
**When** I view my current preferences
**Then** the configured start and end times are shown in my local timezone, not in any server-side format

---

# User Story 3: Configuring Working Days for Briefings and Nudges

**Status**: NOT IMPLEMENTED — Working days configuration not yet built

**As a** user with a non-standard work schedule (e.g., Tuesday–Saturday)
**I want** to specify which days of the week count as my working days
**So that** the assistant only sends briefings and task nudges on days when I am actually working

## Acceptance Criteria

**Given** I configure my working days as Tuesday through Saturday
**When** Sunday or Monday arrives
**Then** the assistant sends no proactive briefings or task nudges on those days

---

**Given** I have set working days
**When** a working day begins
**Then** the assistant delivers the morning briefing and any pending nudges as expected

---

**Given** I have not configured working days
**When** the assistant needs to determine whether to send a briefing
**Then** it falls back to a standard Monday–Friday schedule

---

# User Story 4: Choosing a Delivery Mode for Notifications

**Status**: NOT IMPLEMENTED — Delivery modes (immediate/digest/muted) not yet built

**As a** user who prefers not to be interrupted throughout the day
**I want** to choose between receiving messages immediately, receiving them bundled into a single daily digest, or muting all proactive messages entirely
**So that** I can match the assistant's communication style to how I prefer to work

## Acceptance Criteria

**Given** I set my delivery mode to "digest"
**When** the assistant would send multiple proactive messages across the day (briefings, nudges, suggestions)
**Then** they are all collected and delivered as a single consolidated message at the end of my working day

---

**Given** I set my delivery mode to "muted"
**When** the assistant generates any proactive message
**Then** no message is sent; the assistant only responds when I explicitly ask it something

---

**Given** I set my delivery mode to "immediate" (the default)
**When** a proactive message is triggered
**Then** it is sent as soon as it is generated, matching the current behavior

---

**Given** I have digest mode enabled
**When** I ask the assistant a direct question
**Then** the assistant replies immediately regardless of delivery mode, since direct replies are never batched

---

# User Story 5: Turning Off Specific Notification Features Independently

**Status**: NOT IMPLEMENTED — Per-feature toggles not yet built

**As a** user who finds deadline nudges useful but morning briefings distracting
**I want** to enable or disable each type of assistant message separately
**So that** I only receive the proactive messages that are actually valuable to me

## Acceptance Criteria

**Given** I disable morning briefings
**When** my working day starts
**Then** the assistant does not send a morning briefing, but still sends deadline nudges and other enabled messages

---

**Given** I disable deadline nudges
**When** a task deadline is approaching
**Then** the assistant does not send a nudge for that task, but briefings and other features continue normally

---

**Given** I disable weekly review suggestions
**When** the end of my configured working week arrives
**Then** no weekly review message is sent, even though other features remain active

---

**Given** I have selectively disabled some features
**When** I view my current preferences
**Then** I can clearly see which features are on and which are off, in plain language

---

# User Story 6: Snoozing, Dismissing, or Rescheduling a Received Message

**Status**: NOT IMPLEMENTED — Natural language response handling for proactive messages not yet built

**As a** user who receives a deadline nudge at an inconvenient moment
**I want** to snooze, dismiss, or reschedule that specific notification directly from the chat
**So that** I can acknowledge it without losing track of the task or being pestered again too soon

## Acceptance Criteria

**Given** the assistant sends a proactive message (e.g., a deadline nudge)
**When** I reply with "snooze 2 hours"
**Then** the assistant resends the same nudge 2 hours later and confirms that it has been snoozed

---

**Given** the assistant sends a proactive message
**When** I reply with "dismiss"
**Then** the assistant stops sending that particular nudge and acknowledges the dismissal; the task remains in the system unchanged

---

**Given** the assistant sends a proactive message
**When** I reply with "remind me tomorrow morning"
**Then** the assistant reschedules the nudge for the start of my next working day and confirms the new delivery time in my local timezone

---

**Given** I have snoozed or rescheduled a nudge
**When** I ask the assistant "what have I snoozed?"
**Then** the assistant lists all snoozed messages along with when they are scheduled to be resent

---

# User Story 7: Reviewing and Resetting All Notification Preferences

**Status**: NOT IMPLEMENTED — Notification preferences management UI not yet built

**As a** user who has customized many notification settings over time
**I want** to view all my current preferences in one place and reset them to defaults if needed
**So that** I have a clear picture of how the assistant is configured and can easily start fresh

## Acceptance Criteria

**Given** I have configured various notification preferences
**When** I ask the assistant to show my notification settings
**Then** the assistant displays all preferences — timezone, quiet hours, working days, delivery mode, and per-feature toggles — in a single readable summary

---

**Given** I want to undo all my customizations
**When** I ask the assistant to reset notification settings to defaults
**Then** all preferences are reverted to the out-of-the-box values and the assistant confirms the reset

---

**Given** I have just reset my settings
**When** I ask the assistant to show my notification settings
**Then** the displayed values match the documented defaults

---

## Implementation Notes

**Currently Working:**

- Timezone configuration via `/set timezone <region>`
- All scheduled operations respect the user's configured timezone

**Still Needed:**

- Quiet hours start/end time configuration
- Working days selector (multi-select for days of week)
- Delivery mode selector (immediate/digest/muted)
- Per-feature enable/disable toggles
- Natural language parsing for snooze/dismiss/reschedule responses
- Preferences summary command
- Reset preferences command
