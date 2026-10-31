import { timingSafeEqual } from 'node:crypto';
import busboy from 'busboy';
import type { UploadedFile } from './types.ts';

export function pushBounded<T>(list: T[], item: T, max = 200) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

export function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Constant-time comparison, so tokens cannot be guessed from response timing. */
export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    // A malformed escape in some other app's cookie must not break every request.
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(raw);
    } catch {
      out[part.slice(0, i).trim()] = raw;
    }
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Form-encoded body to an object; repeated fields (scope=a&scope=b) become arrays. */
export function parseForm(body: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/** Where a parsed multipart body keeps its files (a symbol, so validation never sees it). */
export const FILES = Symbol('files');

/**
 * Parse a multipart/form-data body. Text fields become strings; a field sent as JSON
 * (part type application/json, or text that is a JSON object or array) is parsed; a file
 * becomes a short text marker in the body, with its details under body[FILES].
 */
export function parseMultipart(raw: Buffer, contentType: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const out: Record<string | symbol, unknown> = {};
    const files: Record<string, UploadedFile> = {};
    out[FILES] = files;
    const bb = busboy({ headers: { 'content-type': contentType }, limits: { fileSize: 50 * 1024 * 1024 } });
    bb.on('field', (name, value, info) => {
      const looksJson = /json/i.test(info.mimeType) || /^\s*[{[]/.test(value);
      if (looksJson) {
        try {
          out[name] = JSON.parse(value);
          return;
        } catch {
          // fall through: keep the text, and let validation report it
        }
      }
      out[name] = value;
    });
    bb.on('file', (name, stream, info) => {
      let size = 0;
      stream.on('data', (chunk: Buffer) => (size += chunk.length));
      stream.on('end', () => {
        files[name] = { filename: info.filename ?? name, contentType: info.mimeType, size };
        out[name] = `[file ${info.filename}, ${size} bytes, ${info.mimeType}]`;
      });
    });
    bb.on('error', reject);
    bb.on('close', () => resolve(out as Record<string, unknown>));
    bb.end(raw);
  });
}
