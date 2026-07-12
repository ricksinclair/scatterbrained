import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMemoryMarkdown } from '../../scripts/export-memory.js';

const DATA = {
  projects: [
    { name: 'Northwind', description: 'Logistics platform.', status: 'active' },
    { name: 'Empty Project', description: null, status: null },
  ],
  insights: [
    { summary: 'Short.', full_text: 'Kafka replaced by managed queue — ops cost, not throughput, was the constraint.', created: '2026-07-01T10:00:00Z', about: ['Northwind'] },
    { summary: 'Loose conclusion with no project.', full_text: null, created: null, about: [] },
  ],
  goals: [{ name: 'Ship v1', timeframe: '90_days', status: 'active', description: 'First paying customer.', target_date: '2026-09-01' }],
  facts: [
    { value: '$2,400/mo', note: 'hosting budget', about: 'Northwind' },
    { value: '17 U.S.C. §107', note: null, about: 'Fair-use memo' },
  ],
  ideas: [
    { name: 'Route optimizer', description: 'Solver for multi-stop routes.', status: 'planned', project: 'Northwind' },
    { name: 'Old idea', description: 'Already shipped.', status: 'implemented', project: 'Northwind' },
  ],
  rules: [{ name: 'Data residency', summary: 'EU data stays in EU.', citation: 'GDPR art. 44', jurisdiction: 'EU' }],
};

test('groups major knowledge by project with dates and rationale', () => {
  const md = renderMemoryMarkdown(DATA, { date: '2026-07-12' });
  assert.match(md, /^# Your knowledge — exported 2026-07-12/);
  assert.match(md, /## Northwind · active/);
  assert.match(md, /\*\*2026-07-01\*\* — Kafka replaced by managed queue/);
  assert.match(md, /`\$2,400\/mo` — hosting budget/);
  assert.match(md, /\*\*Route optimizer\*\* \(planned\)/);
});

test('closed ideas are dropped; loose knowledge lands in Everything else', () => {
  const md = renderMemoryMarkdown(DATA);
  assert.doesNotMatch(md, /Old idea/);
  assert.match(md, /## Everything else/);
  assert.match(md, /Loose conclusion with no project/);
  assert.match(md, /17 U\.S\.C\. §107.*\(on: Fair-use memo\)/);
});

test('goals and rules render with their metadata', () => {
  const md = renderMemoryMarkdown(DATA);
  assert.match(md, /\*\*Ship v1\*\* \(90_days · active · target 2026-09-01\) — First paying customer\./);
  assert.match(md, /\*\*Data residency\*\* — EU data stays in EU\. \[GDPR art\. 44, EU\]/);
});

test('is plain CommonMark: no tool-specific syntax leaks in', () => {
  const md = renderMemoryMarkdown(DATA);
  assert.doesNotMatch(md, /\[\[|\{\{|<[a-z-]+ |cypher|MERGE|MATCH/i);
});

test('degrades cleanly on an empty graph', () => {
  const md = renderMemoryMarkdown({}, { date: '2026-07-12' });
  assert.match(md, /^# Your knowledge/);
  assert.doesNotMatch(md, /^## /m);   // no empty sections
});
