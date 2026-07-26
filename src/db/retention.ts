/**
 * Retention policy.
 *
 * Every number that decides how long something is kept lives here, so the
 * privacy notice and the cleanup job can never drift apart.
 *
 * Two principles shape the defaults:
 *
 *  - **Measurements are a public record.** Twelve months of raw hourly readings
 *    covers a full seasonal cycle, which is the shortest window in which a
 *    year-on-year comparison means anything.
 *  - **Environmental events are never deleted.** They are the interpretive
 *    context for historical readings; discarding them would leave past episodes
 *    unexplainable. Stale events are deactivated, not removed.
 */

/** A retention window, in days. `null` means "keep indefinitely". */
export type RetentionDays = number | null;

const DAY = 24 * 60 * 60 * 1000;

export type RetentionPolicy = {
  /**
   * Raw hourly readings. Twelve months.
   *
   * Aggregates derived from these (daily and monthly means) are cheap and are
   * intended to outlive the raw rows; nothing here deletes them.
   */
  readonly rawReadings: RetentionDays;
  /** Forecast points age out quickly — once the hour has passed they are of
   *  interest only for scoring model skill, which is out of scope. */
  readonly forecasts: RetentionDays;
  /** Weather context is only useful alongside a reading it can explain. */
  readonly weatherObservations: RetentionDays;
  /** Indefinite. See the note above. */
  readonly environmentalEvents: RetentionDays;
  /** Cached AI text. Regenerable, and cheap to regenerate. */
  readonly aiSummaries: RetentionDays;
  /** Operational telemetry. 90 days is the top of the brief's 30–90 day range;
   *  it is enough to spot a slow seasonal degradation in upstream reliability. */
  readonly providerHealth: RetentionDays;
  readonly dataImportRuns: RetentionDays;
  /** Delivery audit trail. Twelve months, matching the readings that triggered it. */
  readonly alertDeliveries: RetentionDays;
  /**
   * Rows for addresses that unsubscribed.
   *
   * Kept for 30 days so an accidental unsubscribe can be investigated and a
   * replayed subscribe request cannot silently resurrect the address, then
   * purged — there is no legitimate reason to hold an address longer once its
   * owner has asked to be removed.
   */
  readonly unsubscribedSubscriptions: RetentionDays;
  /**
   * Subscriptions that were never confirmed.
   *
   * Seven days. An unconfirmed address never consented to anything, so it is
   * held only long enough for the confirmation link to be usable.
   */
  readonly unconfirmedSubscriptions: RetentionDays;
};

export const RETENTION: RetentionPolicy = {
  rawReadings: 365,
  forecasts: 30,
  weatherObservations: 365,
  environmentalEvents: null,
  aiSummaries: 30,
  providerHealth: 90,
  dataImportRuns: 90,
  alertDeliveries: 365,
  unsubscribedSubscriptions: 30,
  unconfirmedSubscriptions: 7,
};

export type RetentionKey = keyof RetentionPolicy;

/**
 * The cutoff instant for a policy: rows older than this may be removed.
 *
 * Returns `null` for an indefinite policy, which callers must read as "delete
 * nothing" rather than as "delete everything before the epoch".
 */
export function retentionCutoff(key: RetentionKey, now: Date = new Date()): Date | null {
  const days = RETENTION[key];
  if (days === null) return null;
  return new Date(now.getTime() - days * DAY);
}

/**
 * Human-readable retention windows, for the privacy notice.
 *
 * Generated from the same constants the cleanup job uses, so the published
 * statement cannot describe a policy the code does not implement.
 */
export function describeRetention(): Array<{ key: RetentionKey; description: string }> {
  return (Object.keys(RETENTION) as RetentionKey[]).map((key) => {
    const days = RETENTION[key];
    if (days === null) return { key, description: 'Kept indefinitely' };
    if (days % 365 === 0) {
      const years = days / 365;
      return { key, description: years === 1 ? 'Kept for 12 months' : `Kept for ${years} years` };
    }
    return { key, description: `Kept for ${days} days` };
  });
}
