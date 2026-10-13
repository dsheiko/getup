# Getup

Because of osteochondrosis, I was given this advice.

Every 30–45 minutes:

stand up;
walk around for 1–2 minutes;
slowly turn your head left and right a few times;
relax your shoulders;
move your shoulder blades a few times;
look at something far away.
Don't turn it into a workout. The point is to break up 3–4 hours of continuous sitting.

## What the app does

It lives in the system tray. The tray icon is the app icon, and its edge fills up while you sit: blue means the countdown is running, a yellow edge and dot mean it's time to stand up, red means you've been sitting 15+ minutes past that, green means you're on a break, and a grey pause badge means reminders are paused.

- **Reminder** every 30, 35, 40 or 45 minutes (set in Settings). A notification plus a window with a short checklist from the advice above. The window appears without taking focus, so it doesn't interrupt your typing. The notification is a regular Windows notification and disappears by itself after 30 seconds.
- **If you ignore it**, it reminds you again after 10 minutes. The "In 5 min" button snoozes it for 5.
- **Breaks are counted automatically**: 3 minutes without the mouse and keyboard (90 seconds once a break is due), a screen lock longer than a minute, or sleep. Or press "Done" when it's time. Windows itself reports idle time and screen locks. There are no reminders while the screen is locked. If the lock was short, the reminder comes right after unlocking.
- **"Log a break"** starts a break, and the button changes to "End break". The break lasts until you press it, or until you come back to the computer after 90+ seconds away from the mouse and keyboard. This way the break shows up in the day's timeline.
- **Pause**: the button in the window pauses until you press "Resume"; the tray menu also pauses for 30 min, 1 hour or 2 hours. The countdown to the break stands still during the pause and continues from the same point afterwards. If a break was already due, it reminds you right away. Sitting time still counts in the day's stats. Handy for calls.
- **Today**: number of breaks, the longest stretch without a break, and the day's timeline. Green up to 45 minutes, yellow 45–90, red over 90.
- **7 days**: the longest stretch for each day.
- English by default, Russian can be chosen in Settings. Light and dark theme (follows the system).
- **Start with Windows** (straight to the tray, without the window). If you turn off startup in Task Manager or in Settings → Apps → Startup, the setting in the app turns off too.

Windows only shows notifications from an app that has a Start menu shortcut. Electron creates it by itself and names it after the `.exe`, so when run with `npm start` it's called "Electron". Getup gives it its own icon and makes it start Getup, but the name stays "Electron", and so does the name in the notification header. A packaged build (an `.exe` with the product name "Getup") shows "Getup" everywhere. The taskbar button uses Getup's own icon and name either way. If you move the project folder, the shortcut and the startup entry are updated on the next launch.

History is kept in `getup.json` in `%APPDATA%\Getup`, for the last 60 days.

The app used to be called Stand-up. On the first run after the rename, Getup copies the history and settings from `%APPDATA%\Stand-up\stand-up.json`; the old folder is left as it was and can be deleted. The internal Windows IDs (`stand-up.reminder`, `stand-up.window`) are kept on purpose: with them, the new installer upgrades an existing install, and the startup entry and taskbar pins keep working.

To clear the break history, run the app with `--clear-history`. Settings and the current countdown are kept. If Getup is already running, it clears its history and shows the window:

```
npx electron . --clear-history                              # from the project folder
& "$env:LOCALAPPDATA\Programs\getup\Getup.exe" --clear-history   # installed build
```

```
npm start       # run
npm run debug   # run with a reminder every 5 minutes
npm test        # tests for the break logic
npm run dist    # Windows installer in dist\ (Getup Setup <version>.exe)
.\make-icons.ps1  # remake the icons in src\ from icon-big.png
```

For testing, you can set the interval in minutes (fractions allowed) with the `--interval` parameter or an environment variable. It takes priority over the setting; without it, the interval from Settings is used (30 minutes by default):

```
npx electron . --interval=0.5          # any shell
$env:GETUP_INTERVAL=5; npm start       # PowerShell
set GETUP_INTERVAL=5 && npm start      # cmd
```
