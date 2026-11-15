// GET /.netlify/functions/whoami
// Tells the page which password was used: { role: "owner" } or { role: "demo" }.
// Calls nothing else (no Blotato, no Claude), so it's safe for demo users.

import { checkPassword } from "../lib/auth.mjs";

export default async (req) => {
  // Password first: strangers get the usual 401.
  const result = checkPassword(req);
  if (result.denied) return result.denied;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "This endpoint only accepts GET requests." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ role: result.role }), {
    headers: { "Content-Type": "application/json" },
  });
};
