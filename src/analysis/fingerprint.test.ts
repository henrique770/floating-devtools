import { describe, expect, it } from 'vitest';
import type { ConsoleEntry, SerializedValue } from '../shared/types';
import { fingerprint, normalizeFrame, normalizeMessage, normalizeUrl, topFrames } from './fingerprint';

let seq = 0;
const entry = (args: SerializedValue[], extra: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: `c${++seq}`,
  level: 'error',
  args,
  time: Date.now(),
  ...extra,
});
const str = (v: string): SerializedValue => ({ t: 'string', v });
const err = (name: string, message: string, stack?: string): SerializedValue => ({ t: 'error', name, message, stack });

const STACK_A = `TypeError: x
    at render (https://app.test/assets/index-B3x9kQ12.js?v=1:10:5)
    at commit (https://app.test/assets/index-B3x9kQ12.js?v=1:20:7)`;
const STACK_B = `TypeError: x
    at save (https://app.test/assets/form.js:88:3)`;

describe('normalizeMessage', () => {
  it('replaces ids, uuids, long hex and decimals', () => {
    expect(normalizeMessage('user 123456 not found')).toBe('user <n> not found');
    expect(normalizeMessage('id 3f2a9c1b-1234-4abc-9def-0123456789ab')).toBe('id <uuid>');
    expect(normalizeMessage('hash deadbeefcafe1234')).toBe('hash <hex>');
    expect(normalizeMessage('took 12.5ms')).toBe('took <n>ms');
  });

  it('keeps short integers such as HTTP statuses', () => {
    expect(normalizeMessage('Request failed with status 404')).not.toBe(normalizeMessage('Request failed with status 500'));
  });

  it('normalizes urls but keeps the endpoint', () => {
    expect(normalizeMessage('GET https://api.test/users/42?token=abc failed')).toBe('GET https://api.test/users/<id> failed');
    expect(normalizeMessage('GET https://api.test/users/42')).not.toBe(normalizeMessage('GET https://api.test/orders/42'));
  });
});

describe('normalizeUrl', () => {
  it('drops query and hash and id segments', () => {
    expect(normalizeUrl('https://a.test/x/1234/y/3f2a9c1b-1234-4abc-9def-0123456789ab?q=1#h')).toBe('https://a.test/x/<id>/y/<id>');
  });
});

describe('normalizeFrame / topFrames', () => {
  it('strips cache-busting query strings and bundle hashes, keeps line and column', () => {
    expect(normalizeFrame('    at render (https://app.test/assets/index-B3x9kQ12.js?v=1:10:5)')).toBe(
      'render (https://app.test/assets/index-<hash>.js:10:5)',
    );
  });

  it('returns only frame lines, up to the limit', () => {
    expect(topFrames(STACK_A)).toHaveLength(2);
    expect(topFrames(STACK_A, 1)).toEqual(['render (https://app.test/assets/index-<hash>.js:10:5)']);
    expect(topFrames(undefined)).toEqual([]);
  });
});

describe('fingerprint', () => {
  it('groups the same error with different ids', () => {
    const a = entry([err('QuotaExceededError', "Failed to set 'item-123456'", STACK_A)], { prefix: 'Uncaught' });
    const b = entry([err('QuotaExceededError', "Failed to set 'item-987654'", STACK_A)], { prefix: 'Uncaught' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('ignores cache-busting differences in the stack', () => {
    const a = entry([err('TypeError', 'x', STACK_A)]);
    const b = entry([err('TypeError', 'x', STACK_A.replaceAll('?v=1', '?v=2'))]);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('keeps errors with the same message but different call sites apart', () => {
    const a = entry([err('TypeError', 'x', STACK_A)]);
    const b = entry([err('TypeError', 'x', STACK_B)]);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('keeps different error types, levels, prefixes and sources apart', () => {
    const base = entry([err('TypeError', 'x', STACK_A)]);
    expect(fingerprint(base)).not.toBe(fingerprint(entry([err('RangeError', 'x', STACK_A)])));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, level: 'warn' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, prefix: 'Uncaught (in promise)' }));
    const logged = entry([str('hello')], { level: 'log', source: { label: 'a.js:1', url: 'https://app.test/a.js:1' } });
    expect(fingerprint(logged)).not.toBe(fingerprint({ ...logged, source: { label: 'b.js:1', url: 'https://app.test/b.js:1' } }));
  });

  it('uses the console call stack when there is no error object', () => {
    const a = entry([str('boom')], { stack: 'at a (https://app.test/a.js:1:1)' });
    const b = entry([str('boom')], { stack: 'at b (https://app.test/b.js:2:2)' });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('compares objects by shape, not values', () => {
    const obj = (id: string): SerializedValue => ({ t: 'object', kind: 'object', cls: 'Object', entries: [['id', str(id)]] });
    expect(fingerprint(entry([str('state'), obj('1')], { level: 'log' }))).toBe(fingerprint(entry([str('state'), obj('2')], { level: 'log' })));
  });

  it('never groups prompt commands or results', () => {
    expect(fingerprint(entry([str('1+1')], { level: 'command' }))).not.toBe(fingerprint(entry([str('1+1')], { level: 'command' })));
  });
});
