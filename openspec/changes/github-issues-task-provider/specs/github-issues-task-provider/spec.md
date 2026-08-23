## Purpose

Exposes a GitHub repository's issues as a papai task tracker: one task instance is bound to one repository, and users create, read, update, list, and search its tasks through the existing chat task tools with credentials kept encrypted and errors surfaced in normalized form.

## ADDED Requirements

### Requirement: GitHub task-tracker type registration and capability advertisement
The system SHALL provide a task-provider plugin that registers task-tracker type `github` when enabled by an operator, and SHALL ship disabled by default so no `github` task instance can be created until the plugin is explicitly enabled. For type `github` the system SHALL advertise exactly the provider capabilities `projects.list` and `projects.read` this session; capability-gated operations outside that set (task deletion, comments, labels, attachments, sprints, boards, saved queries, custom statuses, time tracking) SHALL NOT be offered, advertised in the agent prompt, or executed for `github` instances. Core task operations (create, read, update, list, search) SHALL be available without additional capability gating.

#### Scenario: Type unavailable until plugin enabled
- **WHEN** the plugin has not been enabled by an operator
- **THEN** type `github` is not offered when configuring a task instance and no `github` task instance can be saved

#### Scenario: Type available after enable
- **WHEN** the plugin is enabled and an operator configures a task tracker
- **THEN** type `github` is selectable and a task instance of that type can be saved

#### Scenario: Only advertised capabilities are offered
- **WHEN** a context's active task instance has type `github`
- **THEN** the agent's toolset and prompt advertise project listing/reading and core task operations, and do not offer deletion, comments, labels, attachments, sprints, or time tracking for that instance

### Requirement: Task instance and credential configuration
The system SHALL bind each `github` task instance to exactly one repository via instance-scoped config key `repo` in `owner/repo` form, and SHALL accept an optional instance-scoped `baseUrl` for GitHub Enterprise Server. Configuration validation SHALL reject a `repo` that is not non-empty `owner/repo` segments without whitespace or leading/trailing slash, and SHALL reject a `baseUrl` that is present but not an http(s) URL; an absent or empty `baseUrl` SHALL be valid and default to `https://api.github.com` at request time. The GitHub personal access token SHALL be required at context scope, marked sensitive, stored encrypted-at-rest, masked in settings responses, and never written to logs. All outbound GitHub requests SHALL go only to `api.github.com` or the host of the configured `baseUrl`; requests to any other host SHALL be refused.

#### Scenario: Invalid repository slug rejected
- **WHEN** an operator saves a task instance with `repo` set to `owner/`, `owner`, or `owner /repo`
- **THEN** validation fails with a human-readable reason and the instance is not saved

#### Scenario: Invalid base URL rejected, absent accepted
- **WHEN** an operator saves a task instance with `baseUrl` set to `not-a-url`
- **THEN** validation fails with a human-readable reason
- **WHEN** `baseUrl` is empty or omitted
- **THEN** validation succeeds and requests default to `https://api.github.com`

#### Scenario: Enterprise base URL accepted
- **WHEN** an operator saves a task instance with `baseUrl` set to an https GitHub Enterprise Server API URL
- **THEN** validation succeeds and all subsequent GitHub requests for that instance target that host

#### Scenario: Token stored encrypted and never exposed
- **WHEN** a context's GitHub token is saved or later displayed
- **THEN** it is persisted encrypted-at-rest, shown masked in settings responses, and absent from every log line

#### Scenario: Outbound host allowlist enforced
- **WHEN** a GitHub operation would issue a request to a host other than `api.github.com` or the configured `baseUrl` host
- **THEN** the request is refused before any credential is attached

### Requirement: Configured repository is the only project
For a `github` task instance the system SHALL expose exactly one project: the configured repository. Listing projects SHALL return a single-entry list containing that repository mapped to the normalized project shape (id `owner/repo`, name, description, web URL). Fetching a project SHALL return the configured repository when the requested project id equals the configured repo id, and SHALL fail with a project-not-found classification when the id differs or the repository does not exist upstream. Task creation SHALL require a project id matching the configured repository and SHALL fail with a project-not-found classification otherwise.

#### Scenario: List returns only the configured repository
- **WHEN** projects are listed for a `github` task instance configured for `owner/repo`
- **THEN** exactly one project is returned, with id `owner/repo`

#### Scenario: Foreign project id rejected
- **WHEN** a project fetch or task creation names a project id other than the configured repository's
- **THEN** the operation fails with a project-not-found classification and no upstream mutation occurs

