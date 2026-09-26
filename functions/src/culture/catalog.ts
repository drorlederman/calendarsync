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
  { id: "cinema-city",      name: "סינמה סיטי",              url: "https://www.cinema-city.co.il/",  type: "cinema",  regions: ["sharon", "center", "jerusalem", "haifa-north"] },
  { id: "yes-planet",       name: "פלאנט"   ,                url: "https://www.planetcinema.co.il/",    type: "cinema",  regions: ["center", "jerusalem", "haifa-north", "south"] },
  { id: "lev-cinema",       name: "קולנוע לב",               url: "https://www.lev.co.il/",          type: "cinema",  regions: ["tel-aviv", "center"] },
  { id: "tlv-cinematheque", name: "סינמטק תל אביב",          url: "https://www.cinema.co.il/",       type: "cinema",  regions: ["tel-aviv"] },
  { id: "jlm-cinematheque", name: "סינמטק ירושלים",          url: "https://www.jer-cin.org.il/",     type: "cinema",  regions: ["jerusalem"] },
];
