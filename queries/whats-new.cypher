// What conclusions were reached most recently?
// Newest Insights with what they're about and where they came from.
MATCH (i:Insight)
OPTIONAL MATCH (i)-[:ABOUT]->(a)
OPTIONAL MATCH (i)-[:DERIVED_FROM]->(s:Source)
RETURN i.created_at AS when,
       i.summary    AS insight,
       collect(DISTINCT coalesce(a.name, a.title)) AS about,
       collect(DISTINCT coalesce(s.title, s.file_path)) AS sources
ORDER BY i.created_at DESC
LIMIT 15;
