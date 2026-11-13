// GET /.netlify/functions/accounts
// Asks Blotato for the social accounts connected to our API key.
// The key stays here on the server; the browser never sees it.

import { requirePassword } from "../lib/auth.mjs";

const BLOTATO_URL ="https://backend.blotato.com/v2/users/me/accounts";

// Plain-English explanations for errors we expect from Blotato.
const MESSAGES = {
  401: "Blotato didn't accept the API key. Check that BLOTATO_API_KEY holds your current key from Blotato Settings > API, with no extra spaces.",
  403: "Blotato says this API key isn't allowed to list accounts. Check your Blotato plan or key.",
  429: "Too many requests to Blotato in a short time. Wait a minute and try again.",
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

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return reply(500, {
      error: "The server has no Blotato API key. Add BLOTATO_API_KEY to .env (on your computer) or to the site's environment variables in Netlify.",
    });
  }

  let res;
  try {
    res = await fetch(BLOTATO_URL, { headers: { "blotato-api-key": apiKey } });
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
    return reply(200, await res.json());
  } catch {
    return reply(502, { error: "Blotato sent back a response we couldn't read. Try again shortly." });
  }
};
