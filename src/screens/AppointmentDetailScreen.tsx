import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { Appointment } from '../types';
import { theme } from '../theme';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isEligibleForVisitServicesLogging } from '../utils/appointmentPayable';

interface AppointmentDetailScreenProps {
  appointment: Appointment;
  onBack: () => void;
  /** Navigate to staff visit-services flow (CRM enquiry visit; requires linked enquiry). */
  onLogVisitServices?: () => void;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getStatusConfig(status?: string) {
  switch (status) {
    case 'completed':
      return { bg: theme.colors.successBg, text: theme.colors.successText, dot: theme.colors.success };
    case 'cancelled':
      return { bg: theme.colors.errorBg, text: theme.colors.errorText, dot: theme.colors.error };
    default:
      return { bg: theme.colors.scheduledBg, text: theme.colors.scheduledText, dot: theme.colors.scheduled };
  }
}

export default function AppointmentDetailScreen({
  appointment,
  onBack,
  onLogVisitServices,
}: AppointmentDetailScreenProps) {
  const { isOnline, updateAppointmentOptimistic, markCompletedOffline, markCancelledOffline } = useAppointmentsContext();
  const [feedback, setFeedback] = useState('');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [centerName, setCenterName] = useState<string | null>(appointment.centerName || null);

  const isScheduled = appointment.status === 'scheduled' || !appointment.status;
  const statusConfig = getStatusConfig(appointment.status);
  const showVisitServices = Boolean(onLogVisitServices) && isEligibleForVisitServicesLogging(appointment);

  useEffect(() => {
    const resolved = appointment.centerName;
    if (resolved) {
      setCenterName(resolved);
      return;
    }
    const cid = appointment.centerId;
    if (!cid) {
      setCenterName(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'centers', cid))
      .then((snap) => {
        if (cancelled) return;
        const name = (snap.data() as { name?: string })?.name;
        setCenterName(name || null);
      })
      .catch(() => {
        if (!cancelled) setCenterName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appointment.centerId, appointment.centerName]);

  const handleCall = () => {
    const phone = appointment.patientPhone?.replace(/\D/g, '') || '';
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    } else {
      Alert.alert('Error', 'No phone number available');
    }
  };

  const handleMarkCompleted = () => setShowFeedbackModal(true);

  const submitCompleted = async () => {
    if (!appointment.id) return;
    const fb = feedback.trim() || '';
    setSaving(true);
    setShowFeedbackModal(false);
    setFeedback('');

    // Optimistic update immediately
    updateAppointmentOptimistic(appointment.id, { status: 'completed', feedback: fb });

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'appointments', appointment.id), {
          status: 'completed',
          feedback: fb,
          updatedAt: serverTimestamp(),
        });
        onBack();
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Failed to update. Changes saved locally and will sync when online.');
        markCompletedOffline(appointment.id, fb);
        onBack();
      } finally {
        setSaving(false);
      }
    } else {
      markCompletedOffline(appointment.id, fb);
      setSaving(false);
      onBack();
    }
  };

  const handleMarkCancelled = () => {
    Alert.alert(
      'Cancel Appointment',
      'Are you sure you want to mark this appointment as cancelled?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            if (!appointment.id) return;
            setSaving(true);

            // Optimistic update immediately
            updateAppointmentOptimistic(appointment.id, { status: 'cancelled' });

            if (isOnline) {
              try {
                await updateDoc(doc(db, 'appointments', appointment.id), {
                  status: 'cancelled',
                  updatedAt: serverTimestamp(),
                });
                onBack();
              } catch (err: any) {
                Alert.alert('Error', err?.message || 'Failed to update. Changes saved locally and will sync when online.');
                markCancelledOffline(appointment.id);
                onBack();
              } finally {
                setSaving(false);
              }
            } else {
              markCancelledOffline(appointment.id);
              setSaving(false);
              onBack();
            }
          },
        },
      ]
    );
  };

  const openMaps = () => {
    const addr = encodeURIComponent(appointment.address || '');
    if (addr) Linking.openURL(`https://maps.google.com/?q=${addr}`);
  };

  const DetailSection = ({
    label,
    children,
    last,
  }: {
    label: string;
    children: React.ReactNode;
    last?: boolean;
  }) => (
    <View style={[styles.section, !last && styles.sectionWithDivider]}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero card - Patient name & status */}
        <View style={styles.heroCard}>
          <Text style={styles.patientName}>{appointment.patientName || appointment.title || 'Patient'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusConfig.dot }]} />
            <Text style={[styles.statusText, { color: statusConfig.text }]}>
              {appointment.status || 'scheduled'}
            </Text>
          </View>
        </View>

        {/* Call Patient - Full-width CTA with subtle glow */}
        <TouchableOpacity
          style={styles.callButtonWrap}
          onPress={handleCall}
          disabled={!appointment.patientPhone}
          activeOpacity={0.9}
        >
          <View style={[styles.callButton, !appointment.patientPhone && styles.callButtonDisabled]}>
            <View style={styles.callButtonInner}>
              <View style={styles.callIconWrap}>
                <Ionicons name="call" size={24} color="#fff" />
              </View>
              <Text style={styles.callButtonText}>Call Patient</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Detail sections */}
        <View style={styles.detailsCard}>
          <DetailSection label="Date & Time">
            <View style={styles.dateTimeRow}>
              <View style={styles.dateTimeItem}>
                <Ionicons name="calendar-outline" size={18} color={theme.colors.textMuted} />
                <Text style={styles.value}>{formatDate(appointment.start)}</Text>
              </View>
              <View style={styles.dateTimeItem}>
                <Ionicons name="time-outline" size={18} color={theme.colors.textMuted} />
                <Text style={styles.value}>{formatTime(appointment.start)}</Text>
              </View>
            </View>
          </DetailSection>

          <DetailSection label="Location">
            {appointment.address ? (
              <TouchableOpacity style={styles.locationLink} onPress={openMaps} activeOpacity={0.7}>
                <Ionicons name="location-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.locationText}>{appointment.address}</Text>
                <Ionicons name="open-outline" size={16} color={theme.colors.primary} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.valueMuted}>—</Text>
            )}
          </DetailSection>

          <DetailSection label="Reference">
            <Text style={styles.value}>{appointment.reference || '—'}</Text>
          </DetailSection>

          <DetailSection label="Telecaller" last={!(centerName || appointment.centerId) && !appointment.notes}>
            <Text style={styles.value}>{appointment.telecaller || '—'}</Text>
          </DetailSection>

          {(centerName || appointment.centerId) ? (
            <DetailSection label="Center" last={!appointment.notes}>
              <Text style={styles.value}>{centerName || appointment.centerId || '—'}</Text>
            </DetailSection>
          ) : null}

          {appointment.notes ? (
            <DetailSection label="Remarks / Notes" last>
              <Text style={styles.value}>{appointment.notes}</Text>
            </DetailSection>
          ) : null}
        </View>

        {isScheduled && (
          <View style={styles.actions}>
            {showVisitServices ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.servicesOutlineButton]}
                onPress={onLogVisitServices}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Ionicons name="medical-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.servicesOutlineButtonText}>Log visit services</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.actionButton, styles.completeButton]}
              onPress={handleMarkCompleted}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>Mark Completed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton]}
              onPress={handleMarkCancelled}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={20} color={theme.colors.text} />
              <Text style={[styles.actionButtonText, styles.cancelButtonText]}>Mark Cancelled</Text>
            </TouchableOpacity>
          </View>
        )}

        {appointment.status === 'completed' && appointment.feedback ? (
          <View style={styles.feedbackCard}>
            <Text style={styles.sectionLabel}>Feedback</Text>
            <Text style={styles.value}>{appointment.feedback}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={showFeedbackModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Mark as Completed</Text>
            <Text style={styles.modalSubtitle}>Add feedback (optional)</Text>
            <TextInput
              style={styles.feedbackInput}
              placeholder="How did the visit go?"
              placeholderTextColor={theme.colors.textMuted}
              value={feedback}
              onChangeText={setFeedback}
              multiline
              numberOfLines={4}
              editable={!saving}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setShowFeedbackModal(false)}
                disabled={saving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSubmit}
                onPress={submitCompleted}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 16,
    minHeight: theme.touchTarget,
    gap: 6,
  },
  backText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 24,
    marginBottom: 20,
    ...theme.shadows.soft,
  },
  patientName: {
    fontSize: 26,
    fontWeight: '800',
    color: theme.colors.text,
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    gap: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  callButtonWrap: {
    marginBottom: 24,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    ...theme.shadows.glow,
  },
  callButtonDisabled: {
    backgroundColor: theme.colors.textMuted,
  },
  callButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    padding: 18,
    minHeight: theme.touchTarget + 8,
    justifyContent: 'center',
  },
  callButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  callIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  detailsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    marginBottom: 24,
    ...theme.shadows.soft,
  },
  section: {
    paddingVertical: 16,
  },
  sectionWithDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  sectionLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '600',
  },
  value: {
    fontSize: 16,
    color: theme.colors.text,
    lineHeight: 24,
  },
  valueMuted: {
    fontSize: 16,
    color: theme.colors.textMuted,
    lineHeight: 24,
  },
  dateTimeRow: {
    gap: 16,
  },
  dateTimeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: theme.touchTarget,
    paddingVertical: 4,
  },
  locationText: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  actions: {
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
    padding: 16,
    minHeight: theme.touchTarget,
    gap: 10,
  },
  completeButton: {
    backgroundColor: theme.colors.success,
    ...theme.shadows.soft,
  },
  cancelButton: {
    backgroundColor: theme.colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  servicesOutlineButton: {
    backgroundColor: theme.colors.background,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  servicesOutlineButtonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButtonText: {
    color: theme.colors.text,
  },
  feedbackCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    ...theme.shadows.soft,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 24,
    ...theme.shadows.medium,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 20,
  },
  feedbackInput: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.radius.md,
    padding: 16,
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalCancel: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: theme.touchTarget,
    justifyContent: 'center',
  },
  modalCancelText: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    fontWeight: '500',
  },
  modalSubmit: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    paddingHorizontal: 24,
    paddingVertical: 12,
    minWidth: 100,
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
