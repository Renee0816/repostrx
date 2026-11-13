// Shared password check for every RepostRx function.
// RepostRx has one user, so one app password (REPOSTRX_APP_PASSWORD) is enough.
// The page sends it in the x-repostrx-password header; it is typed in by the user,
// never written into the page's code.
// Lives outside netlify/functions so Netlify doesn't publish it as a function.

import { createHash, timingSafeEqual } from "node:crypto";

const HEADER = "x-repostrx-password";
const MIN_LENGTH = 12;

function sha256(text) {
  return createHash("sha256").update(text).digest();
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// Returns null when the password is right, or a Response to send back when it isn't.
// Fails closed: if the server has no (or too short a) password, nothing runs.
export function requirePassword(req) {
  const expected = process.env.REPOSTRX_APP_PASSWORD;
  if (!expected || expected.length < MIN_LENGTH) {
    return json(500, {
      error: `The server has no app password, so RepostRx is locked. Add REPOSTRX_APP_PASSWORD (at least ${MIN_LENGTH} characters) to .env (on your computer) or to the site's environment variables in Netlify.`,
    }, { "x-repostrx-auth": "not-configured" });
  }

  // Hashing both sides gives equal-length values, so timingSafeEqual can compare
  // them without the response time hinting at how close a guess was.
  const given = req.headers.get(HEADER) ?? "";
  if (!timingSafeEqual(sha256(given), sha256(expected))) {
    return json(
      401,
      { error: "Wrong or missing RepostRx password. Sign in at the top of the page.", authRequired: true },
      // Lets the page tell this apart from Blotato's own 401 (bad Blotato API key).
      { "x-repostrx-auth": "required" },
    );
  }
  return null;
}
