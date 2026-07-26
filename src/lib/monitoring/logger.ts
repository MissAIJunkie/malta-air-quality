/**
 * Structured logging.
 *
 * One line of JSON per event so Vercel's log drain can be queried by field.
 * Secrets, credentials, prompt contents and raw upstream bodies must never be
 * passed in — see `redactValue` for the defensive pass applied to every field.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY = /(key|token|secret|password|authorization|cookie|dsn|credential)/i;

/**
 * Defence in depth. Callers are expected not to log secrets; this makes an
 * accidental one non-catastrophic rather than relying on discipline alone.
 */
function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}… (${value.length} chars)`;
  }
  return value;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = redactValue(key, value);
  }

  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...safe,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => {
    if (process.env.NODE_ENV === 'production') return;
    emit('debug', event, fields);
  },
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};

/** Time an async operation and log its duration and outcome. */
export async function timed<T>(event: string, fields: LogFields, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    logger.info(event, { ...fields, durationMs: Date.now() - started, ok: true });
    return result;
  } catch (error) {
    logger.error(event, { ...fields, durationMs: Date.now() - started, ok: false, error: String(error) });
    throw error;
  }
}
