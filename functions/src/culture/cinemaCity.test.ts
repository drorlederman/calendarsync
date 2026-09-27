import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCinemaCityEvents, ccDateToLocalDay } from "./cinemaCity";

const BRANCH = { theatreId: 1173, branchName: "סינמה סיטי ראשל\"צ", city: "ראשון לציון", region: "center" as const };

// Shapes copied from the live /tickets/Events and /tickets/Movies responses.
const EVENTS = [
  {
    Name: "G Kids - האי הנעלם-מדובב", Pic: "x.jpeg", EventId: null, ExportCode: 693,
    Dates: [
      { Date: "30/09/2026 10:30", Day: "יום רביעי 30/09/2026", Hour: "10:30", EventId: "860558", TheaterId: 1173 },
      { Date: "30/09/2026 17:00", Day: "יום רביעי 30/09/2026", Hour: "17:00", EventId: "860559", TheaterId: 1173 },
      { Date: "01/10/2026 10:30", Day: "יום חמישי 01/10/2026", Hour: "10:30", EventId: "860560", TheaterId: 1173 },
    ],
  },
  { Name: "סרט בלי הקרנות", Pic: "", EventId: null, ExportCode: 700, Dates: [] },
  { Name: "סרט לא ידוע", Pic: "", EventId: null, ExportCode: 999, Dates: [{ Date: "02/10/2026 20:00" }] },
];
const MOVIES = [
  { Name: "G Kids - האי הנעלם-מדובב", ExportCode: 693, MovieId: 6327 },
  { Name: "סרט בלי הקרנות", ExportCode: 700, MovieId: 6400 },
];

test("ccDateToLocalDay converts DD/MM/YYYY HH:mm to YYYY-MM-DD", () => {
  assert.equal(ccDateToLocalDay("30/09/2026 10:30"), "2026-09-30");
  assert.equal(ccDateToLocalDay("garbage"), null);
});

test("parseCinemaCityEvents builds one event per movie with unique screening days", () => {
  const out = parseCinemaCityEvents(EVENTS, MOVIES, BRANCH);
  assert.equal(out.events.length, 2); // movie without screenings dropped
  const first = out.events[0];
  assert.equal(first.title, "G Kids - האי הנעלם-מדובב");
  assert.equal(first.venue, "סינמה סיטי ראשל\"צ");
  assert.equal(first.city, "ראשון לציון");
  assert.equal(first.region, "center");
  assert.deepEqual(first.dates, ["2026-09-30", "2026-10-01"]);
  assert.equal(first.url, "https://www.cinema-city.co.il/movie/6327");
});

test("parseCinemaCityEvents falls back to the site url when the movie id is unknown", () => {
  const out = parseCinemaCityEvents(EVENTS, MOVIES, BRANCH);
  assert.equal(out.events[1].url, "https://www.cinema-city.co.il/");
});

test("parseCinemaCityEvents tolerates non-array input", () => {
  assert.deepEqual(parseCinemaCityEvents(null, null, BRANCH), { events: [] });
});
