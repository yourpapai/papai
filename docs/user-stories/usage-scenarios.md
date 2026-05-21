<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — Usage Scenarios

A comprehensive reference of how the bot can be used, organized by domain. Covers everyday workflows, rare edge cases, and complex multi-step scenarios.

---

## 1. Onboarding & Configuration

**First-time setup**

- Admin sets `ADMIN_USER_ID` env var; on first run admin is auto-authorized
- Admin runs `/user add @alice` to authorize teammates
- Each user runs `/set llm_apikey sk-...`, `/set llm_baseurl https://...`, `/set main_model gpt-4o` to configure their LLM
- User runs `/set timezone Europe/Berlin` so reminders/briefings fire at correct local time
- User runs `/config` to verify all settings are correct
- User sets task provider credentials: `/set kaneo_apikey ...` or `/set youtrack_token ...`

**Ongoing access management**

- Admin runs `/users` to audit who has access
- Admin runs `/user remove @bob` when someone leaves the team
- Admin clears a leaver's history: `/clear 12345678`

---

## 2. Daily Task Management

**Morning routine**

- User asks: _"What tasks are assigned to me in the Backend project?"_
- User asks: _"Show me all high-priority tasks due this week"_
- User asks: _"What's the status of task PROJ-42?"_
- User configures daily briefing: _"Schedule my morning briefing at 8:30"_ → `configure_briefing` called with `time: "08:30"`
- User asks: _"Give me today's briefing"_ → `get_briefing` called on demand

**Creating and updating tasks**

- _"Create a task 'Fix login bug' in the Backend project, high priority, due Friday"_
- _"Mark task PROJ-42 as done"_
- _"Change the priority of PROJ-10 to critical"_
- _"Reassign PROJ-55 to @carol"_
- _"Update the description of PROJ-20 to include the new acceptance criteria: ..."_
- _"Move all my in-progress tasks back to todo"_

**Finding tasks**

- _"Search for tasks mentioning 'payment'"_
- _"List all tasks in the Mobile project"_
- _"Find all blocked tasks in the API project"_

**Bulk operations**

- _"Archive all completed tasks in the Q1 project"_
- _"Delete the duplicate task PROJ-99"_

---

## 3. Project Organization

**Project lifecycle**

- _"Create a new project called 'Q2 Roadmap'"_
- _"List all my projects"_
- _"Rename the 'Old API' project to 'Legacy API'"_
- _"Archive the 'Q1 Sprint' project, we're done with it"_

**Status (column/board) management**

- _"What statuses exist in the Mobile project?"_
- _"Add a 'In Review' status to the Backend project"_
- _"Rename the 'Doing' column to 'In Progress'"_
- _"Move the 'QA' column before 'Done'"_
- _"Delete the 'Cancelled' status from the API project"_

---

## 4. Collaboration via Comments

- _"Add a comment to PROJ-42: 'Blocked on design approval'"_
- _"Show all comments on PROJ-10"_
- _"Update my last comment on PROJ-42 to say '...' instead"_
- _"Remove my comment on PROJ-88"_

---

## 5. Labels & Categorization

**Label management**

- _"Create a label 'urgent' with red color #FF0000"_
- _"List all labels in the workspace"_
- _"Rename label 'bug' to 'defect'"_
- _"Delete the unused 'wontfix' label"_

**Assigning labels to tasks**

- _"Tag task PROJ-42 with 'security' and 'backend'"_
- _"Remove the 'draft' label from PROJ-30"_
- _"Find all tasks labelled 'regression'"_

---

## 6. Task Relations & Dependencies

- _"PROJ-42 blocks PROJ-55 — add that relation"_
- _"Mark PROJ-10 as a duplicate of PROJ-8"_
- _"Add a 'related' link between PROJ-20 and PROJ-21"_
- _"Show all tasks that PROJ-42 is blocking"_ → `get_task` shows relations
- _"Change the relation between PROJ-10 and PROJ-8 from 'related' to 'blocks'"_
- _"Remove the dependency between PROJ-42 and PROJ-55"_

---

## 7. Recurring Tasks

**Setting up recurring work**

- _"Every Monday at 9am, create a task 'Weekly sync notes' in the Admin project"_
- _"Create a recurring task 'Deploy to staging' every weekday at 6pm"_
- _"Set up a monthly task 'Update team roadmap' on the 1st of each month"_

