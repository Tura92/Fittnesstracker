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

## Online stellen (Supabase + Vercel)

1. Bei [Supabase](https://supabase.com) ein Projekt anlegen. Unter *Connect* den Connection String des **Transaction poolers** kopieren.
2. Lokal mit dieser URL Tabellen anlegen und Excel-Daten importieren:
   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
   DATABASE_URL="postgresql://..." npm run import -- Trainings-Logbuch-v6.xlsx
   ```
3. Bei [Vercel](https://vercel.com) das GitHub-Repo importieren und die Umgebungsvariablen `DATABASE_URL` und `APP_PASSWORD` setzen.
4. Die Vercel-URL auf dem Handy öffnen, anmelden und über *Teilen → Zum Home-Bildschirm* als App ablegen.

## Datenmodell

| Tabelle | Inhalt |
| --- | --- |
| `exercises` | Übung mit Hauptmuskel (zählt 1,0) und bis zu zwei Nebenmuskeln (je 0,5) |
| `plan_days`, `plan_items` | Trainingsplan: Tag 1–5 mit Übungen, Sätzen, Wdh.-Bereich, RIR, Pause |
| `workouts` | Eine Einheit: Datum, Block, Plantag |
| `entries` | Eine Übung in einer Einheit, mit RIR des letzten Satzes und Notiz. `set_count` hält die reine Satzzahl, wenn nur die bekannt ist (Block 1). |
| `sets` | Jeder Satz einzeln: Wiederholungen und Gewicht. Keine Grenze von sechs Sätzen mehr. |
| `body_weights` | Körpergewicht pro Tag |

Schema ändern: `src/db/schema.ts` anpassen, dann `npm run db:generate` und die neue Datei in `drizzle/` committen.
