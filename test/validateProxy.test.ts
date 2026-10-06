import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPrivateIP, validateProxyUrl } from '../src/shared/validateProxy.ts';

/**
 * The proxy is an open endpoint, so these cases are the security boundary.
 * Each "must reject" entry is a way an attacker could reach the host network
 * (loopback admin ports, cloud metadata, sibling containers).
 */
describe('isPrivateIP', () => {
  const blocked = [
    ['localhost', 'localhost'],
    ['loopback v4', '127.0.0.1'],
    ['loopback v4 range', '127.13.37.1'],
    ['rfc1918 10/8', '10.0.0.1'],
    ['rfc1918 172.16/12 low', '172.16.0.1'],
    ['rfc1918 172.16/12 high', '172.31.255.255'],
    ['rfc1918 192.168/16', '192.168.1.1'],
    ['link-local', '169.254.1.1'],
    ['cloud metadata', '169.254.169.254'],
    ['this network', '0.0.0.0'],
    ['cgnat', '100.64.0.1'],
    ['test-net', '192.0.2.1'],
    ['multicast', '224.0.0.1'],
    ['ipv6 loopback', '::1'],
    ['ipv6 unspecified', '::'],
    ['ipv6 unique-local', 'fd00::1'],
    ['ipv6 link-local', 'fe80::1'],
    ['ipv4-mapped loopback', '::ffff:127.0.0.1'],
    ['ipv4-compatible loopback', '::127.0.0.1'],
    ['internal suffix', 'redis.internal'],
    ['local suffix', 'printer.local'],
    ['localhost suffix', 'foo.localhost'],
    ['bare decimal loopback', '2130706433'],
    ['hex loopback', '0x7f000001'],
    ['octal loopback', '017700000001'],
    ['bare decimal metadata', '2852039166'],
    ['empty host', ''],
  ] as const;

  for (const [label, host] of blocked) {
    it(`blocks ${label} (${host})`, () => {
      assert.equal(isPrivateIP(host), true, `${host} should be private`);
    });
  }

  const allowed = [
    ['public v4', '93.184.216.34'],
    ['public v4 (8.8.8.8)', '8.8.8.8'],
    ['public ipv6', '2606:2800:220:1:248:1893:25c8:1946'],
    ['public hostname', 'api.example.com'],
    ['172.15.x is public', '172.15.0.1'],
    ['172.32.x is public', '172.32.0.1'],
    ['192.169.x is public', '192.169.0.1'],
    ['168.x is public', '168.0.0.1'],
    ['100.128.x is public', '100.128.0.1'],
  ] as const;

  for (const [label, host] of allowed) {
    it(`allows ${label} (${host})`, () => {
      assert.equal(isPrivateIP(host), false, `${host} should be allowed`);
    });
  }
});

describe('validateProxyUrl', () => {
  it('accepts a normal https API source', () => {
    const res = validateProxyUrl(
      'https://api.example.com/api.php/provide/vod/',
    );
    assert.equal(res.valid, true);
  });

  it('accepts http', () => {
    assert.equal(validateProxyUrl('http://api.example.com/x').valid, true);
  });

  it('rejects a malformed URL', () => {
    assert.equal(validateProxyUrl('not a url').valid, false);
  });

  it('rejects an empty string', () => {
    assert.equal(validateProxyUrl('').valid, false);
  });

  it('rejects non-http schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://example.com/',
      'ftp://example.com/',
      'javascript:alert(1)',
      'data:text/plain,hi',
    ]) {
      const res = validateProxyUrl(url);
      assert.equal(res.valid, false, `${url} must be rejected`);
    }
  });

  it('rejects credentials in the URL', () => {
    // user:pass@ makes a request look like it targets a different host.
    const res = validateProxyUrl('http://user:pass@example.com/api');
    assert.equal(res.valid, false);
    assert.match(res.error ?? '', /credentials/i);
  });

  it('rejects the cloud metadata endpoint', () => {
    const res = validateProxyUrl('http://169.254.169.254/latest/meta-data/');
    assert.equal(res.valid, false);
    assert.match(res.error ?? '', /private/i);
  });

  it('rejects loopback', () => {
    assert.equal(validateProxyUrl('http://127.0.0.1:8080/admin').valid, false);
    assert.equal(validateProxyUrl('http://localhost:3000/').valid, false);
  });

  it('rejects integer-encoded loopback', () => {
    assert.equal(validateProxyUrl('http://2130706433/').valid, false);
  });
});
