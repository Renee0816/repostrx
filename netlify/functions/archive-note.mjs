// POST /.netlify/functions/archive-note   body: { "id": "<record id>", "note": "Footer added on LinkedIn, 11/17" }
// Adds one permanent note to an archived record. OWNER ONLY.
// Append-only: notes are never edited or deleted, and the record's text never changes.
// It doesn't call Blotato.

import { requirePassword } from "../lib/auth.mjs";
import { addNote } from "../lib/archive.mjs";

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

  if (req.method !== "POST") {
    return reply(405, { error: "This endpoint only accepts POST requests." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Send JSON like {"id": "...", "note": "Footer added on LinkedIn"}.' });
  }

  let result;
  try {
    result = await addNote(body.id, body.note);
  } catch (err) {
    console.error("archive-note: save failed", JSON.stringify({ name: err?.name ?? "Error" }));
    return reply(502, { error: "Couldn't save the note right now. Try again in a minute." });
  }

  if (!result.added) {
    const status = result.reason === "That record isn't in the archive." ? 404 : 400;
    return reply(status, { error: result.reason === "invalid id" ? "That isn't a valid archive record ID." : result.reason });
  }
  return reply(200, { note: result.note });
};
