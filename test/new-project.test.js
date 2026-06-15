import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeMd, mergeManifest, agentConfigFiles, mergeSettings, writeAgentConfig } from '../scripts/new-project.js';
import { formatReport, HUMAN_SURFACES, CYPHER as UNDOC_CYPHER } from '../scripts/review-undocumented-decisions.js';

test('claudeMd fills the project name, workspace url, and data_source ids', () => {
  const md = claudeMd('Acme', 'https://ws', {
    'Development Tracker': { id: 'dt-id' },
    Changelog: { id: 'cl-id' },
  });
  assert.match(md, /# CLAUDE\.md — Acme/);
  assert.match(md, /https:\/\/ws/);
  assert.match(md, /data_source_id `dt-id`/);
  assert.match(md, /data_source_id `cl-id`/);
  assert.match(md, /data_source_id `<id>`/, 'missing entries fall back to a placeholder, never undefined');
});

test('mergeManifest adds a project without clobbering existing ones', () => {
  const tmp = path.join(os.tmpdir(), `engram-merge-${process.pid}-a.json`);
  fs.writeFileSync(tmp, JSON.stringify({ projects: { Existing: { workspace_url: 'u', entries: {} } } }));
  mergeManifest('New', { projects: { New: { workspace_url: 'v', entries: { X: { kind: 'page', id: '1' } } } } }, tmp);
  const result = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  assert.ok(result.projects.Existing, 'existing project preserved');
  assert.equal(result.projects.New.entries.X.id, '1', 'new project added');
  fs.unlinkSync(tmp);
});

test('mergeManifest starts fresh when the file does not exist', () => {
  const tmp = path.join(os.tmpdir(), `engram-merge-${process.pid}-b.json`);
  mergeManifest('P', { projects: { P: { workspace_url: 'w', entries: {} } } }, tmp);
  assert.ok(JSON.parse(fs.readFileSync(tmp, 'utf8')).projects.P);
  fs.unlinkSync(tmp);
});

test('agentConfigFiles emits valid-JSON hooks; per-turn nudge stays terse', () => {
  const { settings, sessionHook, promptHook } = agentConfigFiles('Acme');
  // Hook scripts must emit parseable JSON with additionalContext (the harness parses stdout).
  for (const script of [sessionHook, promptHook]) {
    const json = script.match(/cat <<'EOF'\n([\s\S]*?)\nEOF/)[1];
    const parsed = JSON.parse(json);
    assert.ok(parsed.hookSpecificOutput.additionalContext, 'carries additionalContext');
  }
  const sessionCtx = JSON.parse(sessionHook.match(/cat <<'EOF'\n([\s\S]*?)\nEOF/)[1]).hookSpecificOutput.additionalContext;
  const promptCtx = JSON.parse(promptHook.match(/cat <<'EOF'\n([\s\S]*?)\nEOF/)[1]).hookSpecificOutput.additionalContext;
  assert.match(sessionCtx, /project: Acme/, 'session hook names the project');
  // Per-turn block is paid every turn — guard against it bloating back to the full rule.
  assert.ok(promptCtx.length < 220, `per-turn nudge stays terse (was ${promptCtx.length} chars)`);
  assert.match(promptCtx, /work\/decisions\/rationale\/history\/status/, 'keeps trigger keywords so classification survives');
  assert.equal(settings.hooks.SessionStart[0].hooks[0].type, 'command');
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].type, 'command');
});

test('mergeSettings is idempotent and preserves unrelated settings', () => {
  const { settings } = agentConfigFiles('X');
  const existing = { permissions: { allow: ['WebSearch'] } };
  const once = mergeSettings(existing, settings);
  const twice = mergeSettings(once, settings); // rerun must not double-add
  assert.deepEqual(once.permissions, { allow: ['WebSearch'] }, 'unrelated settings preserved');
  assert.equal(twice.hooks.UserPromptSubmit.length, 1, 'no duplicate hook entry on re-run');
  assert.equal(twice.hooks.SessionStart.length, 1);
});

test('writeAgentConfig drops .claude/ hooks + settings into the repo dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-agentcfg-'));
  const settingsPath = writeAgentConfig(tmp, 'Acme');
  assert.ok(fs.existsSync(settingsPath), 'settings.json written');
  assert.ok(fs.existsSync(path.join(tmp, '.claude/hooks/engram-graph-first-session.sh')));
  assert.ok(fs.existsSync(path.join(tmp, '.claude/hooks/engram-graph-first-prompt.sh')));
  assert.ok(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks.SessionStart, 'settings has hooks');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('undocumented-decisions: only human-readable surfaces count, and the query asks for them', () => {
  // The whole point is the human window — code/config Sources must NOT count as "documented for a person".
  assert.deepEqual(HUMAN_SURFACES, ['notion_page', 'notion_workspace', 'markdown', 'live_demo']);
  assert.ok(!HUMAN_SURFACES.includes('tooling') && !HUMAN_SURFACES.includes('config'), 'machine-facing kinds excluded');
  assert.match(UNDOC_CYPHER, /\$kinds/, 'query filters Sources to the human-surface kinds');
  assert.match(UNDOC_CYPHER, /freshestHuman IS NULL OR d\.at > freshestHuman/, 'catches both the absent and the stale case');
});

test('undocumented-decisions: formatReport distinguishes "no surface" from "stale surface"', () => {
  const empty = formatReport([], { days: 14 });
  assert.match(empty, /No undocumented decisions/);

  const report = formatReport([
    { project: 'Acme', no_human_surface: true, freshest_human: null, undocumented_decisions: ['Chose X over Y'], n: 1 },
    { project: 'Beta', no_human_surface: false, freshest_human: '2026-01-01T00:00:00Z', undocumented_decisions: ['Adopted Z'], n: 1 },
  ], { days: 14 });
  assert.match(report, /Acme.*NO human-readable surface exists yet/s, 'flags the absent case');
  assert.match(report, /Beta.*predates these \(last refreshed 2026-01-01/s, 'flags the stale case with the date');
  assert.match(report, /Chose X over Y/);
  assert.match(report, /WRITE THEM UP/, 'tells the agent the remedy: dual-write');
});
