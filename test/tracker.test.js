const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Tracker } = require("../src/tracker");

const MIN = 60 * 1000;
const TICK = 5000;
const START = new Date(2026, 9, 2, 9, 0, 0).getTime();

let file;
let now;
let tracker;
let reminders;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "getup-")), "data.json");
  now = START;
  tracker = new Tracker(file, now);
  reminders = 0;
});

// idle: "active" = mouse used every tick, "away" = idle time keeps growing
function run(ms, mode = "active") {
  let idle = 0;
  for (const end = now + ms; now < end;) {
    now += TICK;
    idle = mode === "away" ? idle + TICK : 0;
    if (tracker.tick(now, idle)) {
      reminders++;
    }
  }
}

test("reminds at the interval and repeats if ignored", () => {
  run(30 * MIN);
  assert.strictEqual(reminders, 1);
  run(10 * MIN);
  assert.strictEqual(reminders, 2);
});

test("90 s away counts as a break once it is due, not before", () => {
  run(10 * MIN);
  run(2 * MIN, "away");
  assert.notStrictEqual(tracker.sittingSince, null, "2 min idle while not due is not a break");
  run(25 * MIN);
  run(100 * 1000, "away");
  assert.strictEqual(tracker.sittingSince, null);
  const [[start, end]] = tracker.snapshot(now).today;
  assert.ok(Math.abs(end - start - 37 * MIN) < 10 * 1000);

  run(TICK);
  assert.notStrictEqual(tracker.sittingSince, null, "back at the desk");
  assert.ok(tracker.lastBreak.end - tracker.lastBreak.start >= 95 * 1000);
});

test("snooze delays the next reminder by 5 minutes", () => {
  run(30 * MIN);
  tracker.snooze(now);
  run(4 * MIN);
  assert.strictEqual(reminders, 1);
  run(70 * 1000);
  assert.strictEqual(reminders, 2);
});

test("a timed pause stops the countdown, it continues when the pause ends", () => {
  run(10 * MIN);
  tracker.mute(now, 30);
  run(35 * MIN);
  assert.strictEqual(reminders, 0);
  assert.strictEqual(tracker.elapsed(now), 15 * MIN);
  run(15 * MIN);
  assert.strictEqual(reminders, 1);
  assert.strictEqual(tracker.snapshot(now).today.length, 0, "sitting time is still one stretch");
  assert.strictEqual(tracker.sittingSince, START);
});

test("pause until resumed freezes the countdown until unmute", () => {
  run(10 * MIN);
  tracker.mute(now, null);
  run(2 * 60 * MIN);
  assert.strictEqual(reminders, 0);
  assert.strictEqual(tracker.elapsed(now), 10 * MIN);
  const state = tracker.snapshot(now);
  assert.strictEqual(now - state.timerSince - (now - state.pausedAt), 10 * MIN);
  tracker.unmute(now);
  run(19 * MIN);
  assert.strictEqual(reminders, 0);
  run(MIN);
  assert.strictEqual(reminders, 1);
});

test("pausing when a break is already due reminds right after resume", () => {
  run(30 * MIN);
  assert.strictEqual(reminders, 1);
  tracker.mute(now, null);
  run(20 * MIN);
  assert.strictEqual(reminders, 1);
  tracker.unmute(now);
  run(TICK);
  assert.strictEqual(reminders, 2);
});

test("restart keeps the countdown shift from a pause", () => {
  run(10 * MIN);
  tracker.mute(now, null);
  run(MIN);
  tracker.save(now);
  const restarted = new Tracker(file, now + TICK);
  assert.strictEqual(restarted.elapsed(now + TICK), 10 * MIN + TICK);
});

test("a mouse bump during a break does not split it", () => {
  run(10 * MIN);
  run(4 * MIN, "away");
  const breakStart = tracker.awaySince;
  run(TICK);
  run(4 * MIN, "away");
  assert.strictEqual(tracker.awaySince, breakStart);
  assert.strictEqual(tracker.snapshot(now).today.length, 1);
});

