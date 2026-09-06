/**
 * Share-by-URL encoding (change add-share-by-url).
 *
 * A trip is serialized to JSON, deflate-raw compressed via CompressionStream,
 * and base64url-encoded into the URL fragment `#trip=...`. The fragment is
 * never sent to servers (browser-only), and only ever lives client-side.
 *
 * Schema validation is NOT done here — decoding yields the raw JSON string;
 * callers must import through the store (`importTripJson`) so invalid trips
 * are rejected exactly like file imports.
 */

/** Safe maximum URL fragment length (chars) before we fall back to a file. */
export const MAX_FRAGMENT = 8000;

export const FRAGMENT_PREFIX = "#trip=";

export type ShareErrorCode =
  | "unsupported" // CompressionStream/DecompressionStream unavailable
  | "oversize" // encoded fragment exceeds MAX_FRAGMENT
  | "malformed" // not base64url / empty payload
  | "inflate" // payload did not decompress (corrupt)
  | "not-json" // decompressed bytes are not JSON
  | "encode"; // compression failed for another reason

/** Typed error so callers can branch on the failure mode (e.g. oversize fallback). */
export class ShareError extends Error {
  constructor(
    readonly code: ShareErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}

/** String.fromCharCode arg limit is large but bounded — convert in chunks. */
const CHUNK = 0x8000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error("payload is not base64url");
  }
  let b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * DOM lib types CompressionStream/DecompressionStream as
 * TransformStream<BufferSource, …>, which is not assignable under TS's
 * generic Uint8Array — narrow the writable side (values we enqueue are always
 * Uint8Array, so this is safe at runtime).
 */
type RawDeflateTransform = TransformStream<Uint8Array, Uint8Array>;
const rawDeflate = () => new CompressionStream("deflate-raw") as unknown as RawDeflateTransform;
const rawInflate = () => new DecompressionStream("deflate-raw") as unknown as RawDeflateTransform;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Encode trip JSON into a `#trip=...` URL fragment; throws `ShareError("oversize")` past MAX_FRAGMENT. */
export async function encodeTrip(json: string): Promise<string> {
  if (typeof CompressionStream === "undefined") {
    throw new ShareError(
      "unsupported",
      "Sharing is not supported in this browser (no CompressionStream).",
    );
  }
  let compressed: Uint8Array;
  try {
    compressed = await readAll(byteStream(new TextEncoder().encode(json)).pipeThrough(rawDeflate()));
  } catch (e) {
    throw new ShareError("encode", "Could not compress the trip for sharing.", e);
  }
  const fragment = `${FRAGMENT_PREFIX}${bytesToBase64Url(compressed)}`;
  if (fragment.length > MAX_FRAGMENT) {
    throw new ShareError(
      "oversize",
      `Trip too large for a share link (over ${MAX_FRAGMENT} characters).`,
    );
  }
  return fragment;
}

/** Decode a `#trip=...` fragment (or bare payload) back to trip JSON. Throws typed `ShareError`s. */
export async function decodeTrip(fragment: string): Promise<string> {
  const payload = fragment.startsWith(FRAGMENT_PREFIX)
    ? fragment.slice(FRAGMENT_PREFIX.length)
    : fragment;
  if (!payload) {
    throw new ShareError("malformed", "Share link has no trip payload.");
  }
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(payload);
  } catch (e) {
    throw new ShareError("malformed", "Share link payload is malformed.", e);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new ShareError(
      "unsupported",
      "Opening shared trips is not supported in this browser (no DecompressionStream).",
    );
  }
  let inflated: Uint8Array;
  try {
    inflated = await readAll(byteStream(bytes).pipeThrough(rawInflate()));
  } catch (e) {
    throw new ShareError("inflate", "Share link payload is corrupted.", e);
  }
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
  } catch (e) {
    throw new ShareError("malformed", "Share link payload is not valid UTF-8.", e);
  }
  try {
    JSON.parse(json);
  } catch (e) {
    throw new ShareError("not-json", "Share link payload is not valid trip JSON.", e);
  }
  return json;
}

/** Download JSON as a file (export path and oversize share fallback). */
export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Full share flow for one trip's JSON (task 2.2): copy a `#trip=` link to the
 * clipboard, or fall back to a JSON file download when the encoded fragment
 * exceeds MAX_FRAGMENT. Returns the toast message to show.
 */
export async function shareTrip(json: string, tripName: string): Promise<string> {
  let fragment: string;
  try {
    fragment = await encodeTrip(json);
  } catch (e) {
    if (e instanceof ShareError && e.code === "oversize") {
      downloadJson(json, `${tripName.replace(/[^\w-]+/g, "_")}.json`);
      return "Trip too large for a link — downloaded the JSON file instead";
    }
    return e instanceof Error ? e.message : String(e);
  }
  const url = `${window.location.origin}${window.location.pathname}${fragment}`;
  try {
    await navigator.clipboard.writeText(url);
    return "Link copied";
  } catch {
    return "Could not copy the link — clipboard access was blocked";
  }
}
