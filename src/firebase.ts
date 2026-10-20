import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDocs,
  getDoc,
  Timestamp
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Ariza, AppConfig, PlantSettings, Intervention } from './types';

// Skill error handling format
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Connect to default Firestore database where real collections (arizalar, settings, ayarlar) exist
export const db = getFirestore(app);

/**
 * Subscribe to all 'arizalar' documents with real-time updates
 */
/**
 * Subscribe to all 'arizalar' documents with real-time updates and change detection
 */
export function subscribeToArizalar(
  onData: (arizalar: Ariza[], newlyAddedItems?: Ariza[]) => void,
  onError?: (err: any) => void
) {
  let isInitialLoad = true;
  const colRef = collection(db, 'arizalar');

  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: Ariza[] = [];
      const newItems: Ariza[] = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const opName = data.startedBy || data.assignedTo || data.lastInterventionBy || '';
        items.push({
          id: docSnap.id,
          machine: data.machine || 'Bilinmeyen Makine',
          jobType: data.jobType || 'Mekanik Arıza',
          costCenter: data.costCenter || '',
          shift: data.shift || '',
          status: data.status || 'Açık',
          description: data.description || '',
          userName: data.userName || '',
          photoUrl: data.photoUrl || '',
          photoUploadStatus: data.photoUploadStatus || '',
          partsChanged: data.partsChanged || '',
          actionTaken: data.actionTaken || '',
          resolvedData: data.resolvedData || null,
          createdAt: data.createdAt,
          startedBy: data.startedBy || '',
          assignedTo: data.assignedTo || '',
          startedAt: data.startedAt || '',
          lastInterventionBy: opName,
          lastInterventionAt: data.lastInterventionAt || data.startedAt || '',
          interventions: Array.isArray(data.interventions) ? data.interventions : [],
          pausedOperators: Array.isArray(data.pausedOperators) ? data.pausedOperators : [],
          helpers: Array.isArray(data.helpers) ? data.helpers : [],
        });
      });

      // Detect newly arriving jobs after initial boot
      if (!isInitialLoad) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const opName = data.startedBy || data.assignedTo || data.lastInterventionBy || '';
            newItems.push({
              id: change.doc.id,
              machine: data.machine || 'Yeni Makine',
              jobType: data.jobType || 'Mekanik Arıza',
              costCenter: data.costCenter || '',
              shift: data.shift || '',
              status: data.status || 'Açık',
              description: data.description || '',
              userName: data.userName || '',
              photoUrl: data.photoUrl || '',
              photoUploadStatus: data.photoUploadStatus || '',
              partsChanged: data.partsChanged || '',
              actionTaken: data.actionTaken || '',
              resolvedData: data.resolvedData || null,
              createdAt: data.createdAt,
              startedBy: data.startedBy || '',
              assignedTo: data.assignedTo || '',
              startedAt: data.startedAt || '',
              lastInterventionBy: opName,
              lastInterventionAt: data.lastInterventionAt || data.startedAt || '',
              interventions: Array.isArray(data.interventions) ? data.interventions : [],
              pausedOperators: Array.isArray(data.pausedOperators) ? data.pausedOperators : [],
              helpers: Array.isArray(data.helpers) ? data.helpers : [],
            });
          }
        });
      }

      isInitialLoad = false;
      onData(items, newItems);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'arizalar');
      if (onError) onError(error);
    }
  );
}

/**
 * Direct fetch all 'arizalar' documents (for manual refresh / ping)
 */
export async function fetchAllArizalarDirect(): Promise<Ariza[]> {
  try {
    const colRef = collection(db, 'arizalar');
    const snapshot = await getDocs(colRef);
    const items: Ariza[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const opName = data.startedBy || data.assignedTo || data.lastInterventionBy || '';
      items.push({
        id: docSnap.id,
        machine: data.machine || 'Bilinmeyen Makine',
        jobType: data.jobType || 'Mekanik Arıza',
        costCenter: data.costCenter || '',
        shift: data.shift || '',
        status: data.status || 'Açık',
        description: data.description || '',
        userName: data.userName || '',
        photoUrl: data.photoUrl || '',
        photoUploadStatus: data.photoUploadStatus || '',
        partsChanged: data.partsChanged || '',
        actionTaken: data.actionTaken || '',
        resolvedData: data.resolvedData || null,
        createdAt: data.createdAt,
        startedBy: data.startedBy || '',
        assignedTo: data.assignedTo || '',
        startedAt: data.startedAt || '',
        lastInterventionBy: opName,
        lastInterventionAt: data.lastInterventionAt || data.startedAt || '',
        interventions: Array.isArray(data.interventions) ? data.interventions : [],
        pausedOperators: Array.isArray(data.pausedOperators) ? data.pausedOperators : [],
        helpers: Array.isArray(data.helpers) ? data.helpers : [],
      });
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'arizalar');
    throw error;
  }
}

