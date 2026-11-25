// Dólar oficial: devuelve los proveedores oficiales de ComparaDólar (más los manuales de config.json).
// El filtro por proveedor lo hace la página. Si no se detecta cuáles son "oficiales", usa la lista "respaldo".
const cfg = require('../../config.json');

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const pick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; };
const pretty = s => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
    const r = await fetch(cfg.source, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('La fuente respondió ' + r.status);
    const raw = await r.json();
    if (event.queryStringParameters?.raw) return reply(raw);

    const items = flatten(raw).map(o => ({
      o,
      id: pick(o, ['slug', 'id', 'key']) || pick(o, ['name', 'nombre', 'title']),
      type: String(pick(o, ['type', 'tipo', 'category', 'categoria', 'kind', 'group', 'market', 'segment']) ?? o._group ?? '')
    })).filter(x => x.id);

    const types = [...new Set(items.map(x => x.type).filter(Boolean))];
    const oficiales = items.filter(x => norm(x.type).includes('oficial'));
    let chosen, mode;
    if (oficiales.length) { chosen = oficiales; mode = 'tipo'; }
    else { const want = cfg.respaldo.map(norm); chosen = items.filter(x => want.includes(norm(x.id))); mode = 'respaldo'; }

    const seen = new Set(), providers = [];
    for (const { o, id } of chosen) {
      if (seen.has(id)) continue; seen.add(id);
      const rawName = pick(o, ['name', 'nombre', 'title']) || id;
      providers.push({
        id,
        name: cfg.names?.[id] || pretty(rawName),
        buy: num(pick(o, ['totalAsk', 'ask', 'venta', 'sell', 'price'])),   // lo que pagás para comprar USD
        sell: num(pick(o, ['totalBid', 'bid', 'compra', 'buy'])),           // lo que te pagan al vender USD
        h24: !!pick(o, ['is24x7', 'h24', 'always']),
        updatedAt: pick(o, ['updatedAt', 'time', 'timestamp', 'fecha']) || null
      });
    }
    for (const m of cfg.manual || []) providers.push({ id: 'manual-' + norm(m.name), name: m.name, buy: num(m.buy), sell: num(m.sell), manual: true, updatedAt: m.updatedAt });
    for (const p of providers) p.spread = p.buy && p.sell ? ((p.buy - p.sell) / p.buy) * 100 : null;

    return reply({ updatedAt: new Date().toISOString(), meta: { mode, types }, providers });
  } catch (e) {
    return reply({ error: e.message }, 502);
  }
};
