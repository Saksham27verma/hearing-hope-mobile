import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import type { Appointment } from '../types';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import {
  getAppointmentsCache,
  setAppointmentsCache,
  addPendingSync,
} from '../services/offlineStorage';
import { processPendingSync } from '../services/syncEngine';

interface AppointmentsContextValue {
  appointments: Appointment[];
  loading: boolean;
  error: string | null;
  isOnline: boolean;
  refresh: () => void;
  updateAppointmentOptimistic: (id: string, patch: Partial<Appointment>) => void;
  markCompletedOffline: (id: string, feedback?: string) => void;
  markCancelledOffline: (id: string) => void;
}

const AppointmentsContext = createContext<AppointmentsContextValue | null>(null);

export function AppointmentsProvider({ children }: { children: React.ReactNode }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useNetworkStatus();
  const uid = auth.currentUser?.uid;
  const optimisticPatches = React.useRef<Map<string, Partial<Appointment>>>(new Map());

  const updateAppointmentOptimistic = useCallback((id: string, patch: Partial<Appointment>) => {
    optimisticPatches.current.set(id, { ...optimisticPatches.current.get(id), ...patch });
    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
      setAppointmentsCache(next, uid);
      return next;
    });
  }, [uid]);

  const markCompletedOffline = useCallback((id: string, feedback?: string) => {
    updateAppointmentOptimistic(id, { status: 'completed', feedback: feedback || '' });
    addPendingSync({
      type: 'complete',
      appointmentId: id,
      payload: { status: 'completed', feedback: feedback || '' },
    });
  }, [updateAppointmentOptimistic]);

  const markCancelledOffline = useCallback((id: string) => {
    updateAppointmentOptimistic(id, { status: 'cancelled' });
    addPendingSync({
      type: 'cancel',
      appointmentId: id,
      payload: { status: 'cancelled' },
    });
  }, [updateAppointmentOptimistic]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
  }, []);

  // Stale-While-Revalidate: load from cache first
  // Single query: all home + center appointments, then filter client-side
  useEffect(() => {
    if (!uid) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    let hasReceivedSnapshot = false;

    getAppointmentsCache(uid).then((cached) => {
      if (mounted && !hasReceivedSnapshot && cached && cached.length > 0) {
        setAppointments(cached);
      }
      if (mounted && !hasReceivedSnapshot) setLoading(false);
    });

    const q = query(
      collection(db, 'appointments'),
      where('type', 'in', ['home', 'center']),
      orderBy('start', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        if (!mounted) return;
        hasReceivedSnapshot = true;
        let list: Appointment[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Appointment[];
        // Filter: home visits assigned to this staff; center visits assigned to this staff only
        list = list.filter(
          (a) =>
            (a.type === 'home' && a.homeVisitorStaffId === uid) ||
            (a.type === 'center' && a.assignedStaffId === uid)
        );
        list.sort((a, b) => {
          const toStr = (s: any) => {
            if (!s) return '';
            if (typeof s === 'string') return s;
            if (s?.toDate) return s.toDate().toISOString();
            if (typeof s?.seconds === 'number') return new Date(s.seconds * 1000).toISOString();
            return '';
          };
          return toStr(a.start).localeCompare(toStr(b.start));
        });

        // Resolve center names when centerId is set but centerName is missing (center + home visits)
        const needCenterName = list.filter((a) => a.centerId && !a.centerName);
        if (needCenterName.length > 0) {
          const centersSnap = await getDocs(collection(db, 'centers'));
          const centerById: Record<string, string> = {};
          centersSnap.docs.forEach((d) => {
            const name = (d.data() as { name?: string })?.name;
            if (name) centerById[d.id] = name;
          });
          needCenterName.forEach((a) => {
            if (a.centerId && centerById[a.centerId]) {
              a.centerName = centerById[a.centerId];
            }
          });
        }

        if (mounted) {
          // Merge optimistic updates so Firestore snapshot doesn't overwrite user's immediate changes
          const patches = optimisticPatches.current;
          if (patches.size > 0) {
            list = list.map((a) => {
              const patch = patches.get(a.id);
              if (patch) {
                const merged = { ...a, ...patch };
                if (patch.status && a.status === patch.status) patches.delete(a.id);
                return merged;
              }
              return a;
            });
          }
          setAppointments(list);
          setLoading(false);
          setError(null);
          setAppointmentsCache(list, uid);
        }
      },
      (err) => {
        if (!mounted) return;
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [uid]);

  // Process pending sync when coming back online
  useEffect(() => {
    if (!isOnline) return;

    processPendingSync().then(() => {
      // Sync complete - Firebase listener will update data
    });
  }, [isOnline]);

  const value: AppointmentsContextValue = {
    appointments,
    loading,
    error,
    isOnline,
    refresh,
    updateAppointmentOptimistic,
    markCompletedOffline,
    markCancelledOffline,
  };

  return (
    <AppointmentsContext.Provider value={value}>
      {children}
    </AppointmentsContext.Provider>
  );
}

export function useAppointmentsContext() {
  const ctx = useContext(AppointmentsContext);
  if (!ctx) throw new Error('useAppointmentsContext must be used within AppointmentsProvider');
  return ctx;
}
