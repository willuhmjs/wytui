# wytui

A self-hosted web UI for [yt-dlp](https://github.com/yt-dlp/yt-dlp), built with SvelteKit 5. Supports YouTube, TikTok, Twitter, and any yt-dlp compatible URL.

> *wytui* — pronounced "Y. T."

## Features

- **Download profiles** — Pre-configured presets (4K, 1080p, 720p, 480p, MP3, AAC, FLAC) and custom profiles
- **Two-tier storage** — Temporary cache with configurable quota + permanent library organized by uploader
- **Jellyfin integration** — Auto library scan, thumbnail artwork, and deep-link to Jellyfin search
- **Subscriptions** — Monitor channels/playlists, auto-download new videos on a schedule; backfill by date or download entire channel
- **Livestream monitors** — Watch YouTube Live and Twitch streams, auto-download when live
- **File reconciliation** — Automatically detects and removes DB records for files deleted externally (e.g. via Jellyfin)
- **Real-time progress** — Server-Sent Events for live download status
- **OIDC authentication** — OpenID Connect SSO with admin/user roles
- **Mobile-friendly** — Web Share API on iOS for save-to-photos

## Quick Start

### Docker Compose

Copy `.env.example` to `.env` and fill in your values, then:

```bash
docker compose up -d
```

### Helm

```bash
helm install wytui oci://ghcr.io/willuhmjs/wytui
```

With custom values:

```bash
helm install wytui oci://ghcr.io/willuhmjs/wytui -f values.yaml
```

The chart includes a bundled PostgreSQL by default. To use an external database:

```yaml
postgresql:
  enabled: false
  secret:
    url: "postgresql://user:pass@host:5432/wytui?schema=public"
```

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session signing secret |
| `AUTH_TRUST_HOST` | Set `true` behind a reverse proxy (optional) |
| `ORIGIN` | Public URL of the app (optional, defaults to `http://localhost:3000`) |
| `ADMIN_USERNAME` | Auto-create admin user, skipping the setup wizard (optional) |
| `ADMIN_PASSWORD` | Password for the auto-created admin user (optional) |
| `OIDC_ISSUER_URL` | OIDC issuer URL (optional) |
| `OIDC_CLIENT_ID` | OIDC client ID (optional) |
| `OIDC_CLIENT_SECRET` | OIDC client secret (optional) |
| `OIDC_DISPLAY_NAME` | OIDC provider display name (optional, defaults to "SSO") |

## OIDC Authentication

wytui supports OpenID Connect for single sign-on. Set the `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` environment variables to enable it.

When configuring your OIDC provider, use the following redirect URL:

```
https://<your-wytui-domain>/auth/oidc/callback
```

Users who sign in via OIDC are created with a default `user` role. An admin can promote them from the admin panel.

## Tech Stack

- **Frontend**: SvelteKit 5 (Svelte with runes)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Auth.js with OIDC support
- **Real-time**: Server-Sent Events (SSE)
- **Styling**: Custom dark theme CSS

## License

MIT
