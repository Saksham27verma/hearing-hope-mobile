import { auth } from '../firebase';

const getCrmUrl = () => process.env.EXPO_PUBLIC_CRM_URL || 'http://localhost:3000';

export type FieldOption = {
  optionValue: string;
  optionLabel: string;
  sortOrder: number;
};

export async function fetchStaffEnquiryConfig(): Promise<{
  ok: boolean;
  earSide?: FieldOption[];
  trialLocationType?: FieldOption[];
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in' };
  const idToken = await user.getIdToken();
  const res = await fetch(`${getCrmUrl()}/api/staff/enquiry-config`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Failed to load config' };
  }
  const d = data as { earSide?: FieldOption[]; trialLocationType?: FieldOption[] };
  return { ok: true, earSide: d.earSide, trialLocationType: d.trialLocationType };
}
