<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reproducing and validating the agent-memory research

This guide has two different workflows:

1. validate the immutable checked-in artifacts without executing benchmarks;
2. rerun the 60-scenario development track to evaluate the current
   implementation.

The checked-in sealed and storage artifacts are one-shot protocol records. Do
not rerun them into their canonical paths and do not replace them with output
from the current worktree.

Run every command from the repository root.

## Recorded environment

The reports record this generation environment:

| Property                  | Recorded value                                    |
| ------------------------- | ------------------------------------------------- |
| Bun                       | `1.3.13`                                          |
| OS / architecture         | `darwin` / `arm64`                                |
| CPU                       | Apple M2 Max, 12 logical CPUs                     |
| Total memory              | 103,079,215,104 bytes                             |
| Repository revision       | `eab9ed2b4e2dac0279d338436b59c3a89d87bc8a`        |
| Worktree                  | Dirty                                             |
| Seed                      | `20260723`                                        |
| Embedding                 | `papai-deterministic-bilingual-v1`, 64 dimensions |
| Component query timeout   | 5,000 ms                                          |
| Component worker deadline | 120,000 ms                                        |
| Storage query timeout     | 5,000 ms                                          |
| Storage worker deadline   | 180,000 ms                                        |

The deterministic track requires no network, API key, hosted model,
proprietary service, or managed database at execution time. Dependencies are
pinned by `bun.lock`. Structural validation can run on another platform, but
latency and RSS comparisons require the recorded environment or a separately
reported comparable environment.

The protocol-v4 reports bind a dirty worktree through 114 embedded per-file
checksums and implementation SHA-256
`540ebcdd75ca9cb77fae3b18d52033cc5af32f04eabe8dd7a5515e2d6d6891cf`.
The revision by itself is insufficient. License headers, operational-query
redaction, raw-hit validation, provenance-aware safety gates, tests, the
protocol, and the implementation plan were all frozen before v4 execution, so
the checked-in inventoried source bytes can be compared directly with the
embedded source table.

## Validate the checked-in artifacts

### 1. Verify byte-level checksums

```sh
shasum -a 256 \
  docs/research/agent-memory/raw/v4-20260723/dev-1000/component.json \
  docs/research/agent-memory/raw/v4-20260723/dev-1000/component.md \
  docs/research/agent-memory/raw/v4-20260723/sealed-1000/component.json \
  docs/research/agent-memory/raw/v4-20260723/sealed-1000/component.md \
  docs/research/agent-memory/raw/v4-20260723/sealed-10000/component.json \
  docs/research/agent-memory/raw/v4-20260723/sealed-10000/component.md \
  docs/research/agent-memory/raw/v4-20260723/storage-100000/storage.json \
  docs/research/agent-memory/raw/v4-20260723/decision-analysis.json \
  docs/research/agent-memory/04-results.json \
  docs/research/agent-memory/04-results.md
```

