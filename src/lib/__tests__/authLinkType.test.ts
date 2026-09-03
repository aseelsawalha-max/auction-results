import { describe, it, expect } from 'vitest';
import { parseAuthLinkType } from '../supabaseClient';

describe('parseAuthLinkType', () => {
  it('recognizes an invite link in the URL fragment (implicit flow)', () => {
    const hash =
      '#access_token=abc.def.ghi&refresh_token=xyz&expires_in=3600&token_type=bearer&type=invite';
    expect(parseAuthLinkType(hash, '')).toBe('invite');
  });

  it('recognizes a recovery link in the URL fragment', () => {
    const hash = '#access_token=abc&refresh_token=xyz&type=recovery';
    expect(parseAuthLinkType(hash, '')).toBe('recovery');
  });

  it('recognizes an invite link passed via the query string (PKCE flow)', () => {
    expect(parseAuthLinkType('', '?code=abc123&type=invite')).toBe('invite');
  });

  it('prefers the hash over the query string when both are present', () => {
    expect(parseAuthLinkType('#type=recovery', '?type=invite')).toBe('recovery');
  });

  it('returns null for a normal page load with no auth params', () => {
    expect(parseAuthLinkType('', '')).toBeNull();
  });

  it('returns null for a normal magic-link/signup type it does not special-case', () => {
    expect(parseAuthLinkType('#access_token=abc&type=magiclink', '')).toBeNull();
  });

  it('returns null for an unrelated hash (e.g. a client-side router route)', () => {
    expect(parseAuthLinkType('#/facility', '')).toBeNull();
  });
});
