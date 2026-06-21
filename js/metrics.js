// metrics.js — pure functions that DERIVE all statuses and numbers from fleet data.
// Nothing here touches the DOM or the network, so it can be unit-tested in tests.html.
//
// Time model: the season window runs [May 1 00:00 ET, now). The window sits entirely
// inside US Eastern DAYLIGHT time (DST runs Mar–Nov), so the ET offset is a constant
// "-04:00" all season and we can build instants without a timezone library.
// ASSUMPTION: re-check this if the season ever spans a DST boundary (early March / Nov).

const DAY_MS = 24 * 60 * 60 * 1000;

// Build an epoch-ms instant for a date-only string at midnight in the season's ET offset.
export function etInstant(dateStr, offset) {
  return new Date(`${dateStr}T00:00:00${offset}`).getTime();
}

// Start of the season ("MM-DD" of the year that `now` falls in), as an epoch instant.
export function seasonStart(now, startMonthDay, offset) {
  const year = new Date(now).getFullYear();
  return etInstant(`${year}-${startMonthDay}`, offset);
}

// Convert one outage record into a half-open [start, end) instant interval, clamped to
// the window [windowStart, now). `end` is the INCLUSIVE last day down, so the vehicle is
// operational again the next day -> interval end is (end + 1 day). `end: null` = still
// down -> extends to `now`. Returns null if the clamped interval is empty.
export function outageInterval(outage, windowStart, now, offset) {
  const rawStart = etInstant(outage.start, offset);
  const rawEnd = outage.end === null || outage.end === undefined
    ? now
    : etInstant(outage.end, offset) + DAY_MS;
  const start = Math.max(rawStart, windowStart);
  const end = Math.min(rawEnd, now);
  return end > start ? { start, end } : null;
}

// Merge overlapping/adjacent intervals so downtime is never double-counted.
export function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

function totalLength(intervals) {
  return intervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
}

// All clamped, merged down-intervals for one vehicle.
export function vehicleDownIntervals(vehicleId, outages, windowStart, now, offset) {
  const ivs = outages
    .filter((o) => o.vehicleId === vehicleId)
    .map((o) => outageInterval(o, windowStart, now, offset))
    .filter(Boolean);
  return mergeIntervals(ivs);
}

// Does an outage cover a given instant, using its NATURAL interval (not clamped to now)?
// Closed outage -> [start, end+1day); open outage (end null) -> [start, +inf).
export function outageCovers(outage, instant, offset) {
  const start = etInstant(outage.start, offset);
  const end = outage.end === null || outage.end === undefined
    ? Infinity
    : etInstant(outage.end, offset) + DAY_MS;
  return start <= instant && instant < end;
}

// Is the vehicle down at instant `now`? Uses the natural interval so an ongoing outage
// (end: null) — whose clamped interval would end exactly at `now` — still reads as down.
export function isDownNow(vehicleId, outages, windowStart, now, offset) {
  return outages.some((o) => o.vehicleId === vehicleId && outageCovers(o, now, offset));
}

// Uptime % over the window. No window (0-length) or no outages handled gracefully.
export function uptimePct(vehicleId, outages, windowStart, now, offset) {
  const windowLen = now - windowStart;
  if (windowLen <= 0) return 100; // season just started: nothing has gone wrong yet
  const down = totalLength(vehicleDownIntervals(vehicleId, outages, windowStart, now, offset));
  return ((windowLen - down) / windowLen) * 100;
}

// --- Cart-fleet metrics (carts only; the motorcycle is excluded) ---

function carts(vehicles) {
  return vehicles.filter((v) => v.type === "cart");
}

// How many carts are operational right now: 0, 1, or 2 (or however many carts exist).
export function cartsAvailableNow(vehicles, outages, windowStart, now, offset) {
  const cs = carts(vehicles);
  const down = cs.filter((v) => isDownNow(v.id, outages, windowStart, now, offset)).length;
  return { up: cs.length - down, total: cs.length };
}

// Build a timeline of cart-up-count across the window by sweeping all cart down-interval
// edges. Returns { byLevel: {0: ms, 1: ms, 2: ms, ...}, segments: [{start,end,up}] }.
export function cartStrengthTimeline(vehicles, outages, windowStart, now, offset) {
  const cs = carts(vehicles);
  const total = cs.length;
  const byLevel = {};
  for (let i = 0; i <= total; i++) byLevel[i] = 0;
  const segments = [];
  const windowLen = now - windowStart;
  if (windowLen <= 0) return { byLevel, segments, total, windowLen: 0 };

  // collect boundary points
  const downByCart = cs.map((v) => vehicleDownIntervals(v.id, outages, windowStart, now, offset));
  const points = new Set([windowStart, now]);
  for (const ivs of downByCart) for (const iv of ivs) { points.add(iv.start); points.add(iv.end); }
  const sorted = [...points].sort((a, b) => a - b).filter((p) => p >= windowStart && p <= now);

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const mid = (start + end) / 2;
    const downCount = downByCart.filter((ivs) => ivs.some((iv) => iv.start <= mid && mid < iv.end)).length;
    const up = total - downCount;
    byLevel[up] += end - start;
    segments.push({ start, end, up });
  }
  return { byLevel, segments, total, windowLen };
}