**Managing recurring tasks**

- _"Show all my recurring tasks"_
- _"Pause the weekly deploy task for now"_
- _"Resume the standup task I paused last week"_
- _"Skip next Monday's occurrence of the sync task"_
- _"Change the recurring deploy task to fire at 7pm instead"_
- _"Delete the monthly roadmap task, we don't need it anymore"_

---

## 8. Reminders

**One-time reminders**

- _"Remind me tomorrow at 10am to follow up on PROJ-42"_
- _"Set a reminder for Friday 3pm: 'prepare the release notes'"_
- _"In 3 hours, remind me to review the PR"_

**Repeating reminders**

- _"Every Friday at 4pm remind me to fill in the timesheet"_
- _"Remind me every morning at 8am to check the error logs"_

**Managing reminders**

- _"List my active reminders"_
- _"Cancel the Friday timesheet reminder"_
- _"Snooze my 10am reminder by 2 hours"_
- _"Move tomorrow's reminder to next Monday at 9am"_
- _"Show reminders including ones already delivered"_

**Task-linked reminders**

- _"Remind me about PROJ-42 one day before its due date"_

---

## 9. Proactive Alerts

- _"Enable deadline alerts"_
- _"Turn on staleness alerts — notify me if a task hasn't moved in 5 days"_
- _"Disable all proactive alerts"_
- _"Check current alert configuration"_ → `configure_alerts` called with no changes

---

## 10. Persistent Behavioral Instructions

- _"From now on, always reply in French"_ → `save_instruction` stores preference
- _"Always set priority to medium when I don't specify one"_
- _"Always add me as assignee when I create tasks"_
- _"Show me my saved instructions"_ → `list_instructions`
- _"Delete instruction #3, I don't need that rule anymore"_ → `delete_instruction`

---

## 11. Conversation & Memory Management

- `/clear` — user resets their conversation when context is stale or confused
- `/context` — admin inspects what the bot currently knows about a user session (summary + entities)
- User asks follow-up questions across sessions: bot uses rolling summary + facts to maintain continuity
- _"What was the task I created last week about payments?"_ — answered from conversation history

---

## 12. Group Chat Workflows (Mattermost / Telegram groups)

- Bot is added to a project channel; team members mention `@papai` for queries
- Group admin runs `/set` and `/config` to configure group-level LLM and task provider settings
- Group admin runs `/group adduser @dave` to let a new joiner interact with the bot in the channel
- Group admin runs `/group deluser @dave` when someone leaves the channel
- `/group users` to see who in this channel can use the bot
- Team asks: _"@papai list all open tasks in the Backend project"_ — result visible to all members

---

## 13. Diagnostics & Troubleshooting

- `/config` — verify all keys are set before reporting an issue
- `/context` — admin exports full context for a user session to diagnose unexpected bot behavior
- Admin clears a user's history after a stuck or confused session: `/clear <user_id>`

---

## 14. Complex Multi-Step Workflows

### Sprint setup from scratch

User sets up an entire sprint in one conversation:

1. _"Create a project called 'Q2 Sprint'"_
2. _"Add columns: Backlog, In Progress, In Review, Done"_
3. _"Create labels: frontend, backend, bug, feature"_
4. _"Create tasks: [list of 8 tasks with priorities and assignees]"_
5. _"Set all backend tasks to the 'backend' label"_
6. _"Move PROJ-3 and PROJ-4 to In Progress"_

### Dependency chain modeling

- _"Create tasks for a release pipeline: 'Write tests' blocks 'Code review', 'Code review' blocks 'Merge to main', 'Merge to main' blocks 'Deploy to staging'"_
- LLM creates 4 tasks and wires up 3 blocking relations in sequence

### Project cloning / template expansion

- _"Create the same column structure (Backlog, Doing, Review, Done) in all my projects"_
- LLM calls `list_projects`, then `create_status` for each project × 4 columns

### Full project audit

- _"Go through every project and tell me which ones have tasks overdue by more than 2 weeks"_
- LLM calls `list_projects`, then `list_tasks` per project, then filters by due date and reports

---

## 15. On-Complete Recurring Tasks (Chain Automation)

### Waterfall task chain

