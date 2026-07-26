/**
 * Confirmation and unsubscribe tokens.
 *
 * Two independent protections, deliberately layered:
 *
 *  1. **The token is signed.** It carries its own purpose, subject and expiry,
 *     authenticated by HMAC-SHA256 over `ALERT_TOKEN_SECRET`. A forged or edited
 *     token is rejected before any database work happens, so an attacker cannot
 *     use the endpoint to probe which addresses exist.
 *  2. **Only the token's SHA-256 is stored.** The raw string exists solely in
 *     the email that carried it. A dump of `alert_subscriptions` therefore
 *     yields no working link — the hash cannot be turned back into one.
 *
 * Every comparison of a secret value uses `timingSafeEqual`. A naive `===` on an
 * HMAC leaks its prefix through response timing, which over enough attempts is
 * enough to forge one.
 *
 * Pure Node crypto and pure functions: no database, no network, no clock beyond
 * the injectable `now`. That keeps the module unit-testable in isolation.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** What a token is allowed to do. Bound into the signature, so a confirmation
 *  link can never be replayed as an unsubscribe link. */
export type TokenPurpose = 'confirm' | 'unsubscribe';

export type TokenPayload = {
  /** Format version, so the scheme can change without invalidating live links. */
  v: 1;
  p: TokenPurpose;
  /** Subject — the normalised email address the token speaks for. */
  s: string;
  /**
   * Random nonce, or the empty string for a deterministic token.
   *
   * A nonce makes every issued confirmation token unique, which is what lets a
   * re-subscribe invalidate the previous confirmation link.
   */
  n: string;
  /** Issued at, epoch seconds. */
  i: number;
  /** Expires at, epoch seconds. `null` means it never expires. */
  e: number | null;
};

/**
 * Confirmation links expire after 48 hours.
 *
 * Long enough to survive a weekend and a slow mail server; short enough that a
 * link sitting in an abandoned inbox stops being usable.
 */
export const CONFIRMATION_TOKEN_TTL_SECONDS = 48 * 60 * 60;

/**
 * Unsubscribe links never expire.
 *
 * An expired unsubscribe link is a dark pattern: someone finding a two-year-old
 * email must still be able to stop the mail in one click, without an account.
 */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = null;

function getSecret(): string | null {
  const secret = process.env.ALERT_TOKEN_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

/**
 * Whether tokens can be issued or verified at all.
 *
 * Alerts stay switched off without a secret rather than falling back to an
 * unsigned or hard-coded one — an unsigned unsubscribe token would let anyone
 * unsubscribe anyone.
 */
export function isTokenSecretConfigured(): boolean {
  return getSecret() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest();
}

/**
 * SHA-256 of the complete token string, hex encoded.
 *
 * This — never the token — is what goes in the database.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type IssuedToken = {
  /** Goes in the email. Never persisted. */
  token: string;
  /** Goes in the database. Never emailed. */
  tokenHash: string;
  expiresAt: Date | null;
};

export type CreateTokenInput = {
  purpose: TokenPurpose;
  /** The subscriber's normalised (lower-cased, trimmed) email address. */
  subject: string;
  /** Overrides the purpose's default lifetime. `null` means no expiry. */
  ttlSeconds?: number | null;
  /**
   * Produce the same token every time for the same subject.
   *
   * Required for unsubscribe tokens, and the reason is structural: only the
   * token's HASH is stored, so a re-subscribe cannot mint a fresh unsubscribe
   * token without either overwriting the stored hash — which would silently
   * break the unsubscribe link in every email already delivered — or emailing a
   * link whose hash is not on file. Deriving it deterministically from the
   * secret sidesteps both. Rotating `ALERT_TOKEN_SECRET` invalidates all
   * outstanding unsubscribe links, so it should be treated as a long-lived key.
   */
  deterministic?: boolean;
};

/**
 * Issue a token.
 *
 * @returns `null` when `ALERT_TOKEN_SECRET` is unset — the caller must then
 *          report that alerts are unavailable rather than sending an unusable
 *          link.
 */
