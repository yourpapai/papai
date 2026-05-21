<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0052: YouTrack Full API Implementation with Phased Provider Extension

## Status

Accepted

## Date

2026-04-08

## Context

The papai YouTrack provider initially supported basic task operations (create, update, search, get, list, delete). As users adopted YouTrack alongside Kaneo, they requested feature parity with the full range of YouTrack's capabilities:

- **Status management**: Creating and updating status columns (State custom field bundles)
- **Attachments**: Uploading and managing file attachments on tasks
- **Time tracking**: Logging and managing work items (time spent)
- **Collaboration**: Watchers, votes, visibility settings, comment reactions
- **Project team management**: Adding/removing project members
- **Agile features**: Sprints, saved queries, task history/activities

YouTrack's REST API differs from Kaneo in several key ways:

- Uses custom field bundles (shared across projects) for State management
- Requires multipart/form-data for attachment uploads
- Has separate endpoints for work items vs task updates
- Uses visibility types for access control
- Supports agile/sprint management via separate APIs

## Decision Drivers

- **Must provide feature parity** with Kaneo provider where capabilities overlap
- **Must handle YouTrack-specific abstractions** (bundles, custom fields, visibility)
- **Must maintain backward compatibility** with existing YouTrack operations
- **Should use capability gating** to expose only supported operations per provider
- **Should support phased rollout** to manage complexity
- **Must follow existing patterns** from Kaneo implementation

## Considered Options

### Option 1: Single Large Provider Class

Implement all YouTrack operations in a single monolithic provider class.

**Pros:**

- Simple class structure
- All code in one place

**Cons:**

- Unmanageable file size (~2000+ lines)
- Poor separation of concerns
- Hard to test individual capabilities
- Merge conflicts likely with multiple contributors

### Option 2: Inheritance Hierarchy with Phased Providers

Create a class hierarchy where each phase extends the previous:

```
YouTrackProvider (base)
  ← YouTrackRelationsProvider (Phase 1)
    ← YouTrackStatusesProvider (Phase 2)
      ← YouTrackAttachmentsProvider (Phase 3)
        ← YouTrackCollaborationProvider (Phase 4)
          ← YouTrackPhaseFiveProvider (Phase 5)
            ← YouTrackProvider (final)
```

**Pros:**

- Clear separation of concerns
- Each phase can be implemented/tested independently
- Matches how capabilities are added incrementally
- Easy to understand what features are in which phase

**Cons:**

- Deeper inheritance chain
- Need to understand hierarchy to navigate code
- Base class changes affect all phases

**Decision:** Selected this approach.

### Option 3: Mixins or Composition

Use TypeScript mixins or composition to assemble capabilities.

**Pros:**

- More flexible than inheritance
- Can mix-and-match capabilities
- No deep hierarchy

**Cons:**

- More complex TypeScript types
- Less familiar to contributors
- Harder to trace method origins

## Decision

We will implement **Option 2: Inheritance Hierarchy with Phased Providers**.

The implementation follows 5 phases:

1. **Phase 1**: Bug fixes and cheap wins (extended ISSUE_FIELDS, REST API relations, getComment, deleteProject)
2. **Phase 2**: Statuses and custom fields (bundle resolution, status CRUD, shared bundle confirmation)
3. **Phase 3**: Attachments and work items (file uploads, time tracking)
4. **Phase 4**: Collaboration (watchers, votes, visibility, reactions, team management)
5. **Phase 5**: Agile and history (sprints, saved queries, activities, count_tasks)

## Rationale

1. **Clear organization**: Each phase is a self-contained provider class in its own file
2. **Incremental implementation**: Phases can be developed and tested independently
3. **Capability alignment**: Each phase maps to a set of related capabilities
4. **Maintainability**: Changes to one phase don't affect others
5. **Learning curve**: Hierarchy is easy to understand and navigate
6. **Pattern consistency**: Follows existing provider patterns from Kaneo implementation

## Consequences

### Positive

- **Full feature parity**: YouTrack now supports all major operations that Kaneo supports
- **Phased development**: Each phase was implemented and tested independently
- **Bundle handling**: Smart caching and resolution of YouTrack's State bundles
- **Shared bundle protection**: Confirmation required before modifying shared bundles
- **Rich task data**: Extended ISSUE_FIELDS provide complete task information
- **Collaboration features**: Full support for watchers, votes, visibility, reactions
- **Time tracking**: Work items (time logging) fully supported
- **Agile support**: Sprints and saved queries available

### Negative

- **Inheritance depth**: 5-level hierarchy requires understanding parent classes
- **Bundle complexity**: YouTrack's bundle system requires caching and resolution logic
- **REST vs Command API**: Some operations require different API patterns
- **Custom field mapping**: YouTrack's flexible schema requires careful mapping

### Risks

- **Bundle cache staleness**: Cached bundle info may become outdated
  - Mitigation: 5-minute TTL on cache entries, failure cache for 30 seconds
- **Shared bundle accidental modification**: Changes affect multiple projects
  - Mitigation: Confirmation required for shared bundle operations
- **Token scope limitations**: Some operations require admin scope
  - Mitigation: Error classification distinguishes permission errors

## Implementation Notes

### File Structure

