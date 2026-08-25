## Purpose

Completes the `github` task-tracker type with identity resolution for auto-linking and assignment, task history derived from issue events, task counting derived from issue-search totals, and one shared search-qualifier composition that keeps search and counting consistent.

## ADDED Requirements

### Requirement: Identity, history, and count capability advertisement
When the plugin is enabled, the `github` task-tracker type SHALL advertise exactly the provider capabilities `projects.list`, `projects.read`, `comments.read`, `comments.create`, `comments.update`, `comments.delete`, `labels.list`, `labels.create`, `labels.update`, `labels.delete`, `labels.assign`, `activities.read`, and `tasks.count` — thirteen total, declared identically in the plugin manifest and on the provider instance. Task history SHALL be offered only when `activities.read` is advertised and the provider implements the history operation, and task counting only when `tasks.count` is advertised and the provider implements the count operation; when either condition fails the operation SHALL NOT be offered. Operations outside the thirteen — issue deletion, attachments, comment reactions, single-comment fetch, sprints, boards, and time tracking — SHALL NOT be offered, advertised in the agent prompt, or executed for `github` instances.

#### Scenario: Exact capability set declared
- **WHEN** the capabilities of an enabled `github` provider are read from its manifest or from the provider instance
- **THEN** they are exactly the thirteen capabilities listed above, with no extras and no omissions

#### Scenario: History and count offered for github instances
- **WHEN** a context's active task instance has type `github` and the agent toolset is assembled
- **THEN** task-history and task-count operations are available, while issue deletion and attachments remain absent

#### Scenario: Capability or operation absence gates the tool
- **WHEN** a `github` provider does not advertise `activities.read` (or `tasks.count`) or does not implement the corresponding operation
- **THEN** the task-history (or task-count) operation is not offered in any context using that provider

### Requirement: Identity user search
For a `github` task instance the system SHALL resolve a free-text identity query to candidate GitHub users, each carrying a stable id, the login, and the display name when GitHub provides one; the login SHALL remain the preferred user identifier for assignment and identity linking. Lookup SHALL consider the configured repository's write-access collaborators first — the collaborator listing request SHALL carry the push-permission filter and SHALL follow all of GitHub's result pages — and SHALL fall back to exactly one GitHub user-search request only when no collaborator matches. Matching SHALL normalize both sides by trimming and case-folding, and SHALL rank exact login matches first, then display-name equality or whole-word matches, then substring containment on login or display name; at most the requested number of candidates SHALL be returned, defaulting to 10. A query that matches no user SHALL return an empty candidate list, not an error.

#### Scenario: Collaborator exact login ranks first
- **WHEN** an identity query exactly equals a collaborator's login after trimming and case-folding
- **THEN** that collaborator is returned as the first candidate and no GitHub user-search request is issued

#### Scenario: Display-name match within collaborators
- **WHEN** an identity query equals a collaborator's display name or one of its words, case-insensitively
- **THEN** that collaborator is returned among the candidates from the collaborator listing

#### Scenario: Fallback user search only on collaborator miss
- **WHEN** no collaborator matches the query
- **THEN** exactly one GitHub user-search request is issued for the query and its results are returned as candidates

#### Scenario: Candidate limit applied
- **WHEN** an identity query matches more users than the requested limit, or than the default of 10 when none is requested
- **THEN** only the top-ranked candidates up to the limit are returned

#### Scenario: No match is an empty list
- **WHEN** an identity query matches neither the repository's collaborators nor the user-search results
- **THEN** the lookup returns an empty candidate list without error

### Requirement: Task history from issue events
Task history for a `github` task SHALL be derived from the referenced issue's event timeline, fetched across all of GitHub's result pages, and SHALL return normalized activities in the common activity shape: a stable id, a timestamp, the acting user's login as author when present, and a category describing the change. Event mapping SHALL be: assignment events map to the assignee category with the assignee's login as the added value; label-add and label-remove events map to the label category with the label name as the added or removed value; close events map to the status category with added value `closed`; reopen events map to the status category with added value `open`; comment events, when GitHub reports them on the event timeline, map to the comment category. Event types outside this mapping SHALL be silently omitted, and event payloads carrying extra GitHub fields SHALL parse without error.

