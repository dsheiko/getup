const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, nativeTheme, powerMonitor, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { Tracker, REPEAT } = require("./tracker");
const { STRINGS, formatDuration, formatTime } = require("./i18n");
const windows = require("./windows");

// Windows: taskbar grouping, toasts, the Start menu shortcut and the name of the startup entry.
// Kept from when the app was called Stand-up: with the same ID (and build.appId) an existing
// install upgrades in place and its startup entry is updated instead of left behind.
const APP_ID = "stand-up.reminder";
const DATA_FILE = "getup.json";
const OLD_DATA_FILE = ["Stand-up", "stand-up.json"]; // in appData, before the rename
const TICK = 5 * 1000;
const NOTIFICATION_SECONDS = 30; // the reminder notification disappears by itself after this
const isWindows = process.platform === "win32";
const canOpenAtLogin = isWindows || process.platform === "darwin";
const WIDTH = 400;
const ICON = path.join(__dirname, "icon.png");
const ICON_ICO = path.join(__dirname, "icon.ico"); // Windows: every size drawn separately, see make-icons.ps1
const WINDOW_ICON = isWindows ? ICON_ICO : ICON;
const PAUSE_OPTIONS = [30, 60, 120, null]; // minutes, null = until resumed
const startHidden = process.argv.includes("--hidden"); // this is how it starts at login
// --clear-history: delete the break log. Works on launch and when the app is already running
// (the running instance gets it, otherwise it would save its history back over the cleared file)
const CLEAR_HISTORY = "--clear-history";
// npm run debug (electron . --interval=5) or GETUP_INTERVAL=5: reminder interval in minutes
// (fractions allowed), overrides the setting. Not set or invalid: the interval from Settings (30 min by default).
const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
const envInterval = Number.parseFloat(intervalArg ? intervalArg.split("=")[1] : process.env.GETUP_INTERVAL);
const INTERVAL_OVERRIDE = envInterval > 0 ? envInterval : null;

let tracker;
let tray;
let mainWindow;
let notification; // keep a reference, otherwise the notification click handler gets lost
let notificationTimer = null;
let trayMenuKey = null;
let isWindowSized = false;
let isPinned = false;
let canNotify = false;
let windowsIcon = null; // Windows: the .ico for the taskbar button and the toast shortcut

// English unless another language is chosen in Settings
function getLang() {
  return tracker.settings.lang || "en";
}

function strings() {
  return STRINGS[getLang()];
}

function act(change) {
  change(Date.now());
  pushState();
}

function pushState() {
  const now = Date.now();
  const state = { ...tracker.snapshot(now), lang: getLang(), platform: process.platform, version: app.getVersion() };
  // break counted or reminders paused: stop keeping the window on top
  if (isPinned && (!tracker.isDue(now) || tracker.isMuted(now))) {
    pinWindow(false);
  }
  updateTray(state);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("state", state);
  }
}

function trayStatus(state) {
  const s = STRINGS[state.lang];
  if (state.sittingSince === null) {
    return s.onBreak;
  }
  if (state.mutedUntil !== null) {
    return state.isMutedForever ? s.pausedForever : s.pausedUntil(formatTime(state.mutedUntil));
  }
  const elapsed = state.now - state.timerSince;
  if (elapsed >= state.interval) {
    return s.tipDue(formatDuration(state.now - state.sittingSince, state.lang));
  }
  return s.tipUntilBreak(formatDuration(state.interval - elapsed, state.lang));
}

function updateTray(state) {
  if (!tray) {
    return;
  }
  tray.setToolTip(`Getup · ${trayStatus(state)}`);
  const isMuted = state.mutedUntil !== null;
  const key = `${state.lang}|${isMuted}|${state.isOnManualBreak}`;
  if (key !== trayMenuKey) {
    trayMenuKey = key;
    tray.setContextMenu(buildTrayMenu(isMuted, state.isOnManualBreak));
  }
}

function startBreak() {
  closeNotification();
  pinWindow(false);
  act((now) => tracker.startBreak(now));
}

function pauseMenuItems() {
  return PAUSE_OPTIONS.map((minutes) => ({
    label: strings().pauseFor(minutes),
    click: () => act((now) => tracker.mute(now, minutes)),
  }));
}

function buildTrayMenu(isMuted, isOnManualBreak) {
  const s = strings();
  return Menu.buildFromTemplate([
    { label: s.trayOpen, click: showWindow },
    isOnManualBreak
      ? { label: s.endBreak, click: () => act((now) => tracker.endBreak(now)) }
      : { label: s.logBreak, click: startBreak },
    isMuted
      ? { label: s.trayResume, click: () => act((now) => tracker.unmute(now)) }
      : { label: s.trayPause, submenu: pauseMenuItems() },
    { type: "separator" },
    { label: s.quit, click: quit },
  ]);
}

