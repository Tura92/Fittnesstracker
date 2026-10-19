"use client";

import { createContext, use, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { savePushSubscription, startRestTimer, stopRestTimer } from "@/app/timer-actions";
import { formatDuration } from "@/lib/format";
import { saveExerciseRest } from "@/lib/local-store";

type Timer = {
  endsAt: number;
  duration: number;
  label: string;
  exerciseId: number | null;
  /** Gespeicherte Voreinstellung der Übung, um Änderungen zu erkennen */
  preset: number;
  done: boolean;
};

type RestTimerContext = {
  timer: Timer | null;
  /** Restzeit in Sekunden */
  remaining: number;
  start: (seconds: number, label: string, exerciseId: number | null) => void;
  adjust: (delta: number) => void;
  stop: () => void;
  saveAsPreset: () => void;
  /** Pausenzeit einer Übung, mit in dieser Sitzung gespeicherten Änderungen */
  restFor: (exerciseId: number, fallback: number) => number;
};

const Ctx = createContext<RestTimerContext | null>(null);
const STORAGE_KEY = "ft-rest-timer";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function useRestTimer() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useRestTimer braucht den RestTimerProvider");
  return ctx;
}

// Der Timer lebt im Speicher. localStorage ist nur die Kopie, damit er Neuladen
// übersteht; ist es gesperrt (z. B. Cookies blockiert), läuft er trotzdem.
let current: Timer | null = null;
let restored = false;
const listeners = new Set<() => void>();

function readTimer(): Timer | null {
  if (!restored) {
    restored = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      current = raw ? (JSON.parse(raw) as Timer) : null;
    } catch {
      current = null;
    }
  }
  return current;
}

function writeTimer(timer: Timer | null) {
  restored = true;
  current = timer;
  try {
    if (timer) localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ohne Speicher übersteht der Timer nur kein Neuladen
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drei kurze Töne über Web Audio. Der AudioContext muss in einem Tipp entstanden sein. */
function beep(ctx: AudioContext | null) {
  if (!ctx) return;
  ctx.resume().catch(() => undefined);
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ctx.destination);
    const t = ctx.currentTime + i * 0.35;
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const timer = useSyncExternalStore(subscribe, readTimer, () => null);
  // 0 bis zum ersten Tick; Date.now() beim Rendern würde das Prerendering blockieren
  const [now, setNow] = useState(0);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const audio = useRef<AudioContext | null>(null);
  const reschedule = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
  }, []);

  const running = timer !== null && !timer.done;
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const current = readTimer();
      // Ablauf: Ton und Vibration, solange die App offen ist. Bei gesperrtem Handy übernimmt der Push.
      if (current && !current.done && t >= current.endsAt) {
        writeTimer({ ...current, done: true });
        if (document.visibilityState === "visible") {
          beep(audio.current);
          navigator.vibrate?.([400, 200, 400, 200, 400]);
        }
      }
    };
    const id = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running]);

  const start = useCallback(
    (seconds: number, label: string, exerciseId: number | null) => {
      // Im Tipp erzeugen, sonst blockiert iOS den Ton später
      audio.current ??= new AudioContext();
      audio.current.resume().catch(() => undefined);
      writeTimer({ endsAt: Date.now() + seconds * 1000, duration: seconds, label, exerciseId, preset: seconds, done: false });
      setNow(Date.now());
      startRestTimer(seconds, label).catch(() => undefined);
    },
    [],
  );

  const adjust = (delta: number) => {
    if (!timer || timer.done) return;
    const remaining = Math.ceil((timer.endsAt - Date.now()) / 1000) + delta;
    if (remaining < 1) return;
    writeTimer({ ...timer, endsAt: timer.endsAt + delta * 1000, duration: Math.max(5, timer.duration + delta) });
    // Server-Timer erst nach dem letzten Tipp neu stellen
    if (reschedule.current) clearTimeout(reschedule.current);
    reschedule.current = setTimeout(() => startRestTimer(remaining, timer.label).catch(() => undefined), 800);
  };

  const stop = () => {
    if (reschedule.current) clearTimeout(reschedule.current);
    if (timer && !timer.done) stopRestTimer().catch(() => undefined);
    writeTimer(null);
  };

  const saveAsPreset = () => {
    if (!timer?.exerciseId) return;
    const { exerciseId, duration } = timer;
    setOverrides((o) => ({ ...o, [exerciseId]: duration }));
    writeTimer({ ...timer, preset: duration });
    saveExerciseRest(exerciseId, duration).catch(() => undefined);
  };

  const restFor = useCallback((exerciseId: number, fallback: number) => overrides[exerciseId] ?? fallback, [overrides]);

  const remaining = !timer ? 0 : now === 0 ? timer.duration : Math.max(0, Math.ceil((timer.endsAt - now) / 1000));

  return <Ctx value={{ timer, remaining, start, adjust, stop, saveAsPreset, restFor }}>{children}</Ctx>;
}

/**
 * Pause-Button einer Übung. Läuft ihr Timer, zählt der Button selbst herunter,
 * leuchtet in der Akzentfarbe und zeigt darunter die Bedienung.
 */
