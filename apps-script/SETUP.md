# Setup — Google Sheet backend

Once, about 10 minutes. After this you never open Apps Script again.

---

## 1. Create the Sheet

[sheets.new](https://sheets.new) — name it something like **Channel Command Center — Data**.

## 2. Add the script

1. **Extensions → Apps Script**
2. Delete the `function myFunction() {}` placeholder
3. Copy **all** of `Code.gs` from this folder and paste it in
4. Save (Ctrl/Cmd-S)
5. Add a second file for the Outlook sync: **+** next to *Files* → **Script**, name it
   `Outlook`, paste in `Outlook.gs`, save. (Skip if you don't want Outlook sync — the
   rest works without it, though the menu items will error if you click them.)

## 3. Run setup

1. Set the function dropdown to **`setup`**, click **Run**
2. First run asks permission:
   - *Review permissions* → choose your account
   - "Google hasn't verified this app" → **Advanced** → **Go to … (unsafe)**
   - It's your own script on your own Sheet. **Allow**.
3. A box shows your **access token** — 24 characters. **Copy it now.**

Eight tabs appear: `Activities`, `Opportunities`, `Availability`, `Partners`, `Outlook`, `Lists`, `Layout`, `Log`.

> One token both unlocks the site and authorises changes. Anyone holding it can read
> your whole pipeline, including customer contacts. Treat it like a password. You can
> see it again any time from the Sheet's **Command Center → Show access token** menu.

## 4. Deploy as a Web App

1. **Deploy → New deployment**
2. Gear icon next to "Select type" → **Web app**
3. Set:

   | Field | Value |
   |---|---|
   | Description | `command center api` |
   | Execute as | **Me** |
   | Who has access | **Anyone** |

4. **Deploy**, copy the **Web app URL** — it ends in `/exec`

### "Anyone" — doesn't that expose my data?

No. "Anyone" only means Google accepts the request without a Google login. Every
request still has to carry your access token, and the script rejects anything without
one:

```js
if (!checkToken(body.token)) return json({ ok:false, error:'Invalid access token.' });
```

Opening the URL in a browser returns nothing but an error. The setting is required
because your site is a plain web page, not a Google-authenticated app.

## 5. Point the site at it

`config.js`:

```js
apiUrl: 'https://script.google.com/macros/s/AKfycb...../exec',
```

Commit and push.

## 6. Load your data

1. Open the site, enter the access token
2. **Tools → First-time data import**
3. Choose **`seed-private-data-v4.json`**
4. It previews the counts — 162 activities · 72 opportunities · 166 availability days ·
   74 partners · 26 layout panels → **Import**

Give it up to a minute; it writes several hundred rows.

> **Never commit `seed-private-data-v4.json`.** It holds customer names, emails and
> phone numbers. `.gitignore` already excludes it, but don't drag it into the GitHub
> web uploader either.

---

## The Sheet menu

A **Command Center** menu appears with:

| Item | What it does |
|---|---|
| **Show access token** | When you've forgotten it |
| **Re-run setup** | Recreates any tab you deleted |
| **Apply colours** | Colour-codes kind, stage and availability |
| **Recalculate kind from type** | Rewrites the `kind` column from `type` — run after you add a new activity type, or if someone edited `kind` by hand |
| **Rebuild partner list from data** | Regenerates `Partners` from names actually in use |
| **Rebuild read-only summary** | Writes a Summary tab showing each opportunity's activity count, first and last activity, and latest product / next action / follow-up — handy for reading the Sheet without opening the site |
| **Rotate access token** | New token, old one stops working |

## Re-deploying after editing Code.gs

**Deploy → Manage deployments → pencil → Version: New version → Deploy.** The URL
stays the same. A *new deployment* gives you a new URL and means editing `config.js`.

## Editing the Sheet by hand

All tabs are plain readable rows.

- **Activities** — one row per thing you did. Leave `id` alone. `kind` is overwritten
  from `type` on every read, so don't bother editing it. `oppId` blank means the
  activity isn't linked to an opportunity.
- **Opportunities** — 16 columns, ending at `partnerPreSalesContact` and `stage`.
  Product, next action and follow-up deliberately are not here; the site reads them
  from the most recent linked activity.
- **Availability** — one row per date, one column per 30-minute slot. Type `Free`,
  `Busy`, `Travelling`, `Holiday` or `Personal`. `fullDay` overrides the slots.
- **Partners** — don't change `key`; it's how activities and opportunities join.
- **Layout** — your dashboard. `on` = 1 shows the panel, row order = display order.
  Easier to change from the site.

## Changing the working day

Change it in **both** places or the slot columns won't line up:

- `config.js` → `dayStart`, `dayEnd`, `slotMinutes`
- `apps-script/Code.gs` → `DAY_START`, `DAY_END`, `SLOT_MIN`

Then re-run `setup` and deploy a new version.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *"Could not reach the Google Sheet"* | `apiUrl` wrong, or deployment access isn't "Anyone". Paste the `/exec` URL in a browser — `{"ok":false,"error":"This site is private…"}` means it's alive and working. |
| *"Invalid access token"* | Sheet → **Command Center → Show access token**. |
| Site loads but everything is empty | Run the first-time import. |
| Saves fail silently | Browser console (F12). A CORS error means the deployment isn't "Anyone". |
| Dates shift by a day | Format `date` columns as **Plain text** or `YYYY-MM-DD`. |
| An activity shows the wrong kind | Run **Command Center → Recalculate kind from type**. |
| Import times out | Re-run it. `importAll` overwrites, so a retry is safe. |
