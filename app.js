import {
  DAYS, DEFAULT_TEACHER_ID, normalizeRoom, splitRooms, normalizeName,
  teacherDisplayName, groupName, iekDateParts, currentParity, scheduleForWeek,
  allRooms, roomLessons, availableRooms, teacherSchedule, groupSchedule, groupDictionary,
  buildWeekBoard
} from './data-model.mjs';

const app = document.querySelector('#app');
const statusBar = document.querySelector('#app-status');
const toastElement = document.querySelector('#toast');
const state = {
  data: null, view: 'mine', tab: 'groups', detail: null,
  search: '', inspected: null, displayedLessons: [], displayContext: '',
  freeDay: 1, freePair: 2, corpus: '',
  teacherId: readSavedTeacher(), installEvent: null
};
let toastTimeout;

const icons = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 18 6-6-6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M19 20h2v-2a5 5 0 0 0-4-4.9"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>',
  room: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V4a1 1 0 0 1 1-1h12v18M3 21h18M10 14h2M10 8h2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 10h18M8 2v5M16 2v5"/></svg>'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function readSavedTeacher() {
  try {
    const value = Number(localStorage.getItem('iek-teacher-index'));
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_TEACHER_ID;
  } catch { return DEFAULT_TEACHER_ID; }
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastElement.classList.remove('show'), 2800);
}

function stamp(date) {
  if (!date || Number.isNaN(new Date(date).getTime())) return 'неизвестно';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone:'Asia/Irkutsk', day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'
  }).format(new Date(date));
}

function updateStatus(error = '') {
  const data = state.data;
  if (error && !data) {
    statusBar.className = 'statusbar error';
    statusBar.querySelector('span:last-child').textContent = 'Нет данных: ' + error;
    return;
  }
  if (!data) return;
  if (data.initialized === false) {
    statusBar.className = 'statusbar stale';
    statusBar.querySelector('span:last-child').textContent = 'Ожидается первая загрузка расписания';
    return;
  }
  const age = new Date() - new Date(data.generatedAt);
  const incomplete = (data.meta?.groupErrors || 0) > 0 || (data.meta?.teacherErrors || 0) > 0;
  const outdated = !Number.isFinite(age) || age > 3 * 3600 * 1000;
  statusBar.className = 'statusbar ' + (outdated || incomplete ? 'stale' : 'ok');
  statusBar.querySelector('span:last-child').textContent = `${outdated ? 'Архивные данные' : 'Обновлено'}: ${stamp(data.generatedAt)} · Иркутск${incomplete ? ' · есть пропуски' : ''}`;
}

async function loadData(silent = false) {
  if (!silent) statusBar.querySelector('span:last-child').textContent = 'Загружаем расписание…';
  try {
    const response = await fetch('./data/schedule.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.groups) || !Array.isArray(data.groupLessons) || !Array.isArray(data.teachers)) {
      throw new Error('Некорректный формат данных');
    }
    const previousTimestamp = state.data?.generatedAt;
    state.data = data;
    updateStatus();
    render();
    if (silent) showToast(previousTimestamp === data.generatedAt ? 'Новых данных пока нет' : 'Расписание обновлено');
  } catch (error) {
    updateStatus(error.message);
    if (!state.data) app.innerHTML = `<section class="empty-state panel">${icons.empty}<strong>Не удалось загрузить расписание</strong><p>Проверьте подключение к интернету или попробуйте позже. Для работы без сети сначала откройте приложение с интернетом.</p><button class="primary-button" data-action="reload">Повторить</button></section>`;
    else if (silent) showToast('Не удалось обновить. Показана сохранённая версия.');
  }
}

function currentTeacherName() {
  const teacher = state.data?.teachers.find(t => t.id === state.teacherId);
  return teacherDisplayName(teacher?.name || 'Купряков Е.И.');
}

function currentLabel() {
  const now = currentParity(state.data);
  return now === null ? 'Чётность неизвестна' : now === 0 ? 'Сейчас чётная неделя' : 'Сейчас нечётная неделя';
}

function groupTitle(groupId) {
  const group = groupDictionary(state.data).get(Number(groupId));
  const now = iekDateParts();
  return groupName(group, now.year, now.month);
}

