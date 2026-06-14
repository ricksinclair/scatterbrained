// ============================================================================
// Engram — synthetic demo graph
//
// A tiny, fictional knowledge graph (~16 nodes) so the toolkit produces real
// output the moment you clone the repo. It exercises every node label and the
// core edge types, passes `npm run lint:graph`, and includes ONE already-
// superseded fact so the bi-temporal model is visible immediately.
//
// Load it (after `npm install` and `docker compose up -d`):
//   cat scripts/seed-schema.cypher examples/seed-demo.cypher | \
//     docker exec -i engram-neo4j cypher-shell -u neo4j -p engram-local
//
// Then try:  npm run lint:graph  ·  npm run context -- --project Acme
//
// Each statement is self-contained (cypher-shell runs ;-separated statements
// independently, so edges re-MATCH their endpoints by key). All MERGE-keyed and
// dated, exactly as the real ingestion writes — re-running is idempotent. All
// data here is invented.
// ============================================================================

// --- People & orgs ----------------------------------------------------------
MERGE (jordan:Person {name:'Jordan Lee'})
  SET jordan.role='Staff Engineer', jordan.organization='Acme Inc',
      jordan.relationship_to_owner='mentor', jordan.tags=['mentor','engineering'],
      jordan.created_at=coalesce(jordan.created_at, datetime('2026-01-05'));

MERGE (acmeinc:Organization {name:'Acme Inc'})
  SET acmeinc.type='startup', acmeinc.purpose='Builds developer tools',
      acmeinc.tags=['acme','company'],
      acmeinc.created_at=coalesce(acmeinc.created_at, datetime('2026-01-05'));

// --- Project, goal ----------------------------------------------------------
MERGE (acme:Project {name:'Acme'})
  SET acme.status='active', acme.domain='software',
      acme.description='A local-first developer tool (the demo project).',
      acme.repo_url='https://example.com/acme', acme.tags=['acme','software'],
      acme.created_at=coalesce(acme.created_at, datetime('2026-01-08'));

MERGE (goal:Goal {name:'Ship Acme v1'})
  SET goal.timeframe='90_days', goal.status='in_progress',
      goal.description='Cut the first public release of Acme.',
      goal.tags=['acme'], goal.created_at=coalesce(goal.created_at, datetime('2026-01-08'));

// --- Skills, resource, rule, idea -------------------------------------------
MERGE (cypher:Skill {name:'Cypher'})
  SET cypher.category='database', cypher.proficiency='intermediate',
      cypher.tags=['database','query'], cypher.created_at=coalesce(cypher.created_at, datetime('2026-01-09'));

MERGE (neo:Skill {name:'Neo4j'})
  SET neo.category='database', neo.proficiency='beginner',
      neo.tags=['database','graph'], neo.created_at=coalesce(neo.created_at, datetime('2026-01-09'));

MERGE (academy:Resource {title:'Neo4j GraphAcademy'})
  SET academy.type='course', academy.url='https://graphacademy.neo4j.com',
      academy.summary='Free courses on Cypher and Neo4j.', academy.tags=['learning','graph'],
      academy.created_at=coalesce(academy.created_at, datetime('2026-01-09'));

MERGE (rule:Rule {name:'MIT-license compatibility'})
  SET rule.type='legal', rule.jurisdiction='n/a', rule.citation='MIT License',
      rule.summary='All bundled dependencies must be MIT-compatible.', rule.confidence='high',
      rule.tags=['legal','licensing'], rule.created_at=coalesce(rule.created_at, datetime('2026-01-10'));

MERGE (idea:Idea {name:'Offline-first sync'})
  SET idea.status='open_question', idea.domain='software',
      idea.description='Let Acme work offline and reconcile on reconnect.', idea.tags=['acme','sync'],
      idea.created_at=coalesce(idea.created_at, datetime('2026-01-12'));

// --- Sources (one per capture lane) -----------------------------------------
MERGE (spec:Source {title:'Acme — Architecture Spec'})
  SET spec.source_kind='notion_page', spec.url='https://www.notion.so/acme-architecture',
      spec.notion_id='00000000000000000000000000000099', spec.last_synced_at=datetime('2026-02-01'),
      spec.tags=['acme','architecture'], spec.created_at=coalesce(spec.created_at, datetime('2026-01-15'));

MERGE (readme:Source {title:'acme/README.md'})
  SET readme.source_kind='markdown', readme.file_path='/home/you/Projects/acme/README.md',
      readme.display_title='Acme', readme.content_hash='demoreadmehash',
      readme.tags=['acme'], readme.created_at=coalesce(readme.created_at, datetime('2026-01-15'));

// --- Insights (apostrophe-free to stay cypher-shell-safe) -------------------
MERGE (iBitemporal:Insight {id:'demo-bitemporal'})
  SET iBitemporal.summary='Bi-temporal modeling beats hard deletes for an auditable history.',
      iBitemporal.full_text='Keeping superseded facts (valid_until) instead of deleting them preserves provenance and lets contradictions resolve by recency.',
      iBitemporal.session_id='seed-demo', iBitemporal.tags=['acme','architecture','modeling'],
      iBitemporal.created_at=coalesce(iBitemporal.created_at, datetime('2026-01-20'));

