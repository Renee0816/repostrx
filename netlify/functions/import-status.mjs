// GET /.netlify/functions/import-status?id=...
// Checks once whether Blotato has finished reading the article.
// The page calls this every few seconds until the status is "completed" or "failed".

const BLOTATO_URL = "https://backend.blotato.com/v2/source-resolutions-v3/";

// Plain-English explanations for errors we expect from Blotato.
const MESSAGES = {
  401: "Blotato didn't accept the API key. Check that BLOTATO_API_KEY holds your current key from Blotato Settings > API, with no extra spaces.",
  403: "Blotato says this API key isn't allowed to check imports. Check your Blotato plan or key.",
  404: "Blotato has no import with that ID. Start a new import and try again.",
  429: "Checking too often (Blotato allows 60 checks per minute). Wait a minute and try again.",
};

// Builds a JSON response with the given status code.
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "GET") {
    return reply(405, { error: "This endpoint only accepts GET requests." });
  }

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id || id.length > 100) {
    return reply(400, { error: "Add the import ID to the address, like ?id=068ea26e-..." });
  }

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return reply(500, {
      error: "The server has no Blotato API key. Add BLOTATO_API_KEY to .env (on your computer) or to the site's environment variables in Netlify.",
    });
  }

  let res;
  try {
    // encodeURIComponent keeps odd characters in the ID from changing the URL path.
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

  switch (data.status) {
    case "queued":
    case "processing":
      return reply(200, { status: data.status });

    case "completed":
      return reply(200, { status: "completed", title: data.title ?? "", text: data.content ?? "" });

    case "failed":
      return reply(200, {
        status: "failed",
        error: `Blotato couldn't read that article${data.message ? `: ${data.message}` : "."} Check that the link is public (not behind a login or paywall) and try again.`,
      });

    default:
      return reply(502, { error: `Blotato returned a status we don't recognize ("${data.status}"). Try again shortly.` });
  }
};
