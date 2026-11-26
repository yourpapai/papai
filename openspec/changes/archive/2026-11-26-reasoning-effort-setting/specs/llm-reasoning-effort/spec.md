<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets the owner trade response quality for latency by choosing a reasoning-effort level for the config context's active model from a catalogue-derived option set, keeping requests unchanged until a stored level is actually in effect.

## ADDED Requirements

### Requirement: Group-shared reasoning effort setting

The system SHALL expose a reasoning-effort setting (the `ai_reasoning_effort` AI-output key) in the settings UI, persisted per config context and therefore shared across every thread of the owning group — thread-isolated conversation state SHALL NOT isolate it. The stored value SHALL be a free string in which the unset state and the value `default` both mean "provider default". Until a level is in effect, generation requests SHALL remain byte-identical to behavior before this capability: no reasoning-effort parameter SHALL appear. The setting is a non-secret preference: it SHALL be stored with the config context's existing storage, and deriving its meaning SHALL use the context's encrypted provider-account configuration without exposing credential material in the settings API payloads, option lists, or logs.

#### Scenario: Level applies across a group's threads

- **WHEN** the owner sets a reasoning-effort level for a config context and users converse in two different threads of that group
- **THEN** generation requests in both threads carry the same level

#### Scenario: Other config contexts unaffected

- **WHEN** two config contexts hold different stored reasoning-effort values
- **THEN** each context's requests carry only its own value

#### Scenario: Unset, default, or unrecognized stored value

- **WHEN** the stored value is absent, `default`, or not a recognizable level string
- **THEN** requests carry no reasoning-effort parameter at all, byte-identical to pre-capability requests

#### Scenario: Guest conversation inherits the group value

- **WHEN** a guest in a guest-mode group sends a message while the group's config context has a level in effect
- **THEN** the guest's turn uses the same level as a member's turn, and the setting itself stays reachable only through the settings UI

#### Scenario: Platform-instance neutrality

- **WHEN** conversations on two platform instances run under the same config context
- **THEN** both use the same effective reasoning-effort value

### Requirement: Option set derived per active model with union fallback

For the config context's active model — resolved the same way as at turn time, including a context's own BYOK provider account — the system SHALL derive one option set that the settings UI offers, validation accepts, and the request gate admits. The set SHALL start with "Provider default" followed by the effort levels for the active model. Those levels SHALL come from the model catalogue when it lists accepted effort levels for the model (offered verbatim, in catalogue order, lowest effort first); SHALL be empty when the catalogue marks the model as not a reasoning model (a provider-default-only control); and SHALL otherwise be the fallback union `none, minimal, low, medium, high, xhigh, max` in effort-ascending order. The fallback union SHALL apply whenever there is no usable catalogue level list: model unknown to the catalogue, snapshot without reasoning data, malformed data, several catalogue providers knowing the model id with disagreeing level lists, or no provider configured. Custom-gateway and `hf:` experiment models SHALL always receive the full fallback union and SHALL never be locked out of a level.

#### Scenario: Catalogue-known model offers catalogue levels

- **WHEN** the active model's catalogue entry lists accepted effort levels
- **THEN** the control offers exactly those values, verbatim and in catalogue order, after "Provider default"

#### Scenario: Non-reasoning model offers default only

- **WHEN** the catalogue marks the active model as not a reasoning model
- **THEN** the control offers "Provider default" only

#### Scenario: Unknown model gets the full union

- **WHEN** the active model is absent from the catalogue (for example an `hf:` gateway model) or the snapshot predates reasoning data
- **THEN** the control offers the full fallback union `none, minimal, low, medium, high, xhigh, max`

#### Scenario: Disagreeing catalogue providers fall back to the union

- **WHEN** the catalogue knows the model id under several providers whose level lists disagree
- **THEN** no catalogue levels are offered and the fallback union applies

#### Scenario: Unconfigured provider stays permissive

