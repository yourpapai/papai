/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import { provisionMetabase } from "./provision-core.js";

interface Arguments {
  readonly manifestPath: string;
  readonly pdfDirectory: string;
}

function parseArguments(values: readonly string[]): Arguments {
  let manifestPath =
    "/private/tmp/papai-analytics-metabase-evidence/manifest.json";
  let pdfDirectory = "/private/tmp/papai-analytics-metabase-evidence/pdf";
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === "--manifest") manifestPath = value;
    else if (flag === "--pdf-dir") pdfDirectory = value;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return { manifestPath, pdfDirectory };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseDatabaseId(value: string | undefined): number {
  const databaseId = Number(value ?? "2");
  if (!Number.isInteger(databaseId) || databaseId <= 0) {
    throw new Error("METABASE_DATABASE_ID must be a positive integer");
  }
  return databaseId;
}

async function run(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const result = await provisionMetabase({
    baseUrl: process.env["METABASE_URL"] ?? "http://127.0.0.1:4300",
    databaseId: parseDatabaseId(process.env["METABASE_DATABASE_ID"]),
    session: requiredEnvironment("METABASE_SESSION"),
    manifestPath: args.manifestPath,
    pdfDirectory: args.pdfDirectory,
  });
  console.log(
    JSON.stringify({
      status: "ok",
      synthetic_only: true,
      manifest: args.manifestPath,
      dashboard_count: result.dashboardCount,
    }),
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "error", message }));
  process.exitCode = 1;
});