- _"Every time I complete a 'Code review' task, automatically create a 'Deploy to staging' task in the Releases project with high priority"_
- `triggerType: "on_complete"` — each completion triggers next instance

### Iterative process

- _"After each 'Weekly report' task is done, create the next one immediately with the same description template"_
- Completion of one occurrence fires the next without waiting for a fixed schedule

### Pausing a chain mid-run

- User pauses a chain: _"Pause the on-complete deploy task for now, we're in a freeze"_
- When the current 'Code review' is marked done, no new deploy task is spawned
- User later: _"Resume the deploy chain"_

---

## 16. Catch-Up and Missed Delivery Scenarios

### Missed morning briefing

- User was offline when the 8:30 briefing fired
- On first message of the day the bot detects the missed briefing and delivers it prefixed with `(Catch-up — missed 08:30 briefing)`

### Recurring task catch-up on resume

- A recurring task was paused for 2 weeks then resumed with `catchUp: true`
- Bot creates all missed occurrences retroactively

### Bot restart recovery

- Bot process restarts; scheduler re-registers all cron jobs from DB state on startup
- No missed recurring tasks or reminders if downtime was shorter than the shortest interval

---

## 17. Proactive Alerts — Edge Cases

### Staleness alert tuning

- _"I want staleness alerts but only after 14 days, not 7"_ → `configure_alerts({ enabled: true, stalenessDays: 14 })`
- _"Reduce staleness threshold to 3 days for the sprint crunch"_ → update to 3

### Temporarily disabling alerts

- _"Turn off deadline alerts for this week, we're doing a soft freeze"_
- _"Re-enable alerts on Monday"_ → set a reminder to re-enable

### Alert + reminder combo for deadline pressure

- _"Enable deadline alerts AND remind me personally every day at 4pm if I have overdue tasks"_ — two separate mechanisms: `configure_alerts` + `set_reminder` with daily recurrence

---

## 18. Reminder Edge Cases

### Reminder snoozed multiple times

- Reminder fires at 9am; user says _"snooze 30 minutes"_ → `snooze_reminder` to 9:30
- At 9:30 fires again; _"snooze until after lunch, 1pm"_ → `snooze_reminder` to 13:00
- At 13:00 fires; user acts on it

### Snooze vs reschedule distinction

- **Snooze**: `snooze_reminder` — status becomes `snoozed`, semantically "I'll deal with it soon"
- **Reschedule**: `reschedule_reminder` — status returns to `pending`, semantically "move it to a completely different time"
- User: _"Don't snooze it — actually reschedule the Friday reminder to next Tuesday at 10am"_

### Repeating reminder with end condition

- _"Remind me every day at 9am to check the migration status"_ → recurring reminder
- When migration is done: _"Cancel the daily migration reminder"_

### Task-linked reminder expiry

- _"Remind me about PROJ-42 every morning until it's done"_
- After user marks PROJ-42 done, they cancel the linked recurring reminder: _"Cancel the reminder linked to PROJ-42"_

### Reviewing delivered reminders

- _"Show me all my reminders including ones already delivered"_ → `list_reminders({ includeDelivered: true })`
- Useful for auditing what was acted on

---

## 19. Persistent Instructions — Advanced Use

### Language preference

- _"Always reply in German"_ — saved as instruction, bot applies it every message

### Formatting preference

- _"Never use bullet points in your responses, only plain prose"_

### Default task values

- _"When I create a task without specifying a project, always use the 'Personal' project"_
- _"Always set assignee to me unless I say otherwise"_

### Workflow rules

- _"Never archive a task without asking me to confirm first"_

### Conflicting instruction resolution

- User adds _"Always reply in French"_ but already has _"Always reply in German"_
- _"Show my instructions"_ → lists both; _"Delete instruction #1"_ → removes the German one

### Per-group vs per-user instructions

- In a group channel, group admin saves: _"Always format task lists as a numbered list"_ — applies to all group interactions
- Individual user in DM saves their own instruction that overrides group defaults

---

## 20. Memory and Conversation Continuity

### Cross-session reference

- Session 1: User creates task PROJ-77 about a payment bug
- Session 2 (days later): _"What was the status of that payment bug I mentioned last week?"_ — bot recalls from rolling summary + facts

### Fact extraction from tool results