#### Scenario: Missing repository reported as project-not-found
- **WHEN** the configured repository returns 404 from GitHub
- **THEN** the operation fails with a project-not-found classification

### Requirement: Task creation over GitHub Issues
Creating a task SHALL create an issue in the configured repository from the supplied title, description, and assignees (matched by GitHub login), and SHALL return the normalized task for the created issue. `priority`, `dueDate`, and `startDate` inputs SHALL be accepted and ignored: they SHALL NOT cause an error and SHALL NOT be persisted to the issue.

#### Scenario: Create issue with title, description, and assignees
- **WHEN** a task is created with title, description, and two assignee logins
- **THEN** an issue is created in the configured repository with those assignees and the normalized task is returned

#### Scenario: Priority and dates accepted but ignored
- **WHEN** a task is created with `priority` and `dueDate` set
- **THEN** the creation succeeds and the resulting task carries no priority or due date

### Requirement: Task read, update, and close
Reading a task SHALL return the normalized task for the referenced issue, failing with a task-not-found classification when the issue does not exist. Updating a task SHALL apply title, description, and assignee (login) changes to the issue. Updating status SHALL map normalized open/closed status onto the issue state: setting closed SHALL close the issue with the completed close reason, and setting open SHALL reopen it; both plain and canonical status text SHALL be accepted. Closing SHALL be performed as a status update, not a separate operation. Task deletion SHALL NOT be supported for `github` instances because GitHub's REST API cannot delete issues.

#### Scenario: Read existing and missing issue
- **WHEN** a task is read by its id for an existing issue
- **THEN** the normalized task is returned with that issue's current fields
- **WHEN** the referenced issue does not exist
- **THEN** the operation fails with a task-not-found classification

#### Scenario: Update fields and close
- **WHEN** a task update sets a new title, description, and status closed
- **THEN** the issue is updated with the new title and body and is closed with the completed close reason

#### Scenario: Reopen
- **WHEN** a task update sets status open on a closed issue
- **THEN** the issue is reopened

#### Scenario: Delete not offered
- **WHEN** the agent toolset is assembled for a `github` task instance
- **THEN** no task-deletion operation is offered

