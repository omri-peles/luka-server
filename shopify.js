// Read-only window into the owner's Shopify store (tablet agent only).
// Active only when SHOPIFY_STORE, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set in Railway.
const STORE = () => (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\.myshopify\.com.*$/, '').trim();
const VER = () => process.env.SHOPIFY_API_VERSION || '2026-07';
export const shopifyOn = () => !!(STORE() && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
let tok = { value: '', exp: 0 };

async function token() {
  if (tok.value && Date.now() < tok.exp) return tok.value;
  const r = await fetch(`https://${STORE()}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }) });
  if (!r.ok) throw new Error('החנות סירבה לתת גישה (HTTP ' + r.status + '): ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  tok = { value: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 };
  return tok.value;
}
async function gql(query, variables) {
  const r = await fetch(`https://${STORE()}.myshopify.com/admin/api/${VER()}/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': await token() },
    body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error('שגיאה מהחנות: ' + JSON.stringify(j.errors || r.status).slice(0, 300));
  return j.data;
}
const money = (s) => s && s.shopMoney ? `${Number(s.shopMoney.amount).toLocaleString('he-IL')} ${s.shopMoney.currencyCode}` : '';

export async function shopifyOrders(days, limit) {
  try {
    const d = Math.max(1, Math.min(60, Number(days) || 1)), n = Math.max(1, Math.min(50, Number(limit) || 50));
    const since = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const data = await gql(`query($q:String!,$n:Int!){ orders(first:$n, sortKey:CREATED_AT, reverse:true, query:$q){ edges{ node{ name createdAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet{ shopMoney{ amount currencyCode } } lineItems(first:5){ edges{ node{ title quantity } } } } } } }`, { q: 'created_at:>=' + since, n });
    const o = data.orders.edges.map(e => e.node);
    if (!o.length) return `אין הזמנות ב-${d} הימים האחרונים.`;
    const total = o.reduce((a, x) => a + Number(x.currentTotalPriceSet.shopMoney.amount), 0);
    const cur = o[0].currentTotalPriceSet.shopMoney.currencyCode;
    return `ב-${d} הימים האחרונים (מאז ${since}): ${o.length} הזמנות${o.length === n ? ' לפחות' : ''}, בסך ${total.toLocaleString('he-IL')} ${cur}.\n` +
      o.slice(0, 15).map(x => `- ${x.name}, ${x.createdAt.slice(0, 10)}, ${money(x.currentTotalPriceSet)}, תשלום ${x.displayFinancialStatus}, משלוח ${x.displayFulfillmentStatus}: ` + x.lineItems.edges.map(l => `${l.node.quantity}x ${l.node.title}`).join('; ')).join('\n');
  } catch (e) { return 'לא הצלחתי לקרוא הזמנות. ' + e.message; }
}
export async function shopifyProducts(query, lowStock) {
  try {
    const q = [(query || '').toString().trim(), lowStock != null && lowStock !== '' ? `inventory_total:<=${Number(lowStock) || 0}` : ''].filter(Boolean).join(' ');
    const data = await gql(`query($q:String,$n:Int!){ products(first:$n, query:$q){ edges{ node{ title status totalInventory priceRangeV2{ minVariantPrice{ amount currencyCode } } } } } }`, { q: q || null, n: 20 });
    const p = data.products.edges.map(e => e.node);
    if (!p.length) return 'לא נמצאו מוצרים מתאימים בחנות.';
    return p.map(x => `- ${x.title}: ${Number(x.priceRangeV2.minVariantPrice.amount).toLocaleString('he-IL')} ${x.priceRangeV2.minVariantPrice.currencyCode}, מלאי ${x.totalInventory}, מצב ${x.status}`).join('\n');
  } catch (e) { return 'לא הצלחתי לקרוא מוצרים. ' + e.message; }
}
