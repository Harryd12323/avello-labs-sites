import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAndGuard, guardUrl, isPrivateAddress } from "../src/guard.ts";

const allowed: Array<[string, string]> = [
  ["avellolabs.com", "https://avellolabs.com/"],
  ["https://avellolabs.com/seo/", "https://avellolabs.com/seo/"],
  ["http://example.org", "http://example.org/"],
  ["  www.Example.COM/page?x=1#top  ", "https://www.example.com/page?x=1"],
  ["https://example.com:443/", "https://example.com/"],
  ["http://example.com:80/", "http://example.com/"],
  ["bücher.de", "https://xn--bcher-kva.de/"],
  ["https://sub.domain.co.uk/a/b", "https://sub.domain.co.uk/a/b"],
];

const refused: string[] = [
  "", "   ", "file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "data:text/html,hi", "mailto:a@b.com",
  "gopher://example.com", "ws://example.com",
  "http://localhost", "http://localhost:8000", "localhost", "http://LOCALHOST.", "http://foo.localhost",
  "http://127.0.0.1", "127.0.0.1", "http://127.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1",
  "http://0.0.0.0", "http://10.0.0.5", "http://172.16.3.4", "http://192.168.1.1", "http://169.254.169.254/latest/meta-data/",
  "http://100.100.100.100", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://[fd00::1]", "http://[fe80::1]",
  "http://[64:ff9b::a9fe:a9fe]", "http://8.8.8.8", "http://[2606:4700::1111]",
  "http://printer", "http://intranet", "http://nas.local", "http://db.internal", "http://router.lan", "http://x.home.arpa",
  "http://user:pass@example.com", "http://user@example.com", "https://example.com:8443/", "example.com:22",
  "https://avello-check.avellolabs.workers.dev/", "https://avellolabs.workers.dev",
  "http://exa mple.com", "http://<script>.com", "https://example", "https://-bad-.com", "https://a..com",
  "https://" + "a".repeat(2100) + ".com",
];

for (const [input, expected] of allowed) {
  test(`allows ${JSON.stringify(input)}`, () => {
    const r = normalizeAndGuard(input);
    assert.ok(r.ok, `expected ok, got: ${!r.ok && r.reason}`);
    if (r.ok) assert.equal(r.url.href, expected);
  });
}

for (const input of refused) {
  test(`refuses ${JSON.stringify(input.slice(0, 60))}`, () => {
    const r = normalizeAndGuard(input);
    assert.equal(r.ok, false, `expected refusal for ${input}, got ${r.ok && r.url.href}`);
  });
}

test("redirect targets are re-checked", () => {
  assert.equal(guardUrl(new URL("http://169.254.169.254/")).ok, false);
  assert.equal(guardUrl(new URL("http://[::1]:8080/")).ok, false);
  assert.equal(guardUrl(new URL("https://example.com/next")).ok, true);
});

test("private address detection, used for DNS answers", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0",
                    "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fe80::abcd", "::ffff:10.0.0.1", "64:ff9b::7f00:1",
                    "ff02::1", "2001:db8::1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "104.21.20.200", "172.32.0.1", "100.128.0.1", "2606:4700::6815:14c8", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});
