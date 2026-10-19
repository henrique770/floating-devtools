/**
 * Masks secrets and personal data in free text before it leaves the browser (AI provider,
 * reports). Errs on the side of masking: a false positive costs a little context, a false
 * negative leaks a credential.
 *
 * Masked values become `[REDACTED:<kind>]`, so readers (and the model) know something was there.
 */

export type RedactionKind =
  | 'private-key'
  | 'jwt'
  | 'token'
  | 'api-key'
  | 'credentials'
  | 'secret'
  | 'email'
  | 'cpf'
  | 'card';

export interface Redaction {
  text: string;
  /** How many values of each kind were masked. */
  found: Partial<Record<RedactionKind, number>>;
  total: number;
}

const tag = (kind: RedactionKind) => `[REDACTED:${kind}]`;

/** Field names whose values are secrets, matched at the end of the name (accessToken, x-api-key, user_password). */
const SENSITIVE_NAME =
  '[\\w.-]*?(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|authorization|auth|session[_-]?id|sessionid|sid|cookie|credentials?|signature|otp|cvv|cvc|ssn)';

interface Pattern {
  kind: RedactionKind;
  re: RegExp;
  /** Replacement; defaults to the tag. */
  replace?: (match: string, ...groups: string[]) => string;
  /** Extra check on the match (e.g. Luhn for card numbers). */
  accept?: (match: string) => boolean;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double && (d *= 2) > 9) d -= 9;
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Order matters: specific formats first, so a JWT inside "token=..." is reported as a JWT.
const PATTERNS: Pattern[] = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  {
    kind: 'api-key',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\b(?:sk|rk|pk)_(?:live|test)_[0-9a-zA-Z]{16,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b|\bnpm_[A-Za-z0-9]{36}\b|\bglpat-[A-Za-z0-9_-]{20}\b/g,
  },
  {
    kind: 'token',
    re: /\b(Bearer|Basic|Token|Digest|Negotiate)\s+([A-Za-z0-9._~+/=-]{8,})/gi,
    replace: (_m, scheme) => `${scheme} ${tag('token')}`,
  },
  {
    // user:password@host in URLs
    kind: 'credentials',
    re: /\b([a-z][\w+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    replace: (_m, scheme) => `${scheme}${tag('credentials')}@`,
  },
  {
    // "password": "x" · password=x · api_key: x · ?token=x&  (JSON, query strings, headers, logs)
    kind: 'secret',
    re: new RegExp(`(["']?)\\b(${SENSITIVE_NAME})\\1(\\s*[:=]\\s*)(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|([^\\s"',;&}\\])]+))`, 'gi'),
    replace: (m, q, name, sep, dq, sq, bare) => {
      const value = dq ?? sq ?? bare ?? '';
      // Already masked, empty/literal, or an auth scheme whose token the 'token' pattern already masked.
      if (!value || value.startsWith('[REDACTED') || /^(?:null|undefined|true|false|Bearer|Basic|Token|Digest|Negotiate)$/i.test(value)) return m;
      const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '';
      return `${q}${name}${q}${sep}${quote}${tag('secret')}${quote}`;
    },
  },
  {
    kind: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    // icon@2x.png is a file name, not an address.
    accept: (m) => !/\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|m?js|map|woff2?)$/i.test(m),
  },
  { kind: 'cpf', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  {
    kind: 'card',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    // Card brand prefixes + Luhn: keeps epoch-ms timestamps (17…) and ids out.
    accept: (m) => {
      const digits = m.replace(/\D/g, '');
      return /^(?:4|5[1-5]|2[2-7]|3[47]|6(?:011|5))/.test(digits) && luhn(digits);
    },
  },
];

export function redact(input: string): Redaction {
  const found: Redaction['found'] = {};
  let total = 0;
  let text = input;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    text = text.replace(p.re, (match: string, ...rest: unknown[]) => {
      if (p.accept && !p.accept(match)) return match;
      const groups = rest.slice(0, -2) as string[];
      const out = p.replace ? p.replace(match, ...groups) : tag(p.kind);
      if (out !== match) {
        found[p.kind] = (found[p.kind] ?? 0) + 1;
        total++;
      }
      return out;
    });
  }
  return { text, found, total };
}

export const redactText = (input: string) => redact(input).text;

const KIND_LABEL: Record<RedactionKind, string> = {
  'private-key': 'chave privada',
  jwt: 'JWT',
  token: 'token',
  'api-key': 'chave de API',
  credentials: 'credencial em URL',
  secret: 'segredo',
  email: 'e-mail',
  cpf: 'CPF',
  card: 'cartão',
};

/** "2 JWT, 1 e-mail" */
export function describeRedactions(found: Redaction['found']): string {
  return (Object.entries(found) as [RedactionKind, number][]).map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join(', ');
}
