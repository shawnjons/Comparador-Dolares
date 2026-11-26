// Dólar oficial: devuelve los proveedores oficiales de ComparaDólar (más los manuales de config.json).
// El filtro por proveedor lo hace la página. Si no se detecta cuáles son "oficiales", usa la lista "respaldo".
const cfg = require('../../config.json');

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const pick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; };
const pretty = s => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const USDT_SRC = cfg.usdtSource || cfg.source.replace(/\/usd$/, '/usdt');
async function fetchJson(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  try { const r = await fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const reply = (body, status = 200) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'Netlify-CDN-Cache-Control': 'public, s-maxage=20, stale-while-revalidate=40' },
  body: JSON.stringify(body)
});

function flatten(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  const out = [];
  for (const [k, v] of Object.entries(raw.data || raw)) {
    if (Array.isArray(v)) v.forEach(o => out.push({ _group: k, ...o }));
    else if (v && typeof v === 'object') out.push({ slug: k, ...v });
  }
  return out;
}

exports.handler = async (event) => {
  try {
    const usdtP = fetchJson(USDT_SRC).catch(() => null); // se pide en paralelo; si falla, se ignora
    const r = await fetch(cfg.source, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('La fuente respondió ' + r.status);
    const raw = await r.json();
    if (event.queryStringParameters?.raw === 'usdt') return reply(await usdtP);
    if (event.queryStringParameters?.raw) return reply(raw);

    const items = flatten(raw).map(o => ({
      o,
      id: pick(o, ['slug', 'id', 'key']) || pick(o, ['name', 'nombre', 'title']),
      type: String(pick(o, ['usdType', 'type', 'tipo', 'category', 'categoria', 'kind', 'group', 'market', 'segment']) ?? o._group ?? '')
    })).filter(x => x.id);

    const types = [...new Set(items.map(x => x.type).filter(Boolean))];
    const oficiales = items.filter(x => norm(x.type).includes('oficial'));
    let chosen, mode;
    if (oficiales.length) { chosen = oficiales; mode = 'tipo'; }
    else { const want = cfg.respaldo.map(norm); chosen = items.filter(x => want.includes(norm(x.id))); mode = 'respaldo'; }

    const skip = new Set((cfg.excluir || []).map(norm)); // proveedores que no se quieren mostrar (ej. variantes para clientes premium)
    chosen = chosen.filter(x => !skip.has(norm(x.id)));

    const seen = new Set(), providers = [];
    for (const { o, id } of chosen) {
      if (seen.has(id)) continue; seen.add(id);
      const rawName = pick(o, ['name', 'nombre', 'title']) || id;
      providers.push({
        id,
        name: cfg.names?.[id] || o.prettyName || pretty(rawName),
        buy: num(pick(o, ['totalAsk', 'ask', 'venta', 'sell', 'price'])),   // lo que pagás para comprar USD
        sell: num(pick(o, ['totalBid', 'bid', 'compra', 'buy'])),           // lo que te pagan al vender USD
        h24: !!pick(o, ['is24x7', 'h24', 'always']),
        logo: o.logoUrl || null,
        stale: !!o.stale,                       // dato viejo: ComparaDólar lo marca como desactualizado
        conditions: o.conditions || null,       // ej. "Solo para clientes Ultra"
        updatedAt: pick(o, ['lastSeenAt', 'updatedAt', 'time', 'timestamp', 'fecha']) || null
      });
    }
    for (const m of cfg.manual || []) providers.push({ id: 'manual-' + norm(m.name), name: m.name, buy: num(m.buy), sell: num(m.sell), manual: true, logo: m.logo || null, updatedAt: m.updatedAt });

    // Tasa de conversión de Fiwind (USDT por 1 USD): dólar cripto de Fiwind (venta) ÷ USDT de Fiwind (venta)
    let fiwind = null;
    try {
      const u = await usdtP;
      const o1 = items.find(x => norm(x.id) === 'fiwindcripto')?.o;
      const o2 = u && flatten(u).find(o => norm(pick(o, ['slug', 'id', 'key']) || '').startsWith('fiwind'));
      const bid = o => o && num(pick(o, ['totalBid', 'bid', 'compra', 'buy']));
      const usdBid = bid(o1), usdtBid = bid(o2);
      const rate = usdBid && usdtBid ? usdBid / usdtBid : null;
      if (rate && rate > 0.5 && rate < 1.5) {
        const ts = [o1, o2].map(o => Date.parse(pick(o, ['time', 'lastSeenAt', 'updatedAt']) || '')).filter(Number.isFinite);
        fiwind = { rate, usdBid, usdtBid, at: ts.length ? new Date(Math.min(...ts)).toISOString() : null }; // se toma el dato más viejo de los dos
      }
    } catch {}

    return reply({ updatedAt: new Date().toISOString(), fiwind, meta: { mode, types, total: items.length, fields: items[0] ? Object.keys(items[0].o) : [] }, providers });
  } catch (e) {
    return reply({ error: e.message }, 502);
  }
};