function lessonCard(item, context) {
  const extras = [];
  if (context !== 'group' && item.groupId != null) extras.push(`<span>${icons.users}${esc(groupTitle(item.groupId))}</span>`);
  if (context !== 'teacher' && item.teacher) extras.push(`<span>${icons.person}${esc(item.teacher)}</span>`);
  if (item.room) extras.push(`<span>${icons.pin}${esc(splitRooms(item.room).join(' · ') || item.room)}</span>`);
  const edit = item.edit;
  const editParts = [];
  if (edit?.room && normalizeRoom(edit.room) !== normalizeRoom(item.room)) editParts.push(`кабинет: ${esc(edit.room)}`);
  if (edit?.subject && edit.subject !== item.subject) editParts.push(`дисциплина: ${esc(edit.subject)}`);
  if (edit?.teacher && edit.teacher !== item.teacher) editParts.push(`преподаватель: ${esc(edit.teacher)}`);
  return `<article class="lesson">
    <div class="lesson-number" title="Номер пары">${esc(item.pair)}</div>
    <div class="lesson-main"><strong>${esc(item.subject || edit?.subject || 'Занятие')}</strong>
      <div class="lesson-details">${extras.join('')}</div>
      ${item.typeWeek == null ? '' : `<div class="lesson-secondary">${Number(item.typeWeek) === 0 ? 'По чётным неделям' : 'По нечётным неделям'}</div>`}
      ${edit ? `<div class="edit-note">Есть запись об изменении${editParts.length ? ' · ' + editParts.join('; ') : ''}. Дата действия не установлена.</div>` : ''}
    </div></article>`;
}

const PAIR_TIMES = [
  ['08:30–10:00','10:20–11:50','12:30–14:00','14:10–15:40'],
  ['08:30–10:00','10:20–11:50','12:30–14:00','14:10–15:40'],
  ['08:30–10:00','10:20–11:50','12:30–14:00','14:10–15:40'],
  ['08:30–10:00','10:20–11:50','12:30–14:00','14:10–15:40'],
  ['08:30–10:00','10:20–11:50','12:30–14:00','14:10–15:40'],
  ['08:30–10:00','10:10–11:40','12:10–13:40','13:50–15:20']
];

function dateForWeekDay(day) {
  const current = iekDateParts();
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day + day - current.weekday));
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'short',year:'2-digit'}).format(date);
}

function timetableEntry(item, context, split, day, pair) {
  const label = context === 'group' ? item.teacher || 'Преподаватель не указан' : groupTitle(item.groupId);
  const subject = item.subject || item.edit?.subject || 'Занятие';
  const room = splitRooms(item.room).join(' / ') || '—';
  const tag = item.typeWeek === 0 ? 'чёт.' : item.typeWeek === 1 ? 'нечёт.' : '';
  const caption = `${DAYS[day-1]}, ${pair}-я пара. ${label}. ${subject}. ${room}. ${tag}`;
  return `<button class="timetable-entry ${item.active ? 'entry-active' : 'entry-inactive'}" type="button"
    data-action="inspect-slot" data-day="${day}" data-pair="${pair}" title="${esc(caption)}" aria-label="${esc(caption)}">
      <span class="entry-person">${esc(label)}</span>
      <span class="entry-subject">${esc(subject)}</span>
      <span class="entry-room">${item.edit?.room && normalizeRoom(item.edit.room) !== normalizeRoom(item.room) ? '<span class="room-change" title="В API есть запись об изменении аудитории">✦</span>' : ''}${esc(room)}</span>
      ${tag ? `<span class="entry-week-tag ${split ? 'is-split' : ''}">${tag}</span>` : ''}
    </button>`;
}

