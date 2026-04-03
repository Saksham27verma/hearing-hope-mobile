import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  Switch,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  List,
  Trash2,
} from 'lucide-react-native';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { theme } from '../theme';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isPayableAppointmentForPayment, isEligibleForVisitServicesLogging } from '../utils/appointmentPayable';
import { submitLogVisitServices, type VisitServicesPayload } from '../api/logVisitServices';
import {
  submitCollectPayment,
  type PaymentMode,
  type ReceiptType,
} from '../api/collectPayment';
import {
  htmlTemplateIdForReceiptType,
  loadStaffReceiptTemplateLabels,
  type StaffReceiptTemplateLabels,
} from '../api/receiptTemplateRouting';
import { fetchAvailableInventory, type StaffInventoryRow } from '../api/staffInventory';
import { fetchStaffEnquiryConfig, type FieldOption } from '../api/staffEnquiryConfig';
import { fetchStaffProductsCatalog, type CatalogProduct } from '../api/staffProductsCatalog';
import {
  derivedDiscountPercentFromMrpSelling,
  effectiveGstPercentFromCatalogProduct,
  effectiveGstPercentFromInventoryRow,
  HEARING_AID_SALE_WARRANTY_OPTIONS,
  lineInclusiveTotal,
  roundInrRupee,
} from '../utils/saleLineMath';

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

/** Same product-type filter as CRM accessory service picker (`SimplifiedEnquiryForm`). */
const ACCESSORY_CATALOG_TYPES = ['Accessory', 'Battery', 'Charger', 'Other'] as const;

function isAccessoryCatalogProduct(p: CatalogProduct): boolean {
  return (ACCESSORY_CATALOG_TYPES as readonly string[]).includes(p.type);
}

type HtEntry = { id: string; testType: string; price: string; testTypeCustom?: boolean };

