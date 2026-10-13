const { STRINGS, formatClock, formatDuration, formatTime } = window.GetupI18n;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const OVERDUE = 15 * MIN;       // this far past the interval, the ring turns red
const GOOD_STRETCH = 45 * MIN;  // advice: no more than 30–45 minutes in a row
const LONG_STRETCH = 90 * MIN;
const INTERVALS = [30, 35, 40, 45];
const LANGS = [["en", "English"], ["ru", "Русский"]];
const RING_LENGTH = 2 * Math.PI * 52;
const WEEK_BAR_MAX = 64;
const TRAY_SIZES = [[1, 16], [1.25, 20], [1.5, 24], [2, 32]];
const TRAY_COLORS = {
  accent: "#3987e5",
  paused: "#8a93a6",
  off: "#8a93a6", // the "off" blink frame: just the app icon
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#e5484d",
};
const TRAY_TILE = ["#222c44", "#192132"]; // the app icon's tile, top to bottom

const $ = (id) => document.getElementById(id);

let state = null;
let s = STRINGS.en;
let timelineKey = "";
let weekKey = "";
let trayKey = "";
const trayCache = new Map();
let isAlerting = false; // reminder fired and not handled yet: the tray icon blinks
let audio = null;
let alertTimer = null;

// countdown time so far: it stands still while reminders are paused
function timerElapsed(now) {
  const paused = state.pausedAt === null ? 0 : Math.max(0, Math.min(now, state.mutedUntil) - state.pausedAt);
  return now - state.timerSince - paused;
}

function getMode(now) {
  if (state.sittingSince === null) {
    return "away";
  }
  return timerElapsed(now) >= state.interval ? "due" : "sitting";
}

function isMuted(now) {
  return state.mutedUntil !== null && now < state.mutedUntil;
}

function toneOf(length) {
  if (length <= GOOD_STRETCH) {
    return "good";
  }
  return length <= LONG_STRETCH ? "warning" : "critical";
}

function startOfDay(ms) {
  return new Date(ms).setHours(0, 0, 0, 0);
}

function duration(ms, isCompact) {
  return formatDuration(ms, state.lang, isCompact);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function setTip(node, value, label) {
  node.tabIndex = 0;
  node.setAttribute("role", "img");
  node.dataset.tipValue = value;
  node.dataset.tipLabel = label;
  node.setAttribute("aria-label", `${value}, ${label}`);
}

/* text that only changes with the language */

function applyStrings() {
  document.documentElement.lang = state.lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = s[node.dataset.i18n];
  }
  for (const node of document.querySelectorAll("[data-i18n-label]")) {
    node.setAttribute("aria-label", s[node.dataset.i18nLabel]);
    node.title = s[node.dataset.i18nLabel];
  }
  $("checklist-items").replaceChildren(...s.checklist.map((text) => el("li", "", text)));
  $("login-label").textContent = s.openAtLogin[state.platform] || s.openAtLogin.win32;

  $("interval-options").replaceChildren(...INTERVALS.map((minutes) => {
    const button = el("button", "", `${minutes} ${s.units.min}`);
    button.dataset.value = minutes;
    button.addEventListener("click", () => window.getup.updateSettings({ interval: minutes }));
    return button;
  }));
  $("lang-options").replaceChildren(...LANGS.map(([lang, name]) => {
    const button = el("button", "", name);
    button.dataset.value = lang;
    button.addEventListener("click", () => window.getup.updateSettings({ lang }));
    return button;
  }));
  timelineKey = "";
  weekKey = "";
}

/* ring, headline and buttons: updated every second */

