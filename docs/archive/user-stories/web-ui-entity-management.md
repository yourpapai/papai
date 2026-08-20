<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Web UI for Entity Management

## Problem Statement

In complex scenarios — when the bot struggles to interpret precise edits, when users need to fine-tune automation rules, or when bulk operations are required — managing stored entities (recurring tasks, scheduled prompts, alerts, memos, instructions, memory) through conversational chat is inefficient and error-prone. A web interface provides direct, form-based access to all user-managed entities without triggering the bot.

---

## User Story 1: View and Edit Recurring Task Templates

**As a** bot user
**I want** to view and edit my recurring task templates through a web interface
**So that** I can fine-tune schedules, priorities, and task details without crafting precise chat messages and waiting for the bot to interpret them correctly

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Recurring Tasks section
**Then** I see a list of all my recurring task templates with their schedule, status, and next run time

**Given** I am viewing my recurring task templates
**When** I click on a specific template
**Then** I see the full details including title, description, schedule expression, timezone, priority, project, labels, and whether it is enabled

**Given** I am editing a recurring task template
**When** I change the schedule or any task field and save
**Then** the template is updated immediately and the next run time recalculates accordingly

**Given** I am viewing my recurring task templates
**When** I toggle a template's enabled status
**Then** the template is activated or paused without affecting previously created tasks

**Given** I have a recurring task template
**When** I view its occurrence history
**Then** I see a log of all tasks that were created from this template with their creation dates

---

## User Story 2: Manage Scheduled Prompts

**As a** bot user
**I want** to view, edit, and cancel my scheduled prompts through a web interface
**So that** I can adjust timing and instructions for future automated actions without relying on the bot to understand my corrections

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Scheduled Prompts section
**Then** I see all my prompts organized by status: active, completed, and cancelled

**Given** I am viewing an active scheduled prompt
**When** I edit its fire time or recurring schedule
**Then** the prompt reschedules to the new time without creating a duplicate

**Given** I am viewing an active scheduled prompt
**When** I edit the prompt instruction text
**Then** the updated instruction is used the next time the prompt fires

**Given** I am viewing an active scheduled prompt
**When** I cancel it
**Then** the prompt is marked as cancelled and will not fire, but remains visible in history

**Given** I am viewing my completed or cancelled prompts
**When** I review the execution metadata
**Then** I see when each prompt last ran and any relevant execution details

---

## User Story 3: Configure and Monitor Alert Rules

**As a** bot user
**I want** to create, edit, and monitor my alert rules through a web interface
**So that** I can precisely define conditions and cooldowns for task-change notifications without struggling to express complex logic through chat

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Alerts section
**Then** I see all my alert rules with their condition, status, cooldown, and last triggered time

**Given** I am creating a new alert rule
**When** I define a condition by selecting a task field, an operator, and a value
**Then** the alert is created with a clear summary of what will trigger it

**Given** I am editing an existing alert
**When** I change the cooldown period
**Then** the new cooldown applies to future triggers without resetting the last-triggered timestamp

**Given** I am viewing an active alert
**When** I cancel it
**Then** the alert stops monitoring but remains visible in my alert history

**Given** an alert has been triggered recently
**When** I view the alert details
**Then** I see when it last fired and the prompt instruction that was executed

---

## User Story 4: Manage Personal Memos and Links

**As a** bot user
**I want** to browse, edit, and organize my memos through a web interface
**So that** I can manage my notes, add tags, and link memos to tasks or other memos more efficiently than through conversational commands

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Memos section
**Then** I see my active memos with their summaries, tags, and creation dates

**Given** I am viewing my memos
**When** I filter by tag or search by keyword
**Then** only matching memos are displayed

**Given** I am editing a memo
**When** I update its content, tags, or summary
**Then** the changes are saved immediately and reflected across the system

**Given** I am viewing a memo
**When** I link it to another memo or a task
**Then** the relationship is created and visible from both the memo and the linked entity

**Given** I am viewing my memos
**When** I archive a memo
**Then** it moves to the archived view and no longer appears in active memos

---

## User Story 5: Edit Custom Instructions for the Bot

**As a** bot user
**I want** to view and manage my custom instructions through a web interface
**So that** I can fine-tune how the bot behaves for me without losing track of what instructions I have already set

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Instructions section
**Then** I see all my custom instructions listed with their text and creation date

**Given** I am adding a new instruction
**When** the text is too similar to an existing instruction
**Then** I see a warning about the duplicate before confirming

**Given** I am adding a new instruction
**When** I have already reached the maximum number of instructions
**Then** I see a clear message about the limit and which instructions I could remove

**Given** I am viewing my instructions
**When** I delete one
**Then** it is removed immediately and the bot stops using it in future conversations

**Given** I am editing an existing instruction
**When** I update its text
**Then** I see a character count indicator and the change is reflected in the bot's next response

---

## User Story 6: Review and Manage Conversation Memory

