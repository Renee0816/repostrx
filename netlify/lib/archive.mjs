// Permanent post archive (milestone 6.4), for advertising record-keeping.
// Stored in Netlify Blobs, in one site-wide store (it survives deploys).
// netlify dev keeps its own local copy, so local tests never touch the live archive.
//
// Three kinds of entries:
//   post/<id>    the record: exactly what was scheduled. Written ONCE ("only if new"),
//                never edited or deleted by RepostRx.
//   status/<id>  the latest status from Blotato (published/failed, live URL).
//                Kept separate, so a status update can never change a record.
//   note/<id>/<time>-<random>  the owner's notes (e.g. "Footer added on LinkedIn").
//                Each written ONCE; never edited or deleted. A record can have many.
// Never store keys, passwords or request headers: only the fields listed below.
//
// Limits: "append-only" is enforced by this code, not by Netlify. The site owner can
// still delete entries with Netlify's tools, and deleting the site deletes the archive,
// so download the CSV regularly and keep it somewhere else.

import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const STORE_NAME = "repostrx-archive";
const ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/; // postSubmissionId (UUID) or "blotato-<number>"
const MAX_TEXT = 70_000;
const MAX_FIELD = 2_000;

// Tests pass an in-memory fake store here, so they run offline.
let testStore = null;
export function useStoreForTests(fake) {
  testStore = fake;
}
function store() {
  return testStore ?? getStore({ name: STORE_NAME, consistency: "strong" });
}

// Only these fields are ever saved. Anything else passed in is ignored.
const RECORD_FIELDS = {
  text: MAX_TEXT,          // exact post text, including link and footer
  platform: 100,
  accountName: MAX_FIELD,
  accountId: 100,
  scheduledTime: 100,      // when the post goes out (ISO, UTC)
  articleUrl: MAX_FIELD,
  postSubmissionId: 100,   // from Blotato when RepostRx scheduled it
  blotatoId: 100,          // Blotato's number in its post list (imported records)
  scheduledAt: 100,        // when it was scheduled, if known (ISO, UTC)
  source: 100,             // "scheduled in RepostRx" or "imported from Blotato's list"
};

function clean(fields, allowed) {
  const out = {};
  for (const [name, max] of Object.entries(allowed)) {
    const value = fields[name];
    out[name] = typeof value === "string" && value.trim() ? value.slice(0, max) : null;
  }
  return out;
}

// Saves a record once. Returns { added: true, record } or { added: false, reason }.
// Throws only if the store itself fails.
export async function addRecord(id, fields) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    return { added: false, reason: "invalid id" };
  }
  const record = { id, ...clean(fields, RECORD_FIELDS), archivedAt: new Date().toISOString() };
  if (!record.text) return { added: false, reason: "no text" };

  const { modified } = await store().setJSON(`post/${id}`, record, { onlyIfNew: true });
  return modified ? { added: true, record } : { added: false, reason: "already archived" };
}

// Saves the latest status for an archived post. Does nothing (returns false) if the
// post isn't in the archive, so status checks can't create records.
export async function setStatus(id, { status, publicUrl, errorMessage } = {}) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
  const s = store();
  if (!(await s.getMetadata(`post/${id}`))) return false;
  await s.setJSON(`status/${id}`, {
    ...clean({ status, publicUrl, errorMessage }, { status: 100, publicUrl: MAX_FIELD, errorMessage: MAX_FIELD }),
    checkedAt: new Date().toISOString(),
  });
  return true;
}

// ---------- Notes ----------

const NOTE_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Notes are permanent, so refuse anything that looks like a secret.
// Links are ignored for the long-run check, so a Drive or LinkedIn link is fine.
function looksSecret(text) {
  if (/\b(api[\s_-]?key|password|passwd|secret|token|authorization|bearer)\b\s*[:=]/i.test(text)) return true;
  if (/sk-ant-[A-Za-z0-9_-]+/.test(text)) return true;
  const withoutLinks = text.replace(/https?:\/\/\S+/gi, " ");
  return (withoutLinks.match(/[A-Za-z0-9_-]{32,}/g) ?? []).some((m) => !UUID.test(m));
}

