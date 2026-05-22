<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Group Chat Support — User Stories

---

# User Story 1: Using the Bot in a Group Chat via Mention

**As a** registered group member  
**I want** to ask the bot questions by mentioning it in a group chat  
**So that** I can get AI assistance without switching to a private conversation

## Acceptance Criteria

**Given** I have been added to the group by a group admin  
**When** I send a message in the group that mentions the bot followed by my question  
**Then** the bot responds directly to my question in the group chat

**Given** I am a registered group member  
**When** I send a message in the group without mentioning the bot  
**Then** the bot does not respond, keeping group chat noise minimal

---

# User Story 2: Unauthorized User Receives a Clear Rejection

**As an** unauthorized user in a group chat  
**I want** to receive a clear explanation when the bot rejects my mention  
**So that** I know what to do to gain access

## Acceptance Criteria

**Given** I am not a registered group member  
**When** I mention the bot in the group chat  
**Then** the bot replies telling me I am not authorized and explains how to request access from a group admin

**Given** I am not a registered group member  
**When** I send a message without mentioning the bot  
**Then** the bot does not respond at all

---

# User Story 3: Group Admin Adds a User to the Group

**As a** group admin  
**I want** to add a user to the bot's authorized member list for my group  
**So that** they can start interacting with the bot in the group chat

## Acceptance Criteria

**Given** I am a group admin  
**When** I run the add user command with a valid username  
**Then** the bot confirms the user has been added and they can now use the bot in this group

**Given** I am a group admin  
**When** I attempt to add a user who is already a member  
**Then** the bot informs me that the user is already registered in this group

**Given** I am a regular group member (not an admin)  
**When** I attempt to add a user  
**Then** the bot tells me that only group admins can manage group members

---

# User Story 4: Group Admin Removes a User from the Group

**As a** group admin  
**I want** to remove a user from the bot's authorized member list  
**So that** I can revoke their access when they leave the team or should no longer use the bot

## Acceptance Criteria

**Given** I am a group admin and a user is currently a registered group member  
**When** I run the remove user command for that user  
**Then** the bot confirms the removal and the user can no longer interact with the bot in this group

**Given** I am a group admin  
**When** I attempt to remove a user who is not currently a member  
**Then** the bot informs me that the user was not found in this group's member list

**Given** I am a regular group member (not an admin)  
**When** I attempt to remove a user  
**Then** the bot tells me that only group admins can manage group members

---

# User Story 5: Any Group Member Can View the Authorized Member List

**As a** group member  
**I want** to see who is authorized to use the bot in this group  
**So that** I know which teammates can collaborate with the bot

## Acceptance Criteria

**Given** I am an authorized group member  
**When** I run the list group users command  
**Then** the bot displays all currently authorized members for this group, including who added them and when

**Given** I am a group admin  
**When** I run the list group users command in an empty group (no members yet)  
**Then** the bot informs me that no members have been added yet

**Given** I am not an authorized group member  
**When** I attempt to list group users  
**Then** the bot does not respond or denies access

---

# User Story 6: Shared Conversation History Across Group Members

**As a** group member  
**I want** the bot to maintain a shared conversation history for the whole group  
**So that** all members work from the same context and can build on each other's AI interactions

## Acceptance Criteria

**Given** one group member has had a conversation with the bot about a topic  
**When** a different group member mentions the bot and asks a follow-up question  
**Then** the bot responds with awareness of the prior conversation in that group

**Given** two separate groups both use the bot  
**When** a member of one group asks a question  
**Then** the bot only considers that group's own conversation history, never the other group's

---

# User Story 7: Group Member Clears the Group Conversation History

**As a** group admin  
**I want** to clear the shared conversation history for my group  
**So that** the bot starts fresh without previous context when the team begins a new project or topic

## Acceptance Criteria

**Given** I am a group admin with an existing conversation history  
**When** I run the clear command in the group chat  
**Then** the bot confirms the history has been cleared and subsequent questions receive no context from previous conversations

**Given** I am a regular group member (not an admin)  
**When** I attempt to run the clear command  
**Then** the bot informs me that only group admins can clear the group conversation history

---

# User Story 8: Group Admin Configures Bot Settings for the Group

**As a** group admin  
**I want** to set and view the bot's configuration for my group  
**So that** I can tailor the bot's behavior for our team's specific needs

