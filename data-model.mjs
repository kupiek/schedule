export const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const SHORT_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const DEFAULT_TEACHER_ID = 59;

export function normalizeRoom(raw) {
  return String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\d+)\s*([Кк])\s*[-–—]\s*([\p{L}\p{N}]+)/gu, (_, n, k, number) => `${n}К-${number}`)
    .toUpperCase();
}

export function splitRooms(raw) {
  const seen = new Set();
  return String(raw ?? '').split('//').map(normalizeRoom).filter(room => {
    if (!room || room === '-' || room === '—' || seen.has(room)) return false;
    seen.add(room);
    return true;
  });
}

export function normalizeName(name) {
  return String(name ?? '').replace(/[.\sЁё]/g, letter => letter === 'ё' ? 'е' : letter === 'Ё' ? 'Е' : '').toLocaleLowerCase('ru');
}

export function teacherDisplayName(raw) {
  const source = String(raw ?? '').trim();
  if (source.includes(' ') || source.includes('.')) return source;
  const match = source.match(/^(.+?)([А-ЯЁ])([А-ЯЁ])$/u);
  return match ? `${match[1]} ${match[2]}.${match[3]}.` : source;
}

export function groupName(group, year, month) {
  if (!group) return 'Неизвестная группа';
  const course = Number(group.course);
  const direction = String(group.shortName || '').trim();
  if (!Number.isFinite(course) || !direction) return `Группа №${group.id}`;
  const academicYear = year - (month < 9 ? 1 : 0);
  const admission = String(academicYear - course + 1).slice(-2);
  return `${course}${direction}-${admission}`;
}

export function iekDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Irkutsk', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  const day = new Date(Date.UTC(fields.year, fields.month - 1, fields.day)).getUTCDay();
  return { ...fields, weekday: day === 0 ? 7 : day };
}

function mondayTimestamp(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day - (parts.weekday - 1));
}

export function currentParity(data, date = new Date()) {
  const raw = String(data?.parityWeek ?? '').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  if (raw !== 'четная' && raw !== 'нечетная') return null;
  let parity = raw === 'четная' ? 0 : 1;
  if (data.generatedAt) {
    const start = iekDateParts(new Date(data.generatedAt));
    const today = iekDateParts(date);
    const weekDelta = Math.round((mondayTimestamp(today) - mondayTimestamp(start)) / 604800000);
    if (Math.abs(weekDelta % 2) === 1) parity = parity === 0 ? 1 : 0;
  }
  return parity;
}

export function activeForWeek(lesson, week) {
  return lesson.typeWeek == null || week == null || Number(lesson.typeWeek) === week;
}

export function usableLesson(lesson) {
  return Boolean(String(lesson.subject || lesson.edit?.subject || '').trim());
}

export function scheduleForWeek(lessons, parity) {
  return (lessons || []).filter(x => usableLesson(x) && activeForWeek(x, parity))
    .sort((a,b) => a.day - b.day || a.pair - b.pair || String(a.subject).localeCompare(String(b.subject),'ru'));
}

// A fixed weekly board: six days, exactly four regular pair rows per day.
// Keep both parity alternatives in the same row so inactive ones can be dimmed.
export function buildWeekBoard(lessons, activeParity) {
  const valid = scheduleForWeek(lessons, null);
  return Array.from({length: 6}, (_, dayIndex) => ({
    day: dayIndex + 1,
    rows: Array.from({length: 4}, (_, pairIndex) => ({
      pair: pairIndex + 1,
      entries: valid.filter(item => item.day === dayIndex + 1 && item.pair === pairIndex + 1)
        .map(item => ({...item, active: activeForWeek(item, activeParity)}))
        .sort((a,b) => (a.typeWeek ?? -1) - (b.typeWeek ?? -1))
    })),
    extra: valid.filter(item => item.day === dayIndex + 1 && item.pair > 4)
  }));
}

// A pair is either common for both weeks or consists of independent
// even/odd halves. Do not drop the empty half: it explains the week switch.
export function splitPairVariants(entries) {
  const common = [], even = [], odd = [];
  for (const item of entries || []) {
    if (item.typeWeek != null && Number(item.typeWeek) === 0) even.push(item);
    else if (item.typeWeek != null && Number(item.typeWeek) === 1) odd.push(item);
    else common.push(item);
  }
  return { common, even, odd, hasAlternatives: even.length > 0 || odd.length > 0 };
}

export function allRooms(data) {
  const found = new Set();
  for (const item of data?.groupLessons || []) {
    if (!usableLesson(item)) continue;
    for (const room of splitRooms(item.room)) found.add(room);
  }
  return [...found].sort((a,b) => a.localeCompare(b, 'ru', {numeric:true}));
}

export function roomLessons(data, room, parity = null) {
  const target = normalizeRoom(room);
  return scheduleForWeek((data?.groupLessons || []).filter(x => splitRooms(x.room).includes(target)), parity);
}

export function availableRooms(data, {day, pair, parity, corpus = ''}) {
  const rooms = allRooms(data);
  const busy = new Set();
  for (const lesson of data?.groupLessons || []) {
    if (!usableLesson(lesson) || lesson.day !== Number(day) || lesson.pair !== Number(pair) || !activeForWeek(lesson, parity)) continue;
    for (const room of splitRooms(lesson.room)) busy.add(room);
  }
  const filter = normalizeRoom(corpus);
  return rooms.filter(room => (!filter || room.startsWith(filter)) && !busy.has(room));
}

export function teacherSchedule(data, index) {
  return data?.teacherSchedules?.[String(index)] || [];
}

export function groupSchedule(data, groupId) {
  return (data?.groupLessons || []).filter(item => item.groupId === Number(groupId));
}

export function groupDictionary(data) {
  return new Map((data?.groups || []).map(group => [Number(group.id), group]));
}

export function labelForRoom(room) {
  return normalizeRoom(room).split('-')[0] || 'Другой';
}
