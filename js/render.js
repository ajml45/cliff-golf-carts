// render.js — turns validated fleet data + derived metrics into DOM. Imported by both
// index.html (renderHome) and vehicle.html (renderVehicle). All jokes live here; all
// numbers come from metrics.js so the copy stays funny and the figures stay accurate.

import * as M from "./metrics.js";

const DAY_MS = M.DAY_MS;

// ---- formatting helpers ----
const pct = (x) => `${x.toFixed(1)}%`;
const wholeDays = (x) => Math.floor(x + 1e-9);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function fmtDate(dateStr, offset) {
  const d = new Date(`${dateStr}T12:00:00${offset}`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "America/New_York",
  }).format(d);
}

// inclusive whole-day length of an outage as written (for the log), ongoing -> to today
function outageDays(o, offset, now) {
  const start = M.etInstant(o.start, offset);
  const end = o.end == null ? now : M.etInstant(o.end, offset) + DAY_MS;
  return Math.max(1, Math.round((end - start) / DAY_MS));
}

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// ---- jokes ----
// Banner copy keyed to how many of the two carts are operational right now.
function bannerCopy(up, total) {
  if (total === 2 && up === 2) {
    return {
      mood: "good",
      head: "Both carts are alive.",
      sub: "Full cart strength. Statistically this will not last, so enjoy it while it does.",
    };
  }
  if (total === 2 && up === 1) {
    return {
      mood: "warn",
      head: "One cart standing.",
      sub: "The fleet is at half-mast. Carpool accordingly and lower your expectations.",
    };
  }
  if (total === 2 && up === 0) {
    return {
      mood: "down",
      head: "Zero carts operational.",
      sub: "Our deepest condolences. The estate is now on foot. Please hold your loved ones close.",
    };
  }
  // generic fallback (defensive — fleet is two carts)
  return {
    mood: up === total ? "good" : up === 0 ? "down" : "warn",
    head: `${up} of ${total} carts operational.`,
    sub: "",
  };
}

// ---- shared compute ----
function setup(data) {
  const offset = data.season.etOffset;
  const now = Date.now();
  const windowStart = M.seasonStart(now, data.season.startMonthDay, offset);
  return { offset, now, windowStart };
}

function vehicleById(data, id) {
  return data.vehicles.find((v) => v.id === id);
}

function pictureFor(photo, className) {
  // <picture> requests NAME.webp with NAME.jpg fallback. 3:2 box + object-fit:cover in CSS.
  const fig = el("figure", { class: className || "media" });
  const pic = el("picture");
  pic.append(el("source", { type: "image/webp", srcset: `images/${photo.file}.webp` }));
  const img = el("img", {
    src: `images/${photo.file}.jpg`,
    alt: photo.alt && photo.alt !== "TBD" ? photo.alt : "",
    loading: "lazy",
    width: "1600",
    height: "1067",
  });
  // Until the real photo is dropped in, show a tidy "photo coming soon" box rather than
  // the browser's broken-image icon.
  img.addEventListener("error", () => {
    fig.classList.add("media--missing");
    fig.dataset.placeholder = `📷 ${photo.file} — photo coming soon`;
  });
  pic.append(img);
  fig.append(pic);
  if (photo.caption && photo.caption !== "TBD") {
    fig.append(el("figcaption", {}, photo.caption));
  }
  return fig;
}

