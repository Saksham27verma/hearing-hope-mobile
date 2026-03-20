# Build & Distribute the Mobile App

This guide covers building the app for Android (APK) and iOS, and distributing to employees.

---

## Prerequisites

1. **Expo account** (free): Sign up at [expo.dev](https://expo.dev)
2. **EAS CLI**: Install globally
   ```bash
   npm install -g eas-cli
   ```
3. **Login to Expo**:
   ```bash
   eas login
   ```
4. **Initialize EAS** (first time only):
   ```bash
   cd hearing-hope-mobile
   eas init
   ```
   This links your project to Expo and creates an EAS project. Save the `projectId` and add to `.env`:
   ```
   EXPO_PUBLIC_EAS_PROJECT_ID=your-project-id
   ```

---

## Android: Build APK

APK lets employees install directly without the Play Store (sideloading).

### 1. Build the APK

```bash
cd hearing-hope-mobile
eas build --platform android --profile preview
```

- Build runs in the cloud (takes ~10–15 minutes)
- When done, you get a download link in the terminal and at [expo.dev](https://expo.dev) → your project → Builds

### 2. Share the APK with employees

**Option A: Direct download**
- Download the APK from the build link
- Share via email, Google Drive, or internal file server
- Employees open the link on their Android phone and install

**Option B: QR code**
- On [expo.dev](https://expo.dev) → Builds → click the build → there’s a QR code
- Employees scan with their Android phone to download and install

### 3. Employee setup (Android)

1. Open the APK link on the Android phone
2. If prompted, allow “Install from unknown sources” for the browser
3. Install the app
4. Open the app and log in with staff credentials

---

## iOS: Distribute to iPhone users

Apple requires an **Apple Developer account** ($99/year) for installing on physical devices.

### Option 1: TestFlight (recommended)

1. **Enroll in Apple Developer Program**: [developer.apple.com](https://developer.apple.com)

2. **Build for iOS**:
   ```bash
   eas build --platform ios --profile preview
   ```
   EAS will prompt for Apple credentials and handle certificates.

3. **Submit to TestFlight**:
   ```bash
   eas submit --platform ios --profile production --latest
   ```
   Or use the “Submit to TestFlight” button in the Expo dashboard after the build.

4. **Add testers**:
   - In [App Store Connect](https://appstoreconnect.apple.com) → your app → TestFlight
   - Add employees by email (they get an invite)
   - They install the **TestFlight** app from the App Store, then open your app from TestFlight

### Option 2: Ad Hoc (internal only, no TestFlight)

For up to 100 devices, you can use Ad Hoc distribution:

1. **Collect device UDIDs** from each iPhone:
   - Employee: Settings → General → About → scroll to find identifier (or use a UDID lookup site)
   - You add these in the Apple Developer portal

2. **Build with Ad Hoc profile** – add to `eas.json`:
   ```json
   "ad-hoc": {
     "distribution": "internal",
     "ios": {
       "resourceClass": "m1-medium"
     }
   }
   ```
   Then: `eas build --platform ios --profile ad-hoc`

3. **Distribute** the `.ipa` file (e.g. via link or MDM). Employees install via iTunes/Finder or a tool like Diawi.

---

## Quick reference

| Platform | Build command              | Output        | Distribution          |
|----------|----------------------------|---------------|------------------------|
| Android  | `eas build -p android -p preview` | APK file      | Direct link / QR code |
| iOS      | `eas build -p ios -p preview`     | IPA file      | TestFlight or Ad Hoc   |

---

## Production builds

For production (e.g. Play Store / App Store):

```bash
# Android (AAB for Play Store – change buildType to "app-bundle" in eas.json)
eas build --platform android --profile production

# iOS (for App Store)
eas build --platform ios --profile production
```

---

## Troubleshooting

- **“No projectId”**: Run `eas init` and add `EXPO_PUBLIC_EAS_PROJECT_ID` to `.env`
- **iOS build fails**: Ensure Apple Developer account is set up and credentials are valid
- **APK won’t install**: Employee must allow “Install from unknown sources” for the browser/app used to download
