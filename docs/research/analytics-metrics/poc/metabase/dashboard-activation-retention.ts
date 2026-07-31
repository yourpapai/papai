/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import {
  defineCard,
  modelReference,
  type DashboardCardSpec,
} from "./dashboard-types.js";

function activationFunnel(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Activation funnel",
    description:
      "Ordered actor counts. Success means a task-provider mutation completed semantically within 14 days.",
    display: "bar",
    query: `
WITH activation AS ${modelReference(modelId)}
SELECT 1 AS step_order, 'Authorized first DM' AS step,
       SUM(reached_first_dm) AS actors
FROM activation
UNION ALL
SELECT 2, 'Config link issued', SUM(reached_config_link) FROM activation
UNION ALL
SELECT 3, 'Settings opened', SUM(reached_settings_opened) FROM activation
UNION ALL
SELECT 4, 'Task instance assigned', SUM(reached_task_assignment) FROM activation
UNION ALL
SELECT 5, 'First mutating success',
       SUM(reached_first_mutating_success) FROM activation
ORDER BY step_order
    `,
    resultColumns: ["step_order", "step", "actors"],
    visualizationSettings: {
      "graph.dimensions": ["step"],
      "graph.metrics": ["actors"],
      "graph.show_values": true,
    },
    size: { width: 14, height: 9 },
  });
}

function activationByPlatform(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Activation rate by platform",
    description:
      "Activated synthetic actors divided by eligible first-DM actors in each platform.",
    display: "bar",
    query: `
WITH activation AS ${modelReference(modelId)}
SELECT platform,
       COUNT(*) AS eligible_actors,
       SUM(activation_completed) AS activated_actors,
       ROUND(100.0 * SUM(activation_completed) / COUNT(*), 1)
         AS activation_rate_pct
FROM activation
GROUP BY platform
ORDER BY platform
    `,
    resultColumns: [
      "platform",
      "eligible_actors",
      "activated_actors",
      "activation_rate_pct",
    ],
    visualizationSettings: {
      "graph.dimensions": ["platform"],
      "graph.metrics": ["activation_rate_pct"],
      "graph.show_values": true,
    },
    size: { width: 10, height: 9 },
  });
}

function exactDayRetention(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Exact-day retention",
    description:
      "Exact UTC calendar-day retained actors over actors with enough observation time.",
    display: "bar",
    query: `
WITH retention AS ${modelReference(modelId)},
windows AS (
  SELECT 1 AS window_order, 'D1' AS retention_window,
         SUM(d1_retained_actors) AS retained_actors,
         SUM(d1_eligible_actors) AS eligible_actors
  FROM retention WHERE row_kind = 'retention'
  UNION ALL
  SELECT 2, 'D7', SUM(d7_retained_actors), SUM(d7_eligible_actors)
  FROM retention WHERE row_kind = 'retention'
  UNION ALL
  SELECT 3, 'D30', SUM(d30_retained_actors), SUM(d30_eligible_actors)
  FROM retention WHERE row_kind = 'retention'
)
SELECT retention_window, retained_actors, eligible_actors,
       ROUND(100.0 * retained_actors / NULLIF(eligible_actors, 0), 1)
         AS retention_rate_pct
FROM windows
ORDER BY window_order
    `,
    resultColumns: [
      "retention_window",
      "retained_actors",
      "eligible_actors",
      "retention_rate_pct",
    ],
    visualizationSettings: {
      "graph.dimensions": ["retention_window"],
      "graph.metrics": ["retention_rate_pct"],
      "graph.show_values": true,
    },
  });
}

function dailyEngagement(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Daily engagement by modeled dimensions",
    description:
      "Sum of the model's dimension-grain DAU; it is not a cross-dimension global unique count.",
    display: "line",
    query: `
WITH engagement AS ${modelReference(modelId)}
SELECT metric_date,
       SUM(dau) AS dimension_grain_dau,
       SUM(session_count) AS sessions,
       SUM(turn_count) AS completed_turns
FROM engagement
WHERE row_kind = 'engagement'
GROUP BY metric_date
ORDER BY metric_date
    `,
    resultColumns: [
      "metric_date",
      "dimension_grain_dau",
      "sessions",
      "completed_turns",
    ],
    visualizationSettings: {
      "graph.dimensions": ["metric_date"],
      "graph.metrics": [
        "dimension_grain_dau",
        "sessions",
        "completed_turns",
      ],
    },
  });
}

export function activationCards(
  modelId: number,
): readonly DashboardCardSpec[] {
  return [activationFunnel(modelId), activationByPlatform(modelId)];
}

export function retentionCards(
  modelId: number,
): readonly DashboardCardSpec[] {
  return [exactDayRetention(modelId), dailyEngagement(modelId)];
}
