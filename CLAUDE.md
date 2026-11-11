# RepostRx

RepostRx is a portfolio app for an AI Support Engineer application. It turns an article into scheduled social posts using the Blotato API, then explains any failed posts in plain English.

## How to work with me

- I'm learning. Before every change, explain in plain English what you're about to do and why.
- Keep changes small: one idea per change, so I can follow and review each step.

## Stack

- **Front end:** plain HTML and JavaScript, hosted on Netlify. No framework.
- **Back end:** Netlify Functions. They hold the API keys and call Blotato on the front end's behalf.
- **Blotato REST API:** creates, schedules and checks social posts.
- **n8n:** scheduled polling of post status.

## Rules

- Never read, print or commit `.env`.
- Never put API keys in front-end code. Keys live only in Netlify Functions (via environment variables).
- Ask before running any command or tool that publishes a post.

## Reference

- `LOG.md`: my build log of real errors, their causes, and customer-style replies.
