// Trading sessions for every market we cover.
//
// A price means something different at 10am than at midnight. This says, per market and
// per moment, whether the exchange is open, in a lunch break, or shut for the weekend —
// and how long until the next state. Holidays are not modelled; that limitation is stated
// rather than hidden.

export type Phase = 'open' | 'lunch' | 'pre' | 'after' | 'closed';

export interface SessionState {
  market: string;
  phase: Phase;
  label: string;
  /** Minutes until the next phase change. */
  minutesToChange: number;
  nextChangeAt: string;
  localTime: string;
  timezone: string;
  isTradingDay: boolean;
}

interface Hours {
  code: string;
  timezone: string;
  /** Minutes from local midnight. */
  open: number; close: number;
  lunch?: [number, number];
  pre?: [number, number];
  after?: [number, number];
}

const h = (hh: number, mm = 0): number => hh * 60 + mm;

export const MARKET_HOURS: Hours[] = [
  { code: 'IN', timezone: 'Asia/Kolkata', open: h(9, 15), close: h(15, 30), pre: [h(9), h(9, 15)] },
  { code: 'US', timezone: 'America/New_York', open: h(9, 30), close: h(16), pre: [h(4), h(9, 30)], after: [h(16), h(20)] },
  { code: 'GB', timezone: 'Europe/London', open: h(8), close: h(16, 30) },
  { code: 'JP', timezone: 'Asia/Tokyo', open: h(9), close: h(15), lunch: [h(11, 30), h(12, 30)] },
  { code: 'DE', timezone: 'Europe/Berlin', open: h(9), close: h(17, 30) },
  { code: 'SG', timezone: 'Asia/Singapore', open: h(9), close: h(17), lunch: [h(12), h(13)] },
  { code: 'HK', timezone: 'Asia/Hong_Kong', open: h(9, 30), close: h(16), lunch: [h(12), h(13)] },
  { code: 'AU', timezone: 'Australia/Sydney', open: h(10), close: h(16) },
  { code: 'CA', timezone: 'America/Toronto', open: h(9, 30), close: h(16) },
];

const DAY = 24 * 60;

export function formatSpan(minutes: number): string {
  if (minutes <= 0) return 'now';
  const d = Math.floor(minutes / DAY);
  const hrs = Math.floor((minutes % DAY) / 60);
  const mins = Math.round(minutes % 60);
  if (d > 0) return `${d}d ${hrs}h`;
  return hrs > 0 ? `${hrs}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
}

/** Local wall clock for a market at a given instant. */
export function localClock(timezone: string, at: Date): { weekday: number; minutes: number; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts['weekday']));
  const minutes = Number(parts['hour']) * 60 + Number(parts['minute']);
  return { weekday, minutes, time: `${String(parts['hour']).padStart(2, '0')}:${String(parts['minute']).padStart(2, '0')}` };
}

const isWeekday = (d: number): boolean => d >= 1 && d <= 5;

export function sessionFor(code: string, at: Date = new Date()): SessionState | null {
  const m = MARKET_HOURS.find((x) => x.code === code.toUpperCase());
  if (!m) return null;
  const { weekday, minutes, time } = localClock(m.timezone, at);
  const trading = isWeekday(weekday);

  const result = (phase: Phase, label: string, toChange: number): SessionState => ({
    market: m.code, phase, label, minutesToChange: Math.max(0, Math.round(toChange)),
    nextChangeAt: new Date(at.getTime() + Math.max(0, toChange) * 60_000).toISOString(),
    localTime: time, timezone: m.timezone, isTradingDay: trading,
  });

  if (trading) {
    if (m.lunch && minutes >= m.lunch[0] && minutes < m.lunch[1]) {
      return result('lunch', `Lunch break · reopens in ${formatSpan(m.lunch[1] - minutes)}`, m.lunch[1] - minutes);
    }
    if (minutes >= m.open && minutes < m.close) {
      // Inside the session but possibly inside lunch, which is handled above.
      const inLunch = m.lunch && minutes >= m.lunch[0] && minutes < m.lunch[1];
      if (!inLunch) return result('open', `Open · closes in ${formatSpan(m.close - minutes)}`, m.close - minutes);
    }
    if (m.pre && minutes >= m.pre[0] && minutes < m.pre[1]) {
      return result('pre', `Pre-market · opens in ${formatSpan(m.pre[1] - minutes)}`, m.pre[1] - minutes);
    }
    if (m.after && minutes >= m.after[0] && minutes < m.after[1]) {
      return result('after', `After hours · ends in ${formatSpan(m.after[1] - minutes)}`, m.after[1] - minutes);
    }
    if (minutes < m.open) {
      return result('closed', `Closed · opens in ${formatSpan(m.open - minutes)}`, m.open - minutes);
    }
    if (minutes >= m.close) {
      // Roll to the next trading day's open.
      let days = 1;
      while (!isWeekday((weekday + days) % 7)) days++;
      const toChange = (days * DAY + m.open) - minutes;
      return result('closed', `Closed · opens in ${formatSpan(toChange)}`, toChange);
    }
  }

  let days = 1;
  while (!isWeekday((weekday + days) % 7)) days++;
  const toChange = (days * DAY + m.open) - minutes;
  return result('closed', `Closed · opens in ${formatSpan(toChange)}`, toChange);
}

export function allSessions(at: Date = new Date()): SessionState[] {
  return MARKET_HOURS.map((m) => sessionFor(m.code, at)).filter((s): s is SessionState => s !== null);
}
