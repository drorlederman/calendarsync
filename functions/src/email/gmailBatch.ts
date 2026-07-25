export interface NormalizedMessageLike {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isRead: boolean;
}

export interface GmailMetadataPayload {
  id?: string | null;
  snippet?: string | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }> | null;
  } | null;
}

export function extractBatchBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1] : null;
}

export function buildGmailMetadataBatchBody(messageIds: string[], boundary: string): string {
  const parts = messageIds.map((id, i) => {
    const path =
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}` +
      `?format=metadata&metadataHeaders=From&metadataHeaders=Subject`;
    return [
      `--${boundary}`,
      "Content-Type: application/http",
      `Content-ID: <item${i}+${id}>`,
      "",
      `GET ${path}`,
      "",
    ].join("\r\n");
  });
  return parts.join("") + `--${boundary}--\r\n`;
}

/**
 * Parse a Gmail batch multipart body into a map keyed by message id.
 * Prefers JSON `id` field; falls back to Content-ID suffix after `+` or `response-`.
 */
export function parseGmailBatchResponse(rawBody: string, boundary: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const delim = `--${boundary}`;
  const chunks = rawBody.split(delim).slice(1); // drop preamble

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "--" || trimmed.startsWith("--")) continue;

    const headerEnd = trimmed.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const partHeaders = trimmed.slice(0, headerEnd);
    const afterHeaders = trimmed.slice(headerEnd).replace(/^\r?\n\r?\n/, "");

    // application/http: status line + headers + body
    const httpMatch = afterHeaders.match(/^HTTP\/\d\.\d\s+(\d+)[^\r\n]*\r?\n([\s\S]*)$/i);
    if (!httpMatch) continue;
    const status = parseInt(httpMatch[1], 10);
    if (status < 200 || status >= 300) continue;

    const httpRest = httpMatch[2];
    const bodySep = httpRest.search(/\r?\n\r?\n/);
    if (bodySep < 0) continue;
    const jsonText = httpRest.slice(bodySep).replace(/^\r?\n\r?\n/, "").trim();
    if (!jsonText) continue;

    let data: unknown;
    try {
      data = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const idFromJson =
      data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string"
        ? (data as { id: string }).id
        : null;

    const contentId = partHeaders.match(/Content-ID:\s*<?([^>\r\n]+)>?/i)?.[1] ?? "";
    const idFromHeader =
      contentId.includes("+")
        ? contentId.slice(contentId.lastIndexOf("+") + 1)
        : contentId.replace(/^response-/i, "") || null;

    const id = idFromJson ?? idFromHeader;
    if (!id) continue;
    out.set(id, data);
  }

  return out;
}

export function normalizeGmailMetadataMessage(
  id: string,
  data: GmailMetadataPayload,
): NormalizedMessageLike {
  const headers = data.payload?.headers ?? [];
  const from = headers.find((h) => h.name === "From")?.value ?? "";
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "(ללא נושא)";
  return {
    id,
    from,
    subject,
    snippet: data.snippet ?? "",
    date: data.internalDate
      ? new Date(parseInt(data.internalDate, 10)).toISOString()
      : new Date().toISOString(),
    isRead: !(data.labelIds ?? []).includes("UNREAD"),
  };
}
