<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 9: Event-Driven Suggestions — User Stories

---

# User Story 1: Get Actionable Suggestions When Creating a Task

**As a** user  
**I want** papai to suggest missing details immediately after I create a new task  
**So that** my tasks are complete and actionable from the start, without requiring a separate follow-up conversation

## Acceptance Criteria

**Given** I have just created a new task with only a title  
**When** the task is saved to my project  
**Then** papai sends me a message suggesting a due date, relevant labels, a suitable assignee, and any related tasks it found in the project

---

# User Story 2: Be Alerted When a Task Update Needs Follow-Up

**As a** project manager  
**I want** papai to flag significant changes to my tasks as they happen  
**So that** I can take corrective action before problems escalate unnoticed

## Acceptance Criteria

**Given** a task exists in my project  
**When** its due date is pushed back, its status moves to an earlier stage, or its description is changed to reflect reduced scope  
**Then** papai sends me a message noting what changed and asking whether I want to take any follow-up action

---

# User Story 3: Receive Next-Step Suggestions When I Complete a Task

**As a** user  
**I want** papai to suggest follow-up actions the moment I mark a task as done  
**So that** dependent work and loose ends are not forgotten once I move on

## Acceptance Criteria

**Given** a task in my project has dependent tasks or is related to other open work  
**When** I mark the task as complete  
**Then** papai asks if I want to create a follow-up task, close any tasks that were waiting on this one, or send a completion summary to the team

---

# User Story 4: Get Prompted to Respond When a Task Becomes Overdue

**As a** user  
**I want** papai to notify me when a task passes its due date and offer concrete options  
**So that** overdue work is addressed promptly rather than silently accumulating in my backlog

## Acceptance Criteria

**Given** a task has a due date and that date has passed with the task still open  
**When** papai detects the overdue state  
**Then** it sends me a message identifying the task as overdue and offers to reschedule it, reduce its scope, or surface any blockers preventing progress

---

# User Story 5: Be Nudged When a Task Has Gone Stale

**As a** user  
**I want** papai to remind me about tasks I have not touched in several days  
**So that** important work is not silently forgotten at the bottom of my backlog

## Acceptance Criteria

**Given** a task has not been updated or commented on for a number of days  
**When** papai detects the prolonged inactivity  
**Then** it sends me a message noting the task has not changed recently and asks whether I want to revisit it, reprioritize it, or close it

---

# User Story 6: Receive an Automated End-of-Week Summary

**As a** user  
**I want** papai to send me a wrap-up at the end of my work week  
**So that** I can reflect on what was accomplished and what needs attention before the next week begins

## Acceptance Criteria

**Given** the weekly review feature is enabled and my configured last workday has arrived  
**When** the end of the workday is reached  
**Then** papai sends me a summary that lists tasks completed this week, tasks that slipped past their deadline, and tasks being carried over to next week

---

# User Story 7: Start Each Week With a Focused Planning Prompt

**As a** user  
**I want** papai to prompt me on the first morning of my work week to identify my top priorities  
**So that** I begin each week with a clear focus rather than reacting to whatever surfaces first

## Acceptance Criteria

**Given** the weekly review feature is enabled and my configured first workday has arrived  
**When** the start of my workday is reached  
**Then** papai asks me to name my top-3 goals for the week and surfaces any overdue or high-priority backlog items to help inform my choices

---

# User Story 8: Ask What I Should Work on Next at Any Time

**As a** user  
**I want** to ask papai for a recommendation on what to focus on next at any point during my day  
**So that** I stay productive without spending time manually triaging all my open tasks

## Acceptance Criteria

**Given** I have open tasks across one or more projects  
**When** I ask papai "What should I work on next?" or a similar question  
**Then** papai responds with a ranked list of up to three suggested tasks and briefly explains why each is recommended — for example, because it is overdue, high priority, or blocking other tasks

---

## Technical Problems Solved

- Transitions the bot from purely reactive to proactive, delivering value without requiring the user to initiate every interaction
- Introduces a background scheduling layer capable of running periodic state checks and time-based triggers per user
- Adds configurable cadence settings (`weekly_review`, `workdays`) stored in the existing per-user config store, keeping configuration consistent with the rest of the system
- Establishes the foundational suggestion pipeline that can later be upgraded from periodic checks to real-time delivery without changing the user-facing behaviour
- Surfaces task health signals — staleness, overdue state, status regression, scope changes — that users currently must discover by manually reviewing their backlog
- Enables coherent suggestion batching so that related nudges are grouped into a single, readable message rather than generating noise
- Reduces the cognitive overhead of weekly planning by automating the retrospective and goal-setting rituals that teams currently perform manually or skip entirely
