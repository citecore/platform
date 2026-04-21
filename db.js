// ═══════════════════════════════════════════════════════════
// AEO Shared DB — Multi-Database + Multi-Tenant Router
//
// One module, two routing axes:
//   1. Named databases (INFRA-125): 8 split DBs —
//      CLIENTS, AUDITS, DELIVERY, BILLING, RECON, CATALYST,
//      FORGE, LOGS. Workers bind only what they need as
//      DB_<NAME> in wrangler.toml.
//   2. Partner isolation: per-slug D1 via PARTNER_REGISTRY KV.
//
// Backward compatible:
//   - getDB(request, env, overrideSlug)
//       → returns env.DB for _default, partner DB for slugs.
//         Existing workers using env.DB keep working during the
//         INFRA-124/126 rollout.
//
// New named-binding API (use this for all new code):
//   - getNamedDB(env, name)
//       → returns env.DB_<NAME> for CiteCore direct DBs.
//         Fails loudly if binding missing — no silent fallback.
//   - getPartnerNamedDB(request, env, name, overrideSlug)
//       → partner-aware named lookup. _default uses env.DB_<NAME>.
//         Partner slug reads d1_<name>_id from PARTNER_REGISTRY KV,
//         falls back to d1_database_id if the partner hasn't been
//         split yet (transition window).
//
// Unknown slug → 403. Missing token → 500. Unknown DB name → 500.
// Missing binding → 500. No silent fallback. Ever.
// ═══════════════════════════════════════════════════════════

const CF_ACCOUNT_ID = '679f3ae763534ec54c2bb4eaed92417a';
const D1_API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database`;

// Canonical named-DB set. Workers bind what they need as DB_<NAME>.
// Typos on named lookups are rejected at runtime to avoid silent empty-DB bugs.
export const NAMED_DBS = Object.freeze([
  'CLIENTS',
  'AUDITS',
  'DELIVERY',
  'BILLING',
  'RECON',
  'CATALYST',
  'FORGE',
  'LOGS',
]);

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

export class UnknownDatabaseError extends Error {
  constructor(name) {
    super(`Unknown named database: ${name}. Valid: ${NAMED_DBS.join(', ')}`);
    this.name = 'UnknownDatabaseError';
    this.status = 500;
  }
}

export class MissingBindingError extends Error {
  constructor(binding) {
    super(`FATAL: ${binding} binding not present on env. wrangler.toml must declare it.`);
    this.name = 'MissingBindingError';
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
 * Legacy partner router — single-DB, partner-aware.
 *   _default → env.DB (native binding)
 *   Partner slug → KV lookup → D1 REST API
 * Unknown slug → 403. Missing token → 500.
 *
 * Existing callers continue to use this during the INFRA-124/126
 * rollout. New code should prefer getNamedDB / getPartnerNamedDB.
 */
export async function getDB(request, env, overrideSlug) {
  const slug = overrideSlug
    || (request && request.headers.get('X-Partner-Slug'))
    || '_default';

  if (slug === '_default') {
    if (!env.DB) throw new MissingBindingError('DB');
    return env.DB;
  }

  if (!env.CF_API_TOKEN) throw new MissingTokenError();
  if (!env.PARTNER_REGISTRY) throw new Error('[shared/db] PARTNER_REGISTRY KV not bound');

  const config = await env.PARTNER_REGISTRY.get(slug, { type: 'json' });
  if (!config || !config.d1_database_id) throw new PartnerNotFoundError(slug);
  if (config.status !== 'active') throw new PartnerNotFoundError(slug);

  return wrapD1Rest(config.d1_database_id, env.CF_API_TOKEN);
}

/**
 * INFRA-125: Named-binding router for CiteCore direct databases.
 *   getNamedDB(env, 'CLIENTS') → env.DB_CLIENTS
 *   getNamedDB(env, 'audits')  → env.DB_AUDITS (case-insensitive)
 *
 * Fails loudly on typos or missing bindings — no silent fallback.
 */
export function getNamedDB(env, name) {
  const upper = String(name || '').toUpperCase();
  if (!NAMED_DBS.includes(upper)) throw new UnknownDatabaseError(upper);
  const binding = `DB_${upper}`;
  if (!env[binding]) throw new MissingBindingError(binding);
  return env[binding];
}

/**
 * INFRA-125: Partner-aware named router.
 *   _default → getNamedDB(env, name) (native binding per worker)
 *   Partner slug → KV lookup for per-partner named database.
 *
 * PARTNER_REGISTRY entry shape during transition:
 *   {
 *     slug, status, display_name,
 *     d1_database_id,        // legacy single-DB id (fallback)
 *     d1_clients_id,         // optional — partner has their own CLIENTS
 *     d1_audits_id,          // optional
 *     ...one per NAMED_DBS entry...
 *   }
 *
 * If d1_<name>_id is present, use it. Otherwise fall back to
 * d1_database_id (keeps partners working during split rollout).
 */
export async function getPartnerNamedDB(request, env, name, overrideSlug) {
  const upper = String(name || '').toUpperCase();
  if (!NAMED_DBS.includes(upper)) throw new UnknownDatabaseError(upper);

  const slug = overrideSlug
    || (request && request.headers.get('X-Partner-Slug'))
    || '_default';

  if (slug === '_default') return getNamedDB(env, upper);

  if (!env.CF_API_TOKEN) throw new MissingTokenError();
  if (!env.PARTNER_REGISTRY) throw new Error('[shared/db] PARTNER_REGISTRY KV not bound');

  const config = await env.PARTNER_REGISTRY.get(slug, { type: 'json' });
  if (!config) throw new PartnerNotFoundError(slug);
  if (config.status !== 'active') throw new PartnerNotFoundError(slug);

  const namedId = config[`d1_${upper.toLowerCase()}_id`];
  const dbId = namedId || config.d1_database_id;
  if (!dbId) throw new PartnerNotFoundError(slug);

  return wrapD1Rest(dbId, env.CF_API_TOKEN);
}