// ================= HOME =================
export function renderHome(data, root) {
  const { offset, now, windowStart } = setup(data);

  const avail = M.cartsAvailableNow(data.vehicles, data.outages, windowStart, now, offset);
  const copy = bannerCopy(avail.up, avail.total);
  const shares = M.cartStrengthShares(data.vehicles, data.outages, windowStart, now, offset);
  const streak = M.fullStrengthStreakDays(data.vehicles, data.outages, windowStart, now, offset);
  const longest = M.longestOutage(data.vehicles, data.outages, windowStart, now, offset);
  const henry = M.attributedDowntimeShare("Henry", data.vehicles, data.outages, windowStart, now, offset);
  const board = M.leaderboard(data.vehicles, data.outages, windowStart, now, offset);

  root.replaceChildren();

  // --- banner ---
  root.append(
    el("section", { class: `banner banner--${copy.mood}` },
      el("div", { class: "banner__count" }, `${avail.up}`,
        el("span", { class: "banner__of" }, ` / ${avail.total}`)),
      el("div", { class: "banner__label" }, "carts operational right now"),
      el("p", { class: "banner__head" }, copy.head),
      el("p", { class: "banner__sub" }, copy.sub),
    )
  );

  // --- headline stats ---
  const statsWrap = el("section", { class: "stats" });
  statsWrap.append(
    statCard("Days at full cart strength",
      streak >= 1 ? plural(wholeDays(streak), "day") : "less than a day",
      streak >= 1 ? "and counting…" : "savor it"),
    statCard("Longest outage so far",
      longest ? plural(Math.round(longest.days), "day") : "none yet",
      longest ? longest.name : "spotless season"),
    statCard("Downtime caused by Henry",
      henry.hasDowntime ? pct(henry.pct) : "—",
      henry.hasDowntime
        ? (henry.pct === 0 ? "spotless record. So far." : "of all cart downtime")
        : "no downtime to blame yet"),
  );
  root.append(statsWrap);

  // --- cart-strength breakdown ---
  root.append(
    el("section", { class: "breakdown" },
      el("h2", {}, "How the season has gone"),
      el("p", { class: "muted" },
        `Since ${fmtDate(`${new Date(now).getFullYear()}-${data.season.startMonthDay}`, offset)}, the two carts have spent:`),
      el("ul", { class: "breakdown__list" },
        breakdownRow("both carts up", shares[2], "good"),
        breakdownRow("one cart up", shares[1], "warn"),
        breakdownRow("no carts up", shares[0], "down"),
      ),
    )
  );

  // --- leaderboard ---
  const lb = el("section", { class: "leaderboard" },
    el("h2", {}, "Reliability leaderboard"));
  const ol = el("ol", { class: "leaderboard__list" });
  board.forEach((row, i) => {
    ol.append(
      el("li", { class: `lb-row${row.isBenchmark ? " lb-row--benchmark" : ""}` },
        el("span", { class: "lb-row__rank" }, `${i + 1}`),
        el("a", { class: "lb-row__name", href: `vehicle.html?id=${row.id}` }, row.name,
          row.isBenchmark ? el("span", { class: "tag" }, "benchmark — not a cart") : null),
        el("span", { class: "lb-row__pct" }, pct(row.uptime)),
        el("span", { class: "lb-row__bar", style: `--w:${row.uptime}%` }),
      )
    );
  });
  lb.append(ol);
  root.append(lb);

  // --- outage log (reverse chronological) ---
  const log = el("section", { class: "log" }, el("h2", {}, "Outage log"));
  const sorted = [...data.outages].sort((a, b) => b.start.localeCompare(a.start));
  if (sorted.length === 0) {
    log.append(el("p", { class: "muted" }, "No outages on record. Suspicious, frankly."));
  } else {
    const ul = el("ul", { class: "log__list" });
    for (const o of sorted) {
      const v = vehicleById(data, o.vehicleId);
      const ongoing = o.end == null;
      const range = ongoing
        ? `since ${fmtDate(o.start, offset)} — still down`
        : (o.start === o.end ? fmtDate(o.start, offset) : `${fmtDate(o.start, offset)} – ${fmtDate(o.end, offset)}`);
      ul.append(
        el("li", { class: `log__item${ongoing ? " log__item--open" : ""}` },
          el("div", { class: "log__top" },
            el("a", { class: "log__veh", href: `vehicle.html?id=${o.vehicleId}` }, v ? v.name : o.vehicleId),
            el("span", { class: "log__dur" }, plural(outageDays(o, offset, now), "day"))),
          el("div", { class: "log__meta" }, `${range} · ${o.cause}`,
            o.attributedTo ? el("span", { class: "tag tag--blame" }, `blame: ${o.attributedTo}`) : null),
        )
      );
    }
    log.append(ul);
  }
  root.append(log);
}

function statCard(label, big, foot) {
  return el("div", { class: "stat" },
    el("div", { class: "stat__label" }, label),
    el("div", { class: "stat__big" }, big),
    el("div", { class: "stat__foot" }, foot));
}

function breakdownRow(label, share, mood) {
  return el("li", { class: `bd-row bd-row--${mood}` },
    el("span", { class: "bd-row__label" }, label),
    el("span", { class: "bd-row__pct" }, pct(share.pct)),
    el("span", { class: "bd-row__days muted" }, `(${plural(Math.round(share.days), "day")})`),
    el("span", { class: "bd-row__bar", style: `--w:${share.pct}%` }));
}