- After `create_task` succeeds, bot extracts and persists the task ID, title, and project into memory facts
- On next session: _"What was the ID of the auth task I created?"_ — answered from facts without re-querying the API

### Summary compression

- After a long conversation (many messages), bot runs background trimming, keeping recent messages verbatim and compressing older ones into a rolling summary
- User never notices, but context stays coherent across very long sessions

### Clearing stale context deliberately

- User starts a new sprint and wants a clean slate: `/clear`
- Bot forgets all previous task IDs, summaries, and facts — starts fresh
- Useful when switching between completely different projects

---

## 21. Multi-Provider and Configuration Scenarios

### Switching LLM provider mid-session

- User runs `/set llm_baseurl https://api.groq.com/openai/v1` and `/set main_model llama-3-70b`
- Next message uses the new model without restart

### Testing a cheaper model for simple queries

- `/set small_model gpt-4o-mini` — bot uses smaller model for low-complexity tool calls
- `/set main_model claude-opus-4-6` — larger model for complex reasoning

### YouTrack vs Kaneo capability differences

- On YouTrack: `archive_task`, `create_status`, `reorder_statuses` tools may not be exposed (capability-gated)
- User on YouTrack: _"Archive this task"_ → bot informs the feature is not available for the configured provider

### Reconfiguring provider mid-deployment

- Admin changes `TASK_PROVIDER=youtrack` in env and restarts
- Users run `/set youtrack_token ...` and `/set youtrack_url ...` to complete setup
- `/config` shows only YouTrack-relevant keys

---

## 22. Group Chat — Advanced Scenarios

### Shared team workspace query

- Multiple team members in one channel ask questions about the same project; all see responses
- Team lead: _"@papai list all unassigned tasks in the Backend project"_ — result visible to everyone

### Group-scoped config vs personal config

- Group admin sets LLM keys for the group via `/set` in the channel
- Individual members in DM have their own separate config
- The channel's config does not affect individual DMs

### Group briefing

- Group admin configures a daily 9am briefing for the team channel
- Every morning the briefing appears in the channel, visible to all members
- Individual members can also have their own private DM briefing at a different time

### Group member access control

- New contractor joins; group admin runs `/group adduser @contractor` in the channel
- Contractor can now interact with the bot in that channel
- After contract ends: `/group deluser @contractor`

---

## 23. Rarely Considered Operational Scenarios

### Config audit before handoff

- Admin runs `/context` to export the full conversation context for a user as a text file
- Useful when debugging a user's session or onboarding a replacement

### Clearing all sessions for a clean deployment

- Before a major DB migration: admin runs `/clear all` — clears every user's history
- Users restart with fresh contexts against the new schema

### Single-user deployment

- Bot deployed for one person only; `ADMIN_USER_ID` = that user
- User is both admin and only operator; `/user add` never needed

### Inspecting the bot's knowledge of a specific task

- _"What do you know about PROJ-42?"_ — bot answers from memory facts without calling the API
- _"Get fresh details on PROJ-42"_ — user explicitly wants a live `get_task` call to bypass cached knowledge

### Recovering from a corrupted LLM response

- LLM produces garbled output; user runs `/clear` to reset
- Then rephrases: _"Create a task titled 'Fix login'"_ — fresh call succeeds

### Rate limit / API key rotation

- User's LLM key is rate-limited; bot returns an error
- User runs `/set llm_apikey <new-key>` and retries without restarting the bot

### Timezone misconfiguration

- Reminders fire at wrong time; user checks `/config` → `timezone` shows `UTC`
- `/set timezone Asia/Tokyo` — all subsequent briefings and reminders use JST

### Briefing time already passed on first configuration

- User configures briefing at 08:30 but it's currently 10:00 same day
- Bot detects the missed briefing window and delivers a catch-up briefing immediately on next message

---

## 24. Bot Self-Management via LLM Tools

### Querying and modifying own behavior through natural language

- _"Do I have a daily briefing set up?"_ → `configure_briefing({})` with no `time` arg returns current status
- _"What recurring tasks do I have?"_ → `list_recurring_tasks`
- _"Am I signed up for deadline alerts?"_ → `configure_alerts` status query
- _"What custom instructions have you saved?"_ → `list_instructions`

### Full teardown of automation

