---
name: failed-post-ticket
description: Use when answering a customer support ticket about a Blotato post that failed, never went out, or posted twice. Diagnoses the cause and drafts a short customer reply.
---

# Answering a failed-post ticket

## Steps
1. Gather the facts: postSubmissionId, reqId, status code, and the exact error message. If any are missing, ask the customer for them.
2. If there is a postSubmissionId and the Blotato MCP is connected, check the post status (read-only). Never create, retry or delete a post without the user's explicit OK.
3. Match the error to the known causes below. Read the error's details section, not just the message.
4. Write the customer reply in 3 sentences: what happened, why, and what to do next. Warm, plain English, no jargon.
5. Below it, add a short internal note for the support team with the status code, reqId and likely cause.

## Known causes
| What the customer sees | Likely cause | Fix |
|---|---|---|
| 401 Unauthorized | API key missing, wrong, or has extra spaces | Check the blotato-api-key header; regenerate the key if it may have leaked |
| 400 "must have required property 'text'" | Post text is missing | Add a text field inside content |
| 422 "Account ___ not found" | Wrong account ID, or the account was reconnected and got a new ID | Copy the current ID from my.blotato.com/accounts |
| 422 "Account not found" but the ID is correct | content.platform doesn't match target.targetType | Make both the same, for example linkedin |
| Post went out twice | The request was submitted twice | Delete the extra post; click Publish once and check status before resending |
| "My post never went out" after a 201 | 201 means accepted, not published | Check the post status: in-progress, failed (with errorMessage) or published |

## Never
- Guess an account ID.
- Trust the error message alone when the details say something different.
- Ask for or repeat an API key in a reply.
