# wytui

A self-hosted web UI for [yt-dlp](https://github.com/yt-dlp/yt-dlp), built with SvelteKit 5. Download videos from any yt-dlp compatible platform.

## Features

- **Download profiles** — Pre-configured presets (4K, 1080p, 720p, 480p, MP3, AAC, FLAC) and custom profiles
- **Two-tier storage** — Temporary cache with configurable quota + permanent library organized by uploader
- **Jellyfin integration** — Auto library scan, thumbnail artwork, and deep-link to Jellyfin search
- **Subscriptions** — Monitor channels/playlists, auto-download new content on a schedule; backfill by date or download entire channels
- **YouTube channel & playlist sync** — Link your YouTube account via the browser extension to import your real subscriptions as monitors (with OPML/CSV export) and sync your playlists, including Watch Later and Liked videos
- **YouTube search** — Search YouTube directly from wytui, filter by type/sort/date/duration, and download results in one click
- **Livestream monitors** — Watch livestreams, auto-download when live
- **File reconciliation** — Automatically detects and removes DB records for files deleted externally (e.g. via Jellyfin)
- **Real-time progress** — Server-Sent Events for live download status
- **OIDC authentication** — OpenID Connect SSO with admin/user roles
- **Mobile-friendly** — Web Share API on iOS for save-to-photos

## Quick Start

### Docker Compose

The `docker-init.sh` script automatically generates secure random credentials on first run:

```bash
./docker-init.sh up -d
```

This creates a `.env` file with secure random passwords. The file is auto-generated if it doesn't exist.

**Manual setup** (if you prefer):

```bash
# Generate secure secrets
export POSTGRES_PASSWORD=$(openssl rand -hex 32)
export AUTH_SECRET=$(openssl rand -hex 32)

# Save to .env file
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" > .env
echo "AUTH_SECRET=$AUTH_SECRET" >> .env

docker compose up -d
```

> 💾 **Important**: The `.env` file contains your database password. Back it up securely!

### Helm

```bash
helm install wytui oci://ghcr.io/willuhmjs/wytui
```

With custom values:

```bash
helm install wytui oci://ghcr.io/willuhmjs/wytui -f values.yaml
```

Or via the classic chart repository, if you prefer `helm repo add`/`helm search`:

```bash
helm repo add wytui https://charts.wytui.willuhmjs.com
helm repo update
helm install wytui wytui/wytui
```

The chart includes a bundled PostgreSQL by default. To use an external database:

```yaml
postgresql:
  enabled: false
  secret:
    url: 'postgresql://user:pass@host:5432/wytui?schema=public'
```

### Environment Variables

| Variable             | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                                          |
| `AUTH_SECRET`        | Session signing secret                                                |
| `AUTH_TRUST_HOST`    | Set `true` behind a reverse proxy (optional)                          |
| `ORIGIN`             | Public URL of the app (optional, defaults to `http://localhost:3000`) |
| `ADMIN_USERNAME`     | Auto-create admin user, skipping the setup wizard (optional)          |
| `ADMIN_PASSWORD`     | Password for the auto-created admin user (optional)                   |
| `OIDC_ISSUER_URL`    | OIDC issuer URL (optional)                                            |
| `OIDC_CLIENT_ID`     | OIDC client ID (optional)                                             |
| `OIDC_CLIENT_SECRET` | OIDC client secret (optional)                                         |
| `OIDC_DISPLAY_NAME`  | OIDC provider display name (optional, defaults to "SSO")              |

## OIDC Authentication

wytui supports OpenID Connect for single sign-on. Set the `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` environment variables to enable it.

When configuring your OIDC provider, use the following redirect URL:

```
https://<your-wytui-domain>/auth/oidc/callback
```

Users who sign in via OIDC are created with a default `user` role. An admin can promote them from the admin panel.

## Jellyfin Integration

wytui organizes the video library as `<channel>/<video>/<video>.<ext>`, which maps directly onto Jellyfin's **TV Shows** library model: each channel becomes a show, each video an episode. wytui writes Kodi-compatible NFO metadata alongside every video (season = upload year, episode = index within that year), so episodes appear in release order without any online metadata matching. Do **not** use a Home Videos library — it shows folder names in alphabetical order and loses the timeline.

### Setup

1. In Jellyfin: Dashboard → API Keys → create a key.
2. In wytui: Settings → Jellyfin → enter the server URL and API key.
3. If wytui and Jellyfin run in different containers, set the **path mapping** so the setup compares and creates paths as Jellyfin sees them: `wytui path` is the mount prefix inside the wytui container, `Jellyfin path` the same volume's prefix inside the Jellyfin container — e.g. `/media` → `/media/youtube` when wytui mounts a subpath of a volume Jellyfin sees whole. Leave both empty when the containers use identical paths.
4. Click **Set up library**. wytui creates (or repairs) the Jellyfin library via the API: collection type TV Shows, online metadata providers disabled, NFO-only. If an existing library of another type (e.g. Home Videos) points at the same path, it is rebuilt — Jellyfin's watch history for that library resets, media files are untouched.
5. Click **Write NFO metadata** once to backfill `tvshow.nfo` + per-episode `.nfo` for videos already in the library.

After that everything is automatic: every video saved to the library gets artwork (16:9 episode thumbs + a 2:3 channel poster), an NFO file, and a Jellyfin library scan trigger. If a music library path is configured, the same button sets up a Music library for it.

## Tech Stack

- **Frontend**: SvelteKit 5 (Svelte with runes)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Auth.js with OIDC support
- **Real-time**: Server-Sent Events (SSE)
- **Styling**: Custom dark theme CSS

## Legal Disclaimer

This software is provided "as is" for personal and educational use. Users are solely responsible for ensuring their use complies with all applicable laws, terms of service, and copyright regulations. The developers assume no liability for misuse.

## License

MIT License — see LICENSE file for details. The MIT license covers this software's code only; it does not grant rights to any third-party content.
