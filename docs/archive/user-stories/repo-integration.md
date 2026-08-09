<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Repository Integration (GitHub/GitLab) — User Stories

---

# User Story 1: Connect a Code Repository to a Task Tracker Project

**As a** bot user  
**I want** to link a code repository (GitHub or GitLab) to one of my task tracker projects  
**So that** the bot knows which repository corresponds to which project and can automate cross-platform workflows

## Acceptance Criteria

**Given** I am an authorized bot user with a configured task tracker  
**When** I tell the bot to connect a specific repository to a specific project  
**Then** the bot saves the repository-to-project mapping in my configuration  
**And** confirms the connection was established successfully

**Given** I have already connected a repository to a project  
**When** I ask the bot to show my repository connections  
**Then** the bot lists all linked repositories with their associated projects

**Given** I have a connected repository  
**When** I tell the bot to disconnect that repository from the project  
**Then** the mapping is removed and no further cross-platform automation occurs for that pair

---

# User Story 2: Configure Repository Provider Credentials

**As a** bot user  
**I want** to provide my GitHub or GitLab access token through the bot's configuration system  
**So that** the bot can authenticate and perform actions on my behalf in the code repository

## Acceptance Criteria

**Given** I am an authorized bot user  
**When** I use the set command to configure my GitHub or GitLab token  
**Then** the bot securely stores the token as part of my per-user configuration  
**And** the token value is masked when I view my configuration

**Given** I have not yet configured a repository provider token  
**When** I try to use any repository-related feature  
**Then** the bot tells me which configuration keys are missing and how to set them

**Given** I have configured an invalid or expired token  
**When** the bot tries to use it for a repository operation  
**Then** the bot informs me that authentication failed and suggests I update my token

---

# User Story 3: Create an Issue in the Linked Repository from a Task

**As a** bot user  
**I want** to ask the bot to create a GitHub/GitLab issue from an existing task in my tracker  
**So that** developers working in the repository have a corresponding issue to reference in their code changes

## Acceptance Criteria

**Given** I have a task in my task tracker and a linked repository  
**When** I ask the bot to create an issue from that task  
**Then** the bot creates an issue in the linked repository with the task title and description  
**And** the issue body includes a reference link back to the original task  
**And** the task in the tracker is updated with a reference to the newly created issue

**Given** a task already has a linked issue  
**When** I ask the bot to create another issue from the same task  
**Then** the bot warns me that an issue already exists and shows the link  
**And** asks for confirmation before creating a duplicate

---

# User Story 4: Create a Task from a Repository Issue

**As a** bot user  
**I want** to ask the bot to create a task in my tracker from an existing GitHub/GitLab issue  
**So that** reported issues in the code repository are tracked alongside my other project work

## Acceptance Criteria

**Given** I have a linked repository with open issues  
**When** I ask the bot to create a task from a specific issue number  
**Then** the bot creates a task in the linked project with the issue title, description, and labels  
**And** the task includes a reference link to the original issue  
**And** the issue in the repository is updated with a comment linking to the new task

**Given** an issue already has a linked task  
**When** I ask the bot to create a task from that same issue  
**Then** the bot informs me a linked task already exists and provides its details

---

# User Story 5: Automatically Update Task Status When a Pull Request Is Merged

**As a** bot user  
**I want** the task status to automatically update when a pull request that references a task is merged  
**So that** I don't have to manually close tasks after the related code change is deployed

## Acceptance Criteria

**Given** a pull request references a task identifier in its title or description  
**And** the repository is linked to a task tracker project  
**When** the pull request is merged  
**Then** the bot moves the referenced task to the configured "done" or final status  
**And** adds a comment to the task noting which pull request was merged and when

**Given** a pull request references multiple tasks  
**When** the pull request is merged  
**Then** all referenced tasks are updated to the final status  
**And** each task receives a comment about the merged pull request

**Given** a pull request is closed without merging  
**When** the bot detects the closure  
**Then** the task status is not changed  
**And** a comment is added to the task noting the pull request was closed without merging

---

# User Story 6: Move a Task to "In Progress" When a Branch or Pull Request Is Opened

**As a** bot user  
**I want** my task to automatically move to "in progress" when someone creates a branch or opens a pull request referencing it  
**So that** my task board reflects real development activity without manual updates

## Acceptance Criteria

**Given** a developer opens a pull request whose branch name or title contains a task identifier  
**And** the repository is linked to a task tracker project  
**When** the bot detects the new pull request  
**Then** the bot updates the referenced task status to the configured "in progress" status  
**And** adds a comment to the task with a link to the pull request

