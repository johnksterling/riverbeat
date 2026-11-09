import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  exp: number;
}

export interface AuthConfig {
  googleClientId: string;
  allowedEmails: Set<string>;
  sessionSecret: string;
}

export function getAuthConfigFromEnv(): AuthConfig {
  const googleClientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
  const rawEmails = (process.env.ALLOWED_EMAILS ?? '').trim();
  const allowedEmails = new Set(
    rawEmails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  const sessionSecret =
    (process.env.AUTH_SECRET ?? '').trim() ||
    crypto
      .createHash('sha256')
      .update(`riverbeat-secret-${googleClientId || 'local'}`)
      .digest('hex');

  return {
    googleClientId,
    allowedEmails,
    sessionSecret,
  };
}

export function signSessionToken(user: Omit<AuthUser, 'exp'>, secret: string, ttlDays = 30): string {
  const payload: AuthUser = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): AuthUser | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as AuthUser;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string
): Promise<{ email: string; name: string; picture?: string }> {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error('Invalid Google ID token');
  }

  const data = (await res.json()) as {
    aud?: string;
    email?: string;
    email_verified?: string;
    name?: string;
    picture?: string;
  };

  if (data.aud !== expectedClientId) {
    throw new Error('Google token client ID mismatch');
  }
  if (data.email_verified !== 'true' || !data.email) {
    throw new Error('Google account email is not verified');
  }

  return {
    email: data.email.toLowerCase(),
    name: data.name || data.email,
    picture: data.picture,
  };
}

export function createAuthMiddleware(config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If GOOGLE_CLIENT_ID is not configured, auth is bypassed (local dev mode)
    if (!config.googleClientId) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const token = bearerToken || queryToken;

    const user = verifySessionToken(token, config.sessionSecret);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please sign in with Google.' });
      return;
    }

    if (config.allowedEmails.size > 0 && !config.allowedEmails.has(user.email.toLowerCase())) {
      res.status(403).json({
        error: `Access denied: ${user.email} is not on the ALLOWED_EMAILS list.`,
      });
      return;
    }

    next();
  };
}
