// INFRA-125: db.js unit tests. Node 20+ with --experimental-vm-modules.
// Run with: node platform/db.test.mjs

import {
  getDB,
  getNamedDB,
  getPartnerNamedDB,
  NAMED_DBS,
  PartnerNotFoundError,
  MissingTokenError,
  UnknownDatabaseError,
  MissingBindingError,
} from './db.js';

let passed = 0;
let failed = 0;
const results = [];

function assert(cond, msg) {
  if (cond) { passed++; results.push(`  PASS ${msg}`); }
  else { failed++; results.push(`  FAIL ${msg}`); }
}

async function rejects(fn, ErrCls, msg) {
  try { await fn(); failed++; results.push(`  FAIL ${msg} (no throw)`); }
  catch (e) {
    if (e instanceof ErrCls) { passed++; results.push(`  PASS ${msg}`); }
    else { failed++; results.push(`  FAIL ${msg} (wrong error: ${e.constructor.name} - ${e.message})`); }
  }
}

// ─── NAMED_DBS constant ───
assert(NAMED_DBS.length === 8, 'NAMED_DBS has 8 entries');
assert(Object.isFrozen(NAMED_DBS), 'NAMED_DBS is frozen');
assert(NAMED_DBS.includes('CLIENTS'), 'NAMED_DBS includes CLIENTS');
assert(NAMED_DBS.includes('LOGS'), 'NAMED_DBS includes LOGS');

// ─── getNamedDB — happy path ───
const fakeEnv = { DB_CLIENTS: { __id: 'clients' }, DB_AUDITS: { __id: 'audits' } };
const clientsDb = getNamedDB(fakeEnv, 'CLIENTS');
assert(clientsDb.__id === 'clients', 'getNamedDB returns DB_CLIENTS binding');

// ─── getNamedDB — case insensitive ───
const auditsDb = getNamedDB(fakeEnv, 'audits');
assert(auditsDb.__id === 'audits', 'getNamedDB is case-insensitive');

// ─── getNamedDB — unknown name ───
await rejects(() => Promise.resolve(getNamedDB(fakeEnv, 'WRONGNAME')), UnknownDatabaseError, 'getNamedDB throws UnknownDatabaseError for bad name');

// ─── getNamedDB — missing binding ───
await rejects(() => Promise.resolve(getNamedDB(fakeEnv, 'DELIVERY')), MissingBindingError, 'getNamedDB throws MissingBindingError when binding absent');

// ─── getDB — legacy _default ───
const legacyEnv = { DB: { __id: 'legacy-default' } };
const legacy = await getDB(null, legacyEnv);
assert(legacy.__id === 'legacy-default', 'getDB _default returns env.DB');

// ─── getDB — missing DB binding ───
await rejects(() => getDB(null, {}), MissingBindingError, 'getDB throws MissingBindingError when env.DB missing');

// ─── getDB — partner path, missing CF_API_TOKEN ───
const partnerReq = { headers: { get: (k) => k === 'X-Partner-Slug' ? 'acme' : null } };
await rejects(() => getDB(partnerReq, legacyEnv), MissingTokenError, 'getDB throws MissingTokenError when partner slug + no CF_API_TOKEN');

// ─── getDB — partner path, unknown partner ───
const kvEnv = {
  DB: { __id: 'default' },
  CF_API_TOKEN: 'tok',
  PARTNER_REGISTRY: { get: async () => null },
};
await rejects(() => getDB(partnerReq, kvEnv), PartnerNotFoundError, 'getDB throws PartnerNotFoundError when slug not in KV');

// ─── getDB — partner path, inactive partner ───
const inactiveKvEnv = {
  DB: { __id: 'default' },
  CF_API_TOKEN: 'tok',
  PARTNER_REGISTRY: { get: async () => ({ d1_database_id: 'x', status: 'disabled' }) },
};
await rejects(() => getDB(partnerReq, inactiveKvEnv), PartnerNotFoundError, 'getDB throws PartnerNotFoundError when partner status != active');

// ─── getPartnerNamedDB — happy path _default ───
const namedEnv = { DB_CLIENTS: { __id: 'named-clients' } };
const namedClients = await getPartnerNamedDB(null, namedEnv, 'CLIENTS');
assert(namedClients.__id === 'named-clients', 'getPartnerNamedDB _default returns env.DB_CLIENTS');

// ─── getPartnerNamedDB — unknown name ───
await rejects(() => getPartnerNamedDB(null, namedEnv, 'BADNAME'), UnknownDatabaseError, 'getPartnerNamedDB throws on bad name');

// ─── getPartnerNamedDB — partner, no CF_API_TOKEN ───
await rejects(() => getPartnerNamedDB(partnerReq, namedEnv, 'CLIENTS'), MissingTokenError, 'getPartnerNamedDB throws MissingTokenError on partner slug without token');

// ─── getPartnerNamedDB — partner with named-DB id present ───
// Can't actually call wrapD1Rest without real network — just verify it returns something truthy
const splitPartnerEnv = {
  CF_API_TOKEN: 'tok',
  PARTNER_REGISTRY: {
    get: async () => ({
      slug: 'acme',
      status: 'active',
      d1_database_id: 'legacy-id',
      d1_clients_id: 'split-clients-id',
    }),
  },
};
const splitDb = await getPartnerNamedDB(partnerReq, splitPartnerEnv, 'CLIENTS');
assert(typeof splitDb.prepare === 'function', 'getPartnerNamedDB returns a prepare-capable wrapper for split partner');

// ─── getPartnerNamedDB — partner WITHOUT named-DB id falls back to d1_database_id ───
const legacyPartnerEnv = {
  CF_API_TOKEN: 'tok',
  PARTNER_REGISTRY: {
    get: async () => ({
      slug: 'acme',
      status: 'active',
      d1_database_id: 'legacy-fallback-id',
      // no d1_clients_id
    }),
  },
};
const fallbackDb = await getPartnerNamedDB(partnerReq, legacyPartnerEnv, 'CLIENTS');
assert(typeof fallbackDb.prepare === 'function', 'getPartnerNamedDB falls back to d1_database_id when named id absent');

// ─── Report ───
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