```
src/providers/youtrack/
├── index.ts                    # Final YouTrackProvider class
├── provider.ts                 # Base provider (Phase 0)
├── relations-provider.ts       # Phase 1: Relations REST API
├── statuses-provider.ts        # Phase 2: Status operations
├── attachments-provider.ts     # Phase 3: Attachments & work items
├── collaboration-provider.ts   # Phase 4: Collaboration features
├── phase-five-provider.ts      # Phase 5: Agile & history
├── client.ts                   # Shared HTTP client
├── bundle-cache.ts             # State bundle resolution
├── constants.ts                # ISSUE_FIELDS, capabilities
├── classify-error.ts           # Error classification
├── mappers.ts                  # Data mapping helpers
├── schemas/                    # Zod schemas
│   ├── issue.ts
│   ├── bundle.ts
│   ├── attachment.ts
│   ├── work-item.ts
│   └── ...
└── operations/                 # Operation implementations
    ├── tasks.ts
    ├── comments.ts
    ├── projects.ts
    ├── labels.ts
    ├── statuses.ts
    ├── attachments.ts
    ├── work-items.ts
    ├── collaboration.ts
    ├── team.ts
    ├── users.ts
    ├── agiles.ts
    ├── saved-queries.ts
    ├── activities.ts
    └── count.ts
```

### Class Hierarchy

```typescript
class YouTrackProvider extends YouTrackPhaseFiveProvider {}
class YouTrackPhaseFiveProvider extends YouTrackCollaborationProvider {}
class YouTrackCollaborationProvider extends YouTrackAttachmentsProvider {}
class YouTrackAttachmentsProvider extends YouTrackStatusesProvider {}
class YouTrackStatusesProvider extends YouTrackRelationsProvider {}
class YouTrackRelationsProvider extends YouTrackProviderBase {}
```

### Bundle Caching

```typescript
// Cache structure for State bundle resolution
const bundleCache = new Map<ProjectFieldKey, { info: CustomFieldInfo; expires: number }>()
const bundleInfoCache = new Map<string, { info: BundleInfo; expires: number }>()
const failureCache = new Map<ProjectFieldKey, { expires: number }>()

// TTL: 5 minutes for success, 30 seconds for failures
const CACHE_TTL_MS = 5 * 60 * 1000
const FAILURE_TTL_MS = 30 * 1000
```

### Shared Bundle Confirmation

```typescript
if (bundle.isShared && params.confirm !== true) {
  return {
    status: 'confirmation_required',
    message: `This State bundle is shared by multiple projects. Changes affect all of them. Set confirm=true to proceed.`,
  }
}
```

## Verification

- ✅ All 5 phases implemented and tested
- ✅ All operations have corresponding capability declarations
- ✅ Bundle caching tested with unit tests
- ✅ Shared bundle confirmation tested
- ✅ Full test suite passes
- ✅ E2E tests pass against real YouTrack instance
- ✅ Kaneo provider unaffected
- ✅ No breaking changes to existing YouTrack operations

## Files Changed

### New Files (40+)

**Provider Classes:**

- `src/providers/youtrack/provider.ts`
- `src/providers/youtrack/relations-provider.ts`
- `src/providers/youtrack/statuses-provider.ts`
- `src/providers/youtrack/attachments-provider.ts`
- `src/providers/youtrack/collaboration-provider.ts`
- `src/providers/youtrack/phase-five-provider.ts`

**Support Modules:**

- `src/providers/youtrack/bundle-cache.ts`
- `src/providers/youtrack/schemas/bundle.ts`
- `src/providers/youtrack/schemas/attachment.ts`
- `src/providers/youtrack/schemas/work-item.ts`

**Operations:**

- `src/providers/youtrack/operations/statuses.ts`
- `src/providers/youtrack/operations/attachments.ts`
- `src/providers/youtrack/operations/work-items.ts`
- `src/providers/youtrack/operations/collaboration.ts`
- `src/providers/youtrack/operations/team.ts`
- `src/providers/youtrack/operations/users.ts`
- `src/providers/youtrack/operations/agiles.ts`
- `src/providers/youtrack/operations/saved-queries.ts`
- `src/providers/youtrack/operations/activities.ts`
- `src/providers/youtrack/operations/count.ts`

**Tests:**

- Corresponding test files for all new modules

### Modified Files

- `src/providers/youtrack/index.ts` - Now exports extended provider
- `src/providers/youtrack/constants.ts` - Extended ISSUE_FIELDS, added capabilities
- `src/providers/youtrack/mappers.ts` - Added new field mappings
- `src/providers/types.ts` - Extended Task type with new fields

## Lessons Learned

1. **Bundle caching is essential**: Without caching, status operations would be prohibitively slow due to repeated bundle lookups.

2. **Shared bundle confirmation prevents accidents**: The confirm flag pattern protects against accidental multi-project changes.

3. **REST API is more reliable than Command API**: The switch from command-based relations to REST API `/links` endpoint improved reliability.

4. **Extended ISSUE_FIELDS provide rich data**: Including reporter, updater, votes, attachments in the base fetch reduces API calls.

5. **Capability gating works well**: Using `YOUTRACK_CAPABILITIES` to gate tool exposure keeps the tool surface clean.

6. **Phase inheritance makes testing easier**: Each phase can be tested in isolation before integrating into the full provider.

## Related Decisions

- ADR-0001: YouTrack Zod Schema Library (foundation for schema validation)
- ADR-0009: Multi-Provider Task Tracker Support (provider abstraction)
- ADR-0015: Enhanced Tool Capabilities (capability gating pattern)
- ADR-0031: Provider-Agnostic Status vs Column Abstraction (informed Phase 2 design)

## References

- Implementation Plan: `docs/archive/youtrack-api-implementation-2026-04-08.md`
- Enhanced Design: `docs/archive/2026-04-08-youtrack-full-api-enhanced-design.md`
- Original Spec: `docs/archive/youtrack-full-api-design.md`
- YouTrack REST API Documentation: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html
- Provider Conventions: `src/providers/CLAUDE.md`
