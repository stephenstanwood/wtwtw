import React, { useEffect, useMemo, useState } from "react";

// WTWTW — What To Watch This Week
// Mon–Fri: pick one event per night that overlaps 5–8pm PT,
// ranked: Steelers > Warriors > Valkyries > Cubs > Giants.

const PT_TZ = "America/Los_Angeles";

const PRIORITY = [
  { key: "steelers", label: "Steelers (NFL)", league: "football/nfl" },
  { key: "warriors", label: "Warriors (NBA)", league: "basketball/nba" },
  { key: "valkyries", label: "Valkyries (WNBA)", league: "basketball/wnba" },
  { key: "cubs", label: "Cubs (MLB)", league: "baseball/mlb" },
  { key: "giants", label: "Giants (MLB)", league: "baseball/mlb" },
];

function teamMatcher(priorityKey, league) {
  return (competitor) => {
    const name = (competitor?.team?.displayName || "").toLowerCase();
    const abbr = (competitor?.team?.abbreviation || "").toUpperCase();

    if (priorityKey === "steelers" && league.includes("football/nfl")) {
      return name.includes("steelers") || abbr === "PIT";
    }
    if (priorityKey === "warriors" && league.includes("basketball/nba")) {
      // ESPN abbreviations can be "GS" or "GSW" depending on endpoint
      return name.includes("warriors") || abbr === "GS" || abbr === "GSW";
    }
    if (priorityKey === "valkyries" && league.includes("basketball/wnba")) {
      return name.includes("valkyries") || name.includes("golden state valkyries");
    }
    if (priorityKey === "cubs" && league.includes("baseball/mlb")) {
      return name.includes("cubs") || abbr === "CHC";
    }
    if (priorityKey === "giants" && league.includes("baseball/mlb")) {
      return name.includes("giants") || abbr === "SF" || abbr === "SFG";
    }
    return false;
  };
}

function formatPT(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: PT_TZ,
  }).format(d);
}

// Assume 3h duration. Candidate if any overlap with 5–8pm PT.
function hitsWindowPT(isoStart) {
  const d = new Date(isoStart);
  const [hhStr, mmStr] = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .split(":");

  const startMin = parseInt(hhStr, 10) * 60 + parseInt(mmStr, 10);
  const endMin = startMin + 180; // +3h
  const windowStart = 17 * 60;   // 5:00 PM
  const windowEnd = 20 * 60;     // 8:00 PM (exclusive)
  return startMin < windowEnd && endMin > windowStart;
}

async function fetchScoreboard(leaguePath, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${leaguePath} ${yyyymmdd}`);
  return res.json();
}

function getUpcomingWeek(start = new Date()) {
  // Find Monday of the upcoming/current week in PT
  const ptWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    weekday: "short",
  }).format(start); // Sun..Sat
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(ptWeekday);

  // Calculate Monday of the current week if today is Mon..Fri, otherwise next Monday
  const base = new Date(start);
  const toMonday = (dow === 0 ? 1 : (1 - dow + 7) % 7); // if Sun -> +1, if Mon -> 0, etc.
  const monday = new Date(base);
  monday.setDate(base.getDate() + toMonday);

  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
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
  const candidates = [];
  for (const { leaguePath, event } of dayEvents) {
    const comps = event?.competitions?.[0]?.competitors || [];
    for (const pri of PRIORITY) {
      if (!leaguePath.includes(pri.league)) continue;
      const match = comps.some(teamMatcher(pri.key, leaguePath));
      if (match && hitsWindowPT(event.date)) {
        candidates.push({
          priorityIndex: PRIORITY.indexOf(pri),
          pri,
          leaguePath,
          event,
        });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.priorityIndex - b.priorityIndex ||
      new Date(a.event.date) - new Date(b.event.date)
  );
  return candidates[0];
}

export default function WTWTW() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picks, setPicks] = useState([]);

  const week = useMemo(() => getUpcomingWeek(new Date()), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const leaguePaths = [...new Set(PRIORITY.map((p) => p.league))];
        const results = [];
        for (const day of week) {
          const jsons = await Promise.all(
            leaguePaths.map((lp) =>
              fetchScoreboard(lp, day.yyyymmdd)
                .then((j) => ({ lp, j }))
                .catch(() => ({ lp, j: null }))
            )
          );
          const dayEvents = [];
          for (const { lp, j } of jsons) {
            const events = j?.events || [];
            for (const ev of events) dayEvents.push({ leaguePath: lp, event: ev });
          }
          results.push({ day, pick: pickEventForDay(dayEvents) });
        }
        if (alive) setPicks(results);
      } catch (e) {
        if (alive) setError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [week]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-3xl font-bold tracking-tight">
        WTWTW <span className="text-sm align-top">(What To Watch This Week)</span>
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        Mon–Fri, best event that overlaps the 5–8pm PT window (assumes 3h duration),
        ranked: Steelers ▶ Warriors ▶ Valkyries ▶ Cubs ▶ Giants.
      </p>

      {loading && (
        <div className="mt-6 animate-pulse rounded-2xl border p-4">Loading schedules…</div>
      )}
      {error && (
        <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-4">
        {picks.map(({ day, pick }) => (
          <div key={day.yyyymmdd} className="rounded-2xl border p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-500">{day.label}</div>
            {pick ? (
              <div className="mt-1">
                <div className="text-lg font-medium">{pick.event?.name || "Game"}</div>
                <div className="text-gray-700">Starts {formatPT(pick.event?.date)} PT</div>
                <div className="mt-1 text-xs text-gray-500">{pick.pri.label}</div>
              </div>
            ) : (
              <div className="mt-1 text-gray-700">
                No qualifying game in the 5–8pm PT window.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}