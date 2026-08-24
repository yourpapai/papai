## Purpose

Adds comment and label management to the `github` task-tracker type: users list, create, update, and delete issue comments and manage repository-level and issue-level labels through the existing chat task tools, under the same encrypted credentials, capability gating, and normalized error handling as task operations.

## ADDED Requirements

### Requirement: Comment and label capability advertisement
When the plugin is enabled, the `github` task-tracker type SHALL advertise exactly the provider capabilities `comments.read`, `comments.create`, `comments.update`, `comments.delete`, `labels.list`, `labels.create`, `labels.update`, `labels.delete`, and `labels.assign`, alongside session 1's `projects.list` and `projects.read` — eleven total, declared identically in the plugin manifest and on the provider instance. Comment and label operations outside that set SHALL NOT be offered, advertised in the agent prompt, or executed; in particular comment reactions and the identity, history, and count surfaces are excluded. Comment reading SHALL be available only through listing; no single-comment fetch operation SHALL be offered.

#### Scenario: Exact capability set declared
- **WHEN** the capabilities of an enabled `github` provider are read from its manifest or from the provider instance
- **THEN** they are exactly the eleven capabilities listed above, with no extras and no omissions

#### Scenario: Reactions and single-comment fetch not offered
- **WHEN** the agent toolset is assembled for a context whose active task instance has type `github`
- **THEN** no comment-reaction operation and no single-comment fetch operation are offered, while comment listing remains available

### Requirement: Issue comment listing
Listing a task's comments SHALL return the comments of the referenced issue across all of GitHub's result pages, fetching in windows rather than reading only the first page, and SHALL honor the normalized `limit` and `offset` parameters — `offset` skips leading comments and `limit` caps the number returned. Each returned comment SHALL use the normalized comment representation. When the referenced issue does not exist, listing SHALL fail with a task-not-found classification.

#### Scenario: Listing spans pages with windowing
- **WHEN** an issue holds more comments than one result page returns and its comments are listed with a limit and an offset
- **THEN** results are drawn from successive pages until the window is satisfied, and at most `limit` comments are returned starting after `offset` comments

#### Scenario: Missing issue
- **WHEN** comments are listed for a task id whose issue does not exist
- **THEN** the operation fails with a task-not-found classification

### Requirement: Issue comment creation
Creating a comment SHALL submit the supplied body to the referenced issue and return the created comment in the normalized representation.

#### Scenario: Created comment returned
- **WHEN** a comment is created with a body on an existing issue
- **THEN** the operation returns the normalized comment carrying an id, the body, the author login, and a creation timestamp

#### Scenario: Comment on missing issue
- **WHEN** a comment is created for a task id whose issue does not exist
- **THEN** the operation fails with a task-not-found classification and no comment is created upstream

### Requirement: Issue comment update and deletion
Updating a comment SHALL replace the comment's body and return the updated normalized comment; deleting a comment SHALL remove it and return a delete result carrying the deleted comment's id. Both SHALL address the comment through the repository's issue-comments collection by comment id (`PATCH`/`DELETE` on `/repos/{owner}/{repo}/issues/comments/{id}`), not through the per-issue comments path, so a comment stays addressable by its comment id alone.

#### Scenario: Update addresses the comments collection
- **WHEN** a comment is updated with a new body
- **THEN** the change request targets the repository's issue-comments collection with the comment id, and the updated normalized comment is returned

#### Scenario: Delete returns the comment id
- **WHEN** a comment is deleted
- **THEN** the removal request targets the issue-comments collection with the comment id and the operation returns a delete result carrying that id

### Requirement: Repository label management
The system SHALL manage the configured repository's label set. Listing SHALL return all labels across GitHub's result pages in the normalized label representation. Name lookup SHALL return only labels whose name equals the requested name exactly. Creating SHALL accept a name plus optional color and description. Updating SHALL address a label by its current name and apply a new name and/or color; after a rename the label SHALL be addressable only by its new name. Deleting SHALL remove a label by its name and return a delete result identifying it. Label names SHALL be URL-encoded into request paths so names containing URL-unsafe characters round-trip correctly. A label color SHALL be a six-digit lowercase hex string; create or update attempts with any other color SHALL fail with a validation-failure classification.

