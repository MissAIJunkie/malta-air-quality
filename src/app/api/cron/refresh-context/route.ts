/**
 * GET /api/cron/refresh-context
 *
 * Refreshes the environmental-context snapshot and archives the events it
 * classified, so a past reading stays explainable long after the condition that
 * may have influenced it has ended.
 *
 * Shares `lockRefreshContext` with `/api/cron/refresh-weather` — see that file
 * for why one snapshot is served by two jobs and why they are staggered.
 *
 * Context is never evidence. Nothing written here modifies a concentration, a
 * sub-index or a category; the rows exist to explain, and they carry their own
 * relevance and confidence so a weak signal can be presented weakly.
 */

import { getEnv } from '@/config/env';
import type { Island } from '@/config/stations';
import { isDatabaseConfigured } from '@/db/client';
import { deactivateStaleEvents, upsertEvents } from '@/db/queries/events';
import { recordProviderProbe } from '@/db/queries/health';
import type { NewEnvironmentalEventRow } from '@/db/schema';
import { cacheKeys } from '@/lib/cache/keys';
import { RELEVANCE_THRESHOLD } from '@/lib/environmental-context/relevance';
import { getAtmosphericContext } from '@/lib/environmental-context/service';
import type {
  ContextConfidence,
  EnrichedContextEvent,
  GeographicalScope,
} from '@/lib/environmental-context/types';
import { PROVIDER_PROBE_NAMES, probeErrorMessage, runCronJob } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Probe name for the context pipeline, so `/api/health` can report its trend. */
const CONTEXT_PROBE_NAME = PROVIDER_PROBE_NAMES.context;

/**
 * How long an event may go unseen before it stops being current.
 *
 * The snapshot refreshes every thirty minutes, so six hours is twelve
 * consecutive absences — long enough that a single failed refresh cannot
 * deactivate a live episode, short enough that a finished one does not linger.
 * Deactivation, never deletion: the row still has to explain the hours it
 * covered.
 */
const STALE_EVENT_HOURS = 6;

/**
 * Domain relevance is a continuous 0–1 score; the column is a three-value band.
 *
 * Thirds, rather than anything tuned: the band exists so an operator can filter
 * the table, and the score itself is kept in `detail` for anyone who needs the
 * original number.
 */
function relevanceBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.66) return 'high';
  if (score >= 0.33) return 'medium';
  return 'low';
}

/**
 * The two `confidence` fields are inverses of each other, which is easy to
 * misread as a mistake: the domain carries a band and the column carries a
 * number. These are the band midpoints, not measurements.
 */
const CONFIDENCE_VALUE: Record<ContextConfidence, number> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

/**
 * Which of the two islands a condition bears on.
 *
 * A regional or Central Mediterranean condition reaches both — the islands are
 * 27 km apart and no context model distinguishes them. An unstated scope stays
 * `null` rather than defaulting to both, because "we were not told" and "both"
 * are different facts.
 */
function affectedIslands(scope: GeographicalScope | undefined): Island[] | null {
  switch (scope) {
    case 'Malta':
      return ['Malta'];
    case 'Gozo':
      return ['Gozo'];
    case 'Maltese Islands':
    case 'Central Mediterranean':
    case 'Regional':
      return ['Malta', 'Gozo'];
    default:
      return null;
  }
}

function toEventRow(event: EnrichedContextEvent): NewEnvironmentalEventRow {
  return {
    // `id` is derived from the event's content and is stable across refreshes,
    // which is precisely the identity the dedupe column wants.
    dedupeHash: event.id,
    kind: event.type,
    title: event.title,
    summary: event.summary,
    relevance: relevanceBand(event.relevance),
    confidence: CONFIDENCE_VALUE[event.confidence],
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
    publishedAt: Number.isFinite(Date.parse(event.publishedAt))
      ? new Date(event.publishedAt)
      : null,
    latitude: null,
    longitude: null,
    affectsIslands: affectedIslands(event.geographicalScope),
    relatedPollutants: event.affectedPollutants ?? null,
    // Retained so a classification can be re-audited later against the inputs
    // that produced it, including the exact relevance score behind the band.
    detail: {
      relevanceScore: event.relevance,
      confidenceBand: event.confidence,
      impactDirection: event.impactDirection,
      observedOrForecast: event.observedOrForecast,
      geographicalScope: event.geographicalScope ?? null,
      startsAt: event.startsAt ?? null,
      endsAt: event.endsAt ?? null,
      aiGeneratedSummary: event.aiGeneratedSummary,
      titleKey: event.titleKey ?? null,
      summaryKey: event.summaryKey ?? null,
      citations: event.citations.map((citation) => ({
        sourceName: citation.sourceName,
        sourceUrl: citation.sourceUrl,
        publishedAt: citation.publishedAt,
      })),
    },
    active: true,
  };
}

export async function GET(request: Request) {
  return runCronJob(
    request,
    {
      job: 'refresh-context',
      lockKey: cacheKeys.lockRefreshContext(),
      lockTtlSeconds: 180,
    },
    async ({ now }) => {
      if (!getEnv().CONTEXT_REFRESH_ENABLED) {
        return { skipped: 'CONTEXT_REFRESH_ENABLED is false — context refresh is switched off.' };
      }

      const startedAt = Date.now();
      let snapshot;

      try {
        snapshot = await getAtmosphericContext(now.toISOString());
      } catch (error) {
        await recordProviderProbe(
          {
            provider: CONTEXT_PROBE_NAME,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: probeErrorMessage(error),
          },
          now,
        );
        throw error;
      }

      const latencyMs = Date.now() - startedAt;

      // Only events that clear the relevance threshold are archived — the same
      // set `/api/context` would show. Below-threshold noise would fill the
      // table with conditions nobody was ever told about.
      const relevant = snapshot.events.filter((event) => event.relevance >= RELEVANCE_THRESHOLD);

      await recordProviderProbe(
        {
          provider: CONTEXT_PROBE_NAME,
          ok: !snapshot.stale,
          latencyMs,
          error: snapshot.degradedReason ?? null,
          detail: {
            events: relevant.length,
            cached: snapshot.cached,
            unavailableSources: snapshot.unavailableSources.length,
          },
        },
        now,
      );

      if (!isDatabaseConfigured()) {
        return {
          skipped:
            'No database is configured, so the snapshot was refreshed but no events were archived. /api/context is unaffected.',
          detail: {
            events: relevant.length,
            servedFromCache: snapshot.cached,
            stale: snapshot.stale,
            latencyMs,
          },
        };
      }

      const written = await upsertEvents(relevant.map(toEventRow), now);
      const deactivated = await deactivateStaleEvents(
        new Date(now.getTime() - STALE_EVENT_HOURS * 60 * 60 * 1000),
      );

      return {
        detail: {
          events: relevant.length,
          rowsWritten: written,
          deactivated,
          servedFromCache: snapshot.cached,
          stale: snapshot.stale,
          unavailableSources: snapshot.unavailableSources.length,
          latencyMs,
        },
      };
    },
  );
}