**As a** bot user
**I want** to view the facts and summaries the bot has learned about my work through a web interface
**So that** I can correct inaccurate information, remove outdated facts, and understand what context the bot uses when responding to me

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Memory section
**Then** I see all extracted facts (projects, tasks, identifiers) with their titles and last-seen dates

**Given** I am viewing my memory facts
**When** I delete a fact that is outdated or incorrect
**Then** the bot no longer references that fact in future conversations

**Given** I am viewing my conversation summary
**When** I read the summary text
**Then** I understand what the bot "remembers" about our past interactions

**Given** I am viewing my conversation summary
**When** I clear it
**Then** the bot starts building a fresh summary from subsequent conversations

**Given** I am viewing my conversation history
**When** I clear all messages
**Then** the bot treats the next interaction as a fresh conversation without prior context

---

## User Story 7: Manage User Settings and Configuration

**As a** bot user
**I want** to view and update all my configuration settings through a web interface
**So that** I can change my LLM provider, API keys, model preferences, and timezone without memorizing command syntax

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I navigate to the Settings section
**Then** I see all my configuration keys with their current values, with sensitive values masked

**Given** I am editing a setting
**When** I update a value and save
**Then** the new value takes effect immediately for my next bot interaction

**Given** I am viewing my settings
**When** I look at sensitive fields like API keys
**Then** the values are masked by default with an option to temporarily reveal them

**Given** I am viewing my settings
**When** I see a setting I have not configured
**Then** I see a clear placeholder or default value indicator so I know what is missing

---

## User Story 8: Admin User and Group Management

**As an** administrator
**I want** to manage authorized users and group memberships through a web interface
**So that** I can onboard and offboard users, manage group access, and review authorization status without issuing individual chat commands

### Acceptance Criteria

**Given** I am logged into the web interface as an administrator
**When** I navigate to the Users section
**Then** I see all authorized users with their usernames, platform IDs, and when they were added

**Given** I am managing users
**When** I add a new user by their platform ID or username
**Then** the user is authorized and can start using the bot immediately

**Given** I am managing users
**When** I remove a user
**Then** their authorization is revoked and they can no longer interact with the bot

**Given** I am viewing group management
**When** I select a group
**Then** I see all members and can add or remove users from that group

**Given** I am reviewing the user list
**When** I view a specific user's details
**Then** I see their configuration status, whether they have completed setup, and their active recurring tasks and alerts count

---

## User Story 9: Web Authentication and Session Security

**As a** bot user
**I want** to securely authenticate to the web interface using my existing bot identity
**So that** I can access only my own data without creating a separate account or password

### Acceptance Criteria

**Given** I am an authorized bot user
**When** I open the web interface
**Then** I can authenticate using a method linked to my existing chat platform identity

**Given** I am authenticated
**When** I navigate the web interface
**Then** I can only see and modify my own entities and settings

**Given** I am an administrator
**When** I authenticate
**Then** I see additional admin sections for user and group management

**Given** my session has been idle for an extended period
**When** I attempt to perform an action
**Then** I am prompted to re-authenticate before proceeding

**Given** I am authenticated
**When** I log out
**Then** my session is invalidated and I must authenticate again to access the interface

---

## User Story 10: Dashboard Overview of All Entities

**As a** bot user
**I want** to see a dashboard summarizing all my active entities when I open the web interface
**So that** I can quickly assess my automation setup, spot issues, and navigate to what needs attention

### Acceptance Criteria

**Given** I am logged into the web interface
**When** I land on the dashboard
**Then** I see a summary showing counts of my active recurring tasks, scheduled prompts, alerts, memos, and custom instructions

**Given** I am viewing the dashboard
**When** a scheduled prompt is about to fire within the next hour
**Then** I see it highlighted as upcoming in the dashboard

**Given** I am viewing the dashboard
**When** a recurring task template has failed or is paused
**Then** I see a warning indicator next to the recurring tasks summary

**Given** I am viewing the dashboard
**When** I click on any entity count or summary card
**Then** I am navigated directly to the detailed management view for that entity type

---

## Technical Problems Solved

- **Complex entity configuration**: Recurring task schedules, alert conditions, and cron expressions are difficult to specify precisely through natural language chat. A form-based UI eliminates interpretation errors.
- **Visibility and auditability**: Users currently have no way to see all their automation rules, memos, and memory facts at a glance. The dashboard provides a single pane of glass.
- **Error recovery**: When the bot misinterprets an edit command or struggles with a complex update, users can directly correct the stored data through the web interface.
- **Bulk operations**: Managing multiple entities (e.g., disabling several recurring tasks or cleaning up old memos) is tedious one-at-a-time via chat but straightforward in a list-based UI.
- **Sensitive data handling**: API keys and tokens can be managed through proper form inputs with masking, rather than being sent as plain text in chat messages.
- **Authentication boundary**: Introduces a web authentication layer that maps to existing platform identities, avoiding a separate credential system while maintaining user-scoped data isolation.
