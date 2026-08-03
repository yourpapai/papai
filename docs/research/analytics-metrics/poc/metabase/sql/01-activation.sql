-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Dmitriy Lazarev
-- Use of this software is governed by the Business Source License 1.1.
-- See LICENSE in the project root for details.

-- Model grain: one pseudonymous, non-guest actor.
-- The funnel is derived from canonical facts; it does not rely on synthetic
-- milestone events. Every step is conditional on the previous step.
WITH authorized_dm_candidates AS (
  SELECT
    messages.actor_key,
    messages.occurred_at_ms,
    messages.event_id,
    messages.platform,
    messages.platform_instance_key,
    messages.actor_role,
    messages.app_version,
    ROW_NUMBER() OVER (
      PARTITION BY messages.actor_key
      ORDER BY messages.occurred_at_ms, messages.event_id
    ) AS candidate_rank
  FROM analytics_events AS messages
  WHERE messages.event_name = 'chat_message_accepted'
    AND messages.actor_key IS NOT NULL
    AND messages.context_type = 'dm'
    AND messages.actor_role IN ('admin', 'member')
    AND messages.invocation_mode = 'normal'
    AND messages.eligibility IN ('allowed', 'operator_basis')
    AND EXISTS (
      SELECT 1
      FROM analytics_events AS authorization
      WHERE authorization.event_name = 'auth_checked'
        AND authorization.actor_key = messages.actor_key
        AND authorization.turn_key = messages.turn_key
        AND json_extract(authorization.props_json, '$.outcome') = 'granted'
    )
),
first_dm AS (
  SELECT
    actor_key,
    occurred_at_ms AS first_dm_at,
    platform,
    platform_instance_key,
    actor_role,
    app_version AS first_app_version
  FROM authorized_dm_candidates
  WHERE candidate_rank = 1
),
config_link AS (
  SELECT
    first_dm.*,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM analytics_events AS events
      WHERE events.actor_key = first_dm.actor_key
        AND events.event_name = 'config_link_issued'
        AND json_extract(events.props_json, '$.result') = 'issued'
        AND events.occurred_at_ms > first_dm.first_dm_at
        AND events.occurred_at_ms <= first_dm.first_dm_at + (7 * 86400000)
    ) AS config_link_issued_at
  FROM first_dm
),
settings AS (
  SELECT
    config_link.*,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM analytics_events AS events
      WHERE events.actor_key = config_link.actor_key
        AND events.event_name = 'settings_opened'
        AND json_extract(events.props_json, '$.entry') = 'config_link'
        AND json_extract(events.props_json, '$.result') = 'success'
        AND events.occurred_at_ms > config_link.config_link_issued_at
        AND events.occurred_at_ms <= config_link.config_link_issued_at + 86400000
        AND events.occurred_at_ms <= config_link.first_dm_at + (7 * 86400000)
    ) AS settings_opened_at
  FROM config_link
),
assignment_time AS (
  SELECT
    settings.*,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM analytics_events AS events
      WHERE events.actor_key = settings.actor_key
        AND events.event_name = 'task_instance_assigned'
        AND json_extract(events.props_json, '$.change') = 'first_assignment'
        AND events.occurred_at_ms > settings.settings_opened_at
        AND events.occurred_at_ms <= settings.first_dm_at + (7 * 86400000)
    ) AS task_instance_assigned_at
  FROM settings
),
assignment AS (
  SELECT
    assignment_time.*,
    (
      SELECT events.task_instance_key
      FROM analytics_events AS events
      WHERE events.actor_key = assignment_time.actor_key
        AND events.event_name = 'task_instance_assigned'
        AND events.occurred_at_ms = assignment_time.task_instance_assigned_at
      ORDER BY events.event_id
      LIMIT 1
    ) AS assigned_task_instance_key,
    (
      SELECT json_extract(events.props_json, '$.to_provider')
      FROM analytics_events AS events
      WHERE events.actor_key = assignment_time.actor_key
        AND events.event_name = 'task_instance_assigned'
        AND events.occurred_at_ms = assignment_time.task_instance_assigned_at
      ORDER BY events.event_id
      LIMIT 1
    ) AS assigned_task_provider
  FROM assignment_time
),
mutating_success AS (
  SELECT
    assignment.*,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM analytics_events AS events
      WHERE events.actor_key = assignment.actor_key
        AND events.event_name = 'tool_completed'
        AND json_extract(events.props_json, '$.domain') = 'task'
        AND json_extract(events.props_json, '$.risk') IN ('write', 'destructive')
        AND json_extract(events.props_json, '$.execution_outcome') = 'semantic_success'
        AND assignment.assigned_task_instance_key IS NOT NULL
        AND events.task_instance_key = assignment.assigned_task_instance_key
        AND events.task_provider = assignment.assigned_task_provider
        AND events.occurred_at_ms > assignment.task_instance_assigned_at
        AND events.occurred_at_ms <= assignment.first_dm_at + (14 * 86400000)
    ) AS first_mutating_success_at
  FROM assignment
)
SELECT
  actor_key,
  platform,
  platform_instance_key,
  'dm' AS activation_context_type,
  actor_role,
  COALESCE(assigned_task_provider, 'none') AS assigned_task_provider,
  first_app_version,
  date(first_dm_at / 1000, 'unixepoch') AS cohort_date,
  first_dm_at,
  config_link_issued_at,
  settings_opened_at,
  task_instance_assigned_at,
  first_mutating_success_at,
  1 AS reached_first_dm,
  CASE WHEN config_link_issued_at IS NOT NULL THEN 1 ELSE 0 END AS reached_config_link,
  CASE WHEN settings_opened_at IS NOT NULL THEN 1 ELSE 0 END AS reached_settings_opened,
  CASE WHEN task_instance_assigned_at IS NOT NULL THEN 1 ELSE 0 END AS reached_task_assignment,
  CASE WHEN first_mutating_success_at IS NOT NULL THEN 1 ELSE 0 END AS reached_first_mutating_success,
  CASE WHEN first_mutating_success_at IS NOT NULL THEN 1 ELSE 0 END AS activation_completed,
  CASE
    WHEN config_link_issued_at IS NULL THEN 'before_config_link'
    WHEN settings_opened_at IS NULL THEN 'before_settings_opened'
    WHEN task_instance_assigned_at IS NULL THEN 'before_task_assignment'
    WHEN first_mutating_success_at IS NULL THEN 'before_first_mutating_success'
    ELSE 'activated'
  END AS dropoff_step,
  ROUND((config_link_issued_at - first_dm_at) / 60000.0, 2) AS minutes_to_config_link,
  ROUND((settings_opened_at - config_link_issued_at) / 60000.0, 2) AS minutes_config_to_settings,
  ROUND((task_instance_assigned_at - settings_opened_at) / 60000.0, 2) AS minutes_settings_to_assignment,
  ROUND((first_mutating_success_at - task_instance_assigned_at) / 60000.0, 2) AS minutes_assignment_to_success,
  ROUND((first_mutating_success_at - first_dm_at) / 3600000.0, 2) AS hours_to_activation
FROM mutating_success
ORDER BY first_dm_at, actor_key;
