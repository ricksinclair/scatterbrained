// What's disconnected / invisible to traversal? (SyncState is allowed to be orphaned.)
MATCH (n)
WHERE NOT (n)--() AND NOT n:SyncState
RETURN labels(n) AS labels,
       coalesce(n.name, n.title, n.id, '<unnamed>') AS key,
       n.created_at AS created
ORDER BY labels;
