import Anthropic from "@anthropic-ai/sdk";
import { defineSecret } from "firebase-functions/params";
import { CatalogSource, CultureReview, CultureType } from "./types";

export const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// Single place to change the model (e.g. "claude-sonnet-5" to cut cost).
export const CULTURE_MODEL = "claude-opus-5";
const MAX_CONTINUATIONS = 3;

export function createCultureClient(): Anthropic {
  return new Anthropic({ apiKey: anthropicApiKey.value(), timeout: 5 * 60 * 1000 });
}

/**
 * One structured-output request with server tools. Server tools can end a turn
 * with `pause_turn`; resume by re-sending the assistant content (no extra user
 * message). Returns the parsed JSON from the final text block.
 */
async function runJsonTask(
  client: Anthropic,
  opts: { system: string; prompt: string; tools: Anthropic.Beta.BetaToolUnion[]; schema: Record<string, unknown> },
): Promise<unknown> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const res = await client.beta.messages.create({
      model: CULTURE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      tools: opts.tools,
      output_config: { effort: "medium", format: { type: "json_schema", schema: opts.schema } },
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "refusal") throw new Error(`Claude refused: ${JSON.stringify(res.stop_details)}`);
    if (res.stop_reason === "max_tokens") throw new Error("Claude output truncated (max_tokens)");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return JSON.parse(text);
  }
  throw new Error(`Claude still paused after ${MAX_CONTINUATIONS} continuations`);
}

const SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
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

export async function scanSource(client: Anthropic, source: CatalogSource, todayStr: string, endStr: string): Promise<unknown> {
  const host = new URL(source.url).hostname.replace(/^www\./, "");
  const prompt = [
    `Site: ${source.name}`,
    `Start page: ${source.url}`,
    `Today (Asia/Jerusalem): ${todayStr}`,
    `Allowed regions for "region": ${source.regions.join(", ")}`,
    "",
    `Fetch the start page, and at most 3 further pages on the same site if needed to reach the events / shows / movies listing.`,
    `Return every event with a performance or screening between ${todayStr} and ${endStr} inclusive.`,
    `- dates: live shows as "YYYY-MM-DDTHH:mm" (local time); cinemas as "YYYY-MM-DD" per screening day, no times. At most 30 dates per event.`,
    `- region: one of the allowed regions, based on the branch / city of the performance.`,
    `- url: the event's own page on this site if shown, otherwise the listing page.`,
    `- description: one short sentence in Hebrew, or "" if unknown.`,
    `If the listing cannot be read, return {"events": []}.`,
  ].join("\n");

  return runJsonTask(client, {
    system: SCAN_SYSTEM,
    prompt,
    schema: SCAN_SCHEMA,
    tools: [
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, allowed_domains: [host], max_content_tokens: 40000 },
      { type: "web_search_20260209", name: "web_search", max_uses: 2, allowed_domains: [host] },
    ],
  });
}

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "score", "summary", "outlet"],
  properties: {
    found: { type: "boolean" },
    score: { type: "string", enum: ["positive", "mixed", "negative"] },
    summary: { type: "string" },
    outlet: { type: "string" },
  },
};

export async function lookupReview(
  client: Anthropic, ev: { title: string; category: CultureType; venue: string },
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
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 },
    ],
  })) as { found: boolean; score: CultureReview["score"]; summary: string; outlet: string };

  if (!out.found || !out.summary) return null;
  return { score: out.score, summary: out.summary.slice(0, 300), outlet: out.outlet.slice(0, 100) };
}
