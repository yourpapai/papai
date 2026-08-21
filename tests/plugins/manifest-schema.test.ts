// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ParsedPluginManifest } from '../../src/plugins/types.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'

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

  test('defaults provider config field scope to instance', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerConfigSchema: [{ key: 'base_url', label: 'URL', required: true }],
    })
    expect(parsed.providerConfigSchema[0]?.scope).toBe('instance')
  })

  test('rejects legacy user scope', () => {
    const result = pluginManifestSchema.safeParse({
      ...base,
      providerConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true, scope: 'user' }],
    })
    expect(result.success).toBe(false)
  })

  test('defaults provider context config field scope to context', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerContextConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true }],
    })
    expect(parsed.providerContextConfigSchema?.[0]?.scope).toBe('context')
  })

  test('parsed plugin manifest exposes defaulted provider arrays', () => {
    const parsed = pluginManifestSchema.parse({
      id: 'defaults-plugin',
      name: 'Defaults Plugin',
      version: '1.0.0',
      description: 'defaults',
      apiVersion: 1,
      main: 'index.ts',
    })

    expect(parsed.providerTraits).toEqual([])
    expect(parsed.providerContextConfigSchema).toEqual([])
  })
})

describe('pluginManifestSchema strict validation', () => {
  test('rejects unknown top-level manifest keys', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'strict-top-level',
      name: 'Strict Top Level',
      version: '1.0.0',
      description: 'strict',
      apiVersion: 1,
      unexpected: true,
    })

    expect(result.success).toBe(false)
  })

  test('rejects semver strings with trailing junk', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'bad-semver',
      name: 'Bad Semver',
      version: '1.0.0-beta trailing',
      description: 'strict semver',
      apiVersion: 1,
    })

    expect(result.success).toBe(false)
  })

  test('rejects Windows absolute main paths', () => {
    const driveLetterResult = pluginManifestSchema.safeParse({
      id: 'windows-drive-main',
      name: 'Windows Drive Main',
      version: '1.0.0',
      description: 'windows path',
      apiVersion: 1,
      main: 'C:\\plugin\\index.ts',
    })
    const uncResult = pluginManifestSchema.safeParse({
      id: 'windows-unc-main',
      name: 'Windows UNC Main',
      version: '1.0.0',
      description: 'windows path',
      apiVersion: 1,
      main: '\\\\server\\share\\index.ts',
    })

    expect(driveLetterResult.success).toBe(false)
    expect(uncResult.success).toBe(false)
  })

  test('accepts main paths whose filename contains dot-dot but no parent segment', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'dotted-main',
      name: 'Dotted Main',
      version: '1.0.0',
      description: 'dotted filename',
      apiVersion: 1,
      main: 'plugin..entry.ts',
    })

    expect(result.success).toBe(true)
  })

  test('rejects Windows-style parent traversal main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'windows-parent-traversal-main',
      name: 'Windows Parent Traversal Main',
      version: '1.0.0',
      description: 'windows parent traversal',
      apiVersion: 1,
      main: '..\\outside.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw POSIX parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'posix-parent-segment-main',
      name: 'POSIX Parent Segment Main',
      version: '1.0.0',
      description: 'posix parent segment',
      apiVersion: 1,
      main: 'foo/../index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw Windows parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'windows-parent-segment-main',
      name: 'Windows Parent Segment Main',
      version: '1.0.0',
      description: 'windows parent segment',
      apiVersion: 1,
      main: 'foo\\..\\index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw POSIX parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'posix-parent-segment-main',
      name: 'POSIX Parent Segment Main',
      version: '1.0.0',
      description: 'posix parent segment',
      apiVersion: 1,
      main: 'foo/../index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw Windows parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'windows-parent-segment-main',
      name: 'Windows Parent Segment Main',
      version: '1.0.0',
      description: 'windows parent segment',
      apiVersion: 1,
      main: 'foo\\..\\index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects configKeys without matching context-scoped config requirement', () => {
    const result = rejectionsOf({
      id: 'bad-config-keys',
      name: 'Bad Config Keys',
      version: '1.0.0',
      description: 'bad config key mapping',
      apiVersion: 1,
      contributes: { configKeys: ['api_token'] },
      configRequirements: [{ key: 'other_key', label: 'Other', required: true, scope: 'context' }],
    })

    expect(result).toContainEqual({
      message: 'Every contributes.configKeys entry must match a context-scoped configRequirements entry',
      path: 'contributes.configKeys',
    })
  })

  test('rejects admin-scoped configKeys entries', () => {
    const result = rejectionsOf({
      id: 'admin-config-key',
      name: 'Admin Config Key',
      version: '1.0.0',
      description: 'admin config key mismatch',
      apiVersion: 1,
      contributes: { configKeys: ['api_token'] },
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, scope: 'admin' }],
    })

    expect(result).toContainEqual({
      message: 'Every contributes.configKeys entry must match a context-scoped configRequirements entry',
      path: 'contributes.configKeys',
    })
  })

  test('rejects provider-only fields without provider.task permission', () => {
    const result = rejectionsOf({
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
    })

    expect(result).toContainEqual({
      message: "Provider-only manifest fields require the 'provider.task' permission",
      path: 'permissions',
    })
  })

  test('rejects providerConfigValidator when no task provider type is declared', () => {
    const result = rejectionsOf({
      id: 'validator-without-provider-type',
      name: 'Validator Without Provider Type',
      version: '1.0.0',
      description: 'validator without provider type',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['provider.task'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      providerConfigValidator: 'validateConfig',
    })

    expect(result).toContainEqual({
      message: 'providerConfigValidator requires contributes.taskProviderTypes',
      path: 'providerConfigValidator',
    })
  })

  test('accepts providerConfigValidator alongside a declared task provider type', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'validator-with-provider-type',
      name: 'Validator With Provider Type',
      version: '1.0.0',
      description: 'validator with provider type',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['provider.task'],
      contributes: { taskProviderTypes: ['kaneo'] },
      providerConfigValidator: 'validateConfig',
    })

    expect(result.success).toBe(true)
  })

  test('accepts a manifest that declares neither a validator nor a provider type', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'no-validator-no-provider',
      name: 'No Validator No Provider',
      version: '1.0.0',
      description: 'neither half of the validator pairing',
      apiVersion: 1,
      main: 'index.ts',
    })

    expect(result.success).toBe(true)
  })

  test('accepts providerAllowedHosts for http-only plugins', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'http-host-allowlist',
      name: 'HTTP Host Allowlist',
      version: '1.0.0',
      description: 'http-only provider runtime host allowlist',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['http'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      providerAllowedHosts: ['example.com'],
    })

    expect(result.success).toBe(true)
  })

  test('accepts explicit mcp-only manifests without main', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'mcp-only-schema',
      name: 'MCP Only Schema',
      version: '1.0.0',
      description: 'mcp only schema',
      apiVersion: 1,
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })

    expect(result.success).toBe(true)
    expect(result.data?.main).toBeUndefined()
  })

  test('rejects mcp-only manifests without main when provider-only metadata is present', () => {
    const result = rejectionsOf({
      id: 'mcp-only-provider-metadata',
      name: 'MCP Only Provider Metadata',
      version: '1.0.0',
      description: 'mcp only with provider metadata',
      apiVersion: 1,
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      permissions: ['provider.task'],
      providerAllowedHosts: ['example.com'],
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })

    expect(result).toContainEqual({
      message: 'main is required unless the manifest is an explicit MCP-only plugin',
      path: 'main',
    })
  })

  test('rejects mcp manifests that also declare runtime contributions without main', () => {
    const result = rejectionsOf({
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
    })

    expect(result).toContainEqual({
      message: 'main is required unless the manifest is an explicit MCP-only plugin',
      path: 'main',
    })
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

  test('rejects contributes.commands without the commands permission', () => {
    const result = rejectionsOf({ ...base, contributes: { commands: ['do_thing'] }, permissions: [] })

    expect(result).toContainEqual({
      message: "Declaring contributes.commands requires the 'commands' permission",
      path: 'permissions',
    })
  })

  test('accepts contributes.commands with the commands permission', () => {
    const result = pluginManifestSchema.safeParse({
      ...base,
      contributes: { commands: ['do_thing'] },
      permissions: ['commands'],
    })

    expect(result.success).toBe(true)
  })

  test('rejects contributes.jobs without the scheduler permission', () => {
    const result = rejectionsOf({
      ...base,
      contributes: { jobs: ['nightly_digest'] },
      permissions: [],
    })

    expect(result).toContainEqual({
      message: "Declaring contributes.jobs requires the 'scheduler' permission",
      path: 'permissions',
    })
  })

  test('rejects contributes.taskProviderTypes without the provider.task permission', () => {
    const result = rejectionsOf({ ...base, contributes: { taskProviderTypes: ['kaneo'] }, permissions: [] })

    expect(result).toContainEqual({
      message: "Declaring contributes.taskProviderTypes requires the 'provider.task' permission",
      path: 'permissions',
    })
  })
})

