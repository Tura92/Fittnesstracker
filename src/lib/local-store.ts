/**
 * Speicher im Browser (IndexedDB) für das Training ohne Netz.
 *
 * Jede Änderung an einer Einheit landet sofort hier und gilt damit als gespeichert.
 * Geänderte Einheiten sind "dirty" und werden bei Empfang als Ganzes an /api/sync
 * geschickt; der Server führt sie mit dem Stand anderer Geräte zusammen. Entfernte
 * Übungen und Sätze werden dafür ausdrücklich als gelöscht mitgeschickt. Dazu kommt ein Abzug von Übungen, Plan und letzten Werten (Snapshot),
 * damit auch ein neues Training offline starten kann.
 *
 * Jedes Konto hat auf dem Gerät eine eigene Datenbank. Nach einem Kontowechsel sieht man
 * so nie die Einheiten des anderen, und dessen noch nicht abgeglichene Änderungen bleiben
 * liegen, bis er sich wieder anmeldet.
 */
import type { OfflineSnapshot, WorkoutDTO } from "./types";

type WorkoutRecord = {
  id: string;
  doc: WorkoutDTO;
  dirty: boolean;
  updatedAt: number;
  /** Seit dem letzten Abgleich entfernte Übungen und Sätze */
  deletedEntries?: string[];
  deletedSets?: string[];
};

export type SyncStatus = {
  /** Einheiten bzw. Änderungen, die noch nicht auf dem Server sind */
  pending: number;
  syncing: boolean;
  online: boolean;
  error: string | null;
  lastSyncedAt: number | null;
};

/** Konto 1 übernimmt die Datenbank aus der Zeit vor den Konten */
const dbName = (userId: number) => (userId === 1 ? "fittnesstracker" : `fittnesstracker-u${userId}`);
const USER_KEY = "ft-user";
/** Wie in public/sw.js: gespeicherte Seiten enthalten die Daten des Kontos, das sie geladen hat */
const PAGE_CACHE = "pages-v1";
const SYNC_DELAY_MS = 1500;
const RETRY_MS = 30_000;
/** Abgeglichene Einheiten bleiben so lange lokal, danach reicht der Server */
const KEEP_CLEAN_DAYS = 21;

// ---------- Konto ----------

