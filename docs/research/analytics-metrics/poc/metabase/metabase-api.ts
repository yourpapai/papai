/*
 * SPDX-License-Identifier: BUSL-1.1
 * Copyright (c) 2026 Dmitriy Lazarev
 * Use of this software is governed by the Business Source License 1.1.
 * See LICENSE in the project root for details.
 */

import { MetabaseApiError } from "./metabase-error.js";

export { MetabaseApiError } from "./metabase-error.js";

export interface NativeDatasetQuery {
  readonly database: number;
  readonly type: "native";
  readonly native: {
    readonly query: string;
    readonly "template-tags": Readonly<
      Record<
        string,
        {
          readonly id: string;
          readonly name: string;
          readonly "display-name": string;
          readonly type: "card";
          readonly "card-id": number;
        }
      >
    >;
  };
}

export interface CreatedEntity {
  readonly id: number;
}

export interface CreateCardInput {
  readonly name: string;
  readonly description: string;
  readonly datasetQuery: NativeDatasetQuery;
  readonly display: string;
  readonly visualizationSettings: Readonly<Record<string, unknown>>;
  readonly type?: "model";
  readonly collectionId?: number | null;
  readonly dashboardId?: number;
  readonly size?: Readonly<{ width: number; height: number }>;
}

export interface QueryResult {
  readonly data?: {
    readonly rows?: readonly unknown[][];
    readonly cols?: readonly Readonly<Record<string, unknown>>[];
  };
  readonly status?: string;
  readonly error?: string;
}

interface ClientOptions {
  readonly baseUrl: string;
  readonly session: string;
  readonly fetch?: FetchImplementation;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function buildNativeDatasetQuery(
  databaseId: number,
  query: string,
): NativeDatasetQuery {
  const templateTags: Record<
    string,
    {
      readonly id: string;
      readonly name: string;
      readonly "display-name": string;
      readonly type: "card";
      readonly "card-id": number;
    }
  > = {};
  for (const match of query.matchAll(/\{\{#(\d+)(?:-[^}]*)?\}\}/gu)) {
    const rawId = match[1];
    if (rawId === undefined) continue;
    const cardId = Number(rawId);
    const name = `#${cardId}`;
    templateTags[name] = {
      id: `poc-saved-card-${cardId}`,
      name,
      "display-name": name,
      type: "card",
      "card-id": cardId,
    };
  }
  return {
    database: databaseId,
    type: "native",
    native: {
      query,
      "template-tags": templateTags,
    },
  };
}

function parseEntity(value: unknown, operation: string): CreatedEntity {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "number"
  ) {
    throw new MetabaseApiError(`${operation} returned no numeric id`);
  }
  return { id: value.id };
}

export class MetabaseClient {
  private readonly baseUrl: URL;
  private readonly session: string;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: ClientOptions) {
    this.baseUrl = new URL(
      options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
    );
    this.session = options.session;
    this.fetchImplementation =
      options.fetch ??
      ((input, init): Promise<Response> => fetch(input, init));
  }

  private async requestJson(
    path: string,
    init: Readonly<RequestInit>,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-metabase-session", this.session);
    const response = await this.fetchImplementation(
      new URL(path.replace(/^\//u, ""), this.baseUrl),
      {
        ...init,
        headers,
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new MetabaseApiError(
        `Metabase ${init.method ?? "GET"} ${path} failed: ${detail}`,
        response.status,
      );
    }
    return response.json();
  }

  async createCard(input: CreateCardInput): Promise<CreatedEntity> {
    const payload: Record<string, unknown> = {
      name: input.name,
      description: input.description,
      dataset_query: input.datasetQuery,
      display: input.display,
      visualization_settings: input.visualizationSettings,
    };
    if (input.type !== undefined) payload["type"] = input.type;
    if (input.collectionId !== undefined) {
      payload["collection_id"] = input.collectionId;
    }
    if (input.dashboardId !== undefined) {
      payload["dashboard_id"] = input.dashboardId;
    }
    if (input.size !== undefined) {
      payload["size"] = {
        size_x: input.size.width,
        size_y: input.size.height,
      };
    }
    const result = await this.requestJson("/api/card", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return parseEntity(result, "create card");
  }

  async createDashboard(input: {
    readonly name: string;
    readonly description: string;
  }): Promise<CreatedEntity> {
    const result = await this.requestJson("/api/dashboard", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return parseEntity(result, "create dashboard");
  }

  async queryCard(cardId: number): Promise<QueryResult> {
    const result = await this.requestJson(`/api/card/${cardId}/query`, {
      method: "POST",
      body: JSON.stringify({ parameters: [] }),
    });
    if (typeof result !== "object" || result === null) {
      throw new MetabaseApiError(`query card ${cardId} returned no object`);
    }
    return result as QueryResult;
  }

  async renderDashboardPdf(dashboardId: number): Promise<Uint8Array> {
    const response = await this.fetchImplementation(
      new URL(`api/dashboard/${dashboardId}/pdf`, this.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-metabase-session": this.session,
        },
        body: JSON.stringify({ paper_size: "a4", parameters: [] }),
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().startsWith("application/pdf")) {
      const detail = (await response.text()).slice(0, 500);
      throw new MetabaseApiError(
        `Metabase dashboard ${dashboardId} PDF render failed: ${detail}`,
        response.status,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
