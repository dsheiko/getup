// Sitting tracker: stretches without a break, reminders, pause and per-day history.
// No Electron here: the current time and system idle time are passed in.
const fs = require("fs");

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const IDLE_BREAK = 3 * MIN;        // 3+ minutes without mouse or keyboard: must have stood up
const IDLE_BREAK_DUE = 90 * 1000;  // once a break is due, a minute and a half is enough
const IDLE_BACK = 10 * 1000;       // mouse or keyboard used just now: back at the desk
const REPEAT = 10 * MIN;           // repeat if the reminder was ignored
const SNOOZE = 5 * MIN;
const MIN_STRETCH = MIN;           // very short stretches are not logged
const KEEP_DAYS = 60;
const FOREVER = Number.MAX_SAFE_INTEGER;

const INTERVALS = [30, 35, 40, 45];
const LANGS = ["en", "ru"];
const DEFAULT_SETTINGS = { interval: 30, showWindow: true, sound: true, openAtLogin: true, lang: null };

const pad = (n) => String(n).padStart(2, "0");

function dayKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function cleanSettings(current, patch) {
  const next = { ...current };
  if (INTERVALS.includes(patch.interval)) {
    next.interval = patch.interval;
  }
  if (typeof patch.showWindow === "boolean") {
    next.showWindow = patch.showWindow;
  }
  if (typeof patch.sound === "boolean") {
    next.sound = patch.sound;
  }
  if (typeof patch.openAtLogin === "boolean") {
    next.openAtLogin = patch.openAtLogin;
  }
  if (LANGS.includes(patch.lang)) {
    next.lang = patch.lang;
  }
  return next;
}

