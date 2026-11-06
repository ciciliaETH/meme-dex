// Shared by api/og.js (share image) and api/share.js (share link page).
// Loads one token's market data, its paid MemeDex profile and its Coin Grade, using the same
// rules as the website (keep CHAINS, GRADE_BANDS and FREE_INFO_MCAP in sync with CFG in index.html).

export const CHAINS = {
  solana:    { name: "Solana",    rpc: null, security: "rugcheck" },
  ethereum:  { name: "Ethereum",  rpc: "https://ethereum-rpc.publicnode.com",  goplus: "1" },
  bsc:       { name: "BNB Chain", rpc: "https://bsc-rpc.publicnode.com",       goplus: "56" },
  base:      { name: "Base",      rpc: "https://base-rpc.publicnode.com",      goplus: "8453" },
  arbitrum:  { name: "Arbitrum",  rpc: "https://arbitrum-one-rpc.publicnode.com", goplus: "42161" },
  polygon:   { name: "Polygon",   rpc: "https://polygon-bor-rpc.publicnode.com",  goplus: "137" },
  robinhood: { name: "Robinhood", rpc: "https://robinhood.drpc.org", explorer: "https://robinhoodchain.blockscout.com", security: "blockscout" },
};
export const GRADE_BANDS = [
  ["F", p => p > 5], ["E", p => p >= 4], ["D", p => p >= 3], ["C", p => p >= 2], ["B", p => p >= 1], ["A", () => true],
];
export const GRADE_COLORS = { A: "#3ee6c5", B: "#59c8ff", C: "#b9a4ff", D: "#ffb547", E: "#ff8a6b", F: "#ff3d7f" };
const FREE_INFO_MCAP = 1_000_000; // below this, only paid profiles show a logo
const SUPABASE = { url: "https://anophmvsnrhxngomhqav.supabase.co", key: "sb_publishable_UV828yUu15HL8P3aBiAWlw_c-mDZKRs" };

export const validPair = (chain, pair) => !!CHAINS[chain] && /^[A-Za-z0-9]{20,80}$/.test(pair || "");
const num = v => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const normAddr = a => (typeof a === "string" && /^0x[0-9a-f]+$/i.test(a)) ? a.toLowerCase() : (a || "");
const clampPct = v => v == null || !Number.isFinite(v) ? null : Math.min(100, Math.max(0, v));
const gradeFor = p => p == null ? null : GRADE_BANDS.find(([, test]) => test(p))[0];
const flag = v => v === "1" || v === 1 ? true : v === "0" || v === 0 ? false : null;
const BURN = /^0x(0{40}|0{36}dead)$/i;

