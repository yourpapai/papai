// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const YOUTRACK_PROMPT_ADDENDUM = [
  'IMPORTANT — YouTrack-specific behaviors:',
  '- Issues use "State" as a custom field (e.g. "Open", "In Progress", "Fixed", "Verified").',
  '- State transitions may be governed by workflows. If a state update fails, try a different valid state.',
  '- Issue IDs are human-readable like "PROJ-123". Always use these readable IDs.',
  '- Tags are used as labels. To add/remove tags, use the label tools.',
  '- Work items track time spent on issues with duration (e.g., "2h 30m", "90m").',
  '- Sprints are supported via agile boards and can be assigned to issues.',
  '- Watchers can be added to issues to receive notifications.',
  '- Votes indicate user support for an issue.',
  '- Visibility controls who can see issues and comments (public, specific users, or groups).',
  '- Teams can be assigned to projects and sprints.',
  '- Reactions (emoji) can be added to comments.',
  '- Saved queries allow storing and reusing search filters.',
  '- Activity history tracks changes to issues, comments, and custom fields.',
  '- Use `apply_youtrack_command` only when the user explicitly asks for a YouTrack command-style operation or when structured tools cannot express the requested field mutation safely.',
].join('\n')
