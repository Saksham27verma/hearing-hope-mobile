# Hearing Hope - Home Visit Mobile App

Mobile app for home visit employees to view their assigned appointments, call patients, and update appointment status.

**Uses Expo SDK 54** – compatible with Expo Go from the App Store / Play Store.

## Setup

1. Copy `.env.example` to `.env` and configure:
   - **`EXPO_PUBLIC_CRM_URL`**: For an **employee APK**, use your **live HTTPS** CRM URL (e.g. `https://hearing-hope-crm.vercel.app`). **Do not use your laptop’s IP** in builds you distribute—phones cannot reach your home/office LAN. Use `http://192.168.x.x:3000` only for **your own** on-device dev while the CRM runs on your computer.
   - Firebase config (same values as the web CRM). Cloud APK builds also need these in **Expo → Environment variables**; see [BUILD_AND_DISTRIBUTE.md](./BUILD_AND_DISTRIBUTE.md).

2. For local development with a physical device:
   - Run the CRM: `cd hearing-hope-crm && npm run dev`
   - Use your computer's local IP for `EXPO_PUBLIC_CRM_URL` (e.g. `http://192.168.1.5:3000`)
   - Android emulator: use `http://10.0.2.2:3000`
   - iOS simulator: use `http://localhost:3000`

3. Install dependencies: `npm install`

4. Start the app: `npm start`

## Enabling Mobile Access for Staff

1. In the web CRM, go to **Staff** module
2. Edit a staff member who does home visits
3. Open the **Mobile App** tab
4. Enable "Enable mobile app login"
5. Set a password (min 8 characters)
6. Save

The staff can now log in to the mobile app with their **phone number** (10 digits) and the password you set.

## Features

- Login with phone number and password
- View appointments assigned to you (home visits only)
- Call patient (number not displayed - direct call button only)
- Open address in Maps
- Mark appointment as Completed (with optional feedback)
- Mark appointment as Cancelled
- Filter by Today, Upcoming, Completed, Cancelled

## Troubleshooting

### "Install the latest version of Expo Go"

The project uses **Expo SDK 54** to match the Expo Go version on the App Store/Play Store.

1. **Uninstall and reinstall Expo Go** from the App Store (iOS) or Play Store (Android).
2. **Clear cache and restart**: `npm run start:clear`
3. **Use tunnel mode** if on a different network: `npm run start:tunnel`
4. **Android**: Install Expo Go from [expo.dev/go](https://expo.dev/go) if the Play Store version is outdated.

## Git (own repo)

This app lives in a **separate** Git repo from `hearing-hope-crm`. Create an empty repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USER/hearing-hope-mobile.git
git push -u origin main
```

Do not commit `.env` (it is gitignored). See `../REPOS_SETUP.md` in the parent folder for CRM + mobile push tips.