The expected values are listed in
[03-benchmark-and-corpus.md](03-benchmark-and-corpus.md#checked-in-artifact-hashes).
Also verify that the published JSON is the exact primary report:

```sh
cmp \
  docs/research/agent-memory/raw/v4-20260723/sealed-10000/component.json \
  docs/research/agent-memory/04-results.json
```

### 2. Validate schemas and internal closure

This command reads the existing files. It does not run an experiment or write
outputs.

```sh
bun -e '
import { validateDecisionAnalysis } from "./scripts/memory-research/decision-analysis.ts";
import { validateResearchReport } from "./scripts/memory-research/report.ts";
import { validateFrozenStorageReport } from "./scripts/memory-research/storage-report.ts";

const read = async (path) => JSON.parse(await Bun.file(path).text());
const root = "docs/research/agent-memory";

validateResearchReport(await read(`${root}/raw/v4-20260723/dev-1000/component.json`));
validateResearchReport(await read(`${root}/raw/v4-20260723/sealed-1000/component.json`));
validateResearchReport(await read(`${root}/raw/v4-20260723/sealed-10000/component.json`));
validateFrozenStorageReport(await read(`${root}/raw/v4-20260723/storage-100000/storage.json`));
validateDecisionAnalysis(await read(`${root}/raw/v4-20260723/decision-analysis.json`));

console.log("validated component, storage, and decision artifacts");
'
```

The validators check, among other things:

- corpus and split identities;
- internal closure of the embedded 114-path source inventory and
  implementation digest;
- candidate versions, lifecycle order, raw-hit
  count/rank/uniqueness/payload bounds, query metrics, aggregates, failures,
  resource closure, provenance-aware designated safety gates, and rebuild
  probes;
- the frozen 100,000-record workload and storage threshold decision; and
- weighted-score components, paired-comparison point closure, promotions,
  graph costs and ratios, representation selection, and selected storage.

Decision-sidecar validation checks the recorded confidence intervals wherever
they feed comparison, promotion, graph, and final-decision closure. It does not
independently regenerate bootstrap samples from separate hashed component
artifacts; that limitation is published in the sidecar and result report.

The operational-query boundary is verified by the frozen runner source and
dedicated spy tests; candidate call arguments cannot be reconstructed
independently from persisted reports.

The schema validators do not read the live source tree. Compare the current
inventoried bytes with the executed source identity using this separate
read-only check:

```sh
bun -e '
import {
  discoverResearchSourcePaths,
  hashResearchSourceFiles,
  validateResearchReport,
} from "./scripts/memory-research/report.ts";

const path = "docs/research/agent-memory/raw/v4-20260723/sealed-10000/component.json";
const recorded = validateResearchReport(await Bun.file(path).json());
const paths = await discoverResearchSourcePaths(process.cwd());
const current = await hashResearchSourceFiles(process.cwd(), paths);

if (
  current.implementationSha256 !== recorded.implementationSha256 ||
  JSON.stringify(current.files) !== JSON.stringify(recorded.sourceFiles)
) {
  throw new Error("current inventoried source differs from executed v4 source");
}
console.log(
  `matched ${current.files.length} executed source files: ${current.implementationSha256}`,
);
'
```

### 3. Verify the frozen corpus identity

Module initialization recomputes the canonical corpus digest and fails if it no
longer matches the source literal.

```sh
bun -e '
import { FROZEN_SCENARIO_MANIFEST } from "./scripts/memory-research/manifest.ts";
console.log(JSON.stringify(FROZEN_SCENARIO_MANIFEST, null, 2));
'
```

The required identity is:

```text
memory-scenario-manifest-v3
283044dbd97c119b5b76a639f4f28792e4ff12cc0bdc73e6a81761b083bb12f7
```

The development and sealed selection hashes are, respectively:

```text
73b33683d473df9dd90fd219d85ca2fa01be070003e26e33f52504518df8b19f
f33c032f5fba2a870e9261041204bd4713860c25bdc738c5bfeff3e04d6623a2
```

The complete source inventory contains 114 paths. Its ordered path-set digest
and executed implementation digest are:

```text
paths:          f93e8dba1d29f9c95db42c3453312ba01f3ccc2e952a2f9fc602ce552efe7ff0
implementation: 540ebcdd75ca9cb77fae3b18d52033cc5af32f04eabe8dd7a5515e2d6d6891cf
```

### 4. Run code-level verification

These commands test the research implementation; they do not execute the
canonical development, sealed, or 100,000-record benchmark commands.

```sh
bun run test:memory-research
bun run typecheck
bun run lint
bun run format:check
```

The focused pre-existing memory regression baseline is:

```sh
bun test \
  tests/long-term-memory \
  tests/db/long-term-memory-schema.test.ts \
  tests/db/migrations/053_long_term_memory.test.ts \
  tests/db/migrations/056_provisional_memory.test.ts \
  tests/debug/settings/memory-routes.test.ts \
  tests/llm-history.test.ts \
  tests/memory-context-block.test.ts \
  tests/memory-tool-pairing.test.ts \
  tests/memory-tool-steps.test.ts \
  tests/memory.test.ts \
  tests/persistence-ac.test.ts \
  tests/system-prompt-memory-search.test.ts \
  tests/tools/memory.test.ts
```

## Rerun the development track

Development is the only protocol-v4 track intended for iteration. Use an
explicit scratch output so the checked-in record remains untouched:

```sh
bun run research:memory \
  --split dev \
  --candidate all \
  --scale 1000 \
  --seed 20260723 \
  --output /tmp/papai-memory-dev-v4/component.json
```

The command writes both `component.json` and `component.md`. If those
development outputs already exist, choose a new path or explicitly pass
`--overwrite`. The overwrite flag is accepted only as development-output
policy; it never permits overwriting a sealed output.

A development rerun recomputes the worktree's current implementation identity.
The output is useful for regression and comparison, but resource timings,
worker metadata, and the different split mean it is not a byte-for-byte copy of
the sealed evidence.

Custom seeds, candidate subsets, and public dataset imports require an explicit
`--output` path. A local public-dataset argument has this form:

```text
--public-dataset 'dataset|profile|absolute-or-relative-path[|competency]'
```

Import validation alone still reports the official protocol as `not_run`.
Reader, judge, prompt, dataset revision, and retrieval-depth execution must be
implemented and reported as a separate public-benchmark track.

## Executed one-shot v4 commands

The following commands document how the frozen raw artifacts were addressed.
They are provenance records, not instructions to replace the checked-in files.
Running them now against the canonical paths will fail by design because the
outputs already exist.

Sealed 1,000-record sensitivity:

```sh
bun run research:memory \
  --split sealed-test \
  --candidate all \
  --scale 1000 \
  --seed 20260723 \
  --output docs/research/agent-memory/raw/v4-20260723/sealed-1000/component.json
```

Sealed 10,000-record primary:

```sh
bun run research:memory \
  --split sealed-test \
  --candidate all \
  --scale 10000 \
  --seed 20260723 \
  --output docs/research/agent-memory/raw/v4-20260723/sealed-10000/component.json
```

Frozen 100,000-record storage track:

```sh
bun run research:memory:storage \
  --candidate all \
  --seed 20260723 \
  --query-timeout-ms 5000 \
  --worker-deadline-ms 180000 \
  --output docs/research/agent-memory/raw/v4-20260723/storage-100000/storage.json
```

Cross-scale publication:

```sh
bun run research:memory:publish \
  --primary docs/research/agent-memory/raw/v4-20260723/sealed-10000/component.json \
  --sensitivity docs/research/agent-memory/raw/v4-20260723/sealed-1000/component.json \
  --storage docs/research/agent-memory/raw/v4-20260723/storage-100000/storage.json \
  --analysis docs/research/agent-memory/raw/v4-20260723/decision-analysis.json \
  --results docs/research/agent-memory/04-results.json \
  --markdown docs/research/agent-memory/04-results.md
```

The publisher validates all three input reports, records their byte-level
SHA-256 values in the decision sidecar, copies the primary report bytes to
`04-results.json`, and renders `04-results.md`.

## No-clobber and one-shot policy

Output protection is part of the research contract:

- The component CLI reserves both JSON and Markdown outputs before importing
  data or starting candidate work.
- Existing development output requires `--overwrite`.
- Existing sealed output is rejected even when `--overwrite` is present.
- The 100,000-record storage CLI always rejects an existing output.
- The publisher reserves the analysis, result JSON, and result Markdown before
  reading inputs and rejects any existing output.
- Reservation uses exclusive `.lock` files. Sealed and publication outputs are
  installed from temporary files with no-clobber hard links; partial
  publication is removed on failure.
- `04-results.json` and `04-results.md` are reserved for the publisher and
  cannot be direct component-runner outputs.

The 180-scenario sealed split is executed once per frozen candidate
configuration, except for a fully documented invalid-run restart. A logic,
weight, label, or query change requires a new protocol result. A corpus change
also requires a new corpus/manifest version and digest. Use a new output root;
never delete or replace the preserved v3 or canonical v4 artifacts to make a
command succeed.

Protocol-v3 artifacts remain under `raw/v3-20260723/`, with their former
canonical publication archived as `published-04-results.json` and
`published-04-results.md`. They are a superseded validity record and are not
pooled with v4.

## Public benchmark status

LongMemEval, LoCoMo, MemBench, and MemoryAgentBench were not supplied and their
official reader/judge protocols were not run. All checked-in reports therefore
record `importStatus: not_supplied`, `protocolStatus: not_run`, and a null source
hash. The deterministic synthetic component result must not be described as a
reproduction of any of those benchmarks.
