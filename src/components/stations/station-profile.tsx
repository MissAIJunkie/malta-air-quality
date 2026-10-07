import { POLLUTANTS } from '@/config/pollutants';
import { STATION_PROFILES } from '@/config/station-profiles';
import type { StationDefinition } from '@/config/stations';
import { type DiurnalProfile, describeAmplitude, formatHourOfDay } from '@/lib/air-quality/diurnal';
import { getDictionary, t } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * Standing description of one station, plus the daily shape of its own
 * measurements.
 *
 * ## What this is for
 *
 * The five station pages were 65–88% textually identical with chrome stripped
 * out, which is the signature of a template over five sets of numbers rather
 * than five pages. This section is what makes them differ: half of it is
 * editorial prose written per station (`STATION_PROFILES`, which may only
 * assert what the station record supports), and half is computed from this
 * station's own measured history.
 *
 * ## Why the computed half is prose and not a chart
 *
 * Because a chart is not text. Numbers drawn into an SVG are invisible to
 * anything reading the page for content — which is the same failure that let a
 * Copernicus forecast card stand in for the whole homepage. A sentence naming
 * the peak hour and the size of the swing is readable by a person, a screen
 * reader and an extractor alike.
 *
 * ## The claims this section is allowed to make
 *
 * The underlying window is roughly ten days of upstream history, so every
 * figure travels with its sample size and the number of days behind it, and
 * the wording says "over the last N days" rather than implying a climatology.
 * `diurnalProfile` returns null rather than a weak answer when the sample
 * cannot support one, and this component renders nothing in that case instead
 * of hedging in prose.
 */
export function StationProfile({
  station,
  profiles,
  className,
}: {
  station: StationDefinition;
  /** One per pollutant with enough measured history. Order is preserved. */
  profiles: DiurnalProfile[];
  className?: string;
}) {
  const dict = getDictionary();
  const profile = STATION_PROFILES[station.slug];

  // A station with no editorial profile renders nothing rather than an empty
  // shell — a new station should be written up, not silently framed.
  if (!profile) return null;

  return (
    <section
      aria-labelledby="station-profile"
      data-slot="station-profile"
      className={cn('flex flex-col gap-4', className)}
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="station-profile" className="text-foreground text-xl tracking-tight sm:text-2xl">
          About this station
        </h2>
        <p className="text-muted-foreground text-base leading-relaxed">{profile.lead}</p>
      </div>

      <div className="flex max-w-3xl flex-col gap-4">
        {profile.siting.map((paragraph) => (
          <p
            key={paragraph.slice(0, 32)}
            className="text-muted-foreground text-base leading-relaxed"
          >
            {paragraph}
          </p>
        ))}
      </div>

      {profiles.length > 0 ? (
        <div className="flex max-w-3xl flex-col gap-3">
          <h3 className="text-foreground text-base font-semibold">
            The daily pattern here, measured
          </h3>
          <p className="text-muted-foreground text-base leading-relaxed">
            Worked out from this station&apos;s own measured hours — forecasts and gap-filled
            estimates are excluded, so this describes what the instruments actually recorded. The
            upstream feed carries roughly ten days of history, so this is the shape of a short
            recent sample rather than a seasonal average.
          </p>
          <ul className="flex flex-col gap-3">
            {profiles.map((entry) => (
              <li key={entry.pollutant}>
                <DiurnalSentence profile={entry} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex max-w-3xl flex-col gap-3">
        <h3 className="text-foreground text-base font-semibold">What this station answers best</h3>
        <p className="text-muted-foreground text-base leading-relaxed">{profile.bestFor}</p>
      </div>

      <div className="flex max-w-3xl flex-col gap-3">
        <h3 className="text-foreground text-base font-semibold">What it cannot tell you</h3>
        <ul className="text-muted-foreground marker:text-subtle flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed">
          {profile.limits.map((limit) => (
            <li key={limit.slice(0, 32)}>{limit}</li>
          ))}
        </ul>
      </div>

      <p className="text-subtle text-xs leading-relaxed">{t(dict, 'disclaimer.provisional')}</p>
    </section>
  );
}

/**
 * One pollutant's daily shape, as a sentence.
 *
 * `flat` gets different wording rather than a peak and a trough with a
 * shrugging qualifier: naming "the highest hour" of a series that barely moves
 * would dress up noise as a finding. A flat series is itself informative —
 * it is what a regionally transported pollutant looks like, as against a
 * locally emitted one.
 */
function DiurnalSentence({ profile }: { profile: DiurnalProfile }) {
  const pollutant = POLLUTANTS[profile.pollutant];
  const shape = describeAmplitude(profile.amplitudeRatio);
  const unit = pollutant.unit;

  const provenance = (
    <span className="text-subtle">
      {' '}
      ({profile.samples} measured hours over {profile.windowDays}{' '}
      {profile.windowDays === 1 ? 'day' : 'days'})
    </span>
  );

  if (shape === 'flat') {
    return (
      <p className="text-muted-foreground text-base leading-relaxed">
        <strong className="text-foreground font-medium">{pollutant.label}</strong> stays broadly
        level through the day here, averaging{' '}
        <span className="font-mono">
          {profile.overallMean.toFixed(1)} {unit}
        </span>{' '}
        with no pronounced peak — the swing between its highest and lowest hours is under half
        again. A pollutant that does not follow a daily rhythm is usually one arriving with the air
        mass rather than being emitted nearby.
        {provenance}
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-base leading-relaxed">
      <strong className="text-foreground font-medium">{pollutant.label}</strong> is typically
      highest around <span className="font-mono">{formatHourOfDay(profile.peak.hour)}</span> (
      <span className="font-mono">
        {profile.peak.mean.toFixed(1)} {unit}
      </span>{' '}
      on average) and lowest around{' '}
      <span className="font-mono">{formatHourOfDay(profile.trough.hour)}</span> (
      <span className="font-mono">
        {profile.trough.mean.toFixed(1)} {unit}
      </span>
      ) — a {shape} daily cycle, with the peak running {profile.amplitudeRatio.toFixed(1)}× the
      trough.
      {provenance}
    </p>
  );
}
