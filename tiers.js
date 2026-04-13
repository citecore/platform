// ═══════════════════════════════════════════════════════════
// ENH-181: CANONICAL TIER DEFINITIONS — SINGLE SOURCE OF TRUTH
//
// EVERY worker imports from here. No hardcoded tier strings.
// No local TIER_CONFIG arrays. No "must stay in sync" comments.
// This file IS the sync.
//
// 8 canonical tiers. 5 client + 3 partner. No others exist.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// VALID D1 PLAN VALUES — the only values allowed in the plan column
// ─────────────────────────────────────────────
export const VALID_PLANS = [
  'free', 'announce', 'engage', 'orchestrate', 'regent',
  'pulse', 'insight', 'keystone',
];

// ─────────────────────────────────────────────
// DISPLAY NAMES — what humans see
// ─────────────────────────────────────────────
export const TIER_NAMES = [
  'Free Analyzer', 'Announce', 'Engage', 'Orchestrate', 'Regent',
  'Pulse', 'Insight', 'Keystone',
];

// ─────────────────────────────────────────────
// PLAN VALUE → DISPLAY NAME mapping
// ─────────────────────────────────────────────
export const PLAN_TO_DISPLAY = {
  free: 'Free Analyzer',
  announce: 'Announce',
  engage: 'Engage',
  orchestrate: 'Orchestrate',
  regent: 'Regent',
  pulse: 'Pulse',
  insight: 'Insight',
  keystone: 'Keystone',
};

// ─────────────────────────────────────────────
// DISPLAY NAME → PLAN VALUE mapping
// ─────────────────────────────────────────────
export const DISPLAY_TO_PLAN = {
  'Free Analyzer': 'free',
  Announce: 'announce',
  Engage: 'engage',
  Orchestrate: 'orchestrate',
  Regent: 'regent',
  Pulse: 'pulse',
  Insight: 'insight',
  Keystone: 'keystone',
};

// ─────────────────────────────────────────────
// TIER TYPE — client vs partner
// ─────────────────────────────────────────────
export const PARTNER_TIERS = ['Pulse', 'Insight', 'Keystone'];
export const CLIENT_TIERS = ['Free Analyzer', 'Announce', 'Engage', 'Orchestrate', 'Regent'];

// ─────────────────────────────────────────────
// TEMPLATE MAP — 8 plans collapsed to 2 templates (post-rip-out 2026-04-07)
// Until lower-tier subsets land, every paid plan dispatches to Orchestrate
// (the v2 template). Free Analyzer keeps its own builder. Lower-tier
// derivations (Announce/Pulse/Engage/Insight) iterate "down" from v2
// in subsequent passes.
// Used by: report-engine, courier
// ─────────────────────────────────────────────
export const TEMPLATE_MAP = {
  free:        'Free',
  announce:    'Orchestrate',
  pulse:       'Orchestrate',
  engage:      'Orchestrate',
  insight:     'Orchestrate',
  orchestrate: 'Orchestrate',
  regent:      'Orchestrate',
  keystone:    'Orchestrate',
};

// ─────────────────────────────────────────────
// BRAND MODE — citecore (direct client) vs partner (white-label)
// Used by: report-engine, courier
// ─────────────────────────────────────────────
export const BRAND_MODE = {
  free:        'citecore',
  announce:    'citecore',
  engage:      'citecore',
  orchestrate: 'citecore',
  regent:      'citecore',
  pulse:       'partner',
  insight:     'partner',
  keystone:    'partner',
};

// ─────────────────────────────────────────────
// TEMPLATE LEVEL — ordinal for gasket comparison (post-rip-out 2026-04-07)
// Collapsed from 4 levels to 2: Free (0) and Orchestrate (1). Announce/Engage
// kept as aliases of Orchestrate so any downstream code that still references
// the names doesn't crash — they map to the same level as Orchestrate, so the
// gasket allows what it allowed before.
// Used by: report-engine (IS-W12 gasket)
// ─────────────────────────────────────────────
export const TEMPLATE_LEVEL = {
  Free: 0,
  Announce: 1,
  Engage: 1,
  Orchestrate: 1,
};

export function getTemplate(plan) {
  return TEMPLATE_MAP[plan] || 'Free';
}

export function getBrandMode(plan) {
  return BRAND_MODE[plan] || 'citecore';
}

export function getTemplateLevel(template) {
  return TEMPLATE_LEVEL[template] ?? 0;
}

export function isPartnerTier(tier) {
  return PARTNER_TIERS.includes(tier);
}

