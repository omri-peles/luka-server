// Read-only window into the owner's Shopify store (tablet agent only).
// Active only when SHOPIFY_STORE, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are set in Railway.
const STORE = () => (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\.myshopify\.com.*$/, '').trim();
const VER = () => process.env.SHOPIFY_API_VERSION || '2026-07';
export const shopifyOn = () => !!(STORE() && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
import { confirmed, ASK } from './gate.js';
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
async function gql(query, variables, retried = false) {
  const r = await fetch(`https://${STORE()}.myshopify.com/admin/api/${VER()}/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': await token() },
    body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  // A token issued before a permission was added does not carry it: get a fresh one and try once more.
  if (!retried && (r.status === 401 || r.status === 403 || /ACCESS_DENIED|access denied/i.test(JSON.stringify(j.errors || '')))) { tok = { value: '', exp: 0 }; return gql(query, variables, true); }
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
export async function latestOrder() {
  const data = await gql(`{ orders(first:1, sortKey:CREATED_AT, reverse:true){ edges{ node{ id name currentTotalPriceSet{ shopMoney{ amount currencyCode } } lineItems(first:5){ edges{ node{ title quantity } } } } } } }`);
  const n = data.orders.edges[0] && data.orders.edges[0].node; if (!n) return null;
  return { id: n.id, name: n.name, total: money(n.currentTotalPriceSet), items: n.lineItems.edges.map(l => `${l.node.quantity}x ${l.node.title}`).join(', ') };
}
export async function shopifyProducts(query, lowStock) {
  try {
    const q = [(query || '').toString().trim(), lowStock != null && lowStock !== '' ? `inventory_total:<=${Number(lowStock) || 0}` : ''].filter(Boolean).join(' ');
    const data = await gql(`query($q:String,$n:Int!){ products(first:$n, query:$q){ edges{ node{ title status totalInventory priceRangeV2{ minVariantPrice{ amount currencyCode } } } } } }`, { q: q || null, n: 50 });
    const p = data.products.edges.map(e => e.node);
    if (!p.length) return 'לא נמצאו מוצרים מתאימים בחנות.';
    return p.map(x => `- ${x.title}: ${Number(x.priceRangeV2.minVariantPrice.amount).toLocaleString('he-IL')} ${x.priceRangeV2.minVariantPrice.currencyCode}, מלאי ${x.totalInventory}, מצב ${x.status}`).join('\n');
  } catch (e) { return 'לא הצלחתי לקרוא מוצרים. ' + e.message; }
}

export async function shopifySetPrice(title, price) {
  try {
    const t = (title || '').toString().trim(); const p = Number(price);
    if (t.length < 2 || !(p > 0 && p < 1000000)) return 'לא בוצע: חסר שם מוצר או מחיר תקין.';
    const data = await gql(`query($q:String!){ products(first:5, query:$q){ edges{ node{ id title variants(first:20){ edges{ node{ id price } } } } } } }`, { q: 'title:*' + t.replace(/["\\]/g, ' ') + '*' });
    const found = data.products.edges.map(e => e.node);
    if (!found.length) return 'לא בוצע: לא נמצא מוצר בשם הזה בחנות.';
    if (found.length > 1) return 'לא בוצע: נמצאו כמה מוצרים מתאימים, צריך שם מדויק יותר: ' + found.map(x => x.title).join(' | ');
    const prod = found[0]; const vars = prod.variants.edges.map(e => e.node);
    const old = [...new Set(vars.map(v => v.price))].join(', ');
    if (!confirmed('price:' + prod.id + '|' + p)) return ASK(`שינוי המחיר של "${prod.title}" מ-${old} ל-${p}, בכל ${vars.length} הגרסאות שלו`);
    const res = await gql(`mutation($id:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$id, variants:$v){ userErrors{ message } } }`, { id: prod.id, v: vars.map(v => ({ id: v.id, price: String(p) })) });
    const errs = res.productVariantsBulkUpdate.userErrors || [];
    if (errs.length) return 'המחיר לא שונה: ' + errs.map(e => e.message).join('; ');
    return `המחיר של "${prod.title}" שונה מ-${old} ל-${p}.`;
  } catch (e) { return 'המחיר לא שונה. ' + e.message + ' אם כתוב שחסרה הרשאה, צריך להוסיף לאפליקציה בשופיפיי את ההרשאה write_products.'; }
}

// The same shop data as numbers, for the graphic windows on the tablet screen. Read only.
export async function shopifyOrdersData(days) {
  const d = Math.max(1, Math.min(60, Number(days) || 1));
  const since = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const data = await gql(`query($q:String!,$n:Int!){ orders(first:$n, sortKey:CREATED_AT, reverse:true, query:$q){ edges{ node{ name createdAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet{ shopMoney{ amount currencyCode } } } } } }`, { q: 'created_at:>=' + since, n: 50 });
  const o = data.orders.edges.map(e => e.node);
  const byDay = {}; for (let i = d - 1; i >= 0; i--) byDay[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
  let total = 0;
  for (const x of o) { const a = Number(x.currentTotalPriceSet.shopMoney.amount) || 0; total += a; const k = x.createdAt.slice(0, 10); if (k in byDay) byDay[k] += a; }
  return { days: d, count: o.length, total: Math.round(total), cur: o[0] ? o[0].currentTotalPriceSet.shopMoney.currencyCode : '',
    bars: Object.values(byDay).slice(-14).map(v => Math.round(v)),
    items: o.slice(0, 6).map(x => ({ name: x.name, amount: Math.round(Number(x.currentTotalPriceSet.shopMoney.amount) || 0), paid: /PAID/.test(x.displayFinancialStatus) && !/UNPAID|PARTIALLY/.test(x.displayFinancialStatus), sent: x.displayFulfillmentStatus === 'FULFILLED' })) };
}
export async function shopifyProductsData(query, lowStock) {
  const q = [(query || '').toString().trim(), lowStock != null && lowStock !== '' ? `inventory_total:<=${Number(lowStock) || 0}` : ''].filter(Boolean).join(' ');
  const data = await gql(`query($q:String,$n:Int!){ products(first:$n, query:$q){ edges{ node{ title status totalInventory featuredImage{ url } priceRangeV2{ minVariantPrice{ amount currencyCode } } } } } }`, { q: q || null, n: 8 });
  return data.products.edges.map(e => e.node).map(x => ({ title: x.title.slice(0, 40), price: Math.round(Number(x.priceRangeV2.minVariantPrice.amount) || 0), cur: x.priceRangeV2.minVariantPrice.currencyCode, stock: x.totalInventory, on: x.status === 'ACTIVE', img: x.featuredImage ? x.featuredImage.url : '' }));
}
