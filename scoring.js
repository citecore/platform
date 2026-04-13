// ═══════════════════════════════════════════════════════════
// EVO-23/24 + EVO-36: DETERMINISTIC AEO SCORING ALGORITHM
//
// Pure function. Zero randomness. Zero LLM involvement.
// Same site = same score. Every time. Forever.
//
// 34 criteria across 7 categories. 100 points total.
// Category 7 (AI Citations) requires Scout scan data.
//
// Weight distribution:
//   Schema Markup:      18 pts (18%)
//   Content Quality:    18 pts (18%)
//   Citation Authority: 17 pts (17%)
//   Content Structure:  12 pts (12%)
//   Recency/Freshness:  10 pts (10%)
//   E-E-A-T Signals:    10 pts (10%)
//   AI Citations:       15 pts (15%) ← from Scout
//   TOTAL:             100 pts
//
// Version: AEO_SCORE_v1.1
// ═══════════════════════════════════════════════════════════

export const SCORE_VERSION = 'AEO_SCORE_v1.1';

// ── Helper ──────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
}

// ── The Scoring Function ────────────────────────────────────
// Takes a siteAnalysis object (from enhanced scraper) and an
// optional citationData object (from Scout) and returns
// deterministic scores + criteria breakdown.
//
// citationData shape (from Scout /citations/{clientId}/trend):
//   { engines_cited, engines_monitored, avg_confidence, trend }
// If null/undefined, citation category scores 0 (drives first scan).
export function computeAEOScore(site, citationData) {
  const criteria = {};

  // ────────────────────────────────────────────
  // CATEGORY 1: SCHEMA MARKUP (18 points max)
  // ────────────────────────────────────────────

  let schema = 0;

  // #1: Organization JSON-LD present (4 pts, binary)
  const hasOrgSchema = site.schemaTypes.includes('Organization')
    && site.schemaFields.organization.name
    && site.schemaFields.organization.url;
  criteria.org_schema = hasOrgSchema;
  if (hasOrgSchema) schema += 4;

  // #2: LocalBusiness / ProfessionalService schema (4 pts, binary)
  const BUSINESS_TYPES = [
    'LocalBusiness', 'ProfessionalService', 'Plumber', 'Dentist',
    'LawFirm', 'Restaurant', 'MedicalBusiness', 'FinancialService',
    'RealEstateAgent', 'HomeAndConstructionBusiness', 'AutomotiveBusiness',
    'LegalService', 'AccountingService', 'InsuranceAgency', 'Store',
    'FoodEstablishment', 'HealthAndBeautyBusiness', 'SportsActivityLocation',
    'EntertainmentBusiness', 'EducationalOrganization', 'GovernmentOffice',
    'LodgingBusiness', 'TravelAgency', 'EmploymentAgency',
  ];
  const hasBusinessSchema = site.schemaTypes.some(s => BUSINESS_TYPES.includes(s));
  criteria.local_schema = hasBusinessSchema;
  if (hasBusinessSchema) schema += 4;

  // #3: FAQ schema + matching HTML blocks (3 pts, binary — BOTH required)
  const hasFaqBoth = site.hasFaqSchema && site.faqBlocks > 0;
  criteria.faq_schema_html = hasFaqBoth;
  if (hasFaqBoth) schema += 3;

  // #4: BreadcrumbList schema (3 pts, binary)
  const hasBreadcrumb = site.schemaTypes.includes('BreadcrumbList');
  criteria.breadcrumb = hasBreadcrumb;
  if (hasBreadcrumb) schema += 3;

  // #5: Schema completeness (4 pts, graduated)
  // Fields: address, telephone, openingHours, geo, areaServed, priceRange, image
  const completenessFields = ['address', 'telephone', 'openingHours', 'geo', 'areaServed', 'priceRange', 'image'];
  let completenessCount = 0;
  for (const field of completenessFields) {
    if (site.schemaFields.business[field]) completenessCount++;
  }
  criteria.schema_completeness = completenessCount;
  if (completenessCount >= 7) schema += 4;
  else if (completenessCount >= 5) schema += 3;
  else if (completenessCount >= 3) schema += 2;
  else if (completenessCount >= 1) schema += 1;


  // ────────────────────────────────────────────
  // CATEGORY 2: CONTENT QUALITY (18 points max)
  // ────────────────────────────────────────────

  let content = 0;

  // #6: H1 present and descriptive (4 pts, binary)
  const GENERIC_H1 = ['welcome', 'home', 'homepage', 'main', ''];
  const h1Valid = site.h1s.length === 1
    && !GENERIC_H1.includes(site.h1s[0].toLowerCase().trim());
  criteria.h1_present = h1Valid;
  if (h1Valid) content += 4;

  // #7: H2 hierarchy — 3+ subheadings (3 pts, graduated)
  const h2Count = site.h2s.length;
  criteria.h2_count = h2Count;
  if (h2Count >= 3) content += 3;
  else if (h2Count >= 2) content += 2;
  else if (h2Count >= 1) content += 1;

  // #8: Body word count > 500 (3 pts, binary)
  criteria.body_words = site.bodyWordCount;
  if (site.bodyWordCount >= 500) content += 3;

  // #9: Natural language Q&A content (5 pts, graduated)
  const QA_PATTERNS = [
    /what is/i, /how to/i, /how do/i, /why\s/i,
    /how much/i, /when should/i, /where can/i,
    /do you/i, /can i/i, /should i/i,
  ];
  let qaCount = 0;
  for (const pattern of QA_PATTERNS) {
    if (pattern.test(site.bodyText)) qaCount++;
  }
  criteria.qa_count = qaCount;
  content += Math.min(qaCount, 5);

  // #10: FAQ HTML blocks with real answers (3 pts, binary)
  const faqReal = site.faqBlocks > 0 && site.faqAvgAnswerWords > 20;
  criteria.faq_blocks = faqReal;
  if (faqReal) content += 3;


  // ────────────────────────────────────────────
  // CATEGORY 3: CITATION AUTHORITY (17 points max)
  // ────────────────────────────────────────────

  let authority = 0;

  // #11: NAP consistency (4 pts, binary)
  criteria.nap_consistent = site.napConsistent;
  if (site.napConsistent) authority += 4;

  // #12: Google Business Profile (4 pts, binary)
  const hasGBP = site.hasGoogleBusinessLink
    || site.hasEmbeddedMap
    || (site.schemaFields.business.hasGBPReference === true);
  criteria.gbp_claimed = hasGBP;
  if (hasGBP) authority += 4;

  // #13: Directory listings (4 pts, graduated)
  const DIRECTORY_DOMAINS = [
    'yelp.com', 'bbb.org', 'angi.com', 'homeadvisor.com',
    'avvo.com', 'healthgrades.com', 'thumbtack.com',
    'houzz.com', 'lawyers.com', 'findlaw.com',
    'zocdoc.com', 'vitals.com', 'expertise.com',
  ];
  let directoryCount = 0;
  for (const domain of DIRECTORY_DOMAINS) {
    if (site.externalLinks.some(l => l.includes(domain))) directoryCount++;
  }
  criteria.directory_count = directoryCount;
  authority += Math.min(directoryCount, 3);

  // #14: Backlink authority signals (4 pts, graduated)
  const AUTHORITY_DOMAINS = [
    '.edu', '.gov', 'reuters.com', 'bbc.com', 'nytimes.com',
    'forbes.com', 'inc.com', 'entrepreneur.com',
    'chamberofcommerce', 'rotary', 'lions',
  ];
  let backlinkScore = 0;
  for (const domain of AUTHORITY_DOMAINS) {
    if (site.externalLinks.some(l => l.includes(domain))) backlinkScore++;
  }
  criteria.backlink_authority = backlinkScore;
  authority += Math.min(backlinkScore, 3);

  // #15: Reviews / testimonials visible (3 pts, binary)
  const hasReviews = site.hasReviews
    || site.hasTestimonials
    || /testimonial|review|customer said|client feedback/i.test(site.bodyText);
  criteria.reviews_visible = hasReviews;
  if (hasReviews) authority += 3;


  // ────────────────────────────────────────────
  // CATEGORY 4: CONTENT STRUCTURE (12 points max)
  // ────────────────────────────────────────────

  let structure = 0;

  // #16: Heading hierarchy H1>H2>H3 — no skipped levels (3 pts, binary)
  criteria.heading_hierarchy = site.headingHierarchyValid;
  if (site.headingHierarchyValid) structure += 3;

  // #17: Lists / bullet formatting (2 pts, binary)
  const hasLists = site.ulCount > 0 || site.olCount > 0;
  criteria.has_lists = hasLists;
  if (hasLists) structure += 2;

  // #18: Internal linking structure (3 pts, graduated)
  const internalCount = site.internalLinks.length;
  criteria.internal_link_count = internalCount;
  if (internalCount >= 10) structure += 3;
  else if (internalCount >= 5) structure += 2;
  else if (internalCount >= 2) structure += 1;

  // #19: Meta description present + descriptive (2 pts, binary)
  const metaValid = site.metaDescription
    && site.metaDescription.length > 20
    && site.metaDescription.length <= 160;
  criteria.meta_description = metaValid;
  if (metaValid) structure += 2;

  // #20: Open Graph / social meta tags (2 pts, binary)
  const hasOG = site.ogTitle && site.ogDescription;
  criteria.og_tags = hasOG;
  if (hasOG) structure += 2;


  // ────────────────────────────────────────────
  // CATEGORY 5: RECENCY & FRESHNESS (10 points max)
  // ────────────────────────────────────────────

  let recency = 0;

  // #21: Visible dates on content (2 pts, binary)
  const DATE_PATTERN = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},?\s+\d{4}\b/i;
  const hasDates = DATE_PATTERN.test(site.bodyText) || site.hasDateElements;
  criteria.visible_dates = hasDates;
  if (hasDates) recency += 2;

  // #22: Content updated within 90 days (2 pts, binary)
  const recentUpdate = daysSince(site.lastModified) <= 90;
  criteria.updated_90d = recentUpdate;
  if (recentUpdate) recency += 2;

  // #23: Blog / news / updates section (2 pts, binary)
  const hasBlog = site.hasBlogSection
    || site.internalLinks.some(l =>
      l.includes('/blog') || l.includes('/news') || l.includes('/updates'));
  criteria.has_blog = hasBlog;
  if (hasBlog) recency += 2;

  // #24: Sitemap.xml with lastmod dates (2 pts, binary)
  const sitemapGood = site.sitemapExists && site.sitemapHasLastmod;
  criteria.sitemap_lastmod = sitemapGood;
  if (sitemapGood) recency += 2;

  // #25: Social media activity signals (2 pts, graduated)
  const SOCIAL_PLATFORMS = [
    'facebook.com', 'linkedin.com', 'twitter.com', 'x.com',
    'instagram.com', 'youtube.com', 'tiktok.com',
  ];
  let socialCount = 0;
  for (const platform of SOCIAL_PLATFORMS) {
    if (site.externalLinks.some(l => l.includes(platform))) socialCount++;
  }
  criteria.social_count = socialCount;
  if (socialCount >= 3) recency += 2;
  else if (socialCount >= 1) recency += 1;


  // ────────────────────────────────────────────
  // CATEGORY 6: E-E-A-T SIGNALS (10 points max)
  // ────────────────────────────────────────────

  let eeat = 0;

  // #26: Author bios / team page (3 pts, binary)
  const hasTeamPage = site.internalLinks.some(l =>
    l.includes('/team') || l.includes('/about')
    || l.includes('/our-team') || l.includes('/staff'));
  const hasTeam = hasTeamPage && site.hasPersonNames;
  criteria.team_page = hasTeam;
  if (hasTeam) eeat += 3;

  // #27: Credentials / certifications shown (2 pts, binary)
  const hasCreds = /certified|licensed|accredited|award|member of|association/i.test(site.bodyText);
  criteria.credentials = hasCreds;
  if (hasCreds) eeat += 2;

  // #28: About page with company story (2 pts, binary)
  const aboutGood = site.aboutPageExists && site.aboutPageWordCount > 200;
  criteria.about_page = aboutGood;
  if (aboutGood) eeat += 2;

  // #29: Client logos / case studies (2 pts, binary)
  const hasCaseStudies = /case study|client|portfolio|our work|success stor/i.test(site.bodyText)
    || site.clientLogoSection;
  criteria.case_studies = hasCaseStudies;
  if (hasCaseStudies) eeat += 2;

  // #30: Privacy policy / terms present (1 pt, binary)
  const hasPrivacy = site.internalLinks.some(l =>
    l.includes('/privacy') || l.includes('/terms') || l.includes('/legal'));
  criteria.privacy_terms = hasPrivacy;
  if (hasPrivacy) eeat += 1;


  // ────────────────────────────────────────────
  // CATEGORY 7: AI CITATIONS (15 points max)
  // From Scout scan data. If no data, scores 0.
  // This is the PROOF layer — everything else
  // predicts citations, this MEASURES them.
  // ────────────────────────────────────────────

  let citations = 0;
  const cd = citationData || {};

  // #31: Cited on any engine (3 pts, binary)
  const citedAny = (cd.engines_cited || 0) > 0;
  criteria.cited_any_engine = citedAny;
  if (citedAny) citations += 3;

  // #32: Engine coverage breadth (5 pts, graduated)
  // Scored relative to monitored engines (tier-gated)
  const enginesCited = cd.engines_cited || 0;
  const enginesMonitored = cd.engines_monitored || 0;
  const coverageRatio = enginesMonitored > 0 ? enginesCited / enginesMonitored : 0;
  criteria.engine_coverage = enginesCited;
  criteria.engines_monitored = enginesMonitored;
  if (coverageRatio >= 0.85) citations += 5;
  else if (coverageRatio >= 0.6) citations += 4;
  else if (coverageRatio >= 0.4) citations += 3;
  else if (coverageRatio >= 0.2) citations += 2;
  else if (coverageRatio > 0) citations += 1;

  // #33: Average confidence across engines (4 pts, graduated)
  const avgConfidence = cd.avg_confidence || 0;
  criteria.avg_confidence = avgConfidence;
  if (avgConfidence >= 75) citations += 4;
  else if (avgConfidence >= 50) citations += 3;
  else if (avgConfidence >= 25) citations += 2;
  else if (avgConfidence > 0) citations += 1;

  // #34: Citation trend (3 pts, graduated)
  // improving = 3, stable = 2, declining = 1, new/no data = 0
  const trend = cd.trend || 'none';
  criteria.citation_trend = trend;
  if (trend === 'improving') citations += 3;
  else if (trend === 'stable') citations += 2;
  else if (trend === 'declining') citations += 1;


  // ────────────────────────────────────────────
  // COMPUTE FINAL SCORE
  // ────────────────────────────────────────────

  const totalScore = schema + content + authority + structure + recency + eeat + citations;

  // Build list of failed criteria for Claude's narrative prompt
  const failedCriteria = [];
  if (!criteria.org_schema) failedCriteria.push('Missing Organization JSON-LD schema (name, url required)');
  if (!criteria.local_schema) failedCriteria.push('Missing LocalBusiness or industry-specific schema type');
  if (!criteria.faq_schema_html) failedCriteria.push('Missing FAQ schema + matching HTML blocks (both required)');
  if (!criteria.breadcrumb) failedCriteria.push('Missing BreadcrumbList schema');
  if (criteria.schema_completeness < 5) failedCriteria.push(`Schema completeness: only ${criteria.schema_completeness}/7 fields populated (address, telephone, openingHours, geo, areaServed, priceRange, image)`);
  if (!criteria.h1_present) failedCriteria.push('H1 tag missing or generic (Welcome, Home, etc.)');
  if (criteria.h2_count < 3) failedCriteria.push(`Only ${criteria.h2_count} H2 subheadings found (3+ recommended)`);
  if (criteria.body_words < 500) failedCriteria.push(`Body word count ${criteria.body_words} — below 500 minimum`);
  if (criteria.qa_count < 3) failedCriteria.push(`Only ${criteria.qa_count} Q&A patterns found in content (5+ ideal)`);
  if (!criteria.faq_blocks) failedCriteria.push('No FAQ HTML blocks with substantive answers (>20 words each)');
  if (!criteria.nap_consistent) failedCriteria.push('NAP (Name/Address/Phone) not consistently found on page');
  if (!criteria.gbp_claimed) failedCriteria.push('No Google Business Profile link or embedded map detected');
  if (criteria.directory_count < 3) failedCriteria.push(`Only ${criteria.directory_count} directory listing links found (3+ recommended)`);
  if (criteria.backlink_authority < 2) failedCriteria.push('Few or no authority backlink signals (.edu, .gov, industry publications)');
  if (!criteria.reviews_visible) failedCriteria.push('No reviews or testimonials visible on page');
  if (!criteria.heading_hierarchy) failedCriteria.push('Heading hierarchy invalid — skipped levels (H1>H2>H3)');
  if (!criteria.has_lists) failedCriteria.push('No bullet/numbered lists found');
  if (criteria.internal_link_count < 5) failedCriteria.push(`Only ${criteria.internal_link_count} internal links (10+ recommended)`);
  if (!criteria.meta_description) failedCriteria.push('Meta description missing or out of range (20-160 chars)');
  if (!criteria.og_tags) failedCriteria.push('Missing Open Graph title or description');
  if (!criteria.visible_dates) failedCriteria.push('No visible dates found in content');
  if (!criteria.updated_90d) failedCriteria.push('Content not updated within 90 days');
  if (!criteria.has_blog) failedCriteria.push('No blog, news, or updates section detected');
  if (!criteria.sitemap_lastmod) failedCriteria.push('Sitemap.xml missing or lacks lastmod dates');
  if (criteria.social_count < 2) failedCriteria.push(`Only ${criteria.social_count} social media platform links found`);
  if (!criteria.team_page) failedCriteria.push('No team/about page with person names');
  if (!criteria.credentials) failedCriteria.push('No credentials, certifications, or awards mentioned');
  if (!criteria.about_page) failedCriteria.push('About page missing or thin (<200 words)');
  if (!criteria.case_studies) failedCriteria.push('No case studies, client logos, or portfolio section');
  if (!criteria.privacy_terms) failedCriteria.push('No privacy policy or terms of service link');

  // Citation-specific failed criteria
  if (!citationData) {
    failedCriteria.push('No Scout scan data — run a citation scan to activate the 15-point AI Citations category');
  } else {
    if (!citedAny) failedCriteria.push('Not cited on any AI engine');
    if (coverageRatio < 0.4) failedCriteria.push(`Cited on only ${enginesCited}/${enginesMonitored} monitored engines`);
    if (avgConfidence < 50) failedCriteria.push(`Low citation confidence: ${avgConfidence}% average across engines`);
    if (trend === 'declining') failedCriteria.push('Citation trend is declining — investigate lost citations');
  }

  return {
    overall_score: totalScore,
    scores: {
      schema_markup: schema,         // out of 18
      content_quality: content,      // out of 18
      citation_authority: authority,  // out of 17
      local_presence: structure,     // out of 12
      technical_seo: recency,        // out of 10
      eeat_signals: eeat,            // out of 10
      ai_citations: citations,       // out of 15
    },
    max_scores: {
      schema_markup: 18,
      content_quality: 18,
      citation_authority: 17,
      local_presence: 12,
      technical_seo: 10,
      eeat_signals: 10,
      ai_citations: 15,
    },
    version: SCORE_VERSION,
    criteria_passed: criteria,
    failed_criteria: failedCriteria,
  };
}
