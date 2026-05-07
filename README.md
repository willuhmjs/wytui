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

```yaml
services:
  db:
    image: postgres:18.3-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: wytui
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  migrate:
    build: .
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/wytui?schema=public
    depends_on:
      db:
        condition: service_healthy
    command: sh -c "npx prisma migrate deploy"

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/wytui?schema=public
      - AUTH_SECRET=${AUTH_SECRET}
      - AUTH_TRUST_HOST=true
      - ORIGIN=${ORIGIN:-http://localhost:3000}
      - NODE_ENV=production
      - ADMIN_USERNAME=${ADMIN_USERNAME:-}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
    volumes:
      - downloads:/downloads
      - library:/media
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully

volumes:
  pgdata:
  downloads:
  library:
```

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session signing secret |
| `AUTH_TRUST_HOST` | Set `true` behind a reverse proxy |
| `ORIGIN` | Public URL of the app (e.g. `https://wytui.example.com`) |
| `ADMIN_USERNAME` | Auto-create admin user, skipping the setup wizard (optional) |
| `ADMIN_PASSWORD` | Password for the auto-created admin user (optional) |
| `OIDC_ISSUER_URL` | OIDC issuer URL |
| `OIDC_CLIENT_ID` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | OIDC client secret |
| `OIDC_DISPLAY_NAME` | OIDC provider display name |

## Tech Stack

- **Frontend**: SvelteKit 5 (Svelte with runes)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Auth.js with OIDC support
- **Real-time**: Server-Sent Events (SSE)
- **Styling**: Custom dark theme CSS

## License

MIT
