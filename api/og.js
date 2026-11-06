// GET /api/og?chain=solana&pair=<pair address>  →  1200×630 PNG share card for one token.
// Falls back to the generic /og.png when the token can't be loaded.
import { loadToken, validPair, priceParts, fmtUsd, fmtPct, originOf, GRADE_COLORS } from "./_token.js";

import { ImageResponse } from "@vercel/og";

const MARK = "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff7cc0"/><stop offset=".55" stop-color="#ff2e8a"/><stop offset="1" stop-color="#a3125f"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><rect width="64" height="4" fill="#fff" fill-opacity=".35"/><rect x="16" y="19" width="9" height="9" fill="#fff"/><rect x="38" y="23" width="11" height="4" fill="#fff"/><path d="M13 40l8 5 7-6 7 5 10-10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="square"/><path d="M38 34h7v7" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="square"/></svg>`).toString("base64");

let fontsP = null;
const loadFonts = origin => (fontsP ||= Promise.all([
  ["Sora", 700, "sora-700.woff"], ["Manrope", 600, "manrope-600.woff"], ["Manrope", 800, "manrope-800.woff"],
].map(async ([name, weight, file]) => {
  const res = await fetch(`${origin}/fonts/${file}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("font " + file);
  return { name, weight, style: "normal", data: await res.arrayBuffer() };
})).catch(e => { fontsP = null; throw e; }));

// remote images are inlined; only formats the renderer understands are used
async function imageData(url) {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { accept: "image/png,image/jpeg,image/gif;q=0.9" } });
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!res.ok || !/^image\/(png|jpeg|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length < 3_000_000 ? `data:${type};base64,${buf.toString("base64")}` : null;
  } catch { return null; }
}

const el = (type, style, children, extra = {}) => ({ type, props: { style: { display: "flex", ...style }, children, ...extra } });
const img = (src, size, style = {}) => ({ type: "img", props: { src, width: size, height: size, style: { width: size, height: size, ...style } } });
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

function card(t, logo, chainIcon) {
  const sym = clip(t.symbol, 14);
  const symSize = sym.length <= 6 ? 96 : sym.length <= 9 ? 80 : sym.length <= 12 ? 64 : 54;
  const pp = priceParts(t.price);
  const up = (t.change24 ?? 0) >= 0;
  const gc = t.grade ? GRADE_COLORS[t.grade] : "#62576b";
  const steps = t.grade ? { A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 }[t.grade] : 0;
  const stat = (label, value) => el("div", { flexDirection: "column", padding: "16px 22px", minWidth: 210, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.035)" }, [
    el("div", { fontFamily: "Manrope", fontWeight: 800, fontSize: 17, letterSpacing: 2, color: "#8f839a" }, label.toUpperCase()),
    el("div", { fontFamily: "Sora", fontSize: 36, marginTop: 6, color: "#f5eff7" }, value),
  ]);
  return el("div", {
    width: 1200, height: 630, flexDirection: "column", justifyContent: "space-between", padding: "52px 64px",
    backgroundColor: "#07050a", color: "#f5eff7", fontFamily: "Manrope",
    backgroundImage: "radial-gradient(circle at 100% 0%, rgba(255,46,147,0.36), rgba(7,5,10,0) 55%), radial-gradient(circle at 0% 100%, rgba(56,207,255,0.10), rgba(7,5,10,0) 50%)",
  }, [
    // brand + chain
    el("div", { alignItems: "center", justifyContent: "space-between" }, [
      el("div", { alignItems: "center" }, [
        img(MARK, 46),
        el("div", { fontFamily: "Sora", fontSize: 34, marginLeft: 16 }, [el("span", { color: "#f5eff7" }, "Meme"), el("span", { color: "#ff3d9a" }, "Dex")]),
      ]),
      el("div", { alignItems: "center", padding: "10px 18px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", fontWeight: 800, fontSize: 24 }, [
        ...(chainIcon ? [img(chainIcon, 30, { marginRight: 12 })] : []), t.chainName,
      ]),
    ]),
    // token
    el("div", { alignItems: "center" }, [
      logo ? img(logo, 176, { objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)" })
           : el("div", { width: 176, height: 176, alignItems: "center", justifyContent: "center", border: "3px dashed rgba(245,239,247,0.32)", color: "#6e6378", fontFamily: "Sora", fontSize: 92 }, "?"),
      el("div", { flexDirection: "column", marginLeft: 44, flexGrow: 1 }, [
        el("div", { alignItems: "baseline" }, [
          el("div", { fontFamily: "Sora", fontSize: symSize, lineHeight: 1 }, sym),
          ...(t.quote ? [el("div", { fontSize: 30, fontWeight: 600, color: "#7d7188", marginLeft: 14 }, "/" + clip(t.quote, 8))] : []),
        ]),
        el("div", { fontSize: 32, fontWeight: 600, color: "#a99db2", marginTop: 10 }, clip(t.name || "", 34)),
        el("div", { alignItems: "center", marginTop: 22 }, [
          el("div", { fontFamily: "Sora", fontSize: 68, alignItems: "flex-end", lineHeight: 1 }, pp.sub
            ? [el("span", {}, pp.text), el("span", { fontSize: 38, marginBottom: -8 }, pp.sub), el("span", {}, pp.rest)]
            : [el("span", {}, pp.text)]),
          el("div", { marginLeft: 22, padding: "8px 16px", fontWeight: 800, fontSize: 30, color: up ? "#38cfff" : "#ff4f8f", background: up ? "rgba(56,207,255,0.14)" : "rgba(255,79,143,0.14)" }, `${fmtPct(t.change24)} 24h`),
        ]),
      ]),
    ]),
    // stats + grade
    el("div", { alignItems: "flex-end", justifyContent: "space-between" }, [
      el("div", { gap: 14 }, [stat("Market cap", fmtUsd(t.mcap)), stat("Liquidity", fmtUsd(t.liquidity)), stat("Volume 24h", fmtUsd(t.volume))]),
      el("div", {
        width: 168, height: 168, flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative",
        border: `2px solid ${hexA(gc, 0.55)}`, backgroundImage: `linear-gradient(180deg, ${hexA(gc, 0.26)}, ${hexA(gc, 0.05)})`,
      }, [
        el("div", { position: "absolute", top: 12, left: 14, fontWeight: 800, fontSize: 15, letterSpacing: 3, color: hexA(gc, 0.85) }, "GRADE"),
        el("div", { fontFamily: "Sora", fontSize: 84, lineHeight: 1, marginTop: 14, color: t.grade ? gc : "#8f839a" }, t.grade || "–"),
        el("div", { gap: 5, marginTop: 14 }, Array.from({ length: 6 }, (_, i) => el("div", { width: 18, height: 8, background: i < steps ? gc : "rgba(255,255,255,0.12)" }, []))),
      ]),
    ]),
  ]);
}

export async function GET(request) {
  const url = new URL(request.url), origin = originOf(request);
  const chain = (url.searchParams.get("chain") || "").toLowerCase(), pair = url.searchParams.get("pair") || "";
  const fallback = () => Response.redirect(`${origin}/og.png`, 302);
  if (!validPair(chain, pair)) return fallback();
  let t, fonts, chainIcon;
  try {
    [t, fonts, chainIcon] = await Promise.all([loadToken(chain, pair), loadFonts(origin), imageData(`https://dd.dexscreener.com/ds-data/chains/${chain}.png`)]);
  } catch { return fallback(); }
  if (!t) return fallback();
  const logo = await imageData(t.logo);
  return new ImageResponse(card(t, logo, chainIcon), {
    width: 1200, height: 630, fonts,
    headers: { "cache-control": "public, max-age=600, s-maxage=600, stale-while-revalidate=86400" },
  });
}
