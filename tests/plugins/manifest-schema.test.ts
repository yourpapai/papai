// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ParsedPluginManifest } from '../../src/plugins/types.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

/**
 * Parses a manifest that must be rejected and returns each rejection as the
 * pair a plugin author actually sees: the message telling them what is wrong
 * and the dotted field path telling them where. Asserting only that a parse
 * failed leaves both unpinned — an empty message on no field fails a parse
 * just as well, and is useless to the author reading it.
 */
const rejectionsOf = (manifest: unknown): ReadonlyArray<{ message: string; path: string }> => {
  const result = pluginManifestSchema.safeParse(manifest)

  expect(result.success).toBe(false)
  if (result.success) return []

  return result.error.issues.map((issue) => ({ message: issue.message, path: issue.path.join('.') }))
}

/**
 * One row per former case. `rejection` rows keep the author-facing pair via
 * `rejectionsOf`; plain rows pin `safeParse(...).success` exactly as before;
 * `parsedCheck` rows pin a field of the parse output with `toEqual` (identical
 * strictness to the former per-field `toBe` for primitives).
 */
type ManifestRow = Row<{
  readonly manifest: unknown
  readonly accepts?: boolean
  readonly rejection?: { readonly message: string; readonly path: string }
  readonly parsedCheck?: { readonly pick: (parsed: ParsedPluginManifest) => unknown; readonly expected: unknown }
}>

const runManifestMatrix = (rows: readonly ManifestRow[]): Promise<void> =>
  assertEach(rows, (row) => {
    if (row.rejection !== undefined) {
      expect(rejectionsOf(row.manifest)).toContainEqual(row.rejection)
      return
    }
    const result = pluginManifestSchema.safeParse(row.manifest)
    expect(result.success).toBe(row.accepts === true)
    if (row.accepts === true && row.parsedCheck !== undefined && result.success) {
      expect(row.parsedCheck.pick(result.data)).toEqual(row.parsedCheck.expected)
    }
  })

