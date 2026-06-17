// ============================================================================
// Scatterbrained — demo graph (real-world use case: an engineering decision log)
//
// A believable ~23-node graph from TWO personas sharing one project:
//   • Maya Okonkwo — staff platform engineer migrating an ingestion pipeline to Kafka
//   • Daniel Reyes — her mentor (ex-Stripe principal), contributing rules + resources
//
// It exercises every node label and every Studio surface: provenance (a PDF + a
// CSV + an ADR), a bi-temporal SUPERSEDED decision (SQS → Kafka), a Goal with a
// progress meter, a Rule with confidence + citation, a saved web link, an embedded
// YouTube talk, and node notes (raw + addressed). Passes `npm run lint:graph`.
// All data is invented but plausible.
//
// Load:  cat scripts/seed-schema.cypher examples/seed-demo.cypher | \
//          docker exec -i scatterbrained-neo4j cypher-shell -u neo4j -p scatterbrained-local
// ============================================================================

// --- People & org -----------------------------------------------------------
MERGE (maya:Person {name:'Maya Okonkwo'})
  SET maya.role='Staff Platform Engineer', maya.organization='Lattice Payments',
      maya.relationship_to_owner='self', maya.tags=['engineering','streaming'],
      maya.created_at=coalesce(maya.created_at, datetime('2026-01-08'));
MERGE (daniel:Person {name:'Daniel Reyes'})
  SET daniel.role='Engineering mentor & staff-level consultant (ex-Stripe Principal)',
      daniel.relationship_to_owner='mentor', daniel.tags=['mentor','engineering'],
      daniel.created_at=coalesce(daniel.created_at, datetime('2026-01-08'));
MERGE (lattice:Organization {name:'Lattice Payments'})
  SET lattice.type='fintech', lattice.purpose='Series-C payments platform; ~140 engineers, ~2.3M transactions/day',
      lattice.tags=['fintech'], lattice.created_at=coalesce(lattice.created_at, datetime('2026-01-08'));

// --- Project & goal ---------------------------------------------------------
MERGE (proj:Project {name:'Ingestion Pipeline → Kafka Migration'})
  SET proj.status='in progress', proj.domain='platform-engineering',
      proj.description='Replace the homegrown Redis-list queue ("Sluice") with Kafka on the payment-event ingestion path. Target: p99 end-to-end latency < 150ms at 5k events/sec.',
      proj.tags=['kafka','streaming','migration'], proj.created_at=coalesce(proj.created_at, datetime('2026-01-12'));
MERGE (goal:Goal {name:'Cut ingestion p99 latency below 150ms'})
  SET goal.timeframe='90_days', goal.status='active',
      goal.description='Q1 reliability OKR. Baseline p99 was 410ms on the Sluice queue; target < 150ms at 5k events/sec.',
      goal.tags=['reliability','okr'], goal.created_at=coalesce(goal.created_at, datetime('2026-01-12'));

// --- Ideas ------------------------------------------------------------------
MERGE (idem:Idea {name:'Idempotency via dedup keys in the consumer'})
  SET idem.status='done', idem.domain='platform-engineering',
      idem.description='Each consumer writes a (partition, event_id) dedup row in Postgres before any side-effect, so at-least-once redelivery is safe.',
      idem.tags=['kafka','idempotency'], idem.created_at=coalesce(idem.created_at, datetime('2026-02-02'));
MERGE (dlq:Idea {name:'Dead-letter topic with replay tooling'})
  SET dlq.status='in progress', dlq.domain='platform-engineering',
      dlq.description='Route poison messages to ingestion.dlq and build a CLI to inspect and selectively replay them.',
      dlq.tags=['kafka','dlq','tooling'], dlq.created_at=coalesce(dlq.created_at, datetime('2026-02-18'));

