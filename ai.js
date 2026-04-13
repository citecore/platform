// ═══════════════════════════════════════════════════════════
// AEO Shared AI Client — Single Anthropic integration point
// Routes all calls through Cloudflare AI Gateway for caching,
// rate limiting, retry, and centralized observability.
//
// Usage: import { callAI, AI_MODEL, COST_PER_TOKEN, parseLLMJson } from '../shared/ai.js';
//        const { text, totalTokens, inputTokens, outputTokens } = await callAI(env, prompt);
//        const { text, totalTokens } = await callAI(env, prompt, { maxTokens: 4096 });
// ═══════════════════════════════════════════════════════════

// --- Constants (single source of truth) ---
// Platform Zero: Sonnet 4.6 is the minimum model for all worker AI calls.
// Haiku retired from worker fleet. Opus reserved for FINCH Architect sessions only.
export const AI_MODEL = 'claude-sonnet-4-6-20250514';
export const ANTHROPIC_VERSION = '2023-06-01';

// Per-model cost tracking — FinOps uses these for accurate P&L
export const MODEL_COSTS = {
  'claude-haiku-4-5-20251001':  { input: 0.0000008,  output: 0.000004  },
  'claude-sonnet-4-6-20250514': { input: 0.000003,   output: 0.000015  },
  'claude-opus-4-6-20250514':   { input: 0.000015,   output: 0.000075  },
};
// Legacy constant — kept for backwards compat until all workers migrate to MODEL_COSTS
export const COST_PER_TOKEN = 0.000003;

// AI Gateway URL — all Anthropic calls route through this
// Format: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/{provider}
const CF_ACCOUNT_ID = '679f3ae763534ec54c2bb4eaed92417a';
const CF_GATEWAY_NAME = 'claude-gateway';
export const AI_GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_NAME}/anthropic/v1/messages`;

// Direct Anthropic URL — fallback if gateway is down
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// --- AI Client ---
export async function callAI(env, prompt, opts = {}) {
  const {
    maxTokens = 1024,
    model = AI_MODEL,
    timeoutMs = 30000,
    skipGateway = false,
  } = opts;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  // Route through AI Gateway by default, fall back to direct if gateway fails
  const url = skipGateway ? ANTHROPIC_API_URL : AI_GATEWAY_URL;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };

  // Add gateway auth token if available
  if (!skipGateway && env.CLOUDFLARE_AI_GATEWAY_TOKEN) {
    headers['cf-aig-authorization'] = `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // If gateway call failed (network error, timeout), retry direct
    if (!skipGateway) {
      console.warn(`[shared/ai] Gateway failed (${err.message}), falling back to direct Anthropic`);
      return callAI(env, prompt, { ...opts, skipGateway: true });
    }
    throw err;
  }

  // If gateway returned a gateway-level error (not Anthropic error), retry direct
  if (!skipGateway && response.status >= 500 && response.status < 600) {
    const errBody = await response.text();
    if (errBody.includes('gateway') || errBody.includes('Gateway')) {
      console.warn(`[shared/ai] Gateway error ${response.status}, falling back to direct Anthropic`);
      return callAI(env, prompt, { ...opts, skipGateway: true });
    }
    throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const text = data.content?.[0]?.text || '';

  return { text, totalTokens, inputTokens, outputTokens };
}

// --- Agentic AI Client (tool-use reasoning loop) ---
// Used by Ranger for diagnostic reasoning. All calls route through AI Gateway.
// executeTool callback runs tools locally and returns results to Claude.
export async function callAIAgent(env, { system, tools, messages, executeTool, maxTurns = 5, maxTokens = 1024, model = AI_MODEL, timeoutMs = 30000 }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  let currentMessages = [...messages];
  let totalInput = 0, totalOutput = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    let url = AI_GATEWAY_URL;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
    if (env.CLOUDFLARE_AI_GATEWAY_TOKEN) {
      headers['cf-aig-authorization'] = `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}`;
    }

    const body = { model, max_tokens: maxTokens, messages: currentMessages };
    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = tools;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Gateway failed — retry direct
      console.warn(`[shared/ai] Agent gateway failed (${err.message}), falling back to direct`);
      delete headers['cf-aig-authorization'];
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST', headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    totalInput += data.usage?.input_tokens || 0;
    totalOutput += data.usage?.output_tokens || 0;

    if (data.stop_reason === 'tool_use') {
      currentMessages.push({ role: 'assistant', content: data.content });

      const toolResults = [];
      for (const block of data.content) {
        if (block.type === 'tool_use' && executeTool) {
          try {
            const result = await executeTool(block.name, block.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          } catch (e) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: e.message }),
              is_error: true,
            });
          }
        }
      }

      currentMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    const text = data.content?.find(b => b.type === 'text')?.text || '';
    return { text, inputTokens: totalInput, outputTokens: totalOutput, totalTokens: totalInput + totalOutput, turns: turn + 1 };
  }

  return { text: 'Max reasoning turns reached. Manual review required.', inputTokens: totalInput, outputTokens: totalOutput, totalTokens: totalInput + totalOutput, turns: maxTurns };
}

// --- JSON parsing (strips markdown code fences) ---
export function parseLLMJson(raw) {
  let text = raw.trim();
  // Strip markdown fences
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }
  try {
    return JSON.parse(text);
  } catch (firstErr) {
    // BUG-192e: LLMs frequently produce JSON with unescaped newlines, tabs, or
    // control chars inside string values. This causes "Unterminated string" parse
    // errors that broke /generate for every client for 3 weeks. Fix: walk the
    // string and escape literal newlines/tabs that appear inside JSON string values.
    try {
      let inString = false;
      let escaped = false;
      let cleaned = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escaped) { cleaned += ch; escaped = false; continue; }
        if (ch === '\\') { cleaned += ch; escaped = true; continue; }
        if (ch === '"') { cleaned += ch; inString = !inString; continue; }
        if (inString) {
          if (ch === '\n') { cleaned += '\\n'; continue; }
          if (ch === '\r') { cleaned += '\\r'; continue; }
          if (ch === '\t') { cleaned += '\\t'; continue; }
        }
        cleaned += ch;
      }
      return JSON.parse(cleaned);
    } catch {
      throw firstErr; // Surface the original error if cleanup also fails
    }
  }
}