// ================= VEHICLE DETAIL =================
export function renderVehicle(data, id, root) {
  const v = vehicleById(data, id);
  if (!v) {
    root.replaceChildren(el("p", { class: "muted" }, `No vehicle with id "${id}".`,
      el("br"), el("a", { href: "index.html" }, "← Back to the fleet")));
    document.title = "Unknown vehicle — Fleet status";
    return;
  }
  const { offset, now, windowStart } = setup(data);
  const uptime = M.uptimePct(v.id, data.outages, windowStart, now, offset);
  const downNow = M.isDownNow(v.id, data.outages, windowStart, now, offset);

  document.title = `${v.name} — 2026 Cliff Golf Carts`;
  root.replaceChildren();

  root.append(el("p", { class: "back" }, el("a", { href: "index.html" }, "← Back to the fleet")));

  // hero — tappable to play the vehicle's sound, if it has one
  const hero = pictureFor(v.photos[0], "media media--hero");
  root.append(hero);
  if (v.sound) {
    const audio = new Audio(`audio/${v.sound.file}`);
    const play = () => { audio.currentTime = 0; audio.play().catch(() => {}); };
    hero.classList.add("media--playable");
    hero.addEventListener("click", play);
    const btn = el("button", { class: "soundbtn", type: "button" },
      `🔊 ${v.sound.label || "Play sound"}`);
    btn.addEventListener("click", play);
    root.append(btn);
  }

  // title + status
  root.append(
    el("header", { class: "veh-head" },
      el("h1", {}, v.name),
      el("span", { class: `status-pill status-pill--${downNow ? "down" : (v.type === "cart" ? "up" : "bench")}` },
        downNow ? "Down right now" : (v.type === "cart" ? "Operational" : "Operational (benchmark)")),
    )
  );
  if (v.blurb) root.append(el("p", { class: "blurb" }, v.blurb));

  // known hazards / operator callout
  if (v.knownHazards && v.knownHazards.length) {
    root.append(
      el("aside", { class: "hazard" },
        el("strong", {}, "⚠️ Known hazard: "),
        v.knownHazards.join(" ") + (v.operator ? ` Primary operator: ${v.operator.name} (age ${v.operator.age}). ${v.operator.note || ""}` : ""))
    );
  }

  // uptime
  root.append(
    el("section", { class: "uptime-card" },
      el("div", { class: "stat__label" }, "Season uptime (since May 1)"),
      el("div", { class: "stat__big" }, pct(uptime)),
      v.type !== "cart" ? el("div", { class: "stat__foot" }, "the benchmark. obnoxiously reliable.") : null)
  );

  // spec table
  const specs = [
    ["Type", v.type === "cart" ? "Golf cart" : "Motorcycle"],
    ["Year", v.year], ["Make", v.make], ["Model", v.model],
    ["Powertrain", v.powertrain], ["Seats", v.seats], ["Color", v.color],
    ["Home", v.home],
    v.odometer != null ? ["Odometer", `~${v.odometer.toLocaleString()} mi`] : null,
  ].filter(Boolean);
  const specTbl = el("table", { class: "spec" });
  for (const [k, val] of specs) {
    specTbl.append(el("tr", {}, el("th", {}, k), el("td", {}, String(val))));
  }
  root.append(el("section", {}, el("h2", {}, "Specs"), specTbl));

  // quirks
  if (v.quirks && v.quirks.length) {
    root.append(el("section", {}, el("h2", {}, "Quirks"),
      el("ul", { class: "quirks" }, ...v.quirks.map((q) => el("li", {}, q)))));
  }

  // maintenance
  if (v.maintenance && v.maintenance.length) {
    const mt = el("table", { class: "spec maint" });
    mt.append(el("tr", {}, el("th", {}, "Task"), el("th", {}, "Interval"), el("th", {}, "Status")));
    for (const m of v.maintenance) {
      const st = M.maintenanceStatus(m, v, now, offset);
      const statusCell = st.kind === "days"
        ? el("span", { class: st.overdue ? "due due--over" : "due" }, st.overdue ? `overdue (was due ${st.label})` : `next due ${st.label}`)
        : el("span", { class: "due" }, st.label);
      const interval = m.intervalDays != null ? `${m.intervalDays} days` : `${m.intervalMiles} mi`;
      mt.append(el("tr", {}, el("td", {}, m.task), el("td", {}, interval), el("td", {}, statusCell)));
    }
    root.append(el("section", {}, el("h2", {}, "Maintenance"), mt));
  }

  // this vehicle's outage history
  const hist = [...data.outages].filter((o) => o.vehicleId === v.id).sort((a, b) => b.start.localeCompare(a.start));
  const sec = el("section", {}, el("h2", {}, "Outage & repair history"));
  if (hist.length === 0) {
    sec.append(el("p", { class: "muted" }, v.type === "cart"
      ? "No outages on record. Enjoy the silence." : "Zero outages. As advertised."));
  } else {
    const ul = el("ul", { class: "log__list" });
    for (const o of hist) {
      const ongoing = o.end == null;
      const range = ongoing ? `since ${fmtDate(o.start, offset)} — still down`
        : (o.start === o.end ? fmtDate(o.start, offset) : `${fmtDate(o.start, offset)} – ${fmtDate(o.end, offset)}`);
      const li = el("li", { class: `log__item${ongoing ? " log__item--open" : ""}` },
        el("div", { class: "log__top" }, el("span", { class: "log__veh" }, o.cause),
          el("span", { class: "log__dur" }, plural(outageDays(o, offset, now), "day"))),
        el("div", { class: "log__meta" }, range,
          o.attributedTo ? el("span", { class: "tag tag--blame" }, `blame: ${o.attributedTo}`) : null));
      if (o.photo) li.append(pictureFor(o.photo, "media media--repair"));
      ul.append(li);
    }
    sec.append(ul);
  }
  root.append(sec);
}
