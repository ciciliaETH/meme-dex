// GET /t/<chain>/<pair> (rewritten here by vercel.json)
// Social apps read the token's own title, description and share image from this page;
// people are sent straight on to the token page in the app.
import { loadToken, validPair, priceText, fmtUsd, fmtPct, originOf } from "./_token.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

export async function GET(request) {
  const url = new URL(request.url), origin = originOf(request);
  const chain = (url.searchParams.get("chain") || "").toLowerCase(), pair = url.searchParams.get("pair") || "";
  if (!validPair(chain, pair)) return Response.redirect(`${origin}/`, 302);
  let t = null;
  try { t = await loadToken(chain, pair); } catch { /* fall back to the generic card */ }
  const app = `/#/t/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`;
  const link = `${origin}/t/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`;
  const title = t ? `${t.symbol} ${priceText(t.price)} (${fmtPct(t.change24)}) · ${t.chainName} · MemeDex` : "MemeDex · Live meme coin screener";
  const desc = t
    ? [t.name, t.grade ? `Coin Grade ${t.grade}` : null, `Market cap ${fmtUsd(t.mcap)}`, `Liquidity ${fmtUsd(t.liquidity)}`].filter(Boolean).join(" · ") + ". Live chart and on-chain trades on MemeDex."
    : "Live prices, charts and on-chain trades for meme coins, with Coin Grade A–F and original-vs-copy checks.";
  // a new image URL every 10 minutes, so re-shares show fresh numbers
  const image = t ? `${origin}/api/og?chain=${encodeURIComponent(chain)}&pair=${encodeURIComponent(pair)}&v=${Math.floor(Date.now() / 600000)}` : `${origin}/og.png`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(link)}">
<meta name="theme-color" content="#07050a">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MemeDex">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(link)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<script>location.replace(${JSON.stringify(app)});</script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07050a;color:#f5eff7;font:600 15px system-ui,sans-serif}a{color:#ff3d9a}</style>
</head>
<body><a href="${esc(app)}">Open ${esc(t?.symbol || "this token")} on MemeDex</a></body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600" } });
}
