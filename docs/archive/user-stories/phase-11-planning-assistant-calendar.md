<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 11: Planning Assistant & Calendar Integration — User Stories

---

# User Story 1: Next Best Action Recommendation

**As a** user managing multiple projects with competing priorities
**I want** to ask the bot what I should work on given the time I have available
**So that** I can jump straight into productive work without spending mental energy deciding what to tackle next

## Acceptance Criteria

**Given** the user has tasks in their tracker across multiple projects with varying deadlines and priorities
**When** the user sends a message like "I have 30 minutes, what should I work on?"
**Then** the bot replies with a ranked list of 1–3 specific tasks ordered by deadline urgency and priority, with a brief reason for each recommendation

---

**Given** the user specifies an energy level or context (e.g. "I'm a bit tired" or "I only have time for something easy")
**When** the bot evaluates which tasks to recommend
**Then** it factors in the stated energy level and surfaces lighter or quick-win tasks over complex, deep-focus ones

---

# User Story 2: Workload Overload Warning

**As a** user who tends to over-commit tasks on specific days
**I want** to be notified when a day is overloaded with more tasks than is feasible
**So that** I can proactively move lower-priority items before the day arrives and avoid falling behind

## Acceptance Criteria

**Given** the user has more tasks due or scheduled on a single day than can reasonably be completed
**When** the bot evaluates upcoming workload (either on request or during a morning briefing)
**Then** it flags the overloaded day and lists which tasks are lower-priority candidates for deferral

---

**Given** the bot has identified an overloaded day
**When** the user asks "can you help me clear Thursday?"
**Then** the bot suggests specific lower-priority tasks to move to the following week and confirms the remaining workload looks manageable

---

# User Story 3: Connecting a Calendar Account

**As a** user who uses an external calendar to manage meetings and appointments
**I want** to connect my calendar to the bot
**So that** the bot can incorporate my schedule into task recommendations and planning sessions

## Acceptance Criteria

**Given** the user has not connected a calendar yet
**When** the user sends a message like "connect my calendar" or "/settings"
**Then** the bot responds with clear step-by-step instructions for authorising access to their calendar, without requiring any technical knowledge from the user

---

**Given** the user has completed the authorisation steps
**When** the bot confirms the connection
**Then** it sends a confirmation message indicating the calendar is linked and describes what it will now be able to include (schedule overview, free time, event count)

---

**Given** the user wants to disconnect their calendar
**When** they ask the bot to "disconnect my calendar" or remove calendar access
**Then** the bot removes the connection immediately and confirms that no calendar data will be read going forward

---

# User Story 4: Calendar-Enriched Morning Briefing

**As a** user who starts each day with a morning briefing from the bot
**I want** the briefing to include an overview of my schedule for the day
**So that** I can understand the shape of my day — meetings, free blocks, and how much time I actually have for tasks — before committing to a plan

## Acceptance Criteria

**Given** the user has connected a calendar and receives a morning briefing
**When** the briefing is delivered in the morning
**Then** it includes the total number of scheduled events, a short summary of each event (name and time), and an estimate of the longest continuous free block available for focused work

---

**Given** the user has a heavy meeting day with few free slots
**When** the morning briefing is generated
**Then** the bot acknowledges the constrained schedule and limits task recommendations to only those that fit within the available free time

---

**Given** the user has a meeting-free morning
**When** the morning briefing is delivered
**Then** the bot highlights the open morning as a good opportunity for deep-focus work and surfaces the highest-priority complex task accordingly

---

# User Story 5: Structured Daily Planning Session

**As a** user who wants a consistent, guided start to their workday
**I want** the bot to walk me through a structured morning planning session
**So that** I leave the conversation with a clear plan: the three tasks I'm committing to today and any blockers I need to address

## Acceptance Criteria

**Given** the user sends a message like "let's plan my day" or "morning planning"
**When** the bot begins the session
**Then** it presents today's calendar overview, the tasks currently due or overdue, and asks the user to confirm or adjust their top-3 priorities for the day

---

**Given** the morning planning session is in progress
**When** the bot surfaces tasks that are blocked or awaiting input from others
**Then** it explicitly calls these out as blockers and prompts the user to decide whether to follow up or park them

---

**Given** the user has confirmed their top-3 tasks for the day
**When** the planning session ends
**Then** the bot summarises the agreed plan (top-3 tasks, any deferred items, known blockers) in a single message the user can refer back to

---

# User Story 6: Time-Aware Task Nudges During the Day

**As a** user with a calendar full of meetings
**I want** the bot to be aware of gaps between my meetings
**So that** when I ask what to work on, it recommends tasks that realistically fit in the time I have before my next commitment

## Acceptance Criteria

**Given** the user has a 45-minute gap before a meeting
**When** the user asks "what should I do now?"
**Then** the bot recommends only tasks estimated to fit within roughly 45 minutes and notes when the next meeting starts

---

**Given** the user asks for a recommendation and their next meeting starts in 10 minutes
**When** the bot evaluates available tasks
**Then** it acknowledges the short window and suggests either a quick administrative task or simply preparing for the upcoming meeting rather than starting something substantial

---

# User Story 7: End-of-Day Review Against the Plan

**As a** user who set a morning plan with the bot
**I want** to close out my day by reviewing what I achieved against what I planned
**So that** I can track follow-through over time and carry unfinished tasks into tomorrow's plan without losing context

## Acceptance Criteria

**Given** the user completed a morning planning session and set a top-3 task list
**When** the user sends a message like "end of day" or "how did I do today?"
**Then** the bot compares the planned top-3 tasks against their current status in the tracker and reports which were completed, which are still open, and which were not started

---

**Given** one or more tasks from the day's plan remain incomplete
**When** the end-of-day review is delivered
**Then** the bot asks whether to carry them over to tomorrow's plan or defer them, and saves the user's decision

---

---

## Technical Problems Solved

- No awareness of the passage of time: the bot previously had no notion of "right now" or how much time a user has available before acting
- No schedule visibility: task recommendations were made without any knowledge of meetings, appointments, or blocked-out time in the user's day
- Static prioritisation: ranking was based purely on task metadata (deadline, priority) with no dynamic context from the user's actual schedule
- No free-time detection: the bot could not identify contiguous unscheduled windows suitable for deep work or quick tasks
- Disconnected morning briefing: daily summaries contained only task information, with no integration of calendar events or schedule shape
- No guided planning flow: users had to self-direct their daily planning entirely; there was no structured session to confirm top priorities and surface blockers
- No end-of-day accountability loop: there was no mechanism to compare planned work against actual completion or carry unfinished items forward with context intact
