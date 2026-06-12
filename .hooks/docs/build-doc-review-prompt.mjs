// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Build a suggestion prompt for doc review after source file changes.
 * @param {string[]} changedFiles - Relative paths of changed source files
 * @param {string[]} docPaths - Doc file paths to suggest reviewing
 * @returns {string} Formatted suggestion prompt
 */
export function buildDocReviewPrompt(changedFiles, docPaths) {
  const fileList = changedFiles.map((f) => `- ${f}`).join('\n')
  const docList = docPaths.map((d) => `- ${d}`).join('\n')

  return [
    'The following source files were changed this session:',
    '',
    fileList,
    '',
    'These documentation files may need updating to reflect the changes:',
    '',
    docList,
    '',
    'Please review and update if needed. If no updates are required, you can ignore this.',
  ].join('\n')
}
