// Shared password check for every RepostRx function.
// REPOSTRX_APP_PASSWORD is the owner's password (full access).
// REPOSTRX_DEMO_PASSWORD (optional) is for visitors: it can't schedule or see accounts.
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

// Hashing both sides gives equal-length values, so timingSafeEqual can compare
// them without the response time hinting at how close a guess was.
function matches(given, expected) {
  return timingSafeEqual(sha256(given), sha256(expected));
}

// Works out who is asking. Returns { role: "owner" | "demo" } or { denied: Response }.
// Fails closed:
// - no (or too short a) main password: everything is locked.
// - demo password missing or too short: demo mode is simply off.
// - demo password the same as the main one: everything is locked, because
//   giving out the "demo" password would really give out full access.
export function checkPassword(req) {
  const owner = process.env.REPOSTRX_APP_PASSWORD;
  if (!owner || owner.length < MIN_LENGTH) {
    return { denied: json(500, {
      error: `The server has no app password, so RepostRx is locked. Add REPOSTRX_APP_PASSWORD (at least ${MIN_LENGTH} characters) to .env (on your computer) or to the site's environment variables in Netlify.`,
    }, { "x-repostrx-auth": "not-configured" }) };
  }

  const demo = process.env.REPOSTRX_DEMO_PASSWORD;
  const demoOn = Boolean(demo) && demo.length >= MIN_LENGTH;
  if (demoOn && demo === owner) {
    return { denied: json(500, {
      error: "REPOSTRX_DEMO_PASSWORD is the same as REPOSTRX_APP_PASSWORD, so RepostRx is locked. Give the demo password a different value.",
    }, { "x-repostrx-auth": "not-configured" }) };
  }

  const given = req.headers.get(HEADER) ?? "";
  if (matches(given, owner)) return { role: "owner" };
  if (demoOn && matches(given, demo)) return { role: "demo" };

  return { denied: json(
    401,
    { error: "Wrong or missing RepostRx password. Sign in at the top of the page.", authRequired: true },
    // Lets the page tell this apart from Blotato's own 401 (bad Blotato API key).
    { "x-repostrx-auth": "required" },
  ) };
}

// Returns null when the request may go ahead, or a Response to send back when it can't.
// Demo users are refused unless the function opts in with { allowDemo: true },
// so a function nobody updated stays owner-only.
export function requirePassword(req, { allowDemo = false } = {}) {
  const result = checkPassword(req);
  if (result.denied) return result.denied;
  if (result.role === "demo" && !allowDemo) {
    return json(
      403,
      { error: "Demo mode: this part of RepostRx is turned off. Nothing you do here can post.", demo: true },
      // A different header from x-repostrx-auth, so the page doesn't sign the demo user out.
      { "x-repostrx-demo": "blocked" },
    );
  }
  return null;
}
