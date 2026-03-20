# Push Notifications Setup

When a new home visit appointment is scheduled in the CRM, the assigned staff member receives a push notification with the patient name, date, and time.

## How It Works

1. **Mobile app**: On login, the app requests notification permission and saves the Expo Push Token to the staff document in Firestore.
2. **CRM**: When a new home visit appointment is created, the CRM calls `/api/send-appointment-notification` to send a push to the assigned staff.
3. **Notification content**: Title "New Home Visit Appointment", body shows patient name and formatted date/time.

## Requirements

- **Physical device**: Push notifications do not work on emulators/simulators.
- **Development build** (Android): From Expo SDK 53+, Android push in Expo Go has limitations. For full support, create a development build with `eas build`.

## EAS Project ID (Required for Push Tokens)

Push notifications require an EAS project ID. Without it, you'll see a "No projectId found" warning and push won't work.

**Setup:**
1. Run `eas init` in the project (creates/links an EAS project).
2. Add to `.env`:
   ```
   EXPO_PUBLIC_EAS_PROJECT_ID=your-project-uuid
   ```
   (Find your project ID at [expo.dev](https://expo.dev) → your project → Settings)
3. Or add to `app.json` under `expo.extra.eas.projectId`.

## Firestore

The staff document stores:
- `pushToken`: Expo Push Token (e.g. `ExponentPushToken[xxx]`)
- `pushTokenUpdatedAt`: ISO timestamp of last update

Staff can update their own document to save the push token (Firestore rules allow this).