export function createToken(input: CreateTokenInput, now: Date = new Date()): IssuedToken | null {
  const secret = getSecret();
  if (!secret) return null;

  const issuedAt = Math.floor(now.getTime() / 1000);
  const ttl =
    input.ttlSeconds !== undefined
      ? input.ttlSeconds
      : input.purpose === 'confirm'
        ? CONFIRMATION_TOKEN_TTL_SECONDS
        : UNSUBSCRIBE_TOKEN_TTL_SECONDS;

  const deterministic = input.deterministic ?? input.purpose === 'unsubscribe';

  const payload: TokenPayload = {
    v: 1,
    p: input.purpose,
    s: input.subject,
    n: deterministic ? '' : randomBytes(12).toString('base64url'),
    // A deterministic token must not embed the moment it was issued, or it would
    // differ on every call and defeat the point.
    i: deterministic ? 0 : issuedAt,
    e: ttl === null ? null : (deterministic ? 0 : issuedAt) + ttl,
  };

  const encoded = base64url(JSON.stringify(payload));
  const token = `${encoded}.${base64url(sign(encoded, secret))}`;

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: payload.e === null ? null : new Date(payload.e * 1000),
  };
}

export type VerifyFailureReason =
  'not_configured' | 'malformed' | 'bad_signature' | 'wrong_purpose' | 'expired';

export type VerifyResult =
  | { valid: true; payload: TokenPayload; tokenHash: string }
  | { valid: false; reason: VerifyFailureReason };

/**
 * Verify a token's signature, purpose and expiry.
 *
 * Deliberately does NOT touch the database. Callers verify first and only then
 * look the hash up, so an unauthenticated request never causes a query — which
 * is what keeps the endpoints from becoming a timing oracle for address
 * existence.
 */
export function verifyToken(
  token: string,
  expectedPurpose: TokenPurpose,
  now: Date = new Date(),
): VerifyResult {
  const secret = getSecret();
  if (!secret) return { valid: false, reason: 'not_configured' };

  if (typeof token !== 'string' || token.length === 0 || token.length > 1024) {
    return { valid: false, reason: 'malformed' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };

  const [encoded, providedSignature] = parts;
  if (!encoded || !providedSignature) return { valid: false, reason: 'malformed' };

  const expected = sign(encoded, secret);
  const provided = Buffer.from(providedSignature, 'base64url');

  // Length is compared first because `timingSafeEqual` throws on a mismatch. The
  // length of an HMAC-SHA256 digest is a public constant, so leaking it is not a
  // weakness; leaking *where* two equal-length digests diverge would be.
  if (provided.length !== expected.length) return { valid: false, reason: 'bad_signature' };
  if (!timingSafeEqual(provided, expected)) return { valid: false, reason: 'bad_signature' };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (
    payload === null ||
    typeof payload !== 'object' ||
    payload.v !== 1 ||
    typeof payload.s !== 'string' ||
    (payload.e !== null && typeof payload.e !== 'number')
  ) {
    return { valid: false, reason: 'malformed' };
  }

  if (payload.p !== expectedPurpose) return { valid: false, reason: 'wrong_purpose' };

  if (payload.e !== null && payload.e * 1000 < now.getTime()) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload, tokenHash: hashToken(token) };
}

/**
 * The stable unsubscribe token for an address.
 *
 * Regenerable from the secret alone, so any code path that needs to put an
 * unsubscribe link in an email can produce one that matches the hash already on
 * file — including for a subscription created months earlier.
 */
export function createUnsubscribeToken(normalisedEmail: string): IssuedToken | null {
  return createToken({
    purpose: 'unsubscribe',
    subject: normalisedEmail,
    ttlSeconds: UNSUBSCRIBE_TOKEN_TTL_SECONDS,
    deterministic: true,
  });
}

/**
 * Issue the pair of tokens a new subscription needs.
 *
 * The confirmation token is fresh on every call (so re-subscribing invalidates
 * the previous link); the unsubscribe token is stable for the lifetime of the
 * address.
 *
 * @returns `null` when no secret is configured.
 */
export function createSubscriptionTokens(
  normalisedEmail: string,
  now: Date = new Date(),
): { confirmation: IssuedToken; unsubscribe: IssuedToken } | null {
  const confirmation = createToken({ purpose: 'confirm', subject: normalisedEmail }, now);
  const unsubscribe = createUnsubscribeToken(normalisedEmail);
  if (!confirmation || !unsubscribe) return null;
  return { confirmation, unsubscribe };
}