function describe(mode, muted, elapsed, now) {
  if (mode === "away") {
    return {
      tone: "good",
      progress: 1,
      time: formatClock(now - (state.awaySince ?? now)),
      label: s.ringOnBreak,
      headline: s.onBreak,
      detail: state.isOnManualBreak ? s.manualBreakDetail : s.awayDetail,
    };
  }
  const pausedText = state.isMutedForever ? s.pausedForever : s.pausedUntil(formatTime(state.mutedUntil));
  if (mode === "due") {
    let detail = s.dueDetail;
    if (muted) {
      detail = pausedText;
    } else if (state.nextReminderAt > now) {
      detail = s.remindAgainAt(formatTime(state.nextReminderAt));
    }
    return {
      tone: elapsed - state.interval >= OVERDUE ? "critical" : "warning",
      progress: 1,
      time: formatClock(elapsed),
      label: s.ringSitting,
      headline: s.timeToStand,
      detail,
    };
  }
  return {
    tone: muted ? "paused" : "accent",
    progress: elapsed / state.interval,
    time: formatClock(state.interval - elapsed),
    label: s.ringUntil,
    headline: muted ? pausedText : s.nextBreakAt(formatTime(state.timerSince + state.interval)),
    detail: muted ? s.timerStopped : lastBreakText(),
  };
}

function lastBreakText() {
  const last = state.lastBreak;
  if (!last) {
    return "";
  }
  const length = last.end - last.start;
  return s.lastBreak(formatTime(last.start), length >= MIN ? duration(length) : "");
}

function renderLive(now) {
  const mode = getMode(now);
  const muted = isMuted(now);
  const elapsed = mode === "away" ? 0 : timerElapsed(now);
  const view = describe(mode, muted, elapsed, now);

  const hero = $("hero");
  hero.dataset.tone = view.tone;
  hero.dataset.mode = mode;
  const ring = $("ring-fill");
  ring.style.strokeDashoffset = String(RING_LENGTH * (1 - Math.min(1, view.progress)));
  ring.style.opacity = view.progress > 0.005 ? "1" : "0";
  $("ring-time").textContent = view.time;
  $("ring-time").classList.toggle("is-long", view.time.length > 5);
  $("ring-label").textContent = view.label;
  $("headline").textContent = view.headline;
  $("detail").textContent = view.detail;
  $("detail").hidden = !view.detail;

  const breakButton = $("take-break");
  breakButton.hidden = mode === "away" && !state.isOnManualBreak;
  breakButton.textContent = { away: s.endBreak, due: s.done, sitting: s.logBreak }[mode];
  breakButton.classList.toggle("primary", mode === "due");
  $("snooze").hidden = mode !== "due" || muted;
  $("pause").textContent = muted ? s.resume : s.pause;

  $("checklist").hidden = mode === "sitting";
  $("stats").hidden = mode !== "sitting";

  if (mode !== "due" || muted) {
    isAlerting = false;
  }
  const isBlinkOff = isAlerting && Math.floor(now / 1000) % 2 === 1;
  drawTrayIcon(isBlinkOff ? "off" : view.tone, isBlinkOff ? 0 : view.progress);
}

/* reminder: sound and window flash */

function playChime(isRepeat) {
  audio = audio || new AudioContext();
  audio.resume();
  const notes = isRepeat ? [660, 880, 1320] : [660, 990];
  notes.forEach((frequency, i) => {
    const start = audio.currentTime + i * 0.22;
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
    tone.connect(gain).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 1.25);
  });
}

window.getup.onRemind(({ isRepeat, hasSound }) => {
  isAlerting = true;
  if (hasSound) {
    playChime(isRepeat);
  }
  // restart the animation if the class is still set from last time
  document.body.classList.remove("is-alerting");
  void document.body.offsetWidth;
  document.body.classList.add("is-alerting");
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => document.body.classList.remove("is-alerting"), 4500);
});

/* today: tiles, day timeline and list of stretches */

function todayStretches(now) {
  const stretches = state.today.map(([start, end]) => ({ start, end, isOngoing: false }));
  if (state.sittingSince !== null) {
    stretches.push({ start: Math.max(state.sittingSince, startOfDay(now)), end: now, isOngoing: true });
  }
  return stretches;
}

