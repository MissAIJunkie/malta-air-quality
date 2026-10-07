/**
 * Per-station editorial profiles.
 *
 * ## Why this exists
 *
 * The five station pages were 65–88% textually identical with chrome excluded,
 * because they were one template over five sets of numbers. This is the half of
 * the fix that cannot be computed: what a monitor's siting means, and what
 * question that particular station is good for answering. The other half is
 * `src/lib/air-quality/diurnal.ts`, which derives each station's daily shape
 * from its own measurements.
 *
 * ## What may be written here
 *
 * Only what follows from the station record in `src/config/stations.ts` — its
 * `stationType`, `areaClassification`, `altitudeMetres`, island, and the
 * pollutants it is known to report — plus general air-quality reasoning about
 * what those classifications imply.
 *
 * Do NOT add specifics that cannot be sourced from this repository: named
 * roads or junctions, traffic volumes, nearby businesses or industrial sites,
 * distances to anything, population figures. The station records carry a
 * classification and a coordinate, not a street survey, and inventing the
 * street survey to make a page feel local is precisely the kind of
 * authoritative-sounding filler this site exists not to publish.
 *
 * Every claim below is checkable against the station record beside it.
 */

export type StationProfile = {
  /** One sentence: what this station is for. Used as the section lead. */
  lead: string;
  /** What the siting classification means in practice, here. Paragraphs. */
  siting: string[];
  /** The question this station answers better than the other four. */
  bestFor: string;
  /**
   * What this station cannot tell you — coverage gaps, missing pollutants, or
   * the limits of its classification.
   */
  limits: string[];
};

