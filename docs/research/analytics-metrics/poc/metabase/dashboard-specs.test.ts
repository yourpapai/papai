/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import { expect, test } from "bun:test";
import {
  MODEL_DEFINITIONS,
  SYNTHETIC_MARKER,
  buildDashboardSpecs,
} from "./dashboard-specs.js";

const dashboards = buildDashboardSpecs({
  activation: 101,
  engagement: 102,
  intents: 103,
  reliability: 104,
});

test("covers every reviewed model and required dashboard family", () => {
  expect(MODEL_DEFINITIONS.map((model) => model.key)).toEqual([
    "activation",
    "engagement",
    "intents",
    "reliability",
  ]);
  expect(dashboards.map((dashboard) => dashboard.key)).toEqual([
    "activation",
    "retention",
    "intents",
    "reliability",
  ]);
  expect(dashboards.every((dashboard) => dashboard.cards.length >= 2)).toBe(
    true,
  );
});

test("marks every rendered surface as synthetic-only", () => {
  for (const dashboard of dashboards) {
    expect(dashboard.name).toContain(SYNTHETIC_MARKER);
    expect(dashboard.description).toContain(SYNTHETIC_MARKER);
    for (const card of dashboard.cards) {
      expect(card.name.startsWith(SYNTHETIC_MARKER)).toBe(true);
      expect(card.description).toContain(SYNTHETIC_MARKER);
    }
  }
});

test("dashboard cards expose only aggregate result columns", () => {
  const forbiddenColumns = [
    "actor_key",
    "context_key",
    "thread_key",
    "turn_key",
    "session_key",
    "platform_instance_key",
    "task_instance_key",
    "event_id",
    "props_json",
  ];

  for (const dashboard of dashboards) {
    for (const card of dashboard.cards) {
      for (const forbiddenColumn of forbiddenColumns) {
        expect(card.resultColumns).not.toContain(forbiddenColumn);
      }
    }
  }
});

test("references each saved model with Metabase's documented syntax", () => {
  const allQueries = dashboards.flatMap((dashboard) =>
    dashboard.cards.map((card) => card.query),
  );

  for (const modelId of [101, 102, 103, 104]) {
    expect(allQueries.some((query) => query.includes(`{{#${modelId}}}`))).toBe(
      true,
    );
  }
});