describe('pluginManifestSchema providerConfigSchema scope', () => {
  const base = {
    id: 'p',
    name: 'P',
    version: '1.0.0',
    description: 'd',
    apiVersion: 1,
    main: 'index.ts',
    permissions: ['provider.task'],
    contributes: { taskProviderTypes: ['p'] },
  }

  test('scope matrix', async () => {
    const rows: readonly ManifestRow[] = [
      {
        label: 'defaults provider config field scope to instance',
        manifest: { ...base, providerConfigSchema: [{ key: 'base_url', label: 'URL', required: true }] },
        accepts: true,
        parsedCheck: { pick: (parsed) => parsed.providerConfigSchema[0]?.scope, expected: 'instance' },
      },
      {
        label: 'rejects legacy user scope',
        manifest: {
          ...base,
          providerConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true, scope: 'user' }],
        },
      },
      {
        label: 'defaults provider context config field scope to context',
        manifest: {
          ...base,
          providerContextConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true }],
        },
        accepts: true,
        parsedCheck: { pick: (parsed) => parsed.providerContextConfigSchema?.[0]?.scope, expected: 'context' },
      },
      {
        label: 'parsed plugin manifest exposes defaulted provider arrays',
        manifest: {
          id: 'defaults-plugin',
          name: 'Defaults Plugin',
          version: '1.0.0',
          description: 'defaults',
          apiVersion: 1,
          main: 'index.ts',
        },
        accepts: true,
        parsedCheck: {
          pick: (parsed) => ({
            providerTraits: parsed.providerTraits,
            providerContextConfigSchema: parsed.providerContextConfigSchema,
          }),
          expected: { providerTraits: [], providerContextConfigSchema: [] },
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})

describe('pluginManifestSchema strict validation', () => {
  test('strict validation matrix', async () => {
    const rows: readonly ManifestRow[] = [
      {
        label: 'rejects unknown top-level manifest keys',
        manifest: {
          id: 'strict-top-level',
          name: 'Strict Top Level',
          version: '1.0.0',
          description: 'strict',
          apiVersion: 1,
          unexpected: true,
        },
      },
      {
        label: 'rejects semver strings with trailing junk',
        manifest: {
          id: 'bad-semver',
          name: 'Bad Semver',
          version: '1.0.0-beta trailing',
          description: 'strict semver',
          apiVersion: 1,
        },
      },
      {
        label: 'rejects Windows absolute main paths (drive letter)',
        manifest: {
          id: 'windows-drive-main',
          name: 'Windows Drive Main',
          version: '1.0.0',
          description: 'windows path',
          apiVersion: 1,
          main: 'C:\\plugin\\index.ts',
        },
      },
      {
        label: 'rejects Windows absolute main paths (UNC)',
        manifest: {
          id: 'windows-unc-main',
          name: 'Windows UNC Main',
          version: '1.0.0',
          description: 'windows path',
          apiVersion: 1,
          main: '\\\\server\\share\\index.ts',
        },
      },
      {
        label: 'accepts main paths whose filename contains dot-dot but no parent segment',
        manifest: {
          id: 'dotted-main',
          name: 'Dotted Main',
          version: '1.0.0',
          description: 'dotted filename',
          apiVersion: 1,
          main: 'plugin..entry.ts',
        },
        accepts: true,
      },
      {
        label: 'rejects Windows-style parent traversal main paths',
        manifest: {
          id: 'windows-parent-traversal-main',
          name: 'Windows Parent Traversal Main',
          version: '1.0.0',
          description: 'windows parent traversal',
          apiVersion: 1,
          main: '..\\outside.ts',
        },
      },
      {
        label: 'rejects raw POSIX parent-segment main paths',
        manifest: {
          id: 'posix-parent-segment-main',
          name: 'POSIX Parent Segment Main',
          version: '1.0.0',
          description: 'posix parent segment',
          apiVersion: 1,
          main: 'foo/../index.ts',
        },
      },
      {
        label: 'rejects raw POSIX parent-segment main paths (duplicate case in the original file, preserved)',
        manifest: {
          id: 'posix-parent-segment-main',
          name: 'POSIX Parent Segment Main',
          version: '1.0.0',
          description: 'posix parent segment',
          apiVersion: 1,
          main: 'foo/../index.ts',
        },
      },
      {
        label: 'rejects raw Windows parent-segment main paths',
        manifest: {
          id: 'windows-parent-segment-main',
          name: 'Windows Parent Segment Main',
          version: '1.0.0',
          description: 'windows parent segment',
          apiVersion: 1,
          main: 'foo\\..\\index.ts',
        },
      },
      {
        label: 'rejects raw Windows parent-segment main paths (duplicate case in the original file, preserved)',
        manifest: {
          id: 'windows-parent-segment-main',
          name: 'Windows Parent Segment Main',
          version: '1.0.0',
          description: 'windows parent segment',
          apiVersion: 1,
          main: 'foo\\..\\index.ts',
        },
      },
      {
        label: 'rejects configKeys without matching context-scoped config requirement',
        manifest: {
          id: 'bad-config-keys',
          name: 'Bad Config Keys',
          version: '1.0.0',
          description: 'bad config key mapping',
          apiVersion: 1,
          contributes: { configKeys: ['api_token'] },
          configRequirements: [{ key: 'other_key', label: 'Other', required: true, scope: 'context' }],
        },
        rejection: {
          message: 'Every contributes.configKeys entry must match a context-scoped configRequirements entry',
          path: 'contributes.configKeys',
        },
      },
      {
        label: 'rejects admin-scoped configKeys entries',
        manifest: {
          id: 'admin-config-key',
          name: 'Admin Config Key',
          version: '1.0.0',
          description: 'admin config key mismatch',
          apiVersion: 1,
          contributes: { configKeys: ['api_token'] },
          configRequirements: [{ key: 'api_token', label: 'API Token', required: true, scope: 'admin' }],
        },
        rejection: {
          message: 'Every contributes.configKeys entry must match a context-scoped configRequirements entry',
          path: 'contributes.configKeys',
        },
      },
      {
        label: 'rejects provider-only fields without provider.task permission',
        manifest: {
          id: 'provider-fields-without-permission',
          name: 'Provider Fields Without Permission',
          version: '1.0.0',
          description: 'provider fields without permission',
          apiVersion: 1,
          main: 'index.ts',
          providerCapabilities: ['tasks.delete'],
          providerConfigSchema: [{ key: 'base_url', label: 'Base URL', required: true }],
          providerContextConfigSchema: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true }],
          providerAllowedHosts: ['example.com'],
          providerConfigValidator: 'validateConfig',
        },
        rejection: {
          message: "Provider-only manifest fields require the 'provider.task' permission",
          path: 'permissions',
        },
      },
      {
        label: 'rejects providerConfigValidator when no task provider type is declared',
        manifest: {
          id: 'validator-without-provider-type',
          name: 'Validator Without Provider Type',
          version: '1.0.0',
          description: 'validator without provider type',
          apiVersion: 1,
          main: 'index.ts',
          permissions: ['provider.task'],
          contributes: {
            tools: [],
            promptFragments: [],
            commands: [],
            jobs: [],
            configKeys: [],
            taskProviderTypes: [],
          },
          providerConfigValidator: 'validateConfig',
        },
        rejection: {
          message: 'providerConfigValidator requires contributes.taskProviderTypes',
          path: 'providerConfigValidator',
        },
      },
      {
        label: 'accepts providerConfigValidator alongside a declared task provider type',
        manifest: {
          id: 'validator-with-provider-type',
          name: 'Validator With Provider Type',
          version: '1.0.0',
          description: 'validator with provider type',
          apiVersion: 1,
          main: 'index.ts',
          permissions: ['provider.task'],
          contributes: { taskProviderTypes: ['kaneo'] },
          providerConfigValidator: 'validateConfig',
        },
        accepts: true,
      },
      {
        label: 'accepts a manifest that declares neither a validator nor a provider type',
        manifest: {
          id: 'no-validator-no-provider',
          name: 'No Validator No Provider',
          version: '1.0.0',
          description: 'neither half of the validator pairing',
          apiVersion: 1,
          main: 'index.ts',
        },
        accepts: true,
      },
      {
        label: 'accepts providerAllowedHosts for http-only plugins',
        manifest: {
          id: 'http-host-allowlist',
          name: 'HTTP Host Allowlist',
          version: '1.0.0',
          description: 'http-only provider runtime host allowlist',
          apiVersion: 1,
          main: 'index.ts',
          permissions: ['http'],
          contributes: {
            tools: [],
            promptFragments: [],
            commands: [],
            jobs: [],
            configKeys: [],
            taskProviderTypes: [],
          },
          providerAllowedHosts: ['example.com'],
        },
        accepts: true,
      },
      {
        label: 'accepts explicit mcp-only manifests without main',
        manifest: {
          id: 'mcp-only-schema',
          name: 'MCP Only Schema',
          version: '1.0.0',
          description: 'mcp only schema',
          apiVersion: 1,
          contributes: {
            tools: [],
            promptFragments: [],
            commands: [],
            jobs: [],
            configKeys: [],
            taskProviderTypes: [],
          },
          mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
        },
        accepts: true,
        parsedCheck: { pick: (parsed) => parsed.main, expected: undefined },
      },
      {
        label: 'rejects mcp-only manifests without main when provider-only metadata is present',
        manifest: {
          id: 'mcp-only-provider-metadata',
          name: 'MCP Only Provider Metadata',
          version: '1.0.0',
          description: 'mcp only with provider metadata',
          apiVersion: 1,
          contributes: {
            tools: [],
            promptFragments: [],
            commands: [],
            jobs: [],
            configKeys: [],
            taskProviderTypes: [],
          },
          permissions: ['provider.task'],
          providerAllowedHosts: ['example.com'],
          mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
        },
        rejection: {
          message: 'main is required unless the manifest is an explicit MCP-only plugin',
          path: 'main',
        },
      },
      {
        label: 'rejects mcp manifests that also declare runtime contributions without main',
        manifest: {
          id: 'mixed-mcp-runtime',
          name: 'Mixed MCP Runtime',
          version: '1.0.0',
          description: 'mixed runtime',
          apiVersion: 1,
          contributes: {
            tools: ['search'],
            promptFragments: [],
            commands: [],
            jobs: [],
            configKeys: [],
            taskProviderTypes: [],
          },
          mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
        },
        rejection: {
          message: 'main is required unless the manifest is an explicit MCP-only plugin',
          path: 'main',
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})

describe('pluginManifestSchema contribution permissions', () => {
  const base = {
    id: 'contribution-permissions',
    name: 'Contribution Permissions',
    version: '1.0.0',
    description: 'contribution permission pairing',
    apiVersion: 1,
    main: 'index.ts',
  }

  test('contribution permission matrix', async () => {
    const rows: readonly ManifestRow[] = [
      {
        label: 'rejects contributes.commands without the commands permission',
        manifest: { ...base, contributes: { commands: ['do_thing'] }, permissions: [] },
        rejection: {
          message: "Declaring contributes.commands requires the 'commands' permission",
          path: 'permissions',
        },
      },
      {
        label: 'accepts contributes.commands with the commands permission',
        manifest: { ...base, contributes: { commands: ['do_thing'] }, permissions: ['commands'] },
        accepts: true,
      },
      {
        label: 'rejects contributes.jobs without the scheduler permission',
        manifest: { ...base, contributes: { jobs: ['nightly_digest'] }, permissions: [] },
        rejection: {
          message: "Declaring contributes.jobs requires the 'scheduler' permission",
          path: 'permissions',
        },
      },
      {
        label: 'rejects contributes.taskProviderTypes without the provider.task permission',
        manifest: { ...base, contributes: { taskProviderTypes: ['kaneo'] }, permissions: [] },
        rejection: {
          message: "Declaring contributes.taskProviderTypes requires the 'provider.task' permission",
          path: 'permissions',
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})

describe('pluginManifestSchema attachmentTransformers and providerAllowedHostsFromConfig', () => {
  test('transformer and config-host matrix', async () => {
    const rows: readonly ManifestRow[] = [
      {
        label: 'accepts contributes.attachmentTransformers with attachments.read permission',
        manifest: {
          id: 'audio-transcribe',
          name: 'Audio Transcribe',
          version: '1.0.0',
          description: 'transcribes audio attachments',
          apiVersion: 1,
          main: 'index.ts',
          contributes: { tools: [], promptFragments: [], attachmentTransformers: ['my_transformer'] },
          permissions: ['attachments.read'],
        },
        accepts: true,
      },
      {
        label: 'rejects attachmentTransformers without attachments.read permission',
        manifest: {
          id: 'audio-transcribe-no-perm',
          name: 'Audio Transcribe No Perm',
          version: '1.0.0',
          description: 'transcribes audio attachments',
          apiVersion: 1,
          main: 'index.ts',
          contributes: { tools: [], promptFragments: [], attachmentTransformers: ['my_transformer'] },
          permissions: [],
        },
        rejection: {
          message: "Declaring contributes.attachmentTransformers requires the 'attachments.read' permission",
          path: 'contributes.attachmentTransformers',
        },
      },
      {
        label: 'accepts providerAllowedHostsFromConfig referencing an admin-scoped config key',
        manifest: {
          id: 'http-config-hosts',
          name: 'HTTP Config Hosts',
          version: '1.0.0',
          description: 'uses config-sourced allowed hosts',
          apiVersion: 1,
          main: 'index.ts',
          permissions: ['http'],
          providerAllowedHostsFromConfig: ['base_url'],
          configRequirements: [
            { key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' },
          ],
        },
        accepts: true,
      },
      {
        label: 'rejects providerAllowedHostsFromConfig referencing a context-scoped or missing key',
        manifest: {
          id: 'http-config-hosts-bad',
          name: 'HTTP Config Hosts Bad',
          version: '1.0.0',
          description: 'uses config-sourced allowed hosts without admin scope',
          apiVersion: 1,
          main: 'index.ts',
          permissions: ['http'],
          providerAllowedHostsFromConfig: ['base_url'],
          configRequirements: [],
        },
        rejection: {
          message:
            'providerAllowedHostsFromConfig keys must reference at least one configRequirements entry (admin or context scope)',
          path: 'providerAllowedHostsFromConfig',
        },
      },
      {
        // An mcp+transformers manifest without main must be rejected because
        // attachmentTransformers are a runtime contribution and require main.
        label:
          'rejects mcp + attachmentTransformers-only manifest without main (fix 1: runtimeContributionCount includes transformers)',
        manifest: {
          id: 'mcp-transformers-only',
          name: 'MCP Transformers Only',
          version: '1.0.0',
          description: 'mcp and transformers only, no main',
          apiVersion: 1,
          contributes: { attachmentTransformers: ['my_transformer'] },
          permissions: ['attachments.read'],
          mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
        },
      },
      {
        // providerAllowedHostsFromConfig alone (no http or provider.task) must be rejected.
        label: 'rejects providerAllowedHostsFromConfig without http or provider.task permission (fix 2)',
        manifest: {
          id: 'config-hosts-no-http-perm',
          name: 'Config Hosts No HTTP Perm',
          version: '1.0.0',
          description: 'config-sourced hosts without http permission',
          apiVersion: 1,
          main: 'index.ts',
          permissions: [],
          providerAllowedHostsFromConfig: ['base_url'],
          configRequirements: [
            { key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' },
          ],
        },
      },
      {
        label: 'accepts kebab-case transformer name audio-transcribe (fix 3)',
        manifest: {
          id: 'audio-transcribe',
          name: 'Audio Transcribe',
          version: '1.0.0',
          description: 'transcribes audio attachments',
          apiVersion: 1,
          main: 'index.ts',
          contributes: { attachmentTransformers: ['audio-transcribe'] },
          permissions: ['attachments.read'],
        },
        accepts: true,
      },
      {
        // 'Base URL' contains uppercase and a space — not a valid config key.
        label: 'rejects malformed config key in providerAllowedHostsFromConfig (fix 4)',
        manifest: {
          id: 'config-hosts-bad-key',
          name: 'Config Hosts Bad Key',
          version: '1.0.0',
          description: 'malformed key in providerAllowedHostsFromConfig',
          apiVersion: 1,
          main: 'index.ts',
          permissions: ['http'],
          providerAllowedHostsFromConfig: ['Base URL'],
          configRequirements: [
            { key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' },
          ],
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})

describe('pluginManifestSchema config-sourced host allowlists', () => {
  const base = {
    id: 'host-allowlists',
    name: 'Host Allowlists',
    version: '1.0.0',
    description: 'config-sourced host allowlists',
    apiVersion: 1,
    main: 'index.ts',
    permissions: ['provider.task'],
    contributes: { taskProviderTypes: ['kaneo'] },
  }

  const instanceField = { key: 'baseUrl', label: 'Base URL', required: true, scope: 'instance' } as const
  const contextRequirement = { key: 'base_url', label: 'Base URL', required: true, scope: 'context' } as const

  test('host allowlist matrix', async () => {
    const rows: readonly ManifestRow[] = [
      {
        label: 'accepts an instance host key that resolves to a declared providerConfigSchema entry',
        manifest: {
          ...base,
          providerConfigSchema: [instanceField],
          providerAllowedInstanceHostsFromConfig: ['baseUrl'],
        },
        accepts: true,
      },
      {
        label: 'rejects an instance host key absent from providerConfigSchema',
        manifest: { ...base, providerConfigSchema: [], providerAllowedInstanceHostsFromConfig: ['baseUrl'] },
        rejection: {
          message:
            'providerAllowedInstanceHostsFromConfig keys must reference an instance-scoped providerConfigSchema entry',
          path: 'providerAllowedInstanceHostsFromConfig',
        },
      },
      {
        // The two allowlists are not interchangeable, and neither may fall back to the
        // other's declarations. Hosts derived from instance config are operator-trusted
        // and bypass the https and public-IP checks in src/plugins/dynamic-hosts.ts;
        // hosts derived from context config are not. Letting a context-scoped
        // configRequirements entry satisfy the instance list would hand an untrusted
        // per-context value that bypass.
        label: 'does not let a configRequirements key satisfy providerAllowedInstanceHostsFromConfig',
        manifest: {
          ...base,
          configRequirements: [contextRequirement],
          providerConfigSchema: [],
          providerAllowedInstanceHostsFromConfig: ['base_url'],
        },
        rejection: {
          message:
            'providerAllowedInstanceHostsFromConfig keys must reference an instance-scoped providerConfigSchema entry',
          path: 'providerAllowedInstanceHostsFromConfig',
        },
      },
      {
        label: 'does not let a providerConfigSchema key satisfy providerAllowedHostsFromConfig',
        manifest: {
          ...base,
          configRequirements: [],
          providerConfigSchema: [instanceField],
          providerAllowedHostsFromConfig: ['baseUrl'],
        },
        rejection: {
          message:
            'providerAllowedHostsFromConfig keys must reference at least one configRequirements entry (admin or context scope)',
          path: 'providerAllowedHostsFromConfig',
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})

describe('pluginManifestSchema field patterns', () => {
  const base = {
    id: 'field-patterns',
    name: 'Field Patterns',
    version: '1.0.0',
    description: 'field-level pattern checks',
    apiVersion: 1,
    main: 'index.ts',
  }

  test('field pattern matrix (former test.each rows)', async () => {
    const rows: readonly ManifestRow[] = [
      {
        label: 'accepts semver version 1.2.3',
        manifest: { ...base, version: '1.2.3' },
        accepts: true,
      },
      {
        label: 'accepts semver version 10.20.30',
        manifest: { ...base, version: '10.20.30' },
        accepts: true,
      },
      {
        label: 'accepts semver version 1.2.3-beta.1',
        manifest: { ...base, version: '1.2.3-beta.1' },
        accepts: true,
      },
      {
        label: 'accepts semver version 1.2.3+build.5',
        manifest: { ...base, version: '1.2.3+build.5' },
        accepts: true,
      },
      {
        label: 'rejects non-semver version 1.2',
        manifest: { ...base, version: '1.2' },
        rejection: { message: 'version must be semver (major.minor.patch)', path: 'version' },
      },
      {
        label: 'rejects non-semver version 1',
        manifest: { ...base, version: '1' },
        rejection: { message: 'version must be semver (major.minor.patch)', path: 'version' },
      },
      {
        label: 'rejects non-semver version v1.2.3',
        manifest: { ...base, version: 'v1.2.3' },
        rejection: { message: 'version must be semver (major.minor.patch)', path: 'version' },
      },
      {
        label: 'rejects non-semver version 1.2.3.4',
        manifest: { ...base, version: '1.2.3.4' },
        rejection: { message: 'version must be semver (major.minor.patch)', path: 'version' },
      },
      {
        label: 'rejects non-semver version 1.2.3 beta',
        manifest: { ...base, version: '1.2.3 beta' },
        rejection: { message: 'version must be semver (major.minor.patch)', path: 'version' },
      },
      {
        label: 'rejects providerConfigValidator name 1validate',
        manifest: {
          ...base,
          permissions: ['provider.task'],
          contributes: { taskProviderTypes: ['kaneo'] },
          providerConfigValidator: '1validate',
        },
        rejection: {
          message: 'Provider config validator must be a valid identifier',
          path: 'providerConfigValidator',
        },
      },
      {
        label: 'rejects providerConfigValidator name validate-config',
        manifest: {
          ...base,
          permissions: ['provider.task'],
          contributes: { taskProviderTypes: ['kaneo'] },
          providerConfigValidator: 'validate-config',
        },
        rejection: {
          message: 'Provider config validator must be a valid identifier',
          path: 'providerConfigValidator',
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})

describe('pluginManifestSchema parsed defaults', () => {
  const minimal = {
    id: 'parsed-defaults',
    name: 'Parsed Defaults',
    version: '1.0.0',
    description: 'defaults applied by parsing',
    apiVersion: 1,
    main: 'index.ts',
  }

  // Asserted on the parse *output*, not on a hand-constructed PluginManifest:
  // the hand-constructed type carries whatever the fixture wrote, so it proves
  // nothing about what the schema fills in for a manifest that omits the field.
  test('parsed defaults matrix', async () => {
    const rows: readonly ManifestRow[] = [
      {
        // The omitted case is satisfied by the `.default()`, which Zod applies
        // without re-validating it against the enum; both explicit members are
        // spelled out as their own rows below.
        label: 'defaults storageScope to context',
        manifest: minimal,
        accepts: true,
        parsedCheck: { pick: (parsed) => parsed.storageScope, expected: 'context' },
      },
      {
        label: 'preserves an explicit context storageScope',
        manifest: { ...minimal, storageScope: 'context' },
        accepts: true,
        parsedCheck: { pick: (parsed) => parsed.storageScope, expected: 'context' },
      },
      {
        label: 'preserves an explicit group storageScope',
        manifest: { ...minimal, storageScope: 'group' },
        accepts: true,
        parsedCheck: { pick: (parsed) => parsed.storageScope, expected: 'group' },
      },
      {
        label: 'defaults the boolean flags to false',
        manifest: {
          ...minimal,
          configRequirements: [{ key: 'api_token', label: 'API Token', required: true }],
        },
        accepts: true,
        parsedCheck: {
          pick: (parsed) => ({
            defaultEnabled: parsed.defaultEnabled,
            mcpServer: parsed.mcpServer,
            sensitive: parsed.configRequirements[0]?.sensitive,
          }),
          expected: { defaultEnabled: false, mcpServer: false, sensitive: false },
        },
      },
      {
        label: 'defaults every omitted list to an empty array rather than undefined',
        manifest: minimal,
        accepts: true,
        parsedCheck: {
          pick: (parsed) => ({
            permissions: parsed.permissions,
            requiredTaskCapabilities: parsed.requiredTaskCapabilities,
            requiredChatCapabilities: parsed.requiredChatCapabilities,
            configRequirements: parsed.configRequirements,
            providerCapabilities: parsed.providerCapabilities,
            providerTraits: parsed.providerTraits,
            providerConfigSchema: parsed.providerConfigSchema,
            providerContextConfigSchema: parsed.providerContextConfigSchema,
            providerAllowedHosts: parsed.providerAllowedHosts,
            providerAllowedHostsFromConfig: parsed.providerAllowedHostsFromConfig,
            providerAllowedInstanceHostsFromConfig: parsed.providerAllowedInstanceHostsFromConfig,
          }),
          expected: {
            permissions: [],
            requiredTaskCapabilities: [],
            requiredChatCapabilities: [],
            configRequirements: [],
            providerCapabilities: [],
            providerTraits: [],
            providerConfigSchema: [],
            providerContextConfigSchema: [],
            providerAllowedHosts: [],
            providerAllowedHostsFromConfig: [],
            providerAllowedInstanceHostsFromConfig: [],
          },
        },
      },
      {
        label: 'defaults an omitted contributes block to empty lists throughout',
        manifest: minimal,
        accepts: true,
        parsedCheck: {
          pick: (parsed) => parsed.contributes,
          expected: {
            tools: [],
            promptFragments: [],
            commands: [],
            jobs: [],
            configKeys: [],
            taskProviderTypes: [],
            attachmentTransformers: [],
          },
        },
      },
    ]
    await runManifestMatrix(rows)
  })
})
