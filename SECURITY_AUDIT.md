# Security Audit Report
**Date:** 2026-04-26  
**Auditor:** Claude Opus 4.7  
**Scope:** Complete application security review + recent changes (commits f3a409e, 5a4c03c)

---

## CRITICAL VULNERABILITIES (Immediate Action Required)

### 1. Unsigned Session Tokens - Authentication Bypass
**Severity:** CRITICAL  
**File:** `src/lib/server/auth.ts:18-25`, `src/hooks.server.ts:22`  
**CWE:** CWE-347 (Improper Verification of Cryptographic Signature)

**Issue:**  
Session tokens are base64-encoded JSON with no cryptographic signature or encryption. Attackers can:
1. Decode the session token
2. Change `isAdmin: false` to `isAdmin: true`
3. Re-encode to base64
4. Become admin instantly

**Proof of Concept:**
```javascript
// Current token format (base64 of this JSON):
{"userId":"abc123","email":"user@example.com","isAdmin":false,"exp":1746000000000}

// Attacker decodes, changes isAdmin to true, re-encodes
// Now they have full admin access
```

**Impact:**  
- Complete authentication bypass
- Privilege escalation to admin
- Full system compromise

**Fix:**  
Use signed JWTs with `jsonwebtoken` library or SvelteKit's built-in session handling with a secret key.

```typescript
import jwt from 'jsonwebtoken';

const SESSION_SECRET = process.env.SESSION_SECRET; // Add to .env

export function issueSessionCookie(cookies: Cookies, user: SessionUser): void {
    const sessionToken = jwt.sign(
        { userId: user.id, email: user.email, isAdmin: user.isAdmin },
        SESSION_SECRET,
        { expiresIn: '30d' }
    );
    // ... rest of cookie settings
}

// In hooks.server.ts:
const sessionData = jwt.verify(sessionToken, SESSION_SECRET);
```

---

### 2. Insecure Direct Object Reference (IDOR) - File Downloads
**Severity:** CRITICAL  
**File:** `src/routes/api/files/[id]/+server.ts:59-65`  
**CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key)

**Issue:**  
Authorization check only runs if user is authenticated. Unauthenticated users can download ANY file by ID.

```typescript
// Line 59-65 - VULNERABLE CODE:
if (locals.session?.user?.id && download.userId !== locals.session.user.id) {
    throw error(403, 'Access denied');
}
// If no session, check is skipped entirely!
```

**Impact:**  
- Unauthenticated users can download any file
- Authenticated non-admin users can download other users' files
- Privacy violation, data theft

**Fix:**
```typescript
// Require authentication first
if (!locals.session?.user?.id) {
    throw error(401, 'Authentication required');
}

// Then check ownership
if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
    throw error(403, 'Access denied');
}
```

---

### 3. IDOR - List All Users' Downloads
**Severity:** CRITICAL  
**File:** `src/lib/server/services/download.service.ts:353-354`, `src/routes/api/downloads/+server.ts:53`  
**CWE:** CWE-639

**Issue:**  
`listDownloads()` only filters by userId if provided. Unauthenticated requests get ALL downloads from ALL users.

```typescript
// Line 353-354 - VULNERABLE:
if (userId !== undefined && userId !== null) {
    where.userId = userId;
}
// If userId is undefined, no filter = return everything
```

**Impact:**  
- Information disclosure of all users' downloads
- Privacy violation
- Enumerate all download URLs, titles, metadata

**Fix:**
```typescript
// In download.service.ts:
async listDownloads(userId?: string, status?: DownloadStatus, limit = 50, offset = 0) {
    if (!userId) {
        throw new Error('User ID required');
    }
    // ... rest of the code with userId always in where clause
}

// In +server.ts:
if (!locals.session?.user?.id) {
    throw error(401, 'Authentication required');
}
const userId = locals.session.user.id;
```

---

### 4. IDOR - Get/Delete/Cancel Any Download
**Severity:** CRITICAL  
**Files:**
- `src/routes/api/downloads/[id]/+server.ts:9, 29`
- `src/routes/api/downloads/[id]/cancel/+server.ts:9`  
**CWE:** CWE-639

**Issue:**  
No authorization checks. Anyone can get details of, delete, or cancel any download without authentication.

**Impact:**  
- Delete other users' downloads
- Cancel active downloads
- Information disclosure
- Denial of service

**Fix:**
```typescript
export const GET: RequestHandler = async ({ params, locals }) => {
    if (!locals.session?.user?.id) {
        throw error(401, 'Authentication required');
    }
    
    const download = await downloadService.getDownload(params.id);
    
    if (!download) {
        throw error(404, 'Download not found');
    }
    
    // Check ownership
    if (download.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
        throw error(403, 'Access denied');
    }
    
    return json(download);
};
```

Apply same pattern to DELETE and cancel endpoints.

---

### 5-7. IDOR - Subscription Endpoints
**Severity:** CRITICAL  
**File:** `src/routes/api/subscriptions/[id]/+server.ts:10, 33, 63`  
**CWE:** CWE-639

**Issue:**  
GET, PATCH, and DELETE subscription endpoints have no authorization checks.

**Impact:**  
- Read any subscription details
- Modify any subscription (enable/disable, change settings)
- Delete any subscription
- Denial of service

