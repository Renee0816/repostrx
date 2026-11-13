// GET /.netlify/functions/post-status?id=<postSubmissionId>
// READ-ONLY: asks Blotato for one post's status. It can't create, change or delete posts.
// Returns { status, scheduledTime, publicUrl, errorMessage, summary }.

import { requirePassword } from "../lib/auth.mjs";

const BLOTATO_URL ="https://backend.blotato.com/v2/posts/";

// Blotato's postSubmissionIds are UUIDs, e.g. 5556c419-cb7f-44be-b26c-94010e8126b5.
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Plain-English explanations for errors we expect from Blotato.
const MESSAGES = {
  401: "Blotato didn't accept the API key. Check that BLOTATO_API_KEY holds your current key from Blotato Settings > API, with no extra spaces.",
  403: "Blotato says this API key isn't allowed to check posts. Check your Blotato plan or key.",
  404: "Blotato has no post with that ID. Check it for typos.",
  429: "Checking too often (Blotato allows 60 status checks per minute). Wait a minute and try again.",
};

// One plain-English sentence per status. Times are left to the page,
// which knows the user's time zone.
const SUMMARIES = {
  scheduled: "Scheduled. Blotato will publish it at the scheduled time.",
  published: "Published.",
  // Blotato also returns "in-progress" for IDs it has no record of (tested 2026-11-13),
  // so this mustn't claim the post is being worked on.
  "in-progress": "In progress, or Blotato may have no record of this ID. If it stays this way, check my.blotato.com.",
};

// Builds a JSON response with the given status code.
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  // Password first: nothing below runs for strangers.
  const denied = requirePassword(req);
  if (denied) return denied;

  if (req.method !== "GET") {
    return reply(405, { error: "This endpoint only accepts GET requests." });
  }

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return reply(400, { error: "Add the post ID to the address, like ?id=5556c419-..." });
  }
  if (!ID_PATTERN.test(id)) {
    return reply(400, { error: "That doesn't look like a Blotato post ID. It should look like 5556c419-cb7f-44be-b26c-94010e8126b5." });
  }

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return reply(500, {
      error: "The server has no Blotato API key. Add BLOTATO_API_KEY to .env (on your computer) or to the site's environment variables in Netlify.",
    });
  }

  let res;
  try {
    res = await fetch(BLOTATO_URL + encodeURIComponent(id), {
      headers: { "blotato-api-key": apiKey },
    });
  } catch {
    return reply(502, { error: "Couldn't reach Blotato. It may be down, or there's a network problem. Try again shortly." });
  }

  if (!res.ok) {
    const message =
      MESSAGES[res.status] ??
      (res.status >= 500
        ? "Blotato had a problem on its side. Try again in a few minutes."
        : `Blotato rejected the request (status ${res.status}).`);
    return reply(res.status, { error: message });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return reply(502, { error: "Blotato sent back a response we couldn't read. Try again shortly." });
  }

  const status = data.status;
  if (!["scheduled", "published", "failed", "in-progress"].includes(status)) {
    return reply(502, { error: `Blotato returned a status we don't recognize ("${status}"). Try again shortly.` });
  }

  const errorMessage = typeof data.errorMessage === "string" ? data.errorMessage : null;
  const summary =
    status === "failed"
      ? `Blotato couldn't publish this post${errorMessage ? `: ${errorMessage}` : "."}`
      : SUMMARIES[status];

  return reply(200, {
    status,
    scheduledTime: typeof data.scheduledTime === "string" ? data.scheduledTime : null,
    publicUrl: typeof data.publicUrl === "string" ? data.publicUrl : null,
    errorMessage,
    summary,
  });
};