function readData(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

class Tracker {
  constructor(file, now = Date.now(), intervalOverride = null) {
    const data = readData(file) || {};
    this.file = file;
    this.intervalOverride = intervalOverride; // minutes; when set, overrides the setting
    this.settings = cleanSettings(DEFAULT_SETTINGS, data.settings || {});
    this.days = data.days || {};
    this.sittingSince = now;
    this.awaySince = null;
    this.isOnManualBreak = false; // started with the "Log a break" button
    this.hasLeftDesk = false;     // during a manual break: was away long enough to count as gone
    this.lastBreak = null;
    this.mutedUntil = null;
    this.mutedAt = null;
    this.pausedMs = 0; // finished pauses in the current stretch: the countdown stood still then
    this.lockedAt = null;
    this.lastTickAt = now;
    this.savedAt = now;

    // app restarted: if there was no real break, continue the same stretch
    const open = data.open;
    if (open && now - open.at < IDLE_BREAK) {
      this.sittingSince = open.since;
      this.pausedMs = open.paused || 0;
    } else if (open) {
      this.log(open.since, open.at);
    }
    this.nextReminderAt = this.timerSince() + this.intervalMs();
  }

  intervalMs() {
    return (this.intervalOverride || this.settings.interval) * MIN;
  }

  isMuted(now) {
    return this.mutedUntil !== null && now < this.mutedUntil;
  }

  // where the countdown starts from: the stretch start, shifted by finished pauses
  timerSince() {
    return this.sittingSince + this.pausedMs;
  }

  // when the current pause started counting (a stretch that began mid-pause counts from its start)
  pausedAt() {
    if (this.mutedAt === null || this.sittingSince === null) {
      return null;
    }
    return Math.max(this.mutedAt, this.sittingSince);
  }

  // countdown time so far; it doesn't run while reminders are paused
  elapsed(now) {
    const pausedAt = this.pausedAt();
    const current = pausedAt === null ? 0 : Math.max(0, Math.min(now, this.mutedUntil) - pausedAt);
    return now - this.timerSince() - current;
  }

  isDue(now) {
    return this.sittingSince !== null && this.elapsed(now) >= this.intervalMs();
  }

  // Called every few seconds. Returns true when it's time to remind.
  tick(now, idleMs) {
    // the computer slept or the process hung: that's a break too
    if (now - this.lastTickAt > IDLE_BREAK) {
      this.endSitting(this.lastTickAt);
      this.hasLeftDesk = true;
    }
    this.lastTickAt = now;

    if (this.mutedUntil !== null && now >= this.mutedUntil) {
      this.unmute(now);
    }
    if (now - this.savedAt >= MIN) {
      this.save(now);
    }

    if (this.sittingSince === null) {
      // a manual break doesn't end on the button click itself, only on "End break"
      // or when you come back after being away from the mouse and keyboard
      if (this.isOnManualBreak) {
        if (idleMs >= IDLE_BREAK_DUE) {
          this.hasLeftDesk = true;
        }
        if (!this.hasLeftDesk) {
          return false;
        }
      }
      if (idleMs < IDLE_BACK) {
        this.startSitting(now - idleMs);
      }
      return false;
    }

    const threshold = this.isDue(now) && !this.isMuted(now) ? IDLE_BREAK_DUE : IDLE_BREAK;
    if (idleMs >= threshold) {
      this.endSitting(now - idleMs);
      return false;
    }

    // nobody sees a reminder on the lock screen; after a short lock it comes right away
    if (!this.isMuted(now) && this.lockedAt === null && now >= this.nextReminderAt) {
      this.nextReminderAt = now + REPEAT;
      return true;
    }
    return false;
  }

  startSitting(at) {
    if (this.awaySince !== null) {
      this.lastBreak = { start: this.awaySince, end: at };
    }
    this.awaySince = null;
    this.isOnManualBreak = false;
    this.hasLeftDesk = false;
    this.sittingSince = at;
    this.pausedMs = 0;
    this.nextReminderAt = at + this.intervalMs();
  }

  endSitting(at) {
    if (this.sittingSince === null) {
      return;
    }
    const since = this.sittingSince;
    const end = Math.max(at, since);
    this.sittingSince = null;
    if (end - since >= MIN_STRETCH) {
      this.log(since, end);
      this.awaySince = end;
    } else if (this.lastBreak && this.lastBreak.end === since) {
      // mouse bumped mid-break: the break continues
      this.awaySince = this.lastBreak.start;
    } else {
      this.awaySince = end;
    }
    this.save();
  }

  // "Log a break": sitting stops now, the break lasts until endBreak() or until you're back
  startBreak(now) {
    this.endSitting(now);
    this.isOnManualBreak = true;
    this.hasLeftDesk = false;
  }

  endBreak(now) {
    if (this.sittingSince === null) {
      this.startSitting(now);
      this.save(now);
    }
  }

  // The "Done" button: the break already happened
  takeBreak(now) {
    if (this.sittingSince !== null) {
      if (now - this.sittingSince >= MIN_STRETCH) {
        this.log(this.sittingSince, now);
      }
      this.sittingSince = null;
      this.awaySince = now;
    }
    this.startSitting(now);
    this.save(now);
  }

  snooze(now) {
    this.nextReminderAt = now + SNOOZE;
  }

  mute(now, minutes) {
    if (!this.isMuted(now)) {
      this.unmute(now); // a pause that ran out but wasn't noticed by tick() yet
      this.mutedAt = now;
    }
    this.mutedUntil = minutes ? now + minutes * MIN : FOREVER;
  }

  // the countdown continues where it stopped; if it was already due, the reminder comes right away
  unmute(now) {
    if (this.mutedUntil === null) {
      return;
    }
    if (this.sittingSince !== null) {
      this.pausedMs = now - this.sittingSince - this.elapsed(now);
      this.nextReminderAt = this.timerSince() + this.intervalMs();
    }
    this.mutedUntil = null;
    this.mutedAt = null;
  }

  lock(now) {
    this.lockedAt = now;
  }

  // a short lock (under a minute) is not a break
  unlock(now) {
    if (this.lockedAt !== null && now - this.lockedAt >= MIN) {
      this.endSitting(this.lockedAt);
      this.hasLeftDesk = true;
    }
    this.lockedAt = null;
  }

  suspend(now) {
    this.endSitting(now);
    this.hasLeftDesk = true;
  }

  updateSettings(patch, now) {
    const previous = this.settings.interval;
    this.settings = cleanSettings(this.settings, patch);
    if (this.settings.interval !== previous && this.sittingSince !== null) {
      this.nextReminderAt = Math.max(now, now - this.elapsed(now) + this.intervalMs());
    }
    this.save(now);
  }

  // --clear-history: forget the logged stretches; settings and the current countdown stay
  clearHistory(now) {
    this.days = {};
    this.lastBreak = null;
    this.save(now);
  }

  log(start, end) {
    const key = dayKey(start);
    (this.days[key] = this.days[key] || []).push([start, end]);
  }

  save(now = Date.now()) {
    const oldest = dayKey(now - KEEP_DAYS * DAY);
    for (const key of Object.keys(this.days)) {
      if (key < oldest) {
        delete this.days[key];
      }
    }
    const data = {
      settings: this.settings,
      days: this.days,
      open: this.sittingSince === null ? null : {
        since: this.sittingSince,
        at: now,
        paused: now - this.sittingSince - this.elapsed(now),
      },
    };
    try {
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${this.file}.tmp`, this.file);
      this.savedAt = now;
    } catch (error) {
      console.error("Could not save Getup data", error);
    }
  }

  snapshot(now) {
    const todayKey = dayKey(now);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - i);
      const key = dayKey(date.getTime());
      const stretches = this.days[key] || [];
      let longest = stretches.reduce((max, [start, end]) => Math.max(max, end - start), 0);
      if (key === todayKey && this.sittingSince !== null) {
        longest = Math.max(longest, now - this.sittingSince);
      }
      week.push({ date: date.getTime(), longest, breaks: stretches.length });
    }

    const isMuted = this.isMuted(now);
    return {
      now,
      interval: this.intervalMs(),
      sittingSince: this.sittingSince,
      // the countdown runs from timerSince and stands still from pausedAt until the pause ends
      timerSince: this.sittingSince === null ? null : this.timerSince(),
      pausedAt: isMuted ? this.pausedAt() : null,
      awaySince: this.awaySince,
      isOnManualBreak: this.isOnManualBreak,
      lastBreak: this.lastBreak,
      nextReminderAt: this.nextReminderAt,
      mutedUntil: isMuted ? this.mutedUntil : null,
      isMutedForever: isMuted && this.mutedUntil === FOREVER,
      today: this.days[todayKey] || [],
      week,
      settings: { ...this.settings },
    };
  }
}

module.exports = { Tracker, REPEAT };
