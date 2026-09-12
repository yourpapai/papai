## Purpose

Makes `diagnostics` a first-class tool domain so that current and future bot self-diagnostics tools (health, status, version introspection) flow through every tool-classification surface — permission preferences, settings/admin domain toggles, analytics facts, and progressive-disclosure briefs — without inventing new tools or reclassifying existing ones.

## ADDED Requirements

### Requirement: Diagnostics is a recognized tool domain
The system SHALL recognize `diagnostics` as a valid tool domain everywhere a tool domain is accepted or validated. A tool classified under the diagnostics domain SHALL report `diagnostics` as its domain through tool-metadata lookups, and the set of known tool domains SHALL NOT otherwise change.

#### Scenario: Domain validation accepts diagnostics
- **WHEN** any surface that validates a tool domain receives the value `diagnostics`
- **THEN** the value is accepted as a known tool domain

#### Scenario: Existing domains and tool classifications are unchanged
- **WHEN** the set of known tool domains or the classification of any existing tool is observed after this change
- **THEN** every previously known domain remains known and every existing tool keeps its previous domain, operation, and risk classification unchanged

#### Scenario: No tools are auto-registered under diagnostics
- **WHEN** the registered first-party tool set is observed after this change
- **THEN** no new tool names appear and no existing tool moves into the diagnostics domain as a side effect of adding the domain

### Requirement: Tool preferences accept a diagnostics domain default
The system SHALL accept, parse, and persist per-context tool preferences that set a domain default for `diagnostics` with the value `allow`, `ask`, or `deny`. A `diagnostics` entry SHALL NOT be silently dropped as an unknown domain. Preference scope follows the durable-config scope model: a domain default set for a group's configuration context applies across that group's threads.

#### Scenario: Diagnostics domain default persists
- **WHEN** tool-preferences JSON containing `domainDefaults: { "diagnostics": "ask" }` is stored for a configuration context and read back
- **THEN** the preferences preserve `diagnostics: "ask"` instead of dropping the key

#### Scenario: Invalid permission values are ignored
- **WHEN** stored tool-preferences JSON contains a `diagnostics` entry whose value is not `allow`, `ask`, or `deny`
- **THEN** the entry is ignored and no invalid permission is stored or applied

#### Scenario: Group-shared diagnostics default applies in threads
- **WHEN** a diagnostics domain default is set at a group's configuration-context scope and tools are assembled for one of that group's thread-scoped conversations
- **THEN** the diagnostics domain default from the group scope applies in that thread

### Requirement: Diagnostics tools resolve permissions by the standard precedence
A tool classified under the diagnostics domain SHALL resolve its permission by the same most-specific-wins precedence as every other tool: per-tool override, then the diagnostics domain default, then the risk default, then implicit `allow`. With no stored preference covering it, a diagnostics tool SHALL resolve to `allow`, identical to every unlisted domain.

#### Scenario: Implicit default is allow
- **WHEN** a tool classified under `diagnostics` is resolved against preferences containing no entry covering it
- **THEN** its permission resolves to `allow`

#### Scenario: Domain default applies to diagnostics tools
- **WHEN** the diagnostics domain default is set to `deny` and a diagnostics-classified tool without a per-tool override is assembled into a conversation's toolset
- **THEN** the tool is removed from the offered toolset and cannot be invoked

#### Scenario: Per-tool override wins over the domain default
- **WHEN** a diagnostics tool has a per-tool override and the diagnostics domain default is set to a different value
- **THEN** the per-tool override determines the effective permission

### Requirement: Ask-gated diagnostics tools require per-call confirmation
When a diagnostics tool resolves to `ask`, the system SHALL expose the tool behind a permission gate so each invocation requires explicit user permission before execution. A user denial SHALL produce a permission-denied tool result rather than executing the tool or counting it as a failure, and an approval SHALL execute that single invocation.

#### Scenario: Denied confirmation blocks execution
- **WHEN** the model invokes an `ask`-gated diagnostics tool and the user rejects the permission request
- **THEN** the tool does not execute and the invocation yields a permission-denied result

#### Scenario: Approved confirmation executes once
- **WHEN** the user approves the permission request for an `ask`-gated diagnostics tool invocation
- **THEN** the tool executes for that invocation

### Requirement: Settings and admin domain toggles accept diagnostics
The settings UI and admin endpoints that set per-domain permission defaults SHALL accept a domain-level request with `domain: "diagnostics"` and any of `allow`, `ask`, or `deny`, applying it as the diagnostics domain default for the target configuration context. Requests naming a domain outside the known set SHALL continue to be rejected with a validation error.

#### Scenario: Settings domain toggle succeeds
- **WHEN** a settings or admin request sets a domain-level default with `domain: "diagnostics"` and a valid permission
- **THEN** the request succeeds and the diagnostics default takes effect for the target context

#### Scenario: Unknown domains are still rejected
- **WHEN** a settings or admin request sets a domain-level default with a domain value that is not a known tool domain
- **THEN** the request is rejected with a validation error

### Requirement: Analytics facts carry the diagnostics domain
Analytics facts for tool invocations SHALL classify a tool registered under the diagnostics domain with tool domain `diagnostics`, and the tool-started and tool-completed fact schemas SHALL accept `diagnostics` as a domain value. Payloads carrying a domain outside the accepted set SHALL continue to be rejected, and every existing tool's analytics classification SHALL be unchanged.

#### Scenario: Diagnostics tool-started fact validates
- **WHEN** a tool classified under `diagnostics` starts and its `tool_started` fact is emitted
- **THEN** the fact carries domain `diagnostics` and validates against the fact schema

#### Scenario: Diagnostics tool-completed fact validates
- **WHEN** a tool classified under `diagnostics` completes and its `tool_completed` fact is emitted
- **THEN** the fact carries domain `diagnostics` and validates against the fact schema

#### Scenario: Bogus domain still rejected
- **WHEN** a tool-started or tool-completed props payload carries a domain value outside the accepted domain set
- **THEN** the payload is rejected by the fact schema

#### Scenario: Existing tools keep their analytics domain
- **WHEN** any existing tool's analytics classification is observed after this change
- **THEN** its tool domain matches its classification before this change

### Requirement: Disclosure briefs reflect the diagnostics domain
Progressive-disclosure tool briefs and tool-search results SHALL report `diagnostics` as the domain for tools classified under it, with no behavior change for tools classified under other domains.

#### Scenario: Brief carries the diagnostics domain
- **WHEN** a tool classified under `diagnostics` is listed in a disclosure brief or returned by tool search
- **THEN** its advertised domain is `diagnostics`

### Requirement: Read-risk diagnostics tools are guest-eligible
In groups with guest mode enabled, a diagnostics tool whose risk classification is read-only SHALL be offered to unrecognized users through the fixed read-only guest toolset, and guest eligibility SHALL NOT be overridable through per-context tool preferences. Diagnostics tools with write, destructive, or open-world risk SHALL NOT be offered to guests.

#### Scenario: Guest sees a read-risk diagnostics tool
- **WHEN** an unrecognized user interacts in a guest-mode group and a diagnostics tool with read risk is registered
- **THEN** that tool is available to the guest

#### Scenario: Guest toolset stays read-only
- **WHEN** a diagnostics tool with write, destructive, or open-world risk is registered in a guest-mode group
- **THEN** that tool is not offered to the guest
