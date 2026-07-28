// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Build a suggestion prompt for analytics review after source file changes.
 * @param {import('./map-files-to-analytics.mjs').AnalyticsArea[]} areas - Matched analytics areas
 * @returns {string} Formatted suggestion prompt
 */
export function buildAnalyticsReviewPrompt(areas) {
  const sections = areas.map((area) =>
    [
      `Area: ${area.area}`,
      'Triggered by:',
      area.triggers.map((file) => `- ${file}`).join('\n'),
      'Update if needed:',
      area.artifacts.map((artifact) => `- ${artifact}`).join('\n'),
      'Verify:',
      `- ${area.verify}`,
    ].join('\n'),
  )

  return [
    'Source files changed this session touch analytics-covered surfaces.',
    '',
    sections.join('\n\n'),
    '',
    'Analytics definitions are versioned: amend docs/research/analytics-metrics/02-metric-catalog.md and 03-privacy-consent-threat-model.md through review rather than silently changing definitions in code. If no analytics update is required, you can ignore this.',
  ].join('\n')
}
