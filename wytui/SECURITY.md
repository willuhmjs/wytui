# Security Policy

## Overview

wytui implements several security measures to protect against common vulnerabilities. However, **the current authentication system is in DEMO MODE** and should NOT be used in production without modifications.

## Current Security Measures

### 1. Command Injection Protection

**Location**: `src/lib/server/services/ytdlp.service.ts`

- **URL Validation**: All URLs are validated before being passed to yt-dlp
  - Protocol restrictions (HTTP/HTTPS only)
  - Shell metacharacter filtering (`;`, `&&`, `||`, `|`, `$`, `` ` ``)
  - Proper URL format validation

- **Dangerous Flag Filtering**: Custom yt-dlp flags are filtered to prevent code execution
  - Blocks: `--exec`, `--exec-before-download`, `--config-location`, `--batch-file`, etc.
  - Pattern matching for shell metacharacters
  - Logging of filtered flags for audit

- **Filename Sanitization**: 
  - `--restrict-filenames` flag enforced
  - Path traversal prevention (`../` removed)

### 2. Path Traversal Protection

**Location**: `src/routes/api/files/[id]/+server.ts`

- **Directory Validation**: All file paths are validated to ensure they're within the allowed download directory
- **Path Normalization**: Uses `resolve()` and `normalize()` to prevent traversal attacks
- **Ownership Verification**: Users can only download their own files when authenticated

### 3. Input Validation

**Locations**: All API route handlers

- **URL Format Validation**: All URLs must be valid HTTP(S) URLs
- **Type Validation**: All inputs are type-checked before processing
- **Range Validation**: 
  - Pagination limits: 1-100 items per request
  - Subscription intervals: 60-86400 seconds
  - Max videos per subscription: 1-100

- **Profile Verification**: Profile IDs are verified to exist before creating downloads

### 4. Authentication & Authorization

**Location**: `src/hooks.server.ts`, `src/lib/server/auth.ts`

- **Optional Auth Mode**: Can be toggled via settings
- **Protected Routes**: Non-public routes require authentication when enabled
- **API Protection**: Returns 401 for unauthorized API requests
- **Session Management**: Auth.js handles session tokens securely

### 5. Output Sanitization

**Location**: `src/routes/api/files/[id]/+server.ts`

- **Filename Sanitization**: Content-Disposition headers use sanitized filenames
- **Special Character Removal**: Quotes, newlines, path traversal sequences removed
- **MIME Type Validation**: Only known safe MIME types served

### 6. Data Serialization

**Location**: `src/lib/server/services/download.service.ts`

- **BigInt Serialization**: BigInt values converted to strings for JSON responses
- **Prevents JSON serialization errors**

## ⚠️ CRITICAL SECURITY WARNINGS

### 1. DEMO AUTHENTICATION MODE

**File**: `src/lib/server/auth.ts`

The current authentication accepts **ANY email/password combination**. This is for demonstration purposes ONLY.

**Required Actions Before Production**:

```typescript
// ❌ CURRENT (INSECURE):
const user = await prisma.user.upsert({
  where: { email: credentials.email },
  update: {},
  create: { email: credentials.email, name: ... }
});

// ✅ REQUIRED FOR PRODUCTION:
import bcrypt from 'bcrypt';

// On signup:
const hashedPassword = await bcrypt.hash(password, 10);
await prisma.user.create({
  email,
  password: hashedPassword
});

// On login:
const user = await prisma.user.findUnique({ where: { email } });
if (!user || !await bcrypt.compare(password, user.password)) {
  return null;
}
```

### 2. Required Production Changes

Before deploying to production:

1. **Implement Password Hashing**
   - Use bcrypt (cost factor 10-12) or argon2
   - Store only hashed passwords in database
   - Add password strength requirements

2. **Add Rate Limiting**
   ```bash
   npm install express-rate-limit
   ```
   - Limit login attempts (5 per 15 minutes)
   - Limit download creation (10 per minute)
   - Limit API requests globally

3. **Enable HTTPS**
   - Use reverse proxy (nginx, Caddy)
   - Obtain SSL certificate (Let's Encrypt)
   - Enforce HTTPS redirect

4. **Update Environment Variables**
   - Generate strong `AUTH_SECRET` (32+ random characters)
   - Set `NODE_ENV=production`
   - Review `AUTH_TRUST_HOST` setting

5. **Add CAPTCHA**
   - Implement reCAPTCHA on login form
   - Prevents brute force attacks

6. **Consider OAuth Providers**
   - Add Google, GitHub, or other OAuth providers
   - Reduces password management burden

7. **Enable Authentication by Default**
   - Set `authRequired: true` in settings
   - Don't expose instance publicly without auth

8. **Database Security**
   - Use strong PostgreSQL password
   - Don't expose port 5432 publicly
   - Enable SSL for database connections

9. **Docker Security**
   - Don't run containers as root
   - Use read-only filesystems where possible
   - Scan images for vulnerabilities

10. **Content Security Policy**
    - Add CSP headers to prevent XSS
    - Configure in `svelte.config.js`

## Reporting Vulnerabilities

If you discover a security vulnerability, please:

1. **DO NOT** open a public GitHub issue
2. Email the maintainer directly
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Best Practices for Deployment

### Network Configuration

```nginx
# nginx reverse proxy example
server {
    listen 443 ssl http2;
    server_name wytui.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    
    location / {
        proxy_pass http://localhost:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Docker Compose Production

```yaml
# Use non-root user
user: "1000:1000"

# Read-only root filesystem
read_only: true
tmpfs:
  - /tmp

# Drop capabilities
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE

# Security options
security_opt:
  - no-new-privileges:true
```

### File Permissions

```bash
# Restrict permissions on sensitive files
chmod 600 .env
chmod 700 downloads/
chown -R www-data:www-data downloads/
```

## Audit Log

| Date | Change | Impact |
|------|--------|--------|
| 2026-04-26 | URL validation added | Prevents command injection |
| 2026-04-26 | Dangerous flag filtering | Prevents code execution via --exec |
| 2026-04-26 | Path traversal protection | Prevents unauthorized file access |
| 2026-04-26 | Input validation on all APIs | Prevents malformed requests |
| 2026-04-26 | Filename sanitization | Prevents header injection |
| 2026-04-26 | Pagination limits | Prevents DoS via large requests |
| 2026-04-26 | Ownership verification | Prevents unauthorized downloads |

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Auth.js Security](https://authjs.dev/guides/basics/security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security](https://docs.docker.com/engine/security/)

## License

This security policy is part of wytui and is released under the same MIT license.
