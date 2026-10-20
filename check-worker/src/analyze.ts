import type { PageFacts } from "./scoring";

// Reads a page's HTML with Cloudflare's built-in streaming parser (HTMLRewriter) and collects the facts
// the scoring rules need. Nothing is changed or kept; the output is discarded.

const MAX_JSONLD = 100 * 1024;
const TEXT_TAGS = "p, li, h1, h2, h3, h4, td, a, span, label, button, blockquote";
const APP_ROOTS = ["root", "__next", "app", "___gatsby", "__nuxt", "svelte"];

export async function analyzeHtml(bytes: Uint8Array): Promise<PageFacts> {
  const facts: PageFacts = {
    title: null, metaDescription: null, robotsMeta: [], viewport: null, h1Count: 0, jsonLd: [], itemTypes: [],
    imgTotal: 0, imgMissingAlt: 0, textChars: 0, scriptCount: 0, appRoot: false,
  };
  let titleBuf = "", titleDone = false, ldBuf = "", ldTotal = 0;

  const rewriter = new HTMLRewriter()
    .on("head > title", {
      text(t) {
        if (titleDone) return;
        titleBuf += t.text;
        if (t.lastInTextNode) { facts.title = decode(titleBuf); titleDone = true; }
      },
    })
    .on("meta", {
      element(e) {
        const name = (e.getAttribute("name") ?? "").toLowerCase().trim();
        const content = e.getAttribute("content") ?? "";
        if (name === "description" && facts.metaDescription === null) facts.metaDescription = decode(content);
        else if (name === "robots" || name === "googlebot") facts.robotsMeta.push(content);
        else if (name === "viewport" && facts.viewport === null) facts.viewport = content;
      },
    })
    .on("h1", { element() { facts.h1Count++; } })
    .on("img", {
      element(e) {
        facts.imgTotal++;
        if (!e.hasAttribute("alt")) facts.imgMissingAlt++;
      },
    })
    .on("script", { element() { facts.scriptCount++; } })
    .on('script[type="application/ld+json"]', {
      text(t) {
        if (ldTotal + t.text.length <= MAX_JSONLD) { ldBuf += t.text; ldTotal += t.text.length; }
        if (t.lastInTextNode) { if (ldBuf.trim()) facts.jsonLd.push(ldBuf); ldBuf = ""; }
      },
    })
    .on("[itemtype]", { element(e) { const v = e.getAttribute("itemtype"); if (v && facts.itemTypes.length < 50) facts.itemTypes.push(v); } })
    .on("[id]", { element(e) { if (APP_ROOTS.includes(e.getAttribute("id") ?? "")) facts.appRoot = true; } })
    .on(TEXT_TAGS, { text(t) { facts.textChars += t.text.trim().length; } });

  await rewriter.transform(new Response(bytes, { headers: { "Content-Type": "text/html" } })).arrayBuffer();
  if (!titleDone && titleBuf) facts.title = decode(titleBuf);
  return facts;
}

// Decodes the handful of HTML entities that commonly appear in titles and descriptions.
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