function readStoredUser(): number | null {
  try {
    const n = Number(localStorage.getItem(USER_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

let userId: number | null = typeof window === "undefined" ? null : readStoredUser();
let userKnown: Promise<number>;
let resolveUser: ((id: number) => void) | null = null;

function waitForUser() {
  userKnown = new Promise((resolve) => {
    resolveUser = resolve;
  });
}
if (userId === null) waitForUser();
else userKnown = Promise.resolve(userId);

async function clearPageCache() {
  if (typeof caches !== "undefined") await caches.delete(PAGE_CACHE).catch(() => undefined);
}

function closeDb() {
  void dbPromise?.then((db) => db.close()).catch(() => undefined);
  dbPromise = null;
}

/**
 * Wer angemeldet ist, kommt vom Server (Layout, Anmeldung, Abzug). Wechselt das Konto,
 * gilt ab sofort dessen Datenbank, und die gespeicherten Seiten des vorigen werden verworfen.
 */
export function setLocalUser(id: number) {
  if (id === userId) return;
  const switched = userId !== null;
  userId = id;
  try {
    localStorage.setItem(USER_KEY, String(id));
  } catch {
    // ohne localStorage kommt das Konto beim nächsten Laden wieder vom Server
  }
  closeDb();
  if (resolveUser) {
    resolveUser(id);
    resolveUser = null;
  } else {
    userKnown = Promise.resolve(id);
  }
  if (switched) {
    void clearPageCache();
    setStatus({ pending: 0, error: null, lastSyncedAt: null });
    void refreshPending().then(() => syncNow());
  }
}

/** Nach Anmeldung: gespeicherte Seiten könnten von einem anderen Konto stammen, also neu laden lassen */
export async function signedIn(id: number) {
  await clearPageCache();
  setLocalUser(id);
}

/** Beim Abmelden: Gerät gehört keinem Konto mehr, gespeicherte Seiten weg. Die Daten bleiben für die nächste Anmeldung. */
export async function forgetLocalUser() {
  userId = null;
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // egal
  }
  closeDb();
  waitForUser();
  await clearPageCache();
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function openDb(): Promise<IDBDatabase> {
  const id = await userKnown;
  if (id !== userId) return openDb();
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(id), 1);
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

/** Neuesten Stand einer Einheit vom Server holen; null ohne Netz oder bei Fehlern */
export async function fetchServerWorkout(id: string): Promise<WorkoutDTO | null | "missing"> {
  try {
    const res = await fetch(`/api/workout/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return "missing";
    return res.ok ? ((await res.json()) as WorkoutDTO) : null;
  } catch {
    return null;
  }
}

export async function getWorkout(id: string): Promise<WorkoutRecord | undefined> {
  const { os } = await store("workouts");
  return done(os.get(id)) as Promise<WorkoutRecord | undefined>;
}

/** Speichert eine Änderung lokal und stößt den Abgleich an */
export async function saveWorkout(doc: WorkoutDTO): Promise<void> {
  const { os, tx } = await store("workouts", "readwrite");
  const previous = (await done(os.get(doc.id))) as WorkoutRecord | undefined;
  // Was gegenüber dem gespeicherten Stand fehlt, wurde auf diesem Gerät gelöscht
  const entryIds = new Set(doc.entries.map((e) => e.id));
  const setIds = new Set(doc.entries.flatMap((e) => e.sets.map((x) => x.id)));
  const oldEntries = previous?.doc.entries ?? [];
  const deletedEntries = oldEntries.map((e) => e.id).filter((id) => !entryIds.has(id));
  const deletedSets = oldEntries.flatMap((e) => e.sets.map((x) => x.id)).filter((id) => !setIds.has(id));
  os.put({
    id: doc.id,
    doc,
    dirty: true,
    updatedAt: Date.now(),
    deletedEntries: [...new Set([...(previous?.deletedEntries ?? []), ...deletedEntries])],
    deletedSets: [...new Set([...(previous?.deletedSets ?? []), ...deletedSets])],
  } satisfies WorkoutRecord);
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
    // Inzwischen ist ein anderes Konto angemeldet: dessen Speicher nehmen statt hier zu mischen
    if (snapshot.userId !== undefined && snapshot.userId !== userId) {
      setLocalUser(snapshot.userId);
      return refreshSnapshot();
    }
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
  const owner = await userKnown;
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
        userId: owner,
        workouts: records.map((r) => ({
          ...r.doc,
          deletedEntries: r.deletedEntries ?? [],
          deletedSets: r.deletedSets ?? [],
        })),
        deletedWorkouts: deleted,
        exerciseRest: Object.entries(rest).map(([exerciseId, seconds]) => ({ exerciseId: Number(exerciseId), seconds })),
      }),
    });
    if (res.status === 401) throw new Error("Bitte neu anmelden, dann wird abgeglichen.");
    if (res.status === 409) throw new Error("Bitte mit dem Konto anmelden, mit dem trainiert wurde.");
    if (!res.ok) throw new Error(`Abgleich fehlgeschlagen (${res.status}).`);
    // Während des Sendens wurde das Konto gewechselt; die Antwort betrifft dessen Speicher nicht
    if (owner !== userId) return;

    // Nur als abgeglichen markieren, was sich seit dem Senden nicht mehr geändert hat
    const { os, tx } = await store("workouts", "readwrite");
    for (const sent of records) {
      const current = (await done(os.get(sent.id))) as WorkoutRecord | undefined;
      if (!current) continue;
      const sentEntries = new Set(sent.deletedEntries);
      const sentSets = new Set(sent.deletedSets);
      os.put({
        ...current,
        dirty: current.updatedAt !== sent.updatedAt,
        deletedEntries: (current.deletedEntries ?? []).filter((id) => !sentEntries.has(id)),
        deletedSets: (current.deletedSets ?? []).filter((id) => !sentSets.has(id)),
      });
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

/**
 * Einmalig: Bis zur Version mit Zusammenführen hat jedes Gerät seine Einheit beim Abgleich
 * ganz ersetzt, Handy und PC konnten so auseinanderlaufen. Alle lokalen Kopien einmal
 * hochladen, damit der Server die Sätze beider Geräte vereint.
 */
async function markAllForMerge() {
  if (await kvGet<boolean>("mergedV1")) return refreshPending();
  const { os, tx } = await store("workouts", "readwrite");
  for (const r of (await done(os.getAll())) as WorkoutRecord[]) os.put({ ...r, dirty: true, updatedAt: Date.now() });
  await finished(tx);
  await kvUpdate("mergedV1", () => true);
  await refreshPending();
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
  void markAllForMerge().then(() => syncNow()).then(() => refreshSnapshot());
  // Mit Netz die aktuelle App-Version für offline sichern lassen (siehe public/sw.js)
  if (navigator.onLine && "serviceWorker" in navigator) {
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "precache" }));
  }
}
