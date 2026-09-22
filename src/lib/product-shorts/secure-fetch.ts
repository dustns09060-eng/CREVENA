import dns from "node:dns/promises";
import http, { type RequestOptions } from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import { isBlockedIp, rejectUrlUpfront } from "./ssrf-guard";

// SSRF-safe HTML fetcher for a user-supplied external URL (product page or
// candidate image, both go through this — see the PR report's "이미지 URL
// 보안" section for why images need the exact same treatment as the page
// URL itself).
//
// IMPORTANT — why this uses node:http/node:https directly instead of the
// global fetch(): closing the DNS-rebinding gap (TOCTOU between "the
// hostname we validated" and "the address the socket actually connects to")
// requires pinning the connection to a SPECIFIC, already-validated IP
// address. The documented, dependency-free way to do that in Node is
// http.request()/https.request()'s `lookup` option — Node's own `net`/`tls`
// connection layer calls exactly this function to resolve the host, and
// connects to whatever address it returns; there is no second, independent
// resolution afterward.
//
// `node:undici` (which would offer an Agent-based dispatcher with the same
// kind of `connect.lookup` hook) was checked directly against this
// project's actual Node runtime and is NOT available as a built-in module
// here (confirmed: `require("node:undici")` throws ERR_UNKNOWN_BUILTIN_MODULE
// on the Node version this project runs — see the PR report). Adding the
// `undici` npm package was avoided per this project's "no new dependencies"
// rule. So http.request/https.request's `lookup` option is used instead —
// verified empirically (see secure-fetch.test.mts) with a custom lookup
// that records every address it is asked to validate and confirming the
// actual TCP connection target is exactly, and only, that address.

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB — a product page's HTML has no business being bigger

export type SecureFetchResult = { ok: true; html: string; finalUrl: string } | { ok: false; error: string };

export type SecureFetchDeps = {
  // Injectable for tests only — real callers never pass these. Lets tests
  // point requests at a local mock server without touching any real
  // external host, and substitute a fake DNS resolver to simulate
  // rebinding attempts deterministically.
  resolveHostname?: (hostname: string) => Promise<LookupAddress[]>;
  request?: typeof http.request;
  requestSecure?: typeof https.request;
};

async function resolveAndValidate(
  hostname: string,
  resolveHostname: NonNullable<SecureFetchDeps["resolveHostname"]>,
): Promise<{ address: string; family: number } | { error: string }> {
  let addresses: LookupAddress[];
  try {
    addresses = await resolveHostname(hostname);
  } catch {
    return { error: "호스트를 확인할 수 없습니다." };
  }
  if (addresses.length === 0) return { error: "호스트를 확인할 수 없습니다." };

  // Fail closed: if ANY resolved address is blocked, reject the whole
  // hostname rather than only avoiding the bad address — a hostname that
  // resolves to both a public and a private address is itself suspicious
  // (this is exactly the rebinding-adjacent multi-answer pattern).
  for (const { address } of addresses) {
    if (isBlockedIp(address)) return { error: "허용되지 않은 주소로 확인됩니다." };
  }
  return { address: addresses[0].address, family: addresses[0].family };
}

