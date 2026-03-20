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

## Prerequisites

1. **Expo account** (free): [expo.dev](https://expo.dev)
2. **EAS CLI** (run from this folder):

   ```bash
   npm install -g eas-cli
   eas login
   ```

3. **Link the project** (first time only):

   ```bash
   cd hearing-hope-mobile
   eas init
   ```

   Copy the **project ID** into your local `.env` as `EXPO_PUBLIC_EAS_PROJECT_ID=...` (needed for Expo push tokens and local `expo start` parity).

4. **EAS Build cannot read your local `.env`** (it is gitignored). Set these on [expo.dev](https://expo.dev) → your project → **Environment variables** for **Preview** and **Production** (same names as below), **or** rely on non-secret values already in `eas.json` and only add secrets in the dashboard:

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

---

## iOS (optional)

Physical iPhones need an Apple Developer account and **TestFlight** or Ad Hoc. See earlier sections in git history or Expo docs for `eas build --platform ios`.

---

## Troubleshooting

- **`EXPO_PUBLIC_CRM_URL` / login errors on APK**: Confirm the CRM is deployed with HTTPS, URL matches `eas.json` / EAS env, and `/api/mobile-login` works in a browser: `https://YOUR-CRM/api/mobile-login` (POST only—expect JSON error on GET; use CRM UI + app).
- **“No projectId” / no push tokens**: Run `eas init`, set `EXPO_PUBLIC_EAS_PROJECT_ID` in EAS **Environment variables** for the build profile.
- **APK won’t install**: Enable installs from unknown sources for the app used to open the APK.
