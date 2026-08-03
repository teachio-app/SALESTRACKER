// ─────────────────────────────────────────────────────────────
// Which country is this venue in?
//
// The `location` field is free text and always has been: emails give
// "Mercedes-Benz Stadium, Atlanta", "King Baudouin Stadium, Brussels, BE" or a
// bare "San Siro", and hand-typed rows give "Praha", "USA", "Cardiff - UK" or
// "Strawberry arena - stockholm myslim". There is no country column to read.
//
// So it's resolved in order of how much the string actually TELLS us:
//
//   1. an explicit country — a name ("Belgium", "USA") or a trailing ISO code;
//   2. a city we know;
//   3. a venue we know.
//
// And when none of those hit, it returns null and the alert simply omits the
// country. A wrong flag on a sale alert is worse than no flag: it would be
// believed. Nothing here guesses from a substring or a language.
// ─────────────────────────────────────────────────────────────

export type Country = { code: string; name: string; flag: string };

/** 🇧🇪 from "BE" — regional indicators, so no flag table to maintain. */
function flagOf(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Display names. Mostly the plain English name; GB and US get the short forms
// people actually write.
const NAMES: Record<string, string> = {
  US: "USA", CA: "Canada", MX: "Mexico", GB: "UK", IE: "Ireland",
  ES: "Spain", PT: "Portugal", FR: "France", BE: "Belgium", NL: "Netherlands",
  DE: "Germany", AT: "Austria", CH: "Switzerland", IT: "Italy", PL: "Poland",
  CZ: "Czechia", SK: "Slovakia", HU: "Hungary", RO: "Romania", BG: "Bulgaria",
  GR: "Greece", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
  TR: "Turkey", HR: "Croatia", RS: "Serbia", SI: "Slovenia", UA: "Ukraine",
};

// Names as they turn up in the wild, including the Czech ones the owner types.
const BY_NAME: Record<string, string> = {
  usa: "US", "united states": "US", "united states of america": "US", america: "US", spojene0staty: "US",
  canada: "CA", kanada: "CA",
  mexico: "MX", mexiko: "MX",
  uk: "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB", britain: "GB", anglie: "GB",
  ireland: "IE", irsko: "IE",
  spain: "ES", spanelsko: "ES", espana: "ES",
  portugal: "PT", portugalsko: "PT",
  france: "FR", francie: "FR",
  belgium: "BE", belgie: "BE", belgique: "BE",
  netherlands: "NL", holland: "NL", nizozemi: "NL", nizozemsko: "NL",
  germany: "DE", nemecko: "DE", deutschland: "DE",
  austria: "AT", rakousko: "AT", osterreich: "AT",
  switzerland: "CH", svycarsko: "CH",
  italy: "IT", italie: "IT", italia: "IT",
  poland: "PL", polsko: "PL", polska: "PL",
  czechia: "CZ", "czech republic": "CZ", cesko: "CZ", ceska0republika: "CZ",
  slovakia: "SK", slovensko: "SK",
  hungary: "HU", madarsko: "HU",
  romania: "RO", rumunsko: "RO",
  bulgaria: "BG", greece: "GR", recko: "GR",
  sweden: "SE", svedsko: "SE", norway: "NO", norsko: "NO",
  denmark: "DK", dansko: "DK", finland: "FI", finsko: "FI",
  turkey: "TR", turecko: "TR", croatia: "HR", chorvatsko: "HR",
  serbia: "RS", srbsko: "RS", slovenia: "SI", slovinsko: "SI", ukraine: "UA",
};

// Cities, in the spelling the mails and the owner use (diacritics are stripped
// before lookup, so "Bukurešť" arrives as "bukurest").
const BY_CITY: Record<string, string> = {
  atlanta: "US", miami: "US", "los angeles": "US", "new york": "US", "east rutherford": "US",
  dallas: "US", arlington: "US", houston: "US", "kansas city": "US", philadelphia: "US",
  seattle: "US", "san francisco": "US", "santa clara": "US", boston: "US", foxborough: "US",
  inglewood: "US", pomona: "US", "las vegas": "US", chicago: "US", orlando: "US", austin: "US",
  toronto: "CA", vancouver: "CA",
  "mexico city": "MX", "ciudad de mexico": "MX", guadalajara: "MX", monterrey: "MX",
  london: "GB", cardiff: "GB", manchester: "GB", birmingham: "GB", glasgow: "GB",
  edinburgh: "GB", liverpool: "GB", leeds: "GB", wembley: "GB",
  dublin: "IE",
  madrid: "ES", barcelona: "ES", sevilla: "ES", seville: "ES", valencia: "ES", bilbao: "ES",
  lisbon: "PT", lisboa: "PT", porto: "PT",
  paris: "FR", lyon: "FR", marseille: "FR", nice: "FR", lille: "FR",
  brussels: "BE", bruxelles: "BE", brussel: "BE", antwerp: "BE", antwerpen: "BE",
  amsterdam: "NL", rotterdam: "NL", arnhem: "NL", eindhoven: "NL",
  berlin: "DE", munich: "DE", munchen: "DE", cologne: "DE", koln: "DE", dusseldorf: "DE",
  frankfurt: "DE", hamburg: "DE", stuttgart: "DE", gelsenkirchen: "DE", dortmund: "DE",
  leipzig: "DE", hannover: "DE", "wolfsburg": "DE",
  vienna: "AT", wien: "AT", salzburg: "AT", klagenfurt: "AT",
  zurich: "CH", geneva: "CH", geneve: "CH", bern: "CH", basel: "CH",
  milan: "IT", milano: "IT", rome: "IT", roma: "IT", turin: "IT", torino: "IT",
  naples: "IT", napoli: "IT", bologna: "IT", florence: "IT", firenze: "IT",
  // "chorsow" is a misspelling that exists in this book — kept deliberately,
  // as an alias next to the correct form, not folded into some fuzzy matcher.
  warsaw: "PL", warszawa: "PL", krakow: "PL", chorzow: "PL", chorsow: "PL", gdansk: "PL",
  poznan: "PL", wroclaw: "PL", katowice: "PL",
  prague: "CZ", praha: "CZ", brno: "CZ", ostrava: "CZ",
  bratislava: "SK", budapest: "HU",
  bucharest: "RO", bucuresti: "RO", bukurest: "RO",
  stockholm: "SE", solna: "SE", gothenburg: "SE", goteborg: "SE",
  oslo: "NO", copenhagen: "DK", kobenhavn: "DK", helsinki: "FI",
  athens: "GR", istanbul: "TR", zagreb: "HR", split: "HR", belgrade: "RS", beograd: "RS",
};

// Venues that turn up WITHOUT a city — "San Siro" on its own says nothing to the
// city table. Only unambiguous ones: "O2 Arena" is deliberately absent, because
// there is one in London and one in Prague.
const BY_VENUE: Record<string, string> = {
  "san siro": "IT", "giuseppe meazza": "IT", "allianz stadium": "IT", "stadio olimpico": "IT",
  "hard rock stadium": "US", "mercedes-benz stadium": "US", "sofi stadium": "US",
  "metlife stadium": "US", "levi's stadium": "US", "lumen field": "US", "gillette stadium": "US",
  "arrowhead": "US", "at&t stadium": "US", "nrg stadium": "US", "lincoln financial field": "US",
  "intuit dome": "US", "fairgrounds cricket stadium": "US", "rose bowl": "US",
  "bmo field": "CA", "bc place": "CA",
  "estadio azteca": "MX", "estadio akron": "MX", "estadio bbva": "MX",
  wembley: "GB", "principality stadium": "GB", "tottenham hotspur stadium": "GB",
  "emirates stadium": "GB", "old trafford": "GB", "anfield": "GB", "murrayfield": "GB",
  "estadio metropolitano": "ES", "santiago bernabeu": "ES", "camp nou": "ES", "montjuic": "ES",
  "king baudouin": "BE", "koning boudewijn": "BE",
  "johan cruijff": "NL", "philips stadion": "NL",
  "merkur spiel": "DE", "allianz arena": "DE", "olympiastadion": "DE", "veltins": "DE",
  "signal iduna": "DE", "deutsche bank park": "DE", "esprit arena": "DE",
  "stade de france": "FR", "parc des princes": "FR", "groupama stadium": "FR",
  "strawberry arena": "SE", "friends arena": "SE", "avicii arena": "SE",
  "national stadium": "PL", "stadion narodowy": "PL", "stadion slaski": "PL",
  "letnany": "CZ", "eden arena": "CZ", "sinobo": "CZ",
  "ernst happel": "AT", "puskas arena": "HU", "johan cruyff": "NL",
};

// Valid US state codes, so "POMONA, CA 91768" resolves to the USA. A bare
// trailing "CA" is left to the ISO path (where it means Canada) — the ZIP is
// what distinguishes a US address from a country code.
const US_STATES = new Set(
  ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY " +
   "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" ")
);

/** Lower-case, strip diacritics, squeeze spaces — "Bukurešť" → "bukurest". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function make(code: string): Country {
  return { code, name: NAMES[code] ?? code, flag: flagOf(code) };
}

/** Does this string name a country, a city or a venue we recognise? */
export function venueCountry(location: string | null | undefined): Country | null {
  if (!location) return null;
  const raw = location.trim();
  const s = fold(raw);
  if (!s) return null;

  // 1a — a US address: "…, POMONA, CA 91768".
  const usState = raw.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/);
  if (usState && US_STATES.has(usState[1])) return make("US");

  // 1b — a country named outright, as a whole segment. Segment-wise, not
  // substring: "Manchester" must not match on "chester", and a venue called
  // "America First Field" must not turn into the USA.
  const segments = s.split(/\s*[,\-–—|/]\s*|\s{2,}/).map((x) => x.trim()).filter(Boolean);
  for (const seg of segments) {
    const hit = BY_NAME[seg];
    if (hit) return make(hit);
  }

  // 1c — a trailing ISO country code: "King Baudouin Stadium, Brussels, BE".
  const iso = raw.match(/[,\-]\s*([A-Za-z]{2})\s*$/);
  if (iso) {
    const code = iso[1].toUpperCase();
    if (NAMES[code]) return make(code);
  }

  // 2 — a city. Whole segments first (the reliable form), then anywhere in the
  // string for the messy hand-typed ones ("Strawberry arena - stockholm myslim").
  for (const seg of segments) {
    const hit = BY_CITY[seg];
    if (hit) return make(hit);
  }
  for (const [city, code] of Object.entries(BY_CITY)) {
    if (new RegExp(`(^|[^a-z])${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(s)) {
      return make(code);
    }
  }

  // 3 — a venue we know by name.
  for (const [venue, code] of Object.entries(BY_VENUE)) {
    if (s.includes(venue)) return make(code);
  }

  return null;
}

/**
 * The venue as it should read in an alert: the location, plus the country when
 * we could work it out. When the location IS the country ("USA", "Belgium"),
 * the flag goes in front instead of repeating the word.
 */
export function venueWithCountry(location: string | null | undefined): string | null {
  const raw = location?.trim();
  if (!raw) return null;
  const c = venueCountry(raw);
  if (!c) return raw;
  const s = fold(raw);
  const namesItself = s === fold(c.name) || BY_NAME[s] === c.code;
  return namesItself ? `${c.flag} ${raw}` : `${raw} · ${c.flag} ${c.name}`;
}
