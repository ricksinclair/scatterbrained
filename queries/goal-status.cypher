// What are my goals and what's working toward them?
MATCH (g:Goal)
OPTIONAL MATCH (g)-[:ACHIEVED_BY]->(p:Project)
OPTIONAL MATCH (g)-[:REQUIRES]->(sk:Skill)
RETURN g.name AS goal, g.status AS status, g.timeframe AS timeframe,
       collect(DISTINCT p.name)  AS projects,
       collect(DISTINCT sk.name) AS requires_skills
ORDER BY g.status, g.name;
