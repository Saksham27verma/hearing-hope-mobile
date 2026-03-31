import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { theme } from './src/theme';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './src/firebase';
import { AppointmentsProvider } from './src/context/AppointmentsContext';
import { setupPushNotifications } from './src/services/pushNotifications';
import LoginScreen from './src/screens/LoginScreen';
import AppointmentsScreen from './src/screens/AppointmentsScreen';
import AppointmentDetailScreen from './src/screens/AppointmentDetailScreen';
import ReceiptActionScreen from './src/screens/ReceiptActionScreen';
import type { Appointment } from './src/types';

export type RootStackParamList = {
  Appointments: undefined;
  AppointmentDetail: { appointment: Appointment };
  ReceiptAction: { appointmentId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        setupPushNotifications().catch((e) => {
          if (!String(e).includes('projectId')) console.warn('Push setup failed:', e);
        });
      }
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen onLoginSuccess={() => setUser(auth.currentUser)} />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <NavigationContainer
        theme={{
          ...DefaultTheme,
          dark: false,
          colors: {
            ...DefaultTheme.colors,
            primary: theme.colors.primary,
            background: theme.colors.background,
            card: theme.colors.background,
            text: theme.colors.text,
            border: theme.colors.border,
            notification: theme.colors.primary,
          },
        }}
      >
        <AppointmentsProvider>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            <Stack.Screen name="Appointments">
              {(props) => (
                <AppointmentsScreen
                  {...props}
                  onAppointmentPress={(apt) =>
                    props.navigation.navigate('AppointmentDetail', { appointment: apt })
                  }
                  onLogPayment={(apt) =>
                    props.navigation.navigate('ReceiptAction', { appointmentId: apt.id })
                  }
                  onLogout={handleLogout}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="AppointmentDetail">
              {({ navigation, route }) => (
                <AppointmentDetailScreen
                  appointment={route.params.appointment}
                  onBack={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="ReceiptAction">
              {({ navigation, route }) => (
                <ReceiptActionScreen
                  appointmentId={route.params.appointmentId}
                  onBack={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        </AppointmentsProvider>
      </NavigationContainer>
    </>
  );
}
