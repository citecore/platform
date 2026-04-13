// ═══════════════════════════════════════════════════════════
// AEO Shared DB — Dynamic Multi-Tenant Router
//
// KV-driven. No hard-coded partners. No limits.
//
// _default → env.DB (Thomas's native D1 binding, fastest path)
// Any slug → KV PARTNER_REGISTRY lookup → D1 REST API
// Unknown slug → 403. Missing token → 500. No silent fallback.
//
// 50 partners. 2,500 clients. 11 workers. One router.
// 100% Cloudflare.
// ═══════════════════════════════════════════════════════════

const CF_ACCOUNT_ID = '679f3ae763534ec54c2bb4eaed92417a';
const D1_API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database`;

export class PartnerNotFoundError extends Error {
  constructor(slug) {
    super(`Partner not found: ${slug}`);
    this.name = 'PartnerNotFoundError';
    this.slug = slug;
    this.status = 403;
  }
}

export class MissingTokenError extends Error {
  constructor() {
    super('FATAL: CF_API_TOKEN not set. Partner D1 routing DISABLED. No fallback.');
    this.name = 'MissingTokenError';
    this.status = 500;
  }
}

function wrapD1Rest(databaseId, apiToken) {
  const endpoint = `${D1_API_BASE}/${databaseId}/query`;

  async function execute(sql, params) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params: params || [] }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[shared/db] D1 REST API error (${res.status}): ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(`[shared/db] D1 query failed: ${JSON.stringify(json.errors)}`);
    }

    return json.result[0];
  }

  return {
    prepare(sql) {
      let boundArgs = [];
      const statement = {
        bind(...args) { boundArgs = args; return statement; },
        async run() {
          const r = await execute(sql, boundArgs);
          return { success: true, meta: { changes: r.meta?.changes || 0, last_row_id: r.meta?.last_row_id || null, duration: r.meta?.duration || 0 } };
        },
        async first(col) {
          const r = await execute(sql, boundArgs);
          const row = r.results?.[0] || null;
          return (row && col) ? (row[col] ?? null) : row;
        },
        async all() {
          const r = await execute(sql, boundArgs);
          return { results: r.results || [] };
        },
      };
      return statement;
    },
  };
}

/**
 * THE ROUTER.
 * _default → env.DB (Thomas). Partner slug → KV lookup → D1 REST API.
 * Unknown slug → 403. Missing token → 500. No silent fallback. Ever.
 */
export async function getDB(request, env, overrideSlug) {
  const slug = overrideSlug
    || (request && request.headers.get('X-Partner-Slug'))
    || '_default';

  // Direct clients → native D1
  if (slug === '_default') {
    if (!env.DB) throw new Error('[shared/db] No DB binding');
    return env.DB;
  }

  // GASKET: no token = no partner routing. Period.
  if (!env.CF_API_TOKEN) {
    throw new MissingTokenError();
  }

  // KV dynamic lookup — no hard-coded map, no partner limit
  if (!env.PARTNER_REGISTRY) {
    throw new Error('[shared/db] PARTNER_REGISTRY KV not bound');
  }

  const config = await env.PARTNER_REGISTRY.get(slug, { type: 'json' });
  if (!config || !config.d1_database_id) {
    throw new PartnerNotFoundError(slug);
  }

  if (config.status !== 'active') {
    throw new PartnerNotFoundError(slug);
  }

  return wrapD1Rest(config.d1_database_id, env.CF_API_TOKEN);
}
