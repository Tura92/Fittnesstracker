# Fittnesstracker

Mobile Web-App als Ersatz für das Excel-Trainingslogbuch: Training eintragen, Logbuch und Trainingsplan ansehen. Auswertung und KI-Chat folgen.

**Stack:** Next.js 16 (App Router, Server Actions), Tailwind CSS 4, Drizzle ORM, Postgres (Supabase) bzw. lokal PGlite.

## Lokal starten

```bash
npm install
npm run import -- pfad/zu/Trainings-Logbuch-v6.xlsx   # einmalig, füllt die lokale Datenbank
npm run dev
```

Ohne `DATABASE_URL` legt die App eine lokale PGlite-Datenbank in `./.data` an und migriert sie selbst. PGlite verträgt nur einen Prozess gleichzeitig: Den Dev-Server beenden, bevor du `npm run import` laufen lässt.

`npm run import -- <datei> --replace` überschreibt vorhandene Daten.

## Online stellen (Vercel + Supabase)

1. Bei [Vercel](https://vercel.com) mit dem GitHub-Konto anmelden, *Add New → Project* wählen und das Repo `Fittnesstracker` importieren. Unter *Environment Variables* `APP_PASSWORD` mit deinem Wunschpasswort anlegen, dann *Deploy*. Der erste Deploy zeigt noch einen Fehler, weil die Datenbank fehlt.
2. Im Vercel-Projekt unter *Storage* eine Supabase-Datenbank anlegen und mit dem Projekt verbinden. Vercel setzt dabei `POSTGRES_URL` und `POSTGRES_URL_NON_POOLING`; die App liest beide.
3. Unter *Deployments* den letzten Deploy *Redeploy*en. Der Build legt dabei die Tabellen an (`npm run build` wendet die Migrationen an, sobald eine Datenbank-URL gesetzt ist).
4. Die Vercel-URL öffnen, anmelden und unter `/import` (Startseite: *Excel-Logbuch importieren*) die Excel-Datei hochladen.
5. Auf dem Handy über *Teilen → Zum Home-Bildschirm* als App ablegen.

Statt der Vercel-Integration geht auch ein eigenes Supabase-Projekt: dessen Connection String (*Transaction pooler*) als `DATABASE_URL` setzen.

Ohne `APP_PASSWORD` zeigt die App auf Vercel nur einen Hinweis statt deiner Daten.

## Pausen-Timer

Jede Übung hat einen Pause-Button. Die Dauer kommt aus dem Plan (bei Bereichen wie „2–3 min“ das obere Ende) und lässt sich während der Pause mit ±15 s anpassen und als Voreinstellung der Übung merken. Der Countdown läuft im Button selbst; scrollt die Übung aus dem Bild, zeigt der Kopf des Trainings die Restzeit, ein Tipp darauf springt zurück.

Solange die App offen ist, piept und vibriert sie beim Ablauf. Damit der Alarm auch bei gesperrtem Display kommt, schickt der Server eine Push-Benachrichtigung. Den Zeitpunkt dafür hält [Upstash QStash](https://upstash.com/docs/qstash) (kostenlose Stufe reicht): Beim Start des Timers wird dort eine verzögerte Nachricht an `/api/rest-timer` eingeplant, die beim Stoppen oder Ändern wieder gelöscht wird.

Einrichten:

1. `npx web-push generate-vapid-keys` ausführen und die Schlüssel als `NEXT_PUBLIC_VAPID_PUBLIC_KEY` und `VAPID_PRIVATE_KEY` setzen.
2. Bei Upstash ein QStash-Konto anlegen und `QSTASH_TOKEN`, `QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY` und `QSTASH_NEXT_SIGNING_KEY` übernehmen.
3. Nach dem Deploy die App auf dem Handy öffnen (iPhone: erst *Zum Home-Bildschirm*, dann von dort starten) und im Training auf **Erlauben** tippen.

## Datenmodell

| Tabelle | Inhalt |
| --- | --- |
| `exercises` | Übung mit Hauptmuskel (zählt 1,0), bis zu zwei Nebenmuskeln (je 0,5) und eigener Pausenzeit |
| `plan_days`, `plan_items` | Trainingsplan: Tag 1–5 mit Übungen, Sätzen, Wdh.-Bereich, RIR, Pause |
| `workouts` | Eine Einheit: Datum, Block, Plantag |
| `entries` | Eine Übung in einer Einheit, mit RIR des letzten Satzes und Notiz. `set_count` hält die reine Satzzahl, wenn nur die bekannt ist (Block 1). |
| `sets` | Jeder Satz einzeln: Wiederholungen und Gewicht. Keine Grenze von sechs Sätzen mehr. |
| `body_weights` | Körpergewicht pro Tag |
| `push_subscriptions` | Geräte, auf denen Benachrichtigungen erlaubt sind |
| `rest_timers` | Eingeplante Pausen-Alarme, damit nur der aktuelle klingelt |

Schema ändern: `src/db/schema.ts` anpassen, dann `npm run db:generate` und die neue Datei in `drizzle/` committen.
