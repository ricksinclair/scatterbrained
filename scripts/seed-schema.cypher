// ============================================================================
// Engram — Knowledge Graph Schema
// Safe to re-run: uses CREATE CONSTRAINT IF NOT EXISTS.
// Node creation happens via MERGE in the application scripts; this file
// establishes uniqueness constraints (which also create backing indexes).
// ============================================================================

// ---------------------------------------------------------------------------
// Uniqueness constraints (one per node label, on its natural key)
// ---------------------------------------------------------------------------
CREATE CONSTRAINT person_name        IF NOT EXISTS FOR (n:Person)       REQUIRE n.name  IS UNIQUE;
CREATE CONSTRAINT organization_name  IF NOT EXISTS FOR (n:Organization) REQUIRE n.name  IS UNIQUE;
CREATE CONSTRAINT project_name       IF NOT EXISTS FOR (n:Project)      REQUIRE n.name  IS UNIQUE;
CREATE CONSTRAINT idea_name          IF NOT EXISTS FOR (n:Idea)         REQUIRE n.name  IS UNIQUE;
CREATE CONSTRAINT rule_name          IF NOT EXISTS FOR (n:Rule)         REQUIRE n.name  IS UNIQUE;
CREATE CONSTRAINT resource_title     IF NOT EXISTS FOR (n:Resource)     REQUIRE n.title IS UNIQUE;
CREATE CONSTRAINT source_title       IF NOT EXISTS FOR (n:Source)       REQUIRE n.title IS UNIQUE;
CREATE CONSTRAINT insight_id         IF NOT EXISTS FOR (n:Insight)      REQUIRE n.id    IS UNIQUE;
CREATE CONSTRAINT skill_name         IF NOT EXISTS FOR (n:Skill)        REQUIRE n.name  IS UNIQUE;
CREATE CONSTRAINT goal_name          IF NOT EXISTS FOR (n:Goal)         REQUIRE n.name  IS UNIQUE;

// Non-unique lookup index: the document lane (scripts/document-index.js) resolves
// file Sources by absolute path on every change-detection pass.
CREATE INDEX source_file_path        IF NOT EXISTS FOR (n:Source)       ON (n.file_path);

// Full-text (BM25/Lucene) index — the keyword retrieval lane (scripts/search.js).
// Spans every text-bearing label/property; missing properties are simply skipped.
CREATE FULLTEXT INDEX knowledge_text IF NOT EXISTS
  FOR (n:Insight|Idea|Rule|Project|Resource|Goal|Person|Organization|Skill|Source)
  ON EACH [n.summary, n.full_text, n.name, n.title, n.description, n.purpose, n.role];

// ============================================================================
// NODE LABEL REFERENCE
// ============================================================================
// Person       { name*, role, organization, jurisdiction, contact_info,
//                relationship_to_owner, tags[], created_at }
// Organization { name*, type, jurisdiction, url, purpose, tags[], created_at }
// Project      { name*, status, domain, description, repo_url, notion_url,
//                tags[], created_at }
// Idea         { name*, description, status, domain, tags[], created_at }
// Rule         { name*, type, jurisdiction, citation, summary, confidence,
//                tags[], created_at }
// Resource     { title*, type, url, summary, tags[], created_at }
// Source       { title*, type, url, last_synced_at, tags[], created_at,
//                source_kind ('notion'|'markdown'|'text'|'pdf'|'docx'|'pptx'),
//                -- notion lane:   notion_id, notion_last_edited
//                -- document lane: file_path (abs), display_title,
//                                  content_hash, file_mtime
//                title for files = path relative to its configured root, so it
//                is unique and stable across edits (a heading can change). }
// Insight      { id*, summary, full_text, session_id, tags[], created_at }
// Skill        { name*, category, proficiency, tags[], created_at }
// Goal         { name*, timeframe, status, description, tags[], created_at }
// (* = unique natural key)

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================
// -- People & Orgs
// (Person)-[:WORKS_AT]->(Organization)
// (Person)-[:ADVISED_ON {date, note}]->(Rule)
// (Person)-[:ADVISED_ON {date, note}]->(Idea)
// (Person)-[:FLAGGED_RISK {note}]->(Idea)
// (Person)-[:RECOMMENDED]->(Organization)
// (Person)-[:RECOMMENDED]->(Resource)
// (Person)-[:COLLABORATES_ON]->(Project)
// (Organization)-[:SUPPORTS]->(Project)
// (Organization)-[:PUBLISHED]->(Source)
//
// -- Projects & Ideas
// (Project)-[:CONTAINS]->(Idea)
// (Project)-[:REQUIRES]->(Skill)
// (Project)-[:INFORMED_BY]->(Source)
// (Idea)-[:DEPENDS_ON]->(Idea)
// (Idea)-[:PART_OF]->(Project)
// (Idea)-[:BLOCKED_BY]->(Rule)
//
// -- Rules & Compliance
// (Rule)-[:CONSTRAINS]->(Idea)
// (Rule)-[:CONSTRAINS]->(Project)
// (Rule)-[:APPLIES_TO]->(Project)
//
// -- Knowledge & Learning
// (Source)-[:INFORMS]->(Idea)
// (Source)-[:INFORMS]->(Rule)
// (Source)-[:INFORMS]->(Project)
// (Resource)-[:TEACHES]->(Skill)
// (Insight)-[:DERIVED_FROM]->(Source)
// (Insight)-[:DERIVED_FROM]->(Rule)
// (Insight)-[:ABOUT]->(Idea)
// (Insight)-[:ABOUT]->(Project)
// (Skill)-[:USED_IN]->(Project)
//
// -- Goals
// (Goal)-[:REQUIRES]->(Skill)
// (Goal)-[:ACHIEVED_BY]->(Project)
// (Goal)-[:BLOCKED_BY]->(Idea)
// ============================================================================

RETURN "schema seeded" AS status;