export async function secureFetchHtml(
  inputUrl: string,
  opts: { maxRedirects?: number; timeoutMs?: number; maxBytes?: number } = {},
  deps: SecureFetchDeps = {},
): Promise<SecureFetchResult> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const resolveHostname = deps.resolveHostname ?? ((h: string) => dns.lookup(h, { all: true, verbatim: true }));
  const doRequest = deps.request ?? http.request;
  const doRequestSecure = deps.requestSecure ?? https.request;

  let current: URL;
  try {
    current = new URL(inputUrl);
  } catch {
    return { ok: false, error: "URL 형식이 올바르지 않습니다." };
  }

  for (let redirectCount = 0; ; redirectCount++) {
    const upfrontError = rejectUrlUpfront(current);
    if (upfrontError) return { ok: false, error: upfrontError };
    if (redirectCount > maxRedirects) return { ok: false, error: "리다이렉트 횟수를 초과했습니다." };

    const resolved = await resolveAndValidate(current.hostname, resolveHostname);
    if ("error" in resolved) return { ok: false, error: resolved.error };

    // The pinned lookup: ignores whatever hostname Node's connection layer
    // asks about and ALWAYS returns the one address we already validated
    // above — this is what makes the check and the connection target the
    // same lookup, closing the TOCTOU gap. `agent: false` additionally
    // guarantees no pooled/kept-alive socket to a DIFFERENT, earlier-
    // validated target is reused for this request.
    //
    // Callback shape: verified empirically against this project's actual
    // Node runtime (v24), not assumed from documentation. Node's
    // http.request now enables Happy Eyeballs (RFC 8305) by default, which
    // calls `lookup(hostname, { all: true }, callback)` and requires the
    // callback to receive an ARRAY of {address, family} — the older
    // 3-argument single-address form `callback(err, address, family)`
    // throws `ERR_INVALID_IP_ADDRESS` in this Node version. See the PR
    // report's "DNS rebinding 대응" section for the real (unmocked)
    // reproduction against a local server that surfaced this.
    const pinnedLookup: RequestOptions["lookup"] = (_hostname, lookupOpts, callback) => {
      const wantsAll = typeof lookupOpts === "object" && lookupOpts !== null && "all" in lookupOpts && lookupOpts.all;
      if (wantsAll) {
        (callback as (err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void)(
          null,
          [{ address: resolved.address, family: resolved.family }],
        );
      } else {
        (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
          null,
          resolved.address,
          resolved.family,
        );
      }
    };

    const requestFn = current.protocol === "https:" ? doRequestSecure : doRequest;
    const result = await new Promise<
      { redirect: string } | { done: true; html: string } | { error: string }
    >((resolvePromise) => {
      const req = requestFn(
        current,
        {
          method: "GET",
          agent: false,
          lookup: pinnedLookup,
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "User-Agent": "CREVENA-ProductShorts/1.0 (+https://www.crevena.com)",
            Accept: "text/html",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume(); // drain, discard
            resolvePromise({ redirect: res.headers.location });
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            resolvePromise({ error: `요청이 실패했습니다 (status ${status}).` });
            return;
          }
          const contentType = res.headers["content-type"] ?? "";
          if (!contentType.toLowerCase().startsWith("text/html")) {
            res.resume();
            resolvePromise({ error: "HTML 응답이 아닙니다." });
            return;
          }
          // Refuse compressed responses outright rather than decompressing
          // with a cap — this closes the decompression-bomb class of risk
          // entirely for V1 instead of trying to bound it. The request
          // never sends Accept-Encoding, so a well-behaved server will not
          // compress; this only fires against a server that compresses
          // unsolicited.
          if (res.headers["content-encoding"]) {
            res.resume();
            resolvePromise({ error: "압축 응답은 지원하지 않습니다." });
            return;
          }

          let received = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > maxBytes) {
              req.destroy(new Error("max size exceeded"));
              resolvePromise({ error: "응답 크기가 너무 큽니다." });
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            resolvePromise({ done: true, html: Buffer.concat(chunks).toString("utf-8") });
          });
          res.on("error", () => resolvePromise({ error: "응답을 읽는 중 오류가 발생했습니다." }));
        },
      );
      req.on("error", (err) => {
        resolvePromise({ error: err.name === "AbortError" ? "요청 시간이 초과되었습니다." : "요청에 실패했습니다." });
      });
      req.end();
    });

    if ("error" in result) return { ok: false, error: result.error };
    if ("done" in result) return { ok: true, html: result.html, finalUrl: current.toString() };

    // Redirect: resolve relative to the CURRENT url, then loop — every
    // iteration re-runs rejectUrlUpfront + DNS re-resolution + IP
    // validation on the NEW target from scratch. Nothing about the
    // previous validation carries over.
    try {
      current = new URL(result.redirect, current);
    } catch {
      return { ok: false, error: "리다이렉트 대상 URL이 올바르지 않습니다." };
    }
  }
}