// Days (fractional) the fleet has spent at each cart-up level, plus % shares.
export function cartStrengthShares(vehicles, outages, windowStart, now, offset) {
  const { byLevel, total, windowLen } = cartStrengthTimeline(vehicles, outages, windowStart, now, offset);
  const out = {};
  for (let i = 0; i <= total; i++) {
    const ms = byLevel[i] || 0;
    out[i] = { days: ms / DAY_MS, pct: windowLen > 0 ? (ms / windowLen) * 100 : 0 };
  }
  return out;
}

// Current live streak (in days) since the fleet last dropped below full cart strength.
// If it never dropped below full in the window, the streak is the whole season so far.
export function fullStrengthStreakDays(vehicles, outages, windowStart, now, offset) {
  const { segments, total } = cartStrengthTimeline(vehicles, outages, windowStart, now, offset);
  if (segments.length === 0) return 0;
  // walk backwards from now; streak continues while up === total
  let streakStart = now;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].up === total) {
      streakStart = segments[i].start;
    } else {
      break;
    }
  }
  return (now - streakStart) / DAY_MS;
}

// Leaderboard: ALL vehicles ranked by uptime % desc. Motorcycle included (tops it at 100%).
export function leaderboard(vehicles, outages, windowStart, now, offset) {
  return vehicles
    .map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      isBenchmark: v.type !== "cart",
      uptime: uptimePct(v.id, outages, windowStart, now, offset),
    }))
    .sort((a, b) => b.uptime - a.uptime);
}

// Longest single (merged) outage across all vehicles, clamped to the window.
export function longestOutage(vehicles, outages, windowStart, now, offset) {
  let best = null;
  for (const v of vehicles) {
    for (const iv of vehicleDownIntervals(v.id, outages, windowStart, now, offset)) {
      const days = (iv.end - iv.start) / DAY_MS;
      if (!best || days > best.days) best = { vehicleId: v.id, name: v.name, days };
    }
  }
  return best; // null if no outages
}

// Share of total CART downtime attributed to a given operator name (e.g. "Henry").
// Numerator: cart outage time where attributedTo === name (clamped). Denominator: total
// cart downtime. Returns { pct, downAttributedDays, totalDownDays }. Handles 0/0.
export function attributedDowntimeShare(name, vehicles, outages, windowStart, now, offset) {
  const cartIds = new Set(carts(vehicles).map((v) => v.id));
  let totalDown = 0;
  let attributed = 0;
  // total cart downtime = sum over carts of merged downtime (counts each cart separately)
  for (const id of cartIds) {
    totalDown += totalLength(vehicleDownIntervals(id, outages, windowStart, now, offset));
  }
  // attributed: only outages flagged attributedTo === name (clamped, merged within name)
  const flagged = outages.filter((o) => cartIds.has(o.vehicleId) && o.attributedTo === name);
  const ivs = flagged.map((o) => outageInterval(o, windowStart, now, offset)).filter(Boolean);
  attributed = totalLength(mergeIntervals(ivs));
  return {
    pct: totalDown > 0 ? (attributed / totalDown) * 100 : 0,
    downAttributedDays: attributed / DAY_MS,
    totalDownDays: totalDown / DAY_MS,
    hasDowntime: totalDown > 0,
  };
}

// --- Maintenance ---

// Compute next-due / overdue for a maintenance item. Day-based items compute against `now`;
// mileage-based items show a target and only flag overdue if a live `odometer` is provided.
export function maintenanceStatus(item, vehicle, now, offset) {
  if (item.intervalDays != null) {
    const last = etInstant(item.lastDone, offset);
    const nextDue = last + item.intervalDays * DAY_MS;
    return {
      kind: "days",
      nextDue,
      overdue: now > nextDue,
      label: new Date(nextDue).toISOString().slice(0, 10),
    };
  }
  if (item.intervalMiles != null) {
    const odo = vehicle.odometer;
    if (odo == null) {
      return { kind: "miles", overdue: false, label: `every ${item.intervalMiles} mi` };
    }
    // We don't know the odometer reading at lastDone, so we can't truly compute remaining
    // miles; show the interval as a target without a false overdue flag.
    return { kind: "miles", overdue: false, label: `every ${item.intervalMiles} mi` };
  }
  return { kind: "unknown", overdue: false, label: "—" };
}

export { DAY_MS };
