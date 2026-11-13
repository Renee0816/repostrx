// POST /.netlify/functions/import   body: { "url": "https://..." }
// Asks Blotato to start reading an article. Returns the job ID right away;
// the page then checks progress with import-status. We don't wait here
// because Netlify functions time out after about 10 seconds.

import { requirePassword } from "../lib/auth.mjs";

const BLOTATO_URL ="https://backend.blotato.com/v2/source-resolutions-v3";

// Plain-English explanations for errors we expect from Blotato.
const MESSAGES = {
  401: "Blotato didn't accept the API key. Check that BLOTATO_API_KEY holds your current key from Blotato Settings > API, with no extra spaces.",
  403: "Blotato says this API key isn't allowed to import articles. Check your Blotato plan or key.",
  422: "Blotato couldn't accept that URL. Check that it's a public article link (not behind a login) and try again.",
  429: "Too many imports in a short time (Blotato allows 30 per minute). Wait a minute and try again.",
};

// Builds a JSON response with the given status code.
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Returns true only for full http:// or https:// addresses.
function isWebUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default async (req) => {
  // Password first: nothing below runs for strangers.
  const denied = requirePassword(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return reply(405, { error: "This endpoint only accepts POST requests." });
  }

  let url;
  try {
    ({ url } = await req.json());
  } catch {
    return reply(400, { error: 'Send JSON like {"url": "https://example.com/article"}.' });
  }

  url = typeof url === "string" ? url.trim() : "";
  if (!isWebUrl(url)) {
    return reply(400, { error: "Enter a full article link starting with http:// or https://." });
  }

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return reply(500, {
      error: "The server has no Blotato API key. Add BLOTATO_API_KEY to .env (on your computer) or to the site's environment variables in Netlify.",
    });
  }

  let res;
  try {
    res = await fetch(BLOTATO_URL, {
      method: "POST",
      headers: { "blotato-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ source: { sourceType: "article", url } }),
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

  try {
    const { id } = await res.json();
    if (!id) throw new Error("missing id");
    return reply(200, { id });
  } catch {
    return reply(502, { error: "Blotato started the import but didn't send back a job ID. Try again shortly." });
  }
};
