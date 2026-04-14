// ═══════════════════════════════════════════════════════════
// SEC-15: Shared CORS — Origin Allowlist
//
// All workers import this. No more Access-Control-Allow-Origin: *.
// Only our domains get CORS headers. Everything else is blocked.
// /health endpoints don't need CORS (server-to-server only).
// ═══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  // CiteCore.ai — Platform Zero (dev-admin/dev-partner killed 2026-04-14)
  'https://admin.citecore.ai',
  'https://dev-adminv2.citecore.ai',
  'https://admin-v2-9ke.pages.dev',
  'https://partner.citecore.ai',
  'https://dev-partnerv2.citecore.ai',
  'https://citecore.ai',
  'https://www.citecore.ai',
  'https://dev.citecore.ai',
  // SRE Dashboard
  'https://sre.citecore.ai',
  'https://sre-cvj.pages.dev',
  'https://dev-sre.citecore.ai',
  'https://sre-dev.pages.dev',
  // PromoteYou.ai — public marketing site (free audit)
  'https://promoteyou.ai',
  'https://www.promoteyou.ai',
  'https://dev.promoteyou.ai',
  // FractCIO.com — executive consulting site
  'https://fractcio.com',
  'https://www.fractcio.com',
  'https://dev.fractcio.com',
];

export function getCorsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-User-Email, X-Staff, X-Partner-Slug, X-Internal-Key',
      'Access-Control-Max-Age': '86400',
    };
  }
  // No CORS headers for unknown origins — browser blocks the request
  return {};
}

export function handleOptions(request) {
  const cors = getCorsHeaders(request);
  if (Object.keys(cors).length === 0) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: cors });
}

// FIX-67: Centralized PORTAL_ORIGINS for auth bypass
// Workers use this to skip API key auth for portal requests
export const PORTAL_ORIGINS = [
  ...ALLOWED_ORIGINS,
];
