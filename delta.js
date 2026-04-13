// ═══════════════════════════════════════════════════════════
// EVO-37: SCORE DELTA ENGINE
//
// Compares two criteria_passed objects and produces a
// human-readable breakdown of what changed and why.
// Used by OptimizerSentinel to generate the
// "Your score went from X to Y" section in reports.
// ═══════════════════════════════════════════════════════════

// Maps criteria keys to human-readable labels and point values
// Must stay in sync with shared/scoring.js category allocations
const CRITERIA_MAP = {
  // Category 1: Schema Markup (18 pts)
  org_schema:           { label: 'Organization JSON-LD schema', pts: 4, type: 'binary' },
  local_schema:         { label: 'LocalBusiness schema type', pts: 4, type: 'binary' },
  faq_schema_html:      { label: 'FAQ schema + matching HTML', pts: 3, type: 'binary' },
  breadcrumb:           { label: 'BreadcrumbList schema', pts: 3, type: 'binary' },
  schema_completeness:  { label: 'Schema field completeness', pts: 4, type: 'graduated', max: 7, thresholds: [0, 1, 3, 5, 7] },

  // Category 2: Content Quality (18 pts)
  h1_present:           { label: 'Descriptive H1 tag', pts: 4, type: 'binary' },
  h2_count:             { label: 'H2 subheadings', pts: 3, type: 'graduated', max: 3, thresholds: [0, 1, 2, 3] },
  body_words:           { label: 'Body word count (500+ min)', pts: 3, type: 'graduated', max: 500, thresholds: [0, 500] },
  qa_count:             { label: 'Q&A content patterns', pts: 5, type: 'graduated', max: 5 },
  faq_blocks:           { label: 'FAQ blocks with real answers', pts: 3, type: 'binary' },

  // Category 3: Citation Authority (17 pts)
  nap_consistent:       { label: 'NAP consistency', pts: 4, type: 'binary' },
  gbp_claimed:          { label: 'Google Business Profile', pts: 4, type: 'binary' },
  directory_count:      { label: 'Directory listings', pts: 3, type: 'graduated', max: 3 },
  backlink_authority:   { label: 'Authority backlink signals', pts: 3, type: 'graduated', max: 3 },
  reviews_visible:      { label: 'Reviews/testimonials visible', pts: 3, type: 'binary' },

  // Category 4: Content Structure (12 pts)
  heading_hierarchy:    { label: 'Heading hierarchy (H1>H2>H3)', pts: 3, type: 'binary' },
  has_lists:            { label: 'Bullet/numbered lists', pts: 2, type: 'binary' },
  internal_link_count:  { label: 'Internal linking structure', pts: 3, type: 'graduated', max: 10 },
  meta_description:     { label: 'Meta description', pts: 2, type: 'binary' },
  og_tags:              { label: 'Open Graph tags', pts: 2, type: 'binary' },

  // Category 5: Recency & Freshness (10 pts)
  visible_dates:        { label: 'Visible dates in content', pts: 2, type: 'binary' },
  updated_90d:          { label: 'Updated within 90 days', pts: 2, type: 'binary' },
  has_blog:             { label: 'Blog/news section', pts: 2, type: 'binary' },
  sitemap_lastmod:      { label: 'Sitemap with lastmod', pts: 2, type: 'binary' },
  social_count:         { label: 'Social media links', pts: 2, type: 'graduated', max: 3 },

  // Category 6: E-E-A-T Signals (10 pts)
  team_page:            { label: 'Team/about page with names', pts: 3, type: 'binary' },
  credentials:          { label: 'Credentials/certifications', pts: 2, type: 'binary' },
  about_page:           { label: 'About page (200+ words)', pts: 2, type: 'binary' },
  case_studies:         { label: 'Case studies/client logos', pts: 2, type: 'binary' },
  privacy_terms:        { label: 'Privacy policy/terms', pts: 1, type: 'binary' },

  // Category 7: AI Citations (15 pts)
  cited_any_engine:     { label: 'Cited on any AI engine', pts: 3, type: 'binary' },
  engine_coverage:      { label: 'Engine coverage breadth', pts: 5, type: 'graduated', max: 9 },
  avg_confidence:       { label: 'Citation confidence', pts: 4, type: 'graduated', max: 100 },
  citation_trend:       { label: 'Citation trend', pts: 3, type: 'string_enum', values: { improving: 3, stable: 2, declining: 1, none: 0 } },
};

