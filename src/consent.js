// Consent state, cookie format, and category gating. Pure functions only.

export const COOKIE_NAME = 'tc_consent';
export const VERSION = 1;
export const CATEGORIES = ['essential', 'analytics', 'marketing', 'personalization'];
export const OPTIONAL_CATEGORIES = ['analytics', 'marketing', 'personalization'];

/**
 * State used before the visitor makes a choice.
 * opt-in: everything optional is off. opt-out: everything optional is on,
 * except marketing when the browser sends a Global Privacy Control signal.
 */
export function defaultConsent({ mode = 'opt-in', gpc = false } = {}) {
  const allow = mode === 'opt-out';
  return {
    v: VERSION,
    t: null,
    chosen: false,
    essential: true,
    analytics: allow,
    marketing: allow && !gpc,
    personalization: allow,
  };
}

/** Build a stored decision from the current state plus the visitor's changes. */
export function createConsent(current, changes = {}, now = new Date()) {
  const next = { ...current, v: VERSION, t: now.toISOString(), chosen: true, essential: true };
  for (const category of OPTIONAL_CATEGORIES) {
    if (category in changes) next[category] = Boolean(changes[category]);
  }
  return next;
}

/** `{ analytics: value, marketing: value, personalization: value }` */
export function allConsent(value) {
  const out = {};
  for (const category of OPTIONAL_CATEGORIES) out[category] = Boolean(value);
  return out;
}

export function serializeConsent(consent) {
  return encodeURIComponent(
    JSON.stringify({
      v: VERSION,
      t: consent.t,
      a: consent.analytics ? 1 : 0,
      m: consent.marketing ? 1 : 0,
      p: consent.personalization ? 1 : 0,
    }),
  );
}

/** Returns a consent record, or null when the value is missing, malformed, or from another version. */
export function parseConsent(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw));
    if (!data || data.v !== VERSION || typeof data.t !== 'string') return null;
    return {
      v: VERSION,
      t: data.t,
      chosen: true,
      essential: true,
      analytics: data.a === 1,
      marketing: data.m === 1,
      personalization: data.p === 1,
    };
  } catch {
    return null;
  }
}

export function readCookie(cookieString, name) {
  for (const part of String(cookieString || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function cookieString(name, value, { days = 180, secure = false } = {}) {
  const maxAge = Math.round(days * 86400);
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function isAllowed(consent, category) {
  if (category === 'essential') return true;
  return consent[category] === true;
}

/** "analytics, marketing" -> ["analytics", "marketing"] */
export function parseCategories(attr) {
  return String(attr || '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** A tag that lists several categories runs only when every one of them is allowed. */
export function categoriesAllowed(consent, categories) {
  const list = Array.isArray(categories) ? categories : parseCategories(categories);
  if (list.length === 0) return false;
  return list.every((category) => isAllowed(consent, category));
}

/** True when a category that used to be allowed is now denied. */
export function isDowngrade(previous, next) {
  return OPTIONAL_CATEGORIES.some((category) => previous[category] && !next[category]);
}
