/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import { expect, test } from "bun:test";
import {
  MetabaseApiError,
  MetabaseClient,
  buildNativeDatasetQuery,
} from "./metabase-api.js";

test("builds a native query without adding permissive template tags", () => {
  expect(buildNativeDatasetQuery(2, "SELECT 1")).toEqual({
    database: 2,
    type: "native",
    native: {
      query: "SELECT 1",
      "template-tags": {},
    },
  });
});

test("declares saved-model references for server-side expansion", () => {
  expect(
    buildNativeDatasetQuery(
      2,
      "WITH model AS {{#41}} SELECT COUNT(*) FROM model",
    ).native["template-tags"],
  ).toEqual({
    "#41": {
      id: "poc-saved-card-41",
      name: "#41",
      "display-name": "#41",
      type: "card",
      "card-id": 41,
    },
  });
});

test("keeps the session secret in the Metabase header", async () => {
  const requests: Request[] = [];
  const fakeFetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request);
    return Promise.resolve(Response.json({ id: 41 }));
  };
  const client = new MetabaseClient({
    baseUrl: "http://127.0.0.1:4300/",
    session: "synthetic-session-secret",
    fetch: fakeFetch,
  });

  await client.createDashboard({
    name: "[SYNTHETIC ONLY] Activation",
    description: "Synthetic fixture",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("http://127.0.0.1:4300/api/dashboard");
  expect(requests[0]?.headers.get("x-metabase-session")).toBe(
    "synthetic-session-secret",
  );
  expect(await requests[0]?.text()).not.toContain("synthetic-session-secret");
});

function nonPdfResponse(): Promise<Response> {
  return Promise.resolve(
    new Response("<html>render failed</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
}

async function rejectsNonPdfDashboardRender(): Promise<void> {
  const client = new MetabaseClient({
    baseUrl: "http://127.0.0.1:4300",
    session: "synthetic-session-secret",
    fetch: nonPdfResponse,
  });

  try {
    await client.renderDashboardPdf(9);
    throw new Error("Expected the non-PDF response to be rejected");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(MetabaseApiError);
  }
}

test("rejects a non-PDF dashboard render", rejectsNonPdfDashboardRender);
