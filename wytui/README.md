# wytui - Modern YouTube Downloader

A modern, self-hosted YouTube downloader built with SvelteKit 5, featuring download profiles, subscription monitoring, livestream detection, and optional authentication.

## Features

### Core Download System
- **Two-phase processing**: Metadata fetch → Download for optimal performance
- **Concurrent queue**: Configurable parallel downloads (default: 3)
- **Real-time progress**: Server-Sent Events (SSE) for live updates
- **Download profiles**: Pre-configured quality presets + custom profiles
  - Video: 4K, 1080p, 720p, 480p, Best, Smallest
  - Audio: MP3 (320kbps), AAC, FLAC
- **Auto-retry**: Exponential backoff (3 attempts)
- **iOS-friendly**: Share to camera roll functionality

### Subscription System
- Monitor YouTube channels/playlists for new videos
- Cron-based scheduling with configurable intervals
- Auto-download new videos with selected profile
- Archive tracking to prevent re-downloads
- Manual trigger for immediate checks

### Livestream Monitoring
- Monitor YouTube Live and Twitch streams
- Wait-for-video detection with countdown timers
- Auto-download when stream goes live
- Real-time status updates

### Background Jobs
- Subscription scheduler (node-cron)
- Livestream monitor service
- Auto-update yt-dlp (daily at 3 AM)
- Graceful startup and shutdown

### Authentication
- Auth.js integration with Prisma adapter
- Optional authentication mode (toggle in settings)
- **⚠️ Demo mode**: Currently accepts any email/password (see Security section)

## Quick Start

### Development with Docker

```bash
cd wytui
docker-compose up
```

Access:
- **App**: http://localhost:5173
- **Prisma Studio**: http://localhost:5555

### Manual Setup

```bash
# Install dependencies
npm install

# Set up database
npx prisma db push
npx prisma db seed

# Start development server
npm run dev
```

## Environment Variables

Create a `.env` file:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/wytui?schema=public"
AUTH_SECRET="your-super-secret-auth-key-change-this"
AUTH_TRUST_HOST="true"
NODE_ENV="development"
```

## Security

### Current Security Measures
- ✅ URL validation to prevent command injection
- ✅ Dangerous flag filtering for yt-dlp
- ✅ Path traversal protection on file downloads
- ✅ Input validation on all API endpoints
- ✅ Filename sanitization for Content-Disposition headers
- ✅ Auth middleware with API protection
- ✅ Pagination limits (max 100 items per request)

### ⚠️ Security Warnings

**DEMO AUTHENTICATION**: The current auth system accepts ANY email/password combination. This is for **demonstration purposes only**.

**Before deploying to production:**

1. **Implement proper authentication**:
   - Hash passwords with bcrypt or argon2
   - Validate against stored hashed passwords
   - Add rate limiting
   - Implement CAPTCHA for brute force protection
   - Consider OAuth providers (Google, GitHub, etc.)

2. **Review security settings**:
   - Change `AUTH_SECRET` to a strong random value
   - Set `AUTH_TRUST_HOST` appropriately for your deployment
   - Enable authentication (`authRequired: true` in settings)

3. **Network security**:
   - Use HTTPS in production
   - Configure proper CORS policies
   - Set up firewall rules

## Tech Stack

- **Frontend**: SvelteKit 5 (Svelte with runes)
- **Backend**: SvelteKit server routes
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Auth.js with Prisma adapter
- **Real-time**: Server-Sent Events (SSE)
- **Queue**: p-limit for concurrency control
- **Scheduler**: node-cron for background jobs
- **Styling**: Custom dark theme CSS (no frameworks)

## API Endpoints

### Downloads
- `POST /api/downloads` - Create new download
- `GET /api/downloads` - List downloads
- `DELETE /api/downloads/[id]` - Delete download
- `POST /api/downloads/[id]/cancel` - Cancel download

### Profiles
- `GET /api/profiles` - List all profiles
- `POST /api/profiles` - Create custom profile

### Subscriptions
- `GET /api/subscriptions` - List subscriptions
- `POST /api/subscriptions` - Create subscription
- `PATCH /api/subscriptions/[id]` - Update subscription
- `DELETE /api/subscriptions/[id]` - Delete subscription
- `POST /api/subscriptions/[id]/check` - Manual check

### Monitors
- `GET /api/monitors` - List monitors
- `POST /api/monitors` - Create monitor
- `PATCH /api/monitors/[id]` - Update monitor
- `DELETE /api/monitors/[id]` - Delete monitor

### Files
- `GET /api/files/[id]` - Download file

### Settings
- `GET /api/settings` - Get settings
- `PATCH /api/settings` - Update settings

### Real-time
- `GET /api/sse` - SSE event stream

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- Security best practices are followed
- Tests are included for new features
- Code follows existing patterns and style
