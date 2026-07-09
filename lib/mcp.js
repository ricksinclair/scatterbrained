// mcp.js — a hand-rolled MCP server core (VOICE Phase 3): JSON-RPC 2.0 framing plus the
// protocol subset a tools-only Streamable-HTTP server needs — initialize, the initialized
// notification, ping, tools/list, tools/call. No SDK (zero-dep house rule), no SSE stream
// (plain-JSON responses are spec-legal), no resources/prompts (tool descriptions + the
// initialize `instructions` string do the steering). Transport-agnostic and pure-ish:
// server.js owns HTTP, auth, and headers; this owns framing, dispatch, and validation.

export const PROTOCOL_VERSION = '2025-03-26';

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

// Minimal JSON-Schema arg check — types + required, one level deep. Tools keep their
// schemas flat by design, so this stays honest without a validator dependency.
export function checkArgs(schema, args = {}) {
  if (!schema || !schema.properties) return null;
  for (const key of schema.required || []) {
    if (args[key] === undefined || args[key] === null || args[key] === '') return `missing required argument: ${key}`;
  }
  for (const [key, val] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) return `unknown argument: ${key}`;
    if (val === undefined || val === null) continue;
    const t = prop.type;
    if (t === 'string' && typeof val !== 'string') return `${key} must be a string`;
    if (t === 'number' && typeof val !== 'number') return `${key} must be a number`;
    if (t === 'boolean' && typeof val !== 'boolean') return `${key} must be a boolean`;
    if (t === 'array' && !Array.isArray(val)) return `${key} must be an array`;
    if (prop.enum && !prop.enum.includes(val)) return `${key} must be one of: ${prop.enum.join(', ')}`;
  }
  return null;
}

// createMcp({ serverInfo, instructions, tools, newSession, isSession })
//   tools: [{ name, description, inputSchema, handler(args, ctx) → Promise<result|{isError, ...}> }]
//   newSession() → session id issued on initialize; isSession(id) → is it still live?
// handle(rawBody, ctx) → { status, body|null, sessionId? } — ctx: { sessionId }
export function createMcp({ serverInfo = { name: 'scatterbrained', version: '1.0.0' }, instructions = '', tools = [], newSession = () => 'session', isSession = () => true } = {}) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function dispatch(msg, ctx) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
      return { status: 400, body: rpcError(msg && msg.id, -32600, 'invalid request') };
    }
    const { id, method, params = {} } = msg;
    if (typeof method !== 'string') return { status: 400, body: rpcError(id, -32600, 'invalid request') };

    // notifications (no id): acknowledge with 202, no body
    if (id === undefined || id === null) return { status: 202, body: null };

    if (method === 'initialize') {
      const sessionId = newSession(params);
      return {
        status: 200, sessionId,
        body: rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
          instructions,
        }),
      };
    }
    // Everything after initialize rides the session issued there.
    if (!ctx.sessionId || !isSession(ctx.sessionId)) {
      return { status: 404, body: rpcError(id, -32001, 'session not found — initialize first (or this agent was superseded)') };
    }
    if (method === 'ping') return { status: 200, body: rpcResult(id, {}) };
    if (method === 'tools/list') {
      return { status: 200, body: rpcResult(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }) };
    }
    if (method === 'tools/call') {
      const tool = byName.get(params.name);
      if (!tool) return { status: 200, body: rpcError(id, -32602, `unknown tool: ${params.name}`) };
      const argErr = checkArgs(tool.inputSchema, params.arguments || {});
      if (argErr) {
        return { status: 200, body: rpcResult(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: argErr }) }] }) };
      }
      try {
        const out = await tool.handler(params.arguments || {}, ctx);
        const isErr = !!(out && out.isError);
        const payload = isErr ? { ...out, isError: undefined } : out;
        return { status: 200, body: rpcResult(id, { isError: isErr || undefined, content: [{ type: 'text', text: JSON.stringify(payload ?? { ok: true }) }] }) };
      } catch (e) {
        return { status: 200, body: rpcResult(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: String((e && e.message) || 'tool failed') }) }] }) };
      }
    }
    return { status: 200, body: rpcError(id, -32601, `method not found: ${method}`) };
  }

  return {
    async handle(rawBody, ctx = {}) {
      let msg;
      try { msg = JSON.parse(rawBody || ''); } catch {
        return { status: 400, body: rpcError(null, -32700, 'parse error') };
      }
      if (Array.isArray(msg)) return { status: 400, body: rpcError(null, -32600, 'batching not supported') };
      return dispatch(msg, ctx);
    },
  };
}