#### Scenario: Full label lifecycle
- **WHEN** a label is created with a name and color, renamed, and then deleted by its new name
- **THEN** each step returns the normalized label (or a delete result), and the delete addressed by the new name succeeds

#### Scenario: URL-unsafe names round-trip
- **WHEN** a label whose name contains characters that are unsafe in a URL path (such as `/`, `?`, or `%`) is updated or deleted
- **THEN** the operation addresses exactly that label and no other

#### Scenario: Exact-name lookup
- **WHEN** labels are looked up by a name that is a prefix or substring of an existing label's name but not equal to it
- **THEN** no result is returned for that name

#### Scenario: Invalid color rejected
- **WHEN** a label is created or updated with a color that is not a six-digit lowercase hex string
- **THEN** the operation fails with a validation-failure classification

### Requirement: Issue label management
The system SHALL manage an issue's label set. Reading SHALL return the issue's current labels normalized. Replacing SHALL set the issue's labels to exactly the supplied names, removing any omitted label. Adding SHALL add the supplied names while preserving existing labels. Removing one SHALL remove only the named label, with the label name URL-encoded in the request path. Clearing SHALL remove every label from the issue. Parsing SHALL tolerate both label representations GitHub returns — plain strings from list-shaped endpoints and objects from single-issue endpoints — without failure.

#### Scenario: Replace is full-set semantics
- **WHEN** an issue carries labels A and B and its label set is replaced with the single name C
- **THEN** afterwards the issue carries exactly label C

#### Scenario: Add preserves existing labels
- **WHEN** label name C is added to an issue already carrying A and B
- **THEN** the issue carries A, B, and C

#### Scenario: Remove one URL-encoded name
- **WHEN** a single label whose name contains URL-unsafe characters is removed from an issue
- **THEN** only that label is removed and the issue's other labels remain

#### Scenario: Clear all labels
- **WHEN** an issue's labels are cleared
- **THEN** the issue carries no labels

#### Scenario: Tolerant payload forms
- **WHEN** GitHub returns issue labels as plain strings or as objects
- **THEN** both forms parse and normalize without error

### Requirement: Label reference resolution for assignment
Assigning a label to a task or removing one SHALL accept a reference that is either a label id or a label name. A purely numeric reference SHALL be resolved to a label name via at most one repository-label lookup before the assignment call, because GitHub assigns labels by name; a reference that is not purely numeric SHALL be used as the name directly with no lookup. A purely numeric reference that matches no repository label SHALL be passed through as the name unchanged, and any upstream rejection SHALL surface through the standard error classifications. Each assignment or removal SHALL return the task id together with the supplied label reference.

#### Scenario: Numeric id resolved through lookup
- **WHEN** a label is assigned using a purely numeric reference that matches a repository label
- **THEN** at most one repository-label lookup occurs, the matching label's name is used for the assignment, and the result echoes the task id and the supplied reference

#### Scenario: Name used directly
- **WHEN** a label is assigned or removed using a reference that is not purely numeric
- **THEN** no repository-label lookup occurs and the reference is used as the label name

#### Scenario: Unresolved numeric reference falls through
- **WHEN** a purely numeric reference matches no repository label
- **THEN** the reference is used as the label name and any GitHub rejection surfaces with its standard classification

### Requirement: Normalized comment and label representation
Each GitHub comment SHALL map deterministically to the normalized comment shape used by all providers: the comment id as a string, the body, the author as the commenter's login (absent when GitHub reports no user), and the creation timestamp. Each GitHub repository label SHALL map to the normalized label shape: the label id as a string, the name, and the color; a string-form issue label SHALL map with id equal to the name. Returned comment and label ids SHALL be usable in subsequent update, delete, and assignment operations.

