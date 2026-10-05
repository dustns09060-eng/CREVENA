import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedIp } from "../src/lib/product-shorts/ssrf-guard";
import { parseGenericProductPage } from "../src/lib/product-shorts/parsers/generic";

test("SSRF: IPv6 transition ranges that embed or hide an IPv4 address are blocked", () => {
  // 6to4 (2002::/16) embedding 127.0.0.1 and 10.0.0.1
  assert.equal(isBlockedIp("2002:7f00:1::1"), true);
  assert.equal(isBlockedIp("2002:0a00:0001::"), true);
  // NAT64 well-known prefix embedding 127.0.0.1 / 169.254.169.254
  assert.equal(isBlockedIp("64:ff9b::7f00:1"), true);
  assert.equal(isBlockedIp("64:ff9b::a9fe:a9fe"), true);
  // NAT64 local-use prefix
  assert.equal(isBlockedIp("64:ff9b:1::1"), true);
  // Teredo
  assert.equal(isBlockedIp("2001:0:4136:e378:8000:63bf:3fff:fdd2"), true);
  // deprecated IPv4-compatible ::a.b.c.d
  assert.equal(isBlockedIp("::7f00:1"), true);
  assert.equal(isBlockedIp("::127.0.0.1"), true);
  // documentation range
  assert.equal(isBlockedIp("2001:db8::1"), true);
});

test("SSRF: ordinary public addresses stay allowed", () => {
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
  // NAT64 embedding a PUBLIC IPv4 (8.8.8.8) is allowed
  assert.equal(isBlockedIp("64:ff9b::808:808"), false);
  // 6to4 embedding a public IPv4 is still blocked as a whole range
  assert.equal(isBlockedIp("2002:808:808::1"), true);
});

test("generic parser: evidence only describes the value that was actually chosen", () => {
  const html = `<html><head>
    <title>Shop - Some Title</title>
    <meta property="og:title" content="OG Name">
    <meta property="og:description" content="OG desc">
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
    <meta name="description" content="meta desc">
    <script type="application/ld+json">{"@type":"Product","name":"LD Name","description":"LD desc","image":["https://cdn.example.com/ld1.jpg"],"offers":{"price":1000,"priceCurrency":"KRW"}}</script>
  </head></html>`;
  const src = parseGenericProductPage(html, new URL("https://shop.example.com/p/1"));
  assert.ok(src);
  assert.equal(src.productName, "LD Name");
  const forField = (f: string) => src.evidence.filter((e) => e.field === f);
  assert.deepEqual(forField("productName").map((e) => [e.source, e.value]), [["JSON_LD", "LD Name"]]);
  assert.deepEqual(forField("description").map((e) => [e.source, e.value]), [["JSON_LD", "LD desc"]]);
  assert.deepEqual(forField("imageCandidates[]").map((e) => e.source), ["JSON_LD"]);
  assert.deepEqual(src.imageCandidates, ["https://cdn.example.com/ld1.jpg"]);
});

test("generic parser: lower-priority sources still provide fields JSON-LD lacks", () => {
  const html = `<html><head><title>T</title>
    <meta property="og:title" content="OG Name">
    <meta name="description" content="meta desc">
    <script type="application/ld+json">{"@type":"Product","name":"LD Name"}</script></head></html>`;
  const src = parseGenericProductPage(html, new URL("https://shop.example.com/p/1"));
  assert.ok(src);
  const bySource = (f: string) => src.evidence.filter((e) => e.field === f).map((e) => e.source);
  assert.deepEqual(bySource("productName"), ["JSON_LD"]);
  assert.deepEqual(bySource("description"), ["META"]);
});
