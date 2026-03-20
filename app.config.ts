// https://docs.expo.dev/workflow/configuration/
// CRM URL drives cleartext + iOS ATS: HTTPS production URL needs no exceptions.
// EAS project ID (from `eas init`) — required for builds & push tokens; cannot be auto-injected into dynamic config.
const EAS_PROJECT_ID = 'db9a579f-c050-4053-b4e9-3821529c901c';

function parseHttpHostnameForATS(crmUrl: string): string | null {
  try {
    const u = new URL(crmUrl.trim());
    if (u.protocol !== 'http:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

const defaultCrmUrl = 'http://localhost:3000';

export default function appConfig() {
  const crmUrl = process.env.EXPO_PUBLIC_CRM_URL ?? defaultCrmUrl;
  const httpHost = parseHttpHostnameForATS(crmUrl);
  const allowCleartext = crmUrl.startsWith('http://');

  const iosATS =
    httpHost != null
      ? {
          NSAppTransportSecurity: {
            NSExceptionDomains: {
              [httpHost]: {
                NSExceptionAllowsInsecureHTTPLoads: true,
                NSIncludesSubdomains: false,
                NSRequiresCertificateTransparency: false,
              },
            },
          },
        }
      : {};

  return {
    name: 'Hearing Hope Mobile',
    slug: 'hearing-hope-mobile',
    version: '1.0.0',
    orientation: 'portrait' as const,
    icon: './assets/icon.png',
    userInterfaceStyle: 'light' as const,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain' as const,
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.hearinghope.mobilestaff',
      infoPlist: iosATS,
    },
    android: {
      package: 'com.hearinghope.mobilestaff',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      usesCleartextTraffic: allowCleartext,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-notifications'],
    extra: {
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? EAS_PROJECT_ID,
      },
    },
  };
}