function stretchRange(stretch) {
  return `${formatTime(stretch.start)}–${stretch.isOngoing ? s.now : formatTime(stretch.end)}`;
}

function renderToday(now) {
  const stretches = todayStretches(now);
  const lengths = stretches.map(({ start, end }) => end - start);
  $("stat-breaks").textContent = String(state.today.length);
  $("stat-longest").textContent = duration(Math.max(0, ...lengths));
  $("stat-total").textContent = duration(lengths.reduce((sum, length) => sum + length, 0));

  const key = `${state.lang}|${state.today.length}|${state.sittingSince}|${Math.floor(now / MIN)}`;
  if (key === timelineKey) {
    return;
  }
  timelineKey = key;
  hideTooltip();

  const first = new Date(stretches.length ? stretches[0].start : now);
  first.setMinutes(0, 0, 0);
  const from = Math.max(startOfDay(now), first.getTime());
  const to = Math.max(now, from + 2 * HOUR);
  const span = to - from;

  $("timeline").replaceChildren(...stretches.map((stretch) => {
    const length = stretch.end - stretch.start;
    const segment = el("div", "segment");
    segment.dataset.tone = toneOf(length);
    segment.style.left = `${((stretch.start - from) / span) * 100}%`;
    segment.style.width = `calc(${(length / span) * 100}% - 2px)`;
    setTip(segment, duration(length), stretchRange(stretch));
    return segment;
  }));
  $("axis-start").textContent = formatTime(from);
  $("axis-end").textContent = to === now ? s.now : formatTime(to);

  $("stretch-list").replaceChildren(...stretches.slice().reverse().map((stretch) => {
    const length = stretch.end - stretch.start;
    const row = el("li");
    const dot = el("i");
    dot.dataset.tone = toneOf(length);
    row.append(dot, el("span", "", stretchRange(stretch)), el("span", "length", duration(length)));
    return row;
  }));
}

/* 7 days: the longest stretch of each day */

function renderWeek(now) {
  const key = `${state.lang}|${Math.floor(now / MIN)}|${state.week.map((day) => day.longest).join(",")}`;
  if (key === weekKey) {
    return;
  }
  weekKey = key;

  const max = Math.max(LONG_STRETCH, ...state.week.map((day) => day.longest));
  const scale = (ms) => (ms / max) * WEEK_BAR_MAX;
  const weekday = new Intl.DateTimeFormat(s.locale, { weekday: "short" });
  const fullDate = new Intl.DateTimeFormat(s.locale, { weekday: "short", day: "numeric", month: "short" });
  const todayKey = startOfDay(now);

  const columns = state.week.map((day) => {
    const column = el("div", "week-col");
    if (day.longest > 0) {
      const bar = el("div", "week-bar");
      bar.dataset.tone = toneOf(day.longest);
      bar.style.height = `${Math.max(2, scale(day.longest))}px`;
      column.append(el("span", "week-value", duration(day.longest, true)), bar);
    } else {
      column.append(el("span", "week-value", "–"));
    }
    setTip(column, day.longest > 0 ? duration(day.longest) : "–", `${fullDate.format(day.date)} · ${s.breaks}: ${day.breaks}`);
    return column;
  });
  const target = $("week-target");
  target.style.bottom = `${scale(GOOD_STRETCH)}px`;
  $("week-plot").replaceChildren(target, ...columns);

  $("week-days").replaceChildren(...state.week.map((day) => {
    return el("span", startOfDay(day.date) === todayKey ? "is-today" : "", weekday.format(day.date));
  }));
}

/* settings */

function renderSettings() {
  $("schedule").textContent = s.every(Math.round((state.interval / MIN) * 10) / 10);
  for (const button of $("interval-options").children) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.value) === state.settings.interval));
  }
  for (const button of $("lang-options").children) {
    button.setAttribute("aria-pressed", String(button.dataset.value === state.lang));
  }
  $("setting-show-window").checked = state.settings.showWindow;
  $("setting-sound").checked = state.settings.sound;
  $("setting-login").checked = state.settings.openAtLogin;
  $("row-login").hidden = !["win32", "darwin"].includes(state.platform);
  $("app-version").textContent = `v${state.version}`;
}

