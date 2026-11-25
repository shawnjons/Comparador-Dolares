// Anuncios P2P de USDT/ARS en Binance. type=SELL: vos vendés USDT. type=BUY: vos comprás.
const reply = (body, status = 200) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'Netlify-CDN-Cache-Control': 'public, s-maxage=4, stale-while-revalidate=10' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const tradeType = event.queryStringParameters?.type === 'BUY' ? 'BUY' : 'SELL';
  try {
    const r = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        fiat: 'ARS', asset: 'USDT', tradeType, page: 1, rows: 20,
        countries: [], payTypes: [], publisherType: event.queryStringParameters?.merchant === '1' ? 'merchant' : null, proMerchantAds: false, shieldMerchantAds: false
      })
    });
    if (!r.ok) throw new Error('Binance respondió ' + r.status);
    const j = await r.json();
    const ads = (j.data || []).map(({ adv, advertiser }) => ({
      price: +adv.price,
      available: +adv.tradableQuantity,
      min: +adv.minSingleTransAmount,
      max: +adv.maxSingleTransAmount,
      methods: (adv.tradeMethods || []).map(m => m.tradeMethodName || m.identifier).filter(Boolean),
      nick: advertiser.nickName,
      verified: advertiser.userType === 'merchant',
      orders: advertiser.monthOrderCount,
      rate: advertiser.monthFinishRate != null ? advertiser.monthFinishRate * 100 : null
    }));
    return reply({ updatedAt: new Date().toISOString(), type: tradeType, ads });
  } catch (e) {
    return reply({ error: e.message }, 502);
  }
};
