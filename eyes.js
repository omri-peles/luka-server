// Luka's eyes (tablet page only): when she is asked what she sees, the server asks the open
// tablet page for one camera frame. The page takes it, sends it here, and turns the camera off.
import express from 'express';

const waiters = new Map();

// control(obj) writes a line into the open reply stream of the tablet page.
export function askFrame(control) {
  if (!control) return Promise.resolve(null);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return new Promise(resolve => {
    const t = setTimeout(() => { waiters.delete(id); resolve(null); }, 12000);
    waiters.set(id, (buf) => { clearTimeout(t); resolve(buf); });
    try { control({ need: 'camera', id }); } catch { clearTimeout(t); waiters.delete(id); resolve(null); }
  });
}

export function mountEyes(app, authOk) {
  app.post('/camera/frame', express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'bad token' });
    const w = waiters.get(req.get('x-frame-id') || '');
    if (!w) return res.json({ ok: false });
    waiters.delete(req.get('x-frame-id'));
    const buf = Buffer.isBuffer(req.body) && req.body.length > 2000 && !req.get('x-frame-error') ? req.body : null;
    w(buf);
    res.json({ ok: !!buf });
  });
}