// --- Rules (Daniel's playbook) ----------------------------------------------
MERGE (rIdem:Rule {name:'Every consumer must be idempotent'})
  SET rIdem.type='engineering-principle', rIdem.confidence='high',
      rIdem.citation='Kleppmann, Designing Data-Intensive Applications (2017), Ch.11 "Stream Processing", pp.440-451',
      rIdem.summary='At-least-once delivery is the norm; assume every message can be redelivered.',
      rIdem.tags=['kafka','reliability'], rIdem.created_at=coalesce(rIdem.created_at, datetime('2026-02-02'));
MERGE (rPart:Rule {name:'Cap partition count near 12x broker cores'})
  SET rPart.type='engineering-heuristic', rPart.confidence='medium',
      rPart.citation='Confluent, "How to Choose the Number of Topics/Partitions in a Kafka Cluster" (2020)',
      rPart.summary='Over-partitioning lengthens rebalance and failover time; size partitions to the cluster.',
      rPart.tags=['kafka','tuning'], rPart.created_at=coalesce(rPart.created_at, datetime('2026-02-10'));

// --- Resources (link + video) -----------------------------------------------
MERGE (guide:Resource {url:'https://www.confluent.io/resources/kafka-the-definitive-guide/'})
  SET guide.title='Kafka: The Definitive Guide, 2nd ed.', guide.type='link',
      guide.summary='Reference for consumer-group semantics and delivery guarantees.',
      guide.tags=['kafka','reference'], guide.created_at=coalesce(guide.created_at, datetime('2026-01-20'));
MERGE (talk:Resource {url:'https://www.youtube.com/watch?v=aJuo_bLSW6s'})
  SET talk.title='Jay Kreps - "Kafka and the Log" (talk)', talk.type='video',
      talk.summary='Foundational talk on the log as a unifying abstraction for data systems.',
      talk.tags=['kafka','talk'], talk.created_at=coalesce(talk.created_at, datetime('2026-01-22'));

// --- Sources (provenance: csv + pdf + markdown + repo) ----------------------
MERGE (bench:Source {title:'Queue benchmark - Sluice vs Kafka vs SQS (Q1)'})
  SET bench.source_kind='csv', bench.file_path='benchmarks/queue-benchmark-q1.csv',
      bench.summary='Throughput + latency + cost. Sluice 2100 eps / p99 410ms / $0; Kafka 5400 eps / p99 118ms / $1.40 per M; SQS 3200 eps / p99 240ms / $4.00 per M.',
      bench.tags=['benchmark','kafka'], bench.created_at=coalesce(bench.created_at, datetime('2026-02-25'));
MERGE (cost:Source {title:'Streaming Backend Cost & Ops Analysis - Q1'})
  SET cost.source_kind='pdf', cost.file_path='memos/streaming-cost-analysis-q1.pdf',
      cost.summary='9-page internal memo. 12-month TCO at projected volume: Kafka self-managed $61k vs MSK $94k vs SQS $138k.',
      cost.tags=['cost','kafka'], cost.created_at=coalesce(cost.created_at, datetime('2026-02-26'));
MERGE (adr:Source {title:'ADR-014 - Adopt Kafka for ingestion'})
  SET adr.source_kind='markdown', adr.file_path='docs/adr/ADR-014-adopt-kafka.md',
      adr.summary='Architecture Decision Record recording the move from SQS to self-managed Kafka, with the benchmark + cost rationale.',
      adr.tags=['adr','decision'], adr.created_at=coalesce(adr.created_at, datetime('2026-03-02'));
MERGE (repo:Source {title:'lattice-payments/ingestion-svc'})
  SET repo.source_kind='git_repo', repo.url='https://github.com/lattice-payments/ingestion-svc',
      repo.summary='The service repository where the migration lands.',
      repo.tags=['repo'], repo.created_at=coalesce(repo.created_at, datetime('2026-01-12'));