#### Scenario: Comment with no user
- **WHEN** a comment arrives with a null user field
- **THEN** the normalized comment carries the id, body, and creation timestamp with no author

#### Scenario: String-form label maps id to name
- **WHEN** an issue-level label arrives as a plain string
- **THEN** it normalizes to a label whose id and name are both that string

#### Scenario: Ids round-trip
- **WHEN** a comment or label returned by a listing is subsequently updated or deleted using its returned id (or name)
- **THEN** the operation resolves to the same upstream comment or label

### Requirement: Error classification with identifier preservation
Comment and label failures SHALL classify through the same normalized mappings as task operations: 401 and plain 403 as auth failure; rate-limit-shaped responses (429, a 403 with an exhausted rate-limit indicator, or a response carrying retry-after or rate-limit-reset headers) as rate-limited; 404 as task-not-found when the failing call carries task context and as project-not-found otherwise, for example a missing repository on a label-listing call; 400 and 422 as validation failure. Classified-error messages and log metadata SHALL retain the comment id or label name involved in the failed call, and SHALL never contain the GitHub token or any other credential.

#### Scenario: Not-found classification by context
- **WHEN** a comment operation fails with 404 on a call carrying task context
- **THEN** the classification is task-not-found
- **WHEN** a repository label listing fails with 404 because the repository is missing
- **THEN** the classification is project-not-found

#### Scenario: Rate-limited label call
- **WHEN** a label operation receives a 429 or a rate-limit-shaped 403
- **THEN** the error surfaces with the rate-limited classification, not auth failure

#### Scenario: Validation failure retains identifiers
- **WHEN** a comment update or label creation fails with 422
- **THEN** the validation-failure error message carries the comment id or label name from the failed call

#### Scenario: No credentials in errors or logs
- **WHEN** any comment or label operation fails
- **THEN** neither the classified error nor any log line written for the failure contains the token

### Requirement: Gating, scope, platform parity, and privacy for comment and label operations
Comment and label operations SHALL be available only in contexts whose active task instance has type `github` and only when the corresponding capability is advertised. They SHALL introduce no new tools, so existing capability gating and per-context `tool_prefs` resolution (allow/ask/deny, most-specific-wins) apply unchanged: ask SHALL require per-call confirmation before execution and deny SHALL keep the operation absent. A context with a null task instance SHALL expose no comment or label operations, and the guest-mode read-only toolset SHALL gain no comment or label write operations. Behavior SHALL be identical across Telegram, Mattermost, Discord, and Kontur Talk platform instances with no platform-specific branching, and task-instance assignment SHALL follow the durable config scope: one instance shared across a group's config context and its sibling threads, with live conversation state staying thread-isolated. Outbound calls SHALL reuse the instance's encrypted-at-rest token as a bearer credential to allowed hosts only, and request analytics SHALL attribute comment and label calls to the `github` provider without credentials, comment bodies, or other repository content.

#### Scenario: Ask requires confirmation
- **WHEN** a context's `tool_prefs` resolves a comment or label tool to ask and the agent invokes it
- **THEN** execution waits for per-call confirmation, exactly as for pre-existing task tools

#### Scenario: Null task instance exposes nothing
- **WHEN** a context's task instance is null
- **THEN** no comment or label operation is available in that context

#### Scenario: Guests stay read-only
- **WHEN** a guest user under group guest mode interacts with a `github` task instance
- **THEN** the guest's read-only toolset includes no comment or label write operation

#### Scenario: Shared instance, isolated threads, all platforms
- **WHEN** sibling threads of one group — reached through different platform instances — use comment or label tools while the group's task instance has type `github`
- **THEN** both resolve the same task instance and repository, while each thread's live conversation state remains isolated

#### Scenario: Analytics without content
- **WHEN** a comment or label operation completes or fails
- **THEN** request analytics attribute it to the `github` provider and contain no token, comment body, or other repository content