export function isClientTier(tier) {
  return CLIENT_TIERS.includes(tier);
}

// ─────────────────────────────────────────────
// VALIDATION — reject garbage at the gate
// ─────────────────────────────────────────────
export function isValidPlan(plan) {
  return VALID_PLANS.includes(plan);
}

export function isValidTierName(name) {
  return TIER_NAMES.includes(name);
}

// ─────────────────────────────────────────────
// AUDIT CATEGORIES PER TIER
// Used by: optimizer
// ─────────────────────────────────────────────
const CATEGORIES = {
  schema_markup:      { key: 'schema_markup',      label: 'Schema Markup',          desc: 'structured data quality (JSON-LD, check types and completeness)' },
  content_quality:    { key: 'content_quality',     label: 'Conversational Content', desc: 'does the body text answer natural language questions?' },
  citation_authority: { key: 'citation_authority',  label: 'Entity Authority',       desc: 'brand signals, NAP consistency, knowledge graph indicators' },
  local_presence:     { key: 'local_presence',      label: 'Content Structure',      desc: 'heading hierarchy, FAQ blocks, list formatting for LLM readability' },
  technical_seo:      { key: 'technical_seo',       label: 'Recency Signals',        desc: 'freshness indicators, dates found in content' },
  eeat_signals:       { key: 'eeat_signals',        label: 'E-E-A-T Signals',        desc: 'experience, expertise, authoritativeness, trustworthiness signals' },
};

export const AUDIT_CATEGORIES = {
  'Free Analyzer': [CATEGORIES.schema_markup, CATEGORIES.content_quality],
  Announce:    [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence],
  Engage:      [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence, CATEGORIES.technical_seo],
  Orchestrate: [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence, CATEGORIES.technical_seo, CATEGORIES.eeat_signals],
  Regent:      [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence, CATEGORIES.technical_seo, CATEGORIES.eeat_signals],
  Pulse:       [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence, CATEGORIES.technical_seo, CATEGORIES.eeat_signals],
  Insight:     [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence, CATEGORIES.technical_seo, CATEGORIES.eeat_signals],
  Keystone:    [CATEGORIES.schema_markup, CATEGORIES.content_quality, CATEGORIES.citation_authority, CATEGORIES.local_presence, CATEGORIES.technical_seo, CATEGORIES.eeat_signals],
};

// ─────────────────────────────────────────────
// AUDIT DEPTH PER TIER
// Used by: optimizer
// ─────────────────────────────────────────────
export const AUDIT_DEPTH = {
  'Free Analyzer': { max_tokens: 800,  includeEstimatedLift: false, includeExecutiveSummary: false },
  Announce:    { max_tokens: 1000, includeEstimatedLift: false, includeExecutiveSummary: true },
  Engage:      { max_tokens: 1200, includeEstimatedLift: true,  includeExecutiveSummary: true },
  Orchestrate: { max_tokens: 1500, includeEstimatedLift: true,  includeExecutiveSummary: true },
  Regent:      { max_tokens: 2000, includeEstimatedLift: true,  includeExecutiveSummary: true },
  Pulse:       { max_tokens: 2000, includeEstimatedLift: true,  includeExecutiveSummary: true },
  Insight:     { max_tokens: 2000, includeEstimatedLift: true,  includeExecutiveSummary: true },
  Keystone:    { max_tokens: 2500, includeEstimatedLift: true,  includeExecutiveSummary: true },
};

// ─────────────────────────────────────────────
// CITATION ENGINES PER TIER
// Used by: scout
// ─────────────────────────────────────────────
export const TIER_ENGINES = {
  'Free Analyzer': ['chatgpt'],
  Announce:    ['chatgpt', 'gemini'],
  Engage:      ['chatgpt', 'gemini', 'perplexity', 'aiOverview'],
  Orchestrate: ['chatgpt', 'gemini', 'perplexity', 'aiOverview', 'copilot', 'appleIntelligence', 'metaAI', 'claude', 'alexaAI'],
  Regent:      ['chatgpt', 'gemini', 'perplexity', 'aiOverview', 'copilot', 'appleIntelligence', 'metaAI', 'claude', 'alexaAI'],
  Pulse:       ['chatgpt', 'gemini', 'perplexity', 'aiOverview', 'copilot', 'appleIntelligence'],
  Insight:     ['chatgpt', 'gemini', 'perplexity', 'aiOverview', 'copilot', 'appleIntelligence'],
  Keystone:    ['chatgpt', 'gemini', 'perplexity', 'aiOverview', 'copilot', 'appleIntelligence', 'metaAI', 'claude', 'alexaAI'],
};

