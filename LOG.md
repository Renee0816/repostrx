**# RepostRx build log**



\## 2026-11-09: 401 Unauthorized

\- What I saw: List accounts returned 401, {"message": "Unauthorized"}, after working a minute earlier.

\- What I thought: the API key was wrong or missing.

\- Cause: the blotato-api-key header was switched off in Postman, so no key was sent.

\- Fix: turned the header back on and got 200 OK.

\- Customer reply: A 401 means Blotato didn't receive a valid API key. Check that your request has a blotato-api-key header with your key from Settings > API, with no extra spaces. If it still fails, regenerate the key and update it everywhere you use it.



\## 2026-11-09: File saved with the wrong name

\- What I saw: Notepad tab said UsersrenkorepostrxLOG.md instead of LOG.md, and the file landed in my about-me folder.

\- Cause: Claude Code's ! shell mode uses Bash, which treats \\ as a special character and removed them from the Windows path.

\- Fix: Save As to the right folder, then deleted the stray copy before it could be committed.

\- Lesson: in ! shell mode, use forward slashes: C:/Users/renko/repostrx/LOG.md



\## 2026-11-09: 422 Account not found (wrong ID)

\- What I saw: 422 Unprocessable Entity, "Account 99999 not found", code 5000.

\- Cause: accountId in the body didn't match any connected account.

\- Fix: used the id from GET /users/me/accounts (42078).

\- Customer reply: This error means the account ID in your request doesn't match a connected account. If you recently reconnected LinkedIn, it got a new ID, so copy the current one from my.blotato.com/accounts. Update it in your automation and the post will go through.



\## 2026-11-09: 400 Missing text

\- What I saw: 400 Bad Request, "body.post.content must have required property 'text'".

\- Cause: the text field was removed from post.content.

\- Fix: added the text field back.

\- Customer reply: This error means your post is missing its text. Every post needs a text field inside content, even if it's short. Add it back and resend.



\## 2026-11-09: 422 Account not found (real cause: platform mismatch)

\- What I saw: 422, "Account 42078 not found", even though 42078 is my real LinkedIn ID.

\- What I thought: the account ID was wrong. Postman's AI suggested that too.

\- Cause: content.platform was "twitter" while the target was LinkedIn. Blotato looked for a Twitter account with that ID, and details.availableAccounts was empty.

\- Fix: set platform back to "linkedin" to match targetType.

\- Lesson: the message pointed at the wrong field. The details section showed the real cause.

\- Customer reply: This error can appear when the platform in your post content doesn't match the account you're posting to. Check that content.platform and target.targetType are the same, for example both "linkedin". Your account ID is fine.



\## 2026-11-09: Duplicate post (accidental)

\- What I saw: after fixing a test, I clicked Send and got 200 and a new postSubmissionId. The status check showed "published": the same text was on LinkedIn twice.

\- Cause: resending a working request creates a new post. The API doesn't block duplicate text.

\- Fix: deleted the duplicate on LinkedIn.

\- Lesson for RepostRx: disable the Schedule button after one click, and warn if the same text was sent recently.

\- Customer reply: It looks like the post was submitted twice, so two separate posts were created. You can delete the extra one directly on LinkedIn. To prevent this, click Publish once and check the status board before resending.



**## Good practices**

\- 2026-11-10: Locked my n8n Blotato credential to the backend.blotato.com domain (Allowed HTTP Request Domains). The API key can only be sent to Blotato, even if a workflow is misconfigured.

\- 2026-11-10: Named credentials clearly (Blotato API key) so I know which key is which.

\- 2026-11-10: Keep n8n post-status checks inside one run (post, wait, check) instead of a schedule every few minutes. Saves executions: one post = one execution.

\- 2026-11-09: Stored my API key in a Postman environment variable ({{api\_key}}) instead of typing it into each request.



\- 2026-11-10: Added a Claude Code "Ask" rule for mcp\_\_Blotato, so Claude Code must ask before any Blotato tool runs, including ones that publish. Read-only tools can otherwise run without a prompt.



\- 2026-11-10: GitHub MCP uses a fine-grained token (1 repo, minimal permissions, 30-day expiry) stored as a Windows environment variable. Claude Code's config only holds ${GITHUB\_MCP\_TOKEN}, and it shows the header as \[REDACTED].

\- 2026-11-10: Ask rules for mcp\_\_Blotato and mcp\_\_github. Allowed "don't ask again" only for read-only tools like List commits.

