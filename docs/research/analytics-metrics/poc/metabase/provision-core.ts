/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pLimit from "p-limit";
import {
  MODEL_DEFINITIONS,
  buildDashboardSpecs,
  type DashboardCardSpec,
  type DashboardSpec,
  type ModelDefinition,
  type ModelKey,
} from "./dashboard-specs.js";
import {
  MetabaseApiError,
  MetabaseClient,
  buildNativeDatasetQuery,
  type QueryResult,
} from "./metabase-api.js";

export interface ProvisionInput {
  readonly baseUrl: string;
  readonly databaseId: number;
  readonly session: string;
  readonly manifestPath: string;
  readonly pdfDirectory: string;
}

interface ValidatedQuery {
  readonly rowCount: number;
  readonly columnCount: number;
}

interface ModelEvidence {
  readonly key: ModelKey;
  readonly id: number;
  readonly name: string;
  readonly source_file: string;
  readonly query_validation: ValidatedQuery;
}

interface CardEvidence {
  readonly id: number;
  readonly name: string;
  readonly display: string;
  readonly result_columns: readonly string[];
  readonly query_validation: ValidatedQuery;
}

interface DashboardEvidence {
  readonly key: DashboardSpec["key"];
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly cards: readonly CardEvidence[];
  readonly pdf_file: string;
  readonly pdf_sha256: string;
  readonly pdf_bytes: number;
}

function validateQuery(result: QueryResult, label: string): ValidatedQuery {
  if (result.error !== undefined || result.status === "failed") {
    throw new MetabaseApiError(
      `${label} query failed: ${result.error ?? result.status}`,
    );
  }
  const rows = result.data?.rows;
  const columns = result.data?.cols;
  if (rows === undefined || columns === undefined) {
    throw new MetabaseApiError(`${label} query returned no rows or columns`);
  }
  return { rowCount: rows.length, columnCount: columns.length };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createModel(
  client: MetabaseClient,
  databaseId: number,
  definition: ModelDefinition,
): Promise<ModelEvidence> {
  const query = await Bun.file(
    join(import.meta.dir, "sql", definition.fileName),
  ).text();
  const created = await client.createCard({
    name: definition.name,
    description: definition.description,
    datasetQuery: buildNativeDatasetQuery(databaseId, query),
    display: "table",
    visualizationSettings: {},
    type: "model",
    collectionId: null,
  });
  return {
    key: definition.key,
    id: created.id,
    name: definition.name,
    source_file: `sql/${definition.fileName}`,
    query_validation: validateQuery(
      await client.queryCard(created.id),
      definition.name,
    ),
  };
}

async function createDashboardCard(
  client: MetabaseClient,
  databaseId: number,
  dashboardId: number,
  card: DashboardCardSpec,
): Promise<CardEvidence> {
  const created = await client.createCard({
    name: card.name,
    description: card.description,
    datasetQuery: buildNativeDatasetQuery(databaseId, card.query),
    display: card.display,
    visualizationSettings: card.visualizationSettings,
    dashboardId,
    size: card.size,
  });
  return {
    id: created.id,
    name: card.name,
    display: card.display,
    result_columns: card.resultColumns,
    query_validation: validateQuery(
      await client.queryCard(created.id),
      card.name,
    ),
  };
}

async function createDashboard(
  client: MetabaseClient,
  databaseId: number,
  baseUrl: string,
  pdfDirectory: string,
  specification: DashboardSpec,
): Promise<DashboardEvidence> {
  const dashboard = await client.createDashboard({
    name: specification.name,
    description: specification.description,
  });
  const limit = pLimit(1);
  const cards = await Promise.all(
    specification.cards.map((card) =>
      limit(() => createDashboardCard(client, databaseId, dashboard.id, card)),
    ),
  );
  const pdf = await client.renderDashboardPdf(dashboard.id);
  const pdfFile = `${specification.key}.pdf`;
  await writeFile(join(pdfDirectory, pdfFile), pdf);
  return {
    key: specification.key,
    id: dashboard.id,
    name: specification.name,
    url: `${baseUrl.replace(/\/$/u, "")}/dashboard/${dashboard.id}`,
    cards,
    pdf_file: pdfFile,
    pdf_sha256: sha256(pdf),
    pdf_bytes: pdf.byteLength,
  };
}

function modelIdsFromEvidence(
  evidence: readonly ModelEvidence[],
): Record<ModelKey, number> {
  function idFor(key: ModelKey): number {
    const model = evidence.find((candidate) => candidate.key === key);
    if (model === undefined) throw new Error(`Missing model evidence: ${key}`);
    return model.id;
  }
  return {
    activation: idFor("activation"),
    engagement: idFor("engagement"),
    intents: idFor("intents"),
    reliability: idFor("reliability"),
  };
}

function provisionModels(
  client: MetabaseClient,
  databaseId: number,
): Promise<readonly ModelEvidence[]> {
  const limit = pLimit(2);
  return Promise.all(
    MODEL_DEFINITIONS.map((definition) =>
      limit(() => createModel(client, databaseId, definition)),
    ),
  );
}

function provisionDashboards(
  client: MetabaseClient,
  databaseId: number,
  baseUrl: string,
  pdfDirectory: string,
  models: readonly ModelEvidence[],
): Promise<readonly DashboardEvidence[]> {
  const limit = pLimit(2);
  const specifications = buildDashboardSpecs(modelIdsFromEvidence(models));
  return Promise.all(
    specifications.map((specification) =>
      limit(() =>
        createDashboard(
          client,
          databaseId,
          baseUrl,
          pdfDirectory,
          specification,
        ),
      ),
    ),
  );
}

export async function provisionMetabase(
  input: ProvisionInput,
): Promise<{ readonly dashboardCount: number }> {
  const client = new MetabaseClient({
    baseUrl: input.baseUrl,
    session: input.session,
  });
  await Promise.all([
    mkdir(dirname(input.manifestPath), { recursive: true }),
    mkdir(input.pdfDirectory, { recursive: true }),
  ]);
  const models = await provisionModels(client, input.databaseId);
  const dashboards = await provisionDashboards(
    client,
    input.databaseId,
    input.baseUrl,
    input.pdfDirectory,
    models,
  );
  const manifest = {
    evidence_version: 1,
    synthetic_only: true,
    generated_at: new Date().toISOString(),
    fixture_contract: "papai-analytics-fixture-v1",
    metabase_url: input.baseUrl,
    database_id: input.databaseId,
    source_access: "read-only SQLite snapshot",
    models,
    dashboards,
  };
  await writeFile(
    input.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { dashboardCount: dashboards.length };
}
