/* Cloudflare Worker: a thin gate in front of the Google Apps Script Web app.
 *
 *   Browser ──▶ this Worker ──▶ Apps Script
 *
 * Settings (Worker → Settings → Variables and Secrets):
 *   APPS_SCRIPT_URL  (secret)  the …/exec address of the Apps Script Web app
 *   PROXY_KEY        (secret)  a long random string; the same value goes into Apps Script as Script Property PROXY_KEY
 *   ALLOWED_ORIGIN   (text)    https://<your-user>.github.io   (no trailing slash, no path)
 */
const ACTIONS = new Set(['login', 'publicStock', 'bootstrap', 'addMovements', 'saveItem', 'saveItems', 'cancelMovement']);
const MAX_BODY = 300000;   // bytes; a full day's entries is far smaller

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {...cors, 'Content-Type': 'application/json'}});

    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (request.method !== 'POST') return reply({ok: false, error: 'Not found.'}, 404);
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return reply({ok: false, error: 'Not allowed.'}, 403);

    const text = await request.text();
    if (text.length > MAX_BODY) return reply({ok: false, error: 'Request too large.'}, 413);
    let body; try { body = JSON.parse(text); } catch { return reply({ok: false, error: 'Bad request.'}, 400); }
    if (!body || typeof body !== 'object' || !ACTIONS.has(body.action)) return reply({ok: false, error: 'Unknown action.'}, 400);

    body.proxyKey = env.PROXY_KEY;          // always set here; anything the browser sent is overwritten
    let upstream;
    try {
      upstream = await fetch(env.APPS_SCRIPT_URL, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body), redirect: 'follow'});
    } catch { return reply({ok: false, error: 'Could not reach the stock sheet. Try again.'}, 502); }
    const out = await upstream.text();
    try { JSON.parse(out); } catch { return reply({ok: false, error: 'Unexpected reply from the stock sheet.'}, 502); }
    return new Response(out, {status: 200, headers: {...cors, 'Content-Type': 'application/json'}});
  },
};