export function RestTimerButton({ exerciseId, label, fallback }: { exerciseId: number; label: string; fallback: number }) {
  const { timer, remaining, start, stop, restFor } = useRestTimer();
  const seconds = restFor(exerciseId, fallback);
  const mine = timer?.exerciseId === exerciseId ? timer : null;

  if (mine?.done) {
    return (
      <button
        type="button"
        onClick={stop}
        role="timer"
        aria-live="assertive"
        className="h-11 shrink-0 animate-pulse rounded-xl bg-accent px-3 text-sm font-semibold text-white dark:text-zinc-950"
      >
        Vorbei ✓
      </button>
    );
  }
  if (mine) {
    const progress = Math.min(100, (remaining / Math.max(1, mine.duration)) * 100);
    return (
      <button
        type="button"
        onClick={stop}
        role="timer"
        aria-label={`Pause läuft, noch ${formatDuration(remaining)}. Tippen zum Stoppen`}
        className="relative h-11 shrink-0 overflow-hidden rounded-xl border-2 border-accent bg-accent-soft px-3 text-base font-semibold text-accent tabular-nums"
        // Füllstand zeigt die verbleibende Pause
        style={{
          backgroundImage: `linear-gradient(to right, color-mix(in srgb, var(--accent) 25%, transparent) ${progress}%, transparent ${progress}%)`,
        }}
      >
        ⏱ {formatDuration(remaining)}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => start(seconds, label, exerciseId)}
      aria-label={`Pause ${formatDuration(seconds)} starten`}
      className="h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-medium tabular-nums"
    >
      Pause {formatDuration(seconds)}
    </button>
  );
}

/** Feinjustierung unter den Buttons, solange der Timer dieser Übung läuft. */
export function RestTimerControls({ exerciseId, label }: { exerciseId: number; label: string }) {
  const { timer, adjust, stop, saveAsPreset } = useRestTimer();
  if (!timer || timer.done || timer.exerciseId !== exerciseId) return null;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={() => adjust(-15)} className="h-10 flex-1 rounded-xl border border-border text-sm">
          −15 s
        </button>
        <button type="button" onClick={() => adjust(15)} className="h-10 flex-1 rounded-xl border border-border text-sm">
          +15 s
        </button>
        <button type="button" onClick={stop} className="h-10 flex-1 rounded-xl border border-border text-sm text-muted">
          Stopp
        </button>
      </div>
      {timer.duration !== timer.preset && (
        <button type="button" onClick={saveAsPreset} className="text-sm text-accent">
          {formatDuration(timer.duration)} als Pause für {label} merken
        </button>
      )}
    </div>
  );
}

/**
 * Kleine Anzeige im Kopf des Trainings, damit die laufende Pause sichtbar bleibt,
 * wenn ihre Übung aus dem Bild gescrollt ist. Tippen springt zur Übung.
 */
export function HeaderTimer() {
  const { timer, remaining } = useRestTimer();
  if (!timer) return null;
  const jump = () => {
    if (timer.exerciseId === null) return;
    document.getElementById(`exercise-${timer.exerciseId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <button
      type="button"
      onClick={jump}
      aria-label={`Pause ${timer.label}: ${timer.done ? "vorbei" : `noch ${formatDuration(remaining)}`}. Zur Übung springen`}
      className={`h-7 rounded-full px-2.5 text-xs font-semibold tabular-nums ${
        timer.done ? "animate-pulse bg-accent text-white dark:text-zinc-950" : "bg-accent-soft text-accent"
      }`}
    >
      {timer.done ? "Pause vorbei" : `⏱ ${formatDuration(remaining)}`}
    </button>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type PushState = "unsupported" | "install" | "ask" | "denied" | "on";

/** Hinweis bzw. Schalter, damit der Alarm auch bei gesperrtem Display ankommt. */
export function PushSetup() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = async () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (!VAPID_PUBLIC_KEY) return setState("unsupported");
      if (ios && !standalone) return setState("install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState("unsupported");
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(Notification.permission === "granted" && sub ? "on" : "ask");
    };
    check();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "ask");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));
      await savePushSubscription(JSON.parse(JSON.stringify(sub)));
      setState("on");
    } catch {
      setState("ask");
    } finally {
      setBusy(false);
    }
  };

  if (state === null || state === "unsupported" || state === "on") return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
      {state === "install" && (
        <p>
          Damit der Pausen-Alarm auch bei gesperrtem Display kommt: In Safari auf <b>Teilen</b> und{" "}
          <b>Zum Home-Bildschirm</b> tippen und die App von dort öffnen.
        </p>
      )}
      {state === "denied" && (
        <p>Benachrichtigungen sind blockiert. Erlaube sie in den Einstellungen, damit der Pausen-Alarm auch bei gesperrtem Display kommt.</p>
      )}
      {state === "ask" && (
        <div className="flex items-center gap-3">
          <p className="flex-1">Pausen-Alarm auch bei gesperrtem Display?</p>
          <button
            type="button"
            disabled={busy}
            onClick={enable}
            className="h-10 shrink-0 rounded-xl bg-accent px-3 font-semibold text-white disabled:opacity-60 dark:text-zinc-950"
          >
            Erlauben
          </button>
        </div>
      )}
    </div>
  );
}
