// Shared strings and formatting: loaded both in main (require) and in the window (<script>)
(function (root) {
  const MIN = 60 * 1000;

  const STRINGS = {
    en: {
      locale: "en-GB",
      units: { h: "h", min: "min", m: "m" },
      every: (min) => `Reminders every ${min} min`,
      settings: "Settings",
      back: "Back",

      ringUntil: "until break",
      ringSitting: "sitting",
      ringOnBreak: "break",
      nextBreakAt: (time) => `Next break at ${time}`,
      lastBreak: (time, length) => (length ? `Last break at ${time}, ${length}` : `Last break at ${time}`),
      timeToStand: "Time to stand up",
      dueDetail: "A couple of minutes is enough.",
      remindAgainAt: (time) => `Next reminder at ${time}`,
      onBreak: "On a break",
      awayDetail: "The timer starts over when you're back.",
      manualBreakDetail: "Ends when you're back at the computer, or press End break.",
      pausedUntil: (time) => `Paused until ${time}`,
      pausedForever: "Reminders paused",
      timerStopped: "Countdown stopped. It continues after the pause.",

      logBreak: "Log a break",
      endBreak: "End break",
      done: "Done",
      snooze: "In 5 min",
      pause: "Pause",
      resume: "Resume",
      pauseFor: (min) => {
        if (min === null) {
          return "Until I resume";
        }
        return min < 60 ? `For ${min} min` : `For ${min / 60} h`;
      },

      checklistTitle: "Short break",
      checklist: [
        "Stand up",
        "Walk around for 1–2 minutes",
        "Slowly turn your head left and right a few times",
        "Relax your shoulders",
        "Move your shoulder blades a few times",
        "Look at something far away",
      ],
      checklistNote: "Not a workout. The point is to break up long sitting.",

      tabToday: "Today",
      tabWeek: "7 days",
      breaks: "Breaks",
      longest: "Longest stretch",
      total: "Total sitting",
      legendGood: "up to 45 min",
      legendLong: "45–90 min",
      legendTooLong: "over 90 min",
      now: "now",
      stretchList: "All stretches",
      weekTitle: "Longest stretch per day",
      target: "45 min",

      intervalLabel: "Remind every",
      intervalHint: "Recommended: every 30–45 minutes.",
      showWindow: "Bring up this window when it's time",
      showWindowHint: "Notifications are easy to miss.",
      sound: "Play a sound",
      soundHint: "A short chime when it's time to stand up.",
      openAtLogin: { win32: "Start with Windows", darwin: "Open at login" },
      language: "Language",
      breakRules: "Counts as a break: 3 minutes away from the mouse and keyboard (90 seconds once a break is due), locking the screen, sleep, or the Done button.",
      aboutText: "A tray reminder to get up and move every 30–45 minutes.",
      aboutAuthor: "Created by Dmitry Sheiko",

      trayOpen: "Open Getup",
      trayPause: "Pause reminders",
      trayResume: "Resume reminders",
      quit: "Quit",
      tipUntilBreak: (length) => `${length} until a break`,
      tipDue: (length) => `Time to stand up, sitting ${length}`,
      notifyTitle: "Time to stand up 🧍",
      notifyAgain: (length) => `Still sitting: ${length}`,
      notifyBody: "Walk 1–2 min • turn your head • relax shoulders • shoulder blades • look far away",
      runningTitle: "Getup is running",
      runningBody: "It lives in the system tray.",
    },

    ru: {
      locale: "ru-RU",
      units: { h: "ч", min: "мин", m: "м" },
      every: (min) => `Напоминания каждые ${min} мин`,
      settings: "Настройки",
      back: "Назад",

      ringUntil: "до перерыва",
      ringSitting: "сидишь",
      ringOnBreak: "перерыв",
      nextBreakAt: (time) => `Следующий перерыв в ${time}`,
      lastBreak: (time, length) => (length ? `Последний перерыв в ${time}, ${length}` : `Последний перерыв в ${time}`),
      timeToStand: "Пора встать",
      dueDetail: "Хватит пары минут.",
      remindAgainAt: (time) => `Следующее напоминание в ${time}`,
      onBreak: "На перерыве",
      awayDetail: "Когда вернёшься, отсчёт начнётся заново.",
      manualBreakDetail: "Закончится, когда вернёшься к компьютеру, или нажми «Закончить перерыв».",
      pausedUntil: (time) => `Пауза до ${time}`,
      pausedForever: "Напоминания на паузе",
      timerStopped: "Отсчёт остановлен. Он продолжится после паузы.",

      logBreak: "Начать перерыв",
      endBreak: "Закончить перерыв",
      done: "Готово",
      snooze: "Через 5 мин",
      pause: "Пауза",
      resume: "Продолжить",
      pauseFor: (min) => {
        if (min === null) {
          return "Пока не включу";
        }
        if (min < 60) {
          return `На ${min} мин`;
        }
        return min === 60 ? "На 1 час" : `На ${min / 60} часа`;
      },

      checklistTitle: "Короткий перерыв",
      checklist: [
        "Встать",
        "Пройтись 1–2 минуты",
        "Медленно повернуть голову влево и вправо несколько раз",
        "Расслабить плечи",
        "Несколько раз подвигать лопатками",
        "Посмотреть на что-нибудь вдали",
      ],
      checklistNote: "Это не тренировка. Смысл в том, чтобы прерывать долгое сидение.",

      tabToday: "Сегодня",
      tabWeek: "7 дней",
      breaks: "Перерывы",
      longest: "Дольше всего",
      total: "Всего сидя",
      legendGood: "до 45 мин",
      legendLong: "45–90 мин",
      legendTooLong: "больше 90 мин",
      now: "сейчас",
      stretchList: "Все отрезки",
      weekTitle: "Самый долгий отрезок за день",
      target: "45 мин",

      intervalLabel: "Напоминать каждые",
      intervalHint: "Рекомендация: каждые 30–45 минут.",
      showWindow: "Показывать это окно, когда пора",
      showWindowHint: "Уведомление легко пропустить.",
      sound: "Звуковой сигнал",
      soundHint: "Короткий сигнал, когда пора встать.",
      openAtLogin: { win32: "Запускать вместе с Windows", darwin: "Открывать при входе" },
      language: "Язык",
      breakRules: "Перерывом считается: 3 минуты без мыши и клавиатуры (90 секунд, если перерыв уже пора), блокировка экрана, сон или кнопка «Готово».",
      aboutText: "Напоминание в трее: вставать и двигаться каждые 30–45 минут.",
      aboutAuthor: "Автор: Дмитрий Шейко",

      trayOpen: "Открыть Getup",
      trayPause: "Приостановить напоминания",
      trayResume: "Продолжить напоминания",
      quit: "Выход",
      tipUntilBreak: (length) => `До перерыва ${length}`,
      tipDue: (length) => `Пора встать, сидишь ${length}`,
      notifyTitle: "Пора встать 🧍",
      notifyAgain: (length) => `Всё ещё сидишь: ${length}`,
      notifyBody: "Пройдись 1–2 мин • повороты головы • расслабь плечи • лопатки • посмотри вдаль",
      runningTitle: "Getup запущен",
      runningBody: "Он работает в системном трее.",
    },
  };

  const pad = (n) => String(n).padStart(2, "0");

  function formatTime(ms) {
    const date = new Date(ms);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 1 h 5 min / 1 ч 5 мин; compact: 1h 5m / 1ч 5м
  function formatDuration(ms, lang, isCompact = false) {
    const units = STRINGS[lang].units;
    const total = Math.max(0, Math.round(ms / MIN));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    const sep = isCompact ? "" : " "; // non-breaking space: keeps the unit on the same line as the number
    const minUnit = isCompact ? units.m : units.min;
    if (!hours) {
      return `${minutes}${sep}${minUnit}`;
    }
    return minutes ? `${hours}${sep}${units.h} ${minutes}${sep}${minUnit}` : `${hours}${sep}${units.h}`;
  }

  // 04:59 / 1:04:59
  function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  const api = { STRINGS, formatTime, formatDuration, formatClock };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GetupI18n = api;
  }
})(this);
