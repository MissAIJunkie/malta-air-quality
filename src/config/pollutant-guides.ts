/**
 * Editorial content for the per-pollutant guide pages.
 *
 * ## Why this is a config file and not prose inside the page
 *
 * `/pollutants/[slug]` renders one template for five pollutants. If the only
 * thing that varied between them were the numbers, the five pages would be five
 * copies of each other — which is the defect the guides exist to fix, not a way
 * to fix it. So everything genuinely specific to a pollutant lives here, in
 * prose, and the page is the frame around it.
 *
 * ## What may and may not be written here
 *
 * Every factual claim below is traceable to something already in this
 * repository or to the upstream data:
 *
 *  - band boundaries come from `AQI_BREAKPOINTS` at render time, never retyped;
 *  - legal limits and WHO guidelines come from `EU_LIMIT_VALUES` and
 *    `WHO_GUIDELINES`, with their own published references attached;
 *  - which stations measure a pollutant comes from `expectedPollutants` in
 *    `src/config/stations.ts`, and the site-type reasoning from `stationType`
 *    and `areaClassification` on the same records;
 *  - the short description, sources and health lines come from the dictionary
 *    (`pollutant.*.description` / `.sources` / `.healthEffects`), and the prose
 *    here expands on them rather than contradicting them.
 *
 * One deliberate exception, and its cost. The `reading` entries name band
 * ceilings in prose — "Good ends at 5 µg/m³" — because the point being made is
 * about the SHAPE of a pollutant's scale, and that cannot be made without the
 * numbers. Those figures are rendered from `AQI_BREAKPOINTS` in a table
 * directly beneath the prose on the same page, so a divergence is visible at a
 * glance rather than hidden. Legal limits are deliberately NOT named in prose:
 * Directive (EU) 2024/2881 tightens several of them from 2030, and a stale
 * number in a sentence about compliance is a worse error than a vague one.
 *
 * Do NOT add local colour that cannot be sourced — named roads, traffic counts,
 * industrial sites, fleet statistics, harbour throughput. A guide page that
 * invents specifics to sound authoritative is worse than a shorter one that
 * does not, and this site's whole claim on a reader's trust is that it does not
 * overstate what five monitors can support.
 */

import type { PollutantCode } from '@/config/pollutants';
import type { SensitiveGroup } from '@/lib/i18n';

export type PollutantGuide = {
  /** One sentence, used as the page lead and the meta description. */
  lead: string;
  /** Expands `pollutant.*.description`. Each entry is one paragraph. */
  what: string[];
  /** Expands `pollutant.*.sources`, for Malta specifically. */
  sources: string[];
  /**
   * Why this pollutant behaves the way it does across the islands — the part a
   * reader cannot get from a European index page.
   */
  inMalta: string[];
  /** Expands `pollutant.*.healthEffects`. */
  health: string[];
  /**
   * How to read this pollutant's own band scale. The numbers are rendered from
   * `AQI_BREAKPOINTS`; this explains what makes the scale's shape unusual.
   */
  reading: string[];
  /**
   * The sensitive groups most relevant to this pollutant, most relevant first.
   * Typed against the dictionary's own list so a renamed group breaks the build
   * rather than rendering a raw key to a reader.
   */
  watchFor: SensitiveGroup[];
};