- _"Remove all my recurring tasks, reminders, and briefing — I'm going on vacation"_
- LLM calls: `list_recurring_tasks` → pause each; `list_reminders` → cancel each; `configure_briefing({ time: null })` to disable briefing; `configure_alerts({ enabled: false })`

### Restoring automation after vacation

- _"I'm back — re-enable everything you paused before my vacation"_
- Bot recalls from conversation summary which items were paused and restores them

---

## 25. Provider-Specific Features

### Kaneo Auto-Provisioning

- Admin runs `/user add @alice` — bot automatically creates a Kaneo account with generated email/password
- New user receives DM: "📧 Email: alice@example.com\n🔑 Password: abc123...\n🌐 https://kaneo.example.com"
- Auto-provisioning fails gracefully with manual configuration fallback via `/set kaneo_apikey`

### YouTrack Capability Differences

- YouTrack users cannot archive tasks — bot responds: "Archive is not available for YouTrack provider"
- YouTrack users cannot create or reorder statuses — bot explains capability limitation
- YouTrack has built-in workflow states, so status management tools are gated

---

## 26. Security & Access Control

### Command Context Restrictions

**DM-only commands:**

- `/user add|remove <id>` — Admin manages users (not available in groups)
- `/users` — List authorized users
- `/context` — Export memory context as file (admin only)

**Group-only commands:**

- `/group adduser|deluser|users` — Manage group membership

**Admin-only commands:**

- `/clear all` — Clear all users' history
- `/clear <user_id>` — Clear specific user's history
- `/context` — Export diagnostic context

### Authorization Failure Scenarios

- Unauthorized user tries `/user add` → "Only the admin can manage users"
- Non-admin tries `/clear all` → "Only the admin can clear other users' history"
- Regular user tries `/context` → "Only the admin can use this command"
- Non-group-admin tries `/group adduser` in group → "Only group admins can add users"
- User tries `/user add` in group → "This command is only available in direct messages"

### API Key Rotation & Recovery

- User's LLM key rate-limited → error returned, user runs `/set llm_apikey <new-key>` without restart
- Task provider token expired → bot returns auth error, user updates via `/set`
- Invalid API key → clear error message with provider name

---

## 27. Automation Edge Cases

### Version Announcements

- Bot detects new version on startup → announces to all users with changelog excerpt
- User receives: "🚀 papai v1.2.0 is now running!\n\nChanges:\n- Added recurring tasks\n- Fixed search pagination"
- Announcements tracked per-user to avoid spam on restarts

### Briefing Auto-Catchup

- User configured briefing for 08:30 but was offline
- First message of the day triggers detection → bot prefixes: "(Catch-up — missed 08:30 briefing)"
- Briefing content delivered immediately with catch-up notice
- User asks "Give me today's briefing" → on-demand generation

### Daylight Saving Time Transitions

- Briefing scheduled for 08:30 Europe/Berlin
- DST starts: briefing automatically shifts to 08:30 CEST (was 08:30 CET)
- DST ends: briefing shifts back, no double or missed briefings
- Reminders scheduled with timezone respect DST changes

### Bot Restart Recovery

- Scheduler re-registers all cron jobs from database on startup
- Recurring tasks resumed where left off
- Briefing jobs re-registered for all configured users
- Reminders continue from persisted state

---

## 28. Context Isolation & Multi-Session

### Storage Context Isolation

- Each DM has isolated: conversation history, facts, summary, config
- Each Group has isolated: conversation history, facts, summary, config
- Group context does not leak to DM context and vice versa
- User in Group A and Group B has separate histories per group

### Concurrent Sessions

- Same user opens Telegram on phone and desktop
- Both sessions share same conversation history (same contextId)
- History syncs via database (SQLite)
- Messages from either device appear in unified history

### Cross-Device Continuity

- User creates task on phone: "Create task 'Fix login'"
- Later on desktop: "What was the task I created about login?"
- Bot recalls from shared facts and summary across devices

---

## 29. Help System & Empty States

### Context-Aware Help

**DM regular user sees:**

- Basic commands: /help, /set, /config, /clear
- "Any other message is sent to the AI assistant"

**DM admin sees additional:**

- /context, /user add/remove, /users, /clear <user_id>, /clear all

**Group regular member sees:**

- /help, /group users
- "Mention me with @botname for natural language queries"

**Group admin sees additional:**

