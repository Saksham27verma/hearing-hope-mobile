import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase';

const getCrmUrl = () => {
  return process.env.EXPO_PUBLIC_CRM_URL || 'http://localhost:3000';
};

export async function loginWithPhonePassword(phone: string, password: string): Promise<string> {
  const url = `${getCrmUrl()}/api/mobile-login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || 'Login failed');
  }

  if (!data?.token) {
    throw new Error('Invalid response from server');
  }

  await signInWithCustomToken(auth, data.token);
  return data.token;
}
