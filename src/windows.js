// Windows integration: icons for the taskbar and the toasts, and the toast layout
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, shell } = require("electron");

const WINDOW_APP_ID = "stand-up.window"; // kept from the old name, so taskbar pins keep working

// shortcuts and taskbar buttons take icons only from .ico (or .exe) files on disk,
// not from inside app.asar, so keep a copy next to the app's data
function prepareIcon(icoFile) {
  const icon = path.join(app.getPath("userData"), "icon.ico");
  try {
    fs.writeFileSync(icon, fs.readFileSync(icoFile));
  } catch (error) {
    console.warn("Could not write the .ico icon", error);
  }
  return icon;
}

// not packaged: electron.exe runs the project folder
const launchArgs = () => (app.isPackaged ? "" : `"${app.getAppPath()}"`);

// The taskbar button of a window that shares the app's AppUserModelID gets its icon from the
// toast shortcut below, which shows Electron's icon when not packaged. A separate ID for the
// window makes the taskbar use this icon and name, also when the window is pinned.
function setWindowDetails(window, icon) {
  window.setAppDetails({
    appId: WINDOW_APP_ID,
    appIconPath: icon,
    appIconIndex: 0,
    relaunchCommand: `"${process.execPath}" ${launchArgs()}`.trim(),
    relaunchDisplayName: "Getup",
  });
}

// Toasts need a Start menu shortcut with the app's AppUserModelID. Electron creates it by itself,
// named after the .exe product name ("Electron" when not packaged) and without an icon.
// The toast header shows that shortcut's icon, so it gets Getup's icon, and it starts Getup
// instead of an empty Electron. Electron keeps these: it only rewrites the shortcut when its
// target, folder, ID or toast activator change.
function decorateToastShortcut(appId, icon) {
  const programs = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  let files = [];
  try {
    files = fs.readdirSync(programs).filter((name) => name.toLowerCase().endsWith(".lnk"));
  } catch {
    return;
  }
  const details = { args: launchArgs(), icon, iconIndex: 0, description: "Reminds you to stand up every 30–45 minutes" };
  for (const name of files) {
    const link = path.join(programs, name);
    let current;
    try {
      current = shell.readShortcutLink(link);
    } catch {
      continue;
    }
    const isOurs = current.appUserModelId === appId && current.target.toLowerCase() === process.execPath.toLowerCase();
    if (isOurs && (current.icon !== icon || (current.args || "") !== details.args)) {
      shell.writeShortcutLink(link, "update", details);
    }
  }
}

const escapeXml = (text) => String(text).replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

// "reminder" keeps the toast on screen until it's closed (a normal one slides away after ~5 s).
// Windows only honors it with a button, so there's a system Dismiss button.
// Silent: the window plays its own chime, if that's turned on.
function toastXml({ title, body, image }) {
  return `<toast scenario="reminder">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(title)}</text>
      <text>${escapeXml(body)}</text>
      <image placement="appLogoOverride" src="${escapeXml(pathToFileURL(image).href)}" />
    </binding>
  </visual>
  <actions>
    <action activationType="system" arguments="dismiss" content="" />
  </actions>
  <audio silent="true" />
</toast>`;
}

module.exports = { prepareIcon, setWindowDetails, decorateToastShortcut, toastXml };
