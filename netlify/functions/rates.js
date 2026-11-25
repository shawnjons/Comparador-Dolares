// Dólar oficial: toma la API pública de ComparaDólar, deja solo tus proveedores y suma los manuales.
const cfg = require('../../config.json');

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const pick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; };
const reply = (body, status = 200) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'Netlify-CDN-Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  try {
    const r = await fetch(cfg.source, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('La fuente respondió ' + r.status);
    const raw = await r.json();
    if (event.queryStringParameters?.raw) return reply(raw); // para ver la estructura real

    const list = Array.isArray(raw) ? raw
      : Array.isArray(raw.data) ? raw.data
      : Object.entries(raw.data || raw).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => ({ slug: k, ...v }));

    const want = cfg.oficial.map(norm);
    const providers = [];
    for (const o of list) {
      const id = pick(o, ['slug', 'id', 'key']);
      const name = pick(o, ['name', 'nombre', 'title']) || id;
      if (!want.includes(norm(id)) && !want.includes(norm(name))) continue;
      // buy = lo que pagás vos para comprar USD; sell = lo que te pagan al vender
      const buy = num(pick(o, ['totalAsk', 'ask', 'venta', 'sell', 'price']));
      const sell = num(pick(o, ['totalBid', 'bid', 'compra', 'buy']));
      providers.push({
        id, name: (cfg.names && cfg.names[id]) || name, buy, sell,
        h24: !!pick(o, ['is24x7', 'h24', 'always']),
        updatedAt: pick(o, ['updatedAt', 'time', 'timestamp', 'fecha']) || null
      });
    }
    for (const m of cfg.manual) providers.push({ id: norm(m.name), name: m.name, buy: num(m.buy), sell: num(m.sell), manual: true, updatedAt: m.updatedAt });

    for (const p of providers) p.spread = p.buy && p.sell ? ((p.buy - p.sell) / p.buy) * 100 : null;
    return reply({ updatedAt: new Date().toISOString(), providers });
  } catch (e) {
    return reply({ error: e.message }, 502);
  }
};