// --- Insights (the bi-temporal pair + one more) -----------------------------
MERGE (insSqs:Insight {id:'ins-001-sqs'})
  SET insSqs.summary='Chose AWS SQS FIFO for the ingestion queue',
      insSqs.full_text='2026-02-10: Decided to adopt SQS FIFO - fully managed, no ops burden, exactly-once within a dedup window. Rejected Kafka as operationally heavy for a team our size.',
      insSqs.status='superseded',
      insSqs.valid_until=datetime('2026-03-02'), insSqs.superseded_by='ins-002-kafka',
      insSqs.invalidated_reason='Benchmark + cost analysis showed SQS p99 (240ms) misses the 150ms goal and costs ~2.3x Kafka at our volume; per-message price dominates at 2.3M tx/day.',
      insSqs.tags=['decision','kafka'], insSqs.created_at=coalesce(insSqs.created_at, datetime('2026-02-10'));
MERGE (insKafka:Insight {id:'ins-002-kafka'})
  SET insKafka.summary='Adopted self-managed Kafka for ingestion',
      insKafka.full_text='2026-03-02 (ADR-014): Kafka self-managed on 3 brokers. Hits p99 118ms in benchmark at $1.40 per M vs SQS $4.00 per M. Accepts the ops cost for the latency + unit economics; idempotency handled in-consumer.',
      insKafka.status='shipped',
      insKafka.tags=['decision','kafka'], insKafka.created_at=coalesce(insKafka.created_at, datetime('2026-03-02'));
MERGE (insRebal:Insight {id:'ins-003-rebalance'})
  SET insRebal.summary='Partition-rebalance storms traced to over-partitioning',
      insRebal.full_text='2026-04-15: A 90s consumer stall during deploys was caused by 64 partitions on a 4-core broker set. Dropping to 36 cut rebalance time from 90s to 11s.',
      insRebal.tags=['kafka','tuning','postmortem'], insRebal.created_at=coalesce(insRebal.created_at, datetime('2026-04-15'));

// --- Skill ------------------------------------------------------------------
MERGE (skill:Skill {name:'Kafka consumer-group tuning'})
  SET skill.category='platform-engineering', skill.proficiency='working', skill.status='live',
      skill.tags=['kafka','tuning'], skill.created_at=coalesce(skill.created_at, datetime('2026-03-10'));

// --- Notes (deferred-instruction inbox: one raw, one addressed) -------------
MERGE (note1:Note {id:'note-dlq-policy'})
  SET note1.text='Should the DLQ replay CLI auto-skip messages that fail 3x, or hold them for human review? Lean toward hold.',
      note1.state='raw', note1.anchor_kind='node', note1.created_at=coalesce(note1.created_at, datetime('2026-04-20'));
MERGE (note2:Note {id:'note-ttl-index'})
  SET note2.text='Confirmed: the idempotency dedup table needs a TTL index - rows were never expiring and the table hit 40GB.',
      note2.state='addressed', note2.anchor_kind='node', note2.created_at=coalesce(note2.created_at, datetime('2026-04-18'));