## Acceptance Criteria

**Given** I am a group admin  
**When** I run a set configuration command in the group chat  
**Then** the bot updates the setting, confirms the change, and applies it to all future interactions in this group

**Given** I am a group admin  
**When** I run the config command to view current settings  
**Then** the bot displays all configuration values currently set for this group

**Given** I am a regular group member (not an admin)  
**When** I attempt to change a bot configuration setting  
**Then** the bot informs me that only group admins can change group settings

---

# User Story 9: Group Configuration Is Independent Across Groups

**As a** group admin  
**I want** the bot's configuration to be isolated per group  
**So that** different teams using the same bot do not interfere with each other's settings

## Acceptance Criteria

**Given** two groups each have their own bot configuration  
**When** a group admin in one group changes a setting  
**Then** the other group's configuration remains unchanged

**Given** a user belongs to two different groups  
**When** they interact with the bot in one group  
**Then** the bot applies only that group's configuration, not the other group's

---

# User Story 10: Group Commands Are Unavailable in Direct Messages

**As a** bot user  
**I want** group management commands to only work inside group chats  
**So that** there is no confusion about context and commands behave predictably

## Acceptance Criteria

**Given** I am in a direct message conversation with the bot  
**When** I attempt to run a group management command  
**Then** the bot informs me that group commands can only be used inside group chats

---

# User Story 11: User Management Commands Are Unavailable in Group Chats

**As a** bot admin  
**I want** user management commands (add/remove bot users) to only work in direct messages  
**So that** global bot user administration is kept separate from group membership management

## Acceptance Criteria

**Given** I am in a group chat  
**When** I attempt to run a global user management command  
**Then** the bot informs me that this command is not available in group chats

---

# User Story 12: Bot Responds to Natural Language Only When Mentioned in a Group

**As a** group member  
**I want** the bot to only reply to my conversational messages when I explicitly mention it  
**So that** the bot does not interrupt general team conversations not directed at it

## Acceptance Criteria

**Given** I am a registered group member  
**When** I send a message in the group that does not mention the bot  
**Then** the bot silently ignores the message

**Given** I am a registered group member  
**When** I send a message that starts with a slash command (not a natural language query)  
**Then** the bot processes the command even without a mention

---

# User Story 13: Bot Runs Commands in a Group Without Requiring a Mention

**As a** group member  
**I want** to run bot commands in a group chat without needing to mention the bot  
**So that** using commands in a group feels as natural as in a direct message

## Acceptance Criteria

**Given** I am a group admin  
**When** I type a slash command in the group chat without mentioning the bot  
**Then** the bot processes the command and replies as expected

**Given** I am a regular group member  
**When** I type a slash command I am authorized to run without mentioning the bot  
**Then** the bot processes the command and replies correctly

---

# User Story 14: Group Member Access Is Revoked Immediately

**As a** group admin  
**I want** a removed user's access to be revoked instantly  
**So that** there is no window during which a removed user can still use the bot

## Acceptance Criteria

**Given** a user is currently an authorized group member  
**When** a group admin removes them  
**Then** the very next message or mention from that user in the group receives no response from the bot

**Given** a user's access has been revoked  
**When** they mention the bot  
**Then** the bot responds with the standard unauthorized message explaining how to request re-access

---

# User Story 15: Bot Help Command Works in Group Chats

**As a** group member  
**I want** to run the help command in a group chat  
**So that** I and my teammates can quickly discover what the bot can do without leaving the group

## Acceptance Criteria

**Given** I am an authorized group member  
**When** I run the help command in the group  
**Then** the bot replies with a list of commands and capabilities relevant to the group context

**Given** the help response is shown in a group  
**When** the content is displayed  
**Then** it does not include commands that are only applicable to direct messages, avoiding confusion

---

# User Story 16: Bot Admin Retains Full Access in Group Chats

**As a** bot admin  
**I want** to retain full access to all bot features in every group  
**So that** I can manage and troubleshoot any group without needing to be added as a member first

## Acceptance Criteria

**Given** I am the bot admin and I am not listed as a group member  
**When** I send any message or command in a group chat  
**Then** the bot responds as if I were an authorized group admin

**Given** I am the bot admin  
**When** I run configuration or management commands in a group  
**Then** the bot applies changes and confirms them without requiring group admin status

---