/* tray icon: the app icon (figure on a dark tile), its edge fills up while you sit */

// the white figure from the app icon on a transparent background (make-icons.ps1)
let trayFigure = null;
const figureSource = new Image();
figureSource.onload = () => {
  trayFigure = figureSource;
  trayCache.clear(); // redraw the frames drawn before the figure loaded
  trayKey = "";
};
figureSource.src = "tray-figure.png";

function drawTrayIcon(tone, progress) {
  const step = Math.round(Math.min(1, progress) * 24) / 24;
  const key = `${tone}|${step}`;
  if (key === trayKey) {
    return;
  }
  trayKey = key;
  // while blinking, two frames alternate every second, so don't redraw them
  if (!trayCache.has(key)) {
    trayCache.set(key, TRAY_SIZES.map(([scale, size]) => ({ scale, dataURL: drawTrayFrame(size, tone, step) })));
  }
  window.getup.setTrayIcon(trayCache.get(key));
}

// rounded square, starting and ending at the middle of the top edge, clockwise
function tilePath(ctx, from, to, radius) {
  const middle = (from + to) / 2;
  ctx.beginPath();
  ctx.moveTo(middle, from);
  ctx.arcTo(to, from, to, to, radius);
  ctx.arcTo(to, to, from, to, radius);
  ctx.arcTo(from, to, from, from, radius);
  ctx.arcTo(from, from, to, from, radius);
  ctx.lineTo(middle, from);
}