// Saves one note on an archived record. Returns { added: true, note } or { added: false, reason }.
// Throws only if the store itself fails.
export async function addNote(id, text) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return { added: false, reason: "invalid id" };
  if (typeof text !== "string") return { added: false, reason: "The note must be text." };
  if (!text.trim()) return { added: false, reason: "The note is empty." };
  const note = text.trim();
  if (note.length > NOTE_MAX) {
    return { added: false, reason: `The note is ${note.length} characters; the limit is ${NOTE_MAX}.` };
  }
  if (looksSecret(note)) {
    return { added: false, reason: "The note looks like it contains a password or key. Notes are permanent, so leave secrets out." };
  }
  const s = store();
  if (!(await s.getMetadata(`post/${id}`))) return { added: false, reason: "That record isn't in the archive." };

  const addedAt = new Date().toISOString();
  const key = `note/${id}/${addedAt}-${randomUUID().slice(0, 8)}`;
  const { modified } = await s.setJSON(key, { text: note, addedAt }, { onlyIfNew: true });
  return modified ? { added: true, note: { text: note, addedAt } } : { added: false, reason: "Try again." };
}

// Every record with its latest status (or null) and its notes (oldest first), newest record first.
export async function listArchive() {
  const s = store();
  const [{ blobs }, { blobs: noteBlobs }] = await Promise.all([
    s.list({ prefix: "post/" }),
    s.list({ prefix: "note/" }),
  ]);

  // Group note keys by record id: note/<id>/<time>-<random>.
  const noteKeys = new Map();
  for (const { key } of noteBlobs) {
    const id = key.split("/")[1];
    if (!noteKeys.has(id)) noteKeys.set(id, []);
    noteKeys.get(id).push(key);
  }

  const rows = await Promise.all(
    blobs.map(async ({ key }) => {
      const id = key.slice("post/".length);
      const [record, status, notes] = await Promise.all([
        s.get(key, { type: "json" }),
        s.get(`status/${id}`, { type: "json" }),
        Promise.all((noteKeys.get(id) ?? []).map((k) => s.get(k, { type: "json" }))),
      ]);
      if (!record) return null;
      const sortedNotes = notes.filter(Boolean).sort((a, b) => (a.addedAt ?? "").localeCompare(b.addedAt ?? ""));
      return { ...record, latestStatus: status ?? null, notes: sortedNotes };
    }),
  );
  return rows
    .filter(Boolean)
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

// ---------- CSV download ----------

// CSV columns, in order: [header, how to get the value from a row].
const COLUMNS = [
  ["Archived at (UTC)", (r) => r.archivedAt],
  ["Scheduled at (UTC)", (r) => r.scheduledAt ?? "not available (imported from Blotato's list)"],
  ["Post time (UTC)", (r) => r.scheduledTime],
  ["Platform", (r) => r.platform],
  ["Account", (r) => r.accountName],
  ["Account ID", (r) => r.accountId],
  ["Post text (exact)", (r) => r.text],
  ["Article link", (r) => r.articleUrl],
  ["postSubmissionId", (r) => r.postSubmissionId ?? "not available"],
  ["Blotato post number", (r) => r.blotatoId],
  ["Source", (r) => r.source],
  ["Latest status", (r) => r.latestStatus?.status],
  ["Live post URL", (r) => r.latestStatus?.publicUrl],
  ["Error message", (r) => r.latestStatus?.errorMessage],
  ["Status checked at (UTC)", (r) => r.latestStatus?.checkedAt],
  ["Notes", (r) => (r.notes ?? []).map((n) => `${n.addedAt}: ${n.text}`).join("\n")],
];

// One CSV cell. Quotes are doubled and every cell is quoted, so commas and line
// breaks in post text stay inside the cell. A cell starting with = + - @ (or a tab
// or carriage return) gets a leading ' so a spreadsheet shows it instead of running it.
function cell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  const lines = [COLUMNS.map(([header]) => cell(header)).join(",")];
  for (const row of rows) lines.push(COLUMNS.map(([, get]) => cell(get(row))).join(","));
  // The BOM tells Excel the file is UTF-8, so "·" and emoji show correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
