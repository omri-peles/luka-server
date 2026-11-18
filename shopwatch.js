// Watches the shop for a new order and tells the owner: on the tablet (voice + card) and on WhatsApp.
import { load, save } from './store.js';
import { shopifyOn, latestOrder } from './shopify.js';
import { announce } from './sites.js';

async function check() {
  if (!shopifyOn()) return;
  const o = await latestOrder(); if (!o) return;
  const s = load();
  if (!s.lastOrderId) { s.lastOrderId = o.id; save(); return; }        // first run: just remember where we are
  if (s.lastOrderId === o.id) return;
  s.lastOrderId = o.id; save();
  const text = `אדוני, הזמנה חדשה בחנות: ${o.name}, ${o.total}. ${o.items}`;
  announce(text, { title: 'הזמנה חדשה', rows: [{ label: 'מספר', value: o.name }, { label: 'סכום', value: o.total }, { label: 'פריטים', value: o.items }] }, null, true);
}
setInterval(() => check().catch(e => console.error('shop watch', e.message)), 180000).unref();
setTimeout(() => check().catch(() => {}), 20000).unref();
