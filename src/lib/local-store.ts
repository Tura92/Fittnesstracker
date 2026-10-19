/**
 * Speicher im Browser (IndexedDB) für das Training ohne Netz.
 *
 * Jede Änderung an einer Einheit landet sofort hier und gilt damit als gespeichert.
 * Geänderte Einheiten sind "dirty" und werden bei Empfang als Ganzes an /api/sync
 * geschickt. Dazu kommt ein Abzug von Übungen, Plan und letzten Werten (Snapshot),
 * damit auch ein neues Training offline starten kann.
 */
import type { OfflineSnapshot, WorkoutDTO } from "./types";

type WorkoutRecord = { id: string; doc: WorkoutDTO; dirty: boolean; updatedAt: number };

export type SyncStatus = {
  /** Einheiten bzw. Änderungen, die noch nicht auf dem Server sind */
  pending: number;
  syncing: boolean;
  online: boolean;
  error: string | null;
  lastSyncedAt: number | null;
};

const DB_NAME = "fittnesstracker";
const SYNC_DELAY_MS = 1500;
const RETRY_MS = 30_000;
/** Abgeglichene Einheiten bleiben so lange lokal, danach reicht der Server */
const KEEP_CLEAN_DAYS = 21;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("workouts", { keyPath: "id" });
      req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function store(name: "workouts" | "kv", mode: IDBTransactionMode = "readonly") {
  const tx = (await openDb()).transaction(name, mode);
  return { os: tx.objectStore(name), tx };
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const { os } = await store("kv");
  return done(os.get(key)) as Promise<T | undefined>;
}

/** Liest und schreibt einen Wert in einer Transaktion, damit sich zwei Tabs nicht überschreiben */
async function kvUpdate<T>(key: string, fn: (current: T | undefined) => T): Promise<void> {
  const { os, tx } = await store("kv", "readwrite");
  const current = (await done(os.get(key))) as T | undefined;
  os.put(fn(current), key);
  await finished(tx);
}

// ---------- Status für die Anzeige ----------

let status: SyncStatus = {
  pending: 0,
  syncing: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  error: null,
  lastSyncedAt: null,
};
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export function subscribeStatus(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getStatus() {
  return status;
}

const SERVER_STATUS: SyncStatus = { pending: 0, syncing: false, online: true, error: null, lastSyncedAt: null };
export function getServerStatus() {
  return SERVER_STATUS;
}

async function refreshPending() {
  const records = await listWorkouts();
  const deleted = (await kvGet<string[]>("deleted")) ?? [];
  const rest = (await kvGet<Record<number, number>>("rest")) ?? {};
  setStatus({ pending: records.filter((r) => r.dirty).length + deleted.length + Object.keys(rest).length });
}

// ---------- Einheiten ----------

export async function listWorkouts(): Promise<WorkoutRecord[]> {
  const { os } = await store("workouts");
  return done(os.getAll()) as Promise<WorkoutRecord[]>;
}

export async function getWorkout(id: string): Promise<WorkoutRecord | undefined> {
  const { os } = await store("workouts");
  return done(os.get(id)) as Promise<WorkoutRecord | undefined>;
}

/** Speichert eine Änderung lokal und stößt den Abgleich an */
export async function saveWorkout(doc: WorkoutDTO): Promise<void> {
  const { os, tx } = await store("workouts", "readwrite");
  os.put({ id: doc.id, doc, dirty: true, updatedAt: Date.now() } satisfies WorkoutRecord);
  await finished(tx);
  await refreshPending();
  scheduleSync();
}

/** Stand vom Server übernehmen, außer lokal liegen noch nicht abgeglichene Änderungen */
export async function cacheServerWorkout(doc: WorkoutDTO): Promise<WorkoutDTO> {
  const { os, tx } = await store("workouts", "readwrite");
  const existing = (await done(os.get(doc.id))) as WorkoutRecord | undefined;
  if (existing?.dirty) return existing.doc;
  os.put({ id: doc.id, doc, dirty: false, updatedAt: Date.now() } satisfies WorkoutRecord);
  await finished(tx);
  return doc;
}

export async function deleteWorkout(id: string): Promise<void> {
  const { os, tx } = await store("workouts", "readwrite");
  os.delete(id);
  await finished(tx);
  await kvUpdate<string[]>("deleted", (list = []) => [...new Set([...list, id])]);
  await refreshPending();
  scheduleSync();
}

// ---------- Übungen, Plan, letzte Werte ----------

export async function getSnapshot(): Promise<OfflineSnapshot | undefined> {
  return kvGet<OfflineSnapshot>("snapshot");
}

export async function refreshSnapshot(): Promise<OfflineSnapshot | undefined> {
  try {
    const res = await fetch("/api/offline", { cache: "no-store" });
    if (!res.ok) return getSnapshot();
    const snapshot = (await res.json()) as OfflineSnapshot;
    // Noch nicht abgeglichene Pausenzeiten nicht vom älteren Serverstand überschreiben lassen
    const rest = (await kvGet<Record<number, number>>("rest")) ?? {};
    for (const e of snapshot.exercises) if (rest[e.id] !== undefined) e.restSeconds = rest[e.id];
    await kvUpdate("snapshot", () => snapshot);
    return snapshot;
  } catch {
    return getSnapshot();
  }
}

/** Pausenzeit einer Übung als Voreinstellung merken, wird mit dem nächsten Abgleich gespeichert */
export async function saveExerciseRest(exerciseId: number, seconds: number): Promise<void> {
  await kvUpdate<Record<number, number>>("rest", (rest = {}) => ({ ...rest, [exerciseId]: seconds }));
  await kvUpdate<OfflineSnapshot | undefined>("snapshot", (s) =>
    s && { ...s, exercises: s.exercises.map((e) => (e.id === exerciseId ? { ...e, restSeconds: seconds } : e)) },
  );
  await refreshPending();
  scheduleSync();
}

// ---------- Abgleich ----------

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;

export function scheduleSync(delay = SYNC_DELAY_MS) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, delay);
}

