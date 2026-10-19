const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Query string values can carry tokens; keep only the parameter names. */
export function safeUrl(url: string, max = 200): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.keys()];
    return clip(`${u.origin}${u.pathname}${params.length ? `?${params.map((k) => `${k}=…`).join('&')}` : ''}`, max);
  } catch {
    return clip(url.split(/[?#]/)[0], max);
  }
}

export function originOfUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
