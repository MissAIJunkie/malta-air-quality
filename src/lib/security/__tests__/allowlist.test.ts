import { describe, it, expect } from 'vitest';

import {
  ALLOWED_UPSTREAM_HOSTS,
  BlockedHostError,
  assertAllowedUrl,
  isAllowedUrl,
  isSafeExternalLink,
} from '../allowlist';

const EEA = 'https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/';

describe('assertAllowedUrl — permitted upstreams', () => {
  it('allows the verified EEA dissemination layer', () => {
    const url = assertAllowedUrl(`${EEA}content/index.json`);
    expect(url.hostname).toBe('dis2datalake.blob.core.windows.net');
    expect(url.protocol).toBe('https:');
  });

  it('allows every host in the registry', () => {
    for (const host of ALLOWED_UPSTREAM_HOSTS) {
      expect(isAllowedUrl(`https://${host}/some/path`)).toBe(true);
    }
  });

  it('does not care about path, query or port-less default', () => {
    expect(
      isAllowedUrl('https://api.open-meteo.com/v1/forecast?latitude=35.9&longitude=14.4'),
    ).toBe(true);
  });
});

describe('assertAllowedUrl — blocked hosts', () => {
  it.each([
    'https://example.com/data.json',
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://localhost:3000/internal',
    'https://127.0.0.1/internal',
  ])('refuses %s', (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(BlockedHostError);
    expect(isAllowedUrl(url)).toBe(false);
  });

  it('matches hosts exactly, so a lookalike prefix cannot slip through', () => {
    // The decisive case. A naive `endsWith`/`includes` check would accept all of
    // these, and any one of them is an attacker-controlled domain that would
    // then be fetched server-side with our egress.
    expect(isAllowedUrl('https://evil-dis2datalake.blob.core.windows.net/x.json')).toBe(false);
    expect(isAllowedUrl('https://dis2datalake.blob.core.windows.net.evil.com/x.json')).toBe(false);
    expect(isAllowedUrl('https://openrouter.ai.attacker.example/v1/chat')).toBe(false);
    expect(isAllowedUrl('https://notopenrouter.ai/v1/chat')).toBe(false);
  });

  it('does not accept a subdomain of an allowlisted host', () => {
    // The allowlist names exact hosts; a wildcard would hand any tenant of that
    // zone the ability to be fetched by us.
    expect(isAllowedUrl('https://sub.era.org.mt/api')).toBe(false);
    expect(isAllowedUrl('https://a.dis2datalake.blob.core.windows.net/x.json')).toBe(false);
  });

  it('names the offending host in the error, without leaking the full URL', () => {
    try {
      assertAllowedUrl('https://evil.example/secret-path?token=abc');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BlockedHostError);
      expect((error as BlockedHostError).host).toBe('evil.example');
      expect((error as Error).message).toContain('evil.example');
      expect((error as Error).message).not.toContain('secret-path');
      expect((error as Error).message).not.toContain('token=abc');
    }
  });
});

describe('assertAllowedUrl — rejected schemes and credentials', () => {
  it('rejects plain http even for an allowlisted host', () => {
    // Downgrading to http would expose the request to tampering on the wire,
    // and the response drives health-relevant numbers.
    expect(() => assertAllowedUrl('http://dis2datalake.blob.core.windows.net/x.json')).toThrow(
      BlockedHostError,
    );
    expect(isAllowedUrl('http://api.open-meteo.com/v1/forecast')).toBe(false);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://dis2datalake.blob.core.windows.net/x.json',
    'javascript:alert(1)',
    'data:application/json,{}',
    'gopher://dis2datalake.blob.core.windows.net/',
  ])('rejects the %s scheme', (url) => {
    expect(isAllowedUrl(url)).toBe(false);
  });

  it('rejects credentials embedded in the URL', () => {
    // `https://user:pass@host/` is both a credential leak into logs and a
    // classic way of disguising the real host from a human reviewer.
    expect(() =>
      assertAllowedUrl('https://user:pass@dis2datalake.blob.core.windows.net/x'),
    ).toThrow(/embedded credentials/);
    expect(isAllowedUrl('https://user@openrouter.ai/v1/chat')).toBe(false);
    expect(isAllowedUrl('https://:pass@openrouter.ai/v1/chat')).toBe(false);
  });

  it('rejects a userinfo section that impersonates an allowlisted host', () => {
    // The real host here is `attacker.example`.
    expect(isAllowedUrl('https://dis2datalake.blob.core.windows.net@attacker.example/x')).toBe(
      false,
    );
  });

  it.each(['', '   ', 'not a url', '//dis2datalake.blob.core.windows.net/x', 'https://'])(
    'refuses the unparseable input %o',
    (input) => {
      expect(() => assertAllowedUrl(input)).toThrow(BlockedHostError);
      expect(isAllowedUrl(input)).toBe(false);
    },
  );
});

describe('isSafeExternalLink', () => {
  it('permits any plain HTTPS link, because we cite sources we never fetch', () => {
    expect(isSafeExternalLink('https://era.org.mt/topic/air-quality/')).toBe(true);
    expect(isSafeExternalLink('https://www.eea.europa.eu/en')).toBe(true);
    // Deliberately looser than the fetch allowlist — citing is not fetching.
    expect(isSafeExternalLink('https://example.com/report.pdf')).toBe(true);
  });

  it('blocks the schemes that would make a rendered link an XSS vector', () => {
    // These are the shapes that could arrive from an upstream feed or from AI
    // output and end up in an href.
    expect(isSafeExternalLink('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalLink('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeExternalLink('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeExternalLink('http://example.com')).toBe(false);
    expect(isSafeExternalLink('not a url')).toBe(false);
  });

  it('blocks embedded credentials in a citation too', () => {
    expect(isSafeExternalLink('https://user:pass@example.com/x')).toBe(false);
  });
});