function schedulePanels(lessons, context) {
  const today = iekDateParts().weekday;
  const board = buildWeekBoard(lessons, currentParity(state.data));
  state.displayedLessons = lessons;
  state.displayContext = context;
  const renderDay = ({day,rows,extra}) => `<section class="timetable-day ${day === today ? 'timetable-today' : ''}" id="day-${day}">
    <div class="timetable-day-heading"><span class="timetable-dot"></span><h3>${DAYS[day-1]}</h3><span class="timetable-date">${esc(dateForWeekDay(day))}</span>${day === today ? '<span class="timetable-today-label">Сегодня</span>' : ''}</div>
    <div class="timetable-table">${rows.map(({pair,entries}) => {
      const split = entries.length > 1;
      return `<div class="timetable-row ${entries.some(item => item.active) ? 'has-current' : ''}">
        <div class="pair-column"><strong>${pair} пара</strong><span>${PAIR_TIMES[day-1][pair-1]}</span></div>
        <div class="timetable-cell ${split ? 'is-divided' : ''}">
          ${entries.length ? entries.map(item => timetableEntry(item,context,split,day,pair)).join('') : '<span class="slot-blank" aria-label="Нет занятий"></span>'}
        </div></div>`;
    }).join('')}</div>
    ${extra.length ? `<div class="extra-note">В расписании также есть ${extra.length} ${pairWord(extra.length)} после 4-й пары. Они доступны в исходных данных, но не входят в сетку из четырёх строк.</div>` : ''}
  </section>`;
  return `<div class="timetable-board" aria-label="Расписание на шесть дней: понедельник–среда слева, четверг–суббота справа">
    <div class="timetable-column">${board.slice(0,3).map(renderDay).join('')}</div>
    <div class="timetable-column">${board.slice(3).map(renderDay).join('')}</div>
  </div>`;
}

function renderSlotDialog() {
  if (!state.inspected) return '';
  const {day,pair,context,entries} = state.inspected;
  return `<div class="slot-overlay" data-action="close-slot"><section class="slot-dialog" role="dialog" aria-modal="true" aria-label="Занятия на ${pair}-й паре">
    <div class="slot-dialog-heading"><div><div class="eyebrow">${esc(DAYS[day-1])} · ${pair}-я пара</div><h2>Сведения о занятии</h2></div><button type="button" class="icon-button" data-action="close-slot" aria-label="Закрыть">×</button></div>
    <div class="slot-dialog-lessons">${entries.map(item => `<div class="slot-dialog-variant ${item.active ? '' : 'is-inactive'}">${item.typeWeek === null ? '<span class="badge">Каждую неделю</span>' : `<span class="badge">${item.typeWeek === 0 ? 'Чётная неделя' : 'Нечётная неделя'}${item.active ? ' · сейчас' : ' · не сейчас'}</span>`}${lessonCard(item,context)}</div>`).join('')}</div>
  </section></div>`;
}

function pairWord(n) {
  const mod10 = n % 10;
  return n % 100 >= 11 && n % 100 <= 14 || mod10 === 0 || mod10 >= 5 ? 'пар' : mod10 === 1 ? 'пара' : 'пары';
}

function renderMine() {
  const lessons = teacherSchedule(state.data, state.teacherId);
  return `<section class="compact-intro"><div><div class="eyebrow">Моё расписание · вся неделя</div><h1>${esc(currentTeacherName())}</h1></div>
    <div class="current-week"><span class="week-indicator"></span>${esc(currentLabel())}</div>
  </section>
  ${schedulePanels(lessons,'teacher')}
  <p class="board-footnote">Занятия другой чётности показаны приглушённым цветом. Нажмите на занятие, чтобы увидеть полные сведения. Время пар задано по референсу и не поступает из API.</p>`;
}

const CATEGORY_ITEMS = [
  {id:'groups',label:'Группы',description:'Все направления',icon:'users'},
  {id:'teachers',label:'Преподаватели',description:'Расписание коллег',icon:'person'},
  {id:'free',label:'Свободные',description:'Поиск аудитории',icon:'search'},
  {id:'rooms',label:'Кабинеты',description:'Расписание помещений',icon:'room'}
];

function renderDirectory() {
  const categories = CATEGORY_ITEMS.map(c => `<button class="category ${state.tab === c.id ? 'active' : ''}" data-action="tab" data-value="${c.id}" aria-pressed="${state.tab === c.id}">${icons[c.icon]}<strong>${c.label}</strong><span>${c.description}</span></button>`).join('');
  return `<div class="header-area"><div><div class="eyebrow">Справочник колледжа</div><h1>Обзор расписания</h1><p class="subhead">Группы, преподаватели и аудитории в одном месте.</p></div></div>
    <div class="directory-categories">${categories}</div>
    <section id="directory-content">${state.detail ? renderDetail() : renderTab()}</section>`;
}