#### Scenario: Mixed timeline normalizes per event type
- **WHEN** an issue's events include an assignment, a label addition, a label removal, a close, and a reopen
- **THEN** each maps to a normalized activity with the corresponding category and the assignee login, label name, or status value as the added or removed value, the event's creation time as timestamp, and the acting user's login as author

#### Scenario: Unknown event types omitted
- **WHEN** the event timeline contains event types with no defined mapping
- **THEN** history returns without error and the unknown events produce no activities

#### Scenario: Event without an actor
- **WHEN** an event arrives with no acting user
- **THEN** the normalized activity carries its id, timestamp, and category with no author

#### Scenario: Missing issue
- **WHEN** task history is requested for a task id whose issue does not exist
- **THEN** the operation fails with a task-not-found classification

### Requirement: History filtering, ordering, and windowing
History parameters SHALL be applied to the normalized activities after mapping: `author` SHALL keep only activities whose author equals the requested login; `categories` SHALL keep only activities in the requested categories; `start` and `end` SHALL exclude activities whose timestamp falls outside the inclusive bounds; `reverse` SHALL flip the ordering from chronological (oldest first) to newest first; and `limit` and `offset` SHALL select a window of the ordered activities, with `offset` skipping leading activities and `limit` capping the number returned.

#### Scenario: Newest activities via reverse and limit
- **WHEN** history is requested with reverse ordering and a limit of 5
- **THEN** the 5 most recent activities are returned, newest first

#### Scenario: Author and category filters combine
- **WHEN** history is requested with an author login and a category set
- **THEN** only activities by that author within those categories are returned

#### Scenario: Time window bounds
- **WHEN** history is requested with start and end timestamps
- **THEN** activities outside the window are excluded and activities at the bounds are included

#### Scenario: Offset skips leading activities
- **WHEN** history is requested with an offset of 10 and a limit of 5 in default order
- **THEN** activities 11 through 15 of the chronological order are returned

### Requirement: Shared search-qualifier composition
Task search and task counting for `github` instances SHALL build their GitHub search qualifier strings from one shared composition so both operations scope identically. The composition SHALL always pin the configured repository and the issue-only restriction, so results never include pull requests; an assignee filter SHALL restrict to issues assigned to the requested login; an open status filter SHALL restrict to open issues and a status beginning with `closed` SHALL restrict to closed issues, while any other status value adds no state restriction; a non-empty free-text query SHALL be matched against issue titles and bodies, and an empty query SHALL add no title/body restriction clause.

#### Scenario: Scope pinned to repository issues
- **WHEN** tasks are searched or counted with no additional filters
- **THEN** the qualifier string pins the configured repository and the issue-only restriction, includes no pull requests, and carries no title/body clause

#### Scenario: Assignee and status restrictions
- **WHEN** tasks are searched or counted with an assignee login and either the open status or a status beginning with `closed`
- **THEN** only issues in the configured repository assigned to that login and in the corresponding state match

#### Scenario: Text query matches title and body
- **WHEN** tasks are searched or counted with a non-empty free-text query
- **THEN** only issues whose title or body matches the query terms are returned, and a term appearing only in other issue fields does not match

#### Scenario: Search and count agree
- **WHEN** the same filters are passed to task search and task counting
- **THEN** the returned count equals the number of issues the search matches

### Requirement: Task counting
Task counting SHALL accept an optional free-text query and an optional project reference. A project reference that differs from the configured repository SHALL fail with a project-not-found classification before any upstream request is issued. Otherwise counting SHALL issue a single issue-search request that fetches at most one result item, and SHALL return the search's total match count — the full number of matching issues, not the number fetched — taken from the search response's total-count field.