// ─────────────────────────────────────────────
// CONTENT TYPES PER TIER
// Used by: catalyst
// ─────────────────────────────────────────────
export const TIER_CONTENT_TYPES = {
  'Free Analyzer': [],
  Announce:    ['faq'],
  Engage:      ['faq', 'service_page', 'about_page'],
  Orchestrate: ['faq', 'service_page', 'about_page', 'blog_post', 'landing_page', 'review_response', 'social_proof'],
  Regent:      ['faq', 'service_page', 'about_page', 'blog_post', 'landing_page', 'review_response', 'social_proof'],
  Pulse:       ['faq', 'service_page', 'about_page', 'blog_post', 'landing_page'],
  Insight:     ['faq', 'service_page', 'about_page', 'blog_post', 'landing_page'],
  Keystone:    ['faq', 'service_page', 'about_page', 'blog_post', 'landing_page', 'review_response', 'social_proof'],
};

// ─────────────────────────────────────────────
// SCHEMA CAPABILITIES PER TIER
// Used by: forge
// ─────────────────────────────────────────────
export const TIER_SCHEMA_CAPABILITIES = {
  'Free Analyzer': ['localBusiness'],
  Announce:    ['localBusiness', 'faqPage'],
  Engage:      ['localBusiness', 'faqPage', 'service', 'review', 'breadcrumb'],
  Orchestrate: ['localBusiness', 'faqPage', 'service', 'review', 'breadcrumb', 'howTo', 'article', 'event', 'product'],
  Regent:      ['localBusiness', 'faqPage', 'service', 'review', 'breadcrumb', 'howTo', 'article', 'event', 'product'],
  Pulse:       ['localBusiness', 'faqPage', 'service', 'review', 'breadcrumb', 'howTo', 'article'],
  Insight:     ['localBusiness', 'faqPage', 'service', 'review', 'breadcrumb', 'howTo', 'article'],
  Keystone:    ['localBusiness', 'faqPage', 'service', 'review', 'breadcrumb', 'howTo', 'article', 'event', 'product'],
};

// ─────────────────────────────────────────────
// RECON ACCESS PER TIER
// Used by: recon (competitor intelligence)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// PRODUCT LEVEL MAPPING — Three capability levels
// Maps each tier to Analyze/Engage/Execute product tiers
// Used by: portal, gatekeeper, courier
// ─────────────────────────────────────────────
export const PRODUCT_LEVELS = {
  'Free Analyzer': 'analyze',
  'Announce':      'analyze',
  'Engage':        'engage',
  'Orchestrate':   'execute',
  'Regent':        'execute',
  'Pulse':         'analyze',
  'Insight':       'engage',
  'Keystone':      'execute',
};

export const PRODUCT_LEVEL_LABELS = {
  'analyze': 'Analyze',
  'engage':  'Engage',
  'execute': 'Execute',
};

// What each product level includes
export const PRODUCT_CAPABILITIES = {
  'analyze': {
    label: 'Analyze',
    description: 'Full schema audit, EEAT assessment, citation detection, infrastructure analysis',
    includes: ['schema_audit', 'eeat_scoring', 'citation_detection', 'cms_detection', 'reachability_score'],
  },
  'engage': {
    label: 'Engage',
    description: 'Everything in Analyze + automated llms.txt, robots.txt, sitemap management',
    includes: ['schema_audit', 'eeat_scoring', 'citation_detection', 'cms_detection', 'reachability_score', 'llms_txt', 'robots_txt', 'sitemap_audit', 'weekly_refresh'],
  },
  'execute': {
    label: 'Execute',
    description: 'Everything in Engage + full schema deployment, CMS integration, entity management',
    includes: ['schema_audit', 'eeat_scoring', 'citation_detection', 'cms_detection', 'reachability_score', 'llms_txt', 'llms_full_txt', 'robots_txt', 'sitemap_audit', 'weekly_refresh', 'schema_deployment', 'competitor_analysis'],
  },
};

export function getProductLevel(tierName) {
  return PRODUCT_LEVELS[tierName] || 'analyze';
}

// ─────────────────────────────────────────────
// RECON ACCESS PER TIER
// Used by: recon (competitor intelligence)
// ─────────────────────────────────────────────
export const TIER_RECON_ACCESS = {
  'Free Analyzer': false,
  Announce:    false,
  Engage:      false,
  Orchestrate: false,
  Regent:      false,
  Pulse:       false,
  Insight:     false,
  Keystone:    false,
};
