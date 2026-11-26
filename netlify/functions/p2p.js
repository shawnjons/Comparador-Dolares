// Anuncios P2P de USDT/ARS en Binance, OKX y Bybit, unidos y ordenados por precio.
// type=BUY: vos comprás USDT (precio menor primero). type=SELL: vos vendés USDT (precio mayor primero).
// ex=binance,okx,bybit (cuáles consultar) · merchant=1 (solo comerciantes verificados) · debug=1 (respuesta cruda) · debug=sample (un anuncio de cada exchange)
// Ojo: OKX y Bybit no tienen API pública oficial para esto; usan los mismos endpoints que sus webs.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PER_EXCHANGE = 10;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const pct = v => { const n = num(v); return n == null ? null : (n <= 1 ? n * 100 : n); };

async function http(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': UA, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('respondió ' + r.status);
    return await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'tardó demasiado' : e.message);
  } finally { clearTimeout(t); }
}

// Bybit devuelve los medios de pago como códigos; se traducen con su lista de métodos (se guarda en memoria unas horas)
let payMap = null, payAt = 0;
async function bybitPayMap() {
  if (payMap && Date.now() - payAt < (Object.keys(payMap).length ? 6 * 3600e3 : 600e3)) return payMap;
  const map = {};
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const id = o.paymentType ?? o.paymentId ?? o.id, name = o.paymentName ?? o.name;
    if (id != null && typeof name === 'string' && name) map[String(id)] = name;
    Object.values(o).forEach(walk);
  };
  for (const opts of [{}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }]) {
    try { walk((await http('https://api2.bybit.com/fiat/otc/configuration/queryAllPaymentList', opts)).result); } catch {}
    if (Object.keys(map).length) break;
  }
  payMap = map; payAt = Date.now();
  return map;
}

const adapters = {
  async binance(type, merchant) {
    const j = await http('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fiat: 'ARS', asset: 'USDT', tradeType: type, page: 1, rows: 20,
        countries: [], payTypes: [], publisherType: merchant ? 'merchant' : null, proMerchantAds: false, shieldMerchantAds: false
      })
    });
    return { raw: j, sample: j.data?.[0], ads: (j.data || []).map(({ adv, advertiser }) => ({
      price: num(adv.price), available: num(adv.tradableQuantity), min: num(adv.minSingleTransAmount), max: num(adv.maxSingleTransAmount),
      methods: (adv.tradeMethods || []).map(m => m.tradeMethodName || m.identifier).filter(Boolean),
      nick: advertiser.nickName, verified: advertiser.userType === 'merchant',
      badges: (advertiser.tagIconUrls || []).filter(u => typeof u === 'string').map(url => ({ url })),
      orders: advertiser.monthOrderCount ?? null, rate: advertiser.monthFinishRate != null ? advertiser.monthFinishRate * 100 : null
    })) };
  },

  async okx(type, merchant) {
    const side = type === 'BUY' ? 'sell' : 'buy'; // en OKX, side=sell lista a quienes venden (vos comprás)
    const q = new URLSearchParams({
      t: Date.now(), quoteCurrency: 'ARS', baseCurrency: 'USDT', side, paymentMethod: 'all',
      userType: merchant ? 'certified' : 'all', showTrade: 'false', receivingAds: 'false',
      showFollow: 'false', showAlreadyTraded: 'false', isAbleFilter: 'false'
    });
    const j = await http('https://www.okx.com/v3/c2c/tradingOrders/books?' + q);
    if (j.code != null && String(j.code) !== '0') throw new Error(j.msg || j.detailMsg || 'error ' + j.code);
    const list = Array.isArray(j.data) ? j.data : (j.data?.[side] || []);
    return { raw: j, sample: list[0], ads: list.map(x => ({
      price: num(x.price), available: num(x.availableAmount), min: num(x.quoteMinAmountPerOrder), max: num(x.quoteMaxAmountPerOrder),
      methods: (x.paymentMethods || []).map(p => typeof p === 'string' ? p : (p.name || p.paymentMethod)).filter(Boolean),
      nick: x.nickName || x.publicUserId, verified: x.creatorType === 'certified' || !!merchant,
      badges: (x.badgeInfo?.badgeList || []).filter(b => b.designUrl).map(b => ({ url: b.designUrl, urlDark: b.designUrlDark, title: b.title })),
      orders: num(x.completedOrderQuantity), rate: pct(x.completedRate)
    })) };
  },

  async bybit(type, merchant) {
    const j = await http('https://api2.bybit.com/fiat/otc/item/online', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: '', tokenId: 'USDT', currencyId: 'ARS', payment: [], side: type === 'BUY' ? '1' : '0',
        size: '20', page: '1', amount: '', authMaker: !!merchant, canTrade: false
      })
    });
    if (j.ret_code != null && j.ret_code !== 0) throw new Error(j.ret_msg || 'error ' + j.ret_code);
    const names = await bybitPayMap();
    return { raw: j, sample: j.result?.items?.[0], ads: (j.result?.items || []).map(x => ({
      price: num(x.price), available: num(x.lastQuantity), min: num(x.minAmount), max: num(x.maxAmount),
      methods: (x.payments || []).map(id => names[String(id)]).filter(Boolean),
      nick: x.nickName, verified: merchant ? true : null,
      orders: num(x.recentOrderNum), rate: pct(x.recentExecuteRate)
    })) };
  }
};

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.debug === 'pay') { const m = await bybitPayMap(); return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: Object.keys(m).length, map: m }) }; }
  const type = q.type === 'BUY' ? 'BUY' : 'SELL';
  const merchant = q.merchant === '1';
  const want = (q.ex || 'binance,okx,bybit').split(',').filter(e => adapters[e]);
  const results = await Promise.allSettled(want.map(e => adapters[e](type, merchant)));

  const ads = [], errors = {}, raw = {}, sample = {};
  results.forEach((r, i) => {
    const ex = want[i];
    if (r.status === 'rejected') { errors[ex] = r.reason.message; return; }
    raw[ex] = r.value.raw; sample[ex] = r.value.sample;
    r.value.ads.filter(a => a.price != null && a.nick).slice(0, PER_EXCHANGE).forEach(a => ads.push({ ...a, ex }));
  });
  ads.sort((a, b) => type === 'BUY' ? a.price - b.price : b.price - a.price);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'Netlify-CDN-Cache-Control': 'public, s-maxage=4, stale-while-revalidate=10' },
    body: JSON.stringify(q.debug === 'sample' ? { errors, sample } : q.debug ? { errors, raw } : { updatedAt: new Date().toISOString(), type, ads, errors })
  };
};
