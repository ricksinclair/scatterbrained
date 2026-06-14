// Show everything connected to a project — the visual map.
// Best run in Neo4j Browser (renders as a draggable graph).
// :param project => 'Acme'
MATCH p = (proj:Project)-[*1..2]-(n)
WHERE toLower(proj.name) CONTAINS toLower($project)
RETURN p
LIMIT 300;