- **WHEN** the config context has no provider configured
- **THEN** the control offers the full fallback union rather than an error

#### Scenario: BYOK context derives from its own account

- **WHEN** a config context's BYOK provider account resolves to a different model than the global account
- **THEN** the offered levels follow the BYOK account's active model

### Requirement: Settings read and validation against the derived set

The settings API SHALL expose the derived option set when the field is read and SHALL validate a saved value against the same derived set for the context's active model: a non-empty value outside the set SHALL be rejected with the list of allowed values while the previously stored value remains unchanged, and clearing the value (empty or `default`) SHALL be accepted at any time. The stored value SHALL remain a free string so provider-specific levels introduced later stay representable without a format change. A stored value that is no longer among the derived options — for example after switching to a catalogue-known model with a narrower level list — SHALL be displayed as "Provider default" and SHALL take effect as unset, without silently rewriting the stored string.

#### Scenario: Invalid value rejected with the allowed list

- **WHEN** a save request carries a value outside the active model's derived set
- **THEN** the request is rejected listing the allowed values and the stored value is unchanged

#### Scenario: Union value accepted for an unknown model

- **WHEN** a save request carries a fallback-union value while the active model is absent from the catalogue
- **THEN** the value is stored and echoed back on read

#### Scenario: Clearing is always accepted

- **WHEN** a save request carries the empty value or `default`, regardless of the active model
- **THEN** the value is cleared and subsequent requests carry no reasoning-effort parameter

#### Scenario: Stale stored value displays as provider default

- **WHEN** the active model changes so the stored value is no longer among the derived options
- **THEN** the settings UI shows "Provider default", no level is sent, and the stored string is left untouched

### Requirement: Request gating and application

A stored level SHALL be sent as the provider's reasoning-effort parameter exactly when it is within the active model's current derived set. This SHALL hold for main user turns, the turn verification pass, and proactive/deferred executions of the config context, which all observe the same effective value for the same stored value and model. When no level is effective — unset, out-of-set after a model switch, or a catalogue non-reasoning model — requests SHALL omit the parameter entirely; a stale value SHALL degrade to "not sent" without failing or delaying the turn. Sending a level SHALL change no other request parameter, and embeddings plus auxiliary LLM paths that build their own models (memory capture and promotion, compaction summarization, context-vault summarization, web distillation, announcement humanization, group-history lookup) SHALL keep provider defaults regardless of the setting. For catalogue-unknown models a chosen union value is forwarded verbatim; if the provider rejects the value, that SHALL surface through the standard request-failure path as the owner's visible experiment outcome, with no silent dropping or special-casing.

#### Scenario: Effective level sent on the main turn

- **WHEN** the stored value is within the active model's derived set and a user sends a message
- **THEN** the provider request carries the reasoning-effort parameter with that value alongside the other generation settings

#### Scenario: Verification pass inherits the level

- **WHEN** a level is in effect and the turn's verification pass runs
- **THEN** the verification request uses the same level

#### Scenario: Proactive and deferred executions inherit the level

- **WHEN** a level is in effect and a proactive or deferred prompt executes for the config context
- **THEN** its generation request carries the same level

#### Scenario: Stale value degrades to not sent

- **WHEN** the active model changes and the stored value falls outside the new model's derived set
- **THEN** subsequent requests omit the reasoning-effort parameter and the turn proceeds normally

#### Scenario: Non-reasoning catalogue model never receives the parameter

- **WHEN** the catalogue marks the active model as not a reasoning model and a value is stored
- **THEN** requests omit the reasoning-effort parameter

#### Scenario: Auxiliary paths keep provider defaults

- **WHEN** a level is in effect and an auxiliary LLM path such as the compaction summarizer builds its own model
- **THEN** that request carries no reasoning-effort parameter

#### Scenario: Provider rejects an unsupported union value

- **WHEN** a union value is sent for a model the catalogue does not know and the provider rejects it
- **THEN** the turn surfaces the provider's error through the standard request-failure path