function drawTrayFrame(size, tone, progress) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const color = TRAY_COLORS[tone];
  const radius = size * 0.24;
  const border = Math.max(1.5, size * 0.125);

  const fill = ctx.createLinearGradient(0, 0, 0, size);
  fill.addColorStop(0, TRAY_TILE[0]);
  fill.addColorStop(1, TRAY_TILE[1]);
  ctx.fillStyle = fill;
  tilePath(ctx, 0, size, radius);
  ctx.fill();

  if (trayFigure) {
    const height = size * 0.72;
    const width = height * (trayFigure.width / trayFigure.height);
    ctx.imageSmoothingQuality = "high"; // keeps the thin arm visible at 16 px
    ctx.drawImage(trayFigure, (size - width) / 2 - size * 0.03, (size - height) / 2 + size * 0.02, width, height);
  }

  // progress along the edge of the tile, over a faint track
  const inset = border / 2;
  const edgeRadius = radius - inset;
  const side = size - border - 2 * edgeRadius;
  const length = 4 * side + 2 * Math.PI * edgeRadius;
  ctx.lineWidth = border;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  tilePath(ctx, inset, size - inset, edgeRadius);
  ctx.stroke();
  if (progress > 0 && tone !== "off") {
    ctx.strokeStyle = color;
    ctx.setLineDash([length * progress, length]);
    tilePath(ctx, inset, size - inset, edgeRadius);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // state badge in the top right corner, where the app icon has its pause badge
  if (tone === "warning" || tone === "critical" || tone === "paused") {
    const badge = size * (size < 20 ? 0.2 : 0.23);
    const x = size - badge - size * 0.02;
    const y = badge + size * 0.02;
    ctx.fillStyle = color;
    ctx.strokeStyle = TRAY_TILE[1];
    ctx.lineWidth = Math.max(1, size * 0.06);
    ctx.beginPath();
    ctx.arc(x, y, badge, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    if (tone === "paused") {
      const barWidth = badge * 0.32;
      const barHeight = badge * 0.95;
      const gap = badge * 0.28;
      ctx.fillStyle = TRAY_TILE[1];
      ctx.fillRect(x - gap / 2 - barWidth, y - barHeight / 2, barWidth, barHeight);
      ctx.fillRect(x + gap / 2, y - barHeight / 2, barWidth, barHeight);
    }
  }
  return canvas.toDataURL("image/png");
}

/* tooltip on hover and focus */

function showTooltip(target) {
  const tooltip = $("tooltip");
  $("tooltip-value").textContent = target.dataset.tipValue;
  $("tooltip-label").textContent = target.dataset.tipLabel;
  tooltip.hidden = false;
  const box = target.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8);
  const above = box.top - tip.height - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above < 8 ? box.bottom + 8 : above}px`;
}

function hideTooltip() {
  $("tooltip").hidden = true;
}

document.addEventListener("pointerover", (event) => {
  const target = event.target.closest("[data-tip-value]");
  if (target) {
    showTooltip(target);
  }
});
document.addEventListener("pointerout", (event) => {
  const target = event.target.closest("[data-tip-value]");
  if (target && !target.contains(event.relatedTarget)) {
    hideTooltip();
  }
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-tip-value]")) {
    showTooltip(event.target);
  }
});
document.addEventListener("focusout", hideTooltip);

/* actions */

$("take-break").addEventListener("click", () => {
  const mode = getMode(Date.now());
  if (mode === "away") {
    window.getup.endBreak();
  } else if (mode === "due") {
    window.getup.takeBreak();
  } else {
    window.getup.startBreak();
  }
});
$("snooze").addEventListener("click", () => {
  isAlerting = false;
  window.getup.snooze();
});
// pauses until resumed; timed pauses are in the tray menu
$("pause").addEventListener("click", () => {
  if (isMuted(Date.now())) {
    window.getup.resume();
  } else {
    window.getup.pause();
  }
});

function selectTab(tab) {
  const isWeek = tab === "week";
  $("tab-today").setAttribute("aria-selected", String(!isWeek));
  $("tab-week").setAttribute("aria-selected", String(isWeek));
  $("panel-today").hidden = isWeek;
  $("panel-week").hidden = !isWeek;
  hideTooltip();
}

$("tab-today").addEventListener("click", () => selectTab("today"));
$("tab-week").addEventListener("click", () => selectTab("week"));

function showView(name) {
  const isSettings = name === "settings";
  $("view-main").hidden = isSettings;
  $("view-settings").hidden = !isSettings;
  hideTooltip();
  $(isSettings ? "close-settings" : "open-settings").focus();
}

$("open-settings").addEventListener("click", () => showView("settings"));
$("close-settings").addEventListener("click", () => showView("main"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("view-settings").hidden) {
    showView("main");
  }
});

$("setting-show-window").addEventListener("change", (event) => {
  window.getup.updateSettings({ showWindow: event.target.checked });
});
$("setting-sound").addEventListener("change", (event) => {
  window.getup.updateSettings({ sound: event.target.checked });
  if (event.target.checked) {
    playChime(false); // play it right away so you hear what it sounds like
  }
});
$("setting-login").addEventListener("change", (event) => {
  window.getup.updateSettings({ openAtLogin: event.target.checked });
});

/* the window follows the content height */

function sendHeight() {
  if (state) {
    window.getup.setHeight($("app").getBoundingClientRect().height);
  }
}

new ResizeObserver(sendHeight).observe($("app"));

function renderClock() {
  const now = Date.now();
  renderLive(now);
  renderToday(now);
  renderWeek(now);
}

window.getup.onState((next) => {
  const isFirst = state === null;
  const isLangChanged = isFirst || state.lang !== next.lang;
  state = next;
  s = STRINGS[state.lang];
  if (isLangChanged) {
    applyStrings();
  }
  renderSettings();
  renderClock();
  if (isFirst) {
    document.body.classList.add("is-ready"); // hide the splash
    $("app").removeAttribute("aria-busy");
    sendHeight();
  }
});

setInterval(() => {
  if (state) {
    renderClock();
  }
}, 1000);
