<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics research PoCs

Every executable artifact in this directory is synthetic-only. None of the
PoCs reads papai's runtime database, messages, operator configuration, or
production credentials.

| Artifact | Purpose |
| --- | --- |
| [`fixture/`](./fixture/) | Generate and self-check the deterministic canonical SQLite fixture |
| [`intent/`](./intent/) | Generate the frozen intent corpus and evaluate deterministic labeling strategies |
| [`metabase/`](./metabase/) | Provision and verify four local-BI dashboards from reviewed SQLite models |
| [`openpanel/`](./openpanel/) | Exercise strict mapping, delivery-ledger replay behavior, and the product-analytics candidate |

The reviewed fixture contains 17,183 unique events for 200 visibly synthetic
actors over 50 UTC dates. Its SHA-256 is
`cd2701862d5ceb02a130cd26899ecfd710da867d739569ffd980a924fc78cb2e`.
Generated SQLite files, service credentials, application state, and containers
remain outside the repository.

The PoCs prove contract and integration behavior only. Their synthetic rates
are not papai usage measurements, and neither provider is approved to receive
production pseudonymous data by these artifacts.