export const STATION_PROFILES: Record<string, StationProfile> = {
  msida: {
    lead: 'One of the network’s two roadside monitors, and the lowest-lying of the five: Msida is where Maltese kerbside air is measured.',
    siting: [
      'Msida is classified as a Traffic station in an Urban area — one of two such sites in the network. A Traffic classification is a deliberate choice about where the instrument goes: it is placed where exposure is high, close to the source, rather than somewhere that represents the general air of the surrounding area. Its readings are supposed to be worse than the islands at large, and when they are, the station is working as designed.',
      'At 2 metres above sea level it is also the lowest station in the network by a wide margin — Għarb, the highest, sits 112 metres above it. What the station record supports is the elevation itself; how much that affects dispersion here is not something five monitors and a coordinate can settle, so this page does not claim it.',
      'Msida is the one station that does not report ozone. Why is not recorded anywhere this site can see — the registry notes only that no ozone has been observed from it. It is worth knowing that fresh nitric oxide from vehicle exhaust destroys ozone locally, which would give a roadside site less ozone to measure; but St Paul’s Bay is also a Traffic site and does report ozone, so that is a mechanism worth mentioning and not an explanation anyone here can stand behind.',
    ],
    bestFor:
      'What the air is like beside a busy Maltese road — the exposure of someone walking, cycling, waiting or living at the kerbside, rather than the general urban background.',
    limits: [
      'A Traffic reading is not an estimate of the islands’ air quality, and reading it as one overstates the problem. When Msida is worse than Attard or Żejtun, that gap is the traffic contribution, not a measurement disagreement.',
      'Ozone is not measured here at all. For an ozone question, the Background and rural stations are the ones to look at.',
      'Nitrogen dioxide falls away sharply within tens of metres of a road, so even within Msida this figure describes the monitor’s immediate surroundings rather than the locality as a whole.',
    ],
  },

  'st-pauls-bay': {
    lead: 'The network’s second Traffic station, and the only roadside site that reports all five pollutants — the most complete picture of kerbside air on the islands.',
    siting: [
      'St Paul’s Bay is the other Traffic site in an Urban area, so like Msida it is sited for exposure rather than for representativeness. Having two Traffic stations rather than one matters more than it sounds: a single roadside monitor cannot be distinguished from a local peculiarity, while two in different parts of Malta can be compared.',
      'It sits 7 metres above sea level. That is close to Msida’s 2 metres and far below Attard’s 86, so the two Traffic sites are also the two lowest — which is worth knowing when comparing them against the Background stations, since siting classification and elevation are not independent in this network.',
      'Three of the five stations report every one of the index pollutants, and this is the only Traffic site among them — Għarb and Żejtun are the other two, and both are Background. So for a kerbside question this is the one station where the index is never set by default because a pollutant was not measured.',
    ],
    bestFor:
      'A roadside reading that can be compared against another roadside reading, and the only kerbside site where all five pollutants are available at once.',
    limits: [
      'As a Traffic site it describes kerbside exposure, not the general air of the area. The Background stations answer that question.',
      'A complete set of pollutants is not the same as a complete picture of Malta: this is still one monitor at one coordinate.',
    ],
  },

  attard: {
    lead: 'An inland urban Background station, well above sea level — the closest thing the network has to ordinary residential air away from a main road.',
    siting: [
      'Attard is classified as a Background station in an Urban area. A Background site is deliberately placed away from any single dominant source, so that what it measures is the general air of the surrounding area rather than the exhaust of whatever is immediately beside it. That is the opposite design intent from Msida, and the two are not rival estimates of one number.',
      'At 86 metres above sea level it is the highest station on the island of Malta itself, and inland. Elevation and distance from the coast both matter: a higher inland site is less affected by sea spray than a coastal one, so its coarse-particle figure carries less salt and is a somewhat cleaner signal of what is actually being emitted or transported.',
      'Attard does not report sulphur dioxide. It is the only station in the network that does not, so for sulphur dioxide this is the one site that has nothing to say.',
    ],
    bestFor:
      'Urban background air inland — a reasonable reference for what people away from a main road are breathing, and a useful comparison against the Traffic stations.',
    limits: [
      'Sulphur dioxide is not measured here. An absent value is the instrument not reporting, not clean air, and this site renders it as unavailable rather than as zero.',
      'A Background reading will usually be better than a roadside one, and that is not reassurance about the kerbside — it is a different question being answered.',
    ],
  },

  zejtun: {
    lead: 'An urban Background station in the south-east, reporting all five pollutants from a mid-elevation inland site.',
    siting: [
      'Żejtun is a Background station in an Urban area, so like Attard it is sited to describe the general air of its surroundings rather than the output of one nearby source. Two urban Background stations in different parts of Malta is what makes it possible to tell a local effect from an island-wide one — if both move together, the cause is regional.',
      'It sits 56 metres above sea level, between coastal Msida and St Paul’s Bay and the higher inland position of Attard. That middling elevation makes it a useful middle term: neither as exposed to sea spray as the coastal sites nor as removed from it as the highest ones.',
      'It reports all five index pollutants, which — with Għarb and St Paul’s Bay — makes it one of three stations where the index is computed from the complete set rather than from whatever happened to be available.',
    ],
    bestFor:
      'Urban background air in the south-east of Malta, with every pollutant available, and a second Background reference to compare against Attard.',
    limits: [
      'Being a Background site, it will understate kerbside exposure. Someone beside a main road in Żejtun is breathing something closer to the Msida figure.',
      'One monitor cannot describe a locality. The nearest station may be several kilometres and several road types from where you actually are.',
    ],
  },

  gharb: {
    lead: 'The only station on Gozo, the only rural site in the network, and the highest — which makes it the closest thing Malta has to a regional baseline.',
    siting: [
      'Għarb is the network’s only Rural-Regional station, and that classification makes it the most analytically useful site of the five. A rural regional monitor is sited to measure the air of a region rather than of a settlement or a street, so what it records is substantially what the air mass over the islands is carrying.',
      'At 114 metres above sea level it is also the highest station, and on Gozo it is far from the heaviest traffic on Malta. Both help: elevation and distance from local sources mean comparatively little of what it measures was emitted nearby.',
      'This is what makes it the key station for recognising a regional episode. When coarse particles rise at Għarb as much as at the urban sites, the cause is an air mass over the islands — Saharan dust, most often — and not the road outside any of them. No other station in the network can make that distinction, because no other station is far enough from local sources.',
      'It is also the only station on Gozo at all, and it is one of the three that report all five pollutants. Ozone in particular is worth watching here: away from the traffic that destroys it locally, a rural site is where the regional photochemical signal shows up most clearly, and often where the highest ozone figure on the islands is found.',
    ],
    bestFor:
      'The regional background — what the air arriving over the islands is carrying, independent of any local source. It is the reference against which every other station should be read.',
    limits: [
      'It is one station for the whole of Gozo. Wherever you are on the island, the nearest monitor may be several kilometres away and in a quite different setting.',
      'A rural baseline understates what anyone in a town or beside a road is breathing. It is a reference point, not a description of exposure.',
      'Being the only Gozo site, there is nothing to compare it against on the same island — a local effect at Għarb cannot be separated from a Gozo-wide one.',
    ],
  },
};
