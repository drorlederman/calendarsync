import type { calendar_v3 } from "googleapis";
import { JoinType } from "../types";

export interface GraphEvent {
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  id?: string;
  isAllDay?: boolean;
  organizer?: { emailAddress?: { address?: string } };
  isCancelled?: boolean;
}

export interface JoinInfo {
  joinUrl: string | null;
  joinType: JoinType;
}

const LINK_PATTERN = /https?:\/\/(?:[\w-]+\.)?(zoom\.us|meet\.google\.com|teams\.microsoft\.com)\/\S+/i;

function classify(url: string): JoinType {
  if (/zoom\.us/i.test(url)) return "zoom";
  if (/meet\.google\.com/i.test(url)) return "meet";
  if (/teams\.microsoft\.com/i.test(url)) return "teams";
  return "other";
}

function regexFallback(text: string): JoinInfo {
  const match = text.match(LINK_PATTERN);
  if (!match) return { joinUrl: null, joinType: null };
  const url = match[0].replace(/[)>."']+$/, "");
  return { joinUrl: url, joinType: classify(url) };
}

export function extractJoinInfoGoogle(event: calendar_v3.Schema$Event): JoinInfo {
  const videoEntry = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  if (videoEntry?.uri) return { joinUrl: videoEntry.uri, joinType: classify(videoEntry.uri) };
  if (event.hangoutLink) return { joinUrl: event.hangoutLink, joinType: "meet" };
  return regexFallback(`${event.description ?? ""} ${event.location ?? ""}`);
}

export function extractJoinInfoMicrosoft(event: GraphEvent): JoinInfo {
  if (event.isOnlineMeeting && event.onlineMeeting?.joinUrl) {
    return { joinUrl: event.onlineMeeting.joinUrl, joinType: classify(event.onlineMeeting.joinUrl) };
  }
  return regexFallback(`${event.bodyPreview ?? event.body?.content ?? ""} ${event.location?.displayName ?? ""}`);
}
