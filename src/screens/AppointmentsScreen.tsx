import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';

const TRACK_WIDTH = Dimensions.get('window').width - 40;
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import type { Appointment } from '../types';
import { theme } from '../theme';

type TabFilter = 'all' | 'today' | 'upcoming' | 'completed' | 'cancelled';

interface AppointmentsScreenProps {
  onAppointmentPress: (appointment: Appointment) => void;
  onLogout: () => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function parseStartToDate(start: any): Date | null {
  if (!start) return null;
  if (typeof start === 'string') {
    const d = new Date(start);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof start === 'object' && start !== null) {
    if (typeof (start as any).toDate === 'function') return (start as any).toDate();
    if (typeof (start as any).seconds === 'number') return new Date((start as any).seconds * 1000);
  }
  return null;
}

function isAppointmentToday(start: any): boolean {
  const d = parseStartToDate(start);
  if (!d) return false;
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

function getStartForDisplay(start: any): string {
  const d = parseStartToDate(start);
  return d ? d.toISOString() : '';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getStatusConfig(status?: string) {
  const s = (status || '').toLowerCase();
  switch (s) {
    case 'completed':
      return { bg: theme.colors.successBg, text: theme.colors.successText, dot: theme.colors.success };
    case 'cancelled':
      return { bg: theme.colors.errorBg, text: theme.colors.errorText, dot: theme.colors.error };
    default:
      return { bg: theme.colors.scheduledBg, text: theme.colors.scheduledText, dot: theme.colors.scheduled };
  }
}

interface GroupedSection {
  key: string;
  label: string;
  appointments: Appointment[];
}

function getDateLabel(start: any): string {
  const d = parseStartToDate(start);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function groupByDate(appointments: Appointment[]): GroupedSection[] {
  const byDate = new Map<string, Appointment[]>();
  for (const apt of appointments) {
    const label = getDateLabel(apt.start);
    if (!label) continue;
    const list = byDate.get(label) || [];
    list.push(apt);
    byDate.set(label, list);
  }
  const sorted = [...byDate.entries()].sort((a, b) => {
    const d1 = parseStartToDate(a[1][0]?.start);
    const d2 = parseStartToDate(b[1][0]?.start);
    if (!d1 || !d2) return 0;
    return d1.getTime() - d2.getTime();
  });
  return sorted.map(([label, apts]) => {
    apts.sort((a, b) => getStartForDisplay(a.start).localeCompare(getStartForDisplay(b.start)));
    return { key: label, label, appointments: apts };
  });
}

export default function AppointmentsScreen({ onAppointmentPress, onLogout }: AppointmentsScreenProps) {
  const { appointments, loading, error, isOnline, refresh } = useAppointmentsContext();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabFilter>('today');

  const filtered = useMemo(() => {
    const now = new Date();

    switch (activeTab) {
      case 'today':
        return appointments.filter((a) => isAppointmentToday(a.start));
      case 'upcoming':
        return appointments.filter((a) => {
          const d = parseStartToDate(a.start);
          return d && d > now && ((a.status || '').toLowerCase() === 'scheduled' || !a.status);
        });
      case 'completed':
        return appointments.filter((a) => (a.status || '').toLowerCase() === 'completed');
      case 'cancelled':
        return appointments.filter((a) => (a.status || '').toLowerCase() === 'cancelled');
      default:
        return appointments;
    }
  }, [appointments, activeTab]);

  // Today tab: single "Today" section. All/Upcoming/Completed/Cancelled: group by date.
  const grouped = useMemo(() => {
    if (activeTab === 'today') {
      const sorted = [...filtered].sort((a, b) => getStartForDisplay(a.start).localeCompare(getStartForDisplay(b.start)));
      return sorted.length > 0 ? [{ key: 'today', label: 'Today', appointments: sorted }] : [];
    }
    return groupByDate(filtered);
  }, [filtered, activeTab]);

  const todayAppointments = useMemo(() => appointments.filter((a) => isAppointmentToday(a.start)), [appointments]);

  const completedToday = useMemo(
    () => todayAppointments.filter((a) => (a.status || '').toLowerCase() === 'completed').length,
    [todayAppointments]
  );
  const totalToday = useMemo(
    () => todayAppointments.filter((a) => (a.status || '').toLowerCase() !== 'cancelled').length,
    [todayAppointments]
  );
  const progress = totalToday > 0 ? completedToday / totalToday : 0;
  const progressWidth = TRACK_WIDTH * progress;

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  };

  const isIndexError = error?.toLowerCase().includes('index') || error?.toLowerCase().includes('create_composite');
  const indexUrl = error?.match(/https:\/\/[^\s]+/)?.[0] || '';

  const handleCall = (item: Appointment, e: any) => {
    e?.stopPropagation?.();
    const phone = item.patientPhone?.replace(/\D/g, '') || '';
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  const handleMap = (item: Appointment, e: any) => {
    e?.stopPropagation?.();
    if (item.address) Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(item.address)}`);
  };

  const renderCard = (item: Appointment) => {
    const statusConfig = getStatusConfig(item.status);
    const isHomeVisit = item.type === 'home';
    const centerLabel = item.centerName || item.centerId || 'Center';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => onAppointmentPress(item)}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.patientName || item.title || 'Patient'}
            </Text>
            <View style={[styles.visitTypeBadge, isHomeVisit ? styles.visitTypeHome : styles.visitTypeCenter]}>
              <Ionicons name={isHomeVisit ? 'home' : 'business'} size={12} color="#fff" />
              <Text style={styles.visitTypeText}>{isHomeVisit ? 'Home' : 'Center'}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusConfig.dot }]} />
            <Text style={[styles.statusText, { color: statusConfig.text }]}>
              {item.status || 'scheduled'}
            </Text>
          </View>
        </View>

        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={theme.colors.textMuted} style={styles.metaIcon} />
            <Text style={styles.cardMetaText}>{formatTime(getStartForDisplay(item.start))}</Text>
          </View>
          {isHomeVisit && item.address ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={14} color={theme.colors.textMuted} style={styles.metaIcon} />
              <Text style={styles.cardMetaText} numberOfLines={1}>{item.address}</Text>
            </View>
          ) : null}
          {item.centerId || item.centerName ? (
            <View style={styles.metaRow}>
              <Ionicons name="business-outline" size={14} color={theme.colors.textMuted} style={styles.metaIcon} />
              <Text style={styles.cardMetaText} numberOfLines={1}>{centerLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={(e) => handleCall(item, e)}
            disabled={!item.patientPhone}
          >
            <Ionicons name="call" size={18} color={item.patientPhone ? theme.colors.primary : theme.colors.textMuted} />
          </TouchableOpacity>
          {isHomeVisit && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={(e) => handleMap(item, e)}
              disabled={!item.address}
            >
              <Ionicons name="navigate" size={18} color={item.address ? theme.colors.primary : theme.colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSection = ({ item: section }: { item: GroupedSection }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{section.label}</Text>
      {section.appointments.map((apt) => (
        <View key={apt.id} style={styles.cardWrap}>
          {renderCard(apt)}
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.title}>My Appointments</Text>
          </View>
          <View style={styles.headerRight}>
            {!isOnline && (
              <View style={styles.offlineBadge}>
                <Ionicons name="cloud-offline" size={16} color={theme.colors.warningText} />
                <Text style={styles.offlineText}>Offline</Text>
              </View>
            )}
            <TouchableOpacity onPress={onLogout} style={styles.logoutBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Daily Progress Bar */}
        {totalToday > 0 && (
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Daily Progress</Text>
              <Text style={styles.progressCount}>
                {completedToday} of {totalToday} completed
              </Text>
            </View>
            <View style={[styles.progressTrack, { width: TRACK_WIDTH }]}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>
        )}

        {/* Segmented tabs */}
        <View style={styles.segmentedContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>
            {isIndexError
              ? 'The database is still setting up. Please wait a minute and pull down to refresh.'
              : 'Please check your connection and try again.'}
          </Text>
          {isIndexError && indexUrl ? (
            <TouchableOpacity style={styles.indexLinkBtn} onPress={() => Linking.openURL(indexUrl)}>
              <Text style={styles.indexLinkText}>Create index (if needed)</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : loading && appointments.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="calendar-outline" size={48} color={theme.colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No appointments</Text>
          <Text style={styles.emptyText}>
            {activeTab === 'all'
              ? "You don't have any home visit appointments yet."
              : `No ${activeTab} appointments.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => item.key}
          renderItem={renderSection}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  headerBar: {
    backgroundColor: theme.colors.background,
    paddingBottom: 0,
    ...theme.shadows.soft,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  greeting: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    marginBottom: 2,
    fontWeight: '500',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: -0.5,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.warningBg,
  },
  offlineText: {
    fontSize: 12,
    color: theme.colors.warningText,
    fontWeight: '600',
  },
  logoutBtn: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    minHeight: theme.touchTarget,
    justifyContent: 'center',
  },
  logoutText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  progressSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  progressCount: {
    fontSize: 13,
    color: theme.colors.successText,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.backgroundTertiary,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.success,
    borderRadius: 3,
  },
  segmentedContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  tabsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.backgroundTertiary,
    borderRadius: theme.radius.md,
    padding: 4,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    minHeight: theme.touchTarget - 4,
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: theme.colors.background,
    ...theme.shadows.soft,
  },
  tabText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: theme.colors.text,
    fontWeight: '700',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginLeft: 4,
  },
  cardWrap: {
    marginBottom: 12,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    ...theme.shadows.soft,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardName: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  visitTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  visitTypeHome: {
    backgroundColor: theme.colors.teal,
  },
  visitTypeCenter: {
    backgroundColor: theme.colors.primary,
  },
  visitTypeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'uppercase',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radius.full,
    gap: 6,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  cardMeta: {
    gap: 6,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaIcon: {
    marginRight: 6,
  },
  cardMetaText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    flex: 1,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  quickActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  errorTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  indexLinkBtn: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: theme.colors.primaryLight,
    borderRadius: theme.radius.md,
    minHeight: theme.touchTarget,
    justifyContent: 'center',
  },
  indexLinkText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
