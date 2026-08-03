/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import {
  activationCards,
  retentionCards,
} from "./dashboard-activation-retention.js";
import {
  intentCards,
  reliabilityCards,
} from "./dashboard-intents-reliability.js";
import {
  SYNTHETIC_MARKER,
  type DashboardSpec,
  type ModelDefinition,
  type ModelKey,
} from "./dashboard-types.js";

export {
  SYNTHETIC_MARKER,
  type DashboardCardSpec,
  type DashboardSpec,
  type ModelDefinition,
  type ModelKey,
} from "./dashboard-types.js";

export const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    key: "activation",
    fileName: "01-activation.sql",
    name: `${SYNTHETIC_MARKER} Activation actors`,
    description:
      "One row per synthetic actor, derived from authorized DM through first mutating semantic success.",
  },
  {
    key: "engagement",
    fileName: "02-retention-engagement.sql",
    name: `${SYNTHETIC_MARKER} Retention and engagement`,
    description:
      "Synthetic daily engagement and exact-calendar D1/D7/D30 cohort facts.",
  },
  {
    key: "intents",
    fileName: "03-intents-features.sql",
    name: `${SYNTHETIC_MARKER} Intents, tools, and features`,
    description:
      "Synthetic intent outcomes, tool outcomes, and feature opportunities and uses.",
  },
  {
    key: "reliability",
    fileName: "04-reliability-friction-performance.sql",
    name: `${SYNTHETIC_MARKER} Reliability, friction, and performance`,
    description:
      "Synthetic error rates, performance percentiles, experience coverage, and Friction Signature v1.",
  },
];

function dashboard(
  key: DashboardSpec["key"],
  title: string,
  description: string,
  cards: DashboardSpec["cards"],
): DashboardSpec {
  return {
    key,
    name: `${title} - ${SYNTHETIC_MARKER}`,
    description,
    cards,
  };
}

export function buildDashboardSpecs(
  modelIds: Readonly<Record<ModelKey, number>>,
): readonly DashboardSpec[] {
  const description =
    `${SYNTHETIC_MARKER} Disposable PoC over the deterministic, content-free ` +
    "papai analytics fixture. Rates validate semantics and usability, not real product behavior.";
  return [
    dashboard(
      "activation",
      "Activation",
      description,
      activationCards(modelIds.activation),
    ),
    dashboard(
      "retention",
      "Retention",
      description,
      retentionCards(modelIds.engagement),
    ),
    dashboard(
      "intents",
      "Intents",
      description,
      intentCards(modelIds.intents),
    ),
    dashboard(
      "reliability",
      "Reliability",
      description,
      reliabilityCards(modelIds.reliability),
    ),
  ];
}
