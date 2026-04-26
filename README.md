# wytui

> **Pronunciation**: /ˈwaɪti/ (like "whitey" or "Y.T.")

Modern web interface for yt-dlp. Download videos with a clean UI, real-time progress, and quality presets.

![License](https://img.shields.io/github/license/willuhmjs/wytui)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?logo=docker&logoColor=white)

## Features

- Real-time download progress with SSE
- Quality presets (4K, 1080p, 720p, audio-only)
- Channel subscriptions with auto-download
- Livestream monitoring
- Multi-user support with authentication
- Dark theme UI

## Quick Start

```bash
docker run -d \
  -p 3000:3000 \
  -v ./downloads:/downloads \
  -e DATABASE_URL="your-postgres-url" \
  -e AUTH_SECRET="change-me" \
  ghcr.io/willuhmjs/wytui:latest
```

Or use Docker Compose:

```yaml
services:
  wytui:
    image: ghcr.io/willuhmjs/wytui:latest
    ports:
      - "3000:3000"
    volumes:
      - ./downloads:/downloads
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/wytui
      - AUTH_SECRET=change-this-secret
    depends_on:
      - db

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: wytui
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Visit `http://localhost:3000` and create your admin account.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | - | Secret for session encryption |
| `AUTH_TRUST_HOST` | No | `true` | Trust proxy headers |
| `PORT` | No | `3000` | Server port |

## Development

```bash
git clone https://github.com/willuhmjs/wytui.git
cd wytui
docker-compose up
```

Access the dev server at `http://localhost:5173`

## Tech

- **Frontend**: SvelteKit 5
- **Backend**: Node.js
- **Database**: PostgreSQL + Prisma
- **Downloader**: yt-dlp
- **Auth**: Custom bcrypt-based

## License

MIT

## Credits

Built by [@willuhmjs](https://github.com/willuhmjs). Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp).
