/**
 * The application dictionary.
 *
 * Every user-facing string in maqua.app resolves through here. Keys are FLAT and
 * dotted (`category.good.label`) rather than nested objects for three reasons:
 * the config files in `src/config` already store bare key strings such as
 * `CATEGORY_PRESENTATION.Good.labelKey`, a flat map makes a missing key a
 * one-line lookup failure rather than a traversal crash, and translators receive
 * a single ordered list.
 *
 * English ships today. Maltese (`mt`) and French (`fr`) are declared in `Locale`
 * and fall back to English until their dictionaries land, so no call site has to
 * change when they do.
 *
 * Two strings in this file are FIXED TEXT and must be copied verbatim, never
 * paraphrased or "improved": `footer.attribution` (required by the upstream
 * terms of use) and `disclaimer.medical` (required by the product brief).
 */

import type { AirQualityCategory } from '@/config/thresholds';

/* -------------------------------------------------------------------------- */
/*  Locales                                                                    */
/* -------------------------------------------------------------------------- */

export type Locale = 'en' | 'mt' | 'fr';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'mt', 'fr'];

export const DEFAULT_LOCALE: Locale = 'en';

/** Locales with a complete dictionary. The rest fall back to `DEFAULT_LOCALE`. */
export const AVAILABLE_LOCALES: readonly Locale[] = ['en'];

/* -------------------------------------------------------------------------- */
/*  English                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `satisfies` rather than `as const`: it enforces that every value is a string
 * while letting the values widen, so `Dictionary[key]` is plainly `string` and
 * downstream code is not littered with string-literal types.
 */