/**
 * Estimate points for a criterion value.
 * For binary: true = pts, false = 0
 * For graduated: approximate based on value vs thresholds
 */
function estimatePoints(key, value) {
  const meta = CRITERIA_MAP[key];
  if (!meta) return 0;

  if (meta.type === 'binary') {
    return value ? meta.pts : 0;
  }

  if (meta.type === 'string_enum') {
    return meta.values[value] || 0;
  }

  // Graduated — use the max point value scaled
  if (meta.type === 'graduated') {
    const num = typeof value === 'number' ? value : 0;
    if (meta.thresholds) {
      // Count how many thresholds are met
      let score = 0;
      for (let i = 1; i < meta.thresholds.length; i++) {
        if (num >= meta.thresholds[i]) score++;
      }
      return Math.min(score, meta.pts);
    }
    // Simple cap
    return Math.min(num, meta.pts);
  }

  return 0;
}

/**
 * Compute the delta between two criteria_passed objects.
 *
 * Returns:
 *   {
 *     previous_score: number,
 *     current_score: number,
 *     delta: number,
 *     gains: [{ criterion, label, points, detail }],
 *     losses: [{ criterion, label, points, detail }],
 *     unchanged: number,
 *     summary: string  // "Your score went from 58 to 67..."
 *   }
 */
export function computeDelta(previousCriteria, currentCriteria, previousScore, currentScore) {
  const prev = previousCriteria || {};
  const curr = currentCriteria || {};

  const gains = [];
  const losses = [];
  let unchangedCount = 0;

  for (const [key, meta] of Object.entries(CRITERIA_MAP)) {
    const prevVal = prev[key];
    const currVal = curr[key];
    const prevPts = estimatePoints(key, prevVal);
    const currPts = estimatePoints(key, currVal);

    if (currPts > prevPts) {
      gains.push({
        criterion: key,
        label: meta.label,
        points: currPts - prevPts,
        from: prevVal,
        to: currVal,
        detail: formatChange(meta, prevVal, currVal, currPts - prevPts),
      });
    } else if (currPts < prevPts) {
      losses.push({
        criterion: key,
        label: meta.label,
        points: prevPts - currPts,
        from: prevVal,
        to: currVal,
        detail: formatChange(meta, prevVal, currVal, currPts - prevPts),
      });
    } else {
      unchangedCount++;
    }
  }

  // Sort by point impact (biggest first)
  gains.sort((a, b) => b.points - a.points);
  losses.sort((a, b) => b.points - a.points);

  const delta = currentScore - previousScore;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged';

  // Build human-readable summary
  const parts = [];
  if (gains.length > 0) {
    parts.push(`Gained: ${gains.map(g => `${g.label} (+${g.points})`).join(', ')}`);
  }
  if (losses.length > 0) {
    parts.push(`Lost: ${losses.map(l => `${l.label} (-${l.points})`).join(', ')}`);
  }

  const summary = delta === 0
    ? `Your score held steady at ${currentScore}. ${unchangedCount} criteria unchanged.`
    : `Your score went from ${previousScore} to ${currentScore} (${delta > 0 ? '+' : ''}${delta} points). ${parts.join('. ')}.`;

  return {
    previous_score: previousScore,
    current_score: currentScore,
    delta,
    direction,
    gains,
    losses,
    unchanged: unchangedCount,
    summary,
  };
}

function formatChange(meta, from, to, ptsDelta) {
  const sign = ptsDelta > 0 ? '+' : '';
  if (meta.type === 'binary') {
    return ptsDelta > 0
      ? `Added: ${meta.label} (${sign}${ptsDelta})`
      : `Removed: ${meta.label} (${sign}${ptsDelta})`;
  }
  if (meta.type === 'string_enum') {
    return `${meta.label}: ${from || 'none'} → ${to || 'none'} (${sign}${ptsDelta})`;
  }
  return `${meta.label}: ${from || 0} → ${to || 0} (${sign}${ptsDelta})`;
}
