import React, { useEffect, useMemo, useState } from "react";

// WTWTW (What To Watch This Week)
// Single-file React component. No API keys. Uses ESPN public scoreboards.
// Drop this into any React/Vite app, or use as the default export in a Next.js page.
// Tailwind optional but styles assume Tailwind exists; feel free to remove classes.

// ---- Configuration ----
const PT_TZ = "America/Los_Angeles"; // Stephen's timezone

// Priority list (highest first)
const PRIORITY = [
  { key: "steelers", label: "Steelers (NFL)", league: "football/nfl" },
  { key: "warriors", label: "Warriors (NBA)", league: "basketball/nba" },
  { key: "valkyries", label: "Valkyries (WNBA)", league: "basketball/wnba" },
  { key: "cubs", label: "Cubs (MLB)", league: "baseball/mlb" },
  { key: "giants", label: "Giants (MLB)", league: "baseball/mlb" },
];

// Team matchers per priority key
function teamMatcher(priorityKey, league) {
  return (competitor) => {
    const name = competitor?.team?.displayName?.toLowerCase?.() || "";
    const abbr = competitor?.team?.abbreviation?.toUpperCase?.() || "";
    if (priorityKey === "steelers" && league.includes("football/nfl")) {
      return name.includes("steelers") || abbr === "PIT";
    }
    if (priorityKey === "warriors" && league.includes("basketball/nba")) {
      return name.includes("warriors") || abbr === "GS";
    }
    if (priorityKey === "valkyries" && league.includes("basketball/wnba")) {
      return name.includes("valkyries") || name.includes("golden state valkyries");
    }
    if (priorityKey === "cubs" && league.includes("baseball/mlb")) {
      return name.includes("cubs") || abbr === "CHC";
    }
    if (priorityKey === "giants" && league.includes("baseball/mlb")) {
      // MLB Giants — ensure MLB context to avoid NYG (NFL)
      return name.includes("giants") || abbr === "SF" || abbr === "SFG";
    }
    return false;
  };
}

function formatPT(iso) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: PT_TZ,
  });
  return f.format(d);
}

function hitsWindowPT(isoStart) {
  // Treat every event as 3 hours long and check overlap with 5–8 PM PT
  const start = new Date(isoStart);
  // PT start hour/minute
  const hm = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(start)
    .split(":")
    .map((n) => parseInt(n, 10));
  const startMin = hm[0] * 60 + hm[1];
  const endMin = startMin + 180; // +3 hours
  const windowStart = 17 * 60; // 5:00 PM
  const windowEnd = 20 * 60;   // 8:00 PM (exclusive)
  // Overlap if the event starts before window end AND ends after window start
  return startMin < windowEnd && endMin > windowStart;
}).format(d).replace(/(\d{2})\/(\d{2})\/(\d{4}),\s(\d{2}):(\d{2})/, "$3-$1-$2T$4:$5:00Z")
  );
  const hour = pt.getUTCHours();
  // The above hack aligns to PT clock before reading hours; simpler: just compute PT hour directly:
  const ptHour = new Intl.DateTimeFormat("en-US", { timeZone: PT_TZ, hour: "2-digit", hour12: false }).format(d);
  const h = parseInt(ptHour, 10);
  return h >= 17 && h < 20; // 5:00 PM inclusive to before 8:00 PM
}

async function fetchScoreboard(leaguePath, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${leaguePath} ${yyyymmdd}`);
  return res.json();
}

function getUpcomingWeek(start = new Date()) {
  // Return all days from *today* (in PT) through *Saturday* (in PT)
  const pt = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(start);
  // Extract weekday by reformatting separately (safer than parsing the above string)
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: PT_TZ, weekday: "short" }).format(start); // Sun..Sat
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);

  // Build dates from today .. Saturday inclusive
  const days = [];
  for (let i = 0; i < 7 - dow; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push({
      label: d.toLocaleDateString("en-US", { weekday: "long" }),
      yyyymmdd: `${yyyy}${mm}${dd}`,
      date: d,
    });
  }
  return days;
}

function pickEventForDay(dayEvents) {
  // dayEvents: array of {leaguePath, event}
  // Choose highest-priority team with start 5–8pm PT
  const candidates = [];
  for (const { leaguePath, event } of dayEvents) {
    const comps = event?.competitions?.[0]?.competitors || [];
    for (const pri of PRIORITY) {
      if (!leaguePath.includes(pri.league)) continue;
      const match = comps.some(teamMatcher(pri.key, leaguePath));
      if (match && hitsWindowPT(event.date)) {
        candidates.push({ priorityIndex: PRIORITY.indexOf(pri), pri, leaguePath, event });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priorityIndex - b.priorityIndex || new Date(a.event.date) - new Date(b.event.date));
  return candidates[0];
}

export default function WTWTW() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picks, setPicks] = useState([]); // [{day, pick}]

  const week = useMemo(() => getUpcomingWeek(new Date()), []);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true); setError(null);
      try {
        const leaguePaths = [...new Set(PRIORITY.map(p => p.league))];
        // For each day, fetch each league scoreboard (in parallel) and filter
        const resultsByDay = [];
        for (const day of week) {
          const jsons = await Promise.all(
            leaguePaths.map(lp => fetchScoreboard(lp, day.yyyymmdd).then(j => ({ lp, j })).catch(() => ({ lp, j: null })))
          );
          const dayEvents = [];
          for (const { lp, j } of jsons) {
            const events = j?.events || [];
            for (const ev of events) {
              dayEvents.push({ leaguePath: lp, event: ev });
            }
          }
          const pick = pickEventForDay(dayEvents);
          resultsByDay.push({ day, pick });
        }
        if (alive) setPicks(resultsByDay);
      } catch (e) {
        if (alive) setError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => { alive = false; };
  }, [week]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-3xl font-bold tracking-tight">WTWTW <span className="text-sm align-top">(What To Watch This Week)</span></h1>
      <p className=\"mt-2 text-sm text-gray-600\">Best event that overlaps the 5–8pm PT window (assumes 3h duration), ranked: Steelers ▶ Warriors ▶ Valkyries ▶ Cubs ▶ Giants. Shows days from today through Saturday.<\/p>

      {loading && (
        <div className="mt-6 animate-pulse rounded-2xl border p-4">Loading schedules…</div>
      )}
      {error && (
        <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>
      )}

      <div className="mt-6 grid gap-4">
        {picks.map(({ day, pick }) => (
          <div key={day.yyyymmdd} className="rounded-2xl border p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-500">{day.label}</div>
            {pick ? (
              <div className="mt-1">
                <div className="text-lg font-medium">
                  {pick.event?.name || "Game"}
                </div>
                <div className="text-gray-700">
                  Starts {formatPT(pick.event?.date)} PT
                </div>
                <div className="mt-1 text-xs text-gray-500">{pick.pri.label}</div>
              </div>
            ) : (
              <div className="mt-1 text-gray-700">No qualifying game in the 5–8pm PT window.</div>
            )}
          </div>
        ))}
      </div>

      <details className="mt-8 text-sm text-gray-600">
        <summary className="cursor-pointer select-none">How it works</summary>
        <ul className="ml-5 list-disc space-y-1 pt-2">
          <li>Queries ESPN scoreboards for NFL, NBA, WNBA, and MLB for each day Mon–Fri.</li>
          <li>Filters games that overlap the 5–8pm PT window (assumes 3h duration) and involve your teams.</li>
          <li>Chooses the highest-ranked team if multiple overlap; earliest start wins ties.</li>
        </ul>
      </details>
    </div>
  );
}
