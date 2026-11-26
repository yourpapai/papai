<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Source-code AST scanning (plugin entry-graph discovery, story scenario
extraction, story marker scanning) parses source text in-process without
spawning any child process, so the hermetic story lane can deny every spawn
and the runtime carries no compiler-process dependency.

## ADDED Requirements

### Requirement: In-process parsing with no child process

Every AST scanner SHALL parse source text through an in-process parser and
MUST NOT spawn a child process, execute an external binary, or depend on the
TypeScript project/`tsgo` child-process API to obtain a syntax tree.

#### Scenario: parsing during a hermetic scenario

- **WHEN** plugin entry-graph discovery or story scenario extraction runs
  inside a hermetic story scenario under the I/O guard
- **THEN** no child-process spawn is attempted and no hermetic I/O violation
  is raised, with no spawn allowance configured for any compiler binary

#### Scenario: guard denies every spawn

- **WHEN** code under a hermetic scenario attempts to spawn any executable —
  including a binary whose path matches a TypeScript platform package inside
  the scenario execution root
- **THEN** the attempt fails as a hermetic I/O violation

### Requirement: Parser output parity

The in-process parser SHALL produce scanning output identical to the previous
`typescript/unstable`-based parser for every existing scanner, proven before
migration by a parity oracle: identical extracted scenario ids and checkpoint
chains over the full story corpus, and identical plugin source graphs and
manifest hashes over the repository's real plugins.

#### Scenario: story corpus parity

- **WHEN** scenario extraction runs over every story test file with both the
  previous parser and the in-process parser
- **THEN** the extracted scenario ids and checkpoint chains are identical for
  every file

#### Scenario: plugin graph parity

- **WHEN** plugin entry-graph discovery runs over the repository's plugins
  with both parsers
- **THEN** the discovered plugin set, each plugin's ordered source file list,
  and each manifest hash are identical

### Requirement: Scanner contracts preserved

The scanners SHALL preserve their existing observable contracts: non-literal
dynamic imports and non-literal `import.meta.require` specifiers MUST fail
plugin discovery (not pass silently), bare-module imports in a plugin entry
graph MUST be rejected, and parsing MUST remain asynchronous at the public
seam.

#### Scenario: non-literal dynamic import still fails discovery

- **WHEN** a plugin source contains a dynamic import or `import.meta.require`
  whose specifier is not a string literal or plain template literal
- **THEN** discovery reports that plugin as an error rather than skipping the
  import

#### Scenario: bare-module import still rejected

- **WHEN** a plugin entry-graph source imports a bare module specifier
- **THEN** discovery reports that plugin as an error

### Requirement: Runtime image carries no compiler process

The production dependency tree MUST NOT include the TypeScript compiler or
its platform-specific binary packages; the compiler remains a development
dependency used for typechecking.

#### Scenario: production install

- **WHEN** `bun install --frozen-lockfile --production` completes
- **THEN** no `typescript` package or `@typescript/typescript-<os>-<cpu>`
  package is installed

### Requirement: Stryker tsconfig sentinel is pinned

The mutation gate's tsconfig-rewrite disable SHALL be pinned by a test that
asserts the configured `tsconfigFile` value and that the referenced file does
not exist, so the sentinel fails loudly if changed or "fixed".

#### Scenario: sentinel value changes

- **WHEN** `stryker.config.json`'s `tsconfigFile` is changed or the sentinel
  file is created
- **THEN** the pinning test fails and names the README section explaining the
  sentinel

### Requirement: TypeScript drift canary

A scheduled CI job SHALL install the latest released TypeScript and run the
typecheck plus a plugin-discovery smoke, so compiler drift under the caret
range surfaces on a schedule rather than during feature work.

#### Scenario: nightly canary run

- **WHEN** the scheduled job runs with `typescript@latest`
- **THEN** typecheck and discovery smoke results are reported as job status