/**
 * Subscribe to settings/config (operators, reasons)
 */
export function subscribeToConfig(onData: (config: AppConfig) => void) {
  const docRef = doc(db, 'settings', 'config');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        onData({
          operators: Array.isArray(data.operators) ? data.operators : [],
          stoppageReasons: Array.isArray(data.stoppageReasons) ? data.stoppageReasons : [],
          faultReasons: Array.isArray(data.faultReasons) ? data.faultReasons : [],
          rootCauses: Array.isArray(data.rootCauses) ? data.rootCauses : [],
        });
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/config');
    }
  );
}

/**
 * Fetch machines & shifts from ayarlar collection
 */
export async function fetchPlantSettings(): Promise<PlantSettings> {
  const result: PlantSettings = {
    machines: [],
    operators: [],
    shifts: [],
  };

  try {
    const machinesSnap = await getDoc(doc(db, 'ayarlar', 'machines'));
    if (machinesSnap.exists() && Array.isArray(machinesSnap.data().list)) {
      result.machines = machinesSnap.data().list;
    }

    const shiftsSnap = await getDoc(doc(db, 'ayarlar', 'shifts'));
    if (shiftsSnap.exists() && Array.isArray(shiftsSnap.data().list)) {
      result.shifts = shiftsSnap.data().list;
    }

    const opsSnap = await getDoc(doc(db, 'ayarlar', 'operators'));
    if (opsSnap.exists() && Array.isArray(opsSnap.data().list)) {
      result.operators = opsSnap.data().list;
    }

    const syncSnap = await getDoc(doc(db, 'ayarlar', 'syncSettings'));
    if (syncSnap.exists()) {
      result.syncSettings = syncSnap.data() as any;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'ayarlar');
  }

  return result;
}

/**
 * Update Ariza Status & Interventions
 */
export async function updateArizaIntervention(
  arizaId: string,
  newStatus: string,
  operatorName: string,
  role: string = 'Ana Bakımcı',
  logAction: string = 'DURUM GÜNCELLENDİ',
  actionTakenText: string = '',
  partsChangedText: string = '',
  existingInterventions: Intervention[] = []
) {
  const nowIso = new Date().toISOString();
  const newIntervention: Intervention = {
    timestamp: nowIso,
    operator: operatorName,
    role,
    status: newStatus,
    logAction,
    actionTaken: actionTakenText,
    durationMin: 1,
    helpers: [],
  };

  const updatedInterventions = [...existingInterventions, newIntervention];

  const updatePayload: Record<string, any> = {
    status: newStatus,
    lastInterventionBy: operatorName,
    lastInterventionAt: nowIso,
    interventions: updatedInterventions,
  };

  if (actionTakenText) {
    updatePayload.actionTaken = actionTakenText;
  }
  if (partsChangedText) {
    updatePayload.partsChanged = partsChangedText;
  }
  if (newStatus.toLowerCase().includes('müdahale') || newStatus.toLowerCase().includes('mudahale')) {
    updatePayload.status = 'Müdahale Ediliyor';
    updatePayload.startedBy = operatorName;
    updatePayload.assignedTo = operatorName;
    updatePayload.startedAt = nowIso;
  }
  if (newStatus === 'Tamamlandı' || newStatus === 'Çözüldü') {
    updatePayload.resolvedData = {
      resolvedAt: nowIso,
      resolvedBy: operatorName,
      actionTaken: actionTakenText,
    };
  }

  try {
    const docRef = doc(db, 'arizalar', arizaId);
    await updateDoc(docRef, updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `arizalar/${arizaId}`);
    throw err;
  }
}

/**
 * Create a new Ariza record
 */
export async function createAriza(payload: {
  machine: string;
  jobType: string;
  costCenter: string;
  shift: string;
  userName: string;
  description: string;
  photoUrl?: string;
}) {
  try {
    const colRef = collection(db, 'arizalar');
    const docData = {
      ...payload,
      status: 'Açık',
      photoUploadStatus: payload.photoUrl ? 'Var' : 'Yok',
      createdAt: serverTimestamp(),
      interventions: [],
      partsChanged: '-',
      actionTaken: '',
      resolvedData: null,
      helpers: [],
      pausedOperators: [],
    };
    const res = await addDoc(colRef, docData);
    return res.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'arizalar');
    throw err;
  }
}
