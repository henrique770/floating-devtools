import { describe, expect, it } from 'vitest';
import { describeRedactions, redact, redactText } from './redact';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('redact', () => {
  it('masks JWTs and bearer tokens', () => {
    expect(redactText(`token ${JWT} expired`)).toBe('token [REDACTED:jwt] expired');
    expect(redactText('Authorization: Bearer abc123def456ghi')).toBe('Authorization: Bearer [REDACTED:token]');
  });

  it('masks well-known API key formats', () => {
    for (const key of [
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY',
      'ghp_1234567890abcdefghijklmnopqrstuvwxyz12',
      'sk_live_4eC39HqLyjWDarjtT1zdp7dc',
      'xoxb-123456789012-abcdefABCDEF',
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    ]) {
      expect(redactText(`key ${key} here`)).toBe('key [REDACTED:api-key] here');
    }
  });

  it('masks values of sensitive fields in JSON, query strings and key=value text', () => {
    expect(redactText('{"user":"ana","password":"hunter2","accessToken":"abc"}')).toBe('{"user":"ana","password":"[REDACTED:secret]","accessToken":"[REDACTED:secret]"}');
    expect(redactText('GET /cb?code=1&api_key=XYZ987&page=2')).toBe('GET /cb?code=1&api_key=[REDACTED:secret]&page=2');
    expect(redactText("x-api-key: s3cr3t, client_secret='abc'")).toBe("x-api-key: [REDACTED:secret], client_secret='[REDACTED:secret]'");
  });

  it('keeps fields that only look similar, and empty or literal values', () => {
    expect(redactText('{"author":"Ana","tokens":5,"password":"","token":null}')).toBe('{"author":"Ana","tokens":5,"password":"","token":null}');
    // safeUrl() already replaced query values with an ellipsis
    expect(redact('/api?expand=…&token=…').total).toBe(0);
  });

  it('masks credentials in URLs and private keys', () => {
    expect(redactText('https://admin:pa55@db.test/x')).toBe('https://[REDACTED:credentials]@db.test/x');
    expect(redactText('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----')).toBe('[REDACTED:private-key]');
  });

  it('masks personal data', () => {
    expect(redactText('contato: ana.silva+x@empresa.com.br')).toBe('contato: [REDACTED:email]');
    expect(redactText('cpf 123.456.789-09')).toBe('cpf [REDACTED:cpf]');
    expect(redactText('card 4111 1111 1111 1111')).toBe('card [REDACTED:card]');
  });

  it('leaves ordinary data alone', () => {
    const text = 'TypeError at 1697712345678 · icon@2x.png · sha 3f2a9c1b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b · id 4111111111111112';
    expect(redactText(text)).toBe(text);
  });

  it('reports what was masked', () => {
    const r = redact(`${JWT} a@b.co a@c.co`);
    expect(r.total).toBe(3);
    expect(describeRedactions(r.found)).toBe('1 JWT, 2 e-mail');
  });

  it('reports a JWT inside a field as a JWT, once', () => {
    const r = redact(`{"token":"${JWT}"}`);
    expect(r.text).toBe('{"token":"[REDACTED:jwt]"}');
    expect(r.total).toBe(1);
  });
});
