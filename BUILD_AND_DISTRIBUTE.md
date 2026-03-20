# Build & distribute the mobile app (APK for employees)

## What `EXPO_PUBLIC_CRM_URL` must be

| Scenario | Value |
|----------|--------|
| **Employee APK / production** | Your **deployed** CRM URL with **HTTPS**, e.g. `https://hearing-hope-crm.vercel.app` or your **custom domain**. Never use your laptop’s IP. |
| **Your phone on Wi‑Fi, CRM running locally** | `http://YOUR_LAN_IP:3000` (temporary dev only). |
| **Android emulator, CRM on same PC** | `http://10.0.2.2:3000` |
| **iOS simulator** | `http://localhost:3000` |

Employee devices use **mobile data or random Wi‑Fi**—they cannot reach `192.168.x.x` on your network. Point the app at wherever the CRM is **publicly** hosted (Vercel, etc.); see `hearing-hope-crm/HOSTING_GUIDE.md`.

`eas.json` sets `EXPO_PUBLIC_CRM_URL` for **preview** and **production** builds. **Change it there** if your live URL is not `https://hearing-hope-crm.vercel.app`.

---

## After `npm install` → build the APK

1. Install EAS CLI (once): `npm install -g eas-cli`
2. Log in: `eas login`
3. **First time only:** if you haven’t linked this repo to Expo, run `eas init` (project id is already in `app.config.ts`; say no to anything that wants to change it if unsure).
4. **[expo.dev](https://expo.dev)** → your project **hearing-hope-mobile** → **Environment variables** → add every **`EXPO_PUBLIC_FIREBASE_*`** (and optional **`EXPO_PUBLIC_EAS_PROJECT_ID`**) for **Preview** (and Production if you use that profile). Cloud builds **do not** read your local `.env`.
5. Confirm **`eas.json`** has the correct **`EXPO_PUBLIC_CRM_URL`** for your live CRM (HTTPS).
6. From this folder run: **`npm run build:apk`**
7. Wait for the cloud build (~10–20 min). Open the **download link** in the terminal or under **expo.dev → Builds** → share that **.apk** with staff.

---

## Prerequisites

1. **Node.js `>= 20.19.4`** (Expo SDK 54 / RN 0.81). If `npm` prints many `EBADENGINE` lines and seems slow or stuck, upgrade Node (e.g. [nvm](https://github.com/nvm-sh/nvm): `nvm install` in this folder reads `.nvmrc`).
2. **Expo account** (free): [expo.dev](https://expo.dev)
3. **EAS CLI** (run from this folder):

   ```bash
   npm install -g eas-cli
   eas login
   ```

4. **Link the project** (first time only):

   ```bash
   cd hearing-hope-mobile
   eas init
   ```

   The EAS project ID is already set in `app.config.ts` after setup. You can optionally set `EXPO_PUBLIC_EAS_PROJECT_ID` in `.env` to override locally.

5. **EAS Build cannot read your local `.env`** (it is gitignored). Set these on [expo.dev](https://expo.dev) → your project → **Environment variables** for **Preview** and **Production** (same names as below), **or** rely on non-secret values already in `eas.json` and only add secrets in the dashboard:

   | Variable | Notes |
   |----------|--------|
   | `EXPO_PUBLIC_CRM_URL` | Optional if correct in `eas.json`; set in dashboard to override. |
   | `EXPO_PUBLIC_EAS_PROJECT_ID` | From `eas init`. |
   | `EXPO_PUBLIC_FIREBASE_API_KEY` | Same as CRM `.env.local` / Firebase console. |
   | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | e.g. `hearing-hope-crm.firebaseapp.com` |
   | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | e.g. `hearing-hope-crm` |
   | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | |
   | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | |
   | `EXPO_PUBLIC_FIREBASE_APP_ID` | |

   Until these are set for cloud builds, the APK may install but **Firebase/login will fail**.

---

## Android: build APK (internal distribution)

From `hearing-hope-mobile`:

```bash
npm run build:apk
```

Equivalent:

```bash
eas build --platform android --profile preview
```

- Build runs in the cloud (~10–20 minutes).
- Download the APK from the link in the terminal or **expo.dev → Project → Builds**.

### Give the APK to employees

1. Share the **download link** (email, Drive, WhatsApp).
2. On the phone: open the link → download → install.
3. Android may require **Install unknown apps** permission for the browser or Files app.
4. They log in with **mobile-enabled** staff phone + password from the CRM.

---

## Quick reference

| Goal | Command |
|------|---------|
| Internal APK | `npm run build:apk` or `eas build --platform android --profile preview` |
| APK (production channel) | `npm run build:apk:production` |
| **OTA update** (preview channel) | `npm run update:preview` (clean git tree + logged into EAS) |
| **OTA update** (production channel) | `npm run update:production` |

---

## OTA updates (EAS Update)

The app includes **`expo-updates`**. `app.config.ts` sets **`runtimeVersion`** to **`appVersion`** and **`updates.url`** to the Expo Update server, and **`eas.json`** assigns **`channel`** **`preview`** / **`production`** to match how you built the APK.

### One-time: ship a new APK after enabling OTA

Employees must install an APK that was built **after** this config exists (native module + update URL baked in). Existing installs from older builds will not receive EAS Update bundles reliably.

1. Commit your changes (`requireCommit` is on for `eas build`).
2. Run **`npm run build:apk`** (preview) or **`npm run build:apk:production`** (production).
3. Distribute the new APK as usual.

### Day-to-day: publish JS/asset changes without a new APK

Only safe when you did **not** add native code, change `runtimeVersion` policy, or bump **`version`** in `app.config.ts` in a way that mismatches the binary (with **`appVersion`**, bumping app version means you need a **new store/APK** for that version line).

1. **Commit** your JS/TS/asset changes (EAS may require a clean tree).
2. Publish to the **same channel** as the APK employees use:
   - Preview APK → **`npm run update:preview`**
   - Production-profile APK → **`npm run update:production`**
3. Scripts use **`--auto`** (git branch + last commit subject as the update message). To set a message yourself:  
   `eas update --channel preview --platform android -m "Fix login" --non-interactive`

Employees get updates on **next cold start** (config uses **`checkAutomatically: ON_LOAD`**).

---

## iOS (optional)

Physical iPhones need an Apple Developer account and **TestFlight** or Ad Hoc. See earlier sections in git history or Expo docs for `eas build --platform ios`.

---

## Troubleshooting

- **`rm -rf node_modules` or `npm install` looks stuck (count in `node_modules` never drops)**:
  - On **iCloud Desktop**, deleting inside a huge tree often **does not progress**. Don’t rely on `rm -rf` there.
  - **Use a rename instead** (one instant step on the same disk), then install:
    ```bash
    cd hearing-hope-mobile
    mv node_modules "node_modules_trash_$(date +%s)"
    npm install
    ```
    Delete `node_modules_trash_*` later in Finder when you have time, or leave it.
  - **`npm run reinstall`** now does this automatically (moves `node_modules` aside, runs `npm install`, deletes old tree in the background).
  - **If `mv` errors “Operation not permitted” / lock:** quit **Cursor**, **Metro**, and any `node` processes, then retry.
  - **Best long-term fix:** move the whole project to **`~/Developer/...`** (not iCloud-synced Desktop).
- **`eas update` fails on dirty tree**: Commit (or stash) changes; same idea as **`requireCommit`** for builds.
- **`npm` / `EBADENGINE` warnings**: Upgrade **Node to ≥ 20.19.4** (see `.nvmrc`).
- **`EXPO_PUBLIC_CRM_URL` / login errors on APK**: Confirm the CRM is deployed with HTTPS, URL matches `eas.json` / EAS env, and `/api/mobile-login` works in a browser: `https://YOUR-CRM/api/mobile-login` (POST only—expect JSON error on GET; use CRM UI + app).
- **“No projectId” / no push tokens**: Run `eas init`, set `EXPO_PUBLIC_EAS_PROJECT_ID` in EAS **Environment variables** for the build profile.
- **APK won’t install**: Enable installs from unknown sources for the app used to open the APK.
- **`eas build` stuck on “Compressing project files” for a long time**:
  - **Cause A:** A leftover **`node_modules_trash_*`** or **`node_modules.__trash_*`** folder (from `npm run reinstall`) is still in the project. It is huge — EAS was trying to zip it. **Delete those folders** (Finder or `rm -rf node_modules_trash_* node_modules.__trash_*`), then run `eas build` again. They are now listed in **`.easignore`** and **`.gitignore`** so this should not recur.
  - **Cause B:** Project on **iCloud Desktop** — compression reads every file slowly. Move the repo to **`~/Developer/...`** for faster uploads, or wait longer.
