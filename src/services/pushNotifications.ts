import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Configure how notifications are shown when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  // Expo Go has limited push support (Android push removed in SDK 53). Use a dev build for full support.
  if (IS_EXPO_GO && Platform.OS === 'android') {
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    if (status !== 'granted') {
      console.warn('Push notification permission denied');
      return null;
    }
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('appointments', {
      name: 'Appointments',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    });
  }

  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    Constants?.expoConfig?.extra?.eas?.projectId ||
    Constants?.easConfig?.projectId;

  if (!projectId) {
    // Push tokens require EAS project ID. Run `eas init` and add EXPO_PUBLIC_EAS_PROJECT_ID to .env
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData?.data;

  return token || null;
}

export async function savePushTokenToStaff(token: string): Promise<void> {
  const staffId = auth.currentUser?.uid;
  if (!staffId) return;

  try {
    await updateDoc(doc(db, 'staff', staffId), {
      pushToken: token,
      pushTokenUpdatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Failed to save push token:', e);
  }
}

export async function setupPushNotifications(): Promise<void> {
  const token = await registerForPushNotifications();
  if (token) {
    await savePushTokenToStaff(token);
  }
}
