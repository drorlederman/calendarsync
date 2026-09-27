import axios from "axios";
import { CultureRegion } from "./types";

// Cinema City renders its listings client-side, so an AI page read sees an
// empty template. The site's own (undocumented) JSON endpoints return the same
// data directly; this adapter reads them and emits the same `{ events: [...] }`
// shape the AI scanner returns, so validateScanResult and the rest of the
// pipeline are unchanged. If Cinema City changes these endpoints, the nightly
// scan log shows it as an error or 0 events for the branch.
const BASE = "https://www.cinema-city.co.il";
const UA = "Mozilla/5.0 (compatible; CalendarSync culture scan)";

export interface CinemaCityBranch {
  theatreId: number; // TixTheatreId
  branchName: string;
  city: string;
  region: CultureRegion;
}

interface CcShowing { Date?: unknown }
interface CcEvent { Name?: unknown; ExportCode?: unknown; Dates?: unknown }
interface CcMovie { ExportCode?: unknown; MovieId?: unknown }

/** "30/09/2026 10:30" → "2026-09-30" (screening day; cinemas store day-only dates). */
export function ccDateToLocalDay(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseCinemaCityEvents(events: unknown, movies: unknown, branch: CinemaCityBranch) {
  const movieIdByExport = new Map<number, number>();
  if (Array.isArray(movies)) {
    for (const m of movies as CcMovie[]) {
      if (typeof m.ExportCode === "number" && typeof m.MovieId === "number") movieIdByExport.set(m.ExportCode, m.MovieId);
    }
  }
  const out: Array<{ title: string; venue: string; city: string; region: string; dates: string[]; url: string; description: string }> = [];
  if (!Array.isArray(events)) return { events: out };

  for (const e of events as CcEvent[]) {
    if (typeof e.Name !== "string" || !e.Name.trim() || !Array.isArray(e.Dates)) continue;
    const days = [...new Set((e.Dates as CcShowing[])
      .map((d) => (typeof d.Date === "string" ? ccDateToLocalDay(d.Date) : null))
      .filter((d): d is string => d !== null))].sort();
    if (days.length === 0) continue;
    const movieId = typeof e.ExportCode === "number" ? movieIdByExport.get(e.ExportCode) : undefined;
    out.push({
      title: e.Name.trim(),
      venue: branch.branchName,
      city: branch.city,
      region: branch.region,
      dates: days,
      url: movieId ? `${BASE}/movie/${movieId}` : `${BASE}/`,
      description: "",
    });
  }
  return { events: out };
}

export async function scanCinemaCity(branch: CinemaCityBranch): Promise<unknown> {
  const get = (path: string, params: Record<string, string | number>) =>
    axios.get(`${BASE}${path}`, { params, headers: { "User-Agent": UA }, timeout: 30000 }).then((r) => r.data);
  const [events, movies] = await Promise.all([
    // VenueTypeId=0 returns every hall type (regular, VIP, Prime, ...) for the branch.
    get("/tickets/Events", { TheatreId: branch.theatreId, VenueTypeId: 0, MovieId: 0, Date: "" }),
    get("/tickets/Movies", { TheatreId: 0 }),
  ]);
  if (!Array.isArray(events)) throw new Error(`Cinema City /tickets/Events returned non-array for theatre ${branch.theatreId}`);
  return parseCinemaCityEvents(events, movies, branch);
}
