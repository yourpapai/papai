/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

export const SYNTHETIC_MARKER = "[SYNTHETIC ONLY]";

export type ModelKey =
  | "activation"
  | "engagement"
  | "intents"
  | "reliability";

export interface ModelDefinition {
  readonly key: ModelKey;
  readonly fileName: string;
  readonly name: string;
  readonly description: string;
}

export interface DashboardCardSpec {
  readonly name: string;
  readonly description: string;
  readonly display: "bar" | "line" | "scalar" | "table";
  readonly query: string;
  readonly resultColumns: readonly string[];
  readonly visualizationSettings: Readonly<Record<string, unknown>>;
  readonly size: Readonly<{ width: number; height: number }>;
}

export interface DashboardSpec {
  readonly key: "activation" | "retention" | "intents" | "reliability";
  readonly name: string;
  readonly description: string;
  readonly cards: readonly DashboardCardSpec[];
}

export function modelReference(modelId: number): string {
  return `{{#${modelId}}}`;
}

export function defineCard(input: {
  readonly name: string;
  readonly description: string;
  readonly display: DashboardCardSpec["display"];
  readonly query: string;
  readonly resultColumns: readonly string[];
  readonly visualizationSettings: Readonly<Record<string, unknown>>;
  readonly size?: DashboardCardSpec["size"];
}): DashboardCardSpec {
  return {
    name: `${SYNTHETIC_MARKER} ${input.name}`,
    description: `${SYNTHETIC_MARKER} ${input.description}`,
    display: input.display,
    query: input.query.trim(),
    resultColumns: input.resultColumns,
    visualizationSettings: input.visualizationSettings,
    size: input.size ?? { width: 12, height: 8 },
  };
}
