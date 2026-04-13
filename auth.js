// ═══════════════════════════════════════════════════════════
// AEO Shared Auth — Clerk Organization → D1 Bridge
//
// THE IDENTITY-TO-DATA BRIDGE:
//   1. Extract org_id from Clerk JWT (via Clerk Backend API verification)
//   2. Map org_id → partner_slug via KV (or read slug from Clerk org publicMetadata)
//   3. Resolve the correct D1 database via getDB()
//   4. Enforce: no org = no access. Wrong org = 403. No browsing between silos.
//
// Usage in any worker:
//   import { resolvePartnerAuth } from '../shared/auth.js';
//   const { db, partner, orgId, role } = await resolvePartnerAuth(request, env);
//   // db is now bound to the correct partner D1. Guaranteed.
//
// Admin (Thomas + staff): X-Staff: true header bypasses org check → env.DB
// Unauthenticated: API_SECRET key check (existing pattern, unchanged)
//
// 100% Clerk + Cloudflare. No external vendors.
// ═══════════════════════════════════════════════════════════

import { getDB, PartnerNotFoundError } from './db.js';

/**
 * Verifies a Clerk session token and returns the claims.
 * Uses Clerk Backend API — requires CLERK_SECRET_KEY secret.
 */
async function verifyClerkToken(token, clerkSecretKey) {
  if (!token || !clerkSecretKey) return null;

  // Strip "Bearer " prefix if present
  const jwt = token.startsWith('Bearer ') ? token.slice(7) : token;

  try {
    // Verify via Clerk Backend API
    const res = await fetch('https://api.clerk.com/v1/sessions/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clerkSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: jwt }),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Looks up org metadata from Clerk Backend API.
 * Returns { slug, database_id } from publicMetadata if set.
 */
async function getClerkOrgMetadata(orgId, clerkSecretKey) {
  if (!orgId || !clerkSecretKey) return null;

  try {
    const res = await fetch(`https://api.clerk.com/v1/organizations/${orgId}`, {
      headers: { 'Authorization': `Bearer ${clerkSecretKey}` },
    });

    if (!res.ok) return null;
    const org = await res.json();
    return org.public_metadata || null;
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated partner context for a request.
 *
 * Flow:
 *   1. Staff bypass: X-Staff: true → returns env.DB (Thomas's database)
 *   2. Clerk JWT: Authorization header → verify → extract org_id
 *   3. Org metadata: Check Clerk org publicMetadata for partner_slug
 *   4. KV fallback: Look up org_id → slug mapping in PARTNER_REGISTRY
 *   5. D1 binding: getDB() with resolved slug
 *
 * @param {Request} request
 * @param {object} env — Worker environment bindings
 * @returns {{ db, partner, orgId, role, isStaff }}
 * @throws {Error} 403 if org not found or not mapped
 */
export async function resolvePartnerAuth(request, env) {
  // Staff bypass — Thomas + staff get native D1
  if (request.headers.get('X-Staff') === 'true') {
    return {
      db: env.DB,
      partner: null,
      orgId: null,
      role: 'admin',
      isStaff: true,
    };
  }

  // Try Clerk JWT from Authorization header
  const authHeader = request.headers.get('Authorization');
  const session = await verifyClerkToken(authHeader, env.CLERK_SECRET_KEY);

  if (!session) {
    // SEC-13: Worker-to-worker calls MUST provide API_SECRET alongside X-Partner-Slug.
    // X-Partner-Slug alone is NEVER trusted — prevents header manipulation attacks.
    const slug = request.headers.get('X-Partner-Slug');
    const internalKey = request.headers.get('X-Internal-Key') || request.headers.get('X-API-Key');
    if (slug && internalKey && env.API_SECRET && internalKey === env.API_SECRET) {
      const db = await getDB(request, env, slug);
      return { db, partner: { slug }, orgId: null, role: 'worker', isStaff: false };
    }

    // Slug without valid API_SECRET — REJECT
    if (slug && (!internalKey || internalKey !== env.API_SECRET)) {
      throw new AuthError('X-Partner-Slug requires valid API_SECRET — unauthorized', 401);
    }

    // No auth at all — default DB only (API_SECRET check happens separately per worker)
    return { db: env.DB, partner: null, orgId: null, role: null, isStaff: false };
  }

  // Extract org_id from Clerk session
  const orgId = session.last_active_organization_id || null;

  if (!orgId) {
    // User is authenticated but not in an organization — 403
    throw new AuthError('User is not a member of any organization', 403);
  }

  // Strategy 1: Check Clerk org publicMetadata for partner_slug + database_id
  const orgMeta = await getClerkOrgMetadata(orgId, env.CLERK_SECRET_KEY);
  if (orgMeta && orgMeta.partner_slug) {
    const db = await getDB(request, env, orgMeta.partner_slug);
    const role = session.actor?.role || 'member';
    return {
      db,
      partner: { slug: orgMeta.partner_slug, d1_database_id: orgMeta.database_id },
      orgId,
      role,
      isStaff: false,
    };
  }

  // Strategy 2: KV lookup — org_id mapped to slug
  if (env.PARTNER_REGISTRY) {
    try {
      // Check if org_id is stored as a key (org:{orgId} → { slug, ... })
      const mapping = await env.PARTNER_REGISTRY.get(`org:${orgId}`, { type: 'json' });
      if (mapping && mapping.slug) {
        const db = await getDB(request, env, mapping.slug);
        const role = session.actor?.role || 'member';
        return {
          db,
          partner: mapping,
          orgId,
          role,
          isStaff: false,
        };
      }
    } catch (e) {
      console.error('[shared/auth] KV org mapping lookup failed:', orgId, e.message);
    }
  }

  // Org exists in Clerk but not mapped to any partner silo — 403
  throw new AuthError(`Organization ${orgId} is not mapped to a partner silo`, 403);
}

/**
 * Checks if the resolved auth context has admin privileges.
 */
export function isPartnerAdmin({ role, isStaff }) {
  return isStaff || role === 'admin' || role === 'org_admin';
}

export class AuthError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
