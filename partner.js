// ═══════════════════════════════════════════════════════════
// AEO Shared Partner — Multi-tenant partner resolution
// Usage: const partner = await getPartner(request, env);
//        const partners = await listPartners(env);
//
// Reads partner configuration from PARTNER_REGISTRY KV namespace.
// The partner slug is the first-class routing key at every layer.
//
// Sources of the slug (in priority order):
//   1. overrideSlug parameter (for cron iteration)
//   2. X-Partner-Slug request header (set by portal via Clerk org)
//   3. '_default' (Thomas's direct tenant)
// ═══════════════════════════════════════════════════════════

const DEFAULT_SLUG = '_default';

/**
 * Resolves partner config from KV registry.
 *
 * @param {Request|null} request — HTTP request (null for cron)
 * @param {object} env — Worker environment bindings
 * @param {string} [overrideSlug] — Optional slug override
 * @returns {object|null} Partner config or null if not found
 *
 * Config shape (partner slug key):
 * {
 *   slug: "{partner-slug}",
 *   d1_database_id: "aaaa-bbbb-cccc-dddd",
 *   d1_logs_database_id: "eeee-ffff-gggg-hhhh",
 *   r2_bucket: "r2-{partner-slug}-reports",
 *   clerk_org_id: "org_abc123",
 *   status: "active"
 * }
 *
 * Org mapping key (org:org_abc123):
 * { slug: "{partner-slug}" }   ← reverse lookup for Clerk JWT auth
 */
export async function getPartner(request, env, overrideSlug) {
  const slug = overrideSlug
    || (request && request.headers.get('X-Partner-Slug'))
    || DEFAULT_SLUG;

  if (!env.PARTNER_REGISTRY) {
    console.warn('[shared/partner] PARTNER_REGISTRY KV not bound');
    return null;
  }

  try {
    const config = await env.PARTNER_REGISTRY.get(slug, { type: 'json' });
    return config || null;
  } catch (e) {
    console.error('[shared/partner] KV lookup failed for slug:', slug, e.message);
    return null;
  }
}

/**
 * Returns the partner slug from a request.
 *
 * @param {Request|null} request
 * @returns {string} Partner slug or '_default'
 */
export function getSlug(request) {
  if (!request) return DEFAULT_SLUG;
  return request.headers.get('X-Partner-Slug') || DEFAULT_SLUG;
}

/**
 * Lists all active partners from KV registry.
 * Used by cron-triggered workers to iterate across all tenants.
 * Dynamically scans KV — no hardcoded partner lists.
 *
 * @param {object} env — Worker environment bindings
 * @returns {Array<object>} Array of partner configs
 */
export async function listPartners(env) {
  if (!env.PARTNER_REGISTRY) {
    console.warn('[shared/partner] PARTNER_REGISTRY KV not bound');
    return [];
  }

  const partners = [];
  let cursor = null;

  do {
    const listResult = await env.PARTNER_REGISTRY.list({ cursor, limit: 100 });

    for (const key of listResult.keys) {
      // Skip reverse-lookup keys (org:xxx) — only fetch partner slug keys
      if (key.name.startsWith('org:')) continue;

      try {
        const config = await env.PARTNER_REGISTRY.get(key.name, { type: 'json' });
        if (config && config.status === 'active') {
          partners.push(config);
        }
      } catch (e) {
        console.warn(`[shared/partner] KV lookup failed for slug: ${key.name}`, e.message);
      }
    }

    cursor = listResult.list_complete ? null : listResult.cursor;
  } while (cursor);

  return partners;
}
