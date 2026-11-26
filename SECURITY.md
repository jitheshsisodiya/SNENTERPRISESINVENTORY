# Keeping the Apps Script address private

**The honest part first.** A website can never fully hide the address it calls: the browser needs it, and anyone can see it in the browser's Network tab. Moving it into another file (`config.js`) or scrambling it only hides it from casual glances. It does **not** protect anything.

What actually protects your data is that the backend refuses everything without a valid sign-in, apart from the public Live stock page, which returns quantities only. Passwords are hashed, there is a lock-out after 5 wrong tries, and sign-ins expire.

If you also want the Apps Script address to stay out of the website entirely **and** be useless if it ever leaks, add the free Cloudflare proxy below. It takes about 15 minutes.

```
Browser ──▶ Cloudflare Worker (public address) ──▶ Apps Script (secret address, accepts only the Worker)
```

## Set-up (one time)

1. **Make a secret key.** Any long random text, e.g. 40+ letters and digits. Keep it for steps 3 and 4.
2. **Cloudflare:** create a free account → *Workers & Pages* → *Create* → *Hello World* → name it `sn-stock-api` → *Deploy* → *Edit code*. Replace everything with the contents of `proxy/worker.js` and *Deploy*.
3. **Worker → Settings → Variables and Secrets** — add:
   - `APPS_SCRIPT_URL` (type *Secret*): your Apps Script `…/exec` address
   - `PROXY_KEY` (type *Secret*): the key from step 1
   - `ALLOWED_ORIGIN` (type *Text*): `https://jitheshsisodiya.github.io` (your GitHub Pages address, with no trailing slash)
4. **Test the Worker first:** put its address (like `https://sn-stock-api.<you>.workers.dev`) in `config.js` as `api`, push to GitHub, and open the site. Live stock should load. At this point the proxy works but Apps Script still accepts direct calls, so nothing can break.
5. **Lock Apps Script to the Worker:** Apps Script → *Project Settings* → *Script properties* → add `PROXY_KEY` with the same key → *Save*. From now on, calls that do not come through the Worker are rejected, even with the real address.

> Do **not** do step 5 before step 4 works, or the website will stop loading.

To undo: delete the `PROXY_KEY` script property and put the Apps Script address back in `config.js`.

## What this does and does not give you
- The Apps Script address is no longer in the website's files or network traffic.
- Anyone who somehow learns that address still cannot use it.
- The Worker only answers requests from your website's origin and only for the known actions, and caps the request size.
- Anyone can still open the website and see the public Live stock (quantities only). Staff features still need a password.
- Use long passwords. Tell staff not to share them. Use **SN Inventory → Sign out everyone** if a phone is lost.