function renderTab() {
  if (state.tab === 'groups') {
    return `<div class="page-card"><h2>Все группы</h2><p class="subhead">Выберите группу, чтобы открыть её расписание.</p>
      <div style="margin:19px 0"><label class="field-label" for="directory-search">Поиск по группе</label><input class="input" id="directory-search" type="search" placeholder="Например, 2ТИТО или КСК" value="${esc(state.search)}" autocomplete="off"></div><div id="directory-results">${renderListResults()}</div></div>`;
  }
  if (state.tab === 'teachers') {
    return `<div class="page-card"><h2>Все преподаватели</h2><p class="subhead">Используются исходные индексы преподавателей из API.</p>
      <div style="margin:19px 0"><label class="field-label" for="directory-search">Поиск по ФИО</label><input class="input" id="directory-search" type="search" placeholder="Например, Купряков" value="${esc(state.search)}" autocomplete="off"></div><div id="directory-results">${renderListResults()}</div></div>`;
  }
  if (state.tab === 'rooms') {
    return `<div class="page-card"><h2>Расписание кабинета</h2><p class="subhead">Выберите аудиторию из списка помещений, найденных в расписании.</p>
      <div style="margin:19px 0"><label class="field-label" for="directory-search">Номер кабинета</label><input class="input" id="directory-search" type="search" placeholder="Например, 2К-309" value="${esc(state.search)}" autocomplete="off"></div><div id="directory-results">${renderListResults()}</div></div>`;
  }
  return renderFreeRooms();
}

function renderListResults() {
  const query = normalizeName(state.search);
  let items = [];
  if (state.tab === 'groups') {
    const today = iekDateParts();
    items = state.data.groups.map(group => ({id:group.id,title:groupName(group,today.year,today.month),meta:group.visible ? `${group.course} курс` : 'Скрыта в API'}))
      .sort((a,b) => a.title.localeCompare(b.title,'ru',{numeric:true}));
  } else if (state.tab === 'teachers') {
    items = state.data.teachers.filter(t => t.name).map(t => ({id:t.id,title:teacherDisplayName(t.name),meta:`Преподаватель · №${t.id}`}));
  } else if (state.tab === 'rooms') {
    items = allRooms(state.data).map(room => ({id:room,title:room,meta:'Расписание аудитории'}));
  }
  items = items.filter(item => normalizeName(item.title).includes(query));
  return `<div class="result-count">Найдено: ${items.length}</div><div class="result-grid">${items.map(item => `<button class="result-row" data-action="open-detail" data-value="${esc(item.id)}"><span><strong>${esc(item.title)}</strong><small>${esc(item.meta)}</small></span>${icons.arrow}</button>`).join('')}</div>${items.length ? '' : `<div class="empty-state">${icons.search}<strong>Ничего не найдено</strong><p>Попробуйте изменить запрос.</p></div>`}`;
}