const en = {
  /* --- Application shell ------------------------------------------------- */

  'app.name': 'maqua.app',
  'app.shortName': 'maqua',
  'app.tagline': 'Air quality in Malta and Gozo, hour by hour',
  'app.description':
    'Current air quality for the five monitoring stations in Malta and Gozo, with what the numbers mean for your day.',

  /* --- Generic vocabulary ------------------------------------------------ */

  'common.loading': 'Loading',
  'common.loadingData': 'Loading air-quality data',
  'common.retry': 'Try again',
  'common.refresh': 'Refresh',
  'common.refreshing': 'Refreshing',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.dismiss': 'Dismiss',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.previous': 'Previous',
  'common.showMore': 'Show more',
  'common.showLess': 'Show less',
  'common.learnMore': 'Learn more',
  'common.viewDetails': 'View details',
  'common.viewAll': 'View all',
  'common.select': 'Select',
  'common.search': 'Search',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.share': 'Share',
  'common.print': 'Print',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.on': 'On',
  'common.off': 'Off',
  'common.all': 'All',
  'common.none': 'None',
  'common.notAvailable': 'Not available',
  'common.notAvailableShort': 'n/a',
  'common.notMeasured': 'Not measured',
  'common.unknown': 'Unknown',
  'common.estimated': 'Estimated',
  'common.measured': 'Measured',
  'common.provisional': 'Provisional',
  'common.verified': 'Verified',
  'common.openInNewTab': 'Opens in a new tab',
  'common.externalLink': 'External link',
  'common.optional': 'Optional',
  'common.required': 'Required',
  'common.beta': 'Beta',
  'common.separator': ' · ',
  'common.listAnd': 'and',
  'common.listOr': 'or',

  /* --- Accessibility ----------------------------------------------------- */

  'a11y.skipToContent': 'Skip to main content',
  'a11y.skipToMap': 'Skip to the map',
  'a11y.mainNavigation': 'Main navigation',
  'a11y.mainContent': 'Main content',
  'a11y.complementary': 'Supporting information',
  'a11y.statusRegion': 'Air-quality status',
  'a11y.liveRegion': 'Status updates',
  'a11y.chartDescription': 'Chart. A data table with the same values follows.',
  'a11y.dataTableToggle': 'Show the values as a table',
  'a11y.dataTableCaption': 'Values shown in the chart above',
  'a11y.colourNotAlone':
    'Each air-quality band is shown with a colour, a texture, an icon and a written label, so colour is never the only cue.',
  'a11y.newWindow': 'Opens in a new window',
  'a11y.currentPage': 'Current page',
  'a11y.sortAscending': 'Sorted, lowest first',
  'a11y.sortDescending': 'Sorted, highest first',

  /* --- Navigation -------------------------------------------------------- */

  'nav.home': 'Now',
  'nav.map': 'Map',
  'nav.stations': 'Stations',
  'nav.pollutants': 'Pollutants',
  'nav.forecast': 'Forecast',
  'nav.history': 'History',
  'nav.health': 'Health',
  'nav.alerts': 'Alerts',
  'nav.methodology': 'Methodology',
  'nav.data': 'Data source',
  'nav.about': 'About',
  'nav.faq': 'Questions',
  'nav.privacy': 'Privacy',
  'nav.openMenu': 'Open menu',
  'nav.closeMenu': 'Close menu',
  'nav.menu': 'Menu',

  /* --- Theme and language ------------------------------------------------ */

  'theme.label': 'Appearance',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'Match device',
  'theme.toggle': 'Change appearance',

  'locale.label': 'Language',
  'locale.en': 'English',
  'locale.mt': 'Malti',
  'locale.fr': 'Français',
  'locale.comingSoon': 'Not yet translated — English is shown.',

  /* --- Header and Malta-wide summary ------------------------------------- */

  'header.title': 'Air quality now',
  'header.subtitle': 'Malta and Gozo',
  'header.overallLabel': 'Across Malta and Gozo',
  'header.overallFor': 'Air quality across Malta and Gozo is {category}',
  'header.dominantPollutant': 'Driven by {pollutant}',
  'header.drivingStation': 'Highest reading at {station}',
  'header.aggregation': 'Malta-wide status follows the worst reporting station.',
  'header.aggregationExplain':
    'We do not average across stations. A single poor location is not cancelled out by good ones, so the summary reports the worst station that is currently reporting.',
  'header.reportingStations': '{reporting} of {total} stations reporting',
  'header.staleStations': '{count} station readings are older than expected',
  'header.noReporting': 'No station is reporting right now',
  'header.noReportingHint':
    'The upstream feed has not published a usable reading. Nothing here should be read as an all-clear.',
  'header.updatedAt': 'Measured at {time}',
  'header.retrievedAt': 'Retrieved at {time}',
  'header.nextUpdate': 'Next update expected around {time}',
  'header.viewMap': 'See the map',
  'header.viewStations': 'See all stations',

  /* --- Home page --------------------------------------------------------- */

  'home.heroHeading': 'What is in the air over Malta right now',
  'home.heroBody':
    'Readings from the five official monitoring stations, refreshed hourly, with the European Air Quality Index worked out for each pollutant.',
  'home.stationsHeading': 'Monitoring stations',
  'home.stationsBody':
    'Five stations report for Malta and Gozo. Choose one to see every pollutant it measures.',
  'home.mapHeading': 'Where the readings come from',
  'home.pollutantsHeading': 'What is being measured',
  'home.forecastHeading': 'The next two days',
  'home.healthHeading': 'What this means for you',
  'home.methodologyHeading': 'How this is worked out',
  'home.emptyState': 'No readings are available at the moment.',

  /* --- Map --------------------------------------------------------------- */

  'map.title': 'Station map',
  'map.description': 'Air-quality band at each monitoring station in Malta and Gozo.',
  'map.loading': 'Loading map',
  'map.unavailable': 'The map could not be loaded',
  'map.unavailableHint': 'You can still read every station in the list below.',
  'map.listFallbackHeading': 'Stations as a list',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.resetView': 'Reset the view to Malta',
  'map.locate': 'Find my location',
  'map.locating': 'Finding your location',
  'map.locateDenied': 'Location access was declined. The map is unchanged.',
  'map.locateUnavailable': 'Your location is not available on this device.',
  'map.fullscreen': 'Full screen',
  'map.exitFullscreen': 'Leave full screen',
  'map.toggleLabels': 'Show station names',
  'map.basemap': 'Base map style',
  'map.legendTitle': 'Air-quality bands',
  'map.legendDescription': 'Colour, texture and icon all carry the same band.',
  'map.legendNoData': 'No reading',
  'map.markerLabel': '{station}: {category}',
  'map.markerNoData': '{station}: no reading',
  'map.selectStation': 'Select {station}',
  'map.selectedStation': '{station} is selected',
  'map.keyboardHint': 'Use Tab to move between stations and Enter to open one.',
  'map.attributionBasemap': 'Base map © OpenStreetMap contributors',
  'map.viewAsList': 'View as a list',
  'map.viewAsMap': 'View on the map',

  /* --- Stations ---------------------------------------------------------- */

  'station.panelTitle': 'Station detail',
  'station.selectPrompt': 'Choose a station to see its readings.',
  'station.overall': 'Overall band',
  'station.overallExplain':
    'The overall band is the worst sub-index across the pollutants this station reported.',
  'station.dominantPollutant': 'Leading pollutant',
  'station.dominantExplain': 'The pollutant with the highest sub-index at this hour.',
  'station.pollutants': 'Pollutants measured',
  'station.noPollutants': 'This station reported no pollutant values for this hour.',
  'station.noReading': 'No current reading',
  'station.noReadingHint': 'The station has not published a usable value recently.',
  'station.readingValue': '{value} {unit}',
  'station.subIndex': 'Sub-index {value}',
  'station.subIndexExplain':
    'A continuous position within the band: 3.0 sits at the bottom of Moderate, 3.9 near the top.',
  'station.measuredAt': 'Measured at {time}',
  'station.retrievedAt': 'Retrieved at {time}',
  'station.age': '{age}',
  'station.nextExpected': 'Next reading expected around {time}',
  'station.provisional': 'Provisional',
  'station.provisionalExplain':
    'Near-real-time data is published before validation and may be revised or withdrawn by ERA.',
  'station.partial': 'Partial reading',
  'station.partialExplain':
    'One or more pollutants this station usually reports are missing from this hour.',
  'station.type': 'Station type',
  'station.area': 'Area',
  'station.altitude': 'Altitude',
  'station.altitudeValue': '{metres} m above sea level',
  'station.island': 'Island',
  'station.coordinates': 'Coordinates',
  'station.operator': 'Operated by',
  'station.sourceLink': 'Station page at ERA',
  'station.viewHistory': 'See the last ten days',
  'station.viewForecast': 'See the forecast',
  'station.compare': 'Compare stations',
  'station.nearest': 'Nearest station',
  'station.distanceAway': '{distance} km away',
  'station.allStations': 'All stations',
  'station.reporting': 'Reporting',
  'station.notReporting': 'Not reporting',
  'station.inactive': 'Not in service',

  'station.island.malta': 'Malta',
  'station.island.gozo': 'Gozo',
  'station.type.background': 'Background',
  'station.type.traffic': 'Traffic',
  'station.type.industrial': 'Industrial',
  'station.type.backgroundExplain':
    'Sited away from single sources to represent general exposure in the area.',
  'station.type.trafficExplain':
    'Sited beside a busy road, so it records the higher end of local exposure.',
  'station.type.industrialExplain': 'Sited to capture the influence of nearby industry.',
  'station.area.urban': 'Urban',
  'station.area.suburban': 'Suburban',
  'station.area.rural': 'Rural',
  'station.area.ruralRegional': 'Rural, regional',

  /* --- Air-quality categories ------------------------------------------- */
  /* Keys referenced directly by CATEGORY_PRESENTATION in src/config/thresholds.ts. */

  'category.good.label': 'Good',
  'category.good.shortAdvice': 'Air quality is good. Enjoy your usual outdoor activities.',
  'category.good.description':
    'Concentrations are low across every pollutant reported at this hour.',

  'category.fair.label': 'Fair',
  'category.fair.shortAdvice': 'Air quality is fair. Outdoor activities are fine for most people.',
  'category.fair.description':
    'Concentrations are a little above the lowest band but remain well within everyday levels.',

  'category.moderate.label': 'Moderate',
  'category.moderate.shortAdvice':
    'Air quality is moderate. Anyone sensitive to air pollution may prefer shorter or gentler outdoor exertion.',
  'category.moderate.description':
    'At least one pollutant is raised. Most people will notice nothing; some sensitive individuals may.',

  'category.poor.label': 'Poor',
  'category.poor.shortAdvice':
    'Air quality is poor. Consider easing back on strenuous outdoor activity, particularly if you are sensitive to air pollution.',
  'category.poor.description':
    'At least one pollutant is clearly raised. Short-term symptoms become more likely for sensitive groups.',

  'category.veryPoor.label': 'Very poor',
  'category.veryPoor.shortAdvice':
    'Air quality is very poor. Reduce outdoor exertion and keep windows closed if a nearby source is the cause.',
  'category.veryPoor.description':
    'Concentrations are high. Effects may be noticeable to the general population, not only to sensitive groups.',

  'category.extremelyPoor.label': 'Extremely poor',
  'category.extremelyPoor.shortAdvice':
    'Air quality is extremely poor. Avoid outdoor exertion and follow any official guidance issued for the area.',
  'category.extremelyPoor.description':
    'Concentrations are very high. This band is rare in Malta and warrants attention while it lasts.',

  'category.noData.label': 'No data',
  'category.noData.shortAdvice':
    'There is no index for this hour, so we cannot describe the air quality.',
  'category.noData.description':
    'No usable measurement was published. An absent reading is not a good reading — it simply tells us nothing.',

  'category.scaleTitle': 'The six bands',
  'category.scaleDescription':
    'The European Air Quality Index runs from Good to Extremely poor. A location takes the band of its worst pollutant.',
  'category.bandNumber': 'Band {band} of 6',
  'category.worstPollutantRule':
    'The band shown is set by the worst single pollutant, not by an average.',
  'category.legendTitle': 'Key',
  'category.patternNote':
    'Each band also has its own texture, so the bands can be told apart without colour.',

  /* --- Band rail ---------------------------------------------------------
     Short forms exist for the scale axis only, where six labels share the
     width of the rail. Everywhere the band is stated as a fact rather than
     drawn as an axis, the full `category.*.label` is used. */

  'rail.scaleName': 'European Air Quality Index',
  'rail.reading': '{category}, {value} on a scale of 1 to 7',
  'rail.readingFor': '{station}: {category}, {value} on a scale of 1 to 7',
  'rail.noReading': 'No reading, so no position on the scale',
  'rail.noReadingFor': '{station}: no reading, so no position on the scale',
  'rail.short.good': 'Good',
  'rail.short.fair': 'Fair',
  'rail.short.moderate': 'Mod',
  'rail.short.poor': 'Poor',
  'rail.short.veryPoor': 'V.poor',
  'rail.short.extremelyPoor': 'Extreme',

  /* --- Freshness --------------------------------------------------------- */

  'freshness.fresh.label': 'Live',
  'freshness.fresh.description': 'Within the normal hourly publication cycle.',
  'freshness.fresh.tooltip': 'This reading arrived within the expected hourly update window.',

  'freshness.delayed.label': 'Delayed',
  'freshness.delayed.description': 'Later than the usual hourly update, but still recent.',
  'freshness.delayed.tooltip': 'The upstream feed is running behind. This is not a live reading.',

  'freshness.stale.label': 'Out of date',
  'freshness.stale.description': 'Too old to describe conditions right now.',
  'freshness.stale.tooltip':
    'This reading is several hours old. Conditions may have changed since it was measured.',

  'freshness.unavailable.label': 'Unavailable',
  'freshness.unavailable.description': 'No usable reading, or its age cannot be established.',
  'freshness.unavailable.tooltip':
    'We could not obtain a current reading. Nothing here should be taken as an all-clear.',

  'freshness.ageLabel': 'Age of reading',
  'freshness.measuredAt': 'Measured at {time}',
  'freshness.retrievedAt': 'Retrieved at {time}',
  /* Standalone prefixes, for markup that puts the timestamp in its own <time>. */
  'freshness.measuredAtLabel': 'Measured at',
  'freshness.retrievedAtLabel': 'Retrieved at',
  'freshness.nextExpected': 'Next expected around {time}',
  'freshness.cadenceNote':
    'The upstream feed publishes hourly, typically about an hour after the measurement hour.',
  'freshness.notLive': 'Not live',
  'freshness.cachedNotice': 'Served from our cache because the upstream feed did not answer.',
  'freshness.degradedReason': 'Reason: {reason}',

  /* --- Time and units ---------------------------------------------------- */

  'time.justNow': 'Just now',
  'time.lessThanAnHour': 'Less than an hour old',
  'time.hourAgo': '1 hour old',
  'time.hoursAgo': '{count} hours old',
  'time.dayAgo': '1 day old',
  'time.daysAgo': '{count} days old',
  'time.inLessThanAnHour': 'In under an hour',
  'time.inAnHour': 'In about an hour',
  'time.inHours': 'In about {count} hours',
  'time.ageUnknown': 'Age unknown',
  'time.maltaTime': 'Malta time',
  'time.timezoneNote': 'All times are shown in Malta time.',
  'time.today': 'Today',
  'time.tomorrow': 'Tomorrow',
  'time.yesterday': 'Yesterday',

  'unit.microgramsPerCubicMetre': 'µg/m³',
  'unit.microgramsPerCubicMetreLong': 'micrograms per cubic metre',
  'unit.metres': 'm',
  'unit.kilometres': 'km',
  'unit.hours': 'h',
  'unit.hourly': 'Hourly',

  /* --- Pollutants -------------------------------------------------------- */
  /* description / sources / healthEffects keys are referenced by src/config/pollutants.ts. */

  'pollutant.pm25.name': 'Fine particulate matter',
  'pollutant.pm25.description':
    'Airborne particles smaller than 2.5 micrometres across — roughly thirty times finer than a human hair. They stay suspended for hours and are small enough to be breathed deep into the lungs.',
  'pollutant.pm25.sources':
    'Vehicle exhaust and brake wear, construction and quarrying dust, domestic and agricultural burning, and shipping. Saharan dust reaching Malta lifts levels for short spells.',
  'pollutant.pm25.healthEffects':
    'Short-lived rises are associated with irritated airways, coughing and worsening asthma. Sustained long-term exposure is associated with heart and lung conditions. At the levels usually recorded in Malta most people notice nothing.',

  'pollutant.pm10.name': 'Coarse particulate matter',
  'pollutant.pm10.description':
    'Airborne particles up to 10 micrometres across, including road dust, pollen and sea salt. The nose and throat filter out more of these than of finer particles.',
  'pollutant.pm10.sources':
    'Road and construction dust, quarrying, agriculture and sea spray, together with long-range Saharan dust episodes, which are a recurring feature of the Maltese climate.',
  'pollutant.pm10.healthEffects':
    'Raised levels can irritate the eyes, nose and throat and can aggravate asthma or bronchitis. Effects are usually short-lived and ease as levels fall.',

  'pollutant.no2.name': 'Nitrogen dioxide',
  'pollutant.no2.description':
    'A reddish-brown gas formed when fuel burns at high temperature. Concentrations are highest beside busy roads and drop away sharply within tens of metres.',
  'pollutant.no2.sources':
    'Road traffic, particularly diesel engines; shipping in harbour; power generation; and some industrial processes.',
  'pollutant.no2.healthEffects':
    'Raised levels can inflame the airways and make asthma symptoms more likely. People who live, work or travel beside heavy traffic have the greatest exposure.',

  'pollutant.o3.name': 'Ozone',
  'pollutant.o3.description':
    'Ozone is not emitted directly. It forms in the air when sunlight reacts with other pollutants, so it peaks on hot sunny afternoons and is often higher in rural areas than in town.',
  'pollutant.o3.sources':
    'Formed from nitrogen oxides and volatile organic compounds under strong sunlight. Ozone also drifts to Malta from mainland Europe.',
  'pollutant.o3.healthEffects':
    'Higher ozone can cause throat irritation, coughing and reduced lung function during exercise. Symptoms typically ease as levels fall in the evening.',

  'pollutant.so2.name': 'Sulphur dioxide',
  'pollutant.so2.description':
    'A sharp-smelling gas produced when fuels containing sulphur are burnt. In Malta it is normally low and appears in short episodes.',
  'pollutant.so2.sources':
    'Shipping and port activity, industrial combustion, and occasionally volcanic emissions carried across from Sicily.',
  'pollutant.so2.healthEffects':
    'Brief exposure to higher levels can tighten the airways, most noticeably in people with asthma. Levels recorded in Malta are usually far below that range.',

  'pollutant.sectionTitle': 'Pollutants',
  'pollutant.selectorLabel': 'Pollutant',
  'pollutant.allPollutants': 'All pollutants',
  'pollutant.whatIsIt': 'What it is',
  'pollutant.whereFrom': 'Where it comes from',
  'pollutant.healthEffects': 'Health effects',
  'pollutant.averagingPeriod': 'Averaging period',
  'pollutant.notMeasuredHere': 'Not measured at this station',
  'pollutant.noValue': 'No value for this hour',
  'pollutant.noValueHint':
    'The instrument reported nothing usable. This is not the same as a reading of zero.',
  'pollutant.modelledLabel': 'Estimated',
  'pollutant.modelledExplain':
    'This value was modelled rather than measured, because the instrument did not report for this hour.',
  'pollutant.measuredLabel': 'Measured',
  'pollutant.dominantBadge': 'Leading pollutant',
  'pollutant.bandFor': '{pollutant} is {category}',

  /* --- Thresholds and comparisons ---------------------------------------- */

  'threshold.sectionTitle': 'How this compares',
  'threshold.euLimit': 'EU limit value',
  'threshold.whoGuideline': 'WHO guideline',
  'threshold.value': '{value} {unit} over {period}',
  'threshold.above': 'Above the {reference} of {threshold} {unit}',
  'threshold.below': 'Below the {reference} of {threshold} {unit}',
  'threshold.inconclusive':
    'This limit applies to an average over {period}, so a single hourly reading cannot show whether it has been breached.',
  'threshold.conclusiveExceedance':
    'This is a one-hour threshold intended for immediate public information, and the current reading is above it.',
  'threshold.legalNote':
    'EU limit values describe legal compliance over long averaging periods. The index bands above are for communication and are a different thing entirely.',
  'threshold.whoNote': 'WHO guidelines are health-based guidance, not law.',
  'threshold.reference': 'Reference: {reference}',

  /* --- Health guidance --------------------------------------------------- */
  /* Scheme: health.<categoryCamel>.general | .sensitive, plus health.group.<group>.{label,advice}. */

  'health.sectionTitle': 'What this means for you',
  'health.forEveryone': 'For most people',
  'health.forSensitiveGroups': 'If you are more sensitive',
  'health.currentAdvice': 'Advice for the current band',
  'health.noAdvice': 'Without a reading we cannot offer advice for right now.',

  'health.good.general': 'Air quality poses little or no risk. Outdoor activity is fine.',
  'health.good.sensitive': 'Enjoy your usual outdoor activity.',

  'health.fair.general': 'Outdoor activity remains fine for the general population.',
  'health.fair.sensitive':
    'A small number of unusually sensitive people may notice mild symptoms during long outdoor exertion.',

  'health.moderate.general': 'Most people can carry on as normal.',
  'health.moderate.sensitive':
    'Consider shortening or easing intense outdoor exertion if you notice symptoms such as coughing or breathlessness.',

  'health.poor.general':
    'Consider reducing strenuous outdoor exertion, especially over long periods.',
  'health.poor.sensitive':
    'Reduce intense outdoor activity. Keep any reliever medication you normally use with you.',

  'health.veryPoor.general': 'Reduce strenuous outdoor exertion and shorten time spent outdoors.',
  'health.veryPoor.sensitive':
    'Avoid intense outdoor activity. If symptoms appear, move indoors and follow the plan agreed with your clinician.',

  'health.extremelyPoor.general': 'Avoid strenuous outdoor exertion and limit time outdoors.',
  'health.extremelyPoor.sensitive':
    'Stay indoors where you can, keep exertion low, and seek medical advice if symptoms are severe or unusual for you.',

  'health.noData.general':
    'No reading is available, so no advice can be given for the current hour.',
  'health.noData.sensitive':
    'Fall back on how you normally manage your condition, and on official guidance if any has been issued.',

  'health.group.children.label': 'Children',
  'health.group.children.advice':
    'Children breathe more air for their size and spend more time active outdoors, so they take in relatively more of whatever is in the air.',
  'health.group.older.label': 'Older adults',
  'health.group.older.advice':
    'Existing heart or lung conditions become more common with age, and these are what air pollution tends to aggravate.',
  'health.group.pregnant.label': 'People who are pregnant',
  'health.group.pregnant.advice':
    'Reducing avoidable exposure during raised episodes is a reasonable precaution.',
  'health.group.asthma.label': 'People with asthma',
  'health.group.asthma.advice':
    'Raised particles, nitrogen dioxide and ozone can all trigger symptoms. Keep reliever medication to hand on poor-air days.',
  'health.group.respiratory.label': 'People with lung conditions',
  'health.group.respiratory.advice':
    'COPD, bronchitis and similar conditions can flare when levels rise. Plan outdoor activity for cleaner hours where possible.',
  'health.group.heart.label': 'People with heart conditions',
  'health.group.heart.advice':
    'Fine particles are the pollutant most closely linked with cardiovascular effects during raised episodes.',
  'health.group.outdoorWorkers.label': 'People who work outdoors',
  'health.group.outdoorWorkers.advice':
    'Long shifts outdoors mean higher cumulative exposure than a short trip. Take breaks indoors when levels are raised.',
  'health.group.athletes.label': 'People exercising hard outdoors',
  'health.group.athletes.advice':
    'Hard exercise draws more air deeper into the lungs and often through the mouth, bypassing the nose. Consider rescheduling intense sessions when levels are raised.',

  'health.generalGuidance':
    'Advice here is general and precautionary. Air quality is one factor among many, and staying active remains beneficial.',
  'health.emergencyNote':
    'If you have severe or sudden symptoms, seek medical help rather than relying on this page.',

  /* --- Forecast ---------------------------------------------------------- */

  'forecast.sectionTitle': 'Next 48 hours',
  'forecast.description':
    'Modelled estimates from the Copernicus atmosphere service, carried in the same feed.',
  'forecast.estimateBadge': 'Forecast',
  'forecast.notObservation': 'Forecast values are model output, not measurements.',
  'forecast.observedLabel': 'Observed',
  'forecast.forecastLabel': 'Forecast',
  'forecast.nowMarker': 'Now',
  'forecast.boundaryNote': 'Everything to the right of this line is forecast.',
  'forecast.peakExpected': 'Highest band expected {time}',
  'forecast.noForecast': 'No forecast is available for this station.',
  'forecast.horizon': 'Covers roughly the next two days.',
  'forecast.selectPollutant': 'Forecast pollutant',
  'forecast.show': 'Show forecast',
  'forecast.hide': 'Hide forecast',
  'forecast.chartTitle': '{pollutant} at {station}',
  'forecast.chartAria':
    'Line chart of {pollutant} at {station}, observed values followed by forecast values.',
  'forecast.axisTime': 'Time (Malta)',
  'forecast.axisConcentration': 'Concentration ({unit})',
  'forecast.historyTitle': 'Last ten days',
  'forecast.historyDescription':
    'Hourly values as published, including hours the feed filled in by modelling.',
  'forecast.gapFilledNote':
    'Some past hours are modelled too: the feed fills gaps when an instrument does not report. Those points are marked as estimated.',

  /* --- Context widget ---------------------------------------------------- */

  'context.sectionTitle': 'Reading the situation',
  'context.summaryHeading': 'In short',
  'context.unavailable': 'No summary is available right now.',
  'context.generatedAt': 'Prepared at {time}',
  'context.trendRising': 'Levels have been rising over the last few hours.',
  'context.trendFalling': 'Levels have been falling over the last few hours.',
  'context.trendSteady': 'Levels have been broadly steady over the last few hours.',
  'context.trendUnknown': 'There are too few recent readings to describe a trend.',
  'context.compareYesterday': 'Compared with the same hour yesterday: {change}.',
  'context.changeHigher': 'higher',
  'context.changeLower': 'lower',
  'context.changeSimilar': 'about the same',
  'context.saharanDust':
    'Raised coarse particles across several stations at once often indicate Saharan dust.',
  'context.ozoneAfternoon': 'Ozone commonly peaks in the afternoon and falls back after sunset.',
  'context.trafficPeak':
    'Traffic-sited stations tend to peak during the morning and evening commutes.',
  'context.weatherUnavailable': 'Weather context is not available at the moment.',
  'context.windLabel': 'Wind',
  'context.temperatureLabel': 'Temperature',
  'context.humidityLabel': 'Humidity',

  /* --- AI explanation ---------------------------------------------------- */

  'ai.sectionTitle': 'Explain this reading',
  'ai.explain': 'Explain in plain language',
  'ai.explaining': 'Preparing an explanation',
  'ai.regenerate': 'Ask again',
  'ai.unavailable': 'Explanations are not available right now.',
  'ai.unavailableHint':
    'Every number on this page is calculated by the application itself and is unaffected.',
  'ai.rateLimited':
    'You have asked for several explanations in a short time. Please try again shortly.',
  'ai.error': 'The explanation could not be prepared.',
  'ai.generatedNotice': 'Written by an AI assistant from the readings shown on this page.',
  'ai.doesNotCompute':
    'The assistant never calculates index values, thresholds or times. It only puts the figures already shown into words.',
  'ai.notMedical': 'Explanations are general information, not medical advice.',
  'ai.feedbackPrompt': 'Was this helpful?',
  'ai.feedbackYes': 'Yes',
  'ai.feedbackNo': 'No',
  'ai.feedbackThanks': 'Thank you — that helps.',
  'ai.askPlaceholder': 'Ask about this reading',
  'ai.send': 'Send',

  /* --- Alerts ------------------------------------------------------------ */

  'alerts.sectionTitle': 'Air-quality alerts',
  'alerts.description': 'Get an email when a station you follow reaches a band you care about.',
  'alerts.emailLabel': 'Email address',
  'alerts.emailPlaceholder': 'you@example.com',
  'alerts.stationLabel': 'Station',
  'alerts.stationAll': 'Any station',
  'alerts.thresholdLabel': 'Alert me from',
  'alerts.thresholdHelp': 'You will be emailed when the band reaches this level or worse.',
  'alerts.frequencyLabel': 'How often',
  'alerts.frequencyImmediate': 'As soon as it happens',
  'alerts.frequencyDaily': 'At most once a day',
  'alerts.consentLabel': 'Email me air-quality alerts. I can unsubscribe at any time.',
  'alerts.submit': 'Set up alerts',
  'alerts.submitting': 'Setting up',
  'alerts.success': 'Almost done — check your inbox.',
  'alerts.successHint': 'We have sent a confirmation link. Alerts start once you confirm.',
  'alerts.alreadySubscribed': 'That address is already set up for these alerts.',
  'alerts.invalidEmail': 'Enter a valid email address.',
  'alerts.consentRequired': 'Please confirm you would like to receive these emails.',
  'alerts.error': 'Your alert could not be set up. Please try again.',
  'alerts.unavailable': 'Alerts are not enabled on this deployment.',
  'alerts.unsubscribe': 'Unsubscribe',
  'alerts.unsubscribeSuccess': 'You have been unsubscribed. No further alerts will be sent.',
  'alerts.unsubscribeError': 'That unsubscribe link is not valid or has already been used.',
  'alerts.confirmSuccess': 'Confirmed. Your alerts are active.',
  'alerts.confirmError': 'That confirmation link is not valid or has expired.',
  'alerts.privacyNote': 'We store your address only to send the alerts you asked for.',
  'alerts.notEmergency':
    'Alerts are informational and are not an official public-health warning service.',

  /* --- Errors and empty states ------------------------------------------- */

  'errors.generic.title': 'Something went wrong',
  'errors.generic.description': 'We could not complete that. Trying again often works.',
  'errors.notFound.title': 'Page not found',
  'errors.notFound.description': 'That address does not match anything on maqua.app.',
  'errors.stationNotFound.title': 'Station not found',
  'errors.stationNotFound.description':
    'There are five monitoring stations in Malta and Gozo. Choose one below.',
  'errors.pollutantNotFound.title': 'Pollutant not recognised',
  'errors.pollutantNotFound.description':
    'Choose one of the five pollutants reported by the network.',
  'errors.upstream.title': 'Readings are unavailable',
  'errors.upstream.description':
    'The upstream feed did not answer. We are not showing a value rather than showing one we cannot stand behind.',
  'errors.rateLimited.title': 'Too many requests',
  'errors.rateLimited.description': 'Please wait a moment and try again.',
  'errors.validation.title': 'Check that request',
  'errors.validation.description': 'One of the values in that request was not valid.',
  'errors.dataUnavailable': 'Data unavailable',
  'errors.dataUnavailableHint':
    'An absent reading tells us nothing about air quality — it is not an all-clear.',
  'errors.tryAgain': 'Try again',
  'errors.reload': 'Reload the page',
  'errors.goHome': 'Back to the home page',
  'errors.reportProblem': 'Report a problem',
  'errors.details': 'Technical detail',

  /* --- Offline ----------------------------------------------------------- */

  'offline.title': 'You appear to be offline',
  'offline.description': 'Readings cannot be refreshed until the connection returns.',
  'offline.cachedNotice': 'Showing the last readings loaded on this device, measured at {time}.',
  'offline.retry': 'Try again',
  'offline.backOnline': 'You are back online. Refreshing.',

  /* --- Footer, attribution and legal ------------------------------------- */

  /**
   * VERBATIM. Required by the upstream terms of use — do not reword, shorten or
   * split this string.
   */
  'footer.attribution':
    "Air-quality data provided by Malta's Environment and Resources Authority (ERA), disseminated via the European Environment Agency (EEA). maqua.app is an independent project and is not operated by, affiliated with, or endorsed by ERA or the EEA.",
  'footer.dataSourceHeading': 'Data source',
  'footer.dataSourceLink': 'How the data is obtained',
  'footer.methodologyLink': 'How the index is calculated',
  'footer.aboutLink': 'About maqua.app',
  'footer.privacyLink': 'Privacy',
  'footer.contactLink': 'Contact',
  'footer.sourceCodeLink': 'Source code',
  'footer.copyright': '© {year} maqua.app',
  'footer.independent': 'An independent, non-commercial project.',
  'footer.lastUpdated': 'Readings last updated {time}',
  'footer.builtWith': 'Built with open data.',

  /**
   * VERBATIM. Required wherever health guidance appears — do not reword.
   */
  'disclaimer.medical':
    'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.',
  'disclaimer.provisional':
    'Near-real-time readings are provisional. ERA validates data after publication, and figures may be revised.',
  'disclaimer.notOfficial':
    'This is not an official ERA or EEA service. For official statements, consult ERA directly.',
  'disclaimer.emergency': 'In an emergency, follow official instructions rather than this page.',

  /* --- Methodology and about --------------------------------------------- */

  'methodology.title': 'How the index is calculated',
  'methodology.indexHeading': 'The European Air Quality Index',
  'methodology.indexBody':
    'Each pollutant concentration is rounded to the nearest whole microgram per cubic metre and matched against the published band ranges. The location takes the band of its worst pollutant.',
  'methodology.subIndexHeading': 'Sub-index',
  'methodology.subIndexBody':
    'Within a band we also report a continuous position, so that a value near the top of Moderate can be told apart from one that has only just entered it.',
  'methodology.aggregationHeading': 'Malta-wide summary',
  'methodology.aggregationBody':
    'The summary reports the worst reporting station rather than an average, so a single poor location is never masked by good ones.',
  'methodology.missingDataHeading': 'Missing values',
  'methodology.missingDataBody':
    'A missing value is shown as unavailable and never as zero. Bands are calculated only from pollutants that actually reported.',
  'methodology.forecastHeading': 'Forecasts and gap filling',
  'methodology.forecastBody':
    'The feed carries modelled values for future hours and also fills some past gaps by modelling. Both are labelled as estimates, using the flag the feed itself provides rather than the clock.',
  'methodology.limitsHeading': 'Limits and guidelines',
  'methodology.limitsBody':
    'EU limit values and WHO guidelines mostly apply to daily or annual averages. We show them for context and say plainly when a single hourly reading cannot settle the question.',
  'methodology.verificationHeading': 'Verification',
  'methodology.verificationBody':
    'The band calculation was checked against 6,760 published concentration and index pairs from the five Malta stations, with no mismatches.',

  'about.title': 'About maqua.app',
  'about.whatHeading': 'What this is',
  'about.whatBody':
    'A public-service view of Malta and Gozo air quality, built on the official monitoring network and published openly.',
  'about.whoHeading': 'Who runs it',
  'about.whoBody':
    'An independent project. It is not operated by, affiliated with, or endorsed by ERA or the EEA.',
  'about.dataHeading': 'Where the data comes from',
  'about.dataBody':
    'ERA operates the five monitoring stations. Malta reports the measurements to the European Environment Agency, which republishes them hourly. We read that published feed.',
  'about.limitationsHeading': 'Known limitations',
  'about.limitationsBody':
    'Readings are provisional, one station can stand for a wide area, and coverage gaps happen. Where we are uncertain, we say so instead of filling the gap.',
  'about.contactHeading': 'Contact',

  /* --- Frequently asked questions ---------------------------------------- */

  'faq.title': 'Questions',
  'faq.whyDifferent.q': 'Why does another app show a different number?',
  'faq.whyDifferent.a':
    'Different services use different indices, averaging periods and sources. We publish the European Air Quality Index on hourly values, and show exactly which hour each figure belongs to.',
  'faq.howOften.q': 'How often does this update?',
  'faq.howOften.a':
    'Hourly. The measurement hour is typically published about an hour later, so a reading up to two hours old is normal operation.',
  'faq.zeroMeaning.q': 'Why do I see "not available" instead of a number?',
  'faq.zeroMeaning.a':
    'Because the instrument reported nothing usable for that hour. Showing zero would be a measurement claim we cannot make.',
  'faq.stationCoverage.q': 'There is no station near me. What can I use?',
  'faq.stationCoverage.a':
    'Five stations cover Malta and Gozo. Background stations describe general conditions in their area; a traffic station describes the roadside, which is usually the higher end of local exposure.',
  'faq.legalLimits.q': 'Does a high reading mean the legal limit has been broken?',
  'faq.legalLimits.a':
    'Usually not. Most EU limits apply to daily or annual averages, and several permit a number of exceedances per year, so one hour cannot settle it. We say so wherever the comparison is inconclusive.',
} satisfies Record<string, string>;