test("Done logs the stretch and restarts the timer", () => {
  run(20 * MIN);
  tracker.takeBreak(now);
  assert.strictEqual(tracker.snapshot(now).today.length, 1);
  assert.strictEqual(tracker.sittingSince, now);
});

test("Log a break lasts until End break, even with the mouse in use", () => {
  run(20 * MIN);
  const breakStart = now;
  tracker.startBreak(now);
  assert.strictEqual(tracker.sittingSince, null);
  assert.strictEqual(tracker.snapshot(now).today.length, 1);
  run(5 * MIN);
  assert.strictEqual(tracker.sittingSince, null, "activity does not end a manual break");
  assert.strictEqual(tracker.snapshot(now).isOnManualBreak, true);
  tracker.endBreak(now);
  assert.strictEqual(tracker.sittingSince, now);
  assert.deepStrictEqual(tracker.lastBreak, { start: breakStart, end: now });
  assert.strictEqual(tracker.snapshot(now).isOnManualBreak, false);
});

test("a manual break ends by itself when you come back after being away", () => {
  run(20 * MIN);
  const breakStart = now;
  tracker.startBreak(now);
  run(3 * MIN, "away");
  run(TICK);
  assert.notStrictEqual(tracker.sittingSince, null, "back at the desk");
  assert.strictEqual(tracker.lastBreak.start, breakStart);
  assert.ok(tracker.lastBreak.end - breakStart >= 3 * MIN);
});

test("short screen lock is ignored, a longer one is a break", () => {
  run(5 * MIN);
  tracker.lock(now);
  tracker.unlock(now + 30 * 1000);
  assert.strictEqual(tracker.sittingSince, START);
  tracker.lock(now);
  tracker.unlock(now + 2 * MIN);
  assert.strictEqual(tracker.sittingSince, null);
});

test("no reminder while the screen is locked, it comes right after a short lock", () => {
  run(29 * MIN + 40 * 1000);
  tracker.lock(now);
  run(40 * 1000);
  assert.strictEqual(reminders, 0);
  tracker.unlock(now);
  assert.notStrictEqual(tracker.sittingSince, null, "a 40 s lock is not a break");
  run(TICK);
  assert.strictEqual(reminders, 1);
});

test("a long gap between ticks (sleep) is a break", () => {
  run(10 * MIN);
  now += 20 * MIN;
  tracker.tick(now, 0);
  assert.strictEqual(tracker.sittingSince, now);
  assert.strictEqual(tracker.snapshot(now).today.length, 1);
});

test("restart continues the stretch only if it was quick", () => {
  run(10 * MIN);
  tracker.save(now);
  assert.strictEqual(new Tracker(file, now + MIN).sittingSince, START);
  const late = new Tracker(file, now + 10 * MIN);
  assert.strictEqual(late.sittingSince, now + 10 * MIN);
  assert.strictEqual(late.snapshot(now + 10 * MIN).today.length, 1);
});

test("clearing history forgets logged stretches, keeps settings and the countdown", () => {
  tracker.updateSettings({ interval: 45 }, now);
  run(20 * MIN);
  tracker.takeBreak(now);
  run(10 * MIN);
  const sittingSince = tracker.sittingSince;
  tracker.clearHistory(now);
  assert.strictEqual(tracker.snapshot(now).today.length, 0);
  assert.strictEqual(tracker.lastBreak, null);
  assert.strictEqual(tracker.sittingSince, sittingSince);
  const restarted = new Tracker(file, now);
  assert.deepStrictEqual(restarted.days, {});
  assert.strictEqual(restarted.settings.interval, 45);
});

test("settings ignore unknown values", () => {
  tracker.updateSettings({ interval: 99, lang: "de", showWindow: false }, now);
  assert.deepStrictEqual(tracker.settings, { interval: 30, showWindow: false, sound: true, openAtLogin: true, lang: null });
  tracker.updateSettings({ interval: 45, lang: "ru" }, now);
  assert.strictEqual(tracker.settings.interval, 45);
  assert.strictEqual(new Tracker(file, now).settings.lang, "ru");
});
