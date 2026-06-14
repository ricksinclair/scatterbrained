// Which law Rules constrain a given project (and its ideas)?
// :param project => 'Acme'
MATCH (r:Rule)-[:CONSTRAINS|APPLIES_TO]->(t)
WHERE (t:Project AND toLower(t.name) CONTAINS toLower($project))
   OR (t:Idea AND EXISTS { MATCH (:Project {name:$project})-[:CONTAINS]->(t) })
RETURN r.name AS rule, r.jurisdiction AS jurisdiction,
       r.confidence AS confidence, r.citation AS citation,
       coalesce(t.name, t.title) AS constrains
ORDER BY r.confidence DESC, r.name;
