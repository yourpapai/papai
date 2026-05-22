<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 6: Personal Memory & Recall — User Stories

---

# User Story 1: Quick Memo Capture

**As a** user who wants to jot down a thought, decision, or link without switching tools  
**I want** to send a natural language note to the bot and have it saved immediately  
**So that** I can capture fleeting ideas in the same place I manage my tasks

## Acceptance Criteria

**Given** I am in a conversation with the bot  
**When** I send a message such as "note: lease renewal deadline is June 15" or "save this: use the side entrance for the next delivery"  
**Then** the bot confirms the note has been saved, echoes back the content, and records the date and any tags I included in the message

---

# User Story 2: Automatic Routing Between Task and Memo

**As a** user who sends mixed messages to the bot  
**I want** the bot to automatically decide whether my message is a task request or a personal note  
**So that** I do not have to learn special commands or manually declare what type of input I am sending

## Acceptance Criteria

**Given** I have both tasks and memos already stored  
**When** I send a message that expresses a thought or observation rather than an action to track — for example "remember that the dev server needs 8 GB RAM"  
**Then** the bot saves it as a personal memo rather than creating an entry in my work tracker, and confirms what it did so I can correct it if it guessed wrong

---

# User Story 3: Memo Search by Keyword or Tag

**As a** user who has accumulated many notes over time  
**I want** to search my saved memos by a keyword or tag  
**So that** I can find a specific note quickly without scrolling through everything

## Acceptance Criteria

**Given** I have several saved memos, one of which is tagged "landlord" and mentions "lease renewal"  
**When** I ask the bot "find my notes tagged landlord" or "search my notes for lease"  
**Then** the bot returns a list of matching memos showing the content and date saved, and nothing from my task tracker

---

# User Story 4: Semantic Recall by Meaning

**As a** user who wants to find a note but cannot remember the exact words I used  
**I want** to search my memos by topic or intent rather than exact phrasing  
**So that** I can retrieve relevant notes even when my query is worded differently from what I originally wrote

## Acceptance Criteria

**Given** I previously saved a memo: "the apartment contract ends in June — need to act before May"  
**When** I ask "what did I write about the landlord?" or "any notes on housing deadlines?"  
**Then** the bot surfaces that memo even though neither "landlord" nor "housing" appear in the saved text, and explains why it matched

---

# User Story 5: Converting a Memo into a Task

**As a** user whose saved note has become actionable  
**I want** to tell the bot to promote a memo into a tracked task  
**So that** the work is properly tracked without me having to re-enter the information manually

## Acceptance Criteria

**Given** I have a saved memo that reads "lease renewal deadline is June 15"  
**When** I ask the bot "turn my lease renewal note into a task"  
**Then** the bot creates a task in my work tracker with a title and due date taken from the memo, confirms the task was created, and optionally asks me to confirm before changing anything in my tracker

---

# User Story 6: Browsing Recent Memos

**As a** user who wants to stay on top of recently saved notes  
**I want** to ask the bot to show my latest memos  
**So that** I can review what I have captured without having to remember specific keywords to search for

## Acceptance Criteria

**Given** I have saved several memos across the past week  
**When** I ask "show my recent notes" or "what have I saved lately?"  
**Then** the bot lists the most recent memos in reverse chronological order, showing the content and the date each was saved, with the newest first

---

# User Story 7: Archiving or Expiring Stale Memos

**As a** user whose note list grows over time  
**I want** to archive memos I no longer need, or have old memos expire automatically  
**So that** my saved notes stay focused on what is still relevant

## Acceptance Criteria

**Given** I have memos saved over several months, some of which are no longer relevant  
**When** I ask the bot "archive my lease notes" or "clear out notes older than three months"  
**Then** the bot archives or removes the matching memos, confirms how many were cleaned up, and does not touch any memos that did not match the criteria

---

## Technical Problems Solved

- **Routing ambiguity** — determining at inference time whether a user message expresses a task to track or a personal note to store, without requiring explicit command syntax
- **Unstructured note storage** — persisting free-form text with metadata (tags, timestamps, lifecycle status) alongside the existing task data model without conflating the two entity types
- **Full-text and tag-based retrieval** — indexing memo content and tags so keyword and tag queries return fast, exact matches across a potentially large personal note store
- **Semantic search** — enabling recall by topic or intent rather than exact keyword matching, so a user can find notes using natural language that differs from the original wording
- **Cross-domain data model** — extending the bot's persistence layer to support a second first-class entity (memo) with its own lifecycle independent of tasks and projects
- **Memo lifecycle management** — supporting manual and rule-based archival and expiry so the note store remains useful as it grows over time, without requiring manual housekeeping from the user
- **Context enrichment** — surfacing relevant past memos as background context during a conversation so the bot can give answers that feel aware of the user's personal history