describe('pluginManifestSchema attachmentTransformers and providerAllowedHostsFromConfig', () => {
  test('accepts contributes.attachmentTransformers with attachments.read permission', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'audio-transcribe',
      name: 'Audio Transcribe',
      version: '1.0.0',
      description: 'transcribes audio attachments',
      apiVersion: 1,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], attachmentTransformers: ['my_transformer'] },
      permissions: ['attachments.read'],
    })
    expect(result.success).toBe(true)
  })

  test('rejects attachmentTransformers without attachments.read permission', () => {
    const result = rejectionsOf({
      id: 'audio-transcribe-no-perm',
      name: 'Audio Transcribe No Perm',
      version: '1.0.0',
      description: 'transcribes audio attachments',
      apiVersion: 1,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], attachmentTransformers: ['my_transformer'] },
      permissions: [],
    })
    expect(result).toContainEqual({
      message: "Declaring contributes.attachmentTransformers requires the 'attachments.read' permission",
      path: 'contributes.attachmentTransformers',
    })
  })

  test('accepts providerAllowedHostsFromConfig referencing an admin-scoped config key', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'http-config-hosts',
      name: 'HTTP Config Hosts',
      version: '1.0.0',
      description: 'uses config-sourced allowed hosts',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['http'],
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [{ key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' }],
    })
    expect(result.success).toBe(true)
  })

  test('rejects providerAllowedHostsFromConfig referencing a context-scoped or missing key', () => {
    const result = rejectionsOf({
      id: 'http-config-hosts-bad',
      name: 'HTTP Config Hosts Bad',
      version: '1.0.0',
      description: 'uses config-sourced allowed hosts without admin scope',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['http'],
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [],
    })
    expect(result).toContainEqual({
      message:
        'providerAllowedHostsFromConfig keys must reference at least one configRequirements entry (admin or context scope)',
      path: 'providerAllowedHostsFromConfig',
    })
  })

  test('rejects mcp + attachmentTransformers-only manifest without main (fix 1: runtimeContributionCount includes transformers)', () => {
    // This must FAIL (success === false): an mcp+transformers manifest without main must be rejected
    // because attachmentTransformers are a runtime contribution and require main.
    const result = pluginManifestSchema.safeParse({
      id: 'mcp-transformers-only',
      name: 'MCP Transformers Only',
      version: '1.0.0',
      description: 'mcp and transformers only, no main',
      apiVersion: 1,
      contributes: { attachmentTransformers: ['my_transformer'] },
      permissions: ['attachments.read'],
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })
    expect(result.success).toBe(false)
  })

  test('rejects providerAllowedHostsFromConfig without http or provider.task permission (fix 2)', () => {
    // providerAllowedHostsFromConfig alone (no http or provider.task) must be rejected
    const result = pluginManifestSchema.safeParse({
      id: 'config-hosts-no-http-perm',
      name: 'Config Hosts No HTTP Perm',
      version: '1.0.0',
      description: 'config-sourced hosts without http permission',
      apiVersion: 1,
      main: 'index.ts',
      permissions: [],
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [{ key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' }],
    })
    expect(result.success).toBe(false)
  })

  test('accepts kebab-case transformer name audio-transcribe (fix 3)', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'audio-transcribe',
      name: 'Audio Transcribe',
      version: '1.0.0',
      description: 'transcribes audio attachments',
      apiVersion: 1,
      main: 'index.ts',
      contributes: { attachmentTransformers: ['audio-transcribe'] },
      permissions: ['attachments.read'],
    })
    expect(result.success).toBe(true)
  })

  test('rejects malformed config key in providerAllowedHostsFromConfig (fix 4)', () => {
    // 'Base URL' contains uppercase and a space — not a valid config key
    const result = pluginManifestSchema.safeParse({
      id: 'config-hosts-bad-key',
      name: 'Config Hosts Bad Key',
      version: '1.0.0',
      description: 'malformed key in providerAllowedHostsFromConfig',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['http'],
      providerAllowedHostsFromConfig: ['Base URL'],
      configRequirements: [{ key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'admin' }],
    })
    expect(result.success).toBe(false)
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

  test('accepts an instance host key that resolves to a declared providerConfigSchema entry', () => {
    const result = pluginManifestSchema.safeParse({
      ...base,
      providerConfigSchema: [instanceField],
      providerAllowedInstanceHostsFromConfig: ['baseUrl'],
    })

    expect(result.success).toBe(true)
  })

  test('rejects an instance host key absent from providerConfigSchema', () => {
    const result = rejectionsOf({
      ...base,
      providerConfigSchema: [],
      providerAllowedInstanceHostsFromConfig: ['baseUrl'],
    })

    expect(result).toContainEqual({
      message:
        'providerAllowedInstanceHostsFromConfig keys must reference an instance-scoped providerConfigSchema entry',
      path: 'providerAllowedInstanceHostsFromConfig',
    })
  })

  // The two allowlists are not interchangeable, and neither may fall back to the
  // other's declarations. Hosts derived from instance config are operator-trusted
  // and bypass the https and public-IP checks in src/plugins/dynamic-hosts.ts;
  // hosts derived from context config are not. Letting a context-scoped
  // configRequirements entry satisfy the instance list would hand an untrusted
  // per-context value that bypass.
  test('does not let a configRequirements key satisfy providerAllowedInstanceHostsFromConfig', () => {
    const result = rejectionsOf({
      ...base,
      configRequirements: [contextRequirement],
      providerConfigSchema: [],
      providerAllowedInstanceHostsFromConfig: ['base_url'],
    })

    expect(result).toContainEqual({
      message:
        'providerAllowedInstanceHostsFromConfig keys must reference an instance-scoped providerConfigSchema entry',
      path: 'providerAllowedInstanceHostsFromConfig',
    })
  })

  test('does not let a providerConfigSchema key satisfy providerAllowedHostsFromConfig', () => {
    const result = rejectionsOf({
      ...base,
      configRequirements: [],
      providerConfigSchema: [instanceField],
      providerAllowedHostsFromConfig: ['baseUrl'],
    })

    expect(result).toContainEqual({
      message:
        'providerAllowedHostsFromConfig keys must reference at least one configRequirements entry (admin or context scope)',
      path: 'providerAllowedHostsFromConfig',
    })
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

  test.each(['1.2.3', '10.20.30', '1.2.3-beta.1', '1.2.3+build.5'])('accepts semver version %s', (version) => {
    expect(pluginManifestSchema.safeParse({ ...base, version }).success).toBe(true)
  })

  test.each(['1.2', '1', 'v1.2.3', '1.2.3.4', '1.2.3 beta'])('rejects non-semver version %s', (version) => {
    expect(rejectionsOf({ ...base, version })).toContainEqual({
      message: 'version must be semver (major.minor.patch)',
      path: 'version',
    })
  })

  test.each(['1validate', 'validate-config'])('rejects providerConfigValidator name %s', (name) => {
    const result = rejectionsOf({
      ...base,
      permissions: ['provider.task'],
      contributes: { taskProviderTypes: ['kaneo'] },
      providerConfigValidator: name,
    })

    expect(result).toContainEqual({
      message: 'Provider config validator must be a valid identifier',
      path: 'providerConfigValidator',
    })
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
  const parse = (manifest: unknown): ParsedPluginManifest => {
    const result = pluginManifestSchema.safeParse(manifest)

    expect(result.success).toBe(true)
    if (!result.success) throw result.error

    return result.data
  }

  test('defaults storageScope to context and preserves an explicit group scope', () => {
    expect(parse(minimal).storageScope).toBe('context')
    // Both members spelled out explicitly: the omitted case above is satisfied by
    // the `.default()`, which Zod applies without re-validating it against the enum.
    expect(parse({ ...minimal, storageScope: 'context' }).storageScope).toBe('context')
    expect(parse({ ...minimal, storageScope: 'group' }).storageScope).toBe('group')
  })

  test('defaults the boolean flags to false', () => {
    const parsed = parse({
      ...minimal,
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true }],
    })

    expect(parsed.defaultEnabled).toBe(false)
    expect(parsed.mcpServer).toBe(false)
    expect(parsed.configRequirements[0]?.sensitive).toBe(false)
  })

  test('defaults every omitted list to an empty array rather than undefined', () => {
    const parsed = parse(minimal)

    expect({
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
    }).toEqual({
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
    })
  })

  test('defaults an omitted contributes block to empty lists throughout', () => {
    expect(parse(minimal).contributes).toEqual({
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    })
  })
})