/* -------------------------------------------------------------------------- */
/*  Public surface                                                            */
/* -------------------------------------------------------------------------- */

export const dictionaries = { en } as const;

export type Dictionary = typeof dictionaries.en;

export type DictionaryKey = keyof Dictionary;

/**
 * Resolve a locale to its dictionary.
 *
 * Unknown or not-yet-translated locales fall back to English rather than
 * throwing: a partially translated build must still render.
 */
export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  const table: Partial<Record<Locale, Dictionary>> = dictionaries;
  return table[locale] ?? dictionaries.en;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Placeholders take the form `{name}`. */
const INTERPOLATION_PATTERN = /\{(\w+)\}/g;

/**
 * Look up a key and substitute any `{placeholders}`.
 *
 * A missing key returns the key itself. That is deliberate: it never throws, it
 * never renders the string "undefined" to a member of the public, and the key is
 * self-describing enough to be spotted immediately in review. A placeholder with
 * no matching variable is likewise left intact rather than blanked.
 *
 * `key` is typed as `string`, not `DictionaryKey`, because the config files pass
 * keys they hold as plain strings (`CATEGORY_PRESENTATION.Good.labelKey`).
 */
export function t(dict: Dictionary, key: string, vars?: Record<string, string | number>): string {
  const template = (dict as Record<string, string | undefined>)[key];
  if (typeof template !== 'string') return key;
  if (!vars) return template;

  return template.replace(INTERPOLATION_PATTERN, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** True when a key exists in the given dictionary. Useful for optional copy. */
export function hasKey(dict: Dictionary, key: string): boolean {
  return typeof (dict as Record<string, string | undefined>)[key] === 'string';
}

/* -------------------------------------------------------------------------- */
/*  Category key helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Category value → key segment.
 *
 * The category VALUES contain a space and a lower-case second word
 * (`'Very poor'`), while the KEYS are camelCase (`category.veryPoor.label`).
 * Deriving one from the other by string manipulation is exactly the sort of
 * thing that silently produces `category.very poor.label`, so the mapping is
 * written out and type-checked against the category union instead.
 */
export const CATEGORY_KEY_SEGMENT: Record<AirQualityCategory, string> = {
  Good: 'good',
  Fair: 'fair',
  Moderate: 'moderate',
  Poor: 'poor',
  'Very poor': 'veryPoor',
  'Extremely poor': 'extremelyPoor',
};

/** Key segment used when there is no category at all. */
export const NO_DATA_KEY_SEGMENT = 'noData';

export function categorySegment(category: AirQualityCategory | null | undefined): string {
  return category ? CATEGORY_KEY_SEGMENT[category] : NO_DATA_KEY_SEGMENT;
}

export function categoryLabelKey(category: AirQualityCategory | null | undefined): string {
  return `category.${categorySegment(category)}.label`;
}

export function categoryShortAdviceKey(category: AirQualityCategory | null | undefined): string {
  return `category.${categorySegment(category)}.shortAdvice`;
}

export function categoryDescriptionKey(category: AirQualityCategory | null | undefined): string {
  return `category.${categorySegment(category)}.description`;
}

/** `health.<segment>.general` / `health.<segment>.sensitive`. */
export function categoryHealthKey(
  category: AirQualityCategory | null | undefined,
  audience: 'general' | 'sensitive',
): string {
  return `health.${categorySegment(category)}.${audience}`;
}

/** Sensitive groups that have `health.group.<id>.label` / `.advice` copy. */
export const SENSITIVE_GROUPS = [
  'children',
  'older',
  'pregnant',
  'asthma',
  'respiratory',
  'heart',
  'outdoorWorkers',
  'athletes',
] as const;

export type SensitiveGroup = (typeof SENSITIVE_GROUPS)[number];

export function sensitiveGroupLabelKey(group: SensitiveGroup): string {
  return `health.group.${group}.label`;
}

export function sensitiveGroupAdviceKey(group: SensitiveGroup): string {
  return `health.group.${group}.advice`;
}
