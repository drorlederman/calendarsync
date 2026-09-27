import { CatalogSource } from "./types";

// Managed catalog. Synced into Firestore `cultureSources` at the start of every
// nightly scan (see scan.ts). To add/remove a site: edit this list and deploy.
// Removing an entry disables it (enabled:false) rather than deleting history.
export const CULTURE_CATALOG: CatalogSource[] = [
  // Zappa timed out from the dev machine (Eventim CDN) — kept; first live scan decides.
  { id: "zappa",            name: "זאפה",                    url: "https://www.zappa-club.co.il/",   type: "music",   regions: ["tel-aviv", "sharon", "jerusalem", "haifa-north"] },
  { id: "tzavta",           name: "צוותא",                   url: "https://www.tzavta.co.il/",       type: "venue",   regions: ["tel-aviv"] },
  { id: "barby",            name: "בארבי",                   url: "https://www.barby.co.il/",        type: "music",   regions: ["tel-aviv"] },
  { id: "habima",           name: "הבימה",                   url: "https://www.habima.co.il/",       type: "theater", regions: ["tel-aviv"] },
  { id: "cameri",           name: "הקאמרי",                  url: "https://www.cameri.co.il/",       type: "theater", regions: ["tel-aviv"] },
  { id: "gesher",           name: "תיאטרון גשר",             url: "https://www.gesher-theatre.co.il/", type: "theater", regions: ["tel-aviv"] },
  { id: "beit-lessin",      name: "בית ליסין",               url: "https://www.lessin.co.il/",       type: "theater", regions: ["tel-aviv"] },
  { id: "khan",             name: "תיאטרון החאן",            url: "https://www.khan.co.il/",         type: "theater", regions: ["jerusalem"] },
  { id: "haifa-theatre",    name: "תיאטרון חיפה",            url: "https://www.ht1.co.il/",          type: "theater", regions: ["haifa-north"] },
  { id: "beer-sheva-theatre", name: "תיאטרון באר שבע",       url: "https://www.b7t.co.il/",          type: "theater", regions: ["south"] },
  // Cinema City: one entry per branch, read via the site JSON adapter (cinemaCity.ts).
  { id: "cinema-city-glilot", name: "סינמה סיטי גלילות", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["sharon"], adapter: { kind: "cinema-city", theatreId: 1170, city: "גלילות" } },
  { id: "cinema-city-rishon", name: "סינמה סיטי ראשון לציון", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["center"], adapter: { kind: "cinema-city", theatreId: 1173, city: "ראשון לציון" } },
  { id: "cinema-city-jerusalem", name: "סינמה סיטי ירושלים", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["jerusalem"], adapter: { kind: "cinema-city", theatreId: 1174, city: "ירושלים" } },
  { id: "cinema-city-kfar-saba", name: "סינמה סיטי כפר סבא", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["sharon"], adapter: { kind: "cinema-city", theatreId: 1175, city: "כפר סבא" } },
  { id: "cinema-city-netanya", name: "סינמה סיטי נתניה", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["sharon"], adapter: { kind: "cinema-city", theatreId: 1176, city: "נתניה" } },
  { id: "cinema-city-hadera", name: "סינמה סיטי חדרה", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["sharon"], adapter: { kind: "cinema-city", theatreId: 1350, city: "חדרה" } },
  { id: "cinema-city-beer-sheva", name: "סינמה סיטי באר שבע", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["south"], adapter: { kind: "cinema-city", theatreId: 1178, city: "באר שבע" } },
  { id: "cinema-city-ashdod", name: "סינמה סיטי אשדוד", url: "https://www.cinema-city.co.il/", type: "cinema", regions: ["south"], adapter: { kind: "cinema-city", theatreId: 1181, city: "אשדוד" } },
  { id: "yes-planet",       name: "פלאנט"   ,                url: "https://www.planetcinema.co.il/",    type: "cinema",  regions: ["center", "jerusalem", "haifa-north", "south"] },
  { id: "lev-cinema",       name: "קולנוע לב",               url: "https://www.lev.co.il/",          type: "cinema",  regions: ["tel-aviv", "center"] },
  { id: "tlv-cinematheque", name: "סינמטק תל אביב",          url: "https://www.cinema.co.il/",       type: "cinema",  regions: ["tel-aviv"] },
  { id: "jlm-cinematheque", name: "סינמטק ירושלים",          url: "https://www.jer-cin.org.il/",     type: "cinema",  regions: ["jerusalem"] },
];
