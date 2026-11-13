// POST /.netlify/functions/schedule
// body: { "platform": "linkedin", "accountId": "42078", "text": "...", "scheduledTime": "2026-11-18T17:00:00.000Z" }
// Schedules ONE post on Blotato and returns { postSubmissionId, scheduledTime }.
//
// SAFETY: Blotato publishes IMMEDIATELY if a post has no scheduledTime.
// So the time is checked first, and every check runs before Blotato is called.

import { requirePassword } from "../lib/auth.mjs";

const BLOTATO_POSTS_URL ="https://backend.blotato.com/v2/posts";
const BLOTATO_ACCOUNTS_URL = "https://backend.blotato.com/v2/users/me/accounts";
const MIN_LEAD_MINUTES = 5; // times closer than this could effectively post right away

// Platforms RepostRx can schedule, with their text limits.
// "twitter" is Blotato's name for X.
const PLATFORMS = {
  linkedin: { name: "LinkedIn", maxChars: 3000 },
  twitter: { name: "X", maxChars: 280 },
  facebook: { name: "Facebook", maxChars: 63206 },
};

// Plain-English explanations for errors we expect from Blotato.
const MESSAGES = {
  401: "Blotato didn't accept the API key. Check that BLOTATO_API_KEY holds your current key from Blotato Settings > API, with no extra spaces.",
  403: "Blotato says this API key isn't allowed to schedule posts. Check your Blotato plan or key.",
  422: "Blotato rejected the post's details.",
  429: "Too many posts scheduled in a short time (Blotato allows 30 per minute). Wait a minute and try again.",
};

// Builds a JSON response with the given status code.
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Character count the way X does it: any link counts as 23.
function xLength(s) {
  return [...s.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}

export default async (req) => {
  // Password first: nothing below runs for strangers.
  const denied = requirePassword(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return reply(405, { error: "This endpoint only accepts POST requests." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Send JSON with platform, accountId, text and scheduledTime." });
  }

  // 1. Time first: missing or invalid must never reach Blotato (it would post immediately).
  const when = typeof body.scheduledTime === "string" ? new Date(body.scheduledTime) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return reply(400, { error: "Pick a date and time for the post. Without one, nothing is sent." });
  }
  const minutesAhead = (when.getTime() - Date.now()) / 60000;
  if (minutesAhead < MIN_LEAD_MINUTES) {
    return reply(400, {
      error: minutesAhead < 0
        ? "That time is in the past. Pick a future date and time."
        : `That time is too soon. Pick a time at least ${MIN_LEAD_MINUTES} minutes from now.`,
    });
  }
  const scheduledTime = when.toISOString(); // always send Blotato a clean UTC timestamp

  // 2. Platform and text.
  const platform = body.platform;
  const rules = PLATFORMS[platform];
  if (!rules) {
    return reply(400, { error: "Unknown platform. RepostRx can schedule to linkedin, twitter (X) or facebook." });
  }
  if (platform === "facebook") {
    // Blotato requires a Facebook Page ID, which RepostRx doesn't collect yet.
    return reply(400, { error: "Scheduling to Facebook isn't supported yet (it needs a Facebook Page ID)." });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return reply(400, { error: "The post is empty. Write some text before scheduling." });
  }
  const length = platform === "twitter" ? xLength(text) : [...text].length;
  if (length > rules.maxChars) {
    return reply(400, {
      error: `The ${rules.name} post is ${length} characters, over the ${rules.maxChars} limit. Shorten it and try again.`,
    });
  }

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return reply(500, {
      error: "The server has no Blotato API key. Add BLOTATO_API_KEY to .env (on your computer) or to the site's environment variables in Netlify.",
    });
  }

  // 3. Account: must be one of YOUR connected accounts, on this platform.
  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) {
    return reply(400, { error: "No account was chosen. Reload the page and try again." });
  }
  let accounts;
  try {
    const res = await fetch(BLOTATO_ACCOUNTS_URL, { headers: { "blotato-api-key": apiKey } });
    if (!res.ok) {
      return reply(res.status, {
        error: MESSAGES[res.status] ?? "Couldn't check your connected accounts with Blotato, so nothing was scheduled. Try again shortly.",
      });
    }
    const data = await res.json();
    accounts = data.items ?? data;
  } catch {
    return reply(502, { error: "Couldn't reach Blotato to check your accounts, so nothing was scheduled. Try again shortly." });
  }
  const account = Array.isArray(accounts) && accounts.find((a) => String(a.id) === accountId);
  if (!account) {
    return reply(400, { error: `Account ${accountId} isn't one of your connected Blotato accounts. Reload the page to get the current list.` });
  }
  if (account.platform !== platform) {
    return reply(400, { error: `Account ${accountId} is a ${account.platform} account, not ${platform}. Nothing was scheduled.` });
  }

  // 4. All checks passed: schedule it. platform and targetType come from the
  // same value, so they can't disagree.
  let res;
  try {
    res = await fetch(BLOTATO_POSTS_URL, {
      method: "POST",
      headers: { "blotato-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        post: {
          accountId,
          content: { text, mediaUrls: [], platform },
          target: { targetType: platform },
        },
        scheduledTime,
      }),
    });
  } catch {
    // We can't tell whether Blotato received it, so don't suggest retrying blindly.
    return reply(502, {
      error: "Lost the connection while sending to Blotato, so we don't know if the post was scheduled. Check your schedule at my.blotato.com before trying again.",
      outcomeUnknown: true,
    });
  }

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (typeof data.message === "string") detail = ` Blotato says: "${data.message}"`;
    } catch {}
    const message =
      MESSAGES[res.status] ??
      (res.status >= 500
        ? "Blotato had a problem on its side, so we can't be sure whether the post was scheduled. Check my.blotato.com before trying again."
        : `Blotato rejected the request (status ${res.status}).`);
    return reply(res.status, { error: message + detail, outcomeUnknown: res.status >= 500 });
  }

  try {
    const data = await res.json();
    if (!data.postSubmissionId) throw new Error("missing id");
    return reply(200, { postSubmissionId: data.postSubmissionId, scheduledTime: data.scheduledTime ?? scheduledTime });
  } catch {
    return reply(502, {
      error: "Blotato accepted the post but didn't send back an ID. Check your schedule at my.blotato.com before trying again.",
      outcomeUnknown: true,
    });
  }
};
