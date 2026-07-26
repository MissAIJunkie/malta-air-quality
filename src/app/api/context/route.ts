/**
 * GET /api/context
 *
 * Environmental conditions that may be influencing air quality across Malta and
 * Gozo, ranked by relevance to the islands.
 *
 * Query parameters:
 *   ?type=saharan_dust,low_wind  — one event type or a comma-separated list
 *   ?impact=worsening            — worsening | improving | neutral | unclear
 *   ?limit=5                     — 1–50, default 20
 *
 * Envelope note: this route returns `{ data, meta }` with the same field names
 * and the same cache headers as `ok()` in `lib/api/respond.ts`, but constructs
 * them locally. `ResponseMeta.source` is the air-quality provider union
 * (`EEA | ERA | FIXTURE`), and none of those describes Open-Meteo or CAMS.
 * Labelling this response `EEA` to satisfy a type would misstate provenance,
 * which is the one thing this project will not do. Validate with
 * `contextResponseMetaSchema`; error shapes are unchanged, because failures
 * still go through `respond.ts`.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { badRequest, handleRouteError } from '@/lib/api/respond';
import {
  contextImpactQuerySchema,
  contextLimitQuerySchema,
  contextTypeQuerySchema,
} from '@/lib/environmental-context/schemas';
import { getContextEvents } from '@/lib/environmental-context/service';
import type {
  ContextQuery,
  EnvironmentalContextEventType,
  ImpactDirection,
} from '@/lib/environmental-context/types';

// Provider access needs Node APIs and a stable fetch surface, matching
// /api/air-quality.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Identical to the header `ok()` sets, so edge caching behaves the same way. */
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query: ContextQuery = {};

    const rawType = params.get('type');
    if (rawType !== null) {
      const parsed = contextTypeQuerySchema.safeParse(rawType);
      // An unknown type is rejected rather than ignored: silently returning
      // everything would look like a filter that matched nothing.
      if (!parsed.success) return badRequest('Invalid type parameter.');
      query.types = parsed.data as EnvironmentalContextEventType[];
    }

    const rawImpact = params.get('impact');
    if (rawImpact !== null) {
      const parsed = contextImpactQuerySchema.safeParse(rawImpact);
      if (!parsed.success) return badRequest('Invalid impact parameter.');
      query.impact = parsed.data as ImpactDirection;
    }

    const rawLimit = params.get('limit');
    if (rawLimit !== null) {
      const parsed = contextLimitQuerySchema.safeParse(rawLimit);
      if (!parsed.success) return badRequest('Invalid limit parameter. Expected 1 to 50.');
      query.limit = parsed.data;
    }

    const { events, coverage, meta } = await getContextEvents(query);

    return NextResponse.json(
      {
        data: {
          events,
          /**
           * Model hours the underlying forecasts span. Deliberately not
           * `meta.measuredAt`: these hours run ahead of now, and a consumer
           * deriving an age from them would compute a negative one.
           */
          coverage,
          filters: {
            types: query.types ?? null,
            impact: query.impact ?? null,
            limit: query.limit ?? null,
          },
          /**
           * Restated in the payload as well as in `meta` so a client that only
           * renders `data` still shows what this list is and is not.
           */
          disclaimer:
            'Environmental context is provided to help interpret measurements. It never adjusts a measured value, and it does not establish the cause of any individual reading.',
          /** Required wherever health-effect language appears. */
          healthDisclaimer:
            'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.',
        },
        meta,
      },
      { status: 200, headers: { 'cache-control': CACHE_CONTROL } },
    );
  } catch (error) {
    return handleRouteError('/api/context', error);
  }
}