async function getJSON(url, init = {}, ms = 5000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms), headers: { accept: "application/json", ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}
async function rpc(url, method, params) {
  const j = await getJSON(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, 5000);
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

/* ---------- Coin Grade (dev wallet's share of supply) ---------- */
function gradeFromRugCheck(j) {
  const creator = j?.creator; if (!creator) return null;
  const holders = Array.isArray(j.topHolders) ? j.topHolders : [];
  const h = holders.find(x => x && (x.owner === creator || x.address === creator));
  let dev = h && num(h.pct) != null ? num(h.pct) : null;
  const supply = num(j.token?.supply);
  if (dev == null && num(j.creatorBalance) != null && supply) dev = num(j.creatorBalance) / supply * 100;
  return clampPct(dev);
}
async function gradeFromGoPlus(chain, addr) {
  const c = CHAINS[chain];
  const j = await getJSON(`https://api.gopluslabs.io/api/v1/token_security/${c.goplus}?contract_addresses=${encodeURIComponent(addr)}`);
  if (String(j?.code) !== "1") return null;
  const d = (j.result || {})[normAddr(addr)] || Object.values(j.result || {})[0];
  if (!d) return null;
  const holders = Array.isArray(d.holders) ? d.holders : [];
  const creatorRow = d.creator_address ? holders.find(h => normAddr(h?.address) === normAddr(d.creator_address)) : null;
  if (creatorRow && (num(creatorRow.percent) ?? 0) > 1) return null; // scanner numbers don't add up
  const cp = num(d.creator_percent), rowPct = creatorRow ? num(creatorRow.percent) : null;
  if (cp == null && rowPct == null) return null;
  const dev = clampPct(Math.max(cp ?? 0, rowPct ?? 0) * 100);
  // launched through a contract (launchpad) and the contract holds nothing: dev wallet unknown
  if (!creatorRow && d.creator_address && c.rpc) {
    const code = await rpc(c.rpc, "eth_getCode", [d.creator_address, "latest"]).catch(() => null);
    if (typeof code === "string" && code.length > 2) return null;
  }
  return dev;
}
async function gradeFromBlockscout(chain, addr) {
  const base = CHAINS[chain].explorer + "/api/v2", enc = encodeURIComponent;
  const [tok, info, hold] = await Promise.all([
    getJSON(`${base}/tokens/${enc(addr)}`), getJSON(`${base}/addresses/${enc(addr)}`), getJSON(`${base}/tokens/${enc(addr)}/holders`).catch(() => null),
  ]);
  const supply = num(tok?.total_supply), creator = info?.creator_address_hash;
  if (!supply || !creator) return null;
  let dev = creator;
  const creatorInfo = await getJSON(`${base}/addresses/${enc(creator)}`).catch(() => null);
  if (creatorInfo?.is_contract) {
    const ctx = info.creation_transaction_hash || info.creation_tx_hash;
    const tx = ctx ? await getJSON(`${base}/transactions/${enc(ctx)}`).catch(() => null) : null;
    dev = tx?.from?.hash && !tx.from.is_contract ? tx.from.hash : null;
    if (!dev) return null;
  }
  const items = Array.isArray(hold?.items) ? hold.items : [];
  const h = items.find(x => normAddr(x?.address?.hash) === normAddr(dev));
  let raw = h ? num(h.value) : null;
  if (raw == null) {
    const bal = await rpc(CHAINS[chain].rpc, "eth_call", [{ to: addr, data: "0x70a08231" + dev.replace(/^0x/, "").toLowerCase().padStart(64, "0") }, "latest"]).catch(() => null);
    if (bal == null) return null;
    raw = Number(BigInt(bal));
  }
  return clampPct(raw / supply * 100);
}
async function loadGrade(chain, addr) {
  const c = CHAINS[chain];
  let dev = null;
  if (c.security === "rugcheck") dev = gradeFromRugCheck(await getJSON(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(addr)}/report`));
  else if (c.goplus) dev = await gradeFromGoPlus(chain, addr);
  else if (c.security === "blockscout") dev = await gradeFromBlockscout(chain, addr);
  return dev == null ? null : { devPct: dev, grade: gradeFor(dev) };
}

/* ---------- paid profile ---------- */
async function loadProfile(chain, addr) {
  const q = `select=symbol,name,icon_url&chain=eq.${encodeURIComponent(chain)}&address=eq.${encodeURIComponent(normAddr(addr))}&limit=1`;
  const rows = await getJSON(`${SUPABASE.url}/rest/v1/token_profiles?${q}`, { headers: { apikey: SUPABASE.key } }, 4000);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/* ---------- everything for one pair ---------- */
export async function loadToken(chain, pair) {
  const ds = await getJSON(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`);
  const p = (Array.isArray(ds?.pairs) ? ds.pairs : [ds?.pair]).find(Boolean);
  if (!p?.baseToken?.address) return null;
  const addr = p.baseToken.address;
  const timed = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms))]).catch(() => null);
  // the grade is a nice-to-have on the card: give it a few seconds, then draw without it
  const [profile, grade] = await Promise.all([timed(loadProfile(chain, addr), 3000), timed(loadGrade(chain, addr), 4500)]);
  const mcap = num(p.marketCap) ?? num(p.fdv);
  const free = (mcap ?? 0) >= FREE_INFO_MCAP;
  return {
    chain, chainName: CHAINS[chain].name, pair, address: addr,
    symbol: String(profile?.symbol || p.baseToken.symbol || "?").slice(0, 20),
    name: String(profile?.name || p.baseToken.name || "").slice(0, 60),
    quote: p.quoteToken?.symbol || "",
    price: num(p.priceUsd), change24: num(p.priceChange?.h24), mcap,
    liquidity: num(p.liquidity?.usd), volume: num(p.volume?.h24),
    logo: profile?.icon_url || (free ? p.info?.imageUrl || null : null),
    grade: grade?.grade || null, devPct: grade?.devPct ?? null,
  };
}

/* ---------- formatting (same style as the site) ---------- */
export function priceParts(p) {
  if (p == null || !Number.isFinite(p)) return { text: "–" };
  const a = Math.abs(p);
  if (a >= 1000) return { text: "$" + p.toLocaleString("en-US", { maximumFractionDigits: 2 }) };
  if (a >= 1) return { text: "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) };
  if (a >= 0.0001) return { text: "$" + String(Number(p.toPrecision(4))) };
  const [mant, exp] = p.toExponential(3).split("e");
  const zeros = -parseInt(exp, 10) - 1;
  const digits = mant.replace("-", "").replace(".", "").replace(/0+$/, "") || "0";
  return { text: "$0.0", sub: String(zeros), rest: digits }; // $0.0₅1234
}
export const priceText = p => { const x = priceParts(p); return x.sub ? `${x.text}${x.sub.split("").map(d => "₀₁₂₃₄₅₆₇₈₉"[d]).join("")}${x.rest}` : x.text; };
export function fmtUsd(v) {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(a >= 1 ? 0 : 2);
}
export const fmtPct = v => v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
export const originOf = request => {
  const u = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || u.host;
  const proto = request.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
};
