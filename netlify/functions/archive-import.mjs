// POST /.netlify/functions/archive-import
// body: { "dryRun": true | false, "board": [{ "id": "<postSubmissionId>", "scheduledTime": "...", "platform": "linkedin" }] }
// Adds posts from Blotato's post list to the archive (backfill). OWNER ONLY.
// READ-ONLY towards Blotato: it only lists posts (GET /v2/posts), never creates or changes them.
//
// dryRun: true  -> a preview: what WOULD be added, nothing saved.
// dryRun: false -> saves new records ("only if new") and the latest status for each.
//
// Each listed post is one of:
//   add            new record, stored as the board's postSubmissionId (if exactly one board
//                  card has the same platform and time) or as "blotato-<number>"
//   matched        same platform, account, time and exact text as an existing record
//                  (e.g. scheduled in RepostRx): no new record, only its status is saved
//   already        already archived under that ID: only its status is saved
//   skipped        not scheduled, published or failed (e.g. a draft), or missing text

import { requirePassword } from "../lib/auth.mjs";
import { addRecord, listArchive, setStatus } from "../lib/archive.mjs";

const BLOTATO_LIST_URL = "https://backend.blotato.com/v2/posts";
const WINDOW_DAYS = 90;
const PAGE_LIMIT = 250;
const MAX_PAGES = 4; // up to 1,000 posts
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_STATES = ["scheduled", "published", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES = {
  401: "Blotato didn't accept the API key. Check that BLOTATO_API_KEY holds your current key from Blotato Settings > API, with no extra spaces.",
  403: "Blotato says this API key isn't allowed to list posts. Check your Blotato plan or key.",
  429: "Too many requests to Blotato (it allows 60 post lists per minute). Wait a minute and try again.",
};

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Same instant, whatever the format ("...00Z" vs "...00.000Z").
function sameTime(a, b) {
  const ta = new Date(a).getTime();
  return Number.isFinite(ta) && ta === new Date(b).getTime();
}
const matchKey = (platform, accountId, time, text) =>
  [platform, String(accountId ?? ""), new Date(time).getTime(), (text ?? "").trim()].join("|");

// Reads every page of Blotato's list in the window. Returns { items, truncated } or { error, status }.
async function listBlotatoPosts(apiKey) {
  const now = Date.now();
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(BLOTATO_LIST_URL);
    url.searchParams.set("since", new Date(now - WINDOW_DAYS * DAY_MS).toISOString());
    url.searchParams.set("until", new Date(now + WINDOW_DAYS * DAY_MS).toISOString());
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    let res;
    try {
      res = await fetch(url, { headers: { "blotato-api-key": apiKey } });
    } catch {
      return { status: 502, error: "Couldn't reach Blotato. Try again shortly." };
    }
    if (!res.ok) {
      return {
        status: res.status,
        error: MESSAGES[res.status] ?? (res.status >= 500 ? "Blotato had a problem on its side. Try again in a few minutes." : `Blotato rejected the request (status ${res.status}).`),
      };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { status: 502, error: "Blotato sent back a list we couldn't read. Try again shortly." };
    }
    if (!Array.isArray(data.items)) {
      return { status: 502, error: "Blotato's answer had no list of posts, so nothing was imported." };
    }
    items.push(...data.items);
    cursor = typeof data.cursor === "string" && data.cursor ? data.cursor : null;
    if (!cursor) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export default async (req) => {
  // Password first, owner only: demo users get 403 (deny by default).
  const denied = requirePassword(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return reply(405, { error: "This endpoint only accepts POST requests." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON like {"dryRun": true, "board": []}.' });
  }
  if (typeof body.dryRun !== "boolean") {
    return reply(400, { error: "Say whether this is a preview: dryRun must be true or false." });
  }
  const dryRun = body.dryRun;

  // Board cards (from the page) only supply a postSubmissionId; everything else comes from Blotato.
  const board = (Array.isArray(body.board) ? body.board : [])
    .filter((c) => c && typeof c.id === "string" && UUID.test(c.id) && typeof c.platform === "string" && typeof c.scheduledTime === "string")
    .slice(0, 500);

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return reply(500, { error: "The server has no Blotato API key. Add BLOTATO_API_KEY to .env (on your computer) or to the site's environment variables in Netlify." });
  }

  const listed = await listBlotatoPosts(apiKey);
  if (listed.error) return reply(listed.status, { error: listed.error });

  let existing;
  try {
    existing = await listArchive();
  } catch (err) {
    console.error("archive-import: couldn't read the store", JSON.stringify({ name: err?.name ?? "Error" }));
    return reply(502, { error: "Couldn't read the archive right now, so nothing was imported. Try again in a minute." });
  }
  const byId = new Map(existing.map((r) => [r.id, r]));
  const byContent = new Map(existing.map((r) => [matchKey(r.platform, r.accountId, r.scheduledTime, r.text), r]));

  const rows = [];
  for (const item of listed.items) {
    const type = item?.state?.type;
    const text = typeof item?.text === "string" ? item.text : "";
    const row = {
      blotatoId: item?.id != null ? String(item.id) : null,
      postTime: item?.postTime ?? null,
      platform: item?.platform ?? null,
      accountName: item?.account?.name ?? null,
      state: type ?? null,
      snippet: text.replace(/\s+/g, " ").slice(0, 90),
    };
    const status = {
      status: type,
      publicUrl: type === "published" ? item.state.postUrl : null,
      errorMessage: type === "failed" ? item.state.errorMessage : null,
    };

    if (!ARCHIVE_STATES.includes(type)) {
      rows.push({ ...row, action: "skipped", reason: "not scheduled, published or failed (for example a draft)" });
      continue;
    }
    if (!row.blotatoId || !/^\d{1,30}$/.test(row.blotatoId) || !text.trim() || !row.postTime) {
      rows.push({ ...row, action: "skipped", reason: "missing ID, text or post time" });
      continue;
    }

    const same = byContent.get(matchKey(item.platform, item.account?.id, item.postTime, text));
    if (same) {
      rows.push({ ...row, action: "matched", recordId: same.id, reason: "same as an existing record" });
      if (!dryRun) await setStatus(same.id, status).catch(() => {});
      continue;
    }

    const boardMatches = board.filter((c) => c.platform === item.platform && sameTime(c.scheduledTime, item.postTime));
    const fromBoard = boardMatches.length === 1 ? boardMatches[0].id : null;
    const recordId = fromBoard ?? `blotato-${row.blotatoId}`;

    if (byId.has(recordId)) {
      rows.push({ ...row, action: "already", recordId, reason: "already archived" });
      if (!dryRun) await setStatus(recordId, status).catch(() => {});
      continue;
    }

    const plan = { ...row, action: "add", recordId, idFrom: fromBoard ? "your RepostRx board" : "Blotato's post number" };
    if (boardMatches.length > 1) plan.note = "several board cards had this time, so none was used";
    if (!dryRun) {
      try {
        const result = await addRecord(recordId, {
          text,
          platform: item.platform,
          accountName: item.account?.name,
          accountId: item.account?.id != null ? String(item.account.id) : null,
          scheduledTime: new Date(item.postTime).toISOString(),
          postSubmissionId: fromBoard,
          blotatoId: row.blotatoId,
          source: fromBoard ? "imported from Blotato's list (ID from the RepostRx board)" : "imported from Blotato's list",
        });
        if (!result.added) {
          plan.action = "already";
          plan.reason = result.reason;
        } else {
          byId.set(recordId, result.record);
        }
        await setStatus(recordId, status);
      } catch (err) {
        console.error("archive-import: save failed", JSON.stringify({ name: err?.name ?? "Error" }));
        plan.action = "failed";
        plan.reason = "couldn't save to the archive";
      }
    }
    rows.push(plan);
  }

  const count = (a) => rows.filter((r) => r.action === a).length;
  return reply(200, {
    dryRun,
    counts: { add: count("add"), matched: count("matched"), already: count("already"), skipped: count("skipped"), failed: count("failed") },
    truncated: listed.truncated,
    windowDays: WINDOW_DAYS,
    rows,
  });
};
