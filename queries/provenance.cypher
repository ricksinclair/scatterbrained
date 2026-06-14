// Where did a given Insight come from, and what else informs the same things?
// :param match => 'compliance calendar'
MATCH (i:Insight) WHERE toLower(i.summary) CONTAINS toLower($match)
OPTIONAL MATCH (i)-[:DERIVED_FROM]->(s)
OPTIONAL MATCH (i)-[:ABOUT]->(a)
OPTIONAL MATCH (other:Source)-[:INFORMS]->(a)
RETURN i.summary AS insight,
       collect(DISTINCT coalesce(s.title, s.name)) AS derived_from,
       collect(DISTINCT coalesce(a.name, a.title)) AS about,
       collect(DISTINCT other.title) AS other_sources_on_same_topics;