function selectionOptions(values, current) {
  return values.map(({value,label}) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function renderFreeRooms() {
  const rooms = allRooms(state.data);
  const corpuses = [...new Set(rooms.map(room => room.match(/^\d+К/u)?.[0]).filter(Boolean))].sort();
  const allPairs = state.data.groupLessons.map(x => Number(x.pair) || 0);
  const maxPair = Math.max(4, ...allPairs);
  const selected = availableRooms(state.data,{day:state.freeDay,pair:state.freePair,parity:currentParity(state.data),corpus:state.corpus});
  const groupErrors = Number(state.data.meta?.groupErrors || 0);
  return `<div class="page-card"><h2>Свободные кабинеты</h2><p class="subhead">Поиск помещений, в которых нет запланированных занятий на выбранную пару.</p>
    <div class="filters" style="margin-top:20px">
      <label><span class="field-label">День недели</span><select class="select" id="free-day">${selectionOptions(DAYS.map((day,i)=>({value:i+1,label:day})),state.freeDay)}</select></label>
      <label><span class="field-label">Номер пары</span><select class="select" id="free-pair">${selectionOptions(Array.from({length:maxPair},(_,i)=>({value:i+1,label:`${i+1}-я пара`})),state.freePair)}</select></label>
      <label class="filter-wide"><span class="field-label">Корпус</span><select class="select" id="free-corpus">${selectionOptions([{value:'',label:'Все корпуса'},...corpuses.map(name=>({value:name,label:name}))],state.corpus)}</select></label>
    </div>
    <div class="notice info">${esc(currentLabel())}. Свободные кабинеты определяются автоматически для текущей чётности.</div>
    <div class="notice">В списке только кабинеты, встречающиеся в API. Отсутствие занятия не гарантирует фактическую доступность помещения.${groupErrors ? ` Не удалось обновить расписание ${groupErrors} групп: результат может быть неполным.` : ''}</div>
    <div class="section-intro"><h3>Подходящие аудитории</h3><span class="badge free">${selected.length} найдено</span></div>
    ${selected.length ? `<div class="room-grid">${selected.map(room=>`<button class="room-card" data-action="open-room" data-value="${esc(room)}"><strong>${esc(room)}</strong><span>Посмотреть расписание →</span></button>`).join('')}</div>` : `<div class="empty-state">${icons.empty}<strong>Свободных кабинетов не найдено</strong><p>Попробуйте другую пару, день или корпус.</p></div>`}
  </div>`;
}

function renderDetail() {
  const detail = state.detail;
  let title = '', subtitle = '', lessons = [], context = '';
  if (detail.type === 'groups') {
    title = groupTitle(Number(detail.id));
    subtitle = 'Расписание учебной группы';
    lessons = groupSchedule(state.data,detail.id);
    context = 'group';
  } else if (detail.type === 'teachers') {
    title = teacherDisplayName(state.data.teachers.find(t => t.id === Number(detail.id))?.name || `Преподаватель №${detail.id}`);
    subtitle = 'Расписание преподавателя';
    lessons = teacherSchedule(state.data,Number(detail.id));
    context = 'teacher';
  } else {
    title = normalizeRoom(detail.id);
    subtitle = 'Расписание кабинета · по всем группам';
    lessons = roomLessons(state.data,detail.id);
    context = 'room';
  }
  return `<button class="detail-back" data-action="back">${icons.back} Вернуться к списку</button>
    <div class="detail-heading"><div class="eyebrow">${esc(subtitle)}</div><h1>${esc(title)}</h1></div>
    <div class="toolbar-sub" style="margin-bottom:14px">${esc(currentLabel())} · занятия другой недели приглушены</div>
    ${detail.type === 'rooms' ? '<div class="notice info">Расписание кабинета вычислено по групповым расписаниям. При наличии изменений аудитории проверьте пометки у занятий.</div>' : ''}
    ${schedulePanels(lessons,context)}`;
}

function renderSettings() {
  const myTeacher = currentTeacherName();
  return `<div class="header-area"><div><div class="eyebrow">Параметры</div><h1>Настройки</h1><p class="subhead">Персонализация и сведения о данных.</p></div></div>
    <section class="page-card"><h2>Моё расписание</h2><p class="subhead">Преподаватель, расписание которого открывается на главном экране.</p>
      <label class="field-label" for="preferred-teacher" style="margin-top:20px">Преподаватель</label>
      <select class="select" id="preferred-teacher">${selectionOptions(state.data.teachers.filter(t=>t.name).map(t=>({value:t.id,label:teacherDisplayName(t.name)})),state.teacherId)}</select>
      <p class="subhead" style="font-size:12px">Сейчас: ${esc(myTeacher)}. Выбор сохраняется только в этом браузере.</p>
    </section>
    <section class="page-card" style="margin-top:15px"><h2>Данные расписания</h2>
      <div class="stat-row" style="margin-top:16px"><div class="stat"><b>${state.data.groups.length}</b><span>групп</span></div><div class="stat"><b>${state.data.teachers.filter(t=>t.name).length}</b><span>преподавателей</span></div><div class="stat"><b>${allRooms(state.data).length}</b><span>известных кабинетов</span></div><div class="stat"><b>${state.data.groupLessons.length}</b><span>записей занятий групп</span></div></div>
      <p class="subhead" style="font-size:12px;margin-top:10px">Последняя синхронизация: ${esc(stamp(state.data.generatedAt))} (Иркутск). Время обновления зависит от GitHub Actions, а не от нажатия кнопки обновления.</p>
      <div class="notice info" style="margin-top:16px">Данные открытого API ИЭК представлены как регулярное недельное расписание. Разовые замены и подтверждённая свободная аудитория не гарантируются.</div>
      <button class="primary-button" data-action="reload">Проверить обновления</button>
    </section>
    <section class="page-card" style="margin-top:15px"><h2>Установить на устройство</h2><p class="subhead">Приложение поддерживает установку на главный экран и просмотр уже загруженных данных без интернета.</p>
      <button class="primary-button" data-action="install" style="margin-top:17px" ${state.installEvent ? '' : 'disabled'}>Установить PWA</button>
      ${state.installEvent ? '' : '<p class="subhead" style="font-size:12px">Если кнопка недоступна: откройте меню браузера и выберите «Установить приложение» или «На экран Домой».</p>'}
    </section>`;
}

function render() {
  if (!state.data) return;
  for (const nav of document.querySelectorAll('.nav-item')) {
    const active = nav.dataset.view === state.view;
    nav.classList.toggle('active',active);
    if (active) nav.setAttribute('aria-current','page'); else nav.removeAttribute('aria-current');
  }
  const firstSyncNote = state.data.initialized === false ? '<div class="notice">Данные ещё не загружены. Запустите workflow «Refresh schedule and deploy PWA» во вкладке Actions вашего репозитория GitHub.</div>' : '';
  app.innerHTML = firstSyncNote + (state.view === 'mine' ? renderMine() : state.view === 'directory' ? renderDirectory() : renderSettings()) + renderSlotDialog();
}

document.querySelectorAll('.nav-item').forEach(nav => nav.addEventListener('click', () => {
  state.view = nav.dataset.view;
  state.detail = null;
  state.inspected = null;
  state.search = '';
  if (state.view === 'directory') state.freeDay = iekDateParts().weekday === 7 ? 1 : iekDateParts().weekday;
  render();
  scrollTo({top:0,behavior:'instant'});
}));

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close-slot' && button.classList.contains('slot-overlay') && event.target !== button) return;
  const value = button.dataset.value;
  if (action === 'reload') return loadData(true);
  if (action === 'inspect-slot') {
    const day = Number(button.dataset.day);
    const pair = Number(button.dataset.pair);
    const entries = buildWeekBoard(state.displayedLessons,currentParity(state.data))[day-1].rows[pair-1].entries;
    state.inspected = {day,pair,entries,context:state.displayContext};
  }
  if (action === 'close-slot') state.inspected = null;
  if (action === 'tab') {state.tab=value;state.detail=null;state.search='';}
  if (action === 'open-detail') state.detail = {type:state.tab,id:value};
  if (action === 'open-room') {state.tab='rooms';state.detail={type:'rooms',id:value};state.search='';}
  if (action === 'back') state.detail=null;
  if (action === 'install' && state.installEvent) {
    const prompt = state.installEvent;
    state.installEvent = null;
    await prompt.prompt();
    return render();
  }
  render();
  if (['tab','open-detail','open-room','back'].includes(action)) scrollTo({top:0,behavior:'instant'});
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.inspected) { state.inspected = null; render(); }
});

app.addEventListener('input', event => {
  if (event.target.id === 'directory-search') {
    state.search = event.target.value;
    const results = app.querySelector('#directory-results');
    if (results) results.innerHTML = renderListResults();
  }
});

app.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'free-day') state.freeDay = Number(target.value);
  else if (target.id === 'free-pair') state.freePair = Number(target.value);
  else if (target.id === 'free-corpus') state.corpus = target.value;
  else if (target.id === 'preferred-teacher') {
    state.teacherId = Number(target.value);
    try { localStorage.setItem('iek-teacher-index',String(state.teacherId)); } catch { /* storage may be disabled */ }
    showToast('Преподаватель изменён');
  } else return;
  render();
});

document.querySelector('#reload-button').addEventListener('click',()=>loadData(true));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installEvent=event;if(state.view==='settings')render();});
window.addEventListener('appinstalled',()=>{state.installEvent=null;showToast('Приложение установлено');if(state.view==='settings')render();});
window.addEventListener('online',()=>{if(state.data)loadData(true);});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.data) { updateStatus(); render(); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
state.freeDay = iekDateParts().weekday === 7 ? 1 : iekDateParts().weekday;
loadData();
