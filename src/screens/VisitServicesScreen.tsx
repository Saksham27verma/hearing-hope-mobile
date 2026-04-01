import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Appointment } from '../types';
import { theme } from '../theme';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isEligibleForVisitServicesLogging } from '../utils/appointmentPayable';
import { submitLogVisitServices, type VisitServicesPayload } from '../api/logVisitServices';

type HtEntry = { id: string; testType: string; price: string };

function newId() {
  return `ht-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type Props = {
  appointmentId: string;
  onBack: () => void;
};

export default function VisitServicesScreen({ appointmentId, onBack }: Props) {
  const { appointments, isOnline } = useAppointmentsContext();
  const [resolved, setResolved] = useState<Appointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const [hearingTest, setHearingTest] = useState(false);
  const [htEntries, setHtEntries] = useState<HtEntry[]>([{ id: newId(), testType: '', price: '' }]);
  const [testDoneBy, setTestDoneBy] = useState('');
  const [testResults, setTestResults] = useState('');
  const [recommendations, setRecommendations] = useState('');

  const [accessory, setAccessory] = useState(false);
  const [accessoryName, setAccessoryName] = useState('');
  const [accessoryDetails, setAccessoryDetails] = useState('');
  const [accessoryFOC, setAccessoryFOC] = useState(false);
  const [accessoryAmount, setAccessoryAmount] = useState('');
  const [accessoryQuantity, setAccessoryQuantity] = useState('1');

  const [programming, setProgramming] = useState(false);
  const [programmingReason, setProgrammingReason] = useState('');
  const [programmingAmount, setProgrammingAmount] = useState('');
  const [programmingDoneBy, setProgrammingDoneBy] = useState('');
  const [hearingAidPurchaseDate, setHearingAidPurchaseDate] = useState('');
  const [hearingAidName, setHearingAidName] = useState('');
  const [underWarranty, setUnderWarranty] = useState(false);
  const [warranty, setWarranty] = useState('');

  const [counselling, setCounselling] = useState(false);
  const [counsellingNotes, setCounsellingNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fromList = appointments.find((a) => a.id === appointmentId);
    if (fromList) {
      setResolved(fromList);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'appointments', appointmentId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setResolved(null);
          return;
        }
        setResolved({ ...(snap.data() as object), id: snap.id } as Appointment);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, appointments]);

  const eligible = useMemo(() => (resolved ? isEligibleForVisitServicesLogging(resolved) : false), [resolved]);

  const buildPayload = (): { ok: true; services: VisitServicesPayload } | { ok: false; message: string } => {
    const services: VisitServicesPayload = {};
    if (hearingTest) {
      const entries = htEntries
        .map((e) => ({
          id: e.id,
          testType: e.testType.trim(),
          price: Math.max(0, parseFloat(e.price) || 0),
        }))
        .filter((e) => e.testType);
      if (entries.length === 0) {
        return { ok: false, message: 'Add at least one hearing test with a test type.' };
      }
      services.hearingTest = {
        hearingTestEntries: entries,
        testDoneBy: testDoneBy.trim() || undefined,
        testResults: testResults.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
      };
    }
    if (accessory) {
      const name = accessoryName.trim();
      if (!name) {
        return { ok: false, message: 'Accessory name is required.' };
      }
      services.accessory = {
        accessoryName: name,
        accessoryDetails: accessoryDetails.trim() || undefined,
        accessoryFOC,
        accessoryAmount:
          accessoryAmount.trim() !== '' ? Math.max(0, parseFloat(accessoryAmount) || 0) : undefined,
        accessoryQuantity:
          accessoryQuantity.trim() !== '' ? Math.max(1, Math.floor(parseFloat(accessoryQuantity) || 1)) : undefined,
      };
    }
    if (programming) {
      services.programming = {
        programmingReason: programmingReason.trim() || undefined,
        programmingAmount:
          programmingAmount.trim() !== '' ? Math.max(0, parseFloat(programmingAmount) || 0) : undefined,
        programmingDoneBy: programmingDoneBy.trim() || undefined,
        hearingAidPurchaseDate: hearingAidPurchaseDate.trim() || undefined,
        hearingAidName: hearingAidName.trim() || undefined,
        underWarranty,
        warranty: warranty.trim() || undefined,
      };
    }
    if (counselling) {
      services.counselling = { notes: counsellingNotes.trim() || undefined };
    }

    if (
      !services.hearingTest &&
      !services.accessory &&
      !services.programming &&
      !services.counselling
    ) {
      return { ok: false, message: 'Turn on at least one service.' };
    }

    return { ok: true, services };
  };

  const handleSubmit = async () => {
    if (!resolved?.id) return;
    if (!isOnline) {
      Alert.alert('Offline', 'Visit logging requires an internet connection.');
      return;
    }
    const built = buildPayload();
    if (!built.ok) {
      Alert.alert('Check form', built.message);
      return;
    }
    setSubmitting(true);
    try {
      const r = await submitLogVisitServices({
        appointmentId: resolved.id,
        services: built.services,
      });
      if (!r.ok) {
        Alert.alert('Error', r.error || 'Failed to save');
        return;
      }
      Alert.alert('Saved', 'Visit services were logged to the enquiry.', [{ text: 'OK', onPress: onBack }]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || resolved === undefined) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!resolved) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.errorText}>Appointment not found.</Text>
      </SafeAreaView>
    );
  }

  if (!eligible) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          <Text style={styles.warnTitle}>Cannot log visit services</Text>
          <Text style={styles.muted}>
            The appointment must be scheduled for today, linked to an enquiry, and not completed or cancelled.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} disabled={submitting}>
          <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Log visit services</Text>
        <Text style={styles.subtitle}>
          {resolved.patientName || resolved.title || 'Patient'} · Enquiry {resolved.enquiryId || '—'}
        </Text>
        <Text style={styles.hint}>Requires internet. Same rules as CRM enquiry visits (non-payment).</Text>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Hearing test</Text>
            <Switch value={hearingTest} onValueChange={setHearingTest} />
          </View>
          {hearingTest ? (
            <>
              {htEntries.map((row, idx) => (
                <View key={row.id} style={styles.htRow}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="Test type"
                    placeholderTextColor={theme.colors.textMuted}
                    value={row.testType}
                    onChangeText={(t) => {
                      const next = [...htEntries];
                      next[idx] = { ...row, testType: t };
                      setHtEntries(next);
                    }}
                  />
                  <TextInput
                    style={[styles.input, styles.priceInput]}
                    placeholder="₹"
                    placeholderTextColor={theme.colors.textMuted}
                    keyboardType="decimal-pad"
                    value={row.price}
                    onChangeText={(t) => {
                      const next = [...htEntries];
                      next[idx] = { ...row, price: t };
                      setHtEntries(next);
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => setHtEntries((prev) => prev.filter((r) => r.id !== row.id))}
                    disabled={htEntries.length <= 1}
                  >
                    <Ionicons name="trash-outline" size={22} color={theme.colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={styles.addRow}
                onPress={() => setHtEntries((prev) => [...prev, { id: newId(), testType: '', price: '' }])}
              >
                <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.addRowText}>Add test line</Text>
              </TouchableOpacity>
              <Field label="Test done by" value={testDoneBy} onChangeText={setTestDoneBy} />
              <Field label="Test results" value={testResults} onChangeText={setTestResults} multiline />
              <Field label="Recommendations" value={recommendations} onChangeText={setRecommendations} multiline />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Accessory</Text>
            <Switch value={accessory} onValueChange={setAccessory} />
          </View>
          {accessory ? (
            <>
              <Field label="Accessory name *" value={accessoryName} onChangeText={setAccessoryName} />
              <Field label="Details" value={accessoryDetails} onChangeText={setAccessoryDetails} multiline />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Free of charge</Text>
                <Switch value={accessoryFOC} onValueChange={setAccessoryFOC} />
              </View>
              <Field label="Amount (₹)" value={accessoryAmount} onChangeText={setAccessoryAmount} keyboardType="decimal-pad" />
              <Field label="Quantity" value={accessoryQuantity} onChangeText={setAccessoryQuantity} keyboardType="number-pad" />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Programming</Text>
            <Switch value={programming} onValueChange={setProgramming} />
          </View>
          {programming ? (
            <>
              <Field label="Reason" value={programmingReason} onChangeText={setProgrammingReason} multiline />
              <Field label="Amount (₹)" value={programmingAmount} onChangeText={setProgrammingAmount} keyboardType="decimal-pad" />
              <Field label="Done by" value={programmingDoneBy} onChangeText={setProgrammingDoneBy} />
              <Field label="HA purchase date" value={hearingAidPurchaseDate} onChangeText={setHearingAidPurchaseDate} />
              <Field label="Hearing aid name" value={hearingAidName} onChangeText={setHearingAidName} />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Under warranty</Text>
                <Switch value={underWarranty} onValueChange={setUnderWarranty} />
              </View>
              <Field label="Warranty" value={warranty} onChangeText={setWarranty} />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Counselling</Text>
            <Switch value={counselling} onValueChange={setCounselling} />
          </View>
          {counselling ? (
            <Field label="Notes" value={counsellingNotes} onChangeText={setCounsellingNotes} multiline />
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, (!isOnline || submitting) && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={!isOnline || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Save to CRM</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  multiline?: boolean;
  keyboardType?: 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.colors.textMuted}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.backgroundSecondary },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  scrollPad: { padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary, marginBottom: 8 },
  hint: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 16 },
  warnTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: theme.colors.text },
  muted: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
  errorText: { padding: 24, color: theme.colors.error },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 16,
    marginBottom: 14,
    ...theme.shadows.soft,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  htRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  flex1: { flex: 1 },
  priceInput: { width: 88 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  addRowText: { color: theme.colors.primary, fontWeight: '600', fontSize: 14 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