- /group adduser, /group deluser
- /set, /config, /clear

### Empty State Handling

**No tasks found:**

- "No tasks match your search for 'payment'"
- "No tasks in the Backend project"
- "You have no tasks assigned to you"

**No reminders:**

- "No active reminders"

**No projects:**

- "No projects found in workspace"

**No history:**

- "Conversation history and memory cleared" (after /clear)

---

## 30. Model Selection & Performance

### Dual Model Configuration

- `/set main_model gpt-4o` — Used for complex reasoning, multi-step workflows
- `/set small_model gpt-4o-mini` — Used for simple tool calls
- Bot automatically selects based on query complexity

### Model Fallback Scenarios

- Complex query with small_model configured → main_model used
- Simple status update → small_model for speed/cost
- User can force model via explicit request (e.g., "Use your best model for this")

---

## 31. Config Key Filtering

### Provider-Specific Config Display

**When TASK_PROVIDER=kaneo:**

- `/config` shows: llm_apikey, llm_baseurl, main_model, small_model, timezone, kaneo_apikey

**When TASK_PROVIDER=youtrack:**

- `/config` shows: llm_apikey, llm_baseurl, main_model, small_model, timezone, youtrack_token, youtrack_url
- Kaneo-specific keys hidden

**Common keys always shown:**

- llm_apikey, llm_baseurl, main_model, small_model, timezone

---

## 32. Comment Ownership & Permissions

### Comment Access Control

- User can only update their own comments
- User can only remove their own comments
- Attempting to update another user's comment → "You can only update your own comments"
- Get comments shows all comments (no ownership restriction for viewing)

### Comment Lifecycle

1. Alice adds comment to PROJ-42: "Blocked on design"
2. Alice updates comment: "Blocked on design approval"
3. Bob tries to update Alice's comment → denied
4. Alice removes her comment
5. Bob can add his own comment

---

## 33. Bulk Operations & Pagination

### Bulk Task Operations

- _"Archive all completed tasks in the Q1 project"_
- _"Delete all tasks with label 'duplicate'"_
- _"Move all in-progress tasks to Done"_
- LLM iterates through search results and applies operation

### Large Result Sets

- Search returns 100+ tasks → bot paginates or summarizes
- List tasks with many items → shows first N with "... and X more"
- User can request: "Show me the rest of the tasks"

---

## 34. Error Recovery & User Guidance

### Invalid Input Handling

- Invalid date format: "Please use YYYY-MM-DD format"
- Invalid project ID: "Project '99999' not found"
- Invalid status transition: "Cannot move task to 'Done' from 'Archived'"
- Missing required field: "Title is required to create a task"

### Recovery Suggestions

- Project not found: "Did you mean 'Backend' or 'Backend-API'? Available projects: ..."
- Status not found: "Available statuses: Backlog, In Progress, Done"
- Invalid cron expression: "Use format: minute hour day month weekday (e.g., '0 9 \* \* 1')"

### API Unavailability

- Task provider API down → "Unable to connect to Kaneo. Please try again later."
- LLM API timeout → "The AI service is slow right now. Retrying..."
- Rate limited → "Too many requests. Please wait a moment."

---

## 35. Timezone & Scheduling Edge Cases

### Timezone Misconfiguration

- User sets briefing for 08:30 but timezone is UTC
- User actually in Europe/Berlin (09:30 local)
- User realizes mistake, runs `/set timezone Europe/Berlin`
- Next briefing adjusts automatically

### Scheduling Conflicts

- Two reminders set for same time → both fire
- Briefing and reminder at same time → briefing first, then reminder
- Recurring task and manual task creation at same time → both created

### Past Time Handling

- User tries to set reminder for "yesterday" → "Please provide a future time"
- User tries to schedule briefing for "23:00" when it's 23:30 → "Briefing scheduled for tomorrow"
- Recurring task with past start date → creates from now forward

---

## 36. Data Export & Diagnostics

### Context Export

- Admin runs `/context` → receives context.txt file with:
  - Full conversation history (numbered messages)
  - Rolling summary
  - Known entities/facts with URLs and last seen dates

### Debug Information

- Structured logging (pino) captures all operations
- Each log includes: userId, context, action, result
- No sensitive data (API keys, tokens) logged
- Errors include stack traces for debugging
