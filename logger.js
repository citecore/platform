// ═══════════════════════════════════════════════════════════
// AEO Shared Logger — Structured logging to aeo-logs-db
// Usage: const log = createLogger('aeo-scout', env);
//        await log.info('cron_start', 'Starting batch scan');
//        await log.error('api_error', 'Anthropic failed', { status: 500 });
//        await log.usage('scan', clientId, { input: 100, output: 500 });
// ═══════════════════════════════════════════════════════════

export function createLogger(workerName, env) {
  const LOGDB = env.LOGDB;

  async function write(level, event, message, opts = {}) {
    // Always echo to console for wrangler tail / real-time debugging
    const prefix = `[${workerName}]`;
    if (level === 'error') console.error(prefix, event, message);
    else if (level === 'warn') console.warn(prefix, event, message);

    if (!LOGDB) return; // graceful fallback if LOGDB not bound yet

    try {
      await LOGDB.prepare(`
        INSERT INTO system_logs (worker, level, event, message, meta, client_id, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        workerName,
        level,
        event,
        message || null,
        opts.meta ? JSON.stringify(opts.meta) : null,
        opts.clientId || null,
        opts.durationMs || null,
      ).run();
    } catch (e) {
      // Never let logging crash the worker
      console.error(prefix, 'LOGDB write failed:', e.message);
    }
  }

  return {
    info:  (event, message, opts) => write('info',  event, message, opts),
    warn:  (event, message, opts) => write('warn',  event, message, opts),
    error: (event, message, opts) => write('error', event, message, opts),
    debug: (event, message, opts) => write('debug', event, message, opts),

    // Convenience: log API token usage
    async usage(processName, clientId, { input = 0, output = 0, model = 'claude-sonnet-4-6', cost = null } = {}) {
      if (!LOGDB) return;
      const total = input + output;
      const estimate = cost ?? total * 0.00000025;
      try {
        await LOGDB.prepare(`
          INSERT INTO usage_logs (timestamp, process_name, client_id, input_tokens, output_tokens, total_tokens, cost_estimate, model)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(new Date().toISOString(), processName, clientId || null, input, output, total, estimate, model).run();
      } catch (e) {
        console.error(`[${workerName}] LOGDB usage write failed:`, e.message);
      }
    },

    // Convenience: log health check result
    async health(worker, status, latencyMs, statusCode, error) {
      if (!LOGDB) return;
      try {
        await LOGDB.prepare(`
          INSERT INTO health_logs (worker, status, latency_ms, status_code, error)
          VALUES (?, ?, ?, ?, ?)
        `).bind(worker, status, latencyMs || 0, statusCode || 0, error || null).run();
      } catch (e) {
        console.error(`[${workerName}] LOGDB health write failed:`, e.message);
      }
    },
  };
}
