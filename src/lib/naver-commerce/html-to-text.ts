// Converts seller-authored detailContent HTML to plain text. The result is
// only ever rendered as text (never with dangerouslySetInnerHTML).

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®",
  trade: "™", times: "×", bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string, maxLength: number): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|template|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, " ");
  // An unclosed script/style swallows the rest of the document in a browser,
  // so drop everything from its opening tag onward.
  s = s.replace(/<(script|style)\b[\s\S]*$/i, " ");
  s = s.replace(/<(noscript|template|iframe|object|embed)\b[^>]*\/?>/gi, " ");
  s = s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeEntities(s);
  // Entities such as &lt;script&gt; decode to literal text — that is fine,
  // it is only ever displayed as text, never parsed as HTML.
  s = s.replace(/\u00a0/g, " ").replace(/[ \t\f\v\u200b]+/g, " ");
  s = s.replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > maxLength) s = s.slice(0, maxLength).trimEnd() + "…";
  return s;
}