function newHtId() {
  return `ht-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type SaleLineDraft = {
  id: string;
  inv: StaffInventoryRow | null;
  sellingPrice: string;
  gstPercent: string;
  qty: string;
  warranty: string;
};

function newSaleLineId() {
  return `sl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type Props = {
  appointmentId: string;
  onBack: () => void;
};

const LUCIDE_STROKE = 2;

/** Pill toggle with spring scale when selected (payment mode / receipt type). */
function PaymentPill({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(selected ? 1.06 : 1)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: selected ? 1.06 : 1,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [selected, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.pill,
          selected ? styles.pillOn : styles.pillOff,
          pressed && !disabled && styles.pillTap,
          disabled && styles.pillDisabled,
        ]}
      >
        <Text style={[styles.pillTxt, selected && styles.pillTxtOn]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function ReceiptActionScreen({ appointmentId, onBack }: Props) {
  const { appointments, isOnline } = useAppointmentsContext();
  const uid = auth.currentUser?.uid;

  const [resolved, setResolved] = useState<Appointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [receiptType, setReceiptType] = useState<ReceiptType>('booking');
  const [submitting, setSubmitting] = useState(false);
  const [savingVisitServices, setSavingVisitServices] = useState(false);
  const [templateLabels, setTemplateLabels] = useState<StaffReceiptTemplateLabels>({});

  const [hearingTest, setHearingTest] = useState(false);
  const [htEntries, setHtEntries] = useState<HtEntry[]>([
    { id: newHtId(), testType: '', price: '', testTypeCustom: false },
  ]);
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

  const [earOptions, setEarOptions] = useState<FieldOption[]>(FALLBACK_EAR);
  const [trialLocOptions, setTrialLocOptions] = useState<FieldOption[]>(FALLBACK_TRIAL_LOC);
  const [hearingTestTypeOptions, setHearingTestTypeOptions] = useState<FieldOption[]>([]);
  const [staffNames, setStaffNames] = useState<string[]>([]);

  const [selectModal, setSelectModal] = useState<
    null | { kind: 'ht'; rowId: string } | { kind: 'staff_test' } | { kind: 'staff_prog' }
  >(null);
  const [optionSearch, setOptionSearch] = useState('');
  const [staffCustomDraft, setStaffCustomDraft] = useState('');

  const [accessoryCatalogModal, setAccessoryCatalogModal] = useState(false);
  const [accessoryCatalogSearch, setAccessoryCatalogSearch] = useState('');
  const [accessoryCatalogItems, setAccessoryCatalogItems] = useState<CatalogProduct[]>([]);
  const [accessoryCatalogLoading, setAccessoryCatalogLoading] = useState(false);

  /** Collapsible visit-service panels — expand when a section is turned on. */
  const [vsOpen, setVsOpen] = useState({ ht: true, acc: false, prog: false, cou: false });

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
  const [trialProduct2, setTrialProduct2] = useState<CatalogProduct | null>(null);
  const [trialMrp2, setTrialMrp2] = useState('');
  const [trialSerial2, setTrialSerial2] = useState('');
  /** Which trial home serial slot the inventory modal is filling. */
  const [trialHomeSerialPick, setTrialHomeSerialPick] = useState<'1' | '2' | null>(null);

  const [inventoryItems, setInventoryItems] = useState<StaffInventoryRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [invModal, setInvModal] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  /** When picking inventory for invoice, which sale line is being filled (`null` = trial home serial). */
  const [invModalLineId, setInvModalLineId] = useState<string | null>(null);
  const [saleLines, setSaleLines] = useState<SaleLineDraft[]>([]);
  const [saleEar, setSaleEar] = useState('both');

  const [catalogModal, setCatalogModal] = useState(false);
  const [catalogIntent, setCatalogIntent] = useState<'booking' | 'trial' | 'trial2'>('booking');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const toggleVs = useCallback((key: 'ht' | 'acc' | 'prog' | 'cou') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setVsOpen((o) => ({ ...o, [key]: !o[key] }));
  }, []);

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
        if (r.hearingTestType?.length) setHearingTestTypeOptions(r.hearingTestType);
        if (r.staffNames?.length) setStaffNames(r.staffNames);
      }
    })();
  }, []);

  useEffect(() => {
    if (hearingTest) setVsOpen((o) => ({ ...o, ht: true }));
  }, [hearingTest]);
  useEffect(() => {
    if (accessory) setVsOpen((o) => ({ ...o, acc: true }));
  }, [accessory]);
  useEffect(() => {
    if (programming) setVsOpen((o) => ({ ...o, prog: true }));
  }, [programming]);
  useEffect(() => {
    if (counselling) setVsOpen((o) => ({ ...o, cou: true }));
  }, [counselling]);

  useEffect(() => {
    if (selectModal) {
      setOptionSearch('');
      setStaffCustomDraft('');
    }
  }, [selectModal]);

  const loadAccessoryCatalog = useCallback(async (q: string) => {
    setAccessoryCatalogLoading(true);
    try {
      const r = await fetchStaffProductsCatalog(q);
      if (r.ok && r.products) {
        setAccessoryCatalogItems(r.products.filter(isAccessoryCatalogProduct));
      } else setAccessoryCatalogItems([]);
    } finally {
      setAccessoryCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessoryCatalogModal) return;
    const delay = accessoryCatalogSearch.trim() ? 300 : 0;
    const t = setTimeout(() => void loadAccessoryCatalog(accessoryCatalogSearch), delay);
    return () => clearTimeout(t);
  }, [accessoryCatalogModal, accessoryCatalogSearch, loadAccessoryCatalog]);

  const filteredHtOptions = useMemo(() => {
    const q = optionSearch.trim().toLowerCase();
    const base = [...hearingTestTypeOptions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (!q) return base;
    return base.filter(
      (o) => o.optionLabel.toLowerCase().includes(q) || o.optionValue.toLowerCase().includes(q)
    );
  }, [hearingTestTypeOptions, optionSearch]);

  const filteredStaffModal = useMemo(() => {
    const q = optionSearch.trim().toLowerCase();
    if (!q) return staffNames;
    return staffNames.filter((s) => s.toLowerCase().includes(q));
  }, [staffNames, optionSearch]);

  const resolveHtLabel = useCallback(
    (row: HtEntry) => {
      if (row.testTypeCustom) return row.testType.trim() || 'Custom type';
      const o = hearingTestTypeOptions.find((x) => x.optionValue === row.testType);
      return o?.optionLabel || row.testType || 'Select test type';
    },
    [hearingTestTypeOptions]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const labels = await loadStaffReceiptTemplateLabels();
        if (!cancelled) setTemplateLabels(labels);
      } catch {
        if (!cancelled) setTemplateLabels({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (receiptType === 'invoice' || (receiptType === 'trial' && trialLoc === 'home')) {
      void loadInventory();
    }
  }, [receiptType, trialLoc, loadInventory]);

  useEffect(() => {
    if (receiptType !== 'invoice') setInvModalLineId(null);
  }, [receiptType]);

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
    if (receiptType === 'trial' && trialLoc === 'home') {
      const ids = new Set<string>();
      if (trialProduct) ids.add(trialProduct.id);
      if (trialProduct2) ids.add(trialProduct2.id);
      if (ids.size > 0) base = base.filter((it) => ids.has(it.productId));
      if (trialProduct && trialProduct2 && trialProduct.id === trialProduct2.id) {
        if (trialHomeSerialPick === '1' && trialSerial2.trim()) {
          base = base.filter((it) => it.serialNumber !== trialSerial2.trim());
        }
        if (trialHomeSerialPick === '2' && trialSerial.trim()) {
          base = base.filter((it) => it.serialNumber !== trialSerial.trim());
        }
      }
    }
    if (receiptType === 'invoice' && invModalLineId != null) {
      const taken = new Set(
        saleLines
          .filter((l) => l.id !== invModalLineId)
          .filter((l) => l.inv)
          .map((l) => `${l.inv!.productId}::${l.inv!.serialNumber}`)
      );
      base = base.filter((it) => !taken.has(`${it.productId}::${it.serialNumber}`));
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
  }, [
    inventoryItems,
    invSearch,
    receiptType,
    trialLoc,
    trialProduct,
    trialProduct2,
    trialHomeSerialPick,
    trialSerial,
    trialSerial2,
    saleLines,
    invModalLineId,
  ]);

  const suggestedInvoiceTotal = useMemo(() => {
    let sum = 0;
    for (const line of saleLines) {
      if (!line.inv) continue;
      const sp = parseFloat(line.sellingPrice.replace(/,/g, '')) || 0;
      const gst = parseFloat(line.gstPercent) || 0;
      const qty = Math.max(1, Math.floor(parseFloat(line.qty) || 1));
      sum += lineInclusiveTotal(line.inv.mrp, sp, gst, qty);
    }
    return roundInrRupee(sum);
  }, [saleLines]);

  useEffect(() => {
    if (receiptType !== 'invoice') return;
    if (suggestedInvoiceTotal > 0) setAmount(String(suggestedInvoiceTotal));
  }, [receiptType, suggestedInvoiceTotal]);

  /** One empty line by default so staff can pick serial immediately (multi-line invoice). */
  useEffect(() => {
    if (receiptType !== 'invoice') return;
    setSaleLines((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: newSaleLineId(),
          inv: null,
          sellingPrice: '',
          gstPercent: '18',
          qty: '1',
          warranty: '',
        },
      ];
    });
  }, [receiptType]);

  /** Pre-select the only empty line so inventory list excludes nothing until another line is added. */
  useEffect(() => {
    if (receiptType !== 'invoice') return;
    if (saleLines.length !== 1 || saleLines[0].inv) return;
    setInvModalLineId((cur) => cur ?? saleLines[0].id);
  }, [receiptType, saleLines]);

  const currentPdfTemplate = useMemo(() => {
    if (receiptType === 'booking') return templateLabels.booking;
    if (receiptType === 'trial') return templateLabels.trial;
    return templateLabels.invoice;
  }, [receiptType, templateLabels]);

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
      Alert.alert('Unavailable', 'This appointment cannot be used for visit details (services / payment).', [
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
    setTrialProduct2(null);
    setTrialMrp2('');
    setTrialSerial2('');
  }, [trialProduct?.id]);

  useEffect(() => {
    if (trialProduct2) {
      setTrialMrp2(String(trialProduct2.mrp ?? 0));
    }
  }, [trialProduct2]);

  useEffect(() => {
    if (trialLoc === 'in_office') {
      setTrialDuration('0');
      setTrialStart('');
      setTrialEnd('');
      setTrialSerial('');
      setTrialSerial2('');
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

  const openCatalog = (intent: 'booking' | 'trial' | 'trial2') => {
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
          Alert.alert('Serial', 'Select or enter the inventory serial for home trial (device 1).');
          return;
        }
        if (trialProduct2) {
          if (!trialSerial2.trim()) {
            Alert.alert('Serial', 'Select the second inventory serial for home trial.');
            return;
          }
          const m2 = Number(trialMrp2);
          if (!Number.isFinite(m2) || m2 < 0) {
            Alert.alert('MRP', 'Enter MRP for device 2.');
            return;
          }
        }
        const dep = Number(trialDeposit);
        if (!Number.isFinite(dep) || dep < 0) {
          Alert.alert('Deposit', 'Enter security deposit amount.');
          return;
        }
      }
    }

    if (receiptType === 'invoice') {
      const filled = saleLines.filter((l) => l.inv);
      if (filled.length === 0) {
        Alert.alert('Add sale lines', 'Add at least one line and pick inventory (serial) for each.');
        return;
      }
      for (const line of filled) {
        const inv = line.inv!;
        const sp = Number(line.sellingPrice.replace(/,/g, ''));
        const gst = Number(line.gstPercent);
        const qty = Number(line.qty);
        if (!Number.isFinite(sp) || sp < 0) {
          Alert.alert('Invalid selling price', 'Enter pre-tax selling price per unit for each line.');
          return;
        }
        if (!Number.isFinite(gst) || gst < 0) {
          Alert.alert('Invalid GST', 'Check GST % on each line.');
          return;
        }
        if (!Number.isFinite(qty) || qty < 1) {
          Alert.alert('Invalid quantity', 'Enter quantity on each line.');
          return;
        }
        if (inv.mrp > 0 && sp > inv.mrp) {
          Alert.alert('Selling price', `Selling cannot exceed MRP for ${inv.name}.`);
          return;
        }
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
                  ...(trialProduct2
                    ? {
                        secondCatalogProductId: trialProduct2.id,
                        secondHearingAidPrice: Number(trialMrp2),
                        secondTrialSerialNumber: trialLoc === 'home' ? trialSerial2.trim() : '',
                      }
                    : {}),
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
                  whichEar: saleEar as 'left' | 'right' | 'both',
                  products: saleLines
                    .filter((l) => l.inv)
                    .map((l) => {
                      const inv = l.inv!;
                      const sp = Number(l.sellingPrice.replace(/,/g, ''));
                      const gst = Number(l.gstPercent);
                      const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
                      const disc = derivedDiscountPercentFromMrpSelling(inv.mrp, sp);
                      const w = l.warranty.trim();
                      return {
                        productId: inv.productId,
                        name: inv.name,
                        company: inv.company,
                        serialNumber: inv.serialNumber,
                        mrp: inv.mrp,
                        sellingPrice: sp,
                        discountPercent: disc,
                        gstPercent: gst,
                        quantity: qty,
                        ...(w ? { warranty: w } : {}),
                      };
                    }),
                },
              };

      const htmlTemplateId = htmlTemplateIdForReceiptType(templateLabels, receiptType);
      const result = await submitCollectPayment({
        appointmentId: resolved.id,
        amount: n,
        paymentMode,
        receiptType,
        details,
        ...(htmlTemplateId ? { htmlTemplateId } : {}),
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

  const buildVisitServicesPayload = (): { ok: true; services: VisitServicesPayload } | { ok: false; message: string } => {
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
    if (!services.hearingTest && !services.accessory && !services.programming && !services.counselling) {
      return { ok: false, message: 'Turn on at least one service, or skip this section.' };
    }
    return { ok: true, services };
  };

  const handleSaveVisitServices = async () => {
    if (!resolved?.id) return;
    if (!isOnline) {
      Alert.alert('Offline', 'Visit logging requires an internet connection.');
      return;
    }
    if (!resolved.enquiryId?.trim()) {
      Alert.alert('No enquiry', 'Link this appointment to an enquiry in CRM to save visit services.');
      return;
    }
    if (!isEligibleForVisitServicesLogging(resolved)) {
      Alert.alert('Unavailable', 'Visit services cannot be saved for this appointment.');
      return;
    }
    const built = buildVisitServicesPayload();
    if (!built.ok) {
      Alert.alert('Check form', built.message);
      return;
    }
    setSavingVisitServices(true);
    try {
      const r = await submitLogVisitServices({
        appointmentId: resolved.id,
        services: built.services,
      });
      if (!r.ok) {
        Alert.alert('Error', r.error || 'Failed to save');
        return;
      }
      Alert.alert('Saved', 'Visit services were logged to the enquiry.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingVisitServices(false);
    }
  };

  const visitFormBusy = submitting || savingVisitServices;

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
          <Pressable onPress={onBack} style={styles.backBtn} hitSlop={12}>
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={LUCIDE_STROKE} />
          </Pressable>
          <Text style={styles.headerTitle}>Visit details</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>
    );
  }

  const typeLabel = resolved.type === 'home' ? 'Home visit' : 'Center';
  const showVisitServicesForm =
    !!(resolved.enquiryId || '').trim() && isEligibleForVisitServicesLogging(resolved);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={22} color={theme.colors.text} strokeWidth={LUCIDE_STROKE} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerKicker}>Visit workspace</Text>
          <Text style={styles.headerTitle}>Visit details</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.mainFill}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + (showVisitServicesForm ? 172 : 100) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.appointmentHero}>
            <Text style={styles.appointmentHeroKicker}>Appointment</Text>
            <Text style={styles.appointmentPatient}>{resolved.patientName || resolved.title || 'Patient'}</Text>
            <Text style={styles.appointmentMeta}>Enquiry ID · {resolved.enquiryId || '—'}</Text>
            <Text style={styles.appointmentMeta}>
              {typeLabel} · {formatTime(getStartIso(resolved))}
            </Text>
          </View>

          <Text style={styles.blockTitle}>Visit services (CRM)</Text>
        <Text style={styles.visitHint}>
          Use the same test types and staff names as the CRM enquiry form. Requires internet. Link an enquiry if missing.
        </Text>
        {!resolved.enquiryId?.trim() ? (
          <Text style={styles.visitMuted}>
            No enquiry linked — connect this appointment to an enquiry in CRM to save visit services.
          </Text>
        ) : !showVisitServicesForm ? (
          <Text style={styles.visitMuted}>Visit services are not available for this appointment.</Text>
        ) : (
          <View style={styles.visitServicesShell}>
            <View
              style={[
                styles.visitServiceCard,
                hearingTest && styles.visitServiceCardActive,
              ]}
            >
              <View style={styles.visitRowBetween}>
                <TouchableOpacity
                  style={styles.vsSectionHeaderTap}
                  onPress={() => toggleVs('ht')}
                  disabled={visitFormBusy}
                  hitSlop={{ top: 8, bottom: 8 }}
                >
                  {vsOpen.ht ? (
                    <ChevronDown size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  ) : (
                    <ChevronRight size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  )}
                  <Text style={styles.vsSectionTitle}>Hearing test</Text>
                </TouchableOpacity>
                <Switch value={hearingTest} onValueChange={setHearingTest} disabled={visitFormBusy} />
              </View>
              {hearingTest && vsOpen.ht ? (
                <>
                  {htEntries.map((row, idx) => (
                    <View key={row.id} style={styles.htBlock}>
                      <View style={styles.htRow}>
                        <View style={[styles.vsFlex, styles.vsMinW]}>
                          {row.testTypeCustom ? (
                            <TextInput
                              style={[styles.inputAiry, styles.vsInputNoMb]}
                              placeholder="Custom test type"
                              placeholderTextColor={theme.colors.textMuted}
                              value={row.testType}
                              onChangeText={(t) => {
                                const next = [...htEntries];
                                next[idx] = { ...row, testType: t };
                                setHtEntries(next);
                              }}
                              editable={!visitFormBusy}
                            />
                          ) : (
                            <TouchableOpacity
                              style={styles.vsPickerBtn}
                              onPress={() => setSelectModal({ kind: 'ht', rowId: row.id })}
                              disabled={visitFormBusy}
                            >
                              <Text style={styles.vsPickerBtnText} numberOfLines={2}>
                                {resolveHtLabel(row)}
                              </Text>
                              <ChevronDown size={20} color={theme.colors.primary} strokeWidth={LUCIDE_STROKE} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            onPress={() => {
                              const next = [...htEntries];
                              next[idx] = {
                                ...row,
                                testTypeCustom: !row.testTypeCustom,
                                testType: row.testTypeCustom ? '' : row.testType,
                              };
                              setHtEntries(next);
                            }}
                            disabled={visitFormBusy}
                          >
                            <Text style={styles.vsToggleLink}>{row.testTypeCustom ? 'Use CRM list' : 'Custom'}</Text>
                          </TouchableOpacity>
                        </View>
                        <TextInput
                          style={[styles.inputAiry, styles.vsPrice]}
                          placeholder="₹"
                          placeholderTextColor={theme.colors.textMuted}
                          keyboardType="decimal-pad"
                          value={row.price}
                          onChangeText={(t) => {
                            const next = [...htEntries];
                            next[idx] = { ...row, price: t };
                            setHtEntries(next);
                          }}
                          editable={!visitFormBusy}
                        />
                        <TouchableOpacity
                          onPress={() => setHtEntries((prev) => prev.filter((r) => r.id !== row.id))}
                          disabled={htEntries.length <= 1 || visitFormBusy}
                        >
                          <Trash2 size={22} color={theme.colors.error} strokeWidth={LUCIDE_STROKE} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.vsAddRow}
                    onPress={() =>
                      setHtEntries((prev) => [
                        ...prev,
                        { id: newHtId(), testType: '', price: '', testTypeCustom: false },
                      ])
                    }
                    disabled={visitFormBusy}
                  >
                    <CirclePlus size={20} color={theme.colors.primary} strokeWidth={LUCIDE_STROKE} />
                    <Text style={styles.vsAddText}>Add test line</Text>
                  </TouchableOpacity>
                  <Text style={styles.floatLabel}>Test done by</Text>
                  <TouchableOpacity
                    style={styles.vsPickerBtn}
                    onPress={() => setSelectModal({ kind: 'staff_test' })}
                    disabled={visitFormBusy}
                  >
                    <Text style={styles.vsPickerBtnText} numberOfLines={1}>
                      {testDoneBy.trim() || 'Select staff (CRM list)'}
                    </Text>
                    <ChevronDown size={20} color={theme.colors.primary} strokeWidth={LUCIDE_STROKE} />
                  </TouchableOpacity>
                  <VsMultiline
                    label="Test results"
                    value={testResults}
                    onChangeText={setTestResults}
                    disabled={visitFormBusy}
                  />
                  <VsMultiline
                    label="Recommendations"
                    value={recommendations}
                    onChangeText={setRecommendations}
                    disabled={visitFormBusy}
                  />
                </>
              ) : null}
            </View>

            <View style={[styles.visitServiceCard, accessory && styles.visitServiceCardActive]}>
              <View style={styles.visitRowBetween}>
                <TouchableOpacity
                  style={styles.vsSectionHeaderTap}
                  onPress={() => toggleVs('acc')}
                  disabled={visitFormBusy}
                  hitSlop={{ top: 8, bottom: 8 }}
                >
                  {vsOpen.acc ? (
                    <ChevronDown size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  ) : (
                    <ChevronRight size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  )}
                  <Text style={styles.vsSectionTitle}>Accessory</Text>
                </TouchableOpacity>
                <Switch value={accessory} onValueChange={setAccessory} disabled={visitFormBusy} />
              </View>
              {accessory && vsOpen.acc ? (
                <>
                  <TouchableOpacity
                    style={styles.vsCatalogLink}
                    onPress={() => {
                      setAccessoryCatalogSearch('');
                      setAccessoryCatalogModal(true);
                    }}
                    disabled={visitFormBusy}
                  >
                    <List size={20} color={theme.colors.primary} strokeWidth={LUCIDE_STROKE} />
                    <Text style={styles.vsCatalogLinkText}>Pick from catalog (Accessory / Battery / Charger)</Text>
                  </TouchableOpacity>
                  <Field label="Accessory name *" value={accessoryName} onChangeText={setAccessoryName} disabled={visitFormBusy} />
                  <VsMultiline
                    label="Details"
                    value={accessoryDetails}
                    onChangeText={setAccessoryDetails}
                    disabled={visitFormBusy}
                  />
                  <View style={styles.visitRowBetween}>
                    <Text style={styles.fieldLabel}>Free of charge</Text>
                    <Switch value={accessoryFOC} onValueChange={setAccessoryFOC} disabled={visitFormBusy} />
                  </View>
                  <Field
                    label="Amount (₹)"
                    value={accessoryAmount}
                    onChangeText={setAccessoryAmount}
                    keyboardType="decimal-pad"
                    disabled={visitFormBusy}
                  />
                  <Field
                    label="Quantity"
                    value={accessoryQuantity}
                    onChangeText={setAccessoryQuantity}
                    keyboardType="number-pad"
                    disabled={visitFormBusy}
                  />
                </>
              ) : null}
            </View>

            <View style={[styles.visitServiceCard, programming && styles.visitServiceCardActive]}>
              <View style={styles.visitRowBetween}>
                <TouchableOpacity
                  style={styles.vsSectionHeaderTap}
                  onPress={() => toggleVs('prog')}
                  disabled={visitFormBusy}
                  hitSlop={{ top: 8, bottom: 8 }}
                >
                  {vsOpen.prog ? (
                    <ChevronDown size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  ) : (
                    <ChevronRight size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  )}
                  <Text style={styles.vsSectionTitle}>Programming</Text>
                </TouchableOpacity>
                <Switch value={programming} onValueChange={setProgramming} disabled={visitFormBusy} />
              </View>
              {programming && vsOpen.prog ? (
                <>
                  <VsMultiline
                    label="Reason"
                    value={programmingReason}
                    onChangeText={setProgrammingReason}
                    disabled={visitFormBusy}
                  />
                  <Field
                    label="Amount (₹)"
                    value={programmingAmount}
                    onChangeText={setProgrammingAmount}
                    keyboardType="decimal-pad"
                    disabled={visitFormBusy}
                  />
                  <Text style={styles.floatLabel}>Done by</Text>
                  <TouchableOpacity
                    style={styles.vsPickerBtn}
                    onPress={() => setSelectModal({ kind: 'staff_prog' })}
                    disabled={visitFormBusy}
                  >
                    <Text style={styles.vsPickerBtnText} numberOfLines={1}>
                      {programmingDoneBy.trim() || 'Select staff (CRM list)'}
                    </Text>
                    <ChevronDown size={20} color={theme.colors.primary} strokeWidth={LUCIDE_STROKE} />
                  </TouchableOpacity>
                  <Field
                    label="HA purchase date"
                    value={hearingAidPurchaseDate}
                    onChangeText={setHearingAidPurchaseDate}
                    disabled={visitFormBusy}
                  />
                  <Field label="Hearing aid name" value={hearingAidName} onChangeText={setHearingAidName} disabled={visitFormBusy} />
                  <View style={styles.visitRowBetween}>
                    <Text style={styles.fieldLabel}>Under warranty</Text>
                    <Switch value={underWarranty} onValueChange={setUnderWarranty} disabled={visitFormBusy} />
                  </View>
                  <Field label="Warranty" value={warranty} onChangeText={setWarranty} disabled={visitFormBusy} />
                </>
              ) : null}
            </View>

            <View style={[styles.visitServiceCard, counselling && styles.visitServiceCardActive]}>
              <View style={styles.visitRowBetween}>
                <TouchableOpacity
                  style={styles.vsSectionHeaderTap}
                  onPress={() => toggleVs('cou')}
                  disabled={visitFormBusy}
                  hitSlop={{ top: 8, bottom: 8 }}
                >
                  {vsOpen.cou ? (
                    <ChevronDown size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  ) : (
                    <ChevronRight size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                  )}
                  <Text style={styles.vsSectionTitle}>Counselling</Text>
                </TouchableOpacity>
                <Switch value={counselling} onValueChange={setCounselling} disabled={visitFormBusy} />
              </View>
              {counselling && vsOpen.cou ? (
                <VsMultiline
                  label="Notes"
                  value={counsellingNotes}
                  onChangeText={setCounsellingNotes}
                  disabled={visitFormBusy}
                />
              ) : null}
            </View>

          </View>
        )}

        <View style={styles.sectionSpacer} />
        <Text style={styles.blockTitle}>Payment & receipt</Text>
        <Text style={styles.visitHint}>Collect payment for trial, booking, or sale — sent to admin for verification.</Text>

        <View style={styles.amountHero}>
          <Text style={styles.amountHeroLabel}>Payment collected today</Text>
          <View style={styles.amountHeroInner}>
            <Text style={styles.amountRupee}>₹</Text>
            <TextInput
              style={styles.amountHeroInput}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={theme.colors.textMuted}
              value={amount}
              onChangeText={setAmount}
              editable={!visitFormBusy}
            />
          </View>
        </View>

        <Text style={styles.subfieldLabel}>Payment mode</Text>
        <View style={styles.pillRow}>
          {(['cash', 'upi', 'card'] as const).map((m) => (
            <PaymentPill
              key={m}
              label={m.toUpperCase()}
              selected={paymentMode === m}
              onPress={() => setPaymentMode(m)}
              disabled={visitFormBusy}
            />
          ))}
        </View>

        <Text style={styles.subfieldLabel}>Receipt type</Text>
        <View style={styles.pillRow}>
          {(['trial', 'booking', 'invoice'] as const).map((t) => (
            <PaymentPill
              key={t}
              label={t.charAt(0).toUpperCase() + t.slice(1)}
              selected={receiptType === t}
              onPress={() => setReceiptType(t)}
              disabled={visitFormBusy}
            />
          ))}
        </View>

        <View style={styles.softCard}>
          <Text style={styles.sectionLabel}>PDF template (CRM)</Text>
          {currentPdfTemplate ? (
            <>
              <Text style={styles.patientName}>{currentPdfTemplate.name}</Text>
              <Text style={styles.metaLine}>ID: {currentPdfTemplate.id}</Text>
              <Text style={[styles.metaLine, { marginTop: 8, fontSize: 12 }]}>
                Pinned in CRM Invoice Manager; this ID is sent with your request so the PDF matches the CRM.
              </Text>
            </>
          ) : (
            <Text style={styles.metaLine}>
              No template pinned for this receipt type in CRM. The server will pick a default HTML template.
            </Text>
          )}
        </View>

        {receiptType === 'booking' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Booking — catalog device (CRM)</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={() => openCatalog('booking')} disabled={visitFormBusy}>
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
            {bookingProduct ? (
              <Text style={styles.metaLine}>
                GST % (from catalog): {effectiveGstPercentFromCatalogProduct(bookingProduct)}%
                {bookingProduct.gstApplicable === false ? ' · GST exempt' : ''}
              </Text>
            ) : null}
          </View>
        ) : null}

        {receiptType === 'trial' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Trial — catalog + trial type (CRM)</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={() => openCatalog('trial')} disabled={visitFormBusy}>
              <Text style={styles.pickBtnText}>
                {trialProduct
                  ? `${trialProduct.company} · ${trialProduct.name} (${trialProduct.type})`
                  : 'Select from product catalog (device 1)'}
              </Text>
            </TouchableOpacity>
            {trialProduct ? (
              <Text style={styles.metaLine}>
                GST % (device 1, from catalog): {effectiveGstPercentFromCatalogProduct(trialProduct)}%
                {trialProduct.gstApplicable === false ? ' · GST exempt' : ''}
              </Text>
            ) : null}
            {trialProduct && !trialProduct2 ? (
              <TouchableOpacity
                style={[styles.pickBtn, { marginTop: 10, borderStyle: 'dashed' as const }]}
                onPress={() => openCatalog('trial2')}
                disabled={visitFormBusy}
              >
                <Text style={styles.pickBtnText}>+ Add second device (optional, max 2)</Text>
              </TouchableOpacity>
            ) : null}
            {trialProduct2 ? (
              <View style={{ marginTop: 12 }}>
                <View style={styles.visitRowBetween}>
                  <Text style={styles.fieldLabel}>Device 2</Text>
                  <TouchableOpacity onPress={() => setTrialProduct2(null)} disabled={visitFormBusy}>
                    <Text style={styles.modalClose}>Remove</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.pickBtn} onPress={() => openCatalog('trial2')} disabled={visitFormBusy}>
                  <Text style={styles.pickBtnText}>
                    {trialProduct2.company} · {trialProduct2.name} ({trialProduct2.type})
                  </Text>
                </TouchableOpacity>
                <Text style={styles.metaLine}>
                  GST % (device 2, from catalog): {effectiveGstPercentFromCatalogProduct(trialProduct2)}%
                  {trialProduct2.gstApplicable === false ? ' · GST exempt' : ''}
                </Text>
                <Field label="MRP device 2 (per unit) ₹" value={trialMrp2} onChangeText={setTrialMrp2} keyboardType="decimal-pad" />
              </View>
            ) : null}
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
                <Text style={styles.fieldLabel}>Serial — device 1</Text>
                <TouchableOpacity
                  style={styles.pickBtn}
                  onPress={() => {
                    setTrialHomeSerialPick('1');
                    setInvModalLineId(null);
                    setInvModal(true);
                  }}
                  disabled={inventoryLoading || visitFormBusy}
                >
                  {inventoryLoading ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <Text style={styles.pickBtnText}>
                      {trialSerial ? `Serial: ${trialSerial}` : 'Select serial from inventory'}
                    </Text>
                  )}
                </TouchableOpacity>
                {trialProduct2 ? (
                  <>
                    <Text style={styles.fieldLabel}>Serial — device 2</Text>
                    <TouchableOpacity
                      style={styles.pickBtn}
                      onPress={() => {
                        setTrialHomeSerialPick('2');
                        setInvModalLineId(null);
                        setInvModal(true);
                      }}
                      disabled={inventoryLoading || visitFormBusy}
                    >
                      {inventoryLoading ? (
                        <ActivityIndicator color={theme.colors.primary} />
                      ) : (
                        <Text style={styles.pickBtnText}>
                          {trialSerial2 ? `Serial: ${trialSerial2}` : 'Select second serial'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : null}
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
            <Text style={styles.visitHint}>
              Same pricing as CRM enquiry: set selling price (pre-tax); discount % is derived from MRP vs selling.
            </Text>
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
            {saleLines.map((line) => {
              const inv = line.inv;
              const sp = parseFloat(line.sellingPrice.replace(/,/g, '')) || 0;
              const gst = parseFloat(line.gstPercent) || 0;
              const qty = Math.max(1, Math.floor(parseFloat(line.qty) || 1));
              const discPct =
                inv && inv.mrp > 0 ? derivedDiscountPercentFromMrpSelling(inv.mrp, sp) : 0;
              const lineTot =
                inv != null ? lineInclusiveTotal(inv.mrp, sp, gst, qty) : 0;
              return (
                <View key={line.id} style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                  <View style={styles.visitRowBetween}>
                    <Text style={styles.blockTitle}>Line</Text>
                    <TouchableOpacity
                      onPress={() => setSaleLines((prev) => prev.filter((x) => x.id !== line.id))}
                      disabled={visitFormBusy}
                      hitSlop={{ top: 8, bottom: 8 }}
                    >
                      <Trash2 size={20} color={theme.colors.textSecondary} strokeWidth={LUCIDE_STROKE} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.pickBtn}
                    onPress={() => {
                      setInvModalLineId(line.id);
                      setInvModal(true);
                    }}
                    disabled={inventoryLoading || visitFormBusy}
                  >
                    {inventoryLoading ? (
                      <ActivityIndicator color={theme.colors.primary} />
                    ) : (
                      <Text style={styles.pickBtnText}>
                        {inv
                          ? `${inv.name} · SN ${inv.serialNumber}`
                          : 'Select hearing aid (serial)'}
                      </Text>
                    )}
                  </TouchableOpacity>
                  {inv ? (
                    <>
                      <Text style={styles.metaLine}>MRP: ₹{inv.mrp}</Text>
                      <Text style={styles.metaLine}>Discount (derived): {discPct}%</Text>
                      <Field
                        label="Selling price (pre-tax / unit) ₹"
                        value={line.sellingPrice}
                        onChangeText={(t) =>
                          setSaleLines((prev) =>
                            prev.map((l) => (l.id === line.id ? { ...l, sellingPrice: t } : l))
                          )
                        }
                        keyboardType="decimal-pad"
                      />
                      <Field
                        label="GST % (from product when serial selected)"
                        value={line.gstPercent}
                        onChangeText={(t) =>
                          setSaleLines((prev) =>
                            prev.map((l) => (l.id === line.id ? { ...l, gstPercent: t } : l))
                          )
                        }
                        keyboardType="decimal-pad"
                        disabled={!!inv}
                      />
                      <Field
                        label="Quantity"
                        value={line.qty}
                        onChangeText={(t) =>
                          setSaleLines((prev) =>
                            prev.map((l) => (l.id === line.id ? { ...l, qty: t } : l))
                          )
                        }
                        keyboardType="number-pad"
                      />
                      <Text style={styles.metaLine}>Line total (incl. GST): ₹{lineTot}</Text>
                      <Text style={styles.fieldLabel}>Warranty</Text>
                      <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>
                        {HEARING_AID_SALE_WARRANTY_OPTIONS.map((opt) => (
                          <TouchableOpacity
                            key={opt}
                            style={[styles.chip, line.warranty === opt && styles.chipActive]}
                            onPress={() =>
                              setSaleLines((prev) =>
                                prev.map((l) => (l.id === line.id ? { ...l, warranty: opt } : l))
                              )
                            }
                          >
                            <Text
                              style={[styles.chipText, line.warranty === opt && styles.chipTextActive]}
                            >
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Field
                        label="Warranty (custom)"
                        value={line.warranty}
                        onChangeText={(t) =>
                          setSaleLines((prev) =>
                            prev.map((l) => (l.id === line.id ? { ...l, warranty: t } : l))
                          )
                        }
                      />
                    </>
                  ) : null}
                </View>
              );
            })}
            <TouchableOpacity
              style={[styles.pickBtn, { marginTop: 12, borderStyle: 'dashed' as const }]}
              onPress={() =>
                setSaleLines((prev) => [
                  ...prev,
                  {
                    id: newSaleLineId(),
                    inv: null,
                    sellingPrice: '',
                    gstPercent: '18',
                    qty: '1',
                    warranty: '',
                  },
                ])
              }
              disabled={visitFormBusy}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <CirclePlus size={18} color={theme.colors.primary} strokeWidth={LUCIDE_STROKE} />
                <Text style={styles.pickBtnText}>Add line</Text>
              </View>
            </TouchableOpacity>
            {suggestedInvoiceTotal > 0 ? (
              <Text style={[styles.metaLine, { marginTop: 10 }]}>
                Suggested payment (sum of lines): ₹{suggestedInvoiceTotal}
              </Text>
            ) : null}
          </View>
        ) : null}

        </ScrollView>

        <View
          style={[
            styles.stickyFooter,
            { paddingBottom: Math.max(insets.bottom, 14), paddingTop: 12 },
          ]}
        >
          <View style={styles.stickyFooterInner}>
            {showVisitServicesForm ? (
              <Pressable
                style={({ pressed }) => [
                  styles.ctaPrimarySolid,
                  (visitFormBusy || savingVisitServices) && styles.ctaMuted,
                  pressed && !(visitFormBusy || savingVisitServices) && styles.ctaPrimaryPressed,
                ]}
                onPress={() => void handleSaveVisitServices()}
                disabled={visitFormBusy || savingVisitServices}
              >
                {savingVisitServices ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.ctaPrimarySolidText}>Save visit services</Text>
                )}
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                showVisitServicesForm ? styles.ctaTealSolid : styles.ctaPrimarySolid,
                visitFormBusy && styles.ctaMuted,
                pressed && !visitFormBusy && styles.ctaPrimaryPressed,
              ]}
              onPress={() => void handleSubmit()}
              disabled={visitFormBusy}
            >
              {submitting ? (
                <ActivityIndicator color={showVisitServicesForm ? '#fff' : '#fff'} />
              ) : (
                <Text
                  style={
                    showVisitServicesForm ? styles.ctaTealSolidText : styles.ctaPrimarySolidText
                  }
                >
                  Send payment to admin
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

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
                    else if (catalogIntent === 'trial2') {
                      setTrialProduct2(item);
                    } else setTrialProduct(item);
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

      <Modal
        visible={invModal}
        animationType="slide"
        onRequestClose={() => {
          setInvModal(false);
          setInvModalLineId(null);
          setTrialHomeSerialPick(null);
        }}
      >
        <SafeAreaView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setInvModal(false);
                setInvModalLineId(null);
                setTrialHomeSerialPick(null);
              }}
            >
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {receiptType === 'trial' && trialLoc === 'home' && trialHomeSerialPick === '2'
                ? 'Pick serial (device 2)'
                : receiptType === 'trial' && trialLoc === 'home'
                  ? 'Pick serial (device 1)'
                  : 'Available stock'}
            </Text>
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
                  const gstStr = String(effectiveGstPercentFromInventoryRow(item));
                  if (receiptType === 'invoice' && invModalLineId != null) {
                    setSaleLines((prev) =>
                      prev.map((l) =>
                        l.id === invModalLineId
                          ? {
                              ...l,
                              inv: item,
                              sellingPrice: String(item.mrp ?? 0),
                              gstPercent: gstStr,
                              qty: '1',
                            }
                          : l
                      )
                    );
                  } else if (receiptType === 'trial' && trialLoc === 'home') {
                    if (trialHomeSerialPick === '2') setTrialSerial2(item.serialNumber);
                    else setTrialSerial(item.serialNumber);
                  }
                  setInvModal(false);
                  setInvModalLineId(null);
                  setTrialHomeSerialPick(null);
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

      <Modal visible={!!selectModal} animationType="slide" onRequestClose={() => setSelectModal(null)}>
        <SafeAreaView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setSelectModal(null)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {selectModal?.kind === 'ht'
                ? 'Test type'
                : selectModal?.kind === 'staff_test'
                  ? 'Test done by'
                  : 'Programming done by'}
            </Text>
            <View style={{ width: 48 }} />
          </View>
          <TextInput
            style={styles.input}
            placeholder={selectModal?.kind === 'ht' ? 'Search test types' : 'Search staff'}
            placeholderTextColor={theme.colors.textMuted}
            value={optionSearch}
            onChangeText={setOptionSearch}
          />
          {selectModal?.kind === 'ht' ? (
            <FlatList
              data={filteredHtOptions}
              keyExtractor={(item) => item.optionValue}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.invRow}
                  onPress={() => {
                    const rowId = selectModal.kind === 'ht' ? selectModal.rowId : '';
                    const idx = htEntries.findIndex((x) => x.id === rowId);
                    if (idx >= 0) {
                      const next = [...htEntries];
                      next[idx] = { ...next[idx], testType: item.optionValue, testTypeCustom: false };
                      setHtEntries(next);
                    }
                    setSelectModal(null);
                  }}
                >
                  <Text style={styles.invName}>{item.optionLabel}</Text>
                  <Text style={styles.invSub}>{item.optionValue}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyInv}>No matching types. Try custom.</Text>}
              ListFooterComponent={
                <TouchableOpacity
                  style={styles.invRow}
                  onPress={() => {
                    const rowId = selectModal?.kind === 'ht' ? selectModal.rowId : '';
                    const idx = htEntries.findIndex((x) => x.id === rowId);
                    if (idx >= 0) {
                      const next = [...htEntries];
                      next[idx] = { ...next[idx], testType: '', testTypeCustom: true };
                      setHtEntries(next);
                    }
                    setSelectModal(null);
                  }}
                >
                  <Text style={styles.invName}>Other / custom…</Text>
                  <Text style={styles.invSub}>Enter text in the form</Text>
                </TouchableOpacity>
              }
            />
          ) : (
            <>
              <FlatList
                data={filteredStaffModal}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.invRow}
                    onPress={() => {
                      if (selectModal?.kind === 'staff_test') setTestDoneBy(item);
                      if (selectModal?.kind === 'staff_prog') setProgrammingDoneBy(item);
                      setSelectModal(null);
                    }}
                  >
                    <Text style={styles.invName}>{item}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.emptyInv}>No matches.</Text>}
              />
              <Text style={styles.fieldLabel}>Name not listed</Text>
              <TextInput
                style={styles.input}
                placeholder="Type full name"
                placeholderTextColor={theme.colors.textMuted}
                value={staffCustomDraft}
                onChangeText={setStaffCustomDraft}
              />
              <TouchableOpacity
                style={styles.vsModalUseBtn}
                onPress={() => {
                  const t = staffCustomDraft.trim();
                  if (!t) return;
                  if (selectModal?.kind === 'staff_test') setTestDoneBy(t);
                  if (selectModal?.kind === 'staff_prog') setProgrammingDoneBy(t);
                  setSelectModal(null);
                }}
              >
                <Text style={styles.vsModalUseBtnText}>Use this name</Text>
              </TouchableOpacity>
            </>
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={accessoryCatalogModal}
        animationType="slide"
        onRequestClose={() => setAccessoryCatalogModal(false)}
      >
        <SafeAreaView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setAccessoryCatalogModal(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Accessory catalog</Text>
            <View style={{ width: 48 }} />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Search accessory, battery, charger"
            placeholderTextColor={theme.colors.textMuted}
            value={accessoryCatalogSearch}
            onChangeText={setAccessoryCatalogSearch}
          />
          {accessoryCatalogLoading ? (
            <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.primary} />
          ) : (
            <FlatList
              data={accessoryCatalogItems}
              keyExtractor={(it) => it.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.invRow}
                  onPress={() => {
                    setAccessoryName(item.name);
                    setAccessoryCatalogModal(false);
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
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
  disabled,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.floatLabel}>{label}</Text>
      <TextInput
        style={[
          styles.inputAiry,
          focused && styles.inputAiryFocused,
          disabled && styles.inputDisabled,
        ]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={theme.colors.textMuted}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

function VsMultiline({
  label,
  value,
  onChangeText,
  disabled,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.floatLabel}>{label}</Text>
      <TextInput
        style={[
          styles.inputAiry,
          styles.textAreaAiry,
          focused && styles.inputAiryFocused,
          disabled && styles.inputDisabled,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.colors.textMuted}
        multiline
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

const BORDER_SOFT = '#D8E0F0';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  mainFill: {
    flex: 1,
    position: 'relative',
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_SOFT,
  },
  backBtn: {
    padding: 8,
    width: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerKicker: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: -0.3,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  appointmentHero: {
    backgroundColor: '#E8F4FA',
    borderRadius: 20,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(13, 148, 136, 0.22)',
    ...theme.shadows.soft,
  },
  appointmentHeroKicker: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.tealDark,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  appointmentPatient: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 10,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  appointmentMeta: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
    lineHeight: 22,
  },
  sectionSpacer: {
    height: 8,
  },
  card: {
    backgroundColor: theme.colors.background,
    borderRadius: 20,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    ...theme.shadows.soft,
  },
  softCard: {
    backgroundColor: theme.colors.background,
    borderRadius: 20,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    ...theme.shadows.soft,
  },
  sectionLabel: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  patientName: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 8,
    lineHeight: 24,
  },
  metaLine: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 6,
    lineHeight: 22,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 8,
    lineHeight: 20,
  },
  floatLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 8,
    lineHeight: 20,
  },
  subfieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textMuted,
    marginBottom: 10,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldWrap: {
    marginBottom: 18,
  },
  inputAiry: {
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
    lineHeight: 22,
  },
  inputAiryFocused: {
    borderColor: theme.colors.primary,
    borderWidth: 1.5,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  inputDisabled: {
    opacity: 0.55,
    backgroundColor: theme.colors.backgroundTertiary,
  },
  textAreaAiry: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
    backgroundColor: theme.colors.background,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  amountHero: {
    backgroundColor: theme.colors.background,
    borderRadius: 20,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    ...theme.shadows.soft,
  },
  amountHeroLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  amountHeroInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amountRupee: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.text,
    marginRight: 6,
    lineHeight: 34,
  },
  amountHeroInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    color: theme.colors.text,
    paddingVertical: 4,
    letterSpacing: -0.5,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 22,
  },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillOff: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
  },
  pillOn: {
    backgroundColor: theme.colors.primary,
    borderWidth: 0,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  pillTap: {
    opacity: 0.92,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  pillTxt: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    letterSpacing: 0.2,
  },
  pillTxtOn: {
    color: '#FFFFFF',
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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
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
    fontWeight: '600',
  },
  block: {
    marginBottom: 14,
  },
  blockTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 14,
    marginTop: 4,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  pickBtn: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    backgroundColor: theme.colors.primaryLight,
  },
  pickBtnText: {
    color: theme.colors.primaryDark,
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 22,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: 1,
    borderTopColor: BORDER_SOFT,
    paddingHorizontal: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 16,
  },
  stickyFooterInner: {
    gap: 10,
  },
  ctaPrimarySolid: {
    backgroundColor: theme.colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaPrimarySolidText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  ctaTealSolid: {
    backgroundColor: theme.colors.tealDark,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ctaTealSolidText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  ctaMuted: {
    opacity: 0.55,
  },
  ctaPrimaryPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  invName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
    lineHeight: 22,
  },
  invSub: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 4,
    lineHeight: 19,
  },
  emptyInv: {
    textAlign: 'center',
    marginTop: 24,
    color: theme.colors.textMuted,
    lineHeight: 22,
  },
  visitHint: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 22,
    marginBottom: 18,
  },
  visitMuted: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 18,
    lineHeight: 22,
  },
  visitServicesShell: {
    gap: 14,
    marginBottom: 8,
  },
  visitServiceCard: {
    backgroundColor: theme.colors.background,
    borderRadius: 20,
    padding: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    ...theme.shadows.soft,
  },
  visitServiceCardActive: {
    borderColor: 'rgba(79, 70, 229, 0.45)',
    backgroundColor: '#FAFBFF',
  },
  visitRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: -0.2,
  },
  htRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  vsFlex: {
    flex: 1,
  },
  vsPrice: {
    width: 92,
    marginBottom: 0,
  },
  vsAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    marginTop: 4,
  },
  vsAddText: {
    color: theme.colors.primary,
    fontWeight: '600',
    fontSize: 15,
  },
  vsSectionHeaderTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  vsPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    backgroundColor: theme.colors.background,
    minHeight: 52,
  },
  vsPickerBtnText: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
    fontWeight: '500',
    lineHeight: 22,
  },
  vsToggleLink: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 8,
  },
  vsCatalogLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingVertical: 8,
  },
  vsCatalogLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
    lineHeight: 20,
  },
  htBlock: {
    marginBottom: 8,
  },
  vsMinW: {
    minWidth: 0,
  },
  vsInputNoMb: {
    marginBottom: 8,
  },
  vsModalUseBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  vsModalUseBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
