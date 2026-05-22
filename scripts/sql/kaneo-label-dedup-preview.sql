-- Preview duplicate reusable workspace labels
SELECT
  l.workspace_id,
  l.name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(l.id ORDER BY l.id) AS label_ids
FROM "label" l
WHERE l.workspace_id IS NOT NULL
  AND l.task_id IS NULL
GROUP BY l.workspace_id, l.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, l.workspace_id, l.name;

-- Preview duplicate same-name labels on the same task
SELECT
  l.task_id,
  l.name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(l.id ORDER BY l.id) AS label_ids
FROM "label" l
WHERE l.task_id IS NOT NULL
GROUP BY l.task_id, l.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, l.task_id, l.name;