function showWindow() {
  syncLoginItem(); // it may have been changed in Task Manager since
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function pinWindow(isOn) {
  if (isPinned === isOn) {
    return;
  }
  isPinned = isOn;
  mainWindow.setAlwaysOnTop(isOn, "floating");
}

// move the window to the center of the screen with the mouse, so it doesn't pop up on another monitor
function centerOnActiveScreen() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = mainWindow.getBounds();
  const isOnScreen = bounds.x >= workArea.x && bounds.x + bounds.width <= workArea.x + workArea.width &&
    bounds.y >= workArea.y && bounds.y + bounds.height <= workArea.y + workArea.height;
  if (mainWindow.isVisible() && isOnScreen) {
    return;
  }
  mainWindow.setPosition(
    Math.round(workArea.x + (workArea.width - bounds.width) / 2),
    Math.round(workArea.y + Math.max(0, (workArea.height - bounds.height) / 3)),
  );
}

// keep the window on top until the break is taken, but don't steal focus mid-typing
function bringUpWindow() {
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  centerOnActiveScreen();
  pinWindow(true);
  if (!mainWindow.isFocused()) {
    mainWindow.showInactive();
    mainWindow.moveTop();
    mainWindow.flashFrame(true);
  }
}

function closeNotification() {
  clearTimeout(notificationTimer);
  if (notification) {
    notification.close();
    notification = null;
  }
}

// Electron (re)creates the toast shortcut in the background around the first notification,
// without an icon: give it the app's icon once that's done
function onToastShown() {
  if (isWindows) {
    setTimeout(() => windows.decorateToastShortcut(APP_ID, windowsIcon), 5000);
  }
}

function showNotification(title, body) {
  closeNotification();
  if (!canNotify) {
    return;
  }
  // stays on screen instead of sliding away after a few seconds, the timer closes it
  notification = isWindows
    ? new Notification({ toastXml: windows.toastXml({ title, body, image: ICON }) })
    : new Notification({ title, body, icon: ICON, timeoutType: "never" });
  notification.on("click", showWindow);
  notification.on("show", onToastShown);
  notification.on("failed", (_event, error) => console.warn("Could not show a notification", error));
  notification.show();
  notificationTimer = setTimeout(closeNotification, NOTIFICATION_SECONDS * 1000);
}

function remind(now) {
  const s = strings();
  const sitting = now - tracker.sittingSince;
  const isRepeat = tracker.elapsed(now) - tracker.intervalMs() >= REPEAT / 2;
  showNotification(isRepeat ? s.notifyAgain(formatDuration(sitting, getLang())) : s.notifyTitle, s.notifyBody);
  if (tracker.settings.showWindow) {
    bringUpWindow();
  }
  // sound and window flash (the sound plays even if the window is hidden)
  mainWindow.webContents.send("remind", { isRepeat, hasSound: tracker.settings.sound });
}

// Besides the lock-screen events, ask the system on every tick: an event can be missed,
// e.g. when the app starts on the lock screen. On Windows, "locked" also covers the screensaver.
function checkLock(now) {
  const isLocked = powerMonitor.getSystemIdleState(60) === "locked";
  if (isLocked && tracker.lockedAt === null) {
    tracker.lock(now);
  } else if (!isLocked && tracker.lockedAt !== null) {
    tracker.unlock(now);
  }
}

function tick() {
  const now = Date.now();
  checkLock(now);
  // system idle time: on Windows the last keyboard or mouse input in the session (GetLastInputInfo)
  if (tracker.tick(now, powerMonitor.getSystemIdleTime() * 1000)) {
    remind(now);
  }
  pushState();
}

// start at login (works without packaging too); Electron doesn't support this on Linux
function loginItemOptions() {
  return { path: process.execPath, args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"] };
}

function applyLoginItem() {
  if (canOpenAtLogin) {
    app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: tracker.settings.openAtLogin });
  }
}

// The setting writes the Run registry key. If startup was turned off in Task Manager
// or Settings > Apps > Startup, the setting follows Windows instead of turning it back on.
function syncLoginItem() {
  if (!canOpenAtLogin) {
    return;
  }
  const current = app.getLoginItemSettings(loginItemOptions());
  const isTurnedOffInWindows = isWindows && current.openAtLogin && !current.executableWillLaunchAtLogin;
  if (isTurnedOffInWindows && tracker.settings.openAtLogin) {
    act((now) => tracker.updateSettings({ openAtLogin: false }, now));
  } else if (current.openAtLogin !== tracker.settings.openAtLogin) {
    applyLoginItem();
  }
}