### Requirement: Task list and search
Listing tasks SHALL map the normalized status filter onto GitHub issue state (open, closed; absent filter uses GitHub's default) and SHALL return results across all result pages by following GitHub pagination, not only the first page. Searching tasks SHALL run a GitHub issue search scoped to the configured repository, SHALL pass the user query through so GitHub search qualifiers are honored, and SHALL honor the normalized `limit` and `offset` parameters. Both SHALL return normalized task list items consistent with the read mapping.

#### Scenario: List across pages
- **WHEN** the repository holds more issues than one page returns and tasks are listed without a filter
- **THEN** results include issues from every page up to the end of the listing

#### Scenario: Status filter maps to state
- **WHEN** tasks are listed with the normalized open (or closed) status filter
- **THEN** only issues in the corresponding GitHub state are returned

#### Scenario: Search with qualifiers and limit
- **WHEN** tasks are searched with a query containing GitHub search qualifiers, a limit, and an offset
- **THEN** the search is scoped to the configured repository, honors the qualifiers, and returns at most `limit` results starting at `offset`

### Requirement: Normalized task representation
Each GitHub issue SHALL map deterministically to the normalized task shape used by all providers: a stable task id usable interchangeably across create, read, update, list, and search; the issue number; title; description; status text derived from issue state with the close reason folded in (an issue closed as not planned reports a status text that distinguishes it from completed); assignee as the first assignee's login or null when unassigned; web URL; creation and update timestamps; the configured repository as project id; comment count; and the issue author as reporter. Normalization SHALL tolerate both label representations GitHub returns (plain strings from list endpoints, objects from single-issue endpoints) without parse failures.

#### Scenario: Stable id across operations
- **WHEN** a task returned by list or search is subsequently read or updated by its id
- **THEN** the operation resolves to the same issue

#### Scenario: Close reason folded into status text
- **WHEN** an issue is closed as not planned
- **THEN** its normalized status text distinguishes it from an issue closed as completed

#### Scenario: Unassigned issue and tolerant labels
- **WHEN** an issue has no assignees and arrives from a list endpoint with string-form labels
- **THEN** the normalized task has a null assignee and parses without error

### Requirement: Error classification
GitHub failures SHALL surface through the normalized error classifications: 401 and 403 responses as auth failure, 404 as task-not-found or project-not-found according to whether the failing request targets an issue or the repository, 400/422 as validation failure, and 5xx as unexpected. Rate-limited responses — 429, a 403 accompanied by an exhausted rate-limit indicator, or any response carrying a retry-after or rate-limit-reset header — SHALL be classified as rate-limited rather than auth failure. Network-level failures (connection refused, DNS failure, fetch errors) SHALL be classified as network errors. Classification SHALL be idempotent (an already-classified error passes through unchanged) and SHALL map non-error thrown values to the unexpected classification.

#### Scenario: Auth failure
- **WHEN** GitHub responds 401 or a plain 403 to a task operation
- **THEN** the error surfaces with the auth-failure classification

#### Scenario: Rate-limited 403 is not auth failure
- **WHEN** GitHub responds 403 with a zero remaining rate-limit indicator, or 429, or with a retry-after header
- **THEN** the error surfaces with the rate-limited classification

#### Scenario: Not found by target
- **WHEN** a 404 occurs on an issue request
- **THEN** the classification is task-not-found
- **WHEN** a 404 occurs on the repository request
- **THEN** the classification is project-not-found

#### Scenario: Validation and server errors
- **WHEN** GitHub responds 400 or 422
- **THEN** the classification is validation failure
- **WHEN** GitHub responds with a 5xx status
- **THEN** the classification is unexpected

#### Scenario: Network failure and pass-through
- **WHEN** the outbound request fails with a connection-refused or DNS error
- **THEN** the classification is network error
- **WHEN** an already-classified error is re-classified
- **THEN** it passes through unchanged

### Requirement: Web URL derivation
The system SHALL derive human-openable web URLs from the configured API base URL: with the default API host the web root is `https://github.com`; with an Enterprise base URL the web root is that base URL's origin. The task URL SHALL be the web root plus `owner/repo/issues/{number}`, and the project URL the web root plus `owner/repo`.

#### Scenario: Default host maps to github.com
- **WHEN** a task instance uses the default API base URL for issue `42` of `owner/repo`
- **THEN** the task URL is `https://github.com/owner/repo/issues/42` and the project URL is `https://github.com/owner/repo`

#### Scenario: Enterprise origin maps to server web root
- **WHEN** a task instance uses an Enterprise API base URL on `https://ghes.example.com`
- **THEN** task and project URLs are rooted at `https://ghes.example.com` with the same path shape

### Requirement: Agent guidance for GitHub trackers
When the active task instance has type `github`, the system SHALL append guidance to the agent prompt stating: tasks are GitHub issues in the configured repository; status is open/closed only, with close reasons completed and not planned; priority and due dates are not native and are accepted but ignored; assignees are GitHub logins; and search accepts GitHub issue-search qualifiers. The provider SHALL contribute no due-date normalization, so date-bearing task inputs never produce date fields on `github` tasks.

#### Scenario: Prompt documents limitations
- **WHEN** a context's active task instance has type `github` and a turn is assembled
- **THEN** the prompt includes the GitHub guidance covering status model, ignored fields, login assignees, and search qualifiers

#### Scenario: No due-date surface
- **WHEN** a task is created or updated with a due date on a `github` instance
- **THEN** the date is ignored and the resulting task carries no due date

### Requirement: Platform parity, scope model, and privacy
`github` task instances SHALL behave identically across Telegram, Mattermost, Discord, and Kontur Talk platform instances with no platform-specific branching. Task instance assignment SHALL follow the durable-config scope: one instance is shared across a group's config-context and its sibling threads, and the provider introduces no new tools, so existing capability gating and per-context `tool_prefs` (allow/ask/deny, most-specific-wins) resolution apply unchanged; a context with a null task instance exposes no `github` operations. All outbound GitHub calls SHALL be authenticated with the configured token sent only as a bearer credential to allowed hosts, SHALL never include the token in URLs or logs, and SHALL be recorded under the `github` provider name for request analytics without message content, repository payload data, or credentials.

#### Scenario: Same tracker across sibling threads and platforms
- **WHEN** two sibling threads in a group — reached through different platform instances — use task tools while the group's task instance has type `github`
- **THEN** both resolve the same task instance and see the same repository's tasks, while each thread's live conversation state stays isolated

#### Scenario: Null task instance exposes no GitHub operations
- **WHEN** a context's task instance is null (never configured)
- **THEN** no `github` task operations are available in that context

#### Scenario: Existing tool gating applies unchanged
- **WHEN** a context's `tool_prefs` resolves a task tool to ask (or deny)
- **THEN** that tool requires per-call confirmation (or is absent) exactly as before, with no `github`-specific bypass

#### Scenario: Analytics record provider without content
- **WHEN** a GitHub operation completes or fails
- **THEN** request analytics attribute it to the `github` provider and contain no token, issue body, or other repository content
