// GET /.netlify/functions/archive               -> { records: [...] }, newest first
// GET /.netlify/functions/archive?format=csv    -> the same records as a CSV download
// OWNER ONLY (demo gets 403, like accounts and schedule). Read-only: it never
// changes or deletes a record, and it doesn't call Blotato.

import { requirePassword } from "../lib/auth.mjs";
import { listArchive, toCsv } from "../lib/archive.mjs";

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  // Password first, owner only: demo users get 403 (deny by default).
  const denied = requirePassword(req);
  if (denied) return denied;

  if (req.method !== "GET") {
    return reply(405, { error: "This endpoint only accepts GET requests." });
  }

  let rows;
  try {
    rows = await listArchive();
  } catch (err) {
    console.error("archive: couldn't read the store", JSON.stringify({ name: err?.name ?? "Error" }));
    return reply(502, { error: "Couldn't read the archive right now. Try again in a minute." });
  }

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const date = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="repostrx-archive-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return reply(200, { records: rows });
};