MERGE (iOffline:Insight {id:'demo-offline-conflict'})
  SET iOffline.summary='Offline-first requires an explicit conflict-resolution policy.',
      iOffline.full_text='Without a documented merge strategy, offline edits silently clobber each other on reconnect.',
      iOffline.session_id='seed-demo', iOffline.tags=['acme','sync'],
      iOffline.created_at=coalesce(iOffline.created_at, datetime('2026-01-20'));

// A superseded fact (kept, not deleted) + the fact that replaced it.
MERGE (iRest:Insight {id:'demo-rest-api'})
  SET iRest.summary='The Acme sync layer will expose a REST API.',
      iRest.session_id='seed-demo', iRest.tags=['acme','architecture'],
      iRest.created_at=coalesce(iRest.created_at, datetime('2026-01-10')),
      iRest.valid_until=datetime('2026-02-01'),
      iRest.superseded_by='demo-graphql',
      iRest.invalidated_reason='Team chose GraphQL over REST for the sync layer.';

MERGE (iGraphql:Insight {id:'demo-graphql'})
  SET iGraphql.summary='The Acme sync layer will expose GraphQL, not REST.',
      iGraphql.session_id='seed-demo', iGraphql.tags=['acme','architecture'],
      iGraphql.created_at=coalesce(iGraphql.created_at, datetime('2026-02-01'));

// --- Operational singleton (orphan-whitelisted) -----------------------------
MERGE (ss:SyncState {key:'notion'}) SET ss.last_full_sync=datetime('2026-02-01');

// --- Edges (each re-MATCHes its endpoints by natural key) -------------------
MATCH (a:Person {name:'Jordan Lee'}), (b:Organization {name:'Acme Inc'}) MERGE (a)-[:WORKS_AT]->(b);
MATCH (a:Person {name:'Jordan Lee'}), (b:Project {name:'Acme'}) MERGE (a)-[:ADVISED_ON]->(b);
MATCH (a:Project {name:'Acme'}), (b:Idea {name:'Offline-first sync'}) MERGE (a)-[:CONTAINS]->(b);
MATCH (a:Goal {name:'Ship Acme v1'}), (b:Project {name:'Acme'}) MERGE (a)-[:ACHIEVED_BY]->(b);
MATCH (a:Goal {name:'Ship Acme v1'}), (b:Skill {name:'Cypher'}) MERGE (a)-[:REQUIRES]->(b);
MATCH (a:Goal {name:'Ship Acme v1'}), (b:Skill {name:'Neo4j'}) MERGE (a)-[:REQUIRES]->(b);
MATCH (a:Resource {title:'Neo4j GraphAcademy'}), (b:Skill {name:'Cypher'}) MERGE (a)-[:TEACHES]->(b);
MATCH (a:Resource {title:'Neo4j GraphAcademy'}), (b:Skill {name:'Neo4j'}) MERGE (a)-[:TEACHES]->(b);
MATCH (a:Rule {name:'MIT-license compatibility'}), (b:Idea {name:'Offline-first sync'}) MERGE (a)-[:CONSTRAINS]->(b);
MATCH (a:Source {title:'Acme — Architecture Spec'}), (b:Project {name:'Acme'}) MERGE (a)-[:INFORMS]->(b);
MATCH (a:Source {title:'Acme — Architecture Spec'}), (b:Idea {name:'Offline-first sync'}) MERGE (a)-[:INFORMS]->(b);
MATCH (a:Source {title:'acme/README.md'}), (b:Project {name:'Acme'}) MERGE (a)-[:INFORMS]->(b);
MATCH (a:Insight {id:'demo-bitemporal'}), (b:Project {name:'Acme'}) MERGE (a)-[:ABOUT]->(b);
MATCH (a:Insight {id:'demo-bitemporal'}), (b:Source {title:'Acme — Architecture Spec'}) MERGE (a)-[:DERIVED_FROM]->(b);
MATCH (a:Insight {id:'demo-offline-conflict'}), (b:Idea {name:'Offline-first sync'}) MERGE (a)-[:ABOUT]->(b);
MATCH (a:Insight {id:'demo-offline-conflict'}), (b:Source {title:'acme/README.md'}) MERGE (a)-[:DERIVED_FROM]->(b);
MATCH (a:Insight {id:'demo-rest-api'}), (b:Project {name:'Acme'}) MERGE (a)-[:ABOUT]->(b);
MATCH (a:Insight {id:'demo-rest-api'}), (b:Source {title:'Acme — Architecture Spec'}) MERGE (a)-[:DERIVED_FROM]->(b);
MATCH (a:Insight {id:'demo-graphql'}), (b:Project {name:'Acme'}) MERGE (a)-[:ABOUT]->(b);
MATCH (a:Insight {id:'demo-graphql'}), (b:Source {title:'Acme — Architecture Spec'}) MERGE (a)-[:DERIVED_FROM]->(b);

RETURN 'seed-demo loaded' AS status;