**Fix:**  
Add authentication and ownership checks to all three methods:
```typescript
export const GET: RequestHandler = async ({ params, locals }) => {
    if (!locals.session?.user?.id) {
        throw error(401, 'Authentication required');
    }
    
    const subscription = await prisma.subscription.findUnique({
        where: { id: params.id },
        include: { profile: true, downloads: { take: 10 } },
    });
    
    if (!subscription) {
        throw error(404, 'Subscription not found');
    }
    
    // Check ownership
    if (subscription.userId !== locals.session.user.id && !locals.session.user.isAdmin) {
        throw error(403, 'Access denied');
    }
    
    return json(subscription);
};
```

Same pattern for PATCH and DELETE.

---

### 8. IDOR - Monitor Endpoints
**Severity:** CRITICAL  
**File:** `src/routes/api/monitors/[id]/+server.ts` (inferred from subscriptions pattern)  

**Impact:**  
Similar IDOR vulnerabilities likely exist for monitor endpoints.

**Fix:**  
Review and add authorization checks similar to subscriptions.

---

## HIGH SEVERITY VULNERABILITIES

### 9. Missing CSRF Protection
**Severity:** HIGH  
**File:** All API endpoints  
**CWE:** CWE-352

**Issue:**  
No CSRF tokens on state-changing operations (POST, PUT, PATCH, DELETE).

**Impact:**  
- Attackers can trick users into performing actions (create downloads, delete data, modify settings)

**Fix:**  
SvelteKit provides CSRF protection via origin checking. Ensure it's enabled:
1. Set proper `ORIGIN` environment variable in production
2. Consider adding custom CSRF tokens for sensitive operations

---

### 10. Weak Password Requirements
**Severity:** MEDIUM  
**File:** `src/lib/server/auth.ts:66-68`  

**Issue:**  
Only requires 8 characters, no complexity requirements.

**Recommendation:**  
Add requirements for uppercase, lowercase, numbers, special characters. Consider using `zxcvbn` for password strength estimation.

---

### 11. Session Expiration Not Enforced on Cookie
**Severity:** MEDIUM  
**File:** `src/hooks.server.ts:24-25`  

**Issue:**  
Expiration is checked in session data, but if attacker creates fake session (due to #1), they control expiration.

**Fix:**  
This is automatically fixed when implementing signed JWTs (fix for #1).

---

## RECENT CHANGES REVIEW

### Auto Sign-in Implementation (f3a409e)
**Status:** Vulnerable due to unsigned session tokens (Issue #1), but otherwise implemented correctly.

The implementation properly:
- Validates input in setup endpoint
- Checks for existing users
- Hashes passwords with bcrypt
- Issues session cookie

However, the session cookie mechanism itself is fundamentally insecure (see Issue #1).

### Dashboard Consolidation (5a4c03c)
**Status:** No new vulnerabilities introduced.

The client-side consolidation is safe. All existing backend vulnerabilities remain.

---

## MEDIUM/LOW SEVERITY ISSUES

### 12. Sensitive Data in Logs
**Severity:** LOW  
**Files:** Multiple service files  

**Issue:**  
Console.log statements may log sensitive data (user IDs, file paths, etc.)

**Recommendation:**  
Review logging; remove or redact sensitive information in production.

---

### 13. No Rate Limiting
**Severity:** MEDIUM  
**File:** All API endpoints  

**Issue:**  
No rate limiting on API endpoints allows brute force attacks, resource exhaustion.

**Recommendation:**  
Implement rate limiting using `@sveltejs/kit` hooks or a library like `express-rate-limit`.

---

### 14. Error Message Information Disclosure
**Severity:** LOW  
**Files:** Multiple API endpoints  

**Issue:**  
Some error messages expose internal details (`e.message` directly returned to client).

**Recommendation:**  
Sanitize error messages; log full details server-side, return generic messages to clients.

---

## AREAS THAT ARE SECURE

✅ **Command Injection Prevention** - ytdlp.service.ts properly validates URLs and filters dangerous flags  
✅ **Path Traversal Prevention** - File downloads validate paths against allowed directory  
✅ **SQL Injection** - Prisma ORM protects against SQL injection  
✅ **XSS** - Svelte auto-escapes output by default  
✅ **Password Hashing** - bcrypt with proper cost factor (10)  
✅ **Secure Cookies** - httpOnly, sameSite, secure in production  

---

## PRIORITY FIX ORDER

1. **IMMEDIATE:** Fix unsigned session tokens (#1) - enables all other attacks
2. **IMMEDIATE:** Add authorization checks to ALL API endpoints (#2-8)
3. **HIGH:** Enable CSRF protection (#9)
4. **MEDIUM:** Add rate limiting (#13)
5. **MEDIUM:** Improve password requirements (#10)
6. **LOW:** Review and sanitize logs (#12) and error messages (#14)

---

## TESTING RECOMMENDATIONS

After fixes:
1. Test authentication bypass attempts (modify JWT, expired tokens)
2. Test IDOR on all endpoints (try accessing other users' resources)
3. Test CSRF protection
4. Security scan with tools like OWASP ZAP or Burp Suite
5. Penetration testing engagement

---

## CONCLUSION

**Current Security Posture: CRITICAL RISK**

The application has multiple critical vulnerabilities that allow:
- Complete authentication bypass
- Unauthorized access to all user data
- Modification and deletion of any resource

**DO NOT deploy to production** until critical vulnerabilities #1-8 are fixed.

Estimated time to fix critical issues: 2-4 hours  
Recommended timeline: Fix within 24 hours
