// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const GITHUB_PROMPT_ADDENDUM = [
  'IMPORTANT — GitHub-specific behaviors:',
  '- A task instance is bound to exactly one repository (owner/repo); it is the only project.',
  '- Tasks are GitHub issues; task ids are issue numbers (e.g. "42"), used across all task tools.',
  '- Issues have only two states: open and closed. Closed issues fold the close reason into the',
  '  status text: "closed" (completed) or "closed (not_planned)". Set status "open" to reopen.',
  '- priority, due date, and start date are not supported by GitHub Issues: they are accepted but',
  '  ignored — do not promise the user they were stored.',
  '- Assignees are GitHub user logins; set an assignee by login (first assignee is the task assignee).',
  '- Labels are issue labels. Descriptions map to the issue body.',
  '- Search passes your query to GitHub search: use GitHub search qualifiers (label:, assignee:,',
  '  milestone:, state:, is:issue is already pinned for you along with the repository scope).',
  '- Comments, attachments, and deletion are not supported for GitHub task instances this session.',
].join('\n')
