import { GoogleGenAI } from "@google/genai";
import { defineSecret } from "firebase-functions/params";
import { CatalogSource, CultureReview, CultureType } from "./types";

export const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Single place to change the model (e.g. "gemini-3.5-flash-lite" to cut cost).
// Structured output combined with built-in tools requires a Gemini 3 model.
export const CULTURE_MODEL = "gemini-3.8-flash";

export type CultureAiClient = GoogleGenAI;

export function createCultureClient(): CultureAiClient {
  return new GoogleGenAI({ apiKey: geminiApiKey.value() });
}

/**
 * One structured-output interaction with Gemini's built-in URL context and
 * Google Search tools. Returns the parsed JSON (validated later by the caller).
 */
async function runJsonTask(
  client: CultureAiClient,
  opts: { system: string; prompt: string; schema: Record<string, unknown> },
): Promise<unknown> {
  const interaction = await client.interactions.create({
    model: CULTURE_MODEL,
    system_instruction: opts.system,
    input: opts.prompt,
    tools: [{ type: "url_context" }, { type: "google_search" }],
    response_format: { type: "text", mime_type: "application/json", schema: opts.schema },
  });
  const text = interaction.output_text;
  if (!text) throw new Error(`Gemini returned no text (status=${interaction.status})`);
  return JSON.parse(text);
}

const SCAN_SCHEMA = {
  type: "object",
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "venue", "city", "region", "dates", "url", "description"],
        properties: {
          title: { type: "string" },
          venue: { type: "string" },
          city: { type: "string" },
          region: { type: "string" },
          dates: { type: "array", items: { type: "string" } },
          url: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
};

const SCAN_SYSTEM =
  "You extract upcoming cultural events from an Israeli venue or ticketing website. " +
  "Report only what the site itself lists; never invent events, dates or links. " +
  "Keep titles exactly as shown on the site (usually Hebrew).";

export async function scanSource(
  client: CultureAiClient, source: CatalogSource, todayStr: string, endStr: string,
): Promise<unknown> {
  const host = new URL(source.url).hostname.replace(/^www\./, "");
  const prompt = [
    `Site: ${source.name}`,
    `Start page: ${source.url}`,
    `Today (Asia/Jerusalem): ${todayStr}`,
    `Allowed regions for "region": ${source.regions.join(", ")}`,
    "",
    `Read the start page, and at most 3 further pages on ${host} if needed to reach the events / shows / movies listing.`,
    `Use only pages on ${host} as the source of events (search only to locate listing pages on that site).`,
    `Return every event with a performance or screening between ${todayStr} and ${endStr} inclusive.`,
    `- dates: live shows as "YYYY-MM-DDTHH:mm" (local time); cinemas as "YYYY-MM-DD" per screening day, no times. At most 30 dates per event.`,
    `- region: one of the allowed regions, based on the branch / city of the performance.`,
    `- url: the event's own page on this site if shown, otherwise the listing page.`,
    `- description: one short sentence in Hebrew, or "" if unknown.`,
    `If the listing cannot be read, return {"events": []}.`,
  ].join("\n");

  return runJsonTask(client, { system: SCAN_SYSTEM, prompt, schema: SCAN_SCHEMA });
}

const REVIEW_SCHEMA = {
  type: "object",
  required: ["found", "score", "summary", "outlet"],
  properties: {
    found: { type: "boolean" },
    score: { type: "string", enum: ["positive", "mixed", "negative"] },
    summary: { type: "string" },
    outlet: { type: "string" },
  },
};

export async function lookupReview(
  client: CultureAiClient, ev: { title: string; category: CultureType; venue: string },
): Promise<CultureReview | null> {
  const kind = ev.category === "cinema" ? "film" : "theater production";
  const prompt = [
    `Find professional critics' reviews of the ${kind} "${ev.title}"${ev.venue ? ` (${ev.venue})` : ""}, currently showing in Israel.`,
    "Prefer Israeli outlets (Haaretz, Ynet, Walla, Mako, Time Out Israel, Globes, Calcalist); for international films also Rotten Tomatoes or Metacritic.",
    `score: "positive" only if most reviews clearly recommend it; "mixed" if divided; "negative" otherwise.`,
    "summary: one Hebrew sentence with the critics' verdict. outlet: the main outlet(s), comma-separated.",
    `If you find no professional reviews, return found=false, score="mixed", summary="", outlet="".`,
  ].join("\n");

  const out = (await runJsonTask(client, {
    system: "You research critics' reviews of films and plays. Report only what published reviews actually say.",
    prompt,
    schema: REVIEW_SCHEMA,
  })) as { found: boolean; score: CultureReview["score"]; summary: string; outlet: string };

  if (!out.found || !out.summary) return null;
  return { score: out.score, summary: out.summary.slice(0, 300), outlet: out.outlet.slice(0, 100) };
}
