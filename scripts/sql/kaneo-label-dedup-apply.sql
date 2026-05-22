BEGIN;

-- Remove duplicate reusable workspace labels, keeping the lexicographically smallest id
WITH ranked_workspace AS (
  SELECT
    l.id,
    ROW_NUMBER() OVER (
      PARTITION BY l.workspace_id, l.name
      ORDER BY l.id
    ) AS rn
  FROM "label" l
  WHERE l.workspace_id IS NOT NULL
    AND l.task_id IS NULL
),
delete_workspace AS (
  SELECT id
  FROM ranked_workspace
  WHERE rn > 1
)
DELETE FROM "label" l
USING delete_workspace d
WHERE l.id = d.id;

-- Remove duplicate same-name labels on the same task, keeping the lexicographically smallest id
WITH ranked_task AS (
  SELECT
    l.id,
    ROW_NUMBER() OVER (
      PARTITION BY l.task_id, l.name
      ORDER BY l.id
    ) AS rn
  FROM "label" l
  WHERE l.task_id IS NOT NULL
),
delete_task AS (
  SELECT id
  FROM ranked_task
  WHERE rn > 1
)
DELETE FROM "label" l
USING delete_task d
WHERE l.id = d.id;

COMMIT;