export const POLLUTANT_GUIDES: Record<PollutantCode, PollutantGuide> = {
  'PM2.5': {
    lead: 'Fine particles are the pollutant with the clearest long-term health evidence behind it, and the one where Malta’s own number is usually unremarkable while the yearly average still matters.',
    what: [
      'PM2.5 means any airborne particle smaller than 2.5 micrometres across. That is a size class rather than a substance: a PM2.5 measurement counts sulphate from a ship’s funnel, soot from a diesel engine, and a fragment of Saharan clay in the same figure, because what the instrument weighs is mass per cubic metre, not chemistry.',
      'The size is the reason it is regulated separately from PM10. Particles this fine are not caught by the nose and throat. They reach the smallest airways and the gas-exchange surfaces of the lung, and the smallest of them cross into the bloodstream. A coarse dust particle makes you cough; a fine one does not announce itself at all.',
      'They also stay airborne for hours to days, which is why a fine-particle episode is regional rather than local. A PM2.5 figure at a background station tends to describe the air mass sitting over the islands, not the street the monitor stands on.',
    ],
    sources: [
      'Locally, the dominant contributors are combustion and wear: vehicle exhaust, brake and tyre wear, construction and quarrying, domestic and agricultural burning, and shipping. Combustion sources matter more for PM2.5 than for PM10 — burning makes fine particles, while grinding and abrasion make coarse ones.',
      'A substantial share of what is measured in Malta was not emitted in Malta. Fine particles travel, so continental European pollution and Saharan dust both register here. This is the normal condition for a small island in the central Mediterranean rather than an exceptional event.',
    ],
    inMalta: [
      'Two features make Malta unusual for PM2.5. The first is that there is no large distance between any monitor and the sea, so the air arriving at a station has often spent hours over water rather than over land, and it brings whatever the air mass was carrying.',
      'The second is dust. A Saharan intrusion raises PM10 far more than PM2.5, because desert dust is predominantly coarse — but it raises both. During an episode the fine-particle figure can sit well above its usual range while remaining a much smaller number than the coarse one, and attributing all of that rise to local traffic would be wrong.',
      'This is also why the yearly average is the figure to watch rather than any single hour. The long-term health evidence for fine particles is built on annual exposure, and an hourly reading in the Good band tells you nothing about whether the annual mean is where it should be.',
    ],
    health: [
      'For short exposures, raised fine particles are associated with irritated airways, coughing, and worse asthma control. Most people in Malta will notice nothing at the levels usually recorded, and that is an honest statement rather than a reassuring one: the absence of a symptom is not evidence of an absence of effect.',
      'The long-term evidence is where PM2.5 earns its attention. Sustained exposure is associated with cardiovascular and respiratory disease. The WHO’s annual guideline is far stricter than the EU’s legally binding limit, and the gap between those two numbers is a policy gap, not a measurement disagreement.',
    ],
    reading: [
      'The fine-particle scale is the tightest of the five. Good ends at 5 µg/m³ against 15 for PM10, so any figure at the top of PM10’s Good band is already Fair as PM2.5. The bands are not comparable across pollutants: 20 µg/m³ is Fair as PM10 and Moderate as PM2.5, which are genuinely different statements about the same air.',
      'Because the index takes the worst pollutant at a station, a modest fine-particle number is often what sets the band on a day when nothing else is elevated.',
    ],
    watchFor: ['asthma', 'respiratory', 'heart', 'older', 'children'],
  },

  PM10: {
    lead: 'Coarse particles are the pollutant Malta’s geography affects most: sea salt and Saharan dust both land in this figure, which is why a high PM10 hour here often has nothing to do with traffic.',
    what: [
      'PM10 counts every airborne particle up to 10 micrometres across — which includes all of PM2.5, since a fine particle is also smaller than 10 micrometres. The two figures are not independent, and PM10 is always the larger of the two at the same station and hour.',
      'The useful distinction is the coarse fraction: the part between 2.5 and 10 micrometres. That is the mechanically generated material — crushed, ground, abraded or lifted by wind — and it behaves differently from combustion particles. It is heavier, so it settles out within hours and kilometres rather than days and hundreds of kilometres.',
      'The nose and throat filter out much more of this size range than of fine particles, which is why coarse-particle effects are mostly upper-airway irritation rather than deep lung damage.',
    ],
    sources: [
      'Road and construction dust, quarrying, agriculture and sea spray are the standing local contributors, and all of them are mechanical rather than combustion processes. Resuspension matters too: particles already on the ground get lifted again by wind and passing vehicles, so a dry windy day can raise PM10 without any new emission at all.',
      'Sea salt is a genuine and unavoidable component on a small island. It is a natural source, it is not a pollutant in the usual sense, and it is nonetheless counted — the instrument weighs particles, and it cannot be asked to exclude the ones that came off a wave.',
    ],
    inMalta: [
      'Saharan dust is the single most important thing to understand about PM10 in Malta. Dust lifted from North Africa reaches the central Mediterranean several times a year, and during an intrusion the coarse-particle figure can rise far above anything local traffic produces. The islands sit directly in the path, so this is a recurring feature of the Maltese climate rather than an anomaly.',
      'Because dust arrives as a regional air mass, an intrusion raises PM10 at every station at once, including rural Għarb on Gozo. That is the signature worth learning: when the coarse figure is elevated at the background stations as much as at the traffic ones, the cause is almost certainly not the road outside.',
      'The practical consequence is that a high PM10 hour in Malta is ambiguous on its own. The same number can mean a dust episode, a windy day over a dry landscape, or genuinely dirty local air, and distinguishing them needs the pattern across stations rather than one reading.',
    ],
    health: [
      'Raised coarse particles can irritate the eyes, nose and throat, and can aggravate asthma or bronchitis. The effects are typically short-lived and ease as levels fall, which matches the fact that a dust episode is a matter of a day or two rather than a season.',
      'During a dust intrusion the sensible response is the ordinary one for a bad-air day: less strenuous outdoor exertion, particularly for people with asthma, and keeping windows shut on the windward side. None of that requires knowing the number to a microgram.',
    ],
    reading: [
      'The PM10 scale is much wider than the fine-particle one — Good ends at 15 µg/m³ and the Moderate band runs to 120 — because coarse-particle concentrations are routinely higher and the health evidence per microgram is weaker. The top of the scale reaches 1,200, which exists for dust events rather than for anything a city produces.',
      'Comparing a PM10 figure against a PM2.5 band, or against the limit for a different averaging period, is the most common way to misread this pollutant.',
    ],
    watchFor: ['asthma', 'respiratory', 'children', 'older', 'outdoorWorkers'],
  },

  NO2: {
    lead: 'Nitrogen dioxide is the most local of the five: it is made by engines, it falls away within tens of metres of a road, and which station you look at matters more than for anything else.',
    what: [
      'Nitrogen dioxide is a reddish-brown gas formed whenever fuel burns hot enough to make nitrogen and oxygen in ordinary air react with each other. It is therefore not a property of the fuel so much as of the temperature of the flame, which is why it comes out of well-maintained modern engines as well as badly maintained old ones.',
      'Its defining characteristic for anyone reading a monitor is how fast it disperses. Concentrations are highest within a few metres of the exhaust and drop sharply over tens of metres. A roadside figure and a figure from a park two streets away are both true and can differ by a factor of several.',
      'It is also chemically short-lived in sunlight, where it takes part in the reactions that make ozone. That relationship is the reason ozone and nitrogen dioxide often move in opposite directions across a day.',
    ],
    sources: [
      'Road traffic is the dominant source, and diesel engines disproportionately so. Shipping in harbour, power generation and some industrial combustion contribute as well.',
      'Because it is a combustion product that disperses quickly, the daily shape of a nitrogen dioxide series usually tracks traffic rather than weather — which makes it the pollutant where an hourly reading is most informative about what is happening right now, nearby.',
    ],
    inMalta: [
      'Malta’s monitoring network makes the siting question explicit. Two of the five stations — Msida and St Paul’s Bay — are classified as Traffic sites, and the other three as Background. For nitrogen dioxide that distinction is the single most important thing on the page: a Traffic station is deliberately placed where exposure is highest, and a Background station deliberately is not.',
      'So the two are not rival estimates of one number. A Traffic reading answers "what is it like beside a busy road", and a Background reading answers "what is the general level away from one". Reading across them as though they disagreed would be a mistake; reading the gap between them tells you how much of the local figure is traffic.',
      'Għarb, on Gozo, is the network’s only Rural-Regional site, and it is the closest thing available to a baseline for the islands. A nitrogen dioxide figure there that is as high as an urban one would be genuinely unusual, and would point at a regional air mass rather than local traffic.',
    ],
    health: [
      'Raised nitrogen dioxide can inflame the airways and make asthma symptoms more likely. People who live, work, cycle or walk beside heavy traffic have the greatest exposure, and the exposure is strongly determined by proximity rather than by the city-wide average.',
      'The practical implication is unusually actionable for an air pollutant: moving a route one street back from a main road meaningfully reduces exposure, in a way that is not true for ozone or for dust.',
    ],
    reading: [
      'The nitrogen dioxide band scale is the narrowest after fine particles — Good ends at 10 µg/m³, Fair at 25 — reflecting that it is a directly toxic gas rather than a mass of inert material.',
      'Note the gap between the index and the law. The hourly EU limit value — set out in full further down this page, read from the same table the application computes against — sits above the top of the Very poor band, and it permits a number of exceedances each year before the limit is breached at all. An hour near it is a serious index reading and still establishes nothing legally, and this site will not describe it as a breach.',
    ],
    watchFor: ['asthma', 'respiratory', 'children', 'outdoorWorkers', 'athletes'],
  },

  O3: {
    lead: 'Ozone is the one pollutant nobody emits. It is built in the air by sunlight, which is why it peaks on hot afternoons, is often worse in the countryside than in town, and is the pollutant Malta’s climate most reliably produces.',
    what: [
      'Ground-level ozone is a secondary pollutant: there is no ozone source to regulate, because nothing emits it. It forms when sunlight drives reactions between nitrogen oxides and volatile organic compounds already in the air. Sunlight is the ingredient in shortest supply elsewhere in Europe and in abundant supply here.',
      'That photochemical origin gives it a daily shape unlike any of the others. It builds through the morning, peaks in the afternoon when sunlight has been working longest, and falls away in the evening. A morning reading tells you comparatively little about what the afternoon will bring.',
      'It is also destroyed by fresh nitric oxide from vehicle exhaust, which produces a result that surprises people: ozone is frequently lower beside a busy road than in a quiet rural area downwind of one. Traffic suppresses ozone locally while supplying the ingredients that make it elsewhere.',
    ],
    sources: [
      'Formed from nitrogen oxides and volatile organic compounds under strong sunlight, from a mixture of local and continental precursors. Ozone and its ingredients also drift to Malta from mainland Europe, so an episode here can be the product of emissions hundreds of kilometres away.',
      'There is nothing to switch off locally that would reliably lower an ozone peak within a day, which is what makes it a harder pollutant to manage than nitrogen dioxide.',
    ],
    inMalta: [
      'Malta has the sunlight and the summer temperatures that ozone formation needs, so the islands see their highest ozone on hot, still, bright afternoons — typically late spring through summer. This is the pollutant where the season matters most.',
      'The network reflects the chemistry in a way worth noticing: Msida, one of the two Traffic sites, is the only station that does not report ozone at all. The suppression effect above would explain that — but it is one case and not a rule, because St Paul’s Bay is the other Traffic site and does measure ozone. The registry records only that no ozone has been observed from Msida, not why.',
      'Għarb matters especially here. A rural site on Gozo, away from the traffic that would destroy ozone locally, is exactly where the regional photochemical signal shows up most clearly — and often where the highest figure on the islands is found.',
    ],
    health: [
      'Higher ozone can cause throat irritation, coughing and measurably reduced lung function during exercise. Symptoms typically ease as levels fall in the evening.',
      'Ozone is unusual in that exertion is the main risk multiplier: the dose depends on how hard you are breathing. The useful response is to move strenuous outdoor exercise to the morning or evening on a hot bright day, rather than to avoid being outdoors at all.',
    ],
    reading: [
      'The ozone scale is shaped quite differently from the others. Good extends all the way to 60 µg/m³ — far higher than for any other pollutant — because low background ozone is normal everywhere, while the upper bands are compressed: Moderate ends at 120 and Very poor at 180. Most of the scale’s resolution sits in a narrow range, so a modest-looking rise can move the band.',
      'The EU figures for ozone are also structured unlike the rest: a target value on the maximum daily eight-hour mean rather than an hourly limit, plus information and alert thresholds that do apply to a single hour. Only the latter can be judged from one reading.',
    ],
    watchFor: ['athletes', 'asthma', 'respiratory', 'children', 'outdoorWorkers'],
  },

  SO2: {
    lead: 'Sulphur dioxide is normally the quietest of the five in Malta — low for long stretches, then briefly not. It is the pollutant where an episode means more than an average.',
    what: [
      'Sulphur dioxide is a sharp-smelling gas produced when fuel containing sulphur is burnt. Unlike nitrogen dioxide, it is a property of the fuel rather than of the flame temperature, so it responds directly to what is being burnt — which is why fuel sulphur regulation has driven it down across Europe over decades.',
      'It dissolves readily in water, which is why it is absorbed in the upper airways rather than reaching deep into the lung — the opposite of fine particles, and the reason its effects appear as airway tightening rather than as long-term cardiovascular risk.',
      'Its behaviour is episodic rather than cyclical. Where nitrogen dioxide follows traffic and ozone follows the sun, sulphur dioxide tends to sit near the bottom of its scale and then spike when a specific source is upwind.',
    ],
    sources: [
      'Shipping and port activity, industrial combustion, and occasionally volcanic emissions carried across from Sicily. The volcanic contribution is a real and locally specific source: Malta is close enough to Etna that its plume can reach the islands when the wind is in the right quarter.',
      'The episodic character follows from that list. Each of these is either intermittent or dependent on wind direction, so the figure is governed by whether a source happens to be upwind rather than by a daily rhythm.',
    ],
    inMalta: [
      'Levels recorded in Malta are usually far below the range where health effects are expected, and the honest summary of the standing situation is that sulphur dioxide is not currently a routine concern on the islands.',
      'What makes it worth a page anyway is that the average is the wrong statistic for it. A pollutant that is near zero for weeks and then briefly elevated has an unremarkable mean and a meaningful maximum, so the figure to look at is the peak during an episode.',
      'Coverage is also incomplete, and visibly so. Attard has been observed to report no sulphur dioxide at all across a sustained sampling window, so four of the five stations carry this pollutant. An absent value there is the instrument not reporting, not clean air — and this site renders it as unavailable rather than as zero, because zero is a measurement claim and a missing reading is the absence of one.',
    ],
    health: [
      'Brief exposure to higher levels can tighten the airways, most noticeably in people with asthma, for whom the response can be rapid. Levels recorded in Malta are usually far below that range.',
      'Because the effect is fast and concentrated in one group, the relevant guidance is narrower than for the other pollutants: during an episode, people with asthma should have reliever medication to hand and avoid strenuous outdoor exertion. For everyone else, a Maltese sulphur dioxide reading is rarely something to act on.',
    ],
    reading: [
      'The sulphur dioxide scale is comparatively wide at the bottom — Good to 20 µg/m³, Fair to 40 — and the Moderate band jumps to 125, which is a large step. A reading moving from Fair to Moderate therefore represents a bigger absolute change than the same band move would for nitrogen dioxide.',
      'The EU limits are stricter in structure than the index suggests, and both are set out in full further down this page: an hourly limit that permits a substantial number of exceedances a year, and a daily limit that permits very few. Neither can be settled by one hour, and the daily one cannot be assessed from an hourly series at all.',
    ],
    watchFor: ['asthma', 'respiratory', 'children'],
  },
};