export function syncNow(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  if (!navigator.onLine) {
    setStatus({ online: false });
    await refreshPending();
    return;
  }
  const records = (await listWorkouts()).filter((r) => r.dirty);
  const deleted = (await kvGet<string[]>("deleted")) ?? [];
  const rest = (await kvGet<Record<number, number>>("rest")) ?? {};
  if (records.length === 0 && deleted.length === 0 && Object.keys(rest).length === 0) {
    setStatus({ online: true, error: null });
    return;
  }

  setStatus({ syncing: true });
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workouts: records.map((r) => r.doc),
        deletedWorkouts: deleted,
        exerciseRest: Object.entries(rest).map(([exerciseId, seconds]) => ({ exerciseId: Number(exerciseId), seconds })),
      }),
    });
    if (res.status === 401) throw new Error("Bitte neu anmelden, dann wird abgeglichen.");
    if (!res.ok) throw new Error(`Abgleich fehlgeschlagen (${res.status}).`);

    // Nur als abgeglichen markieren, was sich seit dem Senden nicht mehr geändert hat
    const { os, tx } = await store("workouts", "readwrite");
    for (const sent of records) {
      const current = (await done(os.get(sent.id))) as WorkoutRecord | undefined;
      if (current && current.updatedAt === sent.updatedAt) os.put({ ...current, dirty: false });
    }
    await finished(tx);
    await kvUpdate<string[]>("deleted", (list = []) => list.filter((id) => !deleted.includes(id)));
    await kvUpdate<Record<number, number>>("rest", (current = {}) => {
      const next = { ...current };
      for (const [id, seconds] of Object.entries(rest)) if (next[Number(id)] === seconds) delete next[Number(id)];
      return next;
    });
    setStatus({ online: true, error: null, lastSyncedAt: Date.now() });
    await pruneOld();
    void refreshSnapshot();
  } catch (err) {
    setStatus({ error: err instanceof Error && err.message.startsWith("Bitte") ? err.message : null });
    scheduleSync(RETRY_MS);
  } finally {
    setStatus({ syncing: false });
    await refreshPending();
  }
}

async function pruneOld() {
  const cutoff = new Date(Date.now() - KEEP_CLEAN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { os, tx } = await store("workouts", "readwrite");
  const all = (await done(os.getAll())) as WorkoutRecord[];
  for (const r of all) if (!r.dirty && r.doc.date < cutoff) os.delete(r.id);
  await finished(tx);
}

let started = false;

/** Einmal pro Seite: Abgleich bei Start, bei wiederkehrendem Netz und wenn die App wieder sichtbar wird */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => {
    setStatus({ online: true });
    void syncNow();
  });
  window.addEventListener("offline", () => setStatus({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  void refreshPending();
  void syncNow().then(() => refreshSnapshot());
  // Mit Netz die aktuelle App-Version für offline sichern lassen (siehe public/sw.js)
  if (navigator.onLine && "serviceWorker" in navigator) {
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "precache" }));
  }
}
