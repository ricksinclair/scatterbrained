import { describe, it, expect, vi } from 'vitest';
import { createMcp, checkArgs, PROTOCOL_VERSION } from '../lib/mcp.js';

const mk = (over = {}) => createMcp({
  serverInfo: { name: 'scatterbrained', version: '1.0.0' },
  instructions: 'be helpful',
  tools: [
    { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, handler: async (a) => ({ echoed: a.text }) },
    { name: 'fail', description: 'always errors', inputSchema: { type: 'object', properties: {}, required: [] }, handler: async () => ({ isError: true, code: 'nope', message: 'refused' }) },
    { name: 'boom', description: 'throws', inputSchema: { type: 'object', properties: {}, required: [] }, handler: async () => { throw new Error('kaput'); } },
  ],
  newSession: () => 'sid-1',
  isSession: (id) => id === 'sid-1',
  ...over,
});

const rpc = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const toolText = (out) => JSON.parse(out.body.result.content[0].text);

describe('framing', () => {
  it('parse error → -32700; batch → refused; bad shape → -32600', async () => {
    const m = mk();
    expect((await m.handle('{nope')).body.error.code).toBe(-32700);
    expect((await m.handle('[]')).body.error.code).toBe(-32600);
    expect((await m.handle(JSON.stringify({ id: 1, method: 'x' }))).body.error.code).toBe(-32600);
  });
  it('notifications are acknowledged with 202 and no body', async () => {
    const out = await mk().handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), { sessionId: 'sid-1' });
    expect(out).toMatchObject({ status: 202, body: null });
  });
  it('unknown method → -32601', async () => {
    const out = await mk().handle(rpc('resources/list', {}), { sessionId: 'sid-1' });
    expect(out.body.error.code).toBe(-32601);
  });
});

describe('handshake + tools', () => {
  it('initialize issues a session and carries instructions', async () => {
    const out = await mk().handle(rpc('initialize', { protocolVersion: PROTOCOL_VERSION }));
    expect(out.sessionId).toBe('sid-1');
    expect(out.body.result.instructions).toBe('be helpful');
    expect(out.body.result.capabilities).toEqual({ tools: {} });
  });
  it('non-initialize calls without a live session → -32001', async () => {
    const out = await mk().handle(rpc('tools/list', {}), { sessionId: 'dead' });
    expect(out).toMatchObject({ status: 404 });
    expect(out.body.error.code).toBe(-32001);
  });
  it('tools/list exposes the declared surface', async () => {
    const out = await mk().handle(rpc('tools/list', {}), { sessionId: 'sid-1' });
    expect(out.body.result.tools.map((t) => t.name)).toEqual(['echo', 'fail', 'boom']);
  });
  it('tools/call round-trips JSON through content[0].text', async () => {
    const out = await mk().handle(rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } }), { sessionId: 'sid-1' });
    expect(toolText(out)).toEqual({ echoed: 'hi' });
    expect(out.body.result.isError).toBeUndefined();
  });
  it('tool-declared errors and thrown errors both surface as isError results', async () => {
    const m = mk();
    const failed = await m.handle(rpc('tools/call', { name: 'fail', arguments: {} }), { sessionId: 'sid-1' });
    expect(failed.body.result.isError).toBe(true);
    expect(toolText(failed)).toMatchObject({ code: 'nope' });
    const boomed = await m.handle(rpc('tools/call', { name: 'boom', arguments: {} }), { sessionId: 'sid-1' });
    expect(boomed.body.result.isError).toBe(true);
    expect(toolText(boomed)).toEqual({ error: 'kaput' });
  });
  it('unknown tool → -32602; bad args → isError with the reason', async () => {
    const m = mk();
    expect((await m.handle(rpc('tools/call', { name: 'nope', arguments: {} }), { sessionId: 'sid-1' })).body.error.code).toBe(-32602);
    const missing = await m.handle(rpc('tools/call', { name: 'echo', arguments: {} }), { sessionId: 'sid-1' });
    expect(missing.body.result.isError).toBe(true);
    expect(toolText(missing).error).toMatch(/missing required/);
  });
});

describe('checkArgs', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, n: { type: 'number' }, k: { enum: ['x', 'y'] } }, required: ['a'] };
  it('accepts valid, rejects missing/unknown/mistyped/out-of-enum', () => {
    expect(checkArgs(schema, { a: 'ok', n: 2, k: 'x' })).toBe(null);
    expect(checkArgs(schema, {})).toMatch(/missing required/);
    expect(checkArgs(schema, { a: 'ok', z: 1 })).toMatch(/unknown argument/);
    expect(checkArgs(schema, { a: 42 })).toMatch(/must be a string/);
    expect(checkArgs(schema, { a: 'ok', k: 'z' })).toMatch(/must be one of/);
  });
});