**Given** the task is already in "in progress" or a later status  
**When** a new pull request referencing it is opened  
**Then** the task status remains unchanged  
**And** a comment is still added linking the new pull request

---

# User Story 7: List Open Pull Requests Related to a Task

**As a** bot user  
**I want** to ask the bot to show me all open pull requests related to a specific task  
**So that** I can quickly see the development progress for that piece of work

## Acceptance Criteria

**Given** a task in my tracker has been referenced by one or more pull requests  
**When** I ask the bot for pull requests related to that task  
**Then** the bot lists all open pull requests with their title, status, author, and link  
**And** shows whether each pull request has approvals, requested changes, or is ready to merge

**Given** a task has no related pull requests  
**When** I ask the bot for its pull requests  
**Then** the bot tells me no pull requests are currently linked to that task

---

# User Story 8: Ask the Bot to Create a Pull Request from a Task Description

**As a** bot user  
**I want** to ask the bot to open a draft pull request with a description generated from a task  
**So that** I can quickly start the review process with proper context already filled in

## Acceptance Criteria

**Given** I have a task with a title and description in my tracker  
**And** there is a branch in the linked repository ready for review  
**When** I ask the bot to create a pull request for that task from a specific branch  
**Then** the bot creates a draft pull request with the task title as the PR title  
**And** the PR description includes the task description and a link back to the task  
**And** the task is updated with a reference to the new pull request

**Given** the specified branch does not exist  
**When** I ask the bot to create a pull request from it  
**Then** the bot informs me the branch was not found and lists available branches

---

# User Story 9: Synchronize Labels Between Task Tracker and Repository

**As a** bot user  
**I want** the bot to keep labels in sync between my task tracker and the linked repository  
**So that** issues and tasks share a consistent labeling system without manual duplication

## Acceptance Criteria

**Given** I have labels defined in my task tracker project  
**When** I ask the bot to sync labels to the linked repository  
**Then** the bot creates any missing labels in the repository matching the task tracker labels  
**And** reports which labels were created and which already existed

**Given** an issue in the repository has labels applied  
**When** I ask the bot to create a task from that issue  
**Then** the corresponding task in the tracker receives matching labels  
**And** if a label doesn't exist in the tracker, the bot creates it automatically

---

# User Story 10: View a Combined Dashboard of Tasks and Related Code Activity

**As a** bot user  
**I want** to ask the bot for a summary of a project that includes both task status and recent code activity  
**So that** I get a single unified view of project progress across both platforms

## Acceptance Criteria

**Given** I have a task tracker project linked to a repository  
**When** I ask the bot for a project summary  
**Then** the bot shows the count of tasks by status alongside recent repository activity  
**And** highlights tasks that have open pull requests awaiting review  
**And** lists tasks that were recently completed via merged pull requests

**Given** a project has no linked repository  
**When** I ask for a project summary  
**Then** the bot shows only the task tracker information  
**And** suggests connecting a repository for richer project visibility

---

# User Story 11: Receive Notifications When Repository Events Affect My Tasks

**As a** bot user  
**I want** the bot to proactively notify me when a pull request related to one of my tasks receives a review, is approved, or requires changes  
**So that** I stay informed about the development progress of my work without checking the repository manually

## Acceptance Criteria

**Given** I have tasks assigned to me that are referenced by open pull requests  
**When** a reviewer approves the pull request  
**Then** the bot sends me a message with the approval details and a link to the PR

**Given** a pull request referencing my task receives a "changes requested" review  
**When** the bot detects this event  
**Then** it sends me a notification describing the requested changes with a link to the review

**Given** I don't want to receive repository notifications  
**When** I disable repository notifications through the bot's settings  
**Then** the bot stops sending me code activity messages while still updating task statuses

---

# User Story 12: Search for Issues in the Linked Repository

**As a** bot user  
**I want** to ask the bot to search for issues in the linked repository by keyword  
**So that** I can find existing issues before creating duplicate tasks or new issues

## Acceptance Criteria

**Given** I have a linked repository  
**When** I ask the bot to search for issues matching a keyword  
**Then** the bot returns a list of matching issues with their title, status, labels, and link  
**And** indicates which issues already have corresponding tasks in the tracker

**Given** no issues match my search  
**When** the bot returns the results  
**Then** it tells me no matching issues were found and offers to create a new issue or task