// === Edges (each re-MATCHes its endpoints by key) ===========================
MATCH (maya:Person {name:'Maya Okonkwo'}), (lattice:Organization {name:'Lattice Payments'}) MERGE (maya)-[:WORKS_AT]->(lattice);
MATCH (maya:Person {name:'Maya Okonkwo'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (maya)-[:COLLABORATES_ON]->(proj);
MATCH (daniel:Person {name:'Daniel Reyes'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (daniel)-[:ADVISED_ON]->(proj);
MATCH (daniel:Person {name:'Daniel Reyes'}), (guide:Resource {url:'https://www.confluent.io/resources/kafka-the-definitive-guide/'}) MERGE (daniel)-[:RECOMMENDED]->(guide);
MATCH (daniel:Person {name:'Daniel Reyes'}), (talk:Resource {url:'https://www.youtube.com/watch?v=aJuo_bLSW6s'}) MERGE (daniel)-[:RECOMMENDED]->(talk);
MATCH (daniel:Person {name:'Daniel Reyes'}), (skill:Skill {name:'Kafka consumer-group tuning'}) MERGE (daniel)-[:TEACHES]->(skill);

// goal progress (3 of 4 requirements "done" → ~75%)
MATCH (goal:Goal {name:'Cut ingestion p99 latency below 150ms'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (goal)-[:ACHIEVED_BY]->(proj);
MATCH (goal:Goal {name:'Cut ingestion p99 latency below 150ms'}), (idem:Idea {name:'Idempotency via dedup keys in the consumer'}) MERGE (goal)-[:REQUIRES]->(idem);
MATCH (goal:Goal {name:'Cut ingestion p99 latency below 150ms'}), (dlq:Idea {name:'Dead-letter topic with replay tooling'}) MERGE (goal)-[:REQUIRES]->(dlq);
MATCH (goal:Goal {name:'Cut ingestion p99 latency below 150ms'}), (insKafka:Insight {id:'ins-002-kafka'}) MERGE (goal)-[:REQUIRES]->(insKafka);
MATCH (goal:Goal {name:'Cut ingestion p99 latency below 150ms'}), (skill:Skill {name:'Kafka consumer-group tuning'}) MERGE (goal)-[:REQUIRES]->(skill);

// project internals
MATCH (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}), (idem:Idea {name:'Idempotency via dedup keys in the consumer'}) MERGE (proj)-[:CONTAINS]->(idem);
MATCH (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}), (dlq:Idea {name:'Dead-letter topic with replay tooling'}) MERGE (proj)-[:CONTAINS]->(dlq);
MATCH (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}), (repo:Source {title:'lattice-payments/ingestion-svc'}) MERGE (proj)-[:DEPENDS_ON]->(repo);
MATCH (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}), (dlq:Idea {name:'Dead-letter topic with replay tooling'}) MERGE (proj)-[:BLOCKED_BY]->(dlq);

// rules
MATCH (rIdem:Rule {name:'Every consumer must be idempotent'}), (idem:Idea {name:'Idempotency via dedup keys in the consumer'}) MERGE (rIdem)-[:APPLIES_TO]->(idem);
MATCH (rIdem:Rule {name:'Every consumer must be idempotent'}), (guide:Resource {url:'https://www.confluent.io/resources/kafka-the-definitive-guide/'}) MERGE (rIdem)-[:INFORMED_BY]->(guide);
MATCH (rPart:Rule {name:'Cap partition count near 12x broker cores'}), (skill:Skill {name:'Kafka consumer-group tuning'}) MERGE (rPart)-[:APPLIES_TO]->(skill);
MATCH (rPart:Rule {name:'Cap partition count near 12x broker cores'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (rPart)-[:CONSTRAINS]->(proj);

// provenance — the Kafka decision is informed by 3 sources (csv + pdf + markdown)
MATCH (bench:Source {title:'Queue benchmark - Sluice vs Kafka vs SQS (Q1)'}), (insKafka:Insight {id:'ins-002-kafka'}) MERGE (bench)-[:INFORMS]->(insKafka);
MATCH (cost:Source {title:'Streaming Backend Cost & Ops Analysis - Q1'}), (insKafka:Insight {id:'ins-002-kafka'}) MERGE (cost)-[:INFORMS]->(insKafka);
MATCH (adr:Source {title:'ADR-014 - Adopt Kafka for ingestion'}), (insKafka:Insight {id:'ins-002-kafka'}) MERGE (adr)-[:INFORMS]->(insKafka);
MATCH (repo:Source {title:'lattice-payments/ingestion-svc'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (repo)-[:INFORMS]->(proj);

// insights ABOUT nodes (lint: every Insight must be ABOUT something)
MATCH (insSqs:Insight {id:'ins-001-sqs'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (insSqs)-[:ABOUT]->(proj);
MATCH (insKafka:Insight {id:'ins-002-kafka'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (insKafka)-[:ABOUT]->(proj);
MATCH (insRebal:Insight {id:'ins-003-rebalance'}), (skill:Skill {name:'Kafka consumer-group tuning'}) MERGE (insRebal)-[:ABOUT]->(skill);

// supersession links, drawn explicitly
MATCH (insSqs:Insight {id:'ins-001-sqs'}), (bench:Source {title:'Queue benchmark - Sluice vs Kafka vs SQS (Q1)'}) MERGE (insSqs)-[:DERIVED_FROM]->(bench);
MATCH (insSqs:Insight {id:'ins-001-sqs'}), (insKafka:Insight {id:'ins-002-kafka'}) MERGE (insSqs)-[:INFORMS]->(insKafka);

// skill usage + resource provenance
MATCH (skill:Skill {name:'Kafka consumer-group tuning'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (skill)-[:USED_IN]->(proj);
MATCH (guide:Resource {url:'https://www.confluent.io/resources/kafka-the-definitive-guide/'}), (rIdem:Rule {name:'Every consumer must be idempotent'}) MERGE (guide)-[:INFORMS]->(rIdem);
MATCH (talk:Resource {url:'https://www.youtube.com/watch?v=aJuo_bLSW6s'}), (skill:Skill {name:'Kafka consumer-group tuning'}) MERGE (talk)-[:INFORMS]->(skill);

// notes ABOUT their target
MATCH (note1:Note {id:'note-dlq-policy'}), (dlq:Idea {name:'Dead-letter topic with replay tooling'}) MERGE (note1)-[:ABOUT]->(dlq);
MATCH (note2:Note {id:'note-ttl-index'}), (idem:Idea {name:'Idempotency via dedup keys in the consumer'}) MERGE (note2)-[:ABOUT]->(idem);

// ============================================================================
// USE CASE 2 — give stakeholders information easily.
// The same graph also serves the *audience*: Maya briefs her VP. One click —
// expand the project to a Report — turns the decision log into a clean,
// export-ready Markdown briefing (status, the key decision + why, the one risk).
// ============================================================================
MERGE (priya:Person {name:'Priya Nair'})
  SET priya.role='VP Engineering, Lattice Payments', priya.relationship_to_owner='stakeholder',
      priya.tags=['stakeholder','leadership'], priya.created_at=coalesce(priya.created_at, datetime('2026-01-09'));
MERGE (review:Insight {id:'ins-004-q1-review'})
  SET review.summary='Q1 stakeholder briefing: ingestion migration on track, one open risk',
      review.full_text='2026-04-21, for VP Eng: p99 is down from 410ms to 118ms in benchmark (goal < 150ms). 3 of 4 workstreams are done; the DLQ replay tooling is the remaining risk and blocks GA. Running ~2.3x cheaper than the SQS path we reversed in March.',
      review.status='current', review.tags=['stakeholder','status','briefing'],
      review.created_at=coalesce(review.created_at, datetime('2026-04-21'));

MATCH (priya:Person {name:'Priya Nair'}), (lattice:Organization {name:'Lattice Payments'}) MERGE (priya)-[:WORKS_AT]->(lattice);
MATCH (priya:Person {name:'Priya Nair'}), (goal:Goal {name:'Cut ingestion p99 latency below 150ms'}) MERGE (priya)-[:SUPPORTS]->(goal);
MATCH (review:Insight {id:'ins-004-q1-review'}), (proj:Project {name:'Ingestion Pipeline → Kafka Migration'}) MERGE (review)-[:ABOUT]->(proj);
MATCH (review:Insight {id:'ins-004-q1-review'}), (bench:Source {title:'Queue benchmark - Sluice vs Kafka vs SQS (Q1)'}) MERGE (review)-[:DERIVED_FROM]->(bench);
MATCH (review:Insight {id:'ins-004-q1-review'}), (insKafka:Insight {id:'ins-002-kafka'}) MERGE (review)-[:DERIVED_FROM]->(insKafka);