function quit() {
  app.isQuitting = true;
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIDTH,
    height: 520,
    useContentSize: true,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: "Getup",
    icon: WINDOW_ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111622" : "#f3f5f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required", // reminder sound without clicking the window first
    },
  });
  if (isWindows) {
    windows.setWindowDetails(mainWindow, windowsIcon);
  }
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      pinWindow(false);
      mainWindow.hide();
    }
  });
  mainWindow.on("focus", () => mainWindow.flashFrame(false));
  // Windows shutdown or sign-out: "before-quit" doesn't fire then, so save here
  mainWindow.on("session-end", () => {
    closeNotification();
    tracker.save();
  });
  mainWindow.webContents.on("did-finish-load", pushState);
  // the window is shown once it's sized to its content; this is the fallback
  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      if (!isWindowSized && !startHidden) {
        mainWindow.show();
      }
    }, 1500);
  });
}

function setWindowHeight(height) {
  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const target = Math.min(Math.ceil(height), workArea.height - 40);
  const [, current] = mainWindow.getContentSize();
  if (target !== current) {
    // on Linux a window with resizable: false doesn't resize otherwise
    const isLinux = process.platform === "linux";
    if (isLinux) {
      mainWindow.setResizable(true);
    }
    mainWindow.setContentSize(WIDTH, target);
    if (isLinux) {
      mainWindow.setResizable(false);
    }
  }
  if (!isWindowSized) {
    isWindowSized = true;
    if (!startHidden) {
      mainWindow.center();
      mainWindow.show();
    }
  }
}

// The data folder follows the app name. On the first run after the rename from Stand-up,
// bring the history and settings along; the old folder is left as it was.
function dataFile() {
  const file = path.join(app.getPath("userData"), DATA_FILE);
  const oldFile = path.join(app.getPath("appData"), ...OLD_DATA_FILE);
  if (!fs.existsSync(file) && fs.existsSync(oldFile)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(oldFile, file);
    } catch (error) {
      console.warn("Could not copy the Stand-up data", error);
    }
  }
  return file;
}

function start() {
  app.setAppUserModelId(APP_ID);
  if (isWindows) {
    windowsIcon = windows.prepareIcon(ICON_ICO);
    windows.decorateToastShortcut(APP_ID, windowsIcon);
  }
  canNotify = Notification.isSupported();

  tracker = new Tracker(dataFile(), Date.now(), INTERVAL_OVERRIDE);
  if (process.argv.includes(CLEAR_HISTORY)) {
    tracker.clearHistory(Date.now());
  }
  syncLoginItem();
  createWindow();

  // until the window draws the live tray icon
  tray = new Tray(isWindows ? ICON_ICO : nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: "best" }));
  tray.on("click", showWindow);

  ipcMain.on("break:take", () => {
    closeNotification();
    act((now) => tracker.takeBreak(now));
  });
  ipcMain.on("break:start", startBreak);
  ipcMain.on("break:end", () => act((now) => tracker.endBreak(now)));
  ipcMain.on("break:snooze", () => {
    closeNotification();
    pinWindow(false);
    act((now) => tracker.snooze(now));
  });
  ipcMain.on("pause:start", () => act((now) => tracker.mute(now, null)));
  ipcMain.on("pause:resume", () => act((now) => tracker.unmute(now)));
  ipcMain.on("settings:update", (_event, patch) => {
    act((now) => tracker.updateSettings(patch, now));
    if ("openAtLogin" in patch) {
      applyLoginItem();
    }
  });
  ipcMain.on("tray:icon", (_event, images) => {
    const image = nativeImage.createEmpty();
    for (const { scale, dataURL } of images) {
      image.addRepresentation({ scaleFactor: scale, dataURL });
    }
    tray.setImage(image);
  });
  ipcMain.on("window:height", (_event, height) => setWindowHeight(height));

  // sleep and screen lock count as a break (on Windows: session lock and power notifications)
  powerMonitor.on("lock-screen", () => tracker.lock(Date.now()));
  powerMonitor.on("unlock-screen", () => act((now) => tracker.unlock(now)));
  powerMonitor.on("suspend", () => act((now) => tracker.suspend(now)));
  powerMonitor.on("resume", tick);

  if (startHidden && canNotify) {
    const s = strings();
    const running = new Notification({ title: s.runningTitle, body: s.runningBody, icon: ICON });
    running.on("show", onToastShown);
    running.show();
  }

  setInterval(tick, TICK);
  checkLock(Date.now());
  pushState();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (!mainWindow) {
      return;
    }
    if (argv.includes(CLEAR_HISTORY)) {
      act((now) => tracker.clearHistory(now));
    }
    showWindow();
  });
  app.on("before-quit", () => {
    app.isQuitting = true;
    closeNotification();
    if (tracker) {
      tracker.save();
    }
  });
  app.whenReady().then(start);
}
