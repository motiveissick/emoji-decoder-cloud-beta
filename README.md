# Emoji Decoder Cloud Beta

Invite-only multi-streamer hosting for Kick Emoji Decoder overlays.

## Features

- One central Kick OAuth application
- Invite-code streamer onboarding
- Isolated PostgreSQL scores per channel
- Encrypted Kick OAuth tokens
- Signed Kick webhook verification and delivery deduplication
- Private, revocable OBS overlay tokens
- Automatic rounds and multi-winner scoring
- Daily, weekly and all-time leaderboards

## Render deployment

1. Create a private GitHub repository containing this folder.
2. In Render, create a Blueprint from the repository's `render.yaml`.
3. Set `PUBLIC_URL` to the assigned `https://...onrender.com` URL.
4. Set the central Kick application's Client ID and Client Secret.
5. Set comma-separated private `INVITE_CODES`.
6. Configure the Kick OAuth redirect as `PUBLIC_URL/auth/kick/callback`.
7. Configure the Kick webhook as `PUBLIC_URL/webhooks/kick`.

The Blueprint requests an always-on Starter web service and Basic PostgreSQL database. Review Render billing before applying it.

## Local development

Copy `.env.example` to `.env`, provide a PostgreSQL connection, then run:

```sh
npm install
npm start
```
