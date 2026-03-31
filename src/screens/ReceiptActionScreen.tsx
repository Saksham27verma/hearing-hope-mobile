import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { theme } from '../theme';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isPayableAppointmentForPayment } from '../utils/appointmentPayable';
import {
  submitCollectPayment,
  type PaymentMode,
  type ReceiptType,
} from '../api/collectPayment';
import { fetchAvailableInventory, type StaffInventoryRow } from '../api/staffInventory';
import { fetchStaffEnquiryConfig, type FieldOption } from '../api/staffEnquiryConfig';
import { fetchStaffProductsCatalog, type CatalogProduct } from '../api/staffProductsCatalog';

function formatTime(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function parseStartToDate(start: unknown): Date | null {
  if (!start) return null;
  if (typeof start === 'string') {
    const d = new Date(start);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof start === 'object' && start !== null) {
    const o = start as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
  }
  return null;
}

function getStartIso(appointment: Appointment): string {
  const d = parseStartToDate(appointment.start);
  return d ? d.toISOString() : '';
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const FALLBACK_EAR: FieldOption[] = [
  { optionValue: 'left', optionLabel: 'Left', sortOrder: 10 },
  { optionValue: 'right', optionLabel: 'Right', sortOrder: 20 },
  { optionValue: 'both', optionLabel: 'Both', sortOrder: 30 },
];

const FALLBACK_TRIAL_LOC: FieldOption[] = [
  { optionValue: 'in_office', optionLabel: 'In-Office Trial', sortOrder: 10 },
  { optionValue: 'home', optionLabel: 'Home Trial', sortOrder: 20 },
];

type Props = {
  appointmentId: string;
  onBack: () => void;
};

export default function ReceiptActionScreen({ appointmentId, onBack }: Props) {
  const { appointments } = useAppointmentsContext();
  const uid = auth.currentUser?.uid;

  const [resolved, setResolved] = useState<Appointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [receiptType, setReceiptType] = useState<ReceiptType>('booking');
  const [submitting, setSubmitting] = useState(false);

  const [earOptions, setEarOptions] = useState<FieldOption[]>(FALLBACK_EAR);
  const [trialLocOptions, setTrialLocOptions] = useState<FieldOption[]>(FALLBACK_TRIAL_LOC);

  const [bookingProduct, setBookingProduct] = useState<CatalogProduct | null>(null);
  const [bookingEar, setBookingEar] = useState('both');
  const [bookingMrp, setBookingMrp] = useState('');
  const [bookingSelling, setBookingSelling] = useState('');
  const [bookingQty, setBookingQty] = useState('1');

  const [trialProduct, setTrialProduct] = useState<CatalogProduct | null>(null);
  const [trialLoc, setTrialLoc] = useState<'in_office' | 'home'>('in_office');
  const [trialEar, setTrialEar] = useState('both');
  const [trialMrp, setTrialMrp] = useState('');
  const [trialDuration, setTrialDuration] = useState('7');
  const [trialStart, setTrialStart] = useState(() => toYmd(new Date()));
  const [trialEnd, setTrialEnd] = useState(() => {
    const e = new Date();
    e.setDate(e.getDate() + 7);
    return toYmd(e);
  });
  const [trialSerial, setTrialSerial] = useState('');
  const [trialDeposit, setTrialDeposit] = useState('');
  const [trialNotes, setTrialNotes] = useState('');

  const [inventoryItems, setInventoryItems] = useState<StaffInventoryRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [invModal, setInvModal] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [selectedInv, setSelectedInv] = useState<StaffInventoryRow | null>(null);
  const [saleEar, setSaleEar] = useState('both');
  const [saleSelling, setSaleSelling] = useState('');
  const [saleDiscount, setSaleDiscount] = useState('0');
  const [saleGst, setSaleGst] = useState('18');
  const [saleQty, setSaleQty] = useState('1');

  const [catalogModal, setCatalogModal] = useState(false);
  const [catalogIntent, setCatalogIntent] = useState<'booking' | 'trial'>('booking');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const r = await fetchAvailableInventory();
      if (r.ok && r.items) setInventoryItems(r.items);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await fetchStaffEnquiryConfig();
      if (r.ok) {
        if (r.earSide?.length) setEarOptions(r.earSide);
        if (r.trialLocationType?.length) setTrialLocOptions(r.trialLocationType);
      }
    })();
  }, []);

  useEffect(() => {
    if (receiptType === 'invoice' || (receiptType === 'trial' && trialLoc === 'home')) {
      void loadInventory();
    }
  }, [receiptType, trialLoc, loadInventory]);

  const loadCatalog = useCallback(async (q: string) => {
    setCatalogLoading(true);
    try {
      const r = await fetchStaffProductsCatalog(q);
      if (r.ok && r.products) setCatalogItems(r.products);
      else setCatalogItems([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!catalogModal) return;
    const t = setTimeout(() => void loadCatalog(catalogSearch), 300);
    return () => clearTimeout(t);
  }, [catalogModal, catalogSearch, loadCatalog]);

  const filteredInv = useMemo(() => {
    let base = inventoryItems;
    if (receiptType === 'trial' && trialLoc === 'home' && trialProduct) {
      base = base.filter((it) => it.productId === trialProduct.id);
    }
    const q = invSearch.trim().toLowerCase();
    if (!q) return base.slice(0, 80);
    return base
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.company.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          it.serialNumber.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [inventoryItems, invSearch, receiptType, trialLoc, trialProduct]);

  const fromCache = useMemo(
    () => appointments.find((a) => a.id === appointmentId) || null,
    [appointments, appointmentId]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uid) {
        setResolved(null);
        setLoading(false);
        return;
      }

      if (fromCache && isPayableAppointmentForPayment(fromCache)) {
        const mine =
          (fromCache.type === 'home' && fromCache.homeVisitorStaffId === uid) ||
          (fromCache.type === 'center' && fromCache.assignedStaffId === uid);
        if (mine) {
          setResolved(fromCache);
          setLoading(false);
          return;
        }
      }

      try {
        const snap = await getDoc(doc(db, 'appointments', appointmentId));
        if (cancelled) return;
        if (!snap.exists()) {
          setResolved(null);
          return;
        }
        const apt = { id: snap.id, ...snap.data() } as Appointment;
        const mine =
          (apt.type === 'home' && apt.homeVisitorStaffId === uid) ||
          (apt.type === 'center' && apt.assignedStaffId === uid);
        if (!mine || !isPayableAppointmentForPayment(apt)) {
          setResolved(null);
          return;
        }
        setResolved(apt);
      } catch {
        if (!cancelled) setResolved(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    void load();
    return () => {
      cancelled = true;
    };
  }, [appointmentId, uid, fromCache]);

  useEffect(() => {
    if (resolved === null && !loading) {
      Alert.alert('Unavailable', 'This appointment cannot be used for payment logging.', [
        { text: 'OK', onPress: onBack },
      ]);
    }
  }, [resolved, loading, onBack]);

  useEffect(() => {
    if (bookingProduct) {
      const m = String(bookingProduct.mrp ?? 0);
      setBookingMrp(m);
      setBookingSelling(m);
    }
  }, [bookingProduct]);

  useEffect(() => {
    if (trialProduct) {
      const m = String(trialProduct.mrp ?? 0);
      setTrialMrp(m);
    }
  }, [trialProduct]);

  useEffect(() => {
    if (trialLoc === 'in_office') {
      setTrialDuration('0');
      setTrialStart('');
      setTrialEnd('');
      setTrialSerial('');
      setTrialDeposit('0');
    } else {
      setTrialDuration((d) => (d === '0' ? '7' : d));
      if (!trialStart) setTrialStart(toYmd(new Date()));
    }
  }, [trialLoc]);

  useEffect(() => {
    const d = Number(trialDuration);
    const start = trialStart.trim();
    if (trialLoc === 'home' && Number.isFinite(d) && d > 0 && start) {
      const sd = new Date(start + 'T12:00:00');
      if (!Number.isNaN(sd.getTime())) {
        const ed = new Date(sd.getTime() + d * 24 * 60 * 60 * 1000);
        setTrialEnd(toYmd(ed));
      }
    }
  }, [trialDuration, trialStart, trialLoc]);

  const openCatalog = (intent: 'booking' | 'trial') => {
    setCatalogIntent(intent);
    setCatalogSearch('');
    setCatalogModal(true);
    void loadCatalog('');
  };

  const handleSubmit = async () => {
    const n = Number(amount.replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount (payment collected today).');
      return;
    }
    if (!resolved?.id) return;

    if (receiptType === 'booking') {
      if (!bookingProduct) {
        Alert.alert('Select device', 'Choose a hearing aid from the product catalog (same as CRM).');
        return;
      }
      const mrp = Number(bookingMrp);
      const sell = Number(bookingSelling);
      const qty = Number(bookingQty);
      if (!Number.isFinite(mrp) || mrp < 0 || !Number.isFinite(sell) || sell < 0) {
        Alert.alert('Invalid prices', 'Enter valid MRP and selling price.');
        return;
      }
      if (!Number.isFinite(qty) || qty < 1) {
        Alert.alert('Invalid quantity', 'Enter quantity at least 1.');
        return;
      }
    }

    if (receiptType === 'trial') {
      if (!trialProduct) {
        Alert.alert('Select device', 'Choose a hearing aid from the product catalog (same as CRM).');
        return;
      }
      const mrp = Number(trialMrp);
      if (!Number.isFinite(mrp) || mrp < 0) {
        Alert.alert('Invalid MRP', 'Enter MRP per unit.');
        return;
      }
      if (trialLoc === 'home') {
        const dur = Number(trialDuration);
        if (!Number.isFinite(dur) || dur < 1) {
          Alert.alert('Trial period', 'Enter trial duration in days (home trial).');
          return;
        }
        if (!trialStart.trim() || !trialEnd.trim()) {
          Alert.alert('Dates', 'Enter trial start and end dates.');
          return;
        }
        if (!trialSerial.trim()) {
          Alert.alert('Serial', 'Select or enter the inventory serial for home trial.');
          return;
        }
        const dep = Number(trialDeposit);
        if (!Number.isFinite(dep) || dep < 0) {
          Alert.alert('Deposit', 'Enter security deposit amount.');
          return;
        }
      }
    }

    if (receiptType === 'invoice') {
      if (!selectedInv) {
        Alert.alert('Select device', 'Choose a hearing aid from inventory (serial).');
        return;
      }
      const sp = Number(saleSelling);
      const disc = Number(saleDiscount);
      const gst = Number(saleGst);
      const qty = Number(saleQty);
      if (!Number.isFinite(sp) || sp < 0) {
        Alert.alert('Invalid selling price', 'Enter selling price per unit.');
        return;
      }
      if (!Number.isFinite(disc) || disc < 0 || disc > 100 || !Number.isFinite(gst) || gst < 0) {
        Alert.alert('Invalid %', 'Check discount and GST.');
        return;
      }
      if (!Number.isFinite(qty) || qty < 1) {
        Alert.alert('Invalid quantity', 'Enter quantity.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const details =
        receiptType === 'booking'
          ? {
              booking: {
                catalogProductId: bookingProduct!.id,
                whichEar: bookingEar as 'left' | 'right' | 'both',
                hearingAidPrice: Number(bookingMrp),
                bookingSellingPrice: Number(bookingSelling),
                bookingQuantity: Math.max(1, Math.floor(Number(bookingQty) || 1)),
              },
            }
          : receiptType === 'trial'
            ? {
                trial: {
                  catalogProductId: trialProduct!.id,
                  trialLocationType: trialLoc,
                  whichEar: trialEar as 'left' | 'right' | 'both',
                  hearingAidPrice: Number(trialMrp),
                  trialDuration: trialLoc === 'home' ? Math.max(1, Math.floor(Number(trialDuration) || 1)) : 0,
                  trialStartDate: trialLoc === 'home' ? trialStart.trim() : '',
                  trialEndDate: trialLoc === 'home' ? trialEnd.trim() : '',
                  trialSerialNumber: trialLoc === 'home' ? trialSerial.trim() : '',
                  trialHomeSecurityDepositAmount: trialLoc === 'home' ? Number(trialDeposit) : 0,
                  trialNotes: trialNotes.trim(),
                },
              }
            : {
                sale: {
                  productId: selectedInv!.productId,
                  name: selectedInv!.name,
                  company: selectedInv!.company,
                  serialNumber: selectedInv!.serialNumber,
                  mrp: selectedInv!.mrp,
                  sellingPrice: Number(saleSelling),
                  discountPercent: Number(saleDiscount),
                  gstPercent: Number(saleGst),
                  quantity: Math.max(1, Math.floor(Number(saleQty) || 1)),
                  whichEar: saleEar as 'left' | 'right' | 'both',
                },
              };

      const result = await submitCollectPayment({
        appointmentId: resolved.id,
        amount: n,
        paymentMode,
        receiptType,
        details,
      });
      if (!result.ok) {
        Alert.alert('Failed', result.error || 'Could not send request');
        return;
      }
      Alert.alert('Receipt request sent to admin', 'An administrator will verify and send the official document to the patient.', [
        { text: 'OK', onPress: onBack },
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (selectedInv) {
      setSaleSelling(String(selectedInv.mrp || 0));
    }
  }, [selectedInv]);

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
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Log payment</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>
    );
  }

  const typeLabel = resolved.type === 'home' ? 'Home visit' : 'Center';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log payment</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Appointment</Text>
          <Text style={styles.patientName}>{resolved.patientName || resolved.title || 'Patient'}</Text>
          <Text style={styles.metaLine}>Enquiry ID: {resolved.enquiryId || '—'}</Text>
          <Text style={styles.metaLine}>Type: {typeLabel}</Text>
          <Text style={styles.metaLine}>Time: {formatTime(getStartIso(resolved))}</Text>
        </View>

        <Text style={styles.fieldLabel}>Payment collected today (₹)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={theme.colors.textMuted}
          value={amount}
          onChangeText={setAmount}
          editable={!submitting}
        />

        <Text style={styles.fieldLabel}>Payment mode</Text>
        <View style={styles.chipRow}>
          {(['cash', 'upi', 'card'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, paymentMode === m && styles.chipActive]}
              onPress={() => setPaymentMode(m)}
              disabled={submitting}
            >
              <Text style={[styles.chipText, paymentMode === m && styles.chipTextActive]}>{m.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Receipt type</Text>
        <View style={styles.chipRow}>
          {(['trial', 'booking', 'invoice'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, receiptType === t && styles.chipActive]}
              onPress={() => setReceiptType(t)}
              disabled={submitting}
            >
              <Text style={[styles.chipText, receiptType === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {receiptType === 'booking' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Booking — catalog device (CRM)</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={() => openCatalog('booking')} disabled={submitting}>
              <Text style={styles.pickBtnText}>
                {bookingProduct
                  ? `${bookingProduct.company} · ${bookingProduct.name} (${bookingProduct.type})`
                  : 'Select from product catalog'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.fieldLabel}>Which ear</Text>
            <View style={styles.chipRow}>
              {earOptions.map((o) => (
                <TouchableOpacity
                  key={o.optionValue}
                  style={[styles.chip, bookingEar === o.optionValue && styles.chipActive]}
                  onPress={() => setBookingEar(o.optionValue)}
                >
                  <Text style={[styles.chipText, bookingEar === o.optionValue && styles.chipTextActive]}>{o.optionLabel}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Field label="MRP (per unit) ₹" value={bookingMrp} onChangeText={setBookingMrp} keyboardType="decimal-pad" />
            <Field label="Selling price (per unit) ₹" value={bookingSelling} onChangeText={setBookingSelling} keyboardType="decimal-pad" />
            <Field label="Quantity" value={bookingQty} onChangeText={setBookingQty} keyboardType="number-pad" />
          </View>
        ) : null}

        {receiptType === 'trial' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Trial — catalog + trial type (CRM)</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={() => openCatalog('trial')} disabled={submitting}>
              <Text style={styles.pickBtnText}>
                {trialProduct
                  ? `${trialProduct.company} · ${trialProduct.name} (${trialProduct.type})`
                  : 'Select from product catalog'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.fieldLabel}>Trial type</Text>
            <View style={styles.chipRow}>
              {trialLocOptions.map((o) => {
                const v = (o.optionValue === 'home' ? 'home' : 'in_office') as 'in_office' | 'home';
                const active = trialLoc === v;
                return (
                  <TouchableOpacity
                    key={o.optionValue}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setTrialLoc(v)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.optionLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.fieldLabel}>Which ear</Text>
            <View style={styles.chipRow}>
              {earOptions.map((o) => (
                <TouchableOpacity
                  key={o.optionValue}
                  style={[styles.chip, trialEar === o.optionValue && styles.chipActive]}
                  onPress={() => setTrialEar(o.optionValue)}
                >
                  <Text style={[styles.chipText, trialEar === o.optionValue && styles.chipTextActive]}>{o.optionLabel}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Field label="MRP (per unit) ₹" value={trialMrp} onChangeText={setTrialMrp} keyboardType="decimal-pad" />
            {trialLoc === 'home' ? (
              <>
                <Field label="Trial period (days)" value={trialDuration} onChangeText={setTrialDuration} keyboardType="number-pad" />
                <Field label="Trial start (YYYY-MM-DD)" value={trialStart} onChangeText={setTrialStart} />
                <Field label="Trial end (YYYY-MM-DD)" value={trialEnd} onChangeText={setTrialEnd} />
                <TouchableOpacity style={styles.pickBtn} onPress={() => setInvModal(true)} disabled={inventoryLoading}>
                  {inventoryLoading ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <Text style={styles.pickBtnText}>
                      {trialSerial ? `Serial: ${trialSerial}` : 'Select serial from inventory'}
                    </Text>
                  )}
                </TouchableOpacity>
                <Field label="Security deposit ₹" value={trialDeposit} onChangeText={setTrialDeposit} keyboardType="decimal-pad" />
              </>
            ) : null}
            <Text style={styles.fieldLabel}>Trial notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Optional"
              value={trialNotes}
              onChangeText={setTrialNotes}
              multiline
            />
          </View>
        ) : null}

        {receiptType === 'invoice' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Sale — inventory (CRM)</Text>
            <Text style={styles.fieldLabel}>Which ear</Text>
            <View style={styles.chipRow}>
              {earOptions.map((o) => (
                <TouchableOpacity
                  key={o.optionValue}
                  style={[styles.chip, saleEar === o.optionValue && styles.chipActive]}
                  onPress={() => setSaleEar(o.optionValue)}
                >
                  <Text style={[styles.chipText, saleEar === o.optionValue && styles.chipTextActive]}>{o.optionLabel}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.pickBtn} onPress={() => setInvModal(true)} disabled={inventoryLoading}>
              {inventoryLoading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <Text style={styles.pickBtnText}>
                  {selectedInv ? `${selectedInv.name} · SN ${selectedInv.serialNumber}` : 'Select hearing aid (serial)'}
                </Text>
              )}
            </TouchableOpacity>
            {selectedInv ? (
              <>
                <Text style={styles.metaLine}>MRP: ₹{selectedInv.mrp}</Text>
                <Field label="Selling price (per unit) ₹" value={saleSelling} onChangeText={setSaleSelling} keyboardType="decimal-pad" />
                <Field label="Discount %" value={saleDiscount} onChangeText={setSaleDiscount} keyboardType="decimal-pad" />
                <Field label="GST %" value={saleGst} onChangeText={setSaleGst} keyboardType="decimal-pad" />
                <Field label="Quantity" value={saleQty} onChangeText={setSaleQty} keyboardType="number-pad" />
              </>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Send to admin</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={catalogModal} animationType="slide" onRequestClose={() => setCatalogModal(false)}>
        <SafeAreaView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCatalogModal(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Product catalog</Text>
            <View style={{ width: 48 }} />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Search company, model, type"
            value={catalogSearch}
            onChangeText={setCatalogSearch}
          />
          {catalogLoading ? (
            <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.primary} />
          ) : (
            <FlatList
              data={catalogItems}
              keyExtractor={(it) => it.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.invRow}
                  onPress={() => {
                    if (catalogIntent === 'booking') setBookingProduct(item);
                    else setTrialProduct(item);
                    setCatalogModal(false);
                  }}
                >
                  <Text style={styles.invName}>{item.name}</Text>
                  <Text style={styles.invSub}>
                    {item.company} · {item.type} · ₹{item.mrp ?? 0}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyInv}>No products. Try search.</Text>}
            />
          )}
        </SafeAreaView>
      </Modal>

      <Modal visible={invModal} animationType="slide" onRequestClose={() => setInvModal(false)}>
        <SafeAreaView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setInvModal(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Available stock</Text>
            <View style={{ width: 48 }} />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Search name, company, serial"
            value={invSearch}
            onChangeText={setInvSearch}
          />
          <FlatList
            data={filteredInv}
            keyExtractor={(it) => it.lineId}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.invRow}
                onPress={() => {
                  if (receiptType === 'invoice') {
                    setSelectedInv(item);
                  } else if (receiptType === 'trial' && trialLoc === 'home') {
                    setTrialSerial(item.serialNumber);
                  }
                  setInvModal(false);
                }}
              >
                <Text style={styles.invName}>{item.name}</Text>
                <Text style={styles.invSub}>
                  {item.company} · {item.type} · SN {item.serialNumber} · ₹{item.mrp}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyInv}>{inventoryLoading ? 'Loading…' : 'No rows match.'}</Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={theme.colors.textMuted}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  backBtn: {
    padding: 8,
    width: 40,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: theme.colors.text,
  },
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    ...theme.shadows.soft,
  },
  sectionLabel: {
    fontSize: 12,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
    fontWeight: '600',
  },
  patientName: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 8,
  },
  metaLine: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
    backgroundColor: theme.colors.background,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  chipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primaryLight,
  },
  chipText: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '500',
  },
  chipTextActive: {
    color: theme.colors.primary,
  },
  block: {
    marginBottom: 8,
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 12,
  },
  pickBtn: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    backgroundColor: theme.colors.background,
  },
  pickBtnText: {
    color: theme.colors.primary,
    fontWeight: '600',
    fontSize: 15,
  },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalWrap: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalClose: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  invRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  invName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  invSub: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  emptyInv: {
    textAlign: 'center',
    marginTop: 24,
    color: theme.colors.textMuted,
  },
});