#### Scenario: Count all issues
- **WHEN** tasks are counted with no filters for a `github` instance configured for `owner/repo`
- **THEN** a single search request scoped to that repository's issues is issued and the total number of its issues is returned

#### Scenario: Count with query
- **WHEN** tasks are counted with a free-text query
- **THEN** the shared qualifier composition is applied and the number of matching issues is returned

#### Scenario: Foreign project rejected without upstream call
- **WHEN** tasks are counted with a project reference other than the configured repository
- **THEN** the operation fails with a project-not-found classification and no GitHub request is issued

#### Scenario: Total is not the fetched page
- **WHEN** the number of matching issues exceeds the single fetched result item
- **THEN** the returned count is the full total, not the number of items in the response

### Requirement: Error classification with identifier preservation
Identity, history, and count failures SHALL classify through the same normalized mappings as task operations: 401 and plain 403 as auth failure; rate-limit-shaped responses (429, a 403 with an exhausted rate-limit indicator, or a response carrying retry-after or rate-limit-reset headers) as rate-limited; 404 on an issue-event request as task-not-found; 400 and 422 as validation failure; 5xx and non-error thrown values as unexpected; network-level failures as network errors. Classified errors and log metadata for history calls SHALL retain the requested task id, count calls SHALL retain the configured repository as the project identifier, and no classified error or log line SHALL contain the GitHub token or any other credential.

#### Scenario: History not-found retains the task id
- **WHEN** task history fails with 404 on the event request
- **THEN** the task-not-found error message and log metadata carry the requested task id

#### Scenario: Identity upstream failure classified
- **WHEN** the collaborator listing or user-search request fails with 401, or with a rate-limit-shaped response
- **THEN** the error surfaces with the auth-failure (or rate-limited) classification rather than an empty candidate list

#### Scenario: No credentials in errors or logs
- **WHEN** any identity, history, or count operation fails
- **THEN** neither the classified error nor any log line written for the failure contains the token

### Requirement: Gating, scope, platform parity, and privacy for identity, history, and count
Task history and task counting SHALL be available only in contexts whose active task instance has type `github` and only under their capability gates; they SHALL introduce no new tools, so existing per-context `tool_prefs` resolution (allow/ask/deny, most-specific-wins) applies unchanged — ask SHALL require per-call confirmation before execution and deny SHALL keep the operation absent. A context with a null task instance SHALL expose no history, count, or identity operations for `github`, and the guest-mode read-only toolset SHALL gain no GitHub-specific widening or bypass. Behavior SHALL be identical across Telegram, Mattermost, Discord, and Kontur Talk platform instances with no platform-specific branching, and task-instance assignment SHALL follow the durable config scope: one instance shared across a group's config context and its sibling threads, with live conversation state staying thread-isolated. Outbound calls SHALL reuse the instance's encrypted-at-rest token as a bearer credential to allowed hosts only, and request analytics SHALL attribute identity, history, and count calls to the `github` provider without credentials, identity query text, user listings, event payloads, or other repository content.

#### Scenario: Ask requires confirmation
- **WHEN** a context's `tool_prefs` resolves the history or count tool to ask and the agent invokes it
- **THEN** execution waits for per-call confirmation, exactly as for pre-existing task tools

#### Scenario: Null task instance exposes nothing
- **WHEN** a context's task instance is null
- **THEN** no `github` history, count, or identity operation is available in that context

#### Scenario: Guests unchanged
- **WHEN** a guest user under group guest mode interacts with a `github` task instance
- **THEN** the hardcoded read-only toolset applies with no GitHub-specific widening or bypass

#### Scenario: Shared instance, isolated threads, all platforms
- **WHEN** sibling threads of one group — reached through different platform instances — use history, count, or identity operations while the group's task instance has type `github`
- **THEN** both resolve the same task instance and repository, while each thread's live conversation state remains isolated

#### Scenario: Analytics without content
- **WHEN** an identity, history, or count operation completes or fails
- **THEN** request analytics attribute it to the `github` provider and contain no token, identity query text, user listing, or event payload
