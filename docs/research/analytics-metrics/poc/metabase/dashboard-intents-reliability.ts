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

function topIntents(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Top primary intents",
    description:
      "Top fixed-taxonomy intent labels; no message content is present.",
    display: "bar",
    query: `
WITH usage AS ${modelReference(modelId)}
SELECT usage_name AS intent,
       COUNT(*) AS classified_turns,
       SUM(outcome IN ('immediate_success', 'recovered_same_turn'))
         AS successful_turns
FROM usage
WHERE usage_kind = 'intent'
GROUP BY usage_name
ORDER BY classified_turns DESC, intent
LIMIT 12
    `,
    resultColumns: ["intent", "classified_turns", "successful_turns"],
    visualizationSettings: {
      "graph.dimensions": ["intent"],
      "graph.metrics": ["classified_turns"],
      "graph.show_values": true,
    },
    size: { width: 14, height: 10 },
  });
}

function featureAdoption(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Feature adoption among eligible actors",
    description:
      "Actors with a successful feature use divided by actors with an explicit available opportunity.",
    display: "bar",
    query: `
WITH usage AS ${modelReference(modelId)},
actor_feature AS (
  SELECT usage_name AS feature,
         actor_key,
         MAX(outcome = 'available') AS eligible,
         MAX(outcome = 'success') AS adopted
  FROM usage
  WHERE usage_kind = 'feature'
  GROUP BY usage_name, actor_key
)
SELECT feature,
       SUM(eligible) AS eligible_actors,
       SUM(adopted) AS adopted_actors,
       ROUND(100.0 * SUM(adopted) / NULLIF(SUM(eligible), 0), 1)
         AS adoption_rate_pct
FROM actor_feature
GROUP BY feature
HAVING SUM(eligible) > 0
ORDER BY adoption_rate_pct DESC, feature
    `,
    resultColumns: [
      "feature",
      "eligible_actors",
      "adopted_actors",
      "adoption_rate_pct",
    ],
    visualizationSettings: {
      "graph.dimensions": ["feature"],
      "graph.metrics": ["adoption_rate_pct"],
      "graph.show_values": true,
    },
    size: { width: 10, height: 10 },
  });
}

function errorTaxonomy(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Error taxonomy",
    description:
      "Failure counts and denominator-aware rates from paired attempts and terminals.",
    display: "bar",
    query: `
WITH reliability AS ${modelReference(modelId)}
SELECT metric_name AS error_class,
       SUM(numerator) AS failures,
       SUM(denominator) AS opportunities,
       ROUND(100.0 * SUM(numerator) / NULLIF(SUM(denominator), 0), 2)
         AS failure_rate_pct
FROM reliability
WHERE row_kind = 'metric' AND metric_family = 'error'
GROUP BY metric_name
ORDER BY failure_rate_pct DESC, error_class
    `,
    resultColumns: [
      "error_class",
      "failures",
      "opportunities",
      "failure_rate_pct",
    ],
    visualizationSettings: {
      "graph.dimensions": ["error_class"],
      "graph.metrics": ["failure_rate_pct"],
      "graph.show_values": true,
    },
    size: { width: 12, height: 9 },
  });
}

function frictionDistribution(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "Friction Signature distribution",
    description:
      "Unweighted count of R,C,P,S,L,D,F components across mature synthetic sessions.",
    display: "bar",
    query: `
WITH reliability AS ${modelReference(modelId)}
SELECT friction_signature_count AS component_count,
       COUNT(*) AS mature_sessions
FROM reliability
WHERE row_kind = 'friction_signature' AND mature_24h = 1
GROUP BY friction_signature_count
ORDER BY component_count
    `,
    resultColumns: ["component_count", "mature_sessions"],
    visualizationSettings: {
      "graph.dimensions": ["component_count"],
      "graph.metrics": ["mature_sessions"],
      "graph.show_values": true,
    },
    size: { width: 12, height: 9 },
  });
}

function p95Performance(modelId: number): DashboardCardSpec {
  return defineCard({
    name: "P95 performance trends",
    description:
      "Mean of dimension-level p95 facts for trend demonstration; not a global percentile.",
    display: "line",
    query: `
WITH reliability AS ${modelReference(modelId)}
SELECT metric_date, metric_name,
       ROUND(AVG(metric_value), 1) AS dimension_mean_p95_ms
FROM reliability
WHERE row_kind = 'metric'
  AND metric_family = 'performance'
  AND metric_name LIKE '%_p95'
GROUP BY metric_date, metric_name
ORDER BY metric_date, metric_name
    `,
    resultColumns: ["metric_date", "metric_name", "dimension_mean_p95_ms"],
    visualizationSettings: {
      "graph.dimensions": ["metric_date", "metric_name"],
      "graph.metrics": ["dimension_mean_p95_ms"],
    },
    size: { width: 24, height: 8 },
  });
}

export function intentCards(modelId: number): readonly DashboardCardSpec[] {
  return [topIntents(modelId), featureAdoption(modelId)];
}

export function reliabilityCards(
  modelId: number,
): readonly DashboardCardSpec[] {
  return [
    errorTaxonomy(modelId),
    frictionDistribution(modelId),
    p95Performance(modelId),
  ];
}
