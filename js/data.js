// data.js — fetch and validate the one human-editable data file (data/fleet.json).
// A hand-edit typo should surface as a clear on-page banner, never a silently blank page.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class DataError extends Error {}

function req(obj, key, where) {
  if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
    throw new DataError(`${where} is missing required field "${key}"`);
  }
  return obj[key];
}

function validDate(value, where) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00-04:00`))) {
    throw new DataError(`${where}: "${value}" is not a valid YYYY-MM-DD date`);
  }
}

// Validate the parsed structure. Throws DataError with a human-readable message.
export function validateFleet(data) {
  if (!data || typeof data !== "object") throw new DataError("fleet.json is not an object");

  const season = req(data, "season", "season");
  req(season, "startMonthDay", "season");
  req(season, "etOffset", "season");

  if (!Array.isArray(data.vehicles)) throw new DataError("vehicles must be an array");
  if (!Array.isArray(data.outages)) throw new DataError("outages must be an array");

  const ids = new Set();
  for (const v of data.vehicles) {
    const where = `vehicle "${v.id || "?"}"`;
    req(v, "id", where);
    if (ids.has(v.id)) throw new DataError(`duplicate vehicle id "${v.id}"`);
    ids.add(v.id);
    req(v, "name", where);
    const type = req(v, "type", where);
    if (type !== "cart" && type !== "motorcycle") {
      throw new DataError(`${where}: type must be "cart" or "motorcycle" (got "${type}")`);
    }
    if (!Array.isArray(v.photos) || v.photos.length === 0) {
      throw new DataError(`${where}: needs at least one photo (the hero)`);
    }
    for (const p of v.photos) {
      req(p, "file", `${where} photo`);
    }
    for (const m of v.maintenance || []) {
      req(m, "task", `${where} maintenance`);
      validDate(req(m, "lastDone", `${where} maintenance "${m.task}"`), `${where} maintenance "${m.task}" lastDone`);
      if (m.intervalDays == null && m.intervalMiles == null) {
        throw new DataError(`${where} maintenance "${m.task}": needs intervalDays or intervalMiles`);
      }
    }
  }

  for (const o of data.outages) {
    const where = `outage for "${o.vehicleId || "?"}"`;
    const vid = req(o, "vehicleId", where);
    if (!ids.has(vid)) throw new DataError(`${where}: no vehicle with id "${vid}"`);
    validDate(req(o, "start", where), `${where} start`);
    if (o.end !== null && o.end !== undefined) validDate(o.end, `${where} end`);
    req(o, "cause", where);
    if (o.photo) req(o.photo, "file", `${where} photo`); // optional repair photo
  }
  return data;
}

// Fetch + parse + validate. Resolves to the validated data, or rejects with DataError.
export async function loadFleet(url = "data/fleet.json") {
  let res;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch (e) {
    throw new DataError(`could not load ${url} (are you serving over http, not file://?)`);
  }
  if (!res.ok) throw new DataError(`could not load ${url} (HTTP ${res.status})`);
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new DataError(`${url} is not valid JSON: ${e.message}`);
  }
  return validateFleet(json);
}

// Render a friendly error banner at the top of the page instead of a blank screen.
export function showDataError(err) {
  const div = document.createElement("div");
  div.setAttribute("role", "alert");
  div.style.cssText =
    "background:#b00020;color:#fff;padding:1rem;font:600 16px/1.5 system-ui,sans-serif;";
  div.textContent = `⚠️ Fleet data problem: ${err.message}`;
  document.body.prepend(div);
  // eslint-disable-next-line no-console
  console.error(err);
}

export { DataError };
