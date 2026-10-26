// 콕 (근무 달력, 예전 이름 "근무콕" · "품") — 여러 매장이 각자 매장을 등록해서 쓰는 버전 (GitHub Pages + Firebase)
// 매장마다 데이터는 Firebase 의 stores/{매장 코드}/ 아래에 따로 저장되고, 이 브라우저의 localStorage 는 캐시로만 쓴다.

const TIME_ZONE = "Asia/Seoul";
const APP_NAME = "콕";
const LAST_STORE_KEY = "shift-calendar:store";
// 이 기기에서 쓰는 매장 코드: 주소에 ?s=코드 가 있으면 그것, 없으면 마지막으로 쓴 매장
let storeId = initStoreId();
const storeKey = () => `shift-calendar:${storeId}`;
const DEFAULT_WAGE = 10320; // 2026년 최저시급
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_VISIBLE = 5;
const PANEL_ANIM_MS = 320;

// 2026년 대한민국 법정공휴일 (대체공휴일 포함)
const HOLIDAYS = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "대체공휴일",
  "2026-05-01": "노동절",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "대체공휴일",
  "2026-06-06": "현충일",
  "2026-07-17": "제헌절",
  "2026-08-15": "광복절",
  "2026-08-17": "대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "크리스마스",
};

// ---------- 날짜 ----------

function dateStringFor(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayDateString() {
  return dateStringFor(new Date());
}

function formatTime(iso) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, (new Date(end) - new Date(start)) / 3_600_000);
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 해당 날짜(KST)의 "HH:MM" 시각을 ISO 문자열로
function kstIso(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+09:00`).toISOString();
}

// 근무 종료 시각 (종료가 시작보다 이르면 자정을 넘긴 것으로 본다)
function endIso(date, start, end) {
  return kstIso(end > start ? date : addDays(date, 1), end);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------- 저장소 ----------

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function initStoreId() {
  const params = new URLSearchParams(location.search);
  const fromUrl = (params.get("s") ?? "").trim().toLowerCase();
  if (/^[a-z0-9]{4,12}$/.test(fromUrl)) {
    rememberStore(fromUrl);
    return fromUrl;
  }
  try {
    return localStorage.getItem(LAST_STORE_KEY);
  } catch {
    return null;
  }
}

function rememberStore(id) {
  try {
    if (id) localStorage.setItem(LAST_STORE_KEY, id);
    else localStorage.removeItem(LAST_STORE_KEY);
  } catch {}
}

// 새 매장 코드: 헷갈리는 글자(0/o, 1/l/i)를 뺀 12자리 (마구 넣어 보는 방법으로는 남의 매장을 찾을 수 없게)
// 예전에 만든 6자리 매장도 그대로 쓸 수 있다
function newStoreCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join("");
}
// 보여 줄 때는 4자리씩 끊어서 (abcd-efgh-jkmn). 입력할 때 - 나 띄어쓰기는 무시한다
const codeLabel = (code = storeId) => (code && code.length > 6 ? code.match(/.{1,4}/g).join("-") : code);

// 사람이 늘어나면 이 순서대로 아직 안 쓴 색을 준다
const PALETTE = [
  "#fff2cc", "#d0cece", "#7030a0", "#bdd7ee", "#ffff00", "#8ea9db", "#c6e0b4", "#2e75b6", "#ffe699",
  "#f8cbad", "#a9d08e", "#ff99cc", "#9bc2e6", "#ffc000", "#b4a7d6", "#c00000", "#00b0f0", "#ffd966",
  "#548235", "#f4b183", "#d9d2e9", "#70ad47", "#ff7c80", "#dbdbdb",
];

// 직원마다 겹치지 않는 색을 자동으로 정한다. 이미 정해진 색은 유지.
function ensureColors(data = store) {
  const used = new Set();
  for (const e of data.employees) {
    if (isManager(e)) {
      e.color = "#ffffff";
      continue;
    }
    if (!e.color || used.has(e.color) || e.color === "#ffffff") {
      e.color = PALETTE.find((c) => !used.has(c)) ?? `hsl(${(used.size * 47) % 360} 70% 75%)`;
    }
    used.add(e.color);
  }
}

// 매니저는 근무표에만 나오고 출근·급여에서는 빠진다
const isManager = (e) => e.role === "manager";

// 새 매장은 직원 없이 시작한다
function initialData() {
  return { employees: [], records: [], shifts: {}, scheduleMeta: { period: "", notes: {} } };
}

function loadStore() {
  if (!storeId) return initialData();
  try {
    const raw = localStorage.getItem(storeKey());
    if (raw) return cleanStore({ shifts: {}, ...JSON.parse(raw) });
  } catch {}
  return initialData();
}

// 관리자 사이트 둘러보기(로그인 전)에 보여 줄 샘플 매장. 이 기기에서만 만들고 어디에도 저장하지 않는다.
const DEMO_NAME = "샘플";
function demoData() {
  const people = [
    ["김민지", "#fff2cc", { 1: "07-12", 2: "07-12", 3: "07-12", 5: "07-12" }],
    ["이준호", "#d0cece", { 1: "12-18", 2: "12-18", 4: "12-18", 5: "12-18" }],
    ["박서연", "#bdd7ee", { 2: "18-22", 3: "18-22", 4: "18-22", 6: "10-16" }],
    ["최우진", "#c6e0b4", { 5: "18-22", 6: "16-22", 0: "10-18" }],
    ["정하늘", "#ffe699", { 1: "18-22", 3: "12-18", 0: "18-22" }],
  ];
  const employees = people.map(([name, color, days], i) => ({
    id: `demo${i}`,
    no: i + 1,
    hireDate: `2026-0${3 + i}-02`,
    name,
    phone: null,
    hourlyWage: DEFAULT_WAGE,
    active: true,
    color,
    weekly: Object.fromEntries(Object.entries(days).map(([wd, r]) => [wd, parseRange(r)])),
  }));
  // 지난달 1일부터 어제까지 근무표대로 출근한 기록. 몇 번은 더 일하거나(파랑) 덜 일한 날(빨강)로.
  const today = todayDateString();
  const [y, m] = today.split("-").map(Number);
  const from = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  const records = [];
  let n = 0;
  for (let date = from; date < today; date = addDays(date, 1)) {
    for (const e of employees) {
      const shift = e.weekly[weekdayOf(date)];
      if (!shift) continue;
      n++;
      if (n % 23 === 0) continue; // 결근
      let { start, end } = shift;
      if (n % 11 === 0) end = `${String(Number(end.slice(0, 2)) + 1).padStart(2, "0")}:00`;
      else if (n % 13 === 0) end = `${String(Number(end.slice(0, 2)) - 1).padStart(2, "0")}:00`;
      records.push({ id: `demo-r${n}`, employeeId: e.id, date, clockIn: kstIso(date, start), clockOut: endIso(date, start, end), createdAt: kstIso(date, start), edited: end !== shift.end });
    }
  }
  return { employees, records, shifts: {}, scheduleMeta: { period: `${from.replaceAll("-", ".")} ~ `, notes: {} } };
}

// 관리자 사이트는 로그인하기 전까지 샘플 매장을 보여 준다
let demoLoaded = document.body.dataset.site === "admin";
let store = demoLoaded ? demoData() : loadStore();

// 이 기기에 캐시로 저장하고, 바뀐 부분을 온라인 저장소에 올린다
function save() {
  if (demoLoaded) return; // 둘러보기 중에는 아무것도 저장하지 않는다
  saveCache();
  pushChanges();
  queueSlipPublish();
}

function saveCache() {
  if (!storeId) return;
  try {
    localStorage.setItem(storeKey(), JSON.stringify(store));
  } catch {}
}

function employeeById(id) {
  return store.employees.find((e) => e.id === id);
}

function recordsOn(date) {
  return store.records
    .filter((r) => r.date === date && employeeById(r.employeeId))
    .sort((a, b) => (a.clockIn < b.clockIn ? -1 : 1));
}

function recordFor(employeeId, date) {
  return store.records.find((r) => r.employeeId === employeeId && r.date === date);
}

// 그날의 근무 시간: 날짜별로 수정한 시간(store.shifts)이 있으면 그것, 없으면 그날 적용되는 근무표 시간
function shiftFor(emp, date) {
  return store.shifts[date]?.[emp.id] ?? weeklyOn(emp, date)[weekdayOf(date)] ?? { start: "09:00", end: "18:00" };
}

// 그날 근무표(요일별 고정 근무)상 근무 시간(시간 단위). 근무 요일이 아니면 0.
// 달력에서 그날 시간만 바꾼 것(store.shifts)은 "원래 시간"이 아니므로 비교 기준에 넣지 않는다.
function plannedOn(emp, date) {
  const shift = weeklyOn(emp, date)[weekdayOf(date)];
  if (!shift) return 0;
  return hoursBetween(kstIso(date, shift.start), endIso(date, shift.start, shift.end));
}

// 실제 근무 시간을 일정과 비교: 많으면 " over"(파랑), 적으면 " under"(빨강), 같으면 ""(검정)
function diffClass(emp, date, worked) {
  const diff = worked - plannedOn(emp, date);
  return diff > 0.01 ? " over" : diff < -0.01 ? " under" : "";
}

function setShift(empId, date, start, end) {
  store.shifts[date] = { ...store.shifts[date], [empId]: { start, end } };
  if (ADMIN_SITE && store.absent) delete store.absent[`${empId}|${date}`];
}

// 근무 요일에 해당하는 직원 + 그날만 추가로 등록된 직원
function scheduledOn(date) {
  const wd = weekdayOf(date);
  const extra = store.shifts[date] ?? {};
  return store.employees
    .filter((e) => e.active && !isManager(e) && (weeklyOn(e, date)[wd] || extra[e.id]))
    .sort((a, b) => (shiftFor(a, date).start < shiftFor(b, date).start ? -1 : 1));
}

// 퇴근은 따로 누르지 않으므로, 퇴근 시각은 그날 근무 종료 시간으로 본다 (자정을 넘기면 다음 날)
function scheduledEnd(emp, date) {
  const { start, end } = shiftFor(emp, date);
  return endIso(date, start, end);
}

// 출근은 오늘 날짜에만 기록된다 (미래 날짜에는 출근 버튼이 나오지 않음)
function clockIn(employeeId) {
  const emp = employeeById(employeeId);
  if (!emp || !emp.active) return "직원을 찾을 수 없습니다.";
  const date = todayDateString();
  if (recordFor(employeeId, date)?.clockIn) return "이미 출근 처리되었습니다.";
  // 누른 시각이 아니라 그날 근무 시간대로 출퇴근을 기록한다
  const { start } = shiftFor(emp, date);
  store.records.push({
    manual: true,
    id: uid(),
    employeeId,
    date,
    clockIn: kstIso(date, start),
    clockOut: scheduledEnd(emp, date),
    createdAt: new Date().toISOString(),
  });
  save();
  return null;
}

// 관리자 달력에서 그날 근무 기록을 직접 넣거나 고친다. 근무 상세·급여 정산은 기록으로 계산되므로 바로 반영된다.
// 직접 고친 기록(edited)은 이후 근무표를 저장해도 덮어쓰지 않는다.
function setRecordTimes(empId, date, start, end) {
  const clockIn = kstIso(date, start);
  const clockOut = endIso(date, start, end);
  const rec = recordFor(empId, date);
  if (rec) Object.assign(rec, { clockIn, clockOut, edited: true });
  else store.records.push({ id: uid(), employeeId: empId, date, clockIn, clockOut, createdAt: new Date().toISOString(), edited: true });
  if (store.absent) delete store.absent[`${empId}|${date}`];
}

function nameLabel(emp) {
  return esc(emp.name);
}

// 관리자가 대신 출근 처리: 그날 근무 시간(근무표 또는 그날 바꾼 시간) 그대로 기록한다
function adminClockIn(empId, date) {
  const emp = employeeById(empId);
  if (!emp || recordFor(empId, date)) return;
  const { start } = shiftFor(emp, date);
  store.records.push({ manual: true, id: uid(), employeeId: empId, date, clockIn: kstIso(date, start), clockOut: scheduledEnd(emp, date), createdAt: new Date().toISOString() });
  if (store.absent) delete store.absent[`${empId}|${date}`];
  save();
}

// 그날 근무 기록을 지운다 (결근). 근무표를 다시 저장해도 자동으로 채워지지 않게 표시해 둔다.
function removeRecord(empId, date) {
  store.records = store.records.filter((r) => !(r.employeeId === empId && r.date === date));
  store.absent = { ...store.absent, [`${empId}|${date}`]: true };
  // 근무표(요일별 고정 근무)에 없던 사람(+ 로 추가)이면 그날 근무 예정에서도 뺀다
  const emp = employeeById(empId);
  if (emp && !weeklyOn(emp, date)[weekdayOf(date)] && store.shifts[date]?.[empId]) {
    const { [empId]: _gone, ...rest } = store.shifts[date];
    store.shifts[date] = rest;
  }
}

// 관리자 = Firebase 에 로그인했고, 그 계정의 매장을 열어 둔 상태 (관리자 사이트에서만)
function isAdmin() {
  return ADMIN_SITE && Boolean(cloud?.auth.currentUser) && Boolean(storeId) && state.adminStore === storeId;
}

ensureColors();

// ---------- 근무표 변경 → 근무 기록 연동 ----------
// 근무표 제목의 기간 시작일(예: "2026. 10. 5 ~ 11. 8" → 2026-10-05, 연도가 없으면 가까운 해)부터 오늘까지의 기록을 새 근무 시간에 맞춘다.
// - 날짜별로 따로 수정한 날(store.shifts)은 건드리지 않는다
// - 자동으로 채운 지난 기록: 시간 변경 / 근무 추가 시 생성 / 근무 삭제 시 제거
// - 직접 출근한 기록: 시간만 맞추고 지우지는 않는다
// 기간에 연도가 없으면 지금 판단한 연도를 앞에 붙여 고정한다.
// (몇 달 뒤에 다시 판단하면 해가 바뀌어 보일 수 있으므로 저장할 때 박아 둔다)
function pinPeriodYear() {
  const period = store.scheduleMeta?.period;
  if (period && !/\d{4}/.test(period) && /\d/.test(period)) store.scheduleMeta.period = `${scheduleStart().slice(0, 4)}. ${period.trim()}`;
}

function scheduleStart(period = store.scheduleMeta?.period ?? "") {
  const pad = (n) => n.padStart(2, "0");
  // 연도가 있으면 그대로 (2026. 10. 5 / 2026-10-05 / 2026년 10월 5일)
  const full = period.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (full) return `${full[1]}-${pad(full[2])}-${pad(full[3])}`;
  const m = period.match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
  const today = todayDateString();
  if (!m) return today;
  const md = `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const year = Number(today.slice(0, 4));
  // 연도가 없으니 오늘과 가장 가까운 해로 본다 (12월에 "1. 5" → 내년, 1월에 "12. 28" → 작년)
  const gap = Number(md.slice(0, 2)) - Number(today.slice(5, 7));
  return `${gap <= -6 ? year + 1 : gap >= 6 ? year - 1 : year}-${md}`;
}

function syncWeekday(emp, wd) {
  if (isManager(emp)) return;
  const today = todayDateString();
  for (let date = scheduleStart(); date <= today; date = addDays(date, 1)) {
    if (String(weekdayOf(date)) !== String(wd) || store.shifts[date]?.[emp.id]) continue;
    const shift = emp.weekly[wd];
    const rec = recordFor(emp.id, date);
    if (rec?.edited) continue; // 관리자가 달력에서 직접 고친 날
    if (store.absent?.[`${emp.id}|${date}`]) continue; // 관리자가 기록을 지운 날 (결근)
    if (shift) {
      const clockIn = kstIso(date, shift.start);
      const clockOut = endIso(date, shift.start, shift.end);
      if (rec) Object.assign(rec, { clockIn, clockOut });
      else if (date < today) store.records.push({ id: uid(), employeeId: emp.id, date, clockIn, clockOut, createdAt: clockIn, auto: true });
    } else if (rec?.auto) {
      store.records = store.records.filter((r) => r !== rec);
    }
  }
}

// 요일 근무 시간 변경 (근무표·직원 관리 공용). range 가 없으면 그 요일은 쉬는 날.
function setWeekly(emp, wd, range) {
  // 근무표 기간 시작일부터는 새 근무표, 그 전 날짜는 원래 근무표로 주휴수당을 계산한다
  const from = scheduleStart();
  if (!emp.weeklyHistory) {
    emp.weeklyBase = structuredClone(emp.weekly);
    emp.weeklyHistory = [];
  }
  if (range) emp.weekly[wd] = range;
  else delete emp.weekly[wd];
  emp.weeklyHistory = [...emp.weeklyHistory.filter((snap) => snap.from < from), { from, weekly: structuredClone(emp.weekly) }];
  syncWeekday(emp, wd);
  save();
}

// ---------- 유틸 ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const app = document.getElementById("app");
// 같은 app.js 로 두 사이트: 달력(직원용, /) · 관리자(/admin/). 데이터(localStorage)는 같은 주소라 함께 쓴다.
const ADMIN_SITE = document.body.dataset.site === "admin";
const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

// ---------- 아이콘 ----------

const ICON_EYE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

const svg = (size, d, stroke = 2.25) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PREV = svg(22, '<path d="m15 18-6-6 6-6"/>');
const ICON_NEXT = svg(22, '<path d="m9 18 6-6-6-6"/>');
const ICON_CLOSE = svg(18, '<path d="M18 6 6 18M6 6l12 12"/>', 2.5);

// ---------- 시간 입력 ----------
// 시계/드롭다운 없이 키보드로 입력: "0930", "930", "9" 모두 "09:30"/"09:00" 으로 맞춘다.

function normalizeTime(text) {
  const digits = String(text).replace(/\D/g, "");
  if (!digits) return null;
  let hh, mm;
  if (digits.length <= 2) [hh, mm] = [digits, "00"];
  else if (digits.length === 3) [hh, mm] = [digits.slice(0, 1), digits.slice(1)];
  else [hh, mm] = [digits.slice(0, 2), digits.slice(2, 4)];
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return `${hh.padStart(2, "0")}:${mm}`;
}

// "7-12", "07:00~12:00", "18-2230" 같은 근무 시간 범위. 틀리면 null.
function parseRange(text) {
  const parts = String(text).split(/[~\-–]/);
  if (parts.length !== 2) return null;
  const start = normalizeTime(parts[0]);
  const end = normalizeTime(parts[1]);
  return start && end && start !== end ? { start, end } : null; // 시작=끝이면 24시간이 되므로 받지 않는다
}

const formatRange = (r) => (r ? `${r.start}~${r.end}` : "");
// 직원 표의 요일 칸: 휴대폰에서는 칸이 좁아 "07:00~12:00" → "7~12", "18:00~22:30" → "18~22:30"
const shortTime = (t) => t.replace(/^0/, "").replace(/:00$/, "");
// 직원 표: 넓은 화면(1200px 이상)만 "07:00~12:00", 그보다 좁으면 "7~12" (표가 상자 안에 다 들어가게)
const wideTable = () => window.matchMedia("(min-width: 1200px)").matches;
const rangeLabel = (r) => (!r ? "" : wideTable() ? formatRange(r) : `${shortTime(r.start)}~${shortTime(r.end)}`);
window.matchMedia("(min-width: 1200px)").addEventListener("change", () => {
  if (route().name === "employees") render();
});

// 비워 두면 placeholder(기존 시간)를 그대로 쓴다. 형식이 틀리면 null.
function readTime(id) {
  const el = document.getElementById(id);
  if (!el.value.trim()) return el.placeholder;
  return normalizeTime(el.value);
}

function timeInput(id, placeholder, label, extra = "") {
  return `<input id="${id}" class="field time" type="text" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="${placeholder}" aria-label="${label}"${extra} />`;
}

// ---------- 상태 ----------

const state = {
  pageEnter: true, // 화면을 옮겼을 때만 들어오는 애니메이션 (입력할 때마다 다시 그려도 반복되지 않게)
  monthDir: null, // 달력 달을 넘긴 방향 → 넘기는 애니메이션
  year: 0,
  month: 0,
  selectedDate: null,
  animateOpen: false,
  expandedId: null, // 이름을 눌러 출근/수정 버튼이 펼쳐진 직원
  editingId: null, // 근무 시간을 수정 중인 직원
  editingWhere: null, // "staff"(근무자 목록) 또는 "box"(날짜 박스)
  adding: false, // + 로 일정에 없던 인원 등록 중
  justAddedId: null, // 방금 출근한 기록 (날짜 박스에서 한 번만 애니메이션)
  error: "",
  payroll: { month: "", employeeId: "" }, // 근무 기록 화면: "2026-10"
  payslipId: null, // 급여명세서 창을 연 직원
  slotEdit: null, // 근무표에서 편집 중인 칸 { wd, empId, start }
  schedWork: null, // 근무표 편집 초안 (저장 전)
  allowDraft: null, // 명세서 창에서 수정 중인 수당 (저장 전)
  helpOpen: {}, // ? 설명 펼침 상태
};

{
  const t = todayDateString();
  state.year = Number(t.slice(0, 4));
  state.month = Number(t.slice(5, 7));
  state.payroll.month = t.slice(0, 7);
}

// ---------- 화면: 홈 ----------

const storeName = () => (demoLoaded ? DEMO_NAME : state.storeName || APP_NAME);
const BACK_TO_DEMO = `<a class="lock-link" href="#/employees">← 샘플 매장 둘러보기</a>`;
// 개인정보처리방침 · 이용약관 (관리자 사이트는 한 단계 위 폴더)
const policyUrl = (page) => `${ADMIN_SITE ? "../" : ""}${page}.html`;
const policyLinks = (cls = "policy-links") =>
  `<p class="${cls}"><a href="${policyUrl("terms")}" target="_blank" rel="noopener">이용약관</a> · <a href="${policyUrl("privacy")}" target="_blank" rel="noopener"><b>개인정보처리방침</b></a></p>`;
const agreeBox = () => `
  <label class="agree"><input type="checkbox" id="agree" required /><span>(필수) <a href="${policyUrl("terms")}" target="_blank" rel="noopener">이용약관</a>과 <a href="${policyUrl("privacy")}" target="_blank" rel="noopener">개인정보처리방침</a>에 동의해요. 직원 정보는 직원에게 알리고 입력할게요.</span></label>`;
const errorLine = () => (state.error ? `<p class="error">${esc(state.error)}</p>` : "");

// 관리자 사이트 첫 화면: 로그인 / 매장 등록(회원가입) / 로그인했는데 매장이 없으면 매장 만들기
function renderLock() {
  const title = `
    <div class="lock-brand">
      <span class="logo big" aria-hidden="true">콕</span>
      <p class="lock-title">관리자</p>
    </div>`;
  if (!state.authReady || state.busy === "check") return `<div class="lock-page">${title}</div>`;
  if (!cloud) {
    return `
      <div class="lock-page">
        ${title}
        <p class="error">${FIREBASE_CONFIG ? "인터넷 연결을 확인한 뒤 새로고침해주세요." : "온라인 저장소(Firebase) 설정이 아직 없어요."}</p>
      </div>`;
  }
  const busy = Boolean(state.busy);
  if (cloud.auth.currentUser && state.busy !== "signup") {
    return `
      <div class="lock-page">
        ${title}
        <p class="lock-note">${esc(cloud.auth.currentUser.email ?? "")} 계정에 등록된 매장이 없어요.<br />매장 이름을 넣고 매장을 만들어주세요.</p>
        <form class="lock-form" id="store-form">
          <input id="store-name" class="field" maxlength="40" autocomplete="off" placeholder="매장 이름" aria-label="매장 이름" required />
          ${agreeBox()}
          <button type="submit" class="btn-primary"${busy ? " disabled" : ""}>${busy ? "만드는 중…" : "매장 만들기"}</button>
          ${errorLine()}
        </form>
        <button type="button" class="lock-link" data-action="logout">다른 계정으로 로그인</button>
      </div>`;
  }
  if (location.hash === "#/signup") {
    return `
      <div class="lock-page">
        ${title}
        <form class="lock-form" id="signup-form">
          <input id="signup-store" class="field" maxlength="40" autocomplete="organization" placeholder="매장 이름" aria-label="매장 이름" required />
          <input id="login-email" class="field" type="email" autocomplete="username" placeholder="관리자 이메일" aria-label="관리자 이메일" required />
          <div class="pw-wrap">
            <input id="login-password" class="field" type="password" minlength="6" autocomplete="new-password" placeholder="비밀번호 (6자 이상)" aria-label="비밀번호" required />
            <button type="button" class="pw-eye" data-action="toggle-password" aria-label="비밀번호 보기" aria-pressed="false">${ICON_EYE}</button>
          </div>
          ${agreeBox()}
          <button type="submit" class="btn-primary"${busy ? " disabled" : ""}>${busy ? "등록 중…" : "매장 등록"}</button>
          ${errorLine()}
        </form>
        <a class="lock-link" href="#/login">이미 등록했어요 · 로그인</a>
        ${BACK_TO_DEMO}
        ${policyLinks()}
      </div>`;
  }
  return `
    <div class="lock-page">
      ${title}
      <form class="lock-form" id="login-form">
        <input id="login-email" class="field" type="email" autocomplete="username" placeholder="이메일" aria-label="이메일" required />
        <div class="pw-wrap">
          <input id="login-password" class="field" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호" required />
          <button type="button" class="pw-eye" data-action="toggle-password" aria-label="비밀번호 보기" aria-pressed="false">${ICON_EYE}</button>
        </div>
        <button type="submit" class="btn-primary"${busy ? " disabled" : ""}>${busy ? "로그인 중…" : "로그인"}</button>
        ${errorLine()}
        ${state.notice ? `<p class="lock-note ok">${esc(state.notice)}</p>` : ""}
      </form>
      <button type="button" class="lock-link" data-action="reset-password">비밀번호를 잊었어요</button>
      <a class="lock-link" href="#/signup">처음이에요 · 매장 등록하기</a>
      ${BACK_TO_DEMO}
      ${policyLinks()}
    </div>`;
}

// 직원용 달력: 이 기기에서 쓸 매장을 아직 안 정했으면 매장 코드를 받는다
function renderPick() {
  return `
    <div class="lock-page">
      <div class="lock-brand">
        <span class="logo big" aria-hidden="true">콕</span>
        <p class="lock-title">${esc(APP_NAME)}</p>
      </div>
      <p class="lock-note">관리자에게 받은 매장 코드를 입력해주세요.</p>
      <form class="lock-form" id="pick-form">
        <input id="pick-code" class="field" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="매장 코드" aria-label="매장 코드" required />
        <button type="submit" class="btn-primary"${state.busy ? " disabled" : ""}>${state.busy ? "확인 중…" : "시작하기"}</button>
        ${errorLine()}
      </form>
    </div>`;
}

function renderCalendar() {
  const { year, month, selectedDate } = state;
  const today = todayDateString();
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);

  const body = cells
    .map((date, i) => {
      if (!date) return `<div class="empty-cell"></div>`;
      const entries = recordsOn(date);
      const holiday = HOLIDAYS[date];
      const isRest = i % 7 === 0 || Boolean(holiday);
      const numClass = date === today ? "today" : isRest ? "rest" : "";
      const chips = [
        ...entries.slice(0, MAX_VISIBLE).map((r) => {
          const emp = employeeById(r.employeeId);
          const diff = diffClass(emp, date, hoursBetween(r.clockIn, r.clockOut));
          return `<span class="chip">${nameLabel(emp, r)} <span class="chip-time${diff}">${formatTime(r.clockIn)}~${formatTime(r.clockOut)}</span></span>`;
        }),
        entries.length > MAX_VISIBLE ? `<span class="chip more">+${entries.length - MAX_VISIBLE}명</span>` : "",
      ].join("");
      return `
        <button type="button" class="cell${date === selectedDate ? " selected" : ""}" data-date="${date}">
          <span class="cell-top">
            <span class="day-num ${numClass}">${Number(date.slice(-2))}</span>
            ${holiday ? `<span class="chip holiday">${esc(holiday)}</span>` : ""}
          </span>
          <span class="dot${entries.length ? " on" : ""}"></span>
          <div class="entries">${chips}</div>
        </button>`;
    })
    .join("");

  return `
    <div class="cal-head">
      <button type="button" class="round-btn" data-action="prev-month" aria-label="이전 달">${ICON_PREV}</button>
      <p class="cal-title">${year}년 ${month}월</p>
      <button type="button" class="round-btn" data-action="next-month" aria-label="다음 달">${ICON_NEXT}</button>
    </div>
    <div class="grid${state.monthDir ? ` slide-${state.monthDir}` : ""}">
      ${WEEKDAYS.map((w, i) => `<div class="weekday${i === 0 ? " rest" : ""}">${w}</div>`).join("")}
      ${body}
    </div>`;
}

// 날짜 박스: 그날 출근한 사람들
function renderDateBox(date, { closable }) {
  const [, m, d] = date.split("-").map(Number);
  const wd = weekdayOf(date);
  const holiday = HOLIDAYS[date];
  const isRest = wd === 0 || Boolean(holiday);
  const records = recordsOn(date);

  const rows = records
    .map(
      (r) => `
        <li class="in-item${r.id === state.justAddedId ? " new" : ""}">
          <div class="in-row">
            <span class="in-name">${nameLabel(employeeById(r.employeeId), r)}</span>
            <span class="in-time${diffClass(employeeById(r.employeeId), date, hoursBetween(r.clockIn, r.clockOut))}">${formatTime(r.clockIn)} ~ ${formatTime(r.clockOut)}</span>
          </div>
        </li>`,
    )
    .join("");

  return `
    <section class="date-box" aria-label="${m}월 ${d}일 출근 기록">
      <div class="date-box-head">
        <div>
          <p class="date-box-day${isRest ? " rest" : ""}">${d}</p>
          <p class="date-box-wd${isRest ? " rest" : ""}">${WEEKDAYS[wd]}요일${holiday ? ` · ${esc(holiday)}` : ""}</p>
        </div>
        ${closable ? `<button type="button" class="close-btn" data-action="close-panel" aria-label="닫기">${ICON_CLOSE}</button>` : ""}
      </div>
      <p class="box-label">출근 ${records.length}명</p>
      <ul class="in-list">
        ${rows || `<li class="in-empty">아직 출근한 사람이 없어요</li>`}
      </ul>
    </section>`;
}

function renderStaffItem(emp, date) {
  const today = todayDateString();
  const isToday = date === today;
  const editable = ADMIN_SITE || date >= today;
  const rec = recordFor(emp.id, date);
  const done = Boolean(rec?.clockIn);
  // 관리자 화면에서는 기록이 있으면 기록된 시간을 보여준다
  const shift = shiftFor(emp, date);
  const start = ADMIN_SITE && rec ? formatTime(rec.clockIn) : shift.start;
  const end = ADMIN_SITE && rec ? formatTime(rec.clockOut) : shift.end;
  const expanded = editable && state.expandedId === emp.id;

  let action = "";
  if (expanded && state.editingWhere === "staff" && state.editingId === emp.id) {
    action = renderTimeEditor(emp.id, start, end);
  } else if (expanded) {
    action = `
      <div class="action-row">
        <button type="button" class="btn-ghost" data-action="edit-shift" data-id="${emp.id}">수정</button>
        ${!ADMIN_SITE && isToday && !done ? `<button type="button" class="btn-primary" data-action="clock-in" data-id="${emp.id}">출근</button>` : ""}
        ${ADMIN_SITE && !done && date <= today ? `<button type="button" class="btn-primary" data-action="admin-clock-in" data-id="${emp.id}">출근 처리</button>` : ""}
        ${ADMIN_SITE && done ? `<button type="button" class="btn-ghost danger-ghost" data-action="remove-record" data-id="${emp.id}">기록 삭제</button>` : ""}
      </div>`;
  }
  if (expanded && state.error && state.editingWhere !== "staff") action += `<p class="error">${esc(state.error)}</p>`;

  return `
    <li class="staff-item${expanded ? " expanded" : ""}">
      <button type="button" class="staff-name-btn" data-action="toggle-staff" data-id="${emp.id}"${editable ? "" : " disabled"}>
        <span class="staff-name">${nameLabel(emp, rec)}</span>
        ${done ? `<span class="badge done${rec.id === state.justAddedId ? " just" : ""}">출근 완료</span>` : ADMIN_SITE && date < today ? `<span class="badge none">기록 없음</span>` : ""}
        <span class="staff-time${ADMIN_SITE && rec ? diffClass(emp, date, hoursBetween(rec.clockIn, rec.clockOut)) : ""}">${start} ~ ${end}</span>
      </button>
      ${action ? `<div class="staff-action${state.expandEnter ? " enter" : ""}">${action}</div>` : ""}
    </li>`;
}

// 시간 수정 칸 (근무자 목록·날짜 박스 공용). 비워 두면 기존 시간 유지.
function renderTimeEditor(empId, start, end) {
  return `
    <div class="edit-row">
      ${timeInput("edit-start", start, "시작 시간")}
      <span>~</span>
      ${timeInput("edit-end", end, "종료 시간")}
    </div>
    <div class="action-row">
      <button type="button" class="btn-ghost" data-action="cancel-edit">취소</button>
      <button type="button" class="btn-primary" data-action="save-shift" data-id="${empId}">저장</button>
    </div>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}`;
}

function renderAddExtra() {
  if (!state.adding) {
    return `<button type="button" class="add-btn" data-action="open-add" aria-label="근무자 추가">+</button>`;
  }
  return `
    <form class="add-form" id="add-extra">
      <input id="extra-name" class="field" placeholder="이름" required autocomplete="off" />
      <div class="edit-row">
        ${timeInput("extra-start", "09:00", "시작 시간")}
        <span>~</span>
        ${timeInput("extra-end", "18:00", "종료 시간")}
      </div>
      <div class="action-row">
        <button type="button" class="btn-ghost" data-action="cancel-add">취소</button>
        <button type="submit" class="btn-primary">등록</button>
      </div>
    </form>`;
}

// 근무자 목록: 그날 근무 예정인 직원과 시간
function renderStaff(date) {
  const today = todayDateString();
  const isToday = date === today;
  let scheduled = scheduledOn(date);
  let sub = isToday ? "본인 이름을 눌러 출근하세요" : date > today ? "이름을 눌러 시간을 수정할 수 있어요" : "지난 날짜예요";
  if (ADMIN_SITE) {
    // 근무 예정인 사람 + 근무표에 없지만 그날 기록이 있는 사람
    const ids = new Set(scheduled.map((e) => e.id));
    const extra = recordsOn(date).map((r) => employeeById(r.employeeId)).filter((e) => !ids.has(e.id));
    scheduled = [...scheduled, ...extra];
    sub = date < today ? "이름을 눌러 시간을 고치면 근무 기록·급여에 바로 반영돼요" : "이름을 눌러 근무 시간을 바꿀 수 있어요";
  }

  return `
    <section class="staff" aria-label="근무자">
      <p class="staff-title">${isToday ? "오늘 근무자" : "근무 예정"}</p>
      <p class="sub">${sub}</p>
      <ul class="staff-list">
        ${scheduled.map((e) => renderStaffItem(e, date)).join("") || `<li class="in-empty">근무 예정인 직원이 없어요</li>`}
      </ul>
      ${ADMIN_SITE || date >= today ? renderAddExtra() : ""}
    </section>`;
}

function renderDayArea(date, { closable }) {
  return `<div class="day-area-inner${state.dayEnter ? " day-enter" : ""}">${renderDateBox(date, { closable })}${renderStaff(date)}</div>`;
}

function renderCalendarCard() {
  const sel = state.selectedDate;
  const open = sel && !state.animateOpen;
  return `
    <div class="card${open ? " open" : ""}" id="card">
      <div class="cal-wrap">${renderCalendar()}</div>
      <div class="day-area">${sel ? renderDayArea(sel, { closable: true }) : ""}</div>
    </div>`;
}

const toastHtml = () => (state.toast ? `<p class="toast${state.toastKind === "ok" ? " ok" : ""}" role="status">${esc(state.toast)}</p>` : "");

function renderHome() {
  return `
    <div class="home">
      <div class="home-inner">${renderCalendarCard()}</div>
    </div>
    ${policyLinks("policy-links home-policy")}
    <button type="button" class="tour-fab" data-action="start-tour" aria-label="사용법 보기"><span>?</span>사용법</button>
    ${Object.keys(remote?.pub?.slips ?? {}).length ? `<div class="pay-fabs"><a class="pay-fab" href="#/my">내 근무 · 명세서</a></div>` : ""}
    ${toastHtml()}`;
}

// 관리자 달력: 직원용 달력과 같은 화면. 출근 버튼은 없고 지난 날짜도 근무 시간을 고칠 수 있다.
function renderAdminCalendar() {
  return renderAdminShell("calendar", `${isDesktop() ? "" : mHead("달력") + renderTodayCard()}<div class="admin-cal">${renderCalendarCard()}</div>`, { center: true, wide: true });
}

function renderDayPage(date) {
  const page = `
    <div class="day-page">
      <div class="day-page-inner">
        <button type="button" class="round-btn back-btn" data-action="go-home" aria-label="달력으로 돌아가기">${ICON_PREV}</button>
        ${renderDayArea(date, { closable: false })}
      </div>
    </div>`;
  return ADMIN_SITE ? renderAdminShell("calendar", page) : page + toastHtml();
}

// ---------- 화면: 관리자 ----------

function renderAdminShell(active, content, { center = false, wide = false } = {}) {
  if (!isDesktop()) return renderMobileShell(active, content);
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? "active" : ""}">${label}</a>`;
  return `
    <nav class="admin-top" aria-label="관리자 메뉴">
      <span class="nav-pill" aria-hidden="true"></span>
      <div class="store-tag"><b>${esc(storeName())}</b>${demoLoaded ? "" : staffCalLink()}</div>
      ${link("#/employees", "직원", "employees")}
      ${link("#/schedule", "근무표", "schedule")}
      ${link("#/calendar", "달력", "calendar")}
      ${link("#/records", "급여", "records")}
      ${link("#/me", "정보", "me")}
      ${demoLoaded ? `<a class="logout login-btn" href="#/login">로그인</a>` : `<button type="button" class="logout" data-action="logout">로그아웃</button>`}
    </nav>
    ${demoLoaded ? `<p class="demo-bar">샘플 매장을 둘러보는 중이에요. 내 매장으로 쓰려면 <a href="#/signup">매장 등록</a> 또는 <a href="#/login">로그인</a>해주세요.</p>` : ""}
    <main class="admin-main${center ? " centered" : ""}${wide ? " wide" : ""}${state.pageEnter ? " page-enter" : ""}">${content}</main>
    <button type="button" class="tour-fab" data-action="start-tour" aria-label="이 화면 사용법 보기"><span>?</span>사용법</button>
    ${toastHtml()}`;
}

// ? 버튼을 누르면 펼쳐지는 설명 (다른 화면에 갔다 오면 다시 접힘)
function helpToggle(key, html) {
  if (ADMIN_SITE) return ""; // 관리자 화면은 ? 를 누르면 튜토리얼 (tourButton)
  const open = state.helpOpen[key];
  return `
    <div class="help">
      <button type="button" class="help-btn${open ? " on" : ""}" data-action="toggle-help" data-key="${key}" aria-expanded="${open}" aria-label="설명 ${open ? "접기" : "보기"}">?</button>
      ${open ? `<p class="help-text">${html}</p>` : ""}
    </div>`;
}

// 010-1234-5678 형태로
function formatPhone(text) {
  const d = String(text ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.startsWith("02")) return [d.slice(0, 2), d.slice(2, d.length > 9 ? 6 : 5), d.slice(d.length > 9 ? 6 : 5)].filter(Boolean).join("-");
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
}

const formatMoney = (text) => {
  const d = String(text ?? "").replace(/\D/g, "");
  return d ? Number(d).toLocaleString() : "";
};
const parseMoney = (text) => Number(String(text).replace(/\D/g, "")) || 0;

function renderEmployees() {
  if (!isDesktop()) return renderEmployeesMobile();
  // 표는 월요일부터
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows = store.employees
    .map(
      (e, i) => `
      <tr style="--i:${i}">
        <td class="name"><a class="name-btn" href="#/emp/${e.id}" title="근로계약서 쓰기 · 보기"><span class="name-cell"><span class="swatch" style="background:${cssColor(e.color)}" title="근무표 색 (자동)"></span>${nameLabel(e)}<span class="name-chev" aria-hidden="true">›</span></span><span class="muted small">${esc(e.phone ? formatPhone(e.phone) : "")}</span></a></td>
        ${order
          .map(
            (wd) =>
              `<td class="day-cell${wd === 0 ? " rest" : ""}" data-label="${WEEKDAYS[wd]}"><input class="field range" type="text" placeholder="-" value="${rangeLabel(e.weekly[wd])}" data-weekly="${wd}" data-id="${e.id}" aria-label="${esc(e.name)} ${WEEKDAYS[wd]}요일 근무 시간" /></td>`,
          )
          .join("")}
        <td class="wage-cell" data-label="급여">${
          isSalaried(e)
            ? `<span class="pay-kind" title="월급·공제액은 급여 화면의 명세서에서 입력해요">월급제</span>`
            : `<input class="field money" style="width:88px;padding:4px 8px" type="text" inputmode="numeric" value="${formatMoney(e.hourlyWage)}" data-wage="${e.id}" aria-label="${esc(e.name)} 시급" />`
        }<button type="button" class="pay-switch" data-action="toggle-paytype" data-id="${e.id}" title="${isSalaried(e) ? "시급제(3.3%)로 바꾸기" : "월급제(4대보험)로 바꾸기"}">${isSalaried(e) ? "시급으로" : "월급으로"}</button></td>
        <td><button type="button" class="status${e.active ? " on" : ""}" data-action="toggle-active" data-id="${e.id}">${e.active ? "재직중" : "비활성"}</button></td>
        <td>${
          `<button type="button" class="status${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}" title="매니저로 바꾸면 월급제, 알바로 바꾸면 시급제가 돼요">${isManager(e) ? "매니저" : "알바"}</button>`
        }</td>
        <td class="manage-cell"><button type="button" class="danger" data-action="remove-employee" data-id="${e.id}">삭제</button></td>
      </tr>`,
    )
    .join("");

  return renderAdminShell(
    "employees",
    `
    <form class="toolbar" id="add-employee" style="margin-bottom:32px">
      <div><span class="f-label" id="f-role-label">구분</span><div class="seg" role="radiogroup" aria-labelledby="f-role-label"><label><input type="radio" name="f-role" value="alba" checked /><span>알바</span></label><label><input type="radio" name="f-role" value="manager" /><span>매니저</span></label></div></div>
      <div><label for="f-name">이름</label><input id="f-name" class="field" style="width:112px" placeholder="홍길동" required /></div>
      <div><label for="f-phone">전화번호 (선택)</label><input id="f-phone" class="field phone" style="width:144px" type="text" inputmode="numeric" placeholder="010-0000-0000" /></div>
      <div class="f-wage-wrap"><label for="f-wage">시급(원)</label><input id="f-wage" class="field money" style="width:112px" type="text" inputmode="numeric" value="${formatMoney(DEFAULT_WAGE)}" required /></div>
      <div class="f-mgr-wrap" hidden><label for="f-salary">기본급 (월급)</label><input id="f-salary" class="field money" style="width:128px" type="text" inputmode="numeric" placeholder="2,000,000" /></div>
      <div class="f-mgr-wrap" hidden><label for="f-meal">식대 (선택)</label><input id="f-meal" class="field money" style="width:104px" type="text" inputmode="numeric" placeholder="0" /></div>
      <button type="submit" class="pill">추가</button>
      <p class="f-mgr-note" hidden>공제액(4대보험·근로소득세)은 추가한 뒤 급여 화면 <b>명세서</b>에서 입력해요.</p>
    </form>
    ${demoLoaded ? "" : renderStaffLink()}
    <div class="table-wrap">
      <table class="schedule">
        <thead><tr><th>이름</th>${order.map((wd) => `<th class="${wd === 0 ? "rest" : ""}">${WEEKDAYS[wd]}</th>`).join("")}<th>급여</th><th>상태</th><th>구분</th><th>관리</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="12" class="empty">등록된 직원이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
    ${helpToggle(
      "employees",
      `요일 칸에 <b>7-12</b>, <b>18-2230</b> 처럼 입력하면 근무 시간이 저장돼요. 비우면 쉬는 날이에요.<br />
      이름 앞 색은 근무표 색이에요(자동으로 겹치지 않게 정해져요). 근무표에서 같은 시각에 시작하면 위에 있는 사람이 왼쪽 칸에 들어가요.<br />
      구분을 <b>매니저</b>로 바꾸면 자동으로 월급제(4대보험), <b>알바</b>로 바꾸면 시급제(3.3%)가 돼요. 알바인데 월급제면 급여 칸의 <b>월급으로</b>를 눌러요. 월급·식대·공제액은 급여 화면에서 이름 옆 <b>명세서</b>를 눌러 입력해요.`,
    )}
    ${policyLinks()}
    ${renderContractModal()}`,
    { center: true },
  );
}

// ---------- 정보 탭: 매장 · 사업주 정보 · 직원 링크 · 이력서 양식 · 매장 삭제 ----------
const resumeUrl = () => new URL(demoLoaded ? "../resume.html" : `../resume.html?s=${storeId}`, location.href).href;
const payUrl = () => new URL(`../?s=${storeId}#/my`, location.href).href;

function renderMyPage() {
  const biz = store.settings?.biz ?? {};
  const pins = remote?.priv?.slipPins ?? {};
  const field = (k, label, ph, extra = "") =>
    `<label class="me-field"${k === "address" ? ' style="grid-column:1/-1"' : ""}><span>${label}</span><input class="field" data-biz="${k}" value="${esc(biz[k] ?? "")}" placeholder="${esc(ph)}" ${extra}/></label>`;
  const emps = store.employees.filter((e) => e.active);
  const content = `
    ${isDesktop() ? "" : mHead("정보")}
    <div class="me">
      <section class="me-card">
        <p class="me-store">${esc(storeName())}</p>
        <p class="sub">매장 코드 <b>${demoLoaded ? "-" : codeLabel()}</b>${cloud?.auth.currentUser?.email ? ` · ${esc(cloud.auth.currentUser.email)}` : ""}</p>
      </section>

      <section class="me-card">
        <h2>사업주 정보</h2>
        <div class="me-grid">
          ${field("bizName", "상호", storeName())}
          ${field("owner", "대표자", "홍길동")}
          ${field("bizNo", "사업자등록번호", "000-00-00000", 'inputmode="numeric"')}
          ${field("phone", "연락처", "033-000-0000", 'inputmode="tel"')}
          ${field("address", "사업장 주소", "강원 춘천시 …")}
        </div>
      </section>

      <section class="me-card">
        <h2>직원 링크 · 근무 상세와 급여명세서</h2>
        <div class="me-link"><span>${demoLoaded ? "로그인하면 주소가 생겨요" : esc(payUrl())}</span><button type="button" class="pill" data-action="copy-pay-link"${demoLoaded ? " disabled" : ""}>주소 복사</button></div>
        <ul class="me-pins">
          ${
            emps
              .map(
                (e) => `<li><span class="name-cell">${esc(e.name)}</span>
              <b class="me-pin${pins[e.id] ? "" : " wait"}">${pins[e.id] ? esc(pins[e.id]) : demoLoaded ? "로그인하면 생겨요" : "PIN 만드는 중…"}</b>
              <button type="button" class="pill plain" data-action="slip-new" data-id="${e.id}"${demoLoaded ? " disabled" : ""}>새 PIN</button></li>`,
              )
              .join("") || `<li class="muted">재직중인 직원이 없어요</li>`
          }
        </ul>
      </section>

      <section class="me-card">
        <h2>이력서 양식</h2>
        <div class="me-link"><span>${esc(resumeUrl())}</span><a class="pill plain-dark" href="${esc(resumeUrl())}" target="_blank" rel="noopener">열기</a><button type="button" class="pill" data-action="copy-resume-link">주소 복사</button></div>
      </section>

      <section class="me-card">
        <h2>매장 삭제</h2>
        <div class="store-manage-actions">
          <button type="button" class="pill danger-pill" data-action="delete-store"${demoLoaded ? " disabled" : ""}>매장 · 계정 삭제</button>
        </div>
      </section>
    </div>
    ${policyLinks()}`;
  return renderAdminShell("me", content, { center: true });
}

// ---------- 직원 명세서: PIN 으로 잠가서 공개 ----------
// PIN(6자리) → PBKDF2 로 키를 만들고, 명세서를 AES-GCM 으로 잠가 public/slips/{직원}/{달} 에 올린다.
// 키는 사장님만 읽는 private/slipKeys 에 두어서, 다음 달에도 PIN 을 다시 묻지 않고 잠근다.
const te = new TextEncoder();
const toB64 = (buf) => {
  let out = "";
  for (const b of new Uint8Array(buf)) out += String.fromCharCode(b);
  return btoa(out);
};
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function slipKeyFromPin(empId, pin) {
  const base = await crypto.subtle.importKey("raw", te.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: te.encode(`kok-slip:${storeId}:${empId}`), iterations: 600000, hash: "SHA-256" }, base, 256);
  return toB64(bits);
}
const aesKey = (raw) => crypto.subtle.importKey("raw", fromB64(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
async function sealText(raw, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(raw), te.encode(text));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function openText(raw, box) {
  if (!box?.iv || !box?.ct) throw new Error("없음");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, await aesKey(raw), fromB64(box.ct));
  return new TextDecoder().decode(pt);
}
// 내용이 바뀌었는지 비교용 (발행일은 매일 바뀌므로 빼고)
async function slipSig(raw, html) {
  const d = await crypto.subtle.digest("SHA-256", te.encode(raw + html.replace(/발행일 [\d.]+/, "")));
  return toB64(d).slice(0, 22);
}
const slipsOf = (empId) => remote?.pub?.slips?.[empId] ?? {};
const slipMonths = (empId) => Object.keys(slipsOf(empId)).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().reverse();

// 지급일이 지난 달(최근 12개월)의 명세서를 올린다. 내용이 같으면 다시 올리지 않는다.
var slipBusy = false;
async function publishSlips(onlyId = null) {
  if (!ADMIN_SITE || demoLoaded || !cloud || !storeId || !remote.privLoaded || slipBusy) return;
  const today = todayDateString();
  const months = [];
  let ym = today.slice(0, 7);
  for (let i = 0; i < 13; i++) {
    if (payDateFor(ym) <= today) months.push(ym);
    ym = shiftMonth(ym, -1);
  }
  // 근무 상세는 그달이 끝난 다음 달 1일부터 (이번 달은 아직 안 올린다)
  const thisMonth = today.slice(0, 7);
  const recent = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -(i + 1)));
  slipBusy = true;
  try {
    if (!onlyId) await ensureSlipPins();
    for (const [empId, raw] of Object.entries(remote.priv?.slipKeys ?? {})) {
      const emp = employeeById(empId);
      if (!emp || (onlyId && empId !== onlyId)) continue;
      // 이번 달 근무 상세가 먼저 올라가 있었으면 내린다
      if (slipsOf(empId)[`w-${thisMonth}`]) await cloud.db.ref(storePath(`public/slips/${empId}/w-${thisMonth}`)).remove();
      // 근무 상세: 지난 12개월, 근무 기록이 있는 달만
      for (const m of recent) {
        if (!timesheet(m, empId, { includeAll: true }).rows[0]?.total) continue;
        const html = renderTsCard(emp, m);
        const sig = await slipSig(raw, html);
        if (parse(slipsOf(empId)[`w-${m}`], {})?.sig === sig) continue;
        await cloud.db.ref(storePath(`public/slips/${empId}/w-${m}`)).set(JSON.stringify({ ...(await sealText(raw, html)), sig }));
      }
      for (const m of months) {
        const r = payrollFor(m, empId).rows.find((x) => x.emp.id === empId);
        // 근무가 없는 달, 공제액을 아직 안 넣은 월급제 직원은 올리지 않는다
        if (!r || r.net === null || !r.gross) continue;
        const html = renderPayslip(r, m);
        const sig = await slipSig(raw, html);
        if (parse(slipsOf(empId)[m], {})?.sig === sig) continue;
        await cloud.db.ref(storePath(`public/slips/${empId}/${m}`)).set(JSON.stringify({ ...(await sealText(raw, html)), sig }));
      }
    }
  } catch (err) {
    console.warn("명세서 올리기 실패", err);
  } finally {
    slipBusy = false;
  }
}
// 시작할 때 save() 가 먼저 불릴 수 있어서 var · function 으로 (선언 전에 불러도 되게)
var slipTimer = null;
function queueSlipPublish() {
  clearTimeout(slipTimer);
  slipTimer = setTimeout(() => publishSlips(), 4000);
}

// 재직중 직원마다 PIN(숫자 6자리)을 자동으로 만든다. PIN 은 사장님만 읽는 private/slipPins 에 두고 정보 화면에 보여 준다.
function randomPin() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}
async function makeSlipPin(empId) {
  const pin = randomPin();
  const raw = await slipKeyFromPin(empId, pin);
  // 이전 PIN 으로 잠근 달은 지우고 새로 잠근다
  await cloud.db.ref(storePath(`public/slips/${empId}`)).set({ check: JSON.stringify(await sealText(raw, "ok")) });
  await cloud.db.ref(storePath(`private/slipKeys/${empId}`)).set(raw);
  await cloud.db.ref(storePath(`private/slipPins/${empId}`)).set(pin);
  remote.priv = { ...(remote.priv ?? {}), slipKeys: { ...(remote.priv?.slipKeys ?? {}), [empId]: raw }, slipPins: { ...(remote.priv?.slipPins ?? {}), [empId]: pin } };
  remote.pub = { ...(remote.pub ?? {}), slips: { ...(remote.pub?.slips ?? {}), [empId]: {} } };
  return pin;
}
async function ensureSlipPins() {
  const pins = remote.priv?.slipPins ?? {};
  let made = false;
  for (const e of store.employees) {
    if (!e.active || pins[e.id]) continue;
    await makeSlipPin(e.id);
    made = true;
  }
  if (made && route().name === "me") render();
}
async function newSlipPin(empId) {
  const emp = employeeById(empId);
  if (!(await uiConfirm(`${emp.name}님 PIN을 새로 만들까요?\n이전 PIN으로는 더 이상 볼 수 없어요.`, { ok: "새로 만들기" }))) return;
  slipBusy = true;
  try {
    await makeSlipPin(empId);
  } finally {
    slipBusy = false;
  }
  await publishSlips(empId);
  showToast(`${emp.name}님 새 PIN을 만들었어요. 개인 톡으로 알려 주세요`, "ok");
  render();
}

// ---------- 직원: 내 근무 · 급여명세서 (#/my, #/work, #/pay) ----------
// 한 화면에 탭 두 개 (왼쪽 근무 상세가 먼저). 같은 PIN 으로 연다. 근무 상세는 public/slips/{직원}/w-{달} 에 잠겨 있다.
const paySessionKey = (empId) => `kok-pay:${storeId}:${empId}`;
const payTab = () => state.payTab ?? (location.hash === "#/pay" ? "pay" : "work");
const workMonths = (empId) => Object.keys(slipsOf(empId)).filter((k) => /^w-\d{4}-\d{2}$/.test(k)).map((k) => k.slice(2)).sort().reverse();
const tabMonths = (empId, tab) => (tab === "work" ? workMonths(empId) : slipMonths(empId));
const slipKey = (tab, ym) => (tab === "work" ? `w-${ym}` : ym);
const ICON_BACK = ICON_PREV;

// 처음 보여 줄 달: 근무 상세는 이번 달, 명세서는 지급일이 지난 가장 최근 달 (올라온 것 중 가장 최근)
function payDefaultYm(empId, tab) {
  const list = tabMonths(empId, tab);
  if (tab === "work") return list.includes(todayDateString().slice(0, 7)) ? todayDateString().slice(0, 7) : list[0] ?? null;
  return list[0] ?? null;
}

function renderPinPad() {
  const p = state.payPin;
  const emp = employeeById(p.empId);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  // 컴퓨터(마우스·키보드)는 화면 키패드 없이 키보드로 누른다
  const desk = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return `
    <div class="pay-who"><button type="button" class="pay-back-btn" data-action="pay-close" aria-label="이전">${ICON_BACK}</button><b>${esc(emp?.name ?? "")}님</b></div>
    ${desk ? `<div class="pin-desk">` : ""}
    <p class="pin-guide">${p.busy ? "확인하는 중이에요…" : desk ? "키보드로 PIN 6자리를 입력해주세요" : "PIN 6자리를 눌러주세요"}</p>
    <div class="pin-dots${p.shake ? " shake" : ""}" aria-label="${p.digits.length}자리 입력됨">${Array.from({ length: 6 }, (_, i) => `<i class="${i < p.digits.length ? "on" : ""}"></i>`).join("")}</div>
    ${desk ? "</div>" : `<div class="pin-pad">${keys
      .map((k) =>
        k === ""
          ? `<span></span>`
          : `<button type="button" data-action="pin-key" data-key="${k}"${p.busy ? " disabled" : ""}${k === "del" ? ' aria-label="지우기"' : ""}>${k === "del" ? "⌫" : k}</button>`,
      )
      .join("")}</div>`}`;
}

function renderPayPage() {
  const v = state.payView;
  const names = store.employees.filter((e) => slipsOf(e.id).check);
  let body;
  if (!remote?.pubLoaded) body = `<p class="sub pay-wait">불러오는 중이에요…</p>`;
  else if (state.payPin) body = renderPinPad();
  else if (!v) {
    body = `
      <p class="pay-store">${esc(storeName())}</p>
      <p class="pay-sub">내 근무 및 급여명세서</p>
      ${
        names.length
          ? `<ul class="pay-names">${names.map((e) => `<li><button type="button" data-action="pay-open" data-id="${e.id}">${esc(e.name)}<span class="chev" aria-hidden="true">${ICON_CHEVRON}</span></button></li>`).join("")}</ul>
            <p class="pay-hint">본인 이름을 누르고 PIN을 입력해주세요.</p>`
          : `<p class="pay-hint">아직 공개된 내용이 없어요. 사장님께 PIN을 받았는지 확인해주세요.</p>`
      }`;
  } else {
    const tab = payTab();
    const emp = employeeById(v.empId);
    const months = tabMonths(v.empId, tab);
    if (!v.ym[tab] || !months.includes(v.ym[tab])) v.ym[tab] = payDefaultYm(v.empId, tab);
    const ym = v.ym[tab];
    const got = ym ? v.cache[slipKey(tab, ym)] : null;
    if (ym && got === undefined) queueMicrotask(payLoadMonth);
    const at = months.indexOf(ym);
    const label = ym ? `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5))}월` : "";
    const content = !ym
      ? `<p class="pay-hint">${tab === "work" ? "아직 올라온 근무 상세가 없어요." : "아직 올라온 명세서가 없어요. 급여 지급일이 지나면 올라와요."}</p>`
      : got?.img
        ? `<img class="pay-img" src="${got.img}" alt="${esc(`${emp?.name ?? ""} ${label} ${tab === "work" ? "근무 상세" : "급여명세서"}`)}" />
          <button type="button" class="btn-primary pay-save" data-action="pay-save">${tab === "work" ? "사진 저장" : "PDF 저장"}</button>`
        : (got?.error ?? `<p class="sub pay-wait">여는 중이에요…</p>`);
    body = `
      <div class="pay-who"><button type="button" class="pay-back-btn" data-action="pay-close" aria-label="이전">${ICON_BACK}</button><b>${esc(emp?.name ?? "")}님</b></div>
      <div class="pay-tabs" role="tablist">
        <button type="button" role="tab" class="${tab === "work" ? "on" : ""}" aria-selected="${tab === "work"}" data-action="pay-tab" data-tab="work">근무 상세</button>
        <button type="button" role="tab" class="${tab === "pay" ? "on" : ""}" aria-selected="${tab === "pay"}" data-action="pay-tab" data-tab="pay">급여명세서</button>
      </div>
      ${
        ym
          ? `<div class="pay-month">
              <button type="button" class="round-btn" data-action="pay-step" data-dir="1" aria-label="이전 달"${at >= months.length - 1 ? " disabled" : ""}>${ICON_PREV}</button>
              <label class="pay-month-pick"><b>${label}</b><span aria-hidden="true">▾</span>
                <select data-paymonth aria-label="달 고르기">${months.map((m) => `<option value="${m}"${m === ym ? " selected" : ""}>${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월</option>`).join("")}</select>
              </label>
              <button type="button" class="round-btn" data-action="pay-step" data-dir="-1" aria-label="다음 달"${at <= 0 ? " disabled" : ""}>${ICON_NEXT}</button>
            </div>`
          : ""
      }
      <div class="pay-slip">${content}</div>`;
  }
  return `
    <div class="pay-page">
      <div class="pay-inner">${body}</div>
    </div>
    ${toastHtml()}`;
}

async function payOpen(empId) {
  const check = parse(slipsOf(empId).check, null);
  let raw = null;
  try {
    raw = sessionStorage.getItem(paySessionKey(empId));
  } catch {}
  // 이 탭에서 이미 PIN 을 맞혔으면 다시 묻지 않는다
  if (raw && (await openText(raw, check).catch(() => "")) === "ok") return payShow(empId, raw);
  state.payPin = { empId, digits: "", busy: false, shake: false };
  render();
}
function payShow(empId, raw) {
  state.payPin = null;
  state.payView = { empId, raw, ym: {}, cache: {} };
  render();
}
async function pinKey(key) {
  const p = state.payPin;
  if (!p || p.busy) return;
  p.shake = false;
  if (key === "del") p.digits = p.digits.slice(0, -1);
  else if (p.digits.length < 6) p.digits += key;
  render();
  if (p.digits.length < 6) return;
  p.busy = true;
  render();
  const raw = await slipKeyFromPin(p.empId, p.digits);
  const ok = (await openText(raw, parse(slipsOf(p.empId).check, null)).catch(() => "")) === "ok";
  if (state.payPin !== p) return;
  if (!ok) {
    Object.assign(p, { digits: "", busy: false, shake: true });
    showToast("PIN이 맞지 않아요. 다시 눌러주세요.");
    return;
  }
  try {
    sessionStorage.setItem(paySessionKey(p.empId), raw);
  } catch {}
  payShow(p.empId, raw);
}
// 컴퓨터 키보드로도 PIN 을 누를 수 있게
document.addEventListener("keydown", (e) => {
  if (!state.payPin || document.querySelector(".ui-back, .share-back")) return;
  if (/^\d$/.test(e.key)) pinKey(e.key);
  else if (e.key === "Backspace") pinKey("del");
});

async function payLoadMonth() {
  const v = state.payView;
  const tab = payTab();
  const ym = v?.ym[tab];
  if (!ym) return;
  const key = slipKey(tab, ym);
  if (v.cache[key] !== undefined) return;
  v.cache[key] = null; // 여는 중 (같은 달을 두 번 열지 않게)
  const work = tab === "work";
  try {
    const html = await openText(v.raw, parse(slipsOf(v.empId)[key], null));
    // 관리자 화면의 카톡 사진(근무 상세) · PDF(명세서)와 똑같이: 화면 밖에 그려서 2배로 찍는다
    const html2canvas = await loadLib("html2canvas");
    await document.fonts.ready;
    const stage = document.createElement("div");
    stage.className = "ps-stage";
    stage.innerHTML = html;
    document.body.appendChild(stage);
    let canvas;
    try {
      canvas = await html2canvas(stage.firstElementChild, { scale: 2, backgroundColor: "#ffffff" });
    } finally {
      stage.remove();
    }
    v.cache[key] = { img: work ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.95) };
  } catch {
    v.cache[key] = { error: `<p class="sub pay-wait">이 달 내용을 열지 못했어요. 새로고침해 보세요.</p>` };
  }
  if (state.payView === v) render();
}

// 직원이 받는 파일: 명세서는 관리자 PDF 와 같은 A4 한 장, 근무 상세는 카톡 사진과 같은 PNG
async function paySave() {
  const v = state.payView;
  const tab = payTab();
  const ym = v?.ym[tab];
  const got = ym && v.cache[slipKey(tab, ym)];
  if (!got?.img) return;
  const name = employeeById(v.empId)?.name ?? "";
  const m = Number(ym.slice(5));
  if (tab === "work") {
    const a = document.createElement("a");
    a.href = got.img;
    a.download = `${name} ${m}월 근무.png`;
    a.click();
    return;
  }
  const jsPDF = await loadLib("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.addImage(got.img, "JPEG", 0, 0, 210, 297);
  pdf.save(`${name} ${m}월 급여명세서.pdf`);
}

// 직원용 달력으로 가는 버튼 (새 탭)
const staffCalLink = (cls = "") =>
  `<a${cls ? ` class="${cls}"` : ""} href="${esc(staffUrl())}" target="_blank" rel="noopener" title="매장 코드 ${codeLabel()} · 이 주소를 매장 기기에서 열어주세요">직원용 달력 ↗</a>`;

// 직원용 달력 주소: 매장 기기에서 한 번 열면 그 기기가 매장을 기억한다
const staffUrl = () => new URL(`../?s=${storeId}`, location.href).href;
function renderStaffLink() {
  return `
    <div class="staff-link">
      <div>
        <p class="staff-link-title">직원용 달력 · 매장 코드 <b>${codeLabel()}</b></p>
        <p class="staff-link-url">${esc(staffUrl())}</p>
      </div>
      <div class="staff-link-actions">
        <a class="pill plain-dark" href="${esc(staffUrl())}" target="_blank" rel="noopener">열기</a>
        <button type="button" class="pill" data-action="copy-staff-link">주소 복사</button>
      </div>
    </div>`;
}

// =====================================================================
// 휴대폰 관리자 화면: 아래 탭바 + 목록 + 아래에서 올라오는 시트
// (컴퓨터 화면을 줄인 것이 아니라 휴대폰에서 보기 편하게 따로 그린다. 기능·동작은 같다)
// =====================================================================

const ICON_CHEVRON = svg(18, '<path d="m9 18 6-6-6-6"/>', 2.25);

function renderMobileShell(active, content) {
  const tab = (key, label) =>
    `<a href="#/${key}" class="m-tab${active === key ? " active" : ""}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `
    <header class="m-top">
      <b class="m-store">${esc(storeName())}</b>
      ${demoLoaded ? "" : staffCalLink("m-staff-link")}
      <button type="button" class="m-tour" data-action="start-tour" aria-label="이 화면 사용법 보기">?</button>
      ${demoLoaded ? `<a class="m-login" href="#/login">로그인</a>` : `<button type="button" class="m-logout" data-action="logout">로그아웃</button>`}
    </header>
    ${demoLoaded ? `<p class="demo-bar">샘플 매장을 둘러보는 중이에요. <a href="#/signup">매장 등록</a> · <a href="#/login">로그인</a></p>` : ""}
    ${renderInstallHint()}
    <main class="m-main${state.pageEnter ? " page-enter" : ""}">${content}</main>
    <nav class="m-tabbar" aria-label="관리자 메뉴">
      ${tab("employees", "직원")}${tab("schedule", "근무표")}${tab("calendar", "달력")}${tab("records", "급여")}${tab("me", "정보")}
    </nav>
    ${renderSheet()}
    ${toastHtml()}`;
}

// 아래에서 올라오는 시트 (근무표 칸 편집 · 직원 정보 · 직원 추가 · 급여 내역)
function renderSheet() {
  let body = "";
  let close = "close-sheet";
  const r = route();
  if (r.name === "schedule" && state.slotEdit) {
    body = renderSlotPanel();
    close = "cancel-slot";
  } else if (state.sheet?.type === "emp" && employeeById(state.sheet.id)) body = renderEmpSheet(employeeById(state.sheet.id));
  else if (state.sheet?.type === "add-emp") body = renderAddEmpSheet();
  else if (state.sheet?.type === "pay" && employeeById(state.sheet.id)) body = renderPaySheet(employeeById(state.sheet.id));
  if (!body) return "";
  const enter = state.sheetEnter;
  return `
    <div class="sheet-backdrop${enter ? " enter" : ""}" data-action="${close}">
      <div class="sheet" data-stop role="dialog" aria-modal="true">
        <span class="sheet-grip" aria-hidden="true"></span>
        ${body}
      </div>
    </div>`;
}

const mHead = (title, side = "") => `<div class="m-head"><h1>${title}</h1>${side}</div>`;

// ---------- 직원 ----------
function weeklySummary(e) {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((wd) => e.weekly[wd]);
  if (!days.length) return "근무 요일 없음";
  return days.map((wd) => `${WEEKDAYS[wd]} ${rangeLabel(e.weekly[wd])}`).join(" · ");
}

function renderEmployeesMobile() {
  const list = store.employees
    .map(
      (e, i) => `
      <button type="button" class="m-row" style="--i:${i}" data-action="open-sheet" data-sheet="emp" data-id="${e.id}">
        <span class="swatch big" style="background:${cssColor(e.color)}"></span>
        <span class="m-row-body">
          <b>${esc(e.name)}${isManager(e) ? `<em class="m-chip">매니저</em>` : ""}${e.active ? "" : `<em class="m-chip off">비활성</em>`}</b>
          <small>${esc(weeklySummary(e))}</small>
        </span>
        <span class="m-chev">${ICON_CHEVRON}</span>
      </button>`,
    )
    .join("");
  return renderAdminShell(
    "employees",
    `
    ${mHead(`직원 <span class="m-count">${store.employees.length}명</span>`, `<button type="button" class="m-add" data-action="open-sheet" data-sheet="add-emp">+ 추가</button>`)}
    ${
      demoLoaded
        ? ""
        : `<div class="m-card m-link">
            <div><b>직원용 달력</b><small>매장 코드 ${codeLabel()}</small></div>
            <button type="button" class="pill" data-action="copy-staff-link">주소 복사</button>
          </div>`
    }
    <div class="m-list">${list || `<p class="m-empty">아직 직원이 없어요.<br />오른쪽 위 <b>+ 추가</b>로 등록해주세요.</p>`}</div>
    ${policyLinks()}
    ${renderContractModal()}`,
  );
}

function renderEmpSheet(e) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return `
    <div class="sheet-head">
      <span class="swatch big" style="background:${cssColor(e.color)}"></span>
      <div><h2>${esc(e.name)}</h2>${e.phone ? `<small>${esc(formatPhone(e.phone))}</small>` : ""}</div>
    </div>
    <p class="sheet-label">요일별 근무 시간 <small>7-12, 18-2230 처럼 입력 · 비우면 쉬는 날</small></p>
    <div class="m-week">
      ${order
        .map(
          (wd) => `
        <label class="m-week-row${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}">
          <span>${WEEKDAYS[wd]}</span>
          <input class="field range" type="text" placeholder="쉬는 날" value="${formatRange(e.weekly[wd])}" data-weekly="${wd}" data-id="${e.id}" aria-label="${esc(e.name)} ${WEEKDAYS[wd]}요일 근무 시간" />
        </label>`,
        )
        .join("")}
    </div>
    ${
      isSalaried(e)
        ? `<p class="sheet-label">급여</p><p class="sheet-note">월급제(4대보험)예요. 월급·식대·공제액은 급여 화면에서 이 직원을 눌러 <b>수당 · 명세서</b>에서 입력해요.</p>`
        : `<label class="sheet-label" for="m-wage">시급</label>
    <div class="m-wage"><input id="m-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(e.hourlyWage)}" data-wage="${e.id}" aria-label="${esc(e.name)} 시급" /><span>원</span></div>`
    }
    <div class="m-toggles">
      <button type="button" class="m-toggle${e.active ? " on" : ""}" data-action="toggle-active" data-id="${e.id}">${e.active ? "재직중" : "비활성"}</button>
      <button type="button" class="m-toggle${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}">${isManager(e) ? "매니저" : "알바"}</button>
      <button type="button" class="m-toggle${isSalaried(e) ? " on" : ""}" data-action="toggle-paytype" data-id="${e.id}">${isSalaried(e) ? "월급제" : "시급제"}</button>
      <a class="m-toggle${latestContract(e.id)?.status === "signed" ? " on" : ""}" href="#/emp/${e.id}">${latestContract(e.id)?.status === "signed" ? "근로계약서 ✓" : "근로계약서 쓰기"}</a>
    </div>
    <p class="sheet-note">매니저로 바꾸면 월급제, 알바로 바꾸면 시급제가 돼요. 매니저는 출근을 안 찍어도 근무표대로 급여에 나와요.</p>
    <div class="sheet-actions">
      <button type="button" class="btn-ghost danger-ghost" data-action="remove-employee" data-id="${e.id}">삭제</button>
      <button type="button" class="btn-primary" data-action="close-sheet">완료</button>
    </div>`;
}

function renderAddEmpSheet() {
  return `
    <div class="sheet-head"><div><h2>직원 추가</h2></div></div>
    <form id="add-employee" class="m-form">
      <span class="sheet-label" id="f-role-label">구분</span>
      <div class="seg" role="radiogroup" aria-labelledby="f-role-label"><label><input type="radio" name="f-role" value="alba" checked /><span>알바</span></label><label><input type="radio" name="f-role" value="manager" /><span>매니저</span></label></div>
      <label class="sheet-label" for="f-name">이름</label>
      <input id="f-name" class="field" placeholder="홍길동" required autocomplete="off" />
      <label class="sheet-label" for="f-phone">전화번호 (선택)</label>
      <input id="f-phone" class="field phone" type="text" inputmode="numeric" placeholder="010-0000-0000" />
      <div class="f-wage-wrap">
        <label class="sheet-label" for="f-wage">시급(원)</label>
        <input id="f-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(DEFAULT_WAGE)}" required />
      </div>
      <div class="f-mgr-wrap" hidden>
        <label class="sheet-label" for="f-salary">기본급 (월급)</label>
        <input id="f-salary" class="field money" type="text" inputmode="numeric" placeholder="2,000,000" />
        <label class="sheet-label" for="f-meal">식대 (선택)</label>
        <input id="f-meal" class="field money" type="text" inputmode="numeric" placeholder="0 · 비과세, 월 20만 원까지" />
      </div>
      <p class="f-mgr-note" hidden>공제액(4대보험·근로소득세)은 추가한 뒤 급여 화면 <b>명세서</b>에서 입력해요.</p>
      <div class="sheet-actions">
        <button type="button" class="btn-ghost" data-action="close-sheet">취소</button>
        <button type="submit" class="btn-primary">추가</button>
      </div>
    </form>`;
}

// ---------- 근무표 ----------
// 고른 요일의 근무자 (시작 시각 순)
function renderDayShifts() {
  const wd = state.schedDay ?? weekdayOf(todayDateString());
  const people = store.employees
    .filter((e) => e.active && effWeekly(e)[wd])
    .map((e) => ({ e, shift: effWeekly(e)[wd] }))
    .sort((a, b) => (a.shift.start < b.shift.start ? -1 : 1));
  const rows = people
    .map(({ e, shift }, i) => {
      const hours = hoursBetween(kstIso("2026-01-05", shift.start), endIso("2026-01-05", shift.start, shift.end));
      return `
        <button type="button" class="m-shift" style="--i:${i};--emp:${cssColor(e.color)}" data-action="edit-slot" data-wd="${wd}" data-id="${e.id}" data-start="${toMin(shift.start)}">
          <span class="m-shift-bar"></span>
          <span class="m-shift-body"><b>${esc(e.name)}${isManager(e) ? `<em class="m-chip">매니저</em>` : ""}</b><small>${shift.start} ~ ${shift.end}</small></span>
          <span class="m-shift-hours">${hour1(hours)}시간</span>
        </button>`;
    })
    .join("");
  return `
    ${rows || `<p class="m-empty">${WEEKDAYS[wd]}요일 근무자가 없어요.</p>`}
    <button type="button" class="m-add-shift" data-action="edit-slot" data-wd="${wd}" data-start="540">+ ${WEEKDAYS[wd]}요일 근무자 추가</button>`;
}

function renderScheduleMobile() {
  const wd = state.schedDay ?? weekdayOf(todayDateString());
  const meta = schedMeta();
  const count = (d) => store.employees.filter((e) => e.active && effWeekly(e)[d]).length;
  return renderAdminShell(
    "schedule",
    `
    ${mHead("근무표", `<div class="m-help">${schedHelp()}</div>`)}
    <label class="m-period">
      <span>기간</span>
      <input class="sc-period" value="${esc(normalizePeriod(meta.period ?? ""))}" data-meta="period" inputmode="numeric" placeholder="2026.06.04 ~" aria-label="기간" />
    </label>
    <div class="m-days" role="tablist">
      ${[1, 2, 3, 4, 5, 6, 0]
        .map(
          (d) => `
        <button type="button" role="tab" aria-selected="${d === wd}" class="m-day${d === wd ? " on" : ""}${d === 0 ? " sun" : d === 6 ? " sat" : ""}" data-action="sched-day" data-wd="${d}">
          <span>${WEEKDAYS[d]}</span><small>${count(d)}명</small>
        </button>`,
        )
        .join("")}
    </div>
    <div class="m-shifts${state.dayListEnter ? " enter" : ""}" id="sched-day-list">${renderDayShifts()}</div>
    <details class="m-fold">
      <summary>근무표 한눈에 보기</summary>
      <div class="sched-scroll" id="sched-scroll">${renderScheduleSheet()}</div>
    </details>
    <div id="sched-status">${renderSchedStatus()}</div>
    <div class="m-savebar">
      <button type="button" class="btn-ghost" data-action="schedule-temp"${schedDirty() ? "" : " disabled"}>임시저장</button>
      <button type="button" class="btn-primary" data-action="schedule-save"${hasDraft() ? "" : " disabled"}>저장</button>
      <button type="button" class="btn-ghost" data-action="schedule-share">카톡 전송</button>
    </div>`,
  );
}

// ---------- 급여 ----------
function renderRecordsMobile() {
  const { month } = state.payroll;
  const [y, m] = month.split("-").map(Number);
  const { recs, rows, total } = payrollFor(month, "");
  const taxOn = store.settings?.tax !== "none";
  const cards = rows
    .map(
      (r, i) => `
      <button type="button" class="m-row m-pay" style="--i:${i}" data-action="open-sheet" data-sheet="pay" data-id="${r.emp.id}">
        <span class="swatch big" style="background:${cssColor(r.emp.color)}"></span>
        <span class="m-row-body"><b>${esc(r.emp.name)}</b><small>${r.days}일 · ${hrs(r.hours)}</small></span>
        <span class="m-pay-net net">${r.net === null ? `<small class="need">공제 입력 필요</small>` : won(r.net)}</span>
        <span class="m-chev">${ICON_CHEVRON}</span>
      </button>`,
    )
    .join("");
  return renderAdminShell(
    "records",
    `
    <div class="m-month">
      <button type="button" class="round-btn" data-action="payroll-prev" aria-label="이전 달">${ICON_PREV}</button>
      <h1>${y}년 ${m}월</h1>
      <button type="button" class="round-btn" data-action="payroll-next" aria-label="다음 달">${ICON_NEXT}</button>
    </div>
    <div class="m-hero">
      <small>이번 달 실지급액 합계</small>
      <strong class="net">${won(total.net)}</strong>
      <div class="m-hero-meta">
        <span>${rows.length}명 · ${total.days}일 · ${hrs(total.hours)}</span>
        <select class="m-tax" data-setting="tax" aria-label="세금">
          <option value="3.3"${taxOn ? " selected" : ""}>3.3% 공제</option>
          <option value="none"${taxOn ? "" : " selected"}>공제 안 함</option>
        </select>
      </div>
      <div class="m-payday"><span>급여 지급일</span>${payDaySelects("m-tax")}</div>
    </div>
    <div class="m-list">${cards || `<p class="m-empty">이 달의 근무 기록이 없어요.</p>`}</div>
    <details class="m-fold">
      <summary>날짜별 근무 시간 표</summary>
      ${renderTimesheet(month, "")}
    </details>
    <div class="m-btns">
      <button type="button" class="btn-ghost" data-action="export-ledger"${rows.length ? "" : " disabled"}>급여대장 받기</button>
      <button type="button" class="btn-primary" data-action="payslip-pdf-all"${rows.length ? "" : " disabled"}>명세서 PDF 전체</button>
    </div>
    ${renderPayslipModal()}`,
  );
}

function renderPaySheet(emp) {
  const { month } = state.payroll;
  const recs = monthRecords(month, emp.id);
  const r = payrollRow(emp, month, recs);
  const line = (label, value, cls = "") => `<li class="${cls}"><span>${label}</span><b>${won(value)}</b></li>`;
  const days = recs
    .map((rec) => {
      const h = hoursBetween(rec.clockIn, rec.clockOut);
      return `<li><span>${shortDate(rec.date)}</span><span class="m-day-time">${formatTime(rec.clockIn)} ~ ${formatTime(rec.clockOut)}</span><b class="${diffClass(emp, rec.date, h).trim()}">${hour1(h)}시간</b></li>`;
    })
    .join("");
  return `
    <div class="sheet-head">
      <span class="swatch big" style="background:${cssColor(emp.color)}"></span>
      <div><h2>${esc(emp.name)}</h2><small>${Number(month.slice(5, 7))}월 · ${r.days}일 · ${hrs(r.hours)}</small></div>
    </div>
    <div class="m-hero small"><small>받을 금액</small><strong>${r.net === null ? "공제액 입력 필요" : won(r.net)}</strong></div>
    <ul class="m-lines">
      ${line(r.salaried ? "기본급 (월급)" : "기본급", r.base)}
      ${r.salaried ? (r.meal ? line("식대 (비과세)", r.meal) : "") : line("주휴수당", r.weekly.total)}
      ${r.allowances.filter((a) => a.name || Number(a.amount)).map((a) => line(esc(a.name || "수당"), Number(a.amount) || 0)).join("")}
      ${line("지급 합계", r.gross, "sum")}
      ${
        r.salaried
          ? r.ded
            ? DED_KEYS.map(([k, label]) => (r.ded[k] ? line(label, r.ded[k]) : "")).join("")
            : `<li><span>4대보험 · 근로소득세</span><b>입력 필요</b></li>`
          : `${line("소득세", r.income)}${line("지방소득세", r.local)}`
      }
    </ul>
    <p class="sheet-label">날짜별 근무</p>
    <ul class="m-days-list">${days || `<li><span>근무 기록이 없어요</span></li>`}</ul>
    <button type="button" class="btn-ghost m-share" data-action="share-ts-image" data-id="${emp.id}">카카오톡 전송하기</button>
    <div class="sheet-actions">
      <button type="button" class="btn-ghost" data-action="open-payslip" data-id="${emp.id}">수당 · 명세서</button>
      <button type="button" class="btn-primary" data-action="payslip-pdf-one" data-id="${emp.id}">명세서 PDF</button>
    </div>`;
}

// ---------- 급여 계산 ----------
// 주휴수당 (근로기준법 제55조): 월~일 한 주(휴일 포함 7일, 제2조)에 근무표상 근무일을 모두 출근했고,
//   그 주까지 4주 동안 평균한 1주 소정근로시간이 15시간 이상이면 (제18조 3항, 일한 지 4주가 안 됐으면 그 기간 평균)
//   (소정근로시간 ÷ 40) × 8시간 × 시급  (40시간 이상이면 8시간분)
//   대타·추가 근무처럼 근무표에 없던 시간은 소정근로시간에 넣지 않는다.
//   주가 끝나는 일요일이 속한 달에 넣고, 아직 끝나지 않은 주는 계산하지 않는다.
// 세금(3.3%): 소득세 3% + 지방소득세(소득세의 10%), 10원 미만 절사, 소득세 1,000원 미만이면 걷지 않음(소액부징수).

function monthRecords(ym, employeeId) {
  return store.records
    .filter((r) => r.date.startsWith(ym) && employeeById(r.employeeId) && (!employeeId || r.employeeId === employeeId))
    .sort((a, b) => (a.date === b.date ? (a.clockIn < b.clockIn ? -1 : 1) : a.date < b.date ? -1 : 1));
}


// 그 날짜에 적용되는 요일별 고정 근무
// 근무표를 저장하면 기간 시작일부터 새 근무표, 그 전 날짜는 바꾸기 전 근무표 (시작일이 미래여도 그날까지는 기존 근무표)
function weeklyOn(emp, date) {
  if (!emp.weeklyHistory) return emp.weekly;
  let weekly = emp.weeklyBase;
  for (const snap of emp.weeklyHistory) if (snap.from <= date) weekly = snap.weekly;
  return weekly;
}

// 소정근로시간: 그 주(월~일) 근무표상 고정 근무 시간 합계
function plannedHours(emp, days) {
  return days.reduce((sum, d) => {
    const s = weeklyOn(emp, d)[weekdayOf(d)];
    return s ? sum + hoursBetween(kstIso(d, s.start), endIso(d, s.start, s.end)) : sum;
  }, 0);
}

// 4주(그 주 포함, 28일) 평균 1주 소정근로시간. 처음 일한 주부터 4주가 안 됐으면 그 기간으로 평균
function avgPlannedHours(emp, sun) {
  const firstWork = store.records.filter((r) => r.employeeId === emp.id).reduce((min, r) => (r.date < min ? r.date : min), sun);
  const firstMon = addDays(firstWork, -((weekdayOf(firstWork) + 6) % 7)); // 처음 일한 주의 월요일
  let from = addDays(sun, -27);
  if (firstMon > from) from = firstMon;
  const days = [];
  for (let d = from; d <= sun; d = addDays(d, 1)) days.push(d);
  return plannedHours(emp, days) / (days.length / 7);
}

function weeklyAllowance(emp, ym) {
  const today = todayDateString();
  const [y, m] = ym.split("-").map(Number);
  const last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const weeks = [];
  // 이 달에 속한 일요일마다 그 주(월~일)를 본다
  for (let d = `${ym}-01`; d <= last; d = addDays(d, 1)) {
    if (weekdayOf(d) !== 0) continue;
    const sun = d;
    const mon = addDays(sun, -6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    const recs = store.records.filter((r) => r.employeeId === emp.id && r.date >= mon && r.date <= sun);
    const hours = recs.reduce((sum, r) => sum + hoursBetween(r.clockIn, r.clockOut), 0);
    if (!recs.length) continue;
    const planned = plannedHours(emp, days);
    const avg = avgPlannedHours(emp, sun);
    let reason = "";
    if (sun >= today) reason = "주가 아직 안 끝남";
    else if (avg < 15) reason = "4주 평균 소정근로 15시간 미만";
    else if (days.some((x) => weeklyOn(emp, x)[weekdayOf(x)] && !recordFor(emp.id, x))) reason = "결근 있음";
    const allowHours = reason ? 0 : Math.min(planned, 40) / 5;
    weeks.push({ mon, sun, hours, planned, reason, allowHours, amount: Math.round(allowHours * emp.hourlyWage) });
  }
  return { weeks, total: weeks.reduce((sum, w) => sum + w.amount, 0) };
}

const floor10 = (n) => Math.floor(n / 10) * 10;

function taxes(gross) {
  if (store.settings?.tax === "none") return { income: 0, local: 0 };
  let income = floor10(gross * 0.03);
  if (income < 1000) income = 0;
  return { income, local: floor10(income * 0.1) };
}

// 직원별·월별 추가 수당 (특근수당 등)
function allowancesFor(ym, empId) {
  // 예전 기본값으로 저장된 빈 "교육수당" 줄(0원)은 뺀다 (교육수당 기능은 없앰)
  return (store.allowances?.[ym]?.[empId] ?? []).filter((a) => !((a.name || "").trim() === "교육수당" && !Number(a.amount)));
}


// ---------- 급여 지급일 ----------
// 설정: payMonth "next"(다음 달, 기본) | "same"(그달), payday 1~31 | "last"(말일)
function payDateFor(ym) {
  let [y, m] = ym.split("-").map(Number);
  if ((store.settings?.payMonth ?? "next") === "next") {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const last = new Date(y, m, 0).getDate();
  const day = store.settings?.payday ?? "10";
  const d = day === "last" ? last : Math.min(Number(day) || 10, last);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const payDayLabel = () => `${(store.settings?.payMonth ?? "next") === "next" ? "다음 달" : "그달"} ${(store.settings?.payday ?? "10") === "last" ? "말일" : `${store.settings?.payday ?? 10}일`}`;
function payDaySelects(cls = "field") {
  const month = store.settings?.payMonth ?? "next";
  const day = String(store.settings?.payday ?? "10");
  return `<select class="${cls}" data-setting="payMonth" aria-label="지급 달"><option value="next"${month === "next" ? " selected" : ""}>다음 달</option><option value="same"${month === "same" ? " selected" : ""}>그달</option></select>
    <select class="${cls}" data-setting="payday" aria-label="지급일">${[...Array.from({ length: 28 }, (_, i) => String(i + 1)), "last"].map((d) => `<option value="${d}"${d === day ? " selected" : ""}>${d === "last" ? "말일" : `${d}일`}</option>`).join("")}</select>`;
}
const dot = (d) => (d ? d.replaceAll("-", ".") : "");

// ---------- 월급제 직원 (4대보험) ----------
// 월급·식대·공제액은 세무사에게 받은 금액을 한 번 입력하면 그달부터 다음 달, 그다음 달에도 그대로 이어진다.
// 금액이 바뀐 달에만 새로 입력하면 그달부터 새 금액. 지난달 명세서는 그때 금액 그대로.
const DED_KEYS = [["pension", "국민연금"], ["health", "건강보험"], ["care", "장기요양보험"], ["employ", "고용보험"], ["income", "근로소득세"], ["local", "지방소득세"]];
// 직원 목록 순서: 매니저(직원)가 맨 위. emp 를 매니저 무리의 바로 아래(= 알바 맨 앞)로 옮긴다
function placeByRole(emp) {
  const list = store.employees.filter((e) => e !== emp);
  const at = list.findIndex((e) => !isManager(e));
  list.splice(at < 0 ? list.length : at, 0, emp);
  store.employees = list;
}

// 따로 정하지 않았으면 매니저는 월급제, 알바는 시급제
const isSalaried = (emp) => Boolean(emp) && (store.salary?.[emp.id]?.on ?? isManager(emp));

function salaryFor(empId, ym) {
  let cur = null;
  for (const h of store.salary?.[empId]?.hist ?? []) if (h.from <= ym) cur = h;
  return cur;
}

function setSalary(empId, ym, entry) {
  store.salary = store.salary ?? {};
  const rec = (store.salary[empId] = store.salary[empId] ?? { on: true, hist: [] });
  rec.hist = rec.hist.filter((h) => h.from !== ym);
  const prev = salaryFor(empId, ym);
  const same = (a, b) => JSON.stringify({ s: a.salary, m: a.meal, d: a.ded }) === JSON.stringify({ s: b.salary, m: b.meal, d: b.ded });
  // 지난달부터 이어지는 금액과 같으면 따로 적지 않는다 (그래야 "언제부터" 가 처음 입력한 달로 남는다)
  if (!prev || !same(prev, entry)) rec.hist.push({ from: ym, ...entry });
  rec.hist.sort((a, b) => (a.from < b.from ? -1 : 1));
}

// 명세서 창에서 입력 중인 값 → 저장할 모양 (공제 칸을 하나도 안 채웠으면 ded = null: "공제 입력 필요")
function normalizeSalary(draft) {
  const filled = DED_KEYS.some(([k]) => draft.ded?.[k] !== null && draft.ded?.[k] !== undefined && draft.ded?.[k] !== "");
  return {
    salary: Number(draft.salary) || 0,
    meal: Number(draft.meal) || 0,
    ded: filled ? Object.fromEntries(DED_KEYS.map(([k]) => [k, Number(draft.ded[k]) || 0])) : null,
  };
}

const monthLabel = (m) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5, 7))}월`;

function setAllowances(ym, empId, list) {
  store.allowances = store.allowances ?? {};
  store.allowances[ym] = { ...store.allowances[ym], [empId]: list };
}

function payrollRow(emp, ym, recs, allowanceOverride, salaryOverride) {
  const mine = recs.filter((r) => r.employeeId === emp.id);
  if (isSalaried(emp)) return salaryRow(emp, ym, mine, allowanceOverride, salaryOverride);
  const hours = mine.reduce((sum, r) => sum + hoursBetween(r.clockIn, r.clockOut), 0);
  const base = Math.round(hours * emp.hourlyWage);
  const weekly = weeklyAllowance(emp, ym);
  const allowances = allowanceOverride ?? allowancesFor(ym, emp.id);
  const extra = allowances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const gross = base + weekly.total + extra;
  const tax = taxes(gross);
  return { emp, salaried: false, days: mine.length, hours, base, weekly, allowances, extra, meal: 0, ins: 0, gross, ...tax, dedTotal: tax.income + tax.local, net: gross - tax.income - tax.local };
}

// 월급제: 기본급 = 월급(세금 붙는 부분), 식대(비과세), 수당. 공제는 입력한 4대보험·근로소득세 그대로.
// 근무일·시간은 출근 기록이 있으면 기록으로, 없으면 근무표대로 (매니저처럼 출근을 안 찍는 경우)
function salaryRow(emp, ym, mine, allowanceOverride, salaryOverride) {
  const s = salaryOverride ?? salaryFor(emp.id, ym);
  const planDays = monthDays(ym).filter((d) => weeklyOn(emp, d)[weekdayOf(d)]);
  const days = mine.length || planDays.length;
  const hours = mine.length ? mine.reduce((sum, r) => sum + hoursBetween(r.clockIn, r.clockOut), 0) : plannedHours(emp, planDays);
  const base = s?.salary ?? 0;
  const meal = s?.meal ?? 0;
  const allowances = allowanceOverride ?? allowancesFor(ym, emp.id);
  const extra = allowances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const gross = base + meal + extra;
  const ded = s?.ded ?? null;
  const ins = ded ? ded.pension + ded.health + ded.care + ded.employ : 0;
  const income = ded?.income ?? 0;
  const local = ded?.local ?? 0;
  const dedTotal = ins + income + local;
  return {
    emp, salaried: true, days, hours, base, meal, weekly: { total: 0, weeks: [] }, allowances, extra, gross,
    ded, ins, income, local, dedTotal, net: ded ? gross - dedTotal : null, setFrom: s?.from ?? null,
  };
}

function payrollFor(ym, employeeId) {
  const recs = monthRecords(ym, employeeId);
  const ids = new Set(recs.map((r) => r.employeeId));
  // 월급제 직원은 출근 기록이 없어도 급여에 나온다
  for (const e of store.employees) if (e.active && isSalaried(e) && (!employeeId || e.id === employeeId)) ids.add(e.id);
  const rows = store.employees.filter((e) => ids.has(e.id)).map((emp) => payrollRow(emp, ym, recs));
  const sum = (k) => rows.reduce((acc, r) => acc + (r[k] ?? 0), 0);
  const total = {
    days: sum("days"),
    hours: sum("hours"),
    base: sum("base"),
    weekly: rows.reduce((acc, r) => acc + r.weekly.total, 0),
    extra: sum("extra"),
    meal: sum("meal"),
    ins: sum("ins"),
    gross: sum("gross"),
    income: sum("income"),
    local: sum("local"),
    net: sum("net"),
  };
  return { recs, rows, total };
}

const won = (n) => `${n.toLocaleString()}원`;
const hrs = (n) => `${Number(n.toFixed(2))}시간`;
const hour1 = (n) => (n ? n.toFixed(1) : "");
const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))} (${WEEKDAYS[weekdayOf(d)]})`;

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthDays(ym) {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

// 월별 근무표: 한 사람이 한 줄, 1일~말일 칸에 그날 근무시간
// includeAll: 기록이 없어도 재직 중인 알바는 줄을 보여준다 (화면에서 시간을 직접 입력할 수 있게)
function timesheet(ym, employeeId, { includeAll = false } = {}) {
  const days = monthDays(ym);
  const recs = monthRecords(ym, employeeId);
  const ids = new Set(recs.map((r) => r.employeeId));
  const people = store.employees.filter(
    (e) => ids.has(e.id) || (includeAll && e.active && !isManager(e) && (!employeeId || e.id === employeeId)),
  );
  const rows = people.map((emp) => {
    const dayRecs = days.map((d) => recs.find((r) => r.employeeId === emp.id && r.date === d));
    const cells = dayRecs.map((rec) => (rec ? hoursBetween(rec.clockIn, rec.clockOut) : 0));
    return { emp, cells, edited: dayRecs.map((rec) => Boolean(rec?.edited)), total: cells.reduce((a, b) => a + b, 0) };
  });
  return { days, rows };
}

function renderTimesheet(ym, employeeId) {
  const { days, rows } = timesheet(ym, employeeId, { includeAll: true });
  const today = todayDateString();
  if (!rows.length) return `<div class="table-wrap ts-wrap"><p class="empty">이 달의 근무 기록이 없습니다.</p></div>`;
  // 토요일 파랑, 일요일·공휴일 빨강, 오늘 강조 (열 전체를 칠하지 않고 글자로만)
  const dayClass = (d) => {
    const wd = weekdayOf(d);
    return (wd === 0 || HOLIDAYS[d] ? " sun" : wd === 6 ? " sat" : "") + (d === today ? " today" : "");
  };
  return `
    <div class="table-wrap ts-wrap ts-desktop">
      <table class="timesheet">
        <thead>
          <tr>
            <th class="ts-name">이름</th>
            ${days.map((d) => `<th class="ts-head${dayClass(d)}"><span class="ts-wd">${WEEKDAYS[weekdayOf(d)]}</span><span class="ts-dn">${Number(d.slice(8))}</span></th>`).join("")}
            <th class="ts-total">합계</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td class="ts-name">${nameLabel(r.emp)}</td>
              ${r.cells.map((_, j) => cell(r, j)).join("")}
              <td class="ts-total">${r.total.toFixed(1)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${renderTimesheetMobile(days, rows, cell, dayClass)}`;

  function cell(r, j) {
    const d = days[j];
    const saved = r.cells[j];
    if (d > today) return `<td class="ts-day"></td>`;
    // 근무표에 있는데 출근 기록이 없는 지난 날: 빨간 0 (화면에만 — 엑셀은 숫자만 쓰므로 빈칸 그대로)
    if (!saved && d < today && r.emp.active && plannedOn(r.emp, d) > 0) {
      return `<td class="ts-day miss" title="근무표에 있는데 출근 기록이 없어요">0</td>`;
    }
    // 오늘인데 아직 기록이 없으면 결근으로 보지 않는다
    const diff = d === today && !saved ? "" : diffClass(r.emp, d, saved);
    const cls = (r.edited[j] ? " edited" : "") + diff;
    return `<td class="ts-day${cls}"${r.edited[j] ? ` title="달력에서 직접 고친 시간"` : ""}>${saved ? hour1(saved) : ""}</td>`;
  }
}

// 휴대폰용 근무 상세: 날짜가 줄, 직원이 칸 (한 달 31칸을 가로로 늘어놓지 않게)
function renderTimesheetMobile(days, rows, cell, dayClass) {
  return `
    <div class="ts-mobile">
      <table class="timesheet">
        <thead><tr><th class="ts-date">날짜</th>${rows.map((r) => `<th class="ts-person">${esc(r.emp.name)}</th>`).join("")}</tr></thead>
        <tbody>
          ${days
            .map(
              (d, j) =>
                `<tr class="${dayClass(d).includes("today") ? "today-row" : ""}"><th class="ts-date${dayClass(d)}"><span class="ts-dn">${Number(d.slice(8))}</span><span class="ts-wd">${WEEKDAYS[weekdayOf(d)]}</span></th>${rows.map((r) => cell(r, j)).join("")}</tr>`,
            )
            .join("")}
          <tr class="ts-sum"><th class="ts-date">합계</th>${rows.map((r) => `<td class="ts-total">${r.total.toFixed(1)}</td>`).join("")}</tr>
        </tbody>
      </table>
    </div>`;
}

// ---------- 급여명세서 ----------



function renderPayslip(r, ym) {
  const [y, m] = ym.split("-").map(Number);
  const extras = r.allowances.filter((a) => a.name || Number(a.amount)).map((a) => [a.name || "수당", Number(a.amount) || 0]);
  const pay = r.salaried
    ? [["기본급 (월급)", r.base], ...(r.meal ? [["식대 (비과세)", r.meal]] : []), ...extras]
    : [["기본급", r.base], ["주휴수당", r.weekly.total], ...extras];
  const deduct = r.salaried
    ? r.ded
      ? DED_KEYS.map(([k, label]) => [label, r.ded[k]]).filter(([, v]) => v)
      : []
    : [
        ["소득세 (3%)", r.income],
        ["지방소득세 (0.3%)", r.local],
      ];
  const deductTotal = r.dedTotal;
  const pending = r.salaried && !r.ded;
  const line = ([label, value]) => `<li><span>${esc(label)}</span><b>${won(value)}</b></li>`;
  const issued = todayDateString().replaceAll("-", ".");
  const lastDay = new Date(y, m, 0).getDate();
  // 임금명세서 필수 기재: 금액이 근무시간에 따라 달라지면 계산 방법을 적는다 (근로기준법 시행령 제27조의2)
  const wage = r.emp.hourlyWage;
  const weeks = r.weekly.weeks ?? [];
  const juHours = weeks.reduce((sum, w) => sum + (w.allowHours || 0), 0);
  const calc = r.salaried
    ? [
        `기본급: 월 고정급 ${won(r.base)}`,
        ...(r.meal ? [`식대: 비과세 (월 20만 원 한도) ${won(r.meal)}`] : []),
        `공제: 4대보험·근로소득세는 세무사 산정 금액`,
      ]
    : [
        `기본급: 근무 ${Number(r.hours.toFixed(2))}시간 × 시급 ${won(wage)}`,
        r.weekly.total
          ? `주휴수당: ${weeks.filter((w) => w.allowHours).length}주 · 주휴 ${Number(juHours.toFixed(2))}시간 × 시급 ${won(wage)} (주별: 1주 소정근로시간 ÷ 40 × 8시간)`
          : `주휴수당: 없음 ${weeks.find((w) => w.reason)?.reason ? `(${weeks.find((w) => w.reason).reason})` : ""}`,
        r.income ? `공제: 소득세 = 지급 합계 × 3% (10원 미만 버림), 지방소득세 = 소득세 × 10%` : `공제: 없음`,
      ];

  return `
    <div class="payslip">
      <header class="ps-top">
        <span class="ps-brand">급여명세서</span>
        <span class="ps-month">${y}년 ${m}월</span>
      </header>
      <h1 class="ps-name">${esc(r.emp.name)} 님</h1>
      <p class="ps-meta">${r.salaried ? "월급제" : `시급 ${won(r.emp.hourlyWage)}`} · 근무 ${r.days}일 · 총 ${Number(r.hours.toFixed(2))}시간</p>
      <p class="ps-meta ps-ids">사번 ${r.emp.no ?? "-"}${r.emp.hireDate ? ` · 입사 ${dot(r.emp.hireDate)}` : ""} · 근무기간 ${m}/1~${m}/${lastDay} · <b>지급일 ${dot(payDateFor(ym))}</b></p>

      <div class="ps-net">
        <span>지급 금액</span>
        <strong>${pending ? "공제액 입력 필요" : won(r.net)}</strong>
      </div>

      <section class="ps-sec">
        <h2>지급</h2>
        <ul>${pay.map(line).join("")}</ul>
        <p class="ps-sum"><span>지급 합계</span><b>${won(r.gross)}</b></p>
      </section>

      <section class="ps-sec">
        <h2>공제</h2>
        <ul>${pending ? `<li><span>4대보험 · 근로소득세</span><b>입력 필요</b></li>` : deductTotal ? deduct.map(line).join("") : `<li><span>공제 없음</span><b>0원</b></li>`}</ul>
        <p class="ps-sum"><span>공제 합계</span><b>${won(deductTotal)}</b></p>
      </section>

      <section class="ps-calc">
        <h2>계산 방법</h2>
        <ul>${calc.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </section>

      <footer class="ps-foot">
        <p class="ps-thanks">이번 한 달도 수고 많으셨어요. 감사합니다.</p>
        <p class="ps-store">${esc(storeName())}</p>
        <p class="ps-issued">발행일 ${issued}</p>
      </footer>
    </div>`;
}

function openPayslipState(id) {
  state.sheet = null; // 휴대폰: 급여 시트에서 명세서 창으로 넘어간다
  state.payslipId = id;
  state.allowDraft = structuredClone(allowancesFor(state.payroll.month, id));
  const cur = salaryFor(id, state.payroll.month);
  state.salDraft = isSalaried(employeeById(id))
    ? { salary: cur?.salary ?? 0, meal: cur?.meal ?? 0, ded: Object.fromEntries(DED_KEYS.map(([k]) => [k, cur?.ded ? cur.ded[k] : null])) }
    : null;
}

// 명세서 창: 월급제 직원의 월급·식대·공제액 (세무사 금액)
function renderSalaryInputs(empId, month) {
  const d = state.salDraft;
  const cur = salaryFor(empId, month);
  const money = (v) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString());
  const row = (label, key, value, hint = "") => `
    <label class="sal-row"><span>${label}${hint ? `<small>${hint}</small>` : ""}</span>
      <input class="field money" type="text" inputmode="numeric" value="${money(value)}" placeholder="${key.startsWith("ded.") ? "입력 필요" : "0"}" data-sal="${key}" aria-label="${label}" /></label>`;
  const since = cur ? (cur.from === month ? "이번 달에 입력한 금액이에요." : `${monthLabel(cur.from)}에 입력한 금액이 이어지고 있어요.`) : "처음 입력하면 이번 달부터 다음 달에도 같은 금액이 들어가요.";
  const m = Number(month.slice(5, 7));
  const notice =
    m === 1 ? "1월은 보험료율이 바뀌는 달이에요. 세무사 금액과 같은지 확인해주세요."
    : m === 4 ? "4월은 건강보험 정산이 있는 달이에요. 세무사 금액과 같은지 확인해주세요."
    : m === 7 ? "7월은 국민연금 기준 금액이 바뀌는 달이에요. 세무사 금액과 같은지 확인해주세요."
    : "";
  return `
    <div class="sal-box">
      <p class="sal-title">월급 <small>세금 떼기 전</small></p>
      ${row("기본급 (월급)", "salary", d.salary)}
      ${row("식대", "meal", d.meal, "비과세 · 월 20만 원까지")}
      <p class="sal-title">공제액 <small>세무사에게 받은 금액 그대로</small></p>
      ${DED_KEYS.map(([k, label]) => row(label, `ded.${k}`, d.ded[k])).join("")}
      <p class="sal-note">${since} 금액이 바뀐 달에만 고치면 그달부터 새 금액이 이어져요.</p>
      ${notice ? `<p class="sal-alert">${notice}</p>` : ""}
    </div>`;
}

function renderPayslipModal() {
  const empId = state.payslipId;
  if (!empId) return "";
  const { month } = state.payroll;
  const emp = employeeById(empId);
  // 명세서 창에서는 저장 전까지 수정 중인 수당(state.allowDraft)으로 미리 계산
  const r = payrollRow(emp, month, monthRecords(month, empId), state.allowDraft, state.salDraft ? normalizeSalary(state.salDraft) : undefined);
  const list = state.allowDraft ?? allowancesFor(month, empId);
  return `
    <div class="ps-backdrop${state.modalEnter ? " enter" : ""}" data-action="close-payslip">
      <div class="ps-dialog" data-stop>
        <div class="ps-side">
          <p class="staff-title">${esc(emp.name)} · ${Number(month.slice(5, 7))}월 명세서</p>
          <p class="sub">${state.salDraft ? "월급·식대·공제액과 수당을 입력하면 명세서가 바로 바뀌어요." : "수당을 입력하면 지급액과 세금이 다시 계산돼요. 저장한 뒤 근무 기록의 <b>명세서 PDF</b>로 한꺼번에 받을 수 있어요."}</p>
          ${state.salDraft ? renderSalaryInputs(empId, month) : ""}
          <div class="ps-allow">
            ${list
              .map(
                (a, i) => `
              <div class="ps-allow-row">
                <input class="field" value="${esc(a.name)}" placeholder="수당 이름" data-allow="name" data-index="${i}" aria-label="수당 이름" />
                <input class="field ps-allow-amount money" type="text" inputmode="numeric" value="${a.amount ? Number(a.amount).toLocaleString() : ""}" placeholder="0" data-allow="amount" data-index="${i}" aria-label="${esc(a.name || "수당")} 금액" />
                <button type="button" class="danger" data-action="remove-allowance" data-index="${i}" aria-label="삭제">삭제</button>
              </div>`,
              )
              .join("")}
            <button type="button" class="add-btn" data-action="add-allowance">+ 수당 추가</button>
          </div>
          <div class="action-row">
            <button type="button" class="btn-ghost" data-action="close-payslip">닫기</button>
            <button type="button" class="btn-primary" data-action="save-payslip">저장</button>
          </div>
        </div>
        <div class="ps-preview">${renderPayslip(r, month)}</div>
      </div>
    </div>`;
}

function renderRecords() {
  if (!isDesktop()) return renderRecordsMobile();
  const { month, employeeId } = state.payroll;
  const [y, m] = month.split("-").map(Number);
  const { recs, rows, total } = payrollFor(month, employeeId);
  const taxOn = store.settings?.tax !== "none";

  const summary = rows
    .map(
      (r, i) => `
      <tr style="--i:${i}">
        <td class="name">${esc(r.emp.name)}${r.salaried ? ` <span class="pay-tag">월급</span>` : ""}</td>
        <td class="num" data-label="근무일">${r.days}일</td>
        <td class="num" data-label="근무시간">${hrs(r.hours)}</td>
        <td class="num" data-label="기본급">${won(r.base)}</td>
        ${
          r.salaried
            ? `<td class="num muted" data-label="주휴수당">월급 포함</td>`
            : `<td class="num" data-label="주휴수당" title="${esc(r.weekly.weeks.map((w) => `${shortDate(w.mon)}~${shortDate(w.sun)} 소정 ${hrs(w.planned)} (실근무 ${hrs(w.hours)}) ${w.reason || `→ ${won(w.amount)}`}`).join("\n"))}">${won(r.weekly.total)}</td>`
        }
        <td class="num" data-label="수당"${r.meal ? ` title="식대 ${won(r.meal)} (비과세) 포함"` : ""}>${won(r.extra + r.meal)}</td>
        <td class="num strong" data-label="지급총액">${won(r.gross)}</td>
        <td class="num${r.salaried ? "" : " muted"}" data-label="4대보험">${r.salaried ? (r.ded ? won(r.ins) : "-") : "-"}</td>
        <td class="num" data-label="소득세">${r.salaried && !r.ded ? "-" : won(r.income)}</td>
        <td class="num" data-label="지방소득세">${r.salaried && !r.ded ? "-" : won(r.local)}</td>
        <td class="num strong net" data-label="실지급액">${r.net === null ? `<button type="button" class="link-btn need" data-action="open-payslip" data-id="${r.emp.id}">공제 입력 필요</button>` : won(r.net)}</td>
        <td class="ps-cell"><button type="button" class="link-btn" data-action="open-payslip" data-id="${r.emp.id}">명세서</button></td>
      </tr>`,
    )
    .join("");

  return renderAdminShell(
    "records",
    `
    <div class="toolbar records-bar">
      <div class="month-nav">
        <button type="button" class="round-btn" data-action="payroll-prev" aria-label="이전 달">${ICON_PREV}</button>
        <h2>${y}년 ${m}월</h2>
        <button type="button" class="round-btn" data-action="payroll-next" aria-label="다음 달">${ICON_NEXT}</button>
      </div>
      <div>
        <label for="r-emp">직원</label>
        <select id="r-emp" class="field" data-payroll="employeeId">
          <option value="">전체</option>
          ${store.employees.filter((e) => !isManager(e) || isSalaried(e)).map((e) => `<option value="${e.id}"${e.id === employeeId ? " selected" : ""}>${esc(e.name)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>급여 지급일</label>
        <div class="payday-pick">${payDaySelects()}</div>
      </div>
      <div>
        <label for="r-tax">세금</label>
        <select id="r-tax" class="field" data-setting="tax">
          <option value="3.3"${taxOn ? " selected" : ""}>${isDesktop() ? "3.3% 공제 (사업소득)" : "3.3% 공제"}</option>
          <option value="none"${taxOn ? "" : " selected"}>공제 안 함</option>
        </select>
      </div>
    </div>

    <div class="section-head">
      <h3>근무 상세</h3>
      <div class="head-actions">
        ${employeeId ? `<button type="button" class="pill" data-action="share-ts-image" data-id="${employeeId}">카카오톡 전송하기</button>` : ""}
        <button type="button" class="pill plain-dark" data-action="export-ledger"${rows.length ? "" : " disabled"} title="세무사에게 보내는 급여대장 (알바·직원·날짜별 근무시간·주휴수당 내역)">급여대장 받기</button>
      </div>
    </div>
    ${renderTimesheet(month, employeeId)}

    <div class="section-head">
      <h3>급여 정산</h3>
      <button type="button" class="pill" data-action="payslip-pdf-all"${rows.length ? "" : " disabled"}>명세서 PDF${rows.length > 1 ? " (전체)" : ""}</button>
    </div>
    <div class="table-wrap pay-wrap">
      <table class="pay-table">
        <thead><tr><th>이름</th><th class="num">근무일</th><th class="num">근무시간</th><th class="num">기본급</th><th class="num">주휴수당</th><th class="num">수당</th><th class="num">지급총액</th><th class="num">4대보험</th><th class="num">소득세</th><th class="num">지방소득세</th><th class="num">실지급액</th><th></th></tr></thead>
        <tbody>
          ${summary || `<tr><td colspan="12" class="empty">이 달의 근무 기록이 없습니다.</td></tr>`}
          ${
            rows.length > 1
              ? `<tr class="total-row"><td class="name">합계</td><td class="num" data-label="근무일">${total.days}일</td><td class="num" data-label="근무시간">${hrs(total.hours)}</td><td class="num" data-label="기본급">${won(total.base)}</td><td class="num" data-label="주휴수당">${won(total.weekly)}</td><td class="num" data-label="수당">${won(total.extra + total.meal)}</td><td class="num" data-label="지급총액">${won(total.gross)}</td><td class="num" data-label="4대보험">${won(total.ins)}</td><td class="num" data-label="소득세">${won(total.income)}</td><td class="num" data-label="지방소득세">${won(total.local)}</td><td class="num net" data-label="실지급액">${won(total.net)}</td><td class="ps-cell"></td></tr>`
              : ""
          }
        </tbody>
      </table>
    </div>
    ${helpToggle(
      "records",
      `주휴수당: 월~일 한 주 동안 근무표상 근무일에 모두 출근했고, 그 주까지 4주 평균 1주 소정근로시간(근무표의 고정 근무 시간)이 15시간 이상이면 (소정근로시간 ÷ 40) × 8시간 × 시급. 대타·추가 근무 시간은 넣지 않아요. 그 주가 끝나는 일요일이 속한 달에 포함되고, 아직 끝나지 않은 주는 빠져요. 금액에 마우스를 올리면 주별 내역이 보여요.<br />
      수당(특근수당 등)은 이름 옆 <b>명세서</b>를 눌러 입력해요.<br />
      <b>월급제(4대보험)</b> 직원은 명세서에서 월급·식대·공제액(세무사 금액)을 입력해요. 한 번 입력하면 다음 달에도 같은 금액이 이어지고, 바뀐 달에만 고치면 돼요.<br />
      ${taxOn ? "세금: 소득세 3% + 지방소득세(소득세의 10%), 10원 미만 절사. 소득세가 1,000원 미만이면 공제하지 않아요." : "세금을 공제하지 않고 계산했어요."}`,
    )}
    ${renderPayslipModal()}`,
  );
}

// ---------- 외부 라이브러리 (필요할 때만 불러옴) ----------

const LIBS = {
  html2canvas: { src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", ready: () => window.html2canvas },
  jspdf: { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", ready: () => window.jspdf?.jsPDF },
  xlsx: { src: "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js", ready: () => window.XLSX },
};

function loadLib(name) {
  const lib = LIBS[name];
  if (lib.ready()) return Promise.resolve(lib.ready());
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = lib.src;
    el.onload = () => resolve(lib.ready());
    el.onerror = () => reject(new Error("파일 만드는 도구를 불러오지 못했어요. 인터넷 연결을 확인해주세요."));
    document.head.appendChild(el);
  });
}

// ---------- 안내 · 확인 창 (브라우저 기본 alert / confirm 대신 앱 디자인으로) ----------
// uiAlert(문구) → 확인만, uiConfirm(문구, { ok, danger }) → 확인이면 true
function uiDialog({ message, ok = "확인", cancel = null, danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const back = document.createElement("div");
    back.className = "ui-back";
    back.innerHTML = `
      <div class="ui-box" role="alertdialog" aria-modal="true" aria-describedby="ui-msg">
        <p class="ui-msg" id="ui-msg"></p>
        <div class="ui-actions">
          ${cancel ? `<button type="button" class="ui-btn ui-no" data-ui="no">${esc(cancel)}</button>` : ""}
          <button type="button" class="ui-btn ui-yes${danger ? " danger" : ""}" data-ui="yes">${esc(ok)}</button>
        </div>
      </div>`;
    back.querySelector(".ui-msg").textContent = message;
    const buttons = [...back.querySelectorAll("button")];
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      back.classList.add("leave");
      setTimeout(() => back.remove(), reducedMotion() ? 0 : 160);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
      resolve(value);
    };
    // Esc = 취소, Enter = 지금 선택된 버튼 (처음엔 확인), Tab 은 창 안에서만
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(document.activeElement?.dataset.ui !== "no");
      else if (e.key === "Tab") {
        const i = buttons.indexOf(document.activeElement);
        buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    back.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ui]");
      if (b) close(b.dataset.ui === "yes");
      else if (e.target === back) close(!cancel); // 바깥을 누르면: 확인 창은 취소, 안내 창은 닫기
    });
    document.body.appendChild(back);
    // 창을 연 키 입력(Enter 등)이 바로 창을 닫지 않게 다음 순간부터 키를 받는다
    setTimeout(() => {
      document.addEventListener("keydown", onKey, true);
      back.querySelector(".ui-yes").focus({ preventScroll: true });
    });
  });
}
const uiAlert = (message) => uiDialog({ message });

// 글자를 입력받는 창. 확인이면 입력한 글자, 취소면 null
function uiPrompt(message, { ok = "확인", placeholder = "", allowEmpty = false, kind = "text", danger = false } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const back = document.createElement("div");
    back.className = "ui-back";
    back.innerHTML = `
      <form class="ui-box" role="dialog" aria-modal="true" aria-describedby="ui-msg">
        <p class="ui-msg" id="ui-msg"></p>
        <input class="field ui-input${kind === "pin" ? "" : " ui-input-text"}" type="${kind === "text" ? "text" : "password"}"${kind === "pin" ? ' inputmode="numeric" pattern="[0-9]*"' : ""} maxlength="${kind === "pin" ? 6 : 60}" autocomplete="${kind === "password" ? "current-password" : "off"}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder || "입력")}" />
        <p class="ui-err" hidden></p>
        <div class="ui-actions">
          <button type="button" class="ui-btn ui-no" data-ui="no">취소</button>
          <button type="submit" class="ui-btn ui-yes${danger ? " danger" : ""}">${esc(ok)}</button>
        </div>
      </form>`;
    back.querySelector(".ui-msg").textContent = message;
    const input = back.querySelector(".ui-input");
    const err = back.querySelector(".ui-err");
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      back.classList.add("leave");
      setTimeout(() => back.remove(), reducedMotion() ? 0 : 160);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    };
    if (kind === "pin") input.addEventListener("input", () => (input.value = input.value.replace(/\D/g, "").slice(0, 6)));
    back.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (kind === "pin" ? /^\d{6}$/.test(v) : v || allowEmpty) close(v);
      else {
        err.textContent = kind === "pin" ? "숫자 6자리를 입력해주세요." : "입력해주세요.";
        err.hidden = false;
        input.focus();
      }
    });
    back.addEventListener("click", (e) => {
      if (e.target.closest("[data-ui=no]") || e.target === back) close(null);
    });
    document.body.appendChild(back);
    setTimeout(() => {
      document.addEventListener("keydown", onKey, true);
      input.focus();
    });
  });
}

const uiConfirm = (message, options = {}) => uiDialog({ message, cancel: "취소", ...options });

async function withBusy(button, text, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = text;
  try {
    await task();
  } catch (err) {
    uiAlert(err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ---------- 엑셀 파일 저장 ----------
const XLSX_TYPE = { description: "Excel 파일", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } };

// 새 파일로 저장. 저장 위치 고르기 창은 클릭 직후에만 열 수 있어서, 안 되면 내려받기로 대신한다.
async function saveXlsxBytes(bytes, name) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [XLSX_TYPE] });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// ---------- 엑셀: 급여대장 (세무사에게 보내는 파일) ----------
// 한 파일에 시트 4개: 알바(3.3%) · 직원(4대보험) · 날짜별 근무시간 · 주휴수당 내역. 숫자는 앱 명세서와 같다.
function exportLedger(button) {
  return withBusy(button, "만드는 중…", async () => {
    const XLSX = await loadLib("xlsx");
    const { month } = state.payroll;
    const [y, m] = month.split("-").map(Number);
    const { rows } = payrollFor(month, "");
    if (!rows.length) throw new Error("이 달에는 급여를 계산할 직원이 없어요.");
    const hourly = rows.filter((r) => !r.salaried);
    const salaried = rows.filter((r) => r.salaried);
    const days = monthDays(month);
    const period = `${days[0].replaceAll("-", ".")} ~ ${days[days.length - 1].replaceAll("-", ".")}`;
    const made = todayDateString().replaceAll("-", ".");
    const store_ = storeName();

    const C = { line: { style: "thin", color: { rgb: "D5DCDA" } } };
    const border = { top: C.line, bottom: C.line, left: C.line, right: C.line };
    const st = {
      title: { font: { bold: true, sz: 14 } },
      meta: { font: { color: { rgb: "66736F" } } },
      head: { font: { bold: true }, fill: { fgColor: { rgb: "E2F4F2" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border },
      text: { border },
      name: { font: { bold: true }, border },
      num: { numFmt: "#,##0", alignment: { horizontal: "right" }, border },
      dec: { numFmt: "#,##0.##", alignment: { horizontal: "right" }, border },
      net: { numFmt: "#,##0", font: { bold: true, color: { rgb: "0E8F8A" } }, alignment: { horizontal: "right" }, border },
      sum: { numFmt: "#,##0", font: { bold: true }, fill: { fgColor: { rgb: "F3F6F5" } }, alignment: { horizontal: "right" }, border },
      sumText: { font: { bold: true }, fill: { fgColor: { rgb: "F3F6F5" } }, border },
      note: { font: { color: { rgb: "B45309" } }, border },
      mid: { alignment: { horizontal: "center" }, border },
      sun: { font: { color: { rgb: "D64545" } }, alignment: { horizontal: "center" }, border },
      headSun: { font: { bold: true, color: { rgb: "D64545" } }, fill: { fgColor: { rgb: "E2F4F2" } }, alignment: { horizontal: "center", wrapText: true }, border },
    };
    const cell = (v, s) => ({ v: v ?? "", t: typeof v === "number" ? "n" : "s", s });
    // 시트 만들기: 제목·기간 줄 + 표. widths = 열 너비(글자 수)
    const sheet = (title, meta, head, body, widths, headStyles) => {
      const aoa = [
        [cell(title, st.title)],
        [cell(meta, st.meta)],
        [],
        head.map((h, i) => cell(h, headStyles?.[i] ?? st.head)),
        ...body,
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = widths.map((w) => ({ wch: w }));
      ws["!rows"] = [{ hpt: 24 }, {}, {}, { hpt: 30 }];
      return ws;
    };
    const tot = (list, k) => list.reduce((a, r) => a + (r[k] ?? 0), 0);
    const empDates = (e) => [e.no ? `사번 ${e.no}` : "", e.hireDate ? `입사 ${dot(e.hireDate)}` : "", e.leaveDate ? `퇴사 ${dot(e.leaveDate)}` : ""].filter(Boolean).join(" ");
    const memo = (r) => [empDates(r.emp), r.allowances.filter((a) => a.name && Number(a.amount)).map((a) => `${a.name} ${Number(a.amount).toLocaleString()}`).join(", ")].filter(Boolean).join(" · ");

    // 1. 알바 (3.3%)
    const taxNote = store.settings?.tax === "none" ? "세금 공제 안 함" : "세금 3.3% (소득세 3% + 지방소득세 0.3%)";
    const ws1 = sheet(
      `${store_} ${y}년 ${m}월 급여대장 · 알바`,
      `기간 ${period}   ·   지급일 ${dot(payDateFor(month))}   ·   ${taxNote}   ·   작성일 ${made}`,
      ["이름", "근무일수", "근무시간", "시급", "기본급", "주휴수당", "기타수당", "지급총액(세전)", "소득세", "지방소득세", "실지급액(세후)", "비고"],
      hourly.length
        ? [
            ...hourly.map((r) => [
              cell(r.emp.name, st.name), cell(r.days, st.num), cell(Number(r.hours.toFixed(2)), st.dec), cell(r.emp.hourlyWage, st.num),
              cell(r.base, st.num), cell(r.weekly.total, st.num), cell(r.extra, st.num), cell(r.gross, st.num),
              cell(r.income, st.num), cell(r.local, st.num), cell(r.net, st.net), cell(memo(r), st.text),
            ]),
            [
              cell("합계", st.sumText), cell(tot(hourly, "days"), st.sum), cell(Number(tot(hourly, "hours").toFixed(2)), st.sum), cell("", st.sumText),
              cell(tot(hourly, "base"), st.sum), cell(hourly.reduce((a, r) => a + r.weekly.total, 0), st.sum), cell(tot(hourly, "extra"), st.sum), cell(tot(hourly, "gross"), st.sum),
              cell(tot(hourly, "income"), st.sum), cell(tot(hourly, "local"), st.sum), cell(tot(hourly, "net"), st.sum), cell("", st.sumText),
            ],
          ]
        : [[cell("이 달에는 시급제(알바) 직원이 없어요.", st.text)]],
      [10, 8, 9, 9, 12, 11, 10, 14, 10, 10, 14, 22],
    );

    // 2. 직원 (4대보험)
    const ws2 = sheet(
      `${store_} ${y}년 ${m}월 급여대장 · 직원 (4대보험)`,
      `기간 ${period}   ·   지급일 ${dot(payDateFor(month))}   ·   공제액은 세무사 금액을 앱에 입력한 값   ·   작성일 ${made}`,
      ["이름", "근무일수", "근무시간", "기본급(월급)", "식대(비과세)", "기타수당", "지급총액(세전)", ...DED_KEYS.map(([, l]) => l), "공제합계", "실지급액(세후)", "비고"],
      salaried.length
        ? [
            ...salaried.map((r) => [
              cell(r.emp.name, st.name), cell(r.days, st.num), cell(Number(r.hours.toFixed(2)), st.dec),
              cell(r.base, st.num), cell(r.meal, st.num), cell(r.extra, st.num), cell(r.gross, st.num),
              ...DED_KEYS.map(([k]) => (r.ded ? cell(r.ded[k], st.num) : cell("", st.text))),
              r.ded ? cell(r.dedTotal, st.num) : cell("", st.text),
              r.ded ? cell(r.net, st.net) : cell("", st.text),
              r.ded ? cell([r.setFrom ? `${Number(r.setFrom.slice(5, 7))}월부터 같은 금액` : "", memo(r)].filter(Boolean).join(" · "), st.text) : cell(["공제액 입력 필요 (세무사 계산)", empDates(r.emp)].filter(Boolean).join(" · "), st.note),
            ]),
            [
              cell("합계", st.sumText), cell(tot(salaried, "days"), st.sum), cell(Number(tot(salaried, "hours").toFixed(2)), st.sum),
              cell(tot(salaried, "base"), st.sum), cell(tot(salaried, "meal"), st.sum), cell(tot(salaried, "extra"), st.sum), cell(tot(salaried, "gross"), st.sum),
              ...DED_KEYS.map(([k]) => cell(salaried.reduce((a, r) => a + (r.ded?.[k] ?? 0), 0), st.sum)),
              cell(tot(salaried, "dedTotal"), st.sum), cell(tot(salaried, "net"), st.sum), cell("", st.sumText),
            ],
          ]
        : [[cell("이 달에는 월급제(4대보험) 직원이 없어요.", st.text)]],
      [10, 8, 9, 13, 12, 10, 14, 10, 10, 11, 10, 11, 10, 11, 14, 24],
    );

    // 3. 날짜별 근무시간 (출근 기록, 출근을 안 찍는 월급제 직원은 근무표대로)
    const dayHours = (r, d) => {
      const recs = store.records.filter((x) => x.employeeId === r.emp.id && x.date === d && x.clockOut);
      if (recs.length) return recs.reduce((a, x) => a + hoursBetween(x.clockIn, x.clockOut), 0);
      if (r.salaried && !store.records.some((x) => x.employeeId === r.emp.id && x.date.startsWith(month))) return plannedHours(r.emp, [d]);
      return 0;
    };
    const ws3 = sheet(
      `${store_} ${y}년 ${m}월 날짜별 근무시간`,
      "단위: 시간   ·   출근 기록 기준 (출근을 찍지 않는 월급제 직원은 근무표 기준)",
      ["이름", "구분", ...days.map((d) => `${Number(d.slice(8))}\n${WEEKDAYS[weekdayOf(d)]}`), "일수", "시간"],
      rows.map((r) => {
        const hs = days.map((d) => dayHours(r, d));
        return [
          cell(r.emp.name, st.name), cell(r.salaried ? "직원" : "알바", st.mid),
          ...hs.map((h, i) => cell(h ? Number(h.toFixed(2)) : "", weekdayOf(days[i]) === 0 ? st.sun : st.mid)),
          cell(hs.filter((h) => h).length, st.num), cell(Number(hs.reduce((a, h) => a + h, 0).toFixed(2)), st.dec),
        ];
      }),
      [10, 6, ...days.map(() => 4.5), 6, 7],
      ["", "", ...days.map((d) => (weekdayOf(d) === 0 ? st.headSun : st.head)), "", ""].map((x) => x || st.head),
    );

    // 4. 주휴수당 내역 (알바만)
    const ws4 = sheet(
      `${store_} ${y}년 ${m}월 주휴수당 내역`,
      "주휴시간 = 소정근로시간 ÷ 40 × 8 (40시간 넘으면 8시간) · 4주 평균 15시간 이상, 그 주 개근 · 주가 끝나는 일요일이 속한 달에 포함",
      ["이름", "주 (월~일)", "소정근로시간", "4주 평균", "실근무시간", "주휴시간", "주휴수당", "안 붙은 이유"],
      hourly.flatMap((r) =>
        r.weekly.weeks.map((w, i) => [
          cell(i ? "" : r.emp.name, st.name),
          cell(`${shortDate(w.mon)} ~ ${shortDate(w.sun)}`, st.mid),
          cell(Number(w.planned.toFixed(2)), st.dec),
          cell(Number(avgPlannedHours(r.emp, w.sun).toFixed(2)), st.dec),
          cell(Number(w.hours.toFixed(2)), st.dec),
          cell(Number(w.allowHours.toFixed(2)), st.dec),
          cell(w.amount, st.num),
          cell(w.reason, w.reason ? st.note : st.text),
        ]),
      ).concat(hourly.length ? [[cell("합계", st.sumText), cell("", st.sumText), cell("", st.sumText), cell("", st.sumText), cell("", st.sumText), cell("", st.sumText), cell(hourly.reduce((a, r) => a + r.weekly.total, 0), st.sum), cell("", st.sumText)]] : [[cell("이 달에는 시급제(알바) 직원이 없어요.", st.text)]]),
      [10, 16, 12, 10, 10, 9, 11, 22],
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "알바 (3.3%)");
    XLSX.utils.book_append_sheet(wb, ws2, "직원 (4대보험)");
    XLSX.utils.book_append_sheet(wb, ws3, "날짜별 근무시간");
    XLSX.utils.book_append_sheet(wb, ws4, "주휴수당 내역");
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const saved = await saveXlsxBytes(new Uint8Array(bytes), `${store_} ${m}월.xlsx`);
    if (!saved) return;
    const pending = salaried.filter((r) => !r.ded).map((r) => r.emp.name);
    if (pending.length) uiAlert(`저장했어요. 다만 ${pending.join(", ")}님은 공제액이 아직 없어서 세후 금액이 비어 있어요.\n세무사 금액을 명세서에 입력하면 채워져요.`);
    else showToast("급여대장을 저장했어요", "ok");
  });
}

// ---------- 매장 · 계정 삭제 ----------
// 매장 이름을 다시 입력하고 비밀번호로 한 번 더 확인한 뒤, 매장 기록 전부와 관리자 계정을 지운다
async function deleteStore() {
  const name = storeName();
  const yes = await uiConfirm(`매장과 계정을 삭제할까요?\n직원·근무·급여 기록이 모두 지워지고 되살릴 수 없어요.\n먼저 급여 화면의 [급여대장 받기]로 달마다 보관해 두세요.`, { ok: "계속", danger: true });
  if (!yes) return;
  const typed = await uiPrompt(`확인을 위해 매장 이름을 똑같이 입력해주세요.\n${name}`, { kind: "text", placeholder: name, ok: "다음", danger: true });
  if (typed === null) return;
  if (typed !== name) {
    uiAlert("매장 이름이 달라서 삭제하지 않았어요.");
    return;
  }
  const password = await uiPrompt("마지막으로 관리자 비밀번호를 입력해주세요.", { kind: "password", placeholder: "비밀번호", ok: "삭제", danger: true });
  if (password === null) return;
  const user = cloud?.auth.currentUser;
  if (!user) return;
  try {
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
  } catch {
    uiAlert("비밀번호가 맞지 않아서 삭제하지 않았어요.");
    return;
  }
  const code = storeId;
  // 먼저 연결을 끊는다 (지우는 동안 "저장소가 비었다"며 이 기기 기록을 다시 올리지 않게)
  watchPrivate(false);
  storeId = null;
  watchStore();
  store = initialData();
  try {
    // 규칙상 public · private 은 meta(주인 정보)가 있어야 지울 수 있어서 meta 를 마지막에
    await cloud.db.ref(`stores/${code}/public`).remove();
    await cloud.db.ref(`stores/${code}/private`).remove();
    await cloud.db.ref(`stores/${code}/meta`).remove();
  } catch (err) {
    console.warn(err);
    storeId = code; // 다시 연결
    watchStore();
    watchPrivate(true);
    uiAlert("삭제하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.");
    return;
  }
  // 이 기기에 남은 캐시도 지운다
  try {
    localStorage.removeItem(`shift-calendar:${code}`);
    if (localStorage.getItem(LAST_STORE_KEY) === code) localStorage.removeItem(LAST_STORE_KEY);
  } catch {}
  try {
    await user.delete();
  } catch (err) {
    console.warn("계정 삭제 실패", err);
    await cloud.auth.signOut();
  }
  state.notice = "매장과 계정을 삭제했어요. 그동안 써 주셔서 고마워요.";
  location.hash = "#/login";
  render();
}

// ---------- 전자 근로계약서 ----------
// 사장님이 관리자 화면에서 쓰고, 매장에서 그 기기를 직원에게 건네 화면에 서명받는다(대면 서명).
// 서명이 끝나면 PDF·카톡 사진으로 직원에게 교부한다(근로기준법 제17조). 계약서는 비공개 저장소에만 둔다.
const CONTRACT_DAYS = [1, 2, 3, 4, 5, 6, 0];
// 근로기준법 제54조: 4시간 이상이면 30분, 8시간 이상이면 1시간 휴게
const lawBreak = (min) => (min >= 480 ? 60 : min >= 240 ? 30 : 0);
const spanMin = (start, end) => {
  const m = toMin(end) - toMin(start);
  return m > 0 ? m : m + 1440;
};
// 주휴일: 근무가 없는 요일 중 일 → 토 → 월~금 순서로 첫 번째 (일요일에 일하는 알바면 쉬는 평일로)
const pickRestDay = (days) => [0, 6, 1, 2, 3, 4, 5].find((wd) => !days?.[wd]) ?? 0;
const contractsOf = (empId) => (store.contracts ?? []).filter((c) => c.empId === empId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
const latestContract = (empId) => contractsOf(empId)[0] ?? null;

function newContract(emp) {
  const biz = store.settings?.biz ?? {};
  const sal = salaryFor(emp.id, todayDateString().slice(0, 7));
  const days = {};
  for (const wd of CONTRACT_DAYS) {
    const r = emp.weekly?.[wd];
    if (r) days[wd] = { start: r.start, end: r.end, breakMin: lawBreak(spanMin(r.start, r.end)) };
  }
  const salaried = isSalaried(emp);
  return {
    id: uid(),
    empId: emp.id,
    createdAt: new Date().toISOString(),
    status: "draft",
    signedAt: null,
    empSign: null,
    ownerSign: null,
    f: {
      empName: emp.name,
      empPhone: emp.phone ? formatPhone(emp.phone) : "",
      empAddress: "",
      start: emp.hireDate ?? todayDateString(),
      end: "",
      place: storeName(),
      job: biz.job ?? "매장 업무 (음료·음식 준비, 계산, 청소 등)",
      days,
      restDay: pickRestDay(days),
      payType: salaried ? "salary" : "hourly",
      wage: emp.hourlyWage ?? DEFAULT_WAGE,
      salary: sal?.salary ?? 0,
      meal: sal?.meal ?? 0,
      payday: (store.settings?.payday ?? "10") === "last" ? 31 : Number(store.settings?.payday ?? biz.payday ?? 10),
      insurance: salaried ? { employ: true, accident: true, pension: true, health: true } : { employ: false, accident: true, pension: false, health: false },
      bizName: biz.bizName || storeName(),
      owner: biz.owner ?? "",
      bizAddress: biz.address ?? "",
      bizPhone: biz.phone ?? "",
    },
  };
}

function contractWeekMin(f) {
  return Object.values(f.days ?? {}).reduce((sum, d) => sum + Math.max(0, spanMin(d.start, d.end) - (Number(d.breakMin) || 0)), 0);
}
const hm = (min) => (min % 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min / 60}시간`);
const krDate = (d) => (d ? `${Number(d.slice(0, 4))}년 ${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일` : "");

// 계약서 종이 (A4 폭, 미리보기 · PDF 공통)
function renderContract(c) {
  const f = c.f;
  const weekMin = contractWeekMin(f);
  const shortTime = f.payType === "hourly" && weekMin < 40 * 60;
  const won_ = (n) => `${Number(n || 0).toLocaleString()}원`;
  const dayRows = CONTRACT_DAYS.map((wd) => {
    const d = f.days?.[wd];
    const work = d ? spanMin(d.start, d.end) - (Number(d.breakMin) || 0) : 0;
    return `<tr><th>${WEEKDAYS[wd]}</th><td>${d ? `${d.start} ~ ${d.end}` : "근무 없음"}</td><td>${d && d.breakMin ? `${d.breakMin}분` : d ? "없음" : "-"}</td><td>${d ? hm(work) : "-"}</td></tr>`;
  }).join("");
  const ins = f.insurance ?? {};
  const box = (on) => (on ? "■" : "□");
  const pay =
    f.payType === "salary"
      ? `월급 <b>${won_(Number(f.salary) + Number(f.meal || 0))}</b> (기본급 ${won_(f.salary)}${Number(f.meal) ? `, 식대 ${won_(f.meal)}` : ""})`
      : `시급 <b>${won_(f.wage)}</b>`;
  const sign = (img) => (img ? `<img class="ct-sign" src="${img}" alt="서명" />` : `<span class="ct-sign-empty">(서명)</span>`);
  return `
    <div class="contract-doc">
      <h1 class="ct-title">${shortTime ? "단시간근로자 " : ""}표준근로계약서</h1>
      <p class="ct-lead"><b>${esc(f.bizName)}</b>(이하 "사업주")와(과) <b>${esc(f.empName)}</b>(이하 "근로자")은(는) 다음과 같이 근로계약을 체결한다.</p>
      <ol class="ct-list">
        <li><b>근로계약기간</b> ${krDate(f.start)}부터 ${f.end ? `${krDate(f.end)}까지` : "기간의 정함 없음"}</li>
        <li><b>근무 장소</b> ${esc(f.place)}</li>
        <li><b>업무의 내용</b> ${esc(f.job)}</li>
        <li><b>근로일 및 근로일별 근로시간</b> (주 ${hm(weekMin)})
          <table class="ct-days"><thead><tr><th>요일</th><th>근로시간</th><th>휴게시간</th><th>실 근로시간</th></tr></thead><tbody>${dayRows}</tbody></table>
        </li>
        <li><b>주휴일</b> 매주 ${WEEKDAYS[f.restDay ?? 0]}요일${weekMin < 15 * 60 ? " (1주 소정근로시간 15시간 미만이면 주휴일·주휴수당은 적용되지 않음)" : ""}</li>
        <li><b>임금</b> ${pay}
          <br />주휴수당: 근로기준법에 따라 지급 · 연장·야간·휴일근로: 법령에 따라 지급
          <br />임금지급일: 매월 <b>${Number(f.payday) || 10}일</b> (휴일이면 전날 지급) · 지급방법: 근로자 명의 예금통장에 입금
        </li>
        <li><b>연차유급휴가</b> 근로기준법에서 정하는 바에 따라 부여함 (상시 근로자 5명 미만 사업장은 적용되지 않을 수 있음)</li>
        <li><b>사회보험 적용</b> ${box(ins.employ)} 고용보험 ${box(ins.accident)} 산재보험 ${box(ins.pension)} 국민연금 ${box(ins.health)} 건강보험</li>
        <li><b>근로계약서 교부</b> 사업주는 근로계약을 체결함과 동시에 본 계약서를 사본하여 근로자의 교부 요구와 관계없이 근로자에게 교부함</li>
        <li><b>기타</b> 이 계약에 정함이 없는 사항은 근로기준법령에 의함</li>
      </ol>
      <p class="ct-date">${krDate(c.signedAt ? dateStringFor(new Date(c.signedAt)) : todayDateString())}</p>
      <div class="ct-parties">
        <div>
          <p class="ct-party">사업주</p>
          <p>상호: ${esc(f.bizName)}</p>
          <p>주소: ${esc(f.bizAddress) || "-"}</p>
          <p>전화: ${esc(f.bizPhone) || "-"}</p>
          <p class="ct-name">대표자: ${esc(f.owner) || "-"} ${sign(c.ownerSign)}</p>
        </div>
        <div>
          <p class="ct-party">근로자</p>
          <p>연락처: ${esc(f.empPhone) || "-"}</p>
          <p>주소: ${esc(f.empAddress) || "-"}</p>
          <p class="ct-name">성명: ${esc(f.empName)} ${sign(c.empSign)}</p>
        </div>
      </div>
      ${c.status === "signed" ? `<p class="ct-foot">콕 전자 근로계약 · 서명 ${new Date(c.signedAt).toLocaleString("ko-KR")}</p>` : `<p class="ct-foot draft">작성 중 (서명 전)</p>`}
    </div>`;
}

function renderContractModal() {
  const c = state.contractDraft;
  if (!c || route().name === "emp") return "";
  return `
    <div class="ps-backdrop ct-backdrop${state.modalEnter ? " enter" : ""}" data-action="close-contract">
      <div class="ps-dialog" data-stop>
        <div class="ps-side ct-side">${contractForm(c)}</div>
        <div class="ps-preview ct-preview">${renderContract(c)}</div>
      </div>
    </div>`;
}

// 계약서 편집 칸 (창 · 직원 페이지 공통)
function contractForm(c) {
  const page = route().name === "emp";
  const f = c.f;
  const signed = c.status === "signed";
  const lowWage = f.payType === "hourly" && Number(f.wage) < DEFAULT_WAGE;
  const weekMin = contractWeekMin(f);
  const input = (key, label, value, extra = "") =>
    `<label class="ct-row"><span>${label}</span><input class="field" data-cf="${key}" value="${esc(value ?? "")}" ${extra} /></label>`;
  const form = signed
    ? `
      <p class="sub">서명이 끝난 계약서예요. 내용을 바꾸려면 새 계약서를 써서 다시 서명받아요.</p>
      <div class="ct-actions-col">
        <button type="button" class="btn-primary" data-action="contract-share">카카오톡 전송하기</button>
        <button type="button" class="btn-ghost" data-action="contract-pdf">PDF 받기</button>
        <button type="button" class="btn-ghost" data-action="new-contract" data-id="${c.empId}">새 계약서 쓰기 (재계약)</button>
      </div>
      <p class="sal-note">근로계약서는 근로자에게 꼭 한 부 줘야 해요. 카톡이나 PDF로 보내 주세요. 사업주는 계약이 끝난 뒤에도 3년간 보관해야 해요.</p>
      ${page ? "" : `<div class="action-row"><button type="button" class="btn-ghost" data-action="close-contract">닫기</button></div>`}`
    : `
      <p class="sub">직원 정보로 미리 채워 뒀어요. 고치면 계약서 미리보기가 바로 바뀌어요.</p>
      <div class="ct-form">
        <p class="sal-title">계약 기간 · 업무</p>
        ${input("start", "시작일", f.start, 'type="date"')}
        ${input("end", "끝나는 날 <small>비우면 기간 없음</small>", f.end, 'type="date"')}
        ${input("place", "근무 장소", f.place)}
        ${input("job", "업무 내용", f.job)}
        <p class="sal-title">근무 요일 · 시간 <small>예: 09:00~15:00, 비우면 쉬는 날</small></p>
        ${CONTRACT_DAYS.map((wd) => {
          const d = f.days?.[wd];
          return `<div class="ct-day"><span>${WEEKDAYS[wd]}</span><input class="field" data-cfday="${wd}" value="${d ? `${d.start}~${d.end}` : ""}" placeholder="쉬는 날" aria-label="${WEEKDAYS[wd]}요일 근로시간" /><input class="field ct-break" data-cfbreak="${wd}" value="${d ? d.breakMin : ""}" placeholder="휴게" inputmode="numeric" aria-label="${WEEKDAYS[wd]}요일 휴게(분)"${d ? "" : " disabled"} /><small>분</small></div>`;
        }).join("")}
        <p class="sal-note">주 실근로 ${hm(weekMin)} · 휴게는 법(4시간 이상 30분, 8시간 이상 1시간)에 맞춰 넣었어요. 콕 급여 계산은 아직 휴게시간을 빼지 않아요.</p>
        <label class="ct-row"><span>주휴일</span><select class="field" data-cf="restDay">${CONTRACT_DAYS.map((wd) => `<option value="${wd}"${Number(f.restDay) === wd ? " selected" : ""}>${WEEKDAYS[wd]}요일</option>`).join("")}</select></label>
        <p class="sal-title">임금</p>
        <label class="ct-row"><span>급여 방식</span><select class="field" data-cf="payType"><option value="hourly"${f.payType === "hourly" ? " selected" : ""}>시급</option><option value="salary"${f.payType === "salary" ? " selected" : ""}>월급</option></select></label>
        ${
          f.payType === "salary"
            ? input("salary", "기본급 (월)", Number(f.salary || 0).toLocaleString(), 'inputmode="numeric" data-money') + input("meal", "식대 (선택)", Number(f.meal || 0).toLocaleString(), 'inputmode="numeric" data-money')
            : input("wage", "시급", Number(f.wage || 0).toLocaleString(), 'inputmode="numeric" data-money')
        }
        ${lowWage ? `<p class="sal-alert">2026년 최저시급(${DEFAULT_WAGE.toLocaleString()}원)보다 낮아요. 최저임금보다 적게 정하면 그 부분은 무효예요.</p>` : ""}
        ${input("payday", "지급일 (매월)", f.payday, 'inputmode="numeric"')}
        <p class="sal-title">사회보험</p>
        <div class="ct-ins">${[["employ", "고용보험"], ["accident", "산재보험"], ["pension", "국민연금"], ["health", "건강보험"]].map(([k, l]) => `<label><input type="checkbox" data-cfins="${k}"${f.insurance?.[k] ? " checked" : ""} /> ${l}</label>`).join("")}</div>
        <p class="sal-title">사업주 <small>한 번 넣으면 다음 계약서에도 채워져요</small></p>
        ${input("owner", "대표자 성명", f.owner)}
        ${input("bizAddress", "사업장 주소", f.bizAddress)}
        ${input("bizPhone", "전화", f.bizPhone, 'inputmode="tel"')}
        <p class="sal-title">근로자</p>
        ${input("empPhone", "연락처", f.empPhone, 'inputmode="tel"')}
        ${input("empAddress", "주소 (선택)", f.empAddress)}
      </div>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
      <div class="action-row">
        ${page ? "" : `<button type="button" class="btn-ghost" data-action="close-contract">닫기</button>`}
        <button type="button" class="btn-ghost" data-action="save-contract">저장</button>
        <button type="button" class="btn-primary" data-action="sign-contract">서명 받기</button>
      </div>`;
  return `<p class="staff-title">${page ? "근로계약서" : `${esc(f.empName)} · 근로계약서`}${signed ? ` <span class="pay-tag">서명 완료</span>` : ""}</p>
          ${form}`;
}

// ---------- 직원 페이지 (#/emp/{id}): 들어가면 바로 근로계약서 ----------
function renderEmpPage(id) {
  const e = employeeById(id);
  if (!e) return renderAdminShell("employees", `<p class="sub">직원을 찾지 못했어요. <a href="#/employees">직원 목록으로</a></p>`, { center: true });
  // 이 직원 계약서: 쓰던 것(또는 서명한 것)이 있으면 그것, 없으면 직원 정보로 새로
  if (state.contractDraft?.empId !== id) {
    const last = latestContract(id);
    state.contractDraft = last ? structuredClone(last) : newContract(e);
    state.contractDirty = false;
  }
  const c = state.contractDraft;
  const history = contractsOf(id).filter((x) => x.status === "signed" && x.id !== c.id);
  const content = `
    <div class="emp-page">
      <div class="emp-page-head">
        <a class="pay-back-btn" href="#/employees" aria-label="직원 목록으로">${ICON_PREV}</a>
        <span class="swatch big" style="background:${cssColor(e.color)}"></span>
        <div><h1>${esc(e.name)}</h1><small>사번 ${e.no ?? "-"} · ${isManager(e) ? "매니저" : "알바"} · ${e.active ? "재직중" : "비활성"}${e.phone ? ` · ${esc(formatPhone(e.phone))}` : ""}</small></div>
      </div>
      <div class="emp-page-body">
        <div class="ct-side emp-ct-side">
          ${contractForm(c)}
          ${history.length ? `<p class="sal-note">이전 계약서: ${history.map((h) => `<button type="button" class="link-btn" data-action="view-contract" data-cid="${h.id}">${dot(dateStringFor(new Date(h.signedAt ?? h.createdAt)))}</button>`).join(" · ")}</p>` : ""}
        </div>
        <div class="emp-ct-preview">${renderContract(c)}</div>
      </div>
    </div>`;
  return renderAdminShell("employees", content, { center: true });
}
// 계약서 미리보기를 칸 폭에 맞춰 줄인다 (A4 폭 794px)
function fitContractPreview() {
  const box = document.querySelector(".emp-ct-preview");
  const doc = box?.querySelector(".contract-doc");
  if (doc) doc.style.zoom = Math.min(0.9, box.clientWidth / 794);
}
window.addEventListener("resize", () => route().name === "emp" && fitContractPreview());

// 편집 칸 → 초안
function updateContractDraft(t) {
  const f = state.contractDraft.f;
  if (t.dataset.cf) {
    const k = t.dataset.cf;
    let v = t.value.trim();
    if (t.hasAttribute("data-money")) v = parseMoney(v);
    if (k === "restDay" || k === "payday") v = Number(v) || 0;
    f[k] = v;
    if (k === "payday") f.payday = Math.min(31, Math.max(1, f.payday || 10));
  } else if (t.dataset.cfday) {
    const wd = t.dataset.cfday;
    const r = parseRange(t.value);
    f.days = { ...f.days };
    if (!t.value.trim()) delete f.days[wd];
    else if (r) f.days[wd] = { start: r.start, end: r.end, breakMin: f.days[wd]?.breakMin ?? lawBreak(spanMin(r.start, r.end)) };
    else state.error = `${WEEKDAYS[wd]}요일 시간은 09:00~15:00 처럼 써 주세요.`;
    // 주휴일로 정해 둔 요일에 근무를 넣으면 쉬는 다른 요일로 옮긴다
    if (f.days[f.restDay ?? 0]) f.restDay = pickRestDay(f.days);
  } else if (t.dataset.cfbreak) {
    const d = f.days?.[t.dataset.cfbreak];
    if (d) d.breakMin = Math.max(0, Math.min(240, Number(t.value.replace(/\D/g, "")) || 0));
  } else if (t.dataset.cfins) {
    f.insurance = { ...f.insurance, [t.dataset.cfins]: t.checked };
  }
}

function saveContractDraft(c) {
  const list = (store.contracts ?? []).filter((x) => x.id !== c.id);
  store.contracts = [...list, structuredClone(c)];
  // 사업주 정보는 다음 계약서에 그대로 쓰게 기억
  store.settings = { ...store.settings, biz: { ...(store.settings?.biz ?? {}), bizName: c.f.bizName, owner: c.f.owner, address: c.f.bizAddress, phone: c.f.bizPhone, job: c.f.job, payday: c.f.payday } };
  save();
}

function contractProblem(f) {
  if (!f.start) return "계약 시작일을 넣어주세요.";
  if (!f.owner) return "대표자 성명을 넣어주세요.";
  if (f.payType === "hourly" && !Number(f.wage)) return "시급을 넣어주세요.";
  if (f.payType === "salary" && !Number(f.salary)) return "기본급을 넣어주세요.";
  if (f.payType === "hourly" && !Object.keys(f.days ?? {}).length) return "근무 요일과 시간을 넣어주세요.";
  if (f.end && f.end < f.start) return "끝나는 날이 시작일보다 빨라요.";
  return "";
}

// 손가락·마우스로 서명받는 창. 확인하면 PNG data URL, 취소하면 null
function signPad({ title, message, check, saved }) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "sign-back";
    back.innerHTML = `
      <div class="sign-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <p class="sign-title">${esc(title)}</p>
        <p class="sign-msg">${esc(message)}</p>
        ${check ? `<label class="agree sign-check"><input type="checkbox" class="sign-agree" /> <span>${esc(check)}</span></label>` : ""}
        <div class="sign-pad"><canvas aria-label="서명 칸"></canvas><span class="sign-hint">여기에 서명해주세요</span></div>
        <div class="sign-actions">
          ${saved ? `<button type="button" class="btn-ghost" data-sign="saved">저장된 서명 쓰기</button>` : ""}
          <button type="button" class="btn-ghost" data-sign="clear">다시 쓰기</button>
          <button type="button" class="btn-ghost" data-sign="cancel">취소</button>
          <button type="button" class="btn-primary" data-sign="ok">확인</button>
        </div>
        <p class="sign-err" hidden></p>
      </div>`;
    document.body.appendChild(back);
    const canvas = back.querySelector("canvas");
    const pad = back.querySelector(".sign-pad");
    const ratio = window.devicePixelRatio || 1;
    const w = pad.clientWidth;
    const h = Math.round(w * 0.38);
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
    let drawing = false;
    let strokes = 0;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    canvas.addEventListener("pointerdown", (e) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      ctx.beginPath();
      ctx.moveTo(...pos(e));
      pad.classList.add("on");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      ctx.lineTo(...pos(e));
      ctx.stroke();
      strokes += 1;
    });
    const stop = () => (drawing = false);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    const err = back.querySelector(".sign-err");
    const close = (v) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener("click", (e) => {
      const k = e.target.closest("[data-sign]")?.dataset.sign;
      if (k === "cancel") close(null);
      if (k === "clear") {
        ctx.clearRect(0, 0, w, h);
        strokes = 0;
        pad.classList.remove("on");
      }
      if (k === "saved") close(saved);
      if (k === "ok") {
        if (check && !back.querySelector(".sign-agree").checked) {
          err.textContent = "내용을 확인했다는 칸에 체크해주세요.";
          err.hidden = false;
          return;
        }
        if (strokes < 5) {
          err.textContent = "서명 칸에 서명해주세요.";
          err.hidden = false;
          return;
        }
        close(canvas.toDataURL("image/png"));
      }
    });
  });
}

async function signContract() {
  const c = state.contractDraft;
  const problem = contractProblem(c.f);
  if (problem) {
    state.error = problem;
    render();
    return;
  }
  state.error = "";
  saveContractDraft(c);
  const empSign = await signPad({
    title: `근로자 서명 · ${c.f.empName}`,
    message: "계약서 내용을 직원이 직접 읽어 보게 하고, 직원이 서명해요.",
    check: "근로계약서 내용을 확인했고, 계약서 사본을 받는 것에 동의해요.",
  });
  if (!empSign) return;
  const ownerSign = await signPad({
    title: `사업주 서명 · ${c.f.owner}`,
    message: "사장님이 서명해요. 이 서명은 다음 계약서에도 쓸 수 있게 기억해요.",
    saved: store.settings?.ownerSign ?? null,
  });
  if (!ownerSign) return;
  Object.assign(c, { empSign, ownerSign, status: "signed", signedAt: new Date().toISOString() });
  store.settings = { ...store.settings, ownerSign };
  saveContractDraft(c);
  state.contractDraft = structuredClone(c);
  render();
  showToast(`${c.f.empName}님 근로계약서 서명이 끝났어요. 카톡이나 PDF로 꼭 한 부 보내 주세요`, "ok");
}

// 계약서 그림 (길면 A4 여러 장으로 나눈다)
async function contractCanvas(c) {
  const html2canvas = await loadLib("html2canvas");
  await document.fonts.ready;
  const stage = document.createElement("div");
  stage.className = "ps-stage";
  stage.innerHTML = renderContract(c);
  document.body.appendChild(stage);
  try {
    return await html2canvas(stage.firstElementChild, { scale: 2, backgroundColor: "#ffffff" });
  } finally {
    stage.remove();
  }
}

function contractPdf(button) {
  const c = state.contractDraft;
  return withBusy(button, "PDF 만드는 중…", async () => {
    const jsPDF = await loadLib("jspdf");
    const canvas = await contractCanvas(c);
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageH = Math.round((canvas.width * 297) / 210); // A4 한 장 높이(픽셀)
    for (let y = 0, i = 0; y < canvas.height; y += pageH, i++) {
      const part = document.createElement("canvas");
      part.width = canvas.width;
      part.height = Math.min(pageH, canvas.height - y);
      const pctx = part.getContext("2d");
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, part.width, part.height);
      pctx.drawImage(canvas, 0, -y);
      if (i > 0) pdf.addPage();
      pdf.addImage(part.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, (part.height * 210) / canvas.width);
    }
    pdf.save(`${c.f.empName} 근로계약서 ${c.f.start}.pdf`);
  });
}

function contractShare(button) {
  const c = state.contractDraft;
  return withBusy(button, "사진 만드는 중…", async () => {
    const canvas = await contractCanvas(c);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("사진을 만들지 못했어요. 다시 시도해주세요.");
    openSharePreview(new File([blob], `${c.f.empName} 근로계약서.png`, { type: "image/png" }));
  });
}

// ---------- PDF (급여명세서) ----------

async function payslipPdf(button, empIds) {
  return withBusy(button, "PDF 만드는 중…", async () => {
    const [html2canvas, jsPDF] = await Promise.all([loadLib("html2canvas"), loadLib("jspdf")]);
    await document.fonts.ready;
    const { month } = state.payroll;
    const recs = monthRecords(month);

    // A4 비율 종이를 화면 밖에 그려서 한 장씩 이미지로 찍는다
    const stage = document.createElement("div");
    stage.className = "ps-stage";
    document.body.appendChild(stage);
    try {
      // 한 명당 PDF 한 파일
      for (const [i, id] of empIds.entries()) {
        const emp = employeeById(id);
        stage.innerHTML = renderPayslip(payrollRow(emp, month, recs), month);
        const canvas = await html2canvas(stage.firstElementChild, { scale: 2, backgroundColor: "#ffffff" });
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
        // 연달아 내려받으면 브라우저가 막을 수 있어 조금씩 띄운다
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 400));
        pdf.save(`${emp.name} ${Number(month.slice(5, 7))}월 급여명세서.pdf`);
      }
    } finally {
      stage.remove();
    }
  });
}

// ---------- 근무 상세 사진 (카톡으로 보내기) ----------
// 직원 한 명의 한 달 근무를 달력 모양 사진으로 만들어 휴대폰은 공유창(카톡), PC는 복사(카톡에 붙여넣기)로 보낸다.

function renderTsCard(emp, ym) {
  const [y, m] = ym.split("-").map(Number);
  const { days, rows } = timesheet(ym, emp.id, { includeAll: true });
  const row = rows[0];
  const recs = monthRecords(ym, emp.id);
  const today = todayDateString();
  const lead = weekdayOf(days[0]);
  const cells = days.map((d, j) => {
    const saved = row?.cells[j] || 0;
    const dayRecs = recs.filter((rec) => rec.date === d && rec.clockIn && rec.clockOut);
    const range = dayRecs.map((rec) => `${formatTime(rec.clockIn)}~${formatTime(rec.clockOut)}`).join("<br />");
    const wd = weekdayOf(d);
    const dn = `<span class="tsc-dn${wd === 0 || HOLIDAYS[d] ? " sun" : ""}">${Number(d.slice(8))}</span>`;
    if (d > today) return `<div class="tsc-cell future">${dn}</div>`;
    if (!saved && d < today && emp.active && plannedOn(emp, d) > 0) {
      return `<div class="tsc-cell">${dn}<b class="under">0</b><small class="under">미출근</small></div>`;
    }
    if (!saved) return `<div class="tsc-cell">${dn}</div>`;
    return `<div class="tsc-cell">${dn}<b class="${diffClass(emp, d, saved).trim()}">${hour1(saved)}</b><small>${range}</small></div>`;
  });
  const workDays = row ? row.cells.filter((c) => c > 0).length : 0;
  return `
    <div class="tsc">
      <p class="tsc-store">${esc(storeName())}</p>
      <h1>${esc(emp.name)} · ${y}년 ${m}월 근무</h1>
      <p class="tsc-sum">근무 <b>${workDays}일</b> · 총 <b>${row ? row.total.toFixed(1) : "0.0"}시간</b></p>
      <div class="tsc-grid">
        ${WEEKDAYS.map((w, i) => `<div class="tsc-wd${i === 0 ? " sun" : ""}">${w}</div>`).join("")}
        ${'<div class="tsc-cell blank"></div>'.repeat(lead)}
        ${cells.join("")}
      </div>
      <p class="tsc-legend"><i class="tsc-dot over"></i>근무시간보다 많이 · <i class="tsc-dot under"></i>근무시간보다 적게 · 숫자는 근무 시간</p>
    </div>`;
}

async function shareTimesheetImage(button, empId) {
  return withBusy(button, "사진 만드는 중…", async () => {
    const html2canvas = await loadLib("html2canvas");
    await document.fonts.ready;
    const emp = employeeById(empId);
    const { month } = state.payroll;
    const stage = document.createElement("div");
    stage.className = "ps-stage";
    stage.innerHTML = renderTsCard(emp, month);
    document.body.appendChild(stage);
    let blob;
    try {
      const canvas = await html2canvas(stage.firstElementChild, { scale: 2, backgroundColor: "#ffffff" });
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      stage.remove();
    }
    if (!blob) throw new Error("사진을 만들지 못했어요. 다시 시도해주세요.");
    openSharePreview(new File([blob], `${emp.name} ${Number(month.slice(5, 7))}월 근무.png`, { type: "image/png" }), () => {
      // PC: 복사하면 아직 안 보낸 다음 직원으로 넘긴다 (끝까지 가면 앞에서 안 보낸 사람으로, 다 보내면 전체로)
      if (state.payroll.employeeId !== empId) return "복사했어요. 카톡 채팅방에 붙여넣기 하세요";
      if (state.sent?.month !== month) state.sent = { month, ids: new Set() };
      state.sent.ids.add(empId);
      const list = store.employees.filter((e) => !isManager(e));
      const at = list.findIndex((e) => e.id === empId);
      const next = [...list.slice(at + 1), ...list.slice(0, at)].find((e) => !state.sent.ids.has(e.id));
      state.payroll.employeeId = next?.id ?? "";
      if (!next) state.sent = null;
      state.nextFlashAt = Date.now();
      render();
      return next ? `복사했어요. 다음 직원 ${next.name}(으)로 넘어갔어요` : "모두 보냈어요. 전체로 돌아갔어요";
    });
  });
}

// 미리보기 창: 사진을 확인하고 보내기 (공유·복사는 버튼을 누른 순간에 해야 브라우저가 허락한다)
// onCopied: 복사한 뒤 할 일 (돌려준 글자를 알림으로 띄운다)
function openSharePreview(file, onCopied) {
  const url = URL.createObjectURL(file);
  const canShare = !isDesktop() && navigator.canShare?.({ files: [file] });
  const canCopy = isDesktop() && window.ClipboardItem && navigator.clipboard?.write;
  const back = document.createElement("div");
  back.className = "share-back";
  back.innerHTML = `
    <div class="share-box" role="dialog" aria-label="근무 사진 보내기">
      <img src="${url}" alt="근무 상세 사진" />
      <div class="share-actions">
        <button type="button" class="btn-ghost" data-share="close">닫기</button>
        <button type="button" class="btn-ghost" data-share="save">사진 저장</button>
        ${canShare ? `<button type="button" class="btn-primary" data-share="send">카카오톡 전송하기</button>` : ""}
        ${canCopy ? `<button type="button" class="btn-primary" data-share="copy">복사하기</button>` : ""}
      </div>
      ${canCopy ? `<p class="share-tip">복사한 뒤 카카오톡 채팅방에서 ${/Mac/.test(navigator.platform) ? "⌘V" : "Ctrl+V"} 로 붙여넣으면 사진으로 보내져요.</p>` : ""}
    </div>`;
  const close = () => {
    back.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", async (e) => {
    if (e.target === back) return close();
    const kind = e.target.closest("[data-share]")?.dataset.share;
    if (kind === "close") close();
    if (kind === "save") {
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
    }
    if (kind === "send") {
      try {
        await navigator.share({ files: [file] });
        close();
      } catch (err) {
        if (err.name !== "AbortError") uiAlert("공유를 열지 못했어요. 사진 저장 후 카톡에서 보내주세요.");
      }
    }
    if (kind === "copy") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
        close();
        showToast(onCopied?.() || "복사했어요. 카톡 채팅방에 붙여넣기 하세요");
      } catch {
        uiAlert("복사하지 못했어요. 사진 저장 후 카톡에 끌어다 놓아주세요.");
      }
    }
  });
  document.body.appendChild(back);
}

// ---------- 주간 근무표 (게시용) ----------
// 직원별 요일 근무 시간으로 자동 생성. 요일마다 시작 시간 순으로 비어 있는 칸에 배치한다.

const SCHEDULE_DAYS = [1, 2, 3, 4, 5, 6, 0]; // 월 ~ 일
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

// 배경색이 어두우면 글자를 흰색으로
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? "#ffffff" : "#111111";
}

// 근무표 편집은 초안(state.schedWork)에 모아 두었다가 [저장]할 때 한꺼번에 반영한다.
// 초안 = { weekly: { 직원id: { 요일: {start,end} | null } }, meta: {period, notes} | null }
// [임시저장]은 초안만 보관(store.scheduleDraft)하고 직원 관리·달력·근무 기록에는 아직 반영하지 않는다.
function schedWork() {
  if (!state.schedWork) state.schedWork = structuredClone(store.scheduleDraft ?? { weekly: {}, meta: null });
  return state.schedWork;
}

function effWeekly(emp) {
  const w = { ...emp.weekly };
  for (const [wd, range] of Object.entries(schedWork().weekly[emp.id] ?? {})) {
    if (range) w[wd] = range;
    else delete w[wd];
  }
  return w;
}

const schedMeta = () => schedWork().meta ?? store.scheduleMeta ?? {};
const schedDirty = () => JSON.stringify(schedWork()) !== JSON.stringify(store.scheduleDraft ?? { weekly: {}, meta: null });
const hasDraft = () => Object.keys(schedWork().weekly).length > 0 || schedWork().meta !== null;

function draftWeekly(emp, wd, range) {
  const w = schedWork().weekly;
  w[emp.id] = { ...w[emp.id], [wd]: range };
}

function tempSaveSchedule() {
  store.scheduleDraft = structuredClone(schedWork());
  save();
}

function commitSchedule() {
  const work = schedWork();
  if (work.meta) store.scheduleMeta = work.meta; // 기간이 바뀌면 적용 시작일도 바뀌므로 먼저
  pinPeriodYear();
  for (const [empId, days] of Object.entries(work.weekly)) {
    const emp = employeeById(empId);
    if (!emp) continue;
    for (const [wd, range] of Object.entries(days)) setWeekly(emp, wd, range);
  }
  delete store.scheduleDraft;
  state.schedWork = { weekly: {}, meta: null };
  save();
}

// 근무표: 가로 타임라인 — 요일이 줄, 시간이 가로. 겹치는 근무는 그 요일 아래에 한 줄씩 더 쌓는다

// 요일 하나의 근무를 줄(lane)에 나눠 담는다: 시작 순으로, 앞 근무가 끝난 줄에 이어 붙인다
function placeShifts(list) {
  const items = list.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const ends = [];
  for (const it of items) {
    let lane = ends.findIndex((end) => end <= it.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = it.end;
    it.lane = lane;
  }
  return { items, lanes: Math.max(1, ends.length) };
}

function renderScheduleSheet({ wide = false, share = false } = {}) {
  const meta = schedMeta();
  const compact = !wide && !isDesktop();
  const ed = state.slotEdit;
  const people = store.employees.filter((e) => e.active);
  const days = SCHEDULE_DAYS.map((wd) => {
    const list = people
      .map((e) => ({ e, r: effWeekly(e)[wd] }))
      .filter(({ r }) => r)
      .map(({ e, r }) => {
        const start = toMin(r.start);
        let end = toMin(r.end);
        if (end <= start) end += 24 * 60; // 자정을 넘기는 근무
        return { e, r, start, end };
      });
    return { wd, ...placeShifts(list) };
  });
  const all = days.flatMap((d) => d.items);
  const first = all.length ? Math.floor(Math.min(...all.map((it) => it.start)) / 60) : 9;
  const last = all.length ? Math.ceil(Math.max(...all.map((it) => it.end)) / 60) : 18;
  // 주간 표: 요일은 왼쪽 → 오른쪽, 시간은 위 → 아래 (같은 시간에 여럿이면 칸 안에서 나란히)
  const H = compact ? 30 : share ? 40 : 46; // 1시간 높이(px)
  const top = (min) => `${((min - first * 60) / 60) * H}px`;
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  // 컴퓨터: 근무 입력칸은 표 바로 아래에 (휴대폰은 아래에서 올라오는 창)
  const inlineEdit = Boolean(ed) && !wide && isDesktop();
  const axis = [...hours, last].map((h) => `<span style="top:${top(h * 60)}">${h % 24}${compact ? "" : "시"}</span>`).join("");
  const lines = hours.slice(1).map((h) => `<i style="top:${top(h * 60)}"></i>`).join("");
  const cols = days
    .map(({ wd, items, lanes }) => {
      // 빈 곳을 누르면 그 시각으로 추가
      const slots = hours
        .map((hh) => `<div class="wk-slot" data-action="edit-slot" data-wd="${wd}" data-start="${(hh % 24) * 60}" style="top:${top(hh * 60)};height:${H}px" aria-label="${WEEKDAYS[wd]}요일 ${hh % 24}시 근무자 추가"></div>`)
        .join("");
      const bars = items
        .map((it) => {
          const bg = cssColor(it.e.color);
          const editing = ed && String(ed.wd) === String(wd) && (ed.empId ?? ed.addEmpId) === it.e.id;
          const h = ((it.end - it.start) / 60) * H;
          const w = 100 / lanes;
          return `
            <div class="wk-bar${editing ? " sc-editing" : ""}${h < 42 ? " short" : ""}" role="button" tabindex="0" data-action="edit-slot" data-wd="${wd}" data-id="${it.e.id}" data-start="${it.start}"
              style="top:calc(${top(it.start)} + 2px);height:${h - 4}px;left:calc(${(w * it.lane).toFixed(3)}% + 2px);width:calc(${w.toFixed(3)}% - 4px);--c:${bg};color:${textOn(bg)}" title="${esc(it.e.name)} ${it.r.start}~${it.r.end}">
              <b>${esc(it.e.name)}</b>${h < 42 || (compact && lanes > 1) ? "" : `<small>${compact || lanes > 1 ? `${it.r.start}<br />${it.r.end}` : `${it.r.start} ~ ${it.r.end}`}</small>`}
            </div>`;
        })
        .join("");
      return `<div class="wk-col${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}${ed && String(ed.wd) === String(wd) ? " editing" : ""}"><div class="wk-lines">${lines}</div>${slots}${bars}</div>`;
    })
    .join("");
  const grid = `
      <div class="wk${compact ? " compact" : ""}${share ? " share" : ""}" style="--wk-h:${(last - first) * H}px">
        <div class="wk-head"><div></div>${days.map(({ wd }) => `<div class="wk-day${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}">${WEEKDAYS[wd]}</div>`).join("")}</div>
        <div class="wk-body"><div class="wk-axis">${axis}</div>${cols}</div>
      </div>
      ${inlineEdit ? `<div class="tl-edit wk-edit" id="tl-edit" data-html2canvas-ignore>${renderSlotPanel()}</div>` : ""}`;
  const actions = `
        <div class="sc-actions" data-html2canvas-ignore>
          <button type="button" class="pill plain-dark" data-action="schedule-temp"${schedDirty() ? "" : " disabled"}>임시저장</button>
          <button type="button" class="pill" data-action="schedule-save"${hasDraft() ? "" : " disabled"}>저장</button>
          <button type="button" class="pill plain-dark" data-action="schedule-share">카카오톡 전송하기</button>
        </div>`;

  return `
    <div class="sched-sheet" id="sched-sheet">
      <div class="sc-print-head">
        <span class="ps-brand">${esc(storeName())} 근무표${meta.period ? `<span class="sc-print-period">${esc(normalizePeriod(meta.period.trim()))}</span>` : ""}</span>
      </div>
      <div class="sc-head">
        <h2 class="sc-title">[${esc(storeName())} 근무표]( <input class="sc-period" value="${esc(normalizePeriod(meta.period ?? ""))}" size="${Math.max(6, [...(normalizePeriod(meta.period ?? "") || "2026.06.04 ~")].length)}" data-meta="period" inputmode="numeric" placeholder="2026.06.04 ~" aria-label="기간" /> )</h2>
        ${compact ? "" : actions}
      </div>
      ${compact ? `<div class="sc-help" data-html2canvas-ignore>${schedHelp()}</div>` : ""}
      ${grid}
      ${compact ? actions : ""}
      <p class="sc-brand">${esc(storeName())} · ${todayDateString().replaceAll("-", ".")} 출력 · 콕</p>
    </div>`;
}

function schedHelp() {
  return helpToggle(
    "schedule",
    `근무 블록을 누르면 수정·삭제, 빈 칸을 누르면 그 시각에 근무자를 추가해요. ${isDesktop() ? "표 아래에서" : "아래에서"} 입력하면 표에 바로 보여요.<br />
    <b>저장</b>하면 직원 관리·달력·근무 기록에 반영되고, <b>임시저장</b>은 반영하지 않고 고친 내용만 보관해요.<br />
    지난 근무 기록은 제목 기간의 시작일(<b>${shortDate(scheduleStart())}</b>)부터 바뀌어요. 제목의 기간도 눌러서 고칠 수 있어요.`,
  );
}

// 근무표 칸을 누르면 편집 패널("월요일 · 근무자 추가")이 화면 위쪽에 보이게 옮기고 입력칸에 커서
// (패널이 표 아래에 있는 좁은 화면에서 눌러도 안 보이는 일이 없게)
function revealSlotPanel() {
  if (!isDesktop()) {
    document.getElementById(state.slotEdit?.empId || state.slotEdit?.fixedEmp ? "slot-start" : "slot-emp")?.focus({ preventScroll: true });
    return;
  }
  const panel = document.getElementById("tl-edit");
  if (!panel) return;
  const { top, bottom } = panel.getBoundingClientRect();
  if (top < 0 || bottom > window.innerHeight) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  document.getElementById(state.slotEdit?.empId || state.slotEdit?.fixedEmp ? "slot-start" : "slot-emp")?.focus({ preventScroll: true });
}

function renderSchedStatus() {
  if (!hasDraft()) return "";
  return schedDirty()
    ? `<p class="sched-status warn">저장하지 않은 변경이 있어요. <b>저장</b>을 눌러야 직원 관리·달력·근무 기록에 반영돼요.</p>`
    : `<p class="sched-status">임시저장된 변경이 있어요. <b>저장</b>을 누르면 반영돼요.</p>`;
}

function renderSchedule() {
  if (!isDesktop()) return renderScheduleMobile();
  return renderAdminShell(
    "schedule",
    `
    <div class="sched-main">
      <div id="sched-status">${renderSchedStatus()}</div>
      <div class="sched-scroll" id="sched-scroll">${renderScheduleSheet()}</div>
      ${schedHelp()}
    </div>`,
    { center: true, wide: true },
  );
}

function renderSlotPanel() {
  const ed = state.slotEdit;
  if (!ed) {
    return `
      <p class="staff-title">근무 수정</p>
      <p class="sub">근무표에서 근무 막대나 빈 곳을 누르면 여기서 시간을 입력할 수 있어요.</p>`;
  }
  const empId = ed.empId ?? ed.addEmpId;
  const emp = empId ? employeeById(empId) : null;
  // 새로 넣는 칸은 그 직원의 다른 요일 시간을 먼저 채워 둔다
  const shift = emp ? effWeekly(emp)[ed.wd] ?? Object.values(effWeekly(emp))[0] : null;
  const start = shift?.start ?? fromMin(ed.start).padStart(5, "0");
  const end = shift?.end ?? fromMin(Math.min(ed.start + 6 * 60, 23 * 60)).padStart(5, "0");
  // 추가할 때 고를 수 있는 사람: 이 칸을 열 때 그 요일 근무가 없던 사람
  const before = (e) => ({ ...e.weekly, ...(ed.snapshot[e.id] ?? {}) })[ed.wd];
  const choices = store.employees.filter((e) => e.active && (!before(e) || e.id === ed.addEmpId));
  return `
    <form class="slot-form" id="slot-form">
      <p class="staff-title">${WEEKDAYS[ed.wd]}요일 · ${ed.empId ? esc(emp.name) : ed.fixedEmp ? `${esc(emp.name)} 근무 추가` : "근무자 추가"}</p>
      ${
        ed.empId
          ? ""
          : ed.fixedEmp
          ? `<input type="hidden" id="slot-emp" value="${ed.addEmpId}" />`
          : `<select id="slot-emp" class="field" aria-label="직원">
              <option value="">직원 선택</option>
              ${choices.map((e) => `<option value="${e.id}"${e.id === ed.addEmpId ? " selected" : ""}>${esc(e.name)}${isManager(e) ? " (매니저)" : ""}</option>`).join("")}
            </select>`
      }
      <div class="edit-row">
        ${timeInput("slot-start", start, "시작 시간")}
        <span>~</span>
        ${timeInput("slot-end", end, "종료 시간")}
      </div>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
      <div class="action-row">
        <button type="button" class="btn-ghost" data-action="cancel-slot">취소</button>
        <button type="submit" class="btn-primary">완료</button>
      </div>
      ${ed.empId ? `<button type="button" class="btn-ghost danger-ghost slot-remove" data-action="remove-slot">근무 삭제</button>` : ""}
    </form>`;
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 추가할 사람을 바꾸면 앞서 고른 사람의 초안은 칸을 열기 전으로 되돌린다
function restoreSnapshot(empId) {
  const w = schedWork().weekly;
  const snap = state.slotEdit.snapshot;
  if (hasOwn(snap, empId)) w[empId] = structuredClone(snap[empId]);
  else delete w[empId];
}

// 입력하는 대로 초안에 넣고 근무표만 다시 그린다 (입력칸 포커스 유지)
function liveSlot({ final = false } = {}) {
  const ed = state.slotEdit;
  if (!ed) return true;
  const empId = ed.empId ?? (document.getElementById("slot-emp")?.value || null);
  if (!ed.empId && empId !== ed.addEmpId) {
    if (ed.addEmpId) restoreSnapshot(ed.addEmpId);
    ed.addEmpId = empId;
    refreshSchedule();
  }
  if (!empId) return false;
  const read = (id) => {
    const el = document.getElementById(id);
    const digits = el.value.replace(/\D/g, "");
    if (!digits) return el.placeholder;
    if (!final && digits.length < 4) return null; // 입력 중간(예: "15")에는 기다린다
    return normalizeTime(el.value);
  };
  const start = read("slot-start");
  const end = read("slot-end");
  if (!start || !end || start === end) return false;
  draftWeekly(employeeById(empId), ed.wd, { start, end });
  refreshSchedule();
  return true;
}

function refreshSchedule() {
  const scroll = document.getElementById("sched-scroll");
  if (scroll) {
    // 요일 아래 입력칸은 그대로 옮겨 붙인다 (다시 그리면 입력 중인 글자·커서가 사라지므로)
    const form = document.getElementById("tl-edit");
    const focused = form?.contains(document.activeElement) ? document.activeElement : null;
    const caret = focused && "selectionStart" in focused ? [focused.selectionStart, focused.selectionEnd] : null;
    scroll.innerHTML = renderScheduleSheet();
    const slot = document.getElementById("tl-edit");
    if (form && slot) {
      slot.replaceWith(form);
      focused?.focus({ preventScroll: true });
      if (caret) focused.setSelectionRange(...caret);
    }
  }
  const dayList = document.getElementById("sched-day-list");
  if (dayList) dayList.innerHTML = renderDayShifts();
  const status = document.getElementById("sched-status");
  if (status) status.innerHTML = renderSchedStatus();
}

function finishSlot() {
  if (!liveSlot({ final: true })) {
    const ed = state.slotEdit;
    state.error = ed.empId || ed.addEmpId ? "시간은 09:00 처럼 숫자로 입력해주세요." : "직원을 선택해주세요.";
    render();
    return;
  }
  state.slotEdit = null;
  state.error = "";
  render();
}

async function scheduleShare(button) {
  return withBusy(button, "사진 만드는 중…", async () => {
    const html2canvas = await loadLib("html2canvas");
    await document.fonts.ready;
    // 화면 크기와 상관없이 화면 밖에 카톡에서 보기 좋은 너비(720px)로 그려서 찍는다
    // (컴퓨터 화면 그대로 찍으면 너무 가로로 길고, 휴대폰 화면 표는 이름이 없어서)
    const stage = document.createElement("div");
    stage.className = "sc-wide-stage";
    stage.innerHTML = renderScheduleSheet({ wide: true, share: true }).replace('id="sched-sheet"', "");
    document.body.appendChild(stage);
    const sheet = stage.firstElementChild;
    const fold = sheet.closest("details");
    const wasOpen = fold?.open;
    if (fold) fold.open = true;
    sheet.classList.add("capturing");
    // 기간 입력칸은 글자로 바꿔서 찍는다 (입력칸 여백이 생기지 않게)
    const period = sheet.querySelector(".sc-period");
    const periodText = document.createElement("span");
    periodText.textContent = period.value;
    period.replaceWith(periodText);
    let blob;
    try {
      const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff" });
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      periodText.replaceWith(period);
      sheet.classList.remove("capturing");
      if (fold) fold.open = wasOpen;
      stage?.remove();
    }
    if (!blob) throw new Error("사진을 만들지 못했어요. 다시 시도해주세요.");
    openSharePreview(new File([blob], `근무표_${(store.scheduleMeta?.period || todayDateString()).replace(/[\s.~]+/g, "_")}.png`, { type: "image/png" }));
  });
}

// ---------- 사용법 튜토리얼 (관리자 화면의 ?) ----------
// 지금 화면 위를 어둡게 덮고, 설명할 버튼·칸만 밝게 뚫어 옆에 말풍선으로 설명한다. [다음]으로 하나씩.
// sel 은 여러 개를 줄 수 있고, 화면에 보이는 첫 번째를 가리킨다. 지금 화면에 없는 단계는 건너뛴다.
const TOURS = {
  me: () => [
    { sel: ".me-card:nth-of-type(2)", title: "사업주 정보", text: "상호, 대표자, 주소, 연락처를 한 번 넣어 두면 <b>근로계약서</b>에 자동으로 들어가요. 바꾸면 바로 저장돼요." },
    { sel: ".me-card:nth-of-type(3) .me-link", title: "직원 링크", text: "이 주소를 <b>단톡방</b>에 한 번 올려 두세요. 직원이 눌러서 자기 PIN으로 자기 근무 상세와 명세서만 봐요." },
    { sel: ".me-pins", title: "직원별 PIN", text: "직원마다 <b>PIN 6자리가 자동으로</b> 만들어져요. 개인 톡으로 알려 주세요. 근무 상세는 <b>다음 달 1일</b>, 명세서는 <b>급여 지급일</b>(급여 화면에서 정해요)이 지나면 자동으로 올라가요. 잃어버렸으면 <b>새 PIN</b>으로 바꿔요." },
    { sel: ".me-card:nth-of-type(4) .me-link", title: "이력서 양식", text: "지원자에게 이 주소를 보내면 휴대폰으로 써서 A4 이력서 사진을 문자로 보내 줘요. 종이 양식은 열어서 ••• → 빈 양식 인쇄." },
    { sel: ".me-card:nth-of-type(5) .store-manage-actions", title: "매장 삭제", text: "매장과 계정을 지워요. 직원·근무·급여 기록이 모두 지워지고 되살릴 수 없어서, 지우기 전에 급여 화면에서 급여대장을 받아 두세요." },
  ],
  employees: (pc) =>
    pc
      ? [
          { sel: "#add-employee .seg", title: "알바 / 매니저", text: "새 직원이 알바인지 매니저인지 골라요. 매니저를 고르면 시급 대신 기본급(월급)과 식대를 넣어요." },
          { sel: "#add-employee", title: "직원 추가", text: "이름과 시급(매니저는 월급)을 넣고 <b>추가</b>를 눌러요. 전화번호는 넣지 않아도 돼요." },
          { sel: ".staff-link", title: "직원용 달력 주소", text: "직원들이 출근을 찍는 달력 주소예요. <b>주소 복사</b>로 단톡방에 보내 주세요." },
          { sel: "table.schedule tbody tr:first-child .day-cell", title: "요일별 근무 시간", text: "칸에 <b>7-12</b>, <b>18-2230</b>처럼 입력하면 그 요일 고정 근무 시간이 저장돼요. 비우면 쉬는 날이에요." },
          { sel: "table.schedule tbody tr:first-child .wage-cell", title: "시급 · 월급", text: "알바는 시급을 고쳐요. <b>월급으로</b>를 누르면 월급제(4대보험) 직원이 되고, 월급은 급여 화면 명세서에서 입력해요." },
          { sel: "table.schedule tbody tr:first-child [data-action=toggle-active]", title: "재직중 · 비활성", text: "그만둔 직원은 <b>비활성</b>으로 바꿔요. 기록은 남고, 달력과 근무표에서만 빠져요." },
          { sel: "table.schedule tbody tr:first-child [data-action=toggle-role]", title: "알바 · 매니저", text: "매니저로 바꾸면 목록 맨 위로 오고 월급제가 돼요. 다시 알바로 바꾸면 시급제로 돌아가요." },
          { sel: "table.schedule tbody tr:first-child .name-btn", title: "직원 페이지 · 근로계약서", text: "이름을 누르면 그 직원 페이지로 가서 바로 <b>전자 근로계약서</b>를 써요. 직원 정보로 미리 채워지고, 매장에서 화면에 서명받아요." },
          { scene: "contract", sel: ".ct-side", title: "계약서 쓰기", text: "기간, 근무 요일·시간, 임금, 사회보험, 사업주 정보를 확인하고 <b>서명 받기</b>를 눌러요. 직원이 먼저, 사장님이 다음에 손가락으로 서명해요." },
          { scene: "contract", sel: ".ct-preview", title: "계약서 미리보기", text: "고용노동부 표준근로계약서 항목대로 만들어져요. 서명이 끝나면 <b>카카오톡 전송</b>이나 <b>PDF</b>로 직원에게 꼭 한 부 줘요." },
        ]
      : [
          { sel: ".m-add", title: "직원 추가", text: "여기를 누르면 직원 추가 창이 열려요." },
          { scene: "addSheet", sel: ".sheet", title: "직원 추가 창", text: "알바 / 매니저를 고르고 이름을 넣어요. 알바는 시급, 매니저는 기본급(월급)과 식대(선택)를 넣고 <b>추가</b>를 눌러요." },
          { sel: ".staff-link", title: "직원용 달력 주소", text: "직원들이 출근을 찍는 달력 주소예요. <b>주소 복사</b>로 단톡방에 보내 주세요." },
          { sel: ".m-list .m-row", title: "직원 누르기", text: "직원을 누르면 정보 창이 열려요." },
          { scene: "empSheet", sel: ".sheet", title: "직원 정보", text: "요일별 근무 시간, 시급, 재직중·비활성, 알바·매니저, 시급제·월급제, 입사일·퇴사일, <b>근로계약서</b>를 여기서 바꾸고 써요." },
        ],
  schedule: (pc) =>
    pc
      ? [
          { sel: ".sc-period", title: "근무표 시작 날짜", text: "이 근무표를 언제부터 쓸지 숫자 8자리로 입력해요(예: 20261101). 저장할 때마다 한 번씩 다시 입력해야 저장돼요." },
          { sel: ".wk-col", title: "근무자 추가", text: "블록이 없는 빈 칸을 누르면 그 요일, 그 시각으로 근무자를 추가해요." },
          { scene: "slotAdd", sel: "#tl-edit", title: "근무자 추가 입력칸", text: "근무표 바로 아래에 열려요. 직원을 고르고 시작·끝 시간을 넣으면 표에 바로 보이고, <b>완료</b>를 누르면 들어가요." },
          { sel: ".wk-bar", title: "근무 블록", text: "블록을 누르면 그 근무를 고칠 수 있어요. 같은 시간에 여러 명이면 칸 안에서 나란히 보여요." },
          { scene: "slot", sel: "#tl-edit", title: "근무 고치기 · 삭제", text: "시간을 고치면 바로 반영돼요. <b>근무 삭제</b>로 그 요일 근무를 뺄 수 있어요." },
          { sel: ".sc-actions [data-action=schedule-temp]", title: "임시저장", text: "고친 내용을 보관만 해요. 직원 화면·달력·근무 기록에는 아직 반영되지 않아요." },
          { sel: ".sc-actions [data-action=schedule-save]", title: "저장", text: "시작 날짜부터 직원 화면, 달력, 근무 기록에 반영돼요." },
          { sel: ".sc-actions [data-action=schedule-share]", title: "카카오톡 전송하기", text: "누르면 근무표를 사진으로 만들어요." },
          { scene: "schedShare", sel: ".share-box", title: "근무표 사진", text: "이런 사진이 만들어져요. <b>복사하기</b>를 누르고 단톡방에 붙여넣으면 돼요." },
        ]
      : [
          { sel: ".m-period", title: "근무표 시작 날짜", text: "이 근무표를 언제부터 쓸지 숫자 8자리로 입력해요. 저장할 때마다 한 번씩 다시 입력해야 저장돼요." },
          { sel: ".m-days", title: "요일 고르기", text: "요일을 누르면 그날 근무자가 아래에 나와요. 옆으로 밀어도 요일이 바뀌어요." },
          { sel: ".m-shift", title: "근무자 누르기", text: "근무자를 누르면 고치는 창이 열려요." },
          { scene: "slot", sel: ".sheet", title: "근무 고치기 · 삭제", text: "시작·끝 시간을 고치고 <b>완료</b>, 빼려면 <b>근무 삭제</b>를 눌러요." },
          { sel: ".m-add-shift", title: "근무자 추가", text: "이 요일에 근무자를 추가해요." },
          { scene: "slotAdd", sel: ".sheet", title: "근무자 추가 창", text: "직원을 고르고 시간을 넣은 뒤 <b>완료</b>를 눌러요." },
          { sel: ".m-fold > summary", title: "근무표 한눈에 보기", text: "일주일 근무표 전체를 볼 수 있어요." },
          { sel: ".m-savebar", title: "저장 · 카톡 전송", text: "<b>저장</b>하면 시작 날짜부터 반영돼요. <b>카톡 전송</b>은 근무표를 사진으로 보내요." },
          { scene: "schedShare", sel: ".share-box", title: "근무표 사진", text: "이런 사진이 만들어져요. <b>카카오톡 전송하기</b>로 단톡방에 보내요." },
        ],
  calendar: (pc) => [
    ...(pc ? [] : [{ sel: ".m-today", title: "오늘 근무자", text: "오늘 일할 사람과 출근했는지가 보여요. 누르면 오늘 화면으로 가요." }]),
    { sel: ".cal-head", title: "달 바꾸기", text: "화살표로 지난달, 다음 달을 봐요." },
    { sel: [".cell:has(.day-num.today)", ".grid .cell"], title: "날짜 칸", text: "그날 출근 기록이 이름과 시간으로 보여요. 근무표보다 <b style=\"color:var(--more)\">더 일하면 파랑</b>, <b style=\"color:var(--red)\">덜 일하면 빨강</b>이에요. 날짜를 누르면 그날이 열려요." },
    { scene: "day", sel: ".date-box", title: "그날 출근 기록", text: "날짜를 누르면 이렇게 열려요. 실제로 출근한 사람과 시간이에요." },
    { scene: "day", sel: ".staff", title: "근무 예정", text: "그날 근무표에 있는 사람이에요. 이름을 누르면 고칠 수 있어요." },
    { scene: "staff", sel: ".staff-item.expanded", title: "출근 처리 · 수정", text: "이름을 누르면 <b>수정</b>(그날만 시간 바꾸기), <b>출근 처리</b>(출근을 못 찍은 경우), <b>기록 삭제</b> 버튼이 나와요." },
    { scene: "add", sel: "#add-extra", title: "대타 · 추가 근무", text: "<b>+</b>를 누르면 이름과 시간을 넣어 그날만 근무자를 추가해요. 처음 보는 이름이면 새 직원으로 등록할지 물어요." },
  ],
  // 직원용 달력 (출근 화면)
  home: (pc) => [
    { sel: ".cal-head", title: "달 바꾸기", text: "화살표로 지난달, 다음 달을 봐요." },
    pc
      ? { sel: [".cell:has(.day-num.today)", ".grid .cell"], title: "날짜 칸", text: "그날 출근한 사람과 시간이 보여요. 근무표보다 <b style=\"color:var(--more)\">더 일하면 파랑</b>, <b style=\"color:var(--red)\">덜 일하면 빨강</b>이에요. 날짜를 누르면 그날이 열려요." }
      : { sel: [".cell:has(.day-num.today)", ".grid .cell"], title: "날짜 칸", text: "점이 있는 날은 출근 기록이 있는 날이에요. 날짜를 누르면 그날 화면이 열려요." },
    { scene: "day", sel: ".date-box", title: "출근 기록", text: "날짜를 누르면 이렇게 열려요. 그날 실제로 출근한 사람과 시간이에요." },
    { scene: "day", sel: ".staff", title: "오늘 근무자", text: "근무표에 있는 오늘 근무자예요. <b>본인 이름</b>을 찾아 눌러요." },
    { scene: "staff", sel: ".staff-item.expanded", title: "출근하기", text: "이름을 누르면 <b>출근</b> 버튼이 나와요. 매장에 도착하면 눌러 주세요. 그날만 시간이 바뀌었으면 <b>수정</b>으로 고쳐요." },
    { scene: "add", sel: "#add-extra", title: "대타 · 추가 근무", text: "근무표에 없는데 일하게 됐으면 <b>+</b>를 눌러 이름과 시간을 넣고 <b>등록</b>해요. 그다음 이름을 눌러 출근하면 돼요." },
  ],
  records: (pc) =>
    pc
      ? [
          { sel: ".month-nav", title: "달 바꾸기", text: "화살표로 지난달 급여를 볼 수 있어요." },
          { sel: "#r-emp", title: "직원 고르기", text: "한 명을 고르면 그 사람 것만 보여요." },
          { scene: "emp", sel: "[data-action=share-ts-image]", title: "카카오톡 전송하기", text: "직원을 고르면 나타나요. 누르면 이 직원의 한 달 근무를 달력 사진으로 만들어요." },
          { scene: "share", sel: ".share-box img", title: "근무 사진 미리보기", text: "이런 사진이 만들어져요. 날짜별 근무 시간과 출퇴근 시간, 한 달 합계가 들어가요." },
          { scene: "share", sel: ".share-actions", title: "복사하기 · 사진 저장", text: "<b>복사하기</b>를 누르고 카톡 채팅방에 붙여넣으면 사진으로 보내져요. 복사하면 <b>다음 직원으로 자동으로 넘어가서</b> 한 명씩 차례로 보낼 수 있어요." },
          { scene: "emp", sel: [".ts-wrap", ".timesheet"], title: "이 직원 근무 상세", text: "날짜별 근무 시간이에요. 근무표보다 더 일하면 파랑, 덜 일하면 빨강으로 보여요." },
          { sel: "#r-tax", title: "세금", text: "알바(시급제) 세금이에요. 보통 3.3%를 떼요. 월급제 직원의 공제액은 명세서에서 따로 입력해요." },
          { sel: "[data-action=export-ledger]", title: "급여대장 받기", text: "세무사에게 보낼 엑셀이에요. 알바·직원(4대보험)·날짜별 근무시간·주휴수당 내역이 한 파일에 들어가요." },
          { sel: ".pay-table", title: "급여 정산", text: "기본급, 주휴수당, 수당, 세금, 실지급액이 계산돼요. 주휴수당에 마우스를 올리면 주별 내역이 보여요." },
          { sel: ".pay-table .ps-cell [data-action=open-payslip]", title: "명세서", text: "이름 옆 <b>명세서</b>를 누르면 명세서 창이 열려요. 알바와 직원(매니저)은 창이 조금 달라요." },
          { scene: "payslipAlba", sel: ".ps-allow", title: "알바 명세서 · 수당 입력", text: "특근수당 같은 수당을 이름과 금액으로 넣어요. <b>+ 수당 추가</b>로 여러 개 넣을 수 있어요." },
          { scene: "payslipAlba", sel: ".ps-preview", title: "알바 명세서", text: "기본급, 주휴수당, 수당에서 3.3%를 뗀 금액이에요. 입력하는 대로 바로 바뀌고, 이 모양 그대로 PDF가 돼요." },
          { scene: "payslipAlba", sel: ".ps-side [data-action=save-payslip]", title: "저장", text: "저장하면 급여 정산과 명세서에 반영돼요." },
          { scene: "payslipMgr", sel: ".sal-box", title: "직원(매니저) 명세서 · 월급 · 공제액", text: "매니저(월급제)는 기본급·식대와 세무사에게 받은 공제액 6가지를 넣어요. 한 번 넣으면 다음 달에도 그대로 이어지고, 바뀐 달에만 고치면 돼요." },
          { scene: "payslipMgr", sel: ".ps-preview", title: "직원(매니저) 명세서", text: "기본급·식대에서 4대보험과 근로소득세를 뗀 금액이에요. 공제액을 아직 안 넣었으면 \"공제액 입력 필요\"로 보여요." },
          { sel: ".section-head [data-action=payslip-pdf-all]", title: "명세서 PDF", text: "직원마다 따로 급여명세서 PDF를 받아요. 직원에게 보내 주면 돼요." },
        ]
      : [
          { sel: ".m-month", title: "달 바꾸기", text: "화살표로 지난달 급여를 볼 수 있어요." },
          { sel: ".m-hero", title: "이번 달 합계", text: "실지급액 합계예요. 오른쪽에서 알바 세금(3.3% / 공제 안 함)을 바꿔요." },
          { sel: ".m-pay", title: "직원 누르기", text: "직원을 누르면 그 사람 급여 내역이 열려요." },
          { scene: "paySheet", sel: ".sheet .m-hero", title: "받을 금액", text: "이 직원이 받을 금액과 기본급, 주휴수당, 세금 내역이에요." },
          { scene: "paySheet", sel: ".sheet .m-share", title: "카카오톡 전송하기", text: "누르면 이 직원의 한 달 근무를 달력 사진으로 만들어요." },
          { scene: "share", sel: ".share-box img", title: "근무 사진 미리보기", text: "이런 사진이 만들어져요. 날짜별 근무 시간과 한 달 합계가 들어가요." },
          { scene: "share", sel: ".share-actions", title: "카카오톡 전송하기", text: "<b>카카오톡 전송하기</b>를 누르면 공유 창이 열려서 카톡 채팅방을 고르면 돼요. <b>사진 저장</b>으로 앨범에 저장할 수도 있어요." },
          { scene: "paySheet", sel: ".sheet .sheet-actions", title: "수당 · 명세서 / 명세서 PDF", text: "<b>수당 · 명세서</b>에서 수당(매니저는 월급·공제액)을 넣고, <b>명세서 PDF</b>로 명세서를 받아요." },
          { scene: "payslipAlba", sel: ".ps-allow", title: "알바 명세서 · 수당 입력", text: "특근수당 같은 수당을 이름과 금액으로 넣고 <b>저장</b>해요." },
          { scene: "payslipMgr", sel: ".sal-box", title: "직원(매니저) 명세서 · 월급 · 공제액", text: "매니저는 기본급·식대와 세무사에게 받은 공제액을 넣어요. 한 번 넣으면 다음 달에도 그대로 이어져요." },
          { sel: ".m-fold > summary", title: "날짜별 근무 시간", text: "전체 직원의 날짜별 근무 시간 표예요." },
          { sel: ".m-btns [data-action=export-ledger]", title: "급여대장 받기", text: "세무사에게 보낼 엑셀이에요." },
          { sel: ".m-btns [data-action=payslip-pdf-all]", title: "명세서 PDF 전체", text: "직원마다 따로 급여명세서 PDF를 받아요." },
        ],
};

// 튜토리얼이 잠깐 펼쳐 보이는 화면 (끝나면 원래대로). hash 가 있으면 그 화면으로 갔다가 set 을 한다.
const firstPayEmp = () => payrollFor(state.payroll.month, "").rows[0]?.emp.id ?? null;
const firstAlbaEmp = () => payrollFor(state.payroll.month, "").rows.find((r) => !r.salaried)?.emp.id ?? null;
// 튜토리얼이 띄운 사진 미리보기 창 닫기
const closeTourShare = () => document.querySelectorAll(".share-back [data-share=close]").forEach((b) => b.click());
function tourSlot(add) {
  const wd = isDesktop() ? 1 : state.schedDay ?? weekdayOf(todayDateString());
  const emp = store.employees.find((e) => e.active && effWeekly(e)[wd]);
  const r = emp && effWeekly(emp)[wd];
  state.slotEdit = add
    ? { wd: String(wd), empId: null, addEmpId: null, fixedEmp: false, start: 540, snapshot: structuredClone(schedWork().weekly) }
    : emp
      ? { wd: String(wd), empId: emp.id, addEmpId: null, fixedEmp: false, start: toMin(r.start), snapshot: structuredClone(schedWork().weekly) }
      : null;
}
const TOUR_SCENES = {
  day: { hash: () => (isDesktop() ? null : `#/day/${todayDateString()}`), set: () => isDesktop() && Object.assign(state, { selectedDate: todayDateString(), animateOpen: false }) },
  staff: {
    hash: () => (isDesktop() ? null : `#/day/${todayDateString()}`),
    set: () => {
      const d = todayDateString();
      if (isDesktop()) Object.assign(state, { selectedDate: d, animateOpen: false });
      const emp = scheduledOn(d)[0] ?? employeeById(recordsOn(d)[0]?.employeeId);
      state.expandedId = emp?.id ?? null;
    },
  },
  add: { hash: () => (isDesktop() ? null : `#/day/${todayDateString()}`), set: () => Object.assign(state, isDesktop() ? { selectedDate: todayDateString(), animateOpen: false, adding: true } : { adding: true }) },
  emp: { set: () => (state.payroll.employeeId = firstPayEmp() ?? "") },
  payslip: { set: () => firstPayEmp() && openPayslipState(firstPayEmp()) },
  payslipAlba: {
    set: () => {
      const id = firstAlbaEmp();
      if (!id) return;
      openPayslipState(id);
      // 보여 주기용 예시 수당 (저장하지 않음, 튜토리얼이 끝나면 사라짐)
      if (!state.allowDraft.length) state.allowDraft = [{ name: "특근수당", amount: 20000 }];
    },
  },
  share: {
    set: async () => {
      const id = firstAlbaEmp() ?? firstPayEmp();
      if (!id) return;
      if (isDesktop()) state.payroll.employeeId = id;
      else state.sheet = { type: "pay", id };
      render();
      await shareTimesheetImage(document.createElement("button"), id);
    },
  },
  schedShare: { set: async () => scheduleShare(document.createElement("button")) },
  payslipMgr: { set: () => { const e = store.employees.find((x) => x.active && isSalaried(x)); if (e) openPayslipState(e.id); } },
  paySheet: { set: () => (state.sheet = { type: "pay", id: firstPayEmp() }) },
  slot: { set: () => tourSlot(false) },
  slotAdd: { set: () => tourSlot(true) },
  empSheet: { set: () => (state.sheet = { type: "emp", id: store.employees[0]?.id ?? null }) },
  addSheet: { set: () => (state.sheet = { type: "add-emp", id: null }) },
  contract: { set: () => { const e = store.employees[0]; if (e) state.contractDraft = latestContract(e.id) ? structuredClone(latestContract(e.id)) : newContract(e); } },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function applyTourScene(name) {
  if (tour.scene === name) return;
  const b = tour.base;
  // 튜토리얼 시작 때 모습으로 되돌린 뒤 이 단계의 화면을 펼친다
  closeTourShare();
  Object.assign(state, { selectedDate: b.selectedDate, expandedId: null, adding: false, editingId: null, editingWhere: null, sheet: null, payslipId: null, allowDraft: null, salDraft: null, slotEdit: null, contractDraft: null });
  state.payroll.employeeId = b.payrollEmp;
  const sc = name ? TOUR_SCENES[name] : null;
  const target = sc?.hash?.() ?? b.hash;
  if (location.hash !== target) {
    tour.nav = true;
    location.hash = target;
    await sleep(80); // 화면이 바뀐 뒤에 펼친다
    tour.nav = false;
  }
  const done = sc?.set();
  Object.assign(state, { modalEnter: false, sheetEnter: false, dayEnter: false, expandEnter: false });
  render();
  if (done instanceof Promise) await done.catch(() => {}); // 사진 만들기처럼 시간이 걸리는 장면
  tour.scene = name;
  await sleep(30);
}

let tour = null; // { steps, i, timer }

function tourEl(sel) {
  for (const one of [].concat(sel)) {
    const el = document.querySelector(`#app ${one}`) ?? document.querySelector(one);
    if (el && el.getClientRects().length && !el.closest(".tour")) return el;
  }
  return null;
}

function startTour(page) {
  if (state.sheet || state.payslipId || state.slotEdit) {
    state.sheet = null;
    state.payslipId = null;
    state.slotEdit = null;
    render();
  }
  // 펼쳐서 보여 줄 단계(scene)는 그때 확인하고, 지금 화면 단계는 지금 있는 것만
  const steps = (TOURS[page]?.(isDesktop()) ?? []).filter((s) => s.scene || tourEl(s.sel));
  if (!steps.length) return;
  endTour();
  const root = document.createElement("div");
  root.className = "tour";
  root.innerHTML = `
    <div class="tour-block"></div>
    <div class="tour-spot"></div>
    <div class="tour-tip" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <p class="tour-title" id="tour-title"></p>
      <p class="tour-text"></p>
      <div class="tour-foot">
        <button type="button" class="tour-skip" data-tour="end">건너뛰기</button>
        <span class="tour-count"></span>
        <button type="button" class="tour-prev" data-tour="prev">이전</button>
        <button type="button" class="tour-next" data-tour="next">다음</button>
      </div>
    </div>`;
  root.addEventListener("click", (e) => {
    const k = e.target.closest("[data-tour]")?.dataset.tour;
    if (k === "end") endTour();
    if (k === "prev") showTourStep(tour.i - 1, -1);
    if (k === "next") tour.i + 1 < tour.steps.length ? showTourStep(tour.i + 1) : endTour();
  });
  document.body.appendChild(root);
  tour = {
    steps, i: 0, root, timer: setInterval(placeTour, 250), scene: null, nav: false, busy: false,
    base: { hash: location.hash, selectedDate: state.selectedDate, payrollEmp: state.payroll.employeeId },
  };
  document.addEventListener("keydown", tourKey, true);
  window.addEventListener("resize", placeTour);
  window.addEventListener("scroll", placeTour, true);
  showTourStep(0);
}

function tourKey(e) {
  if (!tour) return;
  if (e.key === "Escape") endTour();
  else if (e.key === "ArrowRight" || e.key === "Enter") tour.i + 1 < tour.steps.length ? showTourStep(tour.i + 1) : endTour();
  else if (e.key === "ArrowLeft") showTourStep(tour.i - 1, -1);
  else return;
  e.preventDefault();
  e.stopPropagation();
}

async function showTourStep(i, dir = 1) {
  if (!tour || tour.busy || i < 0 || i >= tour.steps.length) return;
  tour.busy = true;
  const step = tour.steps[i];
  await applyTourScene(step.scene ?? null);
  if (!tour) return;
  tour.busy = false;
  // 펼쳤는데도 가리킬 곳이 없으면(예: 직원이 없음) 그 단계는 건너뛴다
  if (!tourEl(step.sel)) {
    if (i + dir >= 0 && i + dir < tour.steps.length) return showTourStep(i + dir, dir);
    return dir > 0 ? endTour() : undefined;
  }
  tour.i = i;
  const q = (c) => tour.root.querySelector(c);
  q(".tour-title").textContent = step.title;
  q(".tour-text").innerHTML = step.text;
  q(".tour-count").textContent = `${i + 1} / ${tour.steps.length}`;
  q(".tour-prev").hidden = i === 0;
  q(".tour-next").textContent = i + 1 === tour.steps.length ? "완료" : "다음";
  tour.root.classList.remove("show");
  void tour.root.offsetWidth; // 단계마다 말풍선이 새로 나타나게
  tour.root.classList.add("show");
  tourEl(step.sel)?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  placeTour();
  q(".tour-next").focus({ preventScroll: true });
}

// 가리키는 칸이 움직여도(스크롤·다시 그리기) 따라가게 자주 다시 잰다
function placeTour() {
  if (!tour) return;
  const el = tourEl(tour.steps[tour.i].sel);
  const spot = tour.root.querySelector(".tour-spot");
  const tip = tour.root.querySelector(".tour-tip");
  if (!el) return;
  const pad = 6;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const gap = 14;
  const below = r.bottom + pad + gap + th < vh - 8 || r.top - pad - gap - th < 8;
  const top = below ? Math.min(r.bottom + pad + gap, vh - th - 8) : r.top - pad - gap - th;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), vw - tw - 12);
  Object.assign(tip.style, { left: `${left}px`, top: `${Math.max(8, top)}px` });
  tip.dataset.side = below ? "below" : "above";
  tip.style.setProperty("--arrow-x", `${Math.min(Math.max(20, r.left + r.width / 2 - left), tw - 20)}px`);
}

function endTour() {
  if (!tour) return;
  const t = tour;
  // 펼쳐 둔 화면을 시작할 때 모습으로
  closeTourShare();
  if (t.scene) {
    Object.assign(state, { selectedDate: t.base.selectedDate, expandedId: null, adding: false, sheet: null, payslipId: null, allowDraft: null, salDraft: null, slotEdit: null, contractDraft: null });
    state.payroll.employeeId = t.base.payrollEmp;
    if (location.hash !== t.base.hash) {
      t.nav = true;
      location.hash = t.base.hash;
      setTimeout(() => (t.nav = false), 80);
    } else render();
  }
  clearInterval(tour.timer);
  document.removeEventListener("keydown", tourKey, true);
  window.removeEventListener("resize", placeTour);
  window.removeEventListener("scroll", placeTour, true);
  tour.root.remove();
  tour = null;
}

// ---------- 라우팅 ----------

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  if (ADMIN_SITE && !isAdmin()) {
    // 로그인 화면 / 로그인은 했는데 매장이 없거나 확인 중 → 로그인 화면, 그 외에는 샘플 매장 둘러보기
    if (!state.authReady || hash === "/login" || hash === "/signup" || cloud?.auth.currentUser) return { name: "lock" };
  } else if (!storeId) return { name: "pick" };
  const day = hash.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (day) return { name: "day", date: day[1] };
  if (!ADMIN_SITE) return { name: ["/my", "/pay", "/work"].includes(hash) ? "pay" : "home" };
  const emp = hash.match(/^\/emp\/([\w-]+)$/);
  if (emp) return { name: "emp", id: emp[1] };
  const page = { "/records": "records", "/schedule": "schedule", "/calendar": "calendar", "/me": "me" }[hash];
  return { name: page ?? "employees" };
}

// 달력 첫 화면 주소 (직원용은 #/, 관리자는 #/calendar)
const homeHash = () => (ADMIN_SITE ? "#/calendar" : "#/");

// 다시 그릴 때 입력 중이던 시간 칸 값을 지키는 칸들 (편집이 끝나면 칸이 사라지므로 그대로 남지 않는다)
const KEEP_FIELDS = ["edit-start", "edit-end", "extra-name", "extra-start", "extra-end"];

function render() {
  const kept = KEEP_FIELDS.map((id) => [id, document.getElementById(id)?.value]).filter(([, v]) => v);
  const focusedId = document.activeElement?.id;
  const r = route();
  if (r.name === "lock") app.innerHTML = renderLock();
  else if (r.name === "pick") app.innerHTML = renderPick();
  else if (r.name === "day") app.innerHTML = renderDayPage(r.date);
  else if (r.name === "calendar") app.innerHTML = renderAdminCalendar();
  else if (r.name === "employees") app.innerHTML = renderEmployees();
  else if (r.name === "records") app.innerHTML = renderRecords();
  else if (r.name === "schedule") app.innerHTML = renderSchedule();
  else if (r.name === "me") app.innerHTML = renderMyPage();
  else if (r.name === "emp") app.innerHTML = renderEmpPage(r.id);
  else if (r.name === "pay") app.innerHTML = renderPayPage();
  else app.innerHTML = renderHome();

  for (const [id, value] of kept) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = value;
  }
  if (KEEP_FIELDS.includes(focusedId)) document.getElementById(focusedId)?.focus({ preventScroll: true });

  const period = document.querySelector(".sc-period");
  if (period) fitPeriod(period);
  lockDemoFields();
  placeNavPill();
  if (r.name === "emp") fitContractPreview();
  if (state.pageEnter && r.name === "records") countUp(app.querySelectorAll(".pay-table td.net, .m-main .net"));
  // 카톡 복사 후 다음 직원으로 넘어갔음을 보여준다: 직원 칸 반짝, 표 새로 들어옴, 전송 버튼 두근
  // (저장 직후 다시 그려져도 이어서 돌도록 지난 시간만큼 앞당겨 시작)
  const flashMs = Date.now() - (state.nextFlashAt ?? 0);
  if (flashMs < 2600 && r.name === "records") {
    for (const sel of ["#r-emp", ".ts-desktop", '[data-action="share-ts-image"]']) {
      const el = app.querySelector(sel);
      if (!el) continue;
      el.style.setProperty("--flash-t", `${flashMs}ms`);
      el.classList.add("next-flash");
    }
  }
  state.pageEnter = false;
  state.monthDir = null;
  state.expandEnter = false;
  state.dayEnter = false;
  state.modalEnter = false;
  state.sheetEnter = false;
  state.dayListEnter = false;

  // 처음 날짜를 눌렀을 때 달력이 줄어드는 애니메이션
  if (state.animateOpen) {
    state.animateOpen = false;
    const card = document.getElementById("card");
    if (card) {
      card.getBoundingClientRect();
      requestAnimationFrame(() => card.classList.add("open"));
    }
  }

  if (r.name === "lock" || r.name === "pick") {
    const first = document.querySelector(".lock-form .field");
    if (first && !first.value) first.focus();
  }
}

function navigate(hash) {
  endTour();
  state.error = "";
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener("hashchange", () => {
  if (!tour?.nav) endTour(); // 튜토리얼이 화면을 바꾸는 중이면 끄지 않는다
  state.pageEnter = true;
  state.sheet = null;
  resetDayUi();
  state.payslipId = null;
  state.payTab = null;
  // 직원 페이지를 떠나면: 고친 초안은 저장하고 닫는다
  if (!location.hash.startsWith("#/emp/")) {
    if (state.contractDirty && state.contractDraft?.status === "draft") saveContractDraft(state.contractDraft);
    state.contractDraft = null;
    state.contractDirty = false;
  }
  state.allowDraft = null;
  state.slotEdit = null;
  state.helpOpen = {};
  render();
});

// ---------- 로그인 ----------

const LOGIN_ERRORS = {
  "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/wrong-password": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/user-not-found": "이메일 또는 비밀번호가 맞지 않아요.",
  "auth/invalid-email": "이메일 형식을 확인해주세요.",
  "auth/too-many-requests": "잠시 후 다시 시도해주세요.",
  "auth/network-request-failed": "인터넷 연결을 확인해주세요.",
  "auth/email-already-in-use": "이미 가입된 이메일이에요. 로그인해주세요.",
  "auth/weak-password": "비밀번호는 6자 이상으로 해주세요.",
  "auth/operation-not-allowed": "Firebase 에서 이메일 로그인이 꺼져 있어요.",
};

async function login() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  state.busy = "login";
  state.error = "";
  render();
  try {
    // 창을 닫으면 로그아웃 (매장 공용 컴퓨터)
    await cloud.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    await cloud.auth.signInWithEmailAndPassword(email, password);
    state.busy = null;
    location.hash = "#/employees";
  } catch (err) {
    state.busy = null;
    state.error = LOGIN_ERRORS[err.code] ?? "로그인하지 못했어요. 다시 시도해주세요.";
    render();
    const pw = document.getElementById("login-password");
    if (pw) {
      document.getElementById("login-email").value = email;
      pw.focus();
    }
  }
}

// 비밀번호 재설정 메일 (로그인 화면의 이메일 칸 주소로)
async function resetPassword() {
  const email = document.getElementById("login-email")?.value.trim();
  state.notice = "";
  if (!email) {
    state.error = "이메일을 먼저 입력해주세요.";
    render();
    return;
  }
  try {
    cloud.auth.languageCode = "ko";
    await cloud.auth.sendPasswordResetEmail(email);
    state.error = "";
    state.notice = `${email} 로 비밀번호 재설정 메일을 보냈어요. 메일함(스팸함 포함)을 확인해주세요.`;
  } catch (err) {
    state.error = LOGIN_ERRORS[err.code] ?? "메일을 보내지 못했어요. 이메일을 확인해주세요.";
  }
  render();
  const field = document.getElementById("login-email");
  if (field) field.value = email;
}

// 매장 등록 = 관리자 계정 만들기 + 매장 만들기
async function signup() {
  const name = document.getElementById("signup-store").value.trim();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!name) return;
  state.busy = "signup";
  state.error = "";
  render();
  try {
    await cloud.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    const { user } = await cloud.auth.createUserWithEmailAndPassword(email, password);
    await createStore(user.uid, name);
  } catch (err) {
    state.busy = null;
    state.error = LOGIN_ERRORS[err.code] ?? "등록하지 못했어요. 다시 시도해주세요.";
    render();
    const field = document.getElementById("signup-store");
    if (field) {
      field.value = name;
      document.getElementById("login-email").value = email;
    }
  }
}

// 로그인했지만 매장이 없는 계정 (등록 중에 끊긴 경우)
async function createStoreForm() {
  const name = document.getElementById("store-name").value.trim();
  if (!name) return;
  state.busy = "create";
  state.error = "";
  render();
  try {
    await createStore(cloud.auth.currentUser.uid, name);
  } catch (err) {
    console.warn(err);
    state.busy = null;
    state.error = "매장을 만들지 못했어요. 다시 시도해주세요.";
    render();
  }
}

async function createStore(ownerUid, name) {
  // 매장 코드가 겹치면 규칙에서 거절되므로 다른 코드로 다시 시도한다
  for (let tries = 0; ; tries++) {
    const code = newStoreCode();
    try {
      await cloud.db.ref(`stores/${code}/meta`).set({ name, owner: ownerUid, createdAt: Date.now() });
      await cloud.db.ref(`owners/${ownerUid}`).set(code);
      state.busy = null;
      state.storeName = name;
      openStore(code, true);
      location.hash = "#/employees";
      render();
      return;
    } catch (err) {
      if (tries >= 2) throw err;
    }
  }
}

// 직원용 달력에서 매장 코드를 입력
async function pickStore() {
  const code = document.getElementById("pick-code").value.replace(/[\s-]/g, "").toLowerCase();
  state.error = "";
  if (!/^[a-z0-9]{4,12}$/.test(code)) {
    state.error = "매장 코드를 다시 확인해주세요.";
    render();
    return;
  }
  if (!cloud) {
    state.error = "인터넷 연결을 확인한 뒤 새로고침해주세요.";
    render();
    return;
  }
  state.busy = "pick";
  render();
  try {
    const meta = (await cloud.db.ref(`stores/${code}/meta/name`).once("value")).val();
    state.busy = null;
    if (!meta) {
      state.error = "없는 매장 코드예요. 관리자에게 다시 확인해주세요.";
      render();
      return;
    }
    openStore(code);
    render();
  } catch (err) {
    console.warn(err);
    state.busy = null;
    state.error = "확인하지 못했어요. 인터넷 연결을 확인해주세요.";
    render();
  }
}

// ---------- 이벤트 ----------

function activeDate() {
  const r = route();
  return r.name === "day" ? r.date : state.selectedDate;
}

function resetDayUi() {
  state.error = "";
  state.expandedId = null;
  state.editingId = null;
  state.editingWhere = null;
  state.adding = false;
}

function selectDate(date) {
  resetDayUi();
  state.dayEnter = true;
  if (!isDesktop()) {
    navigate(`#/day/${date}`);
    return;
  }
  state.animateOpen = !state.selectedDate;
  state.selectedDate = date;
  render();
}

function closePanel() {
  const card = document.getElementById("card");
  card?.classList.remove("open");
  setTimeout(() => {
    state.selectedDate = null;
    state.expandedId = null;
    render();
  }, PANEL_ANIM_MS);
}

app.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-date]");
  if (cell) {
    selectDate(cell.dataset.date);
    return;
  }

  const el = e.target.closest("[data-action]");
  // 명세서 창 안쪽 빈 곳을 누르면 바깥(닫기)으로 전달되지 않게
  const isBackdrop = el?.classList.contains("ps-backdrop") || el?.classList.contains("sheet-backdrop");
  const insideDialog = isBackdrop && e.target.closest("[data-stop]") && !e.target.closest("[data-action]:not(.ps-backdrop):not(.sheet-backdrop)");
  if (!el || insideDialog) return;
  const { action, id } = el.dataset;

  switch (action) {
    case "prev-month":
    case "next-month":
      moveMonth(action === "prev-month" ? -1 : 1);
      break;
    case "open-today":
      navigate(`#/day/${todayDateString()}`);
      return;
    case "install-app":
      installEvent?.prompt();
      installEvent = null;
      break;
    case "dismiss-install":
      try {
        localStorage.setItem(INSTALL_HINT_KEY, "1");
      } catch {}
      break;
    case "close-panel":
      closePanel();
      return;
    case "go-home":
      navigate(homeHash());
      return;
    case "toggle-staff": {
      state.error = "";
      state.editingId = null;
      const opening = state.expandedId !== id;
      state.expandedId = opening ? id : null;
      state.expandEnter = Boolean(state.expandedId);
      break;
    }
    case "edit-shift":
      state.error = "";
      state.editingId = id;
      state.editingWhere = "staff";
      break;
    case "cancel-edit":
      state.error = "";
      state.editingId = null;
      state.editingWhere = null;
      break;
    case "save-shift": {
      const start = readTime("edit-start");
      const end = readTime("edit-end");
      if (!start || !end) {
        state.error = "시간은 09:00 처럼 숫자로 입력해주세요.";
        break;
      }
      if (start === end) {
        state.error = "시작과 끝 시간이 같아요. 다시 입력해주세요.";
        break;
      }
      const date = activeDate();
      const emp = employeeById(id);
      // 관리자: 지난 날짜는 근무 기록을 바로 고친다 (기록이 없으면 새로 넣는다)
      if (ADMIN_SITE && date < todayDateString()) {
        setRecordTimes(id, date, start, end);
        save();
        queueToast(`${emp.name}님 근무 시간을 고쳤어요`);
        state.error = "";
        state.editingId = null;
        state.editingWhere = null;
        state.expandedId = null;
        break;
      }
      setShift(id, date, start, end);
      // 이미 출근했다면 기록 시간도 함께 고친다
      const rec = recordFor(id, date);
      if (rec) {
        rec.clockIn = kstIso(date, start);
        rec.clockOut = scheduledEnd(emp, date);
      }
      save();
      queueToast(`${emp.name}님 근무 시간을 바꿨어요`);
      state.error = "";
      state.editingId = null;
      state.editingWhere = null;
      break;
    }
    case "open-add":
      state.adding = true;
      state.expandedId = null;
      break;
    case "cancel-add":
      state.adding = false;
      break;
    case "admin-clock-in": {
      // 관리자: 출근을 못 찍은 직원을 그날 근무 시간대로 출근 처리 (오늘·지난 날짜)
      const date = activeDate();
      adminClockIn(id, date);
      state.expandedId = null;
      state.justAddedId = recordFor(id, date)?.id ?? null;
      queueToast(`${employeeById(id).name}님 ${shortDate(date)} 출근 처리했어요`);
      render();
      state.justAddedId = null;
      return;
    }
    case "clock-in":
      state.error = clockIn(id) || "";
      if (!state.error) {
        state.expandedId = null;
        state.justAddedId = recordFor(id, todayDateString()).id;
        queueToast(`${employeeById(id).name}님 출근 완료!`);
        render();
        state.justAddedId = null;
        return;
      }
      break;
    case "remove-record": {
      const date = activeDate();
      uiConfirm(`${employeeById(id).name}님의 ${shortDate(date)} 근무 기록을 삭제할까요?`, { ok: "삭제", danger: true }).then((yes) => {
        if (!yes) return;
        removeRecord(id, date);
        save();
        queueToast("근무 기록을 삭제했어요");
        state.expandedId = null;
        render();
      });
      return;
    }
    case "logout":
      cloud?.auth.signOut();
      navigate("#/");
      return;
    case "toggle-active": {
      const emp = employeeById(id);
      emp.active = !emp.active;
      // 비활성으로 바꾸면 오늘을 퇴사일로, 다시 재직중이면 퇴사일을 지운다
      if (!emp.active && !emp.leaveDate) emp.leaveDate = todayDateString();
      if (emp.active) delete emp.leaveDate;
      save();
      queueToast(`${emp.name}님을 ${emp.active ? "재직중으로" : "비활성으로"} 바꿨어요`);
      break;
    }
    case "remove-employee": {
      const emp = employeeById(id);
      const row = el.closest("tr");
      uiConfirm(`${emp.name}님을 삭제할까요?\n근무 기록도 함께 삭제돼요.`, { ok: "삭제", danger: true }).then((yes) => {
        if (!yes) return;
        const finish = () => {
          store.employees = store.employees.filter((x) => x.id !== id);
          store.records = store.records.filter((x) => x.employeeId !== id);
          save();
          queueToast(`${emp.name}님을 삭제했어요`);
          if (state.sheet?.id === id) state.sheet = null;
          render();
        };
        // 줄이 옆으로 밀려나며 사라진 뒤에 지운다
        if (row && row.isConnected && !reducedMotion()) {
          row.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }], { duration: 220, easing: "ease-in" }).finished.then(finish);
        } else finish();
      });
      return;
    }
    case "payroll-prev":
    case "payroll-next":
      state.payroll.month = shiftMonth(state.payroll.month, action === "payroll-prev" ? -1 : 1);
      state.payslipId = null;
      state.pageEnter = true; // 달을 넘기면 카드가 다시 올라오고 금액도 다시 올라간다
      break;
    case "toggle-paytype": {
      const emp = employeeById(id);
      store.salary = store.salary ?? {};
      const rec = (store.salary[emp.id] = store.salary[emp.id] ?? { on: isSalaried(emp), hist: [] });
      rec.on = !rec.on;
      save();
      queueToast(rec.on ? `${emp.name}님을 월급제(4대보험)로 바꿨어요. 급여 화면 명세서에서 월급을 입력해주세요` : `${emp.name}님을 시급제(3.3%)로 바꿨어요`);
      break;
    }
    case "toggle-role": {
      const emp = employeeById(id);
      emp.role = isManager(emp) ? undefined : "manager";
      if (!isManager(emp)) emp.color = null;
      placeByRole(emp); // 매니저가 되면 위로, 알바가 되면 알바 맨 앞으로
      ensureColors();
      // 매니저는 월급제(4대보험), 알바는 시급제(3.3%)로 같이 바꾼다 (전에 넣은 월급·공제액은 지우지 않고 둔다)
      store.salary = store.salary ?? {};
      store.salary[emp.id] = { hist: [], ...store.salary[emp.id], on: isManager(emp) };
      save();
      queueToast(isManager(emp) ? `${emp.name}님을 매니저(월급제)로 바꿨어요. 급여 화면 명세서에서 월급을 입력해주세요` : `${emp.name}님을 알바(시급제)로 바꿨어요`);
      break;
    }
    case "open-sheet":
      state.sheet = { type: el.dataset.sheet, id: id ?? null };
      state.sheetEnter = true;
      break;
    case "close-sheet":
      state.sheet = null;
      break;
    case "sched-day":
      state.schedDay = Number(el.dataset.wd);
      state.dayListEnter = true;
      break;
    case "payslip-pdf-one":
      payslipPdf(el, [id]);
      return;
    case "reset-password":
      resetPassword();
      return;
    case "copy-resume-link":
      navigator.clipboard?.writeText(resumeUrl()).then(
        () => showToast("이력서 양식 주소를 복사했어요. 지원자에게 보내 주세요", "ok"),
        () => showToast("복사하지 못했어요. 주소를 길게 눌러 복사해주세요."),
      );
      return;
    case "copy-pay-link":
      navigator.clipboard?.writeText(payUrl()).then(
        () => showToast("직원 링크를 복사했어요. 단톡방에 붙여 넣어 주세요", "ok"),
        () => showToast("복사하지 못했어요. 주소를 길게 눌러 복사해주세요."),
      );
      return;
    case "slip-new":
      newSlipPin(id).catch((err) => uiAlert(`PIN을 만들지 못했어요. ${err.message}`));
      return;
    case "pay-open":
      payOpen(id);
      return;
    case "pay-save":
      paySave().catch((err) => uiAlert(err.message));
      return;
    case "pay-close":
      state.payView = null;
      state.payPin = null;
      render();
      return;
    case "pin-key":
      pinKey(el.dataset.key);
      return;
    case "pay-tab":
      state.payTab = el.dataset.tab;
      render();
      return;
    case "pay-step": {
      const v = state.payView;
      const tab = payTab();
      const list = v ? tabMonths(v.empId, tab) : [];
      const next = list[list.indexOf(v?.ym[tab]) + Number(el.dataset.dir)];
      if (next) {
        v.ym[tab] = next;
        render();
      }
      return;
    }
    case "copy-staff-link":
      navigator.clipboard?.writeText(staffUrl()).then(
        () => showToast("직원용 달력 주소를 복사했어요", "ok"),
        () => showToast("복사하지 못했어요. 주소를 길게 눌러 복사해주세요."),
      );
      return;
    case "start-tour":
      startTour(route().name);
      return;
    case "open-contract": {
      const emp = employeeById(id);
      const last = latestContract(id);
      state.sheet = null;
      state.error = "";
      state.modalEnter = true;
      state.contractDraft = last ? structuredClone(last) : newContract(emp);
      break;
    }
    case "new-contract":
      state.error = "";
      state.contractDraft = newContract(employeeById(id));
      break;
    case "close-contract":
      state.contractDraft = null;
      state.error = "";
      break;
    case "view-contract": {
      const h = (store.contracts ?? []).find((x) => x.id === el.dataset.cid);
      if (h) state.contractDraft = structuredClone(h);
      break;
    }
    case "save-contract": {
      const problem = contractProblem(state.contractDraft.f);
      saveContractDraft(state.contractDraft);
      state.contractDirty = false;
      showToast(problem ? `저장했어요. 서명 전에 확인: ${problem}` : "계약서를 저장했어요", "ok");
      break;
    }
    case "sign-contract":
      signContract();
      return;
    case "contract-pdf":
      contractPdf(el);
      return;
    case "contract-share":
      contractShare(el);
      return;
    case "delete-store":
      deleteStore();
      return;
    case "export-ledger":
      exportLedger(el);
      return;
    case "share-ts-image":
      shareTimesheetImage(el, el.dataset.id);
      return;
    case "schedule-share":
      scheduleShare(el);
      return;
    case "toggle-password": {
      // 다시 그리지 않고 입력칸 종류만 바꾼다 (입력한 비밀번호가 지워지지 않게)
      const input = document.getElementById("login-password");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      el.innerHTML = show ? ICON_EYE_OFF : ICON_EYE;
      el.setAttribute("aria-pressed", String(show));
      el.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 보기");
      input.focus({ preventScroll: true });
      return;
    }
    case "schedule-temp":
      if (state.slotEdit) liveSlot({ final: true });
      state.slotEdit = null;
      tempSaveSchedule();
      showToast("임시저장했어요", "ok");
      return;
    case "schedule-save":
      if (state.slotEdit) liveSlot({ final: true });
      {
        // 저장할 근무표(아직 저장 전인 기간 포함)의 시작일
        // 근무표를 바꿀 때마다 시작 날짜를 직접 다시 입력해야 저장 (예전 날짜 그대로 실수로 덮어쓰지 않게)
        if (!state.periodTyped) {
          uiAlert("저장하기 전에 근무표 시작 날짜를 입력해주세요.\n예전과 같은 날짜라도 다시 입력해야 저장돼요.\n(예: 2026.10.20~)").then(() => {
            const input = document.querySelector(".sc-period");
            input?.focus();
            input?.select();
          });
          return;
        }
        const period = state.schedWork?.meta?.period ?? store.scheduleMeta?.period ?? "";
        // 시작 날짜(연·월·일)를 다 입력해야 저장 (날짜가 없으면 언제부터 바뀌는지 알 수 없다)
        const typed = period.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
        const valid = typed && (() => {
          const [y, m, d] = typed.slice(1).map(Number);
          const dt = new Date(Date.UTC(y, m - 1, d));
          return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
        })();
        if (!valid) {
          uiAlert("근무표 시작 날짜를 입력해주세요.\n제목 옆 기간 칸에 숫자 8자리로 입력하면 돼요.\n(예: 2026.10.20~)").then(() =>
            document.querySelector(".sc-period")?.focus(),
          );
          return;
        }
        const from = scheduleStart(period).replaceAll("-", ".");
        uiConfirm(`근무표를 저장하면 ${from} 부터\n직원 관리·달력·근무 기록에 반영돼요. 저장할까요?`, { ok: "저장" }).then((yes) => {
          if (!yes) return;
          state.slotEdit = null;
          state.periodTyped = false;
          commitSchedule();
          showToast("근무표를 저장했어요", "ok");
        });
      }
      return;
    case "edit-slot":
      if (state.slotEdit) liveSlot({ final: true }); // 보던 칸은 입력한 대로 두고 넘어간다
      state.sheetEnter = !state.slotEdit;
      state.error = "";
      state.slotEdit = {
        wd: el.dataset.wd,
        empId: el.dataset.id ?? null,
        addEmpId: el.dataset.add ?? null,
        fixedEmp: Boolean(el.dataset.add), // 그 직원 줄의 빈 칸을 눌렀으면 직원을 고를 필요 없음
        start: Number(el.dataset.start),
        snapshot: structuredClone(schedWork().weekly),
      };
      render();
      revealSlotPanel();
      return;
    case "cancel-slot":
      state.schedWork.weekly = state.slotEdit.snapshot; // 이번에 입력한 것 되돌리기
      state.slotEdit = null;
      state.error = "";
      break;
    case "remove-slot":
      draftWeekly(employeeById(state.slotEdit.empId), state.slotEdit.wd, null);
      state.slotEdit = null;
      break;
    case "toggle-help": {
      const key = el.dataset.key;
      state.helpOpen[key] = !state.helpOpen[key];
      render();
      // 펼친 설명이 화면 안에 다 보이도록 스크롤
      if (state.helpOpen[key]) document.querySelector(`[data-key="${key}"]`)?.closest(".help")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    case "open-payslip":
      state.modalEnter = true;
      openPayslipState(id);
      break;
    case "close-payslip":
      state.payslipId = null;
      state.allowDraft = null;
      state.salDraft = null;
      break;
    case "save-payslip":
      setAllowances(state.payroll.month, state.payslipId, state.allowDraft.filter((a) => a.name || a.amount));
      if (state.salDraft) setSalary(state.payslipId, state.payroll.month, normalizeSalary(state.salDraft));
      save();
      queueToast(state.salDraft ? `저장했어요. ${Number(state.payroll.month.slice(5, 7))}월부터 다음 달에도 같은 금액으로 들어가요` : "수당을 저장했어요");
      state.payslipId = null;
      state.allowDraft = null;
      state.salDraft = null;
      break;
    case "add-allowance":
      state.allowDraft.push({ name: "", amount: 0 });
      break;
    case "remove-allowance":
      state.allowDraft.splice(Number(el.dataset.index), 1);
      break;
    case "payslip-pdf-all":
      // 휴대폰 화면은 직원 필터가 없으므로 항상 전체
      payslipPdf(el, payrollFor(state.payroll.month, isDesktop() ? state.payroll.employeeId : "").rows.map((r) => r.emp.id));
      return;
    default:
      return;
  }
  render();
});

// ---------- 인터랙션 ----------
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 관리자 메뉴의 회색 배경이 누른 메뉴로 미끄러져 간다 (메뉴는 매번 다시 그려지므로 직전 위치에서 애니메이션)
let lastPill = null;
function placeNavPill() {
  const pill = app.querySelector(".nav-pill");
  const link = app.querySelector(".admin-top > a.active");
  if (!pill || !link) {
    lastPill = null;
    return;
  }
  const box = { left: link.offsetLeft, top: link.offsetTop, width: link.offsetWidth, height: link.offsetHeight };
  Object.assign(pill.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, opacity: 1 });
  if (lastPill && lastPill.top === box.top && lastPill.left !== box.left && !reducedMotion()) {
    pill.animate(
      [
        { transform: `translateX(${lastPill.left - box.left}px)`, width: `${lastPill.width}px` },
        { transform: "translateX(0)", width: `${box.width}px` },
      ],
      { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }
  lastPill = box;
}
window.addEventListener("resize", () => {
  lastPill = null;
  placeNavPill();
});

// 금액이 0원부터 올라간다 ("528,920원")
function countUp(cells) {
  if (reducedMotion()) return;
  for (const td of cells) {
    const target = Number(td.textContent.replace(/[^0-9]/g, ""));
    if (!target) continue;
    const t0 = performance.now();
    const step = (now) => {
      if (!td.isConnected) return;
      const k = Math.min(1, (now - t0) / 700);
      td.textContent = `${Math.round(target * (1 - (1 - k) ** 3)).toLocaleString()}원`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// ---------- 휴대폰 전용: 진동 · 밀어서 넘기기 · 창 끌어내리기 · 오늘 카드 · 홈 화면에 추가 ----------
// 짧은 진동 (안드로이드. 아이폰 브라우저는 지원하지 않아 조용히 넘어간다)
const haptic = (ms = 10) => {
  if (!isDesktop() && !reducedMotion()) navigator.vibrate?.(ms);
};

function moveMonth(delta) {
  const m = state.month + delta;
  state.monthDir = delta < 0 ? "prev" : "next";
  state.year += m < 1 ? -1 : m > 12 ? 1 : 0;
  state.month = m < 1 ? 12 : m > 12 ? 1 : m;
}

// 근무표 요일 칩 순서 (월 ~ 일)
function moveSchedDay(delta) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const now = state.schedDay ?? weekdayOf(todayDateString());
  state.schedDay = order[(order.indexOf(now) + delta + 7) % 7];
  state.dayListEnter = true;
}

// 달력은 좌우로 밀면 달이, 근무표 근무자 목록은 요일이 넘어간다
let swipe = null;
app.addEventListener(
  "touchstart",
  (e) => {
    if (isDesktop() || e.touches.length !== 1) return;
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target };
  },
  { passive: true },
);
app.addEventListener(
  "touchend",
  (e) => {
    if (!swipe) return;
    const { x, y, target } = swipe;
    swipe = null;
    const dx = e.changedTouches[0].clientX - x;
    const dy = e.changedTouches[0].clientY - y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (target.closest(".sheet, input, select, textarea, .sched-scroll, .ts-mobile, .m-tabbar")) return;
    if (target.closest(".cal-wrap")) {
      moveMonth(dx < 0 ? 1 : -1);
    } else if (target.closest("#sched-day-list, .m-days")) {
      moveSchedDay(dx < 0 ? 1 : -1);
    } else return;
    haptic(8);
    render();
  },
  { passive: true },
);

// 아래에서 올라온 창은 아래로 끌어내리면 닫힌다
let sheetDrag = null;
app.addEventListener(
  "touchstart",
  (e) => {
    const sheet = e.target.closest?.(".sheet");
    if (!sheet || isDesktop()) return;
    if (sheet.scrollTop > 0 && !e.target.closest(".sheet-grip")) return;
    sheetDrag = { sheet, y: e.touches[0].clientY, dy: 0 };
  },
  { passive: true },
);
app.addEventListener(
  "touchmove",
  (e) => {
    if (!sheetDrag) return;
    const dy = e.touches[0].clientY - sheetDrag.y;
    sheetDrag.dy = dy;
    if (dy > 0) {
      sheetDrag.sheet.style.transition = "none";
      sheetDrag.sheet.style.transform = `translateY(${dy}px)`;
    }
  },
  { passive: true },
);
app.addEventListener("touchend", () => {
  if (!sheetDrag) return;
  const { sheet, dy } = sheetDrag;
  sheetDrag = null;
  sheet.style.transition = "transform 0.2s ease";
  if (dy > 110) {
    sheet.style.transform = "translateY(100%)";
    setTimeout(() => sheet.closest(".sheet-backdrop")?.click(), 180); // 바깥을 누른 것과 같게 닫기
  } else {
    sheet.style.transform = "";
  }
});

// 달력 탭 맨 위: 오늘 근무자와 출근 현황
function renderTodayCard() {
  const today = todayDateString();
  const planned = scheduledOn(today);
  const extra = recordsOn(today)
    .map((r) => employeeById(r.employeeId))
    .filter((e) => e && !planned.includes(e));
  const people = [...planned, ...extra];
  const done = (e) => Boolean(recordFor(e.id, today)?.clockIn);
  const [, m, d] = today.split("-").map(Number);
  return `
    <button type="button" class="m-today" data-action="open-today">
      <span class="m-today-head">
        <b>오늘 ${m}/${d} (${WEEKDAYS[weekdayOf(today)]})</b>
        <span>근무 ${people.length}명 · 출근 <em>${people.filter(done).length}</em>명</span>
      </span>
      <span class="m-today-people">
        ${
          people
            .map((e) => {
              const { start, end } = shiftFor(e, today);
              return `<span class="m-pp${done(e) ? " on" : ""}"><i style="background:${cssColor(e.color)}"></i>${nameLabel(e)}<small>${shortTime(start)}~${shortTime(end)}</small></span>`;
            })
            .join("") || `<span class="m-pp-empty">오늘 근무자가 없어요</span>`
        }
      </span>
    </button>`;
}

// 홈 화면에 추가 안내 (한 번 닫으면 다시 안 뜬다)
const INSTALL_HINT_KEY = "pum:installHintClosed";
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  if (!isDesktop()) requestRender();
});
function renderInstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let closed = false;
  try {
    closed = localStorage.getItem(INSTALL_HINT_KEY) === "1";
  } catch {}
  if (isDesktop() || standalone || closed) return "";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const how = installEvent
    ? "추가하면 앱처럼 바로 열 수 있어요."
    : ios
      ? "Safari 공유 버튼 → '홈 화면에 추가'를 누르면 앱처럼 쓸 수 있어요."
      : "브라우저 메뉴 → '홈 화면에 추가'를 누르면 앱처럼 쓸 수 있어요.";
  return `
    <div class="m-install">
      <span class="logo" aria-hidden="true">콕</span>
      <div><b>홈 화면에 추가하기</b><small>${how}</small></div>
      ${installEvent ? `<button type="button" class="pill" data-action="install-app">추가</button>` : ""}
      <button type="button" class="m-install-x" data-action="dismiss-install" aria-label="닫기">${ICON_CLOSE}</button>
    </div>`;
}

// ---------- 둘러보기(로그인 전): 보기만, 고치는 동작은 막는다 ----------
// 화면을 옮겨 다니고 펼쳐 보는 동작만 허용. 나머지(추가·수정·삭제·저장·내보내기)는 안내만 띄운다.
const DEMO_ALLOWED = new Set([
  "prev-month", "next-month", "close-panel", "go-home", "toggle-staff", "toggle-help",
  "payroll-prev", "payroll-next", "open-payslip", "close-payslip",
  "open-sheet", "close-sheet", "sched-day", "open-today", "install-app", "dismiss-install", "start-tour",
  "open-contract", "close-contract", "copy-resume-link", "pay-open", "pay-close", "pay-save", "pin-key", "pay-tab", "pay-step",
]);

let toastTimer = null;
// 다음 그리기에 알림을 띄운다 (처리 뒤에 어차피 다시 그리는 곳에서 사용)
function queueToast(text, kind = "ok") {
  if (kind === "ok") haptic(12);
  state.toast = text;
  state.toastKind = kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2200);
}
// 알림만 지운다. 화면 전체를 다시 그리면 입력 중인 칸이 비워지므로 render() 하지 않는다.
function hideToast() {
  state.toast = "";
  document.querySelector(".toast")?.remove();
}
function showToast(text, kind = "") {
  if (kind === "ok") haptic(12);
  state.toast = text;
  state.toastKind = kind;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2200);
}
const blockDemo = (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  showToast("둘러보기 중이에요. 로그인하면 쓸 수 있어요.");
};
// 보기만 바꾸는 입력칸 (급여 화면의 직원 선택)
const demoViewField = (t) => t.dataset?.payroll !== undefined;
// 둘러보기 화면인지 (로그인·매장 등록 화면은 막지 않는다)
const inDemo = (t) => demoLoaded && ADMIN_SITE && !t.closest?.(".lock-page");

// 둘러보기 화면을 그릴 때 입력칸은 읽기 전용, 선택칸은 비활성으로
function lockDemoFields() {
  if (!demoLoaded || !ADMIN_SITE || app.querySelector(".lock-page")) return;
  for (const f of app.querySelectorAll("input, textarea, select")) {
    if (demoViewField(f)) continue;
    if (f.tagName === "SELECT") f.disabled = true;
    else f.readOnly = true;
  }
}

app.addEventListener(
  "click",
  (e) => {
    if (!inDemo(e.target)) return;
    const el = e.target.closest("[data-action]");
    if (el && !DEMO_ALLOWED.has(el.dataset.action)) return blockDemo(e);
    if (e.target.closest('button[type="submit"]')) return blockDemo(e);
  },
  true,
);
// 읽기 전용 입력칸을 누르면 안내 (손가락으로 표를 밀어 스크롤하는 건 막지 않는다)
app.addEventListener(
  "focusin",
  (e) => {
    const t = e.target;
    if (!inDemo(t) || !t.matches?.("input, textarea") || demoViewField(t)) return;
    t.blur();
    showToast("둘러보기 중이에요. 로그인하면 쓸 수 있어요.");
  },
  true,
);
app.addEventListener("submit", (e) => inDemo(e.target) && blockDemo(e), true);

// 달력에서 근무 시간을 고칠 때 엔터 = 저장
app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || !["edit-start", "edit-end"].includes(e.target.id)) return;
  e.preventDefault();
  e.target.closest(".staff-action, .date-box, .day-area-inner")?.querySelector('[data-action="save-shift"]')?.click();
});

app.addEventListener("submit", (e) => {
  if (e.target.id === "login-form") {
    e.preventDefault();
    login();
    return;
  }
  if (e.target.id === "signup-form") {
    e.preventDefault();
    signup();
    return;
  }
  if (e.target.id === "store-form") {
    e.preventDefault();
    createStoreForm();
    return;
  }
  if (e.target.id === "pick-form") {
    e.preventDefault();
    pickStore();
    return;
  }
  if (e.target.id === "slot-form") {
    e.preventDefault();
    finishSlot();
    return;
  }
  if (e.target.id === "add-extra") {
    e.preventDefault();
    addExtra();
    return;
  }
  if (e.target.id !== "add-employee") return;
  e.preventDefault();
  const name = document.getElementById("f-name").value.trim();
  const phone = formatPhone(document.getElementById("f-phone").value);
  const hire = todayDateString(); // 입사일은 추가한 날 (근로계약서 시작일은 계약서에서 고친다)
  const wage = parseMoney(document.getElementById("f-wage").value);
  const manager = e.target.querySelector('input[name="f-role"]:checked')?.value === "manager";
  if (!name) return;
  const emp = {
    id: uid(),
    name,
    phone: phone || null,
    hourlyWage: wage || DEFAULT_WAGE,
    active: true,
    weekly: {},
    hireDate: hire,
    no: store.employees.reduce((max, x) => Math.max(max, x.no || 0), 0) + 1,
    ...(manager ? { role: "manager" } : {}),
  };
  store.employees.push(emp);
  if (manager) placeByRole(emp); // 매니저는 맨 위 (매니저가 여럿이면 그 아래)
  // 매니저는 월급제(4대보험)로 시작: 입력한 기본급·식대를 이번 달부터 (공제액은 나중에 급여 화면 명세서에서)
  if (manager) {
    store.salary = store.salary ?? {};
    store.salary[emp.id] = { on: true, hist: [] };
    const salary = parseMoney(document.getElementById("f-salary").value);
    const meal = parseMoney(document.getElementById("f-meal").value);
    if (salary || meal) setSalary(emp.id, todayDateString().slice(0, 7), { salary, meal, ded: null });
  }
  ensureColors();
  save();
  state.sheet = null;
  render();
  showToast(manager ? `${name}님을 매니저(월급제)로 추가했어요. 공제액은 급여 화면 명세서에서 입력해주세요` : `${name}님을 알바로 추가했어요`, "ok");
});

app.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "f-role") {
    const form = t.closest("form");
    const manager = t.value === "manager";
    form.querySelector(".f-wage-wrap").hidden = manager;
    form.querySelector("#f-wage").required = !manager;
    for (const el of form.querySelectorAll(".f-mgr-wrap")) el.hidden = !manager;
    form.querySelector("#f-salary").required = manager;
    form.querySelector(".f-mgr-note").hidden = !manager;
    return;
  }
  if (t.dataset.wage) {
    const emp = employeeById(t.dataset.wage);
    const wage = parseMoney(t.value);
    if (wage) {
      emp.hourlyWage = wage;
      save();
    }
    t.value = formatMoney(emp.hourlyWage);
    return;
  }
  if (t.dataset.weekly) {
    const emp = employeeById(t.dataset.id);
    const wd = t.dataset.weekly;
    if (!t.value.trim()) {
      setWeekly(emp, wd, null);
    } else {
      const range = parseRange(t.value);
      if (range) {
        setWeekly(emp, wd, range);
      } else {
        t.classList.add("invalid");
        setTimeout(() => t.classList.remove("invalid"), 1200);
      }
    }
    t.value = t.closest(".m-week") ? formatRange(emp.weekly[wd]) : rangeLabel(emp.weekly[wd]);
    return;
  }
  if (t.dataset.note !== undefined || t.dataset.meta) {
    if (keepMetaInput(t)) render();
    return;
  }
  if (state.contractDraft && (t.dataset.cf || t.dataset.cfday || t.dataset.cfbreak || t.dataset.cfins)) {
    state.error = "";
    updateContractDraft(t);
    state.contractDirty = true;
    render();
    return;
  }
  if (t.dataset.paymonth !== undefined && state.payView) {
    state.payView.ym[payTab()] = t.value;
    render();
    return;
  }
  if (t.dataset.biz) {
    store.settings = { ...store.settings, biz: { ...(store.settings?.biz ?? {}), [t.dataset.biz]: t.value.trim() } };
    save();
    return;
  }
  if (t.dataset.empdate) {
    const emp = employeeById(t.dataset.id);
    if (t.value) emp[t.dataset.empdate] = t.value;
    else delete emp[t.dataset.empdate];
    save();
    render();
    return;
  }
  if (t.dataset.sal) {
    const [k, sub] = t.dataset.sal.split(".");
    const v = t.value.replace(/\D/g, "") === "" ? null : parseMoney(t.value);
    if (sub) state.salDraft.ded[sub] = v;
    else state.salDraft[k] = v ?? 0;
    render();
    return;
  }
  if (t.dataset.allow) {
    const item = state.allowDraft[Number(t.dataset.index)];
    item[t.dataset.allow] = t.dataset.allow === "amount" ? parseMoney(t.value) : t.value.trim();
    render();
    return;
  }
  if (t.dataset.payroll) {
    state.payroll[t.dataset.payroll] = t.value;
    render();
    return;
  }
  if (t.dataset.setting) {
    store.settings = { ...store.settings, [t.dataset.setting]: t.value };
    save();
    render();
  }
});

// + 로 일정에 없던 인원을 그날 근무자로 등록. 처음 보는 이름이면 직원으로도 추가된다.
async function addExtra() {
  const name = document.getElementById("extra-name").value.trim();
  const start = readTime("extra-start");
  const end = readTime("extra-end");
  if (!name) return;
  if (!start || !end || start === end) {
    alertField(start === end ? "extra-end" : "extra-start");
    return;
  }
  let emp = store.employees.find((x) => x.active && x.name === name);
  // 오타로 직원이 새로 생기지 않게: 처음 보는 이름이면 한 번 묻는다
  if (!emp && !(await uiConfirm(`'${name}'님은 등록된 직원이 아니에요.\n새 직원으로 등록할까요?`, { ok: "등록" }))) return;
  if (!emp) {
    emp = { id: uid(), name, phone: null, hourlyWage: DEFAULT_WAGE, active: true, weekly: {} };
    store.employees.push(emp);
    ensureColors();
  }
  const date = activeDate();
  if (ADMIN_SITE && date < todayDateString()) setRecordTimes(emp.id, date, start, end);
  else setShift(emp.id, date, start, end);
  save();
  state.adding = false;
  state.expandedId = ADMIN_SITE ? null : emp.id; // 직원 화면: 바로 출근할 수 있게 펼쳐 둔다
  render();
}

function alertField(id) {
  const el = document.getElementById(id);
  el.classList.add("invalid");
  el.focus();
}

// 숫자만 남기고 두 자리 뒤에 ":" 를 자동으로 넣는다
app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.classList.contains("phone")) {
    t.value = formatPhone(t.value);
    return;
  }
  if (t.classList.contains("money")) {
    t.value = formatMoney(t.value);
    return;
  }
  if (!t.classList.contains("time")) return;
  t.classList.remove("invalid");
  const digits = t.value.replace(/\D/g, "").slice(0, 4);
  t.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
  // 시작 시간 4자리를 다 치면 종료 시간 칸으로 넘어간다
  const next = { "slot-start": "slot-end", "edit-start": "edit-end", "extra-start": "extra-end", "f-start": "f-end" }[t.id];
  if (next && digits.length === 4) {
    const el = document.getElementById(next);
    el?.focus();
    el?.select();
  }
});

// 화면이 넓어지면 모바일 날짜 페이지를 홈 패널로, 좁아지면 그 반대로 전환
window.matchMedia("(min-width: 768px)").addEventListener("change", (mq) => {
  const r = route();
  if (mq.matches && r.name === "day") {
    state.selectedDate = r.date;
    navigate(homeHash());
  } else if (!mq.matches && (r.name === "home" || r.name === "calendar") && state.selectedDate) {
    const date = state.selectedDate;
    state.selectedDate = null;
    navigate(`#/day/${date}`);
  } else if (ADMIN_SITE) {
    render(); // 관리자 화면은 휴대폰용 화면이 따로 있다
  }
});

render();

// 근무표 기간: 시작일만 받는다. 숫자만 입력해도 "2026.06.04 ~" 꼴로 맞춘다 (끝나는 날 없이 이날부터 계속)
function formatPeriod(digits) {
  const d = digits.slice(0, 8);
  const date = (s) => [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)].filter(Boolean).join(".");
  return d.length === 8 ? `${date(d)} ~` : date(d);
}

// 예전 형식("2026. 10. 5 ~ 11. 8", "2026.10.05 ~ 2026.11.08")은 고치기 시작할 때 시작일만 남긴다 ("2026.10.05 ~")
function normalizePeriod(text) {
  const [a] = text.split("~");
  if (!/\d/.test(a ?? "") || /^\d{4}\.\d{2}\.\d{2} ~$/.test(text)) return text;
  return `${scheduleStart(a).replaceAll("-", ".")} ~`;
}

function livePeriod(input, e) {
  let digits = input.value.replace(/\D/g, "");
  // 점이나 " ~ " 를 지웠을 때는 그 앞 숫자를 지운다 (안 그러면 다시 붙어서 안 지워짐)
  if (e.inputType?.startsWith("delete") && digits === (input.dataset.digits ?? "")) digits = digits.slice(0, -1);
  input.dataset.digits = digits;
  input.value = formatPeriod(digits);
  fitPeriod(input);
}

// 기간 입력칸 너비를 글자에 딱 맞춘다 (괄호와의 간격이 양쪽 같게)
var measureCtx; // var: 이 줄보다 먼저 실행되는 첫 render() 에서도 쓸 수 있게
function fitPeriod(input) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = getComputedStyle(input).font;
  input.style.width = `${Math.ceil(measureCtx.measureText(input.value || input.placeholder).width) + 2}px`;
}

// 근무표 편집 패널: 입력하는 대로 왼쪽 표에 반영
app.addEventListener("input", (e) => {
  if (e.target.id === "slot-start" || e.target.id === "slot-end") liveSlot();
  if (e.target.classList.contains("sc-period")) {
    livePeriod(e.target, e);
    state.periodTyped = true; // 저장 전에 시작 날짜를 직접 입력했는지
  }
});
// 근무표 기간·메모: 입력하는 대로 초안에 넣는다 (바뀐 게 있으면 true)
// 다시 그리지 않고 저장 버튼만 켠다 — 입력칸을 벗어날 때 다시 그리면 바로 누른 [저장]이 먹히지 않아서
function keepMetaInput(t) {
  const work = schedWork();
  const meta = structuredClone(work.meta ?? store.scheduleMeta ?? { notes: {} });
  const value = t.value.trim();
  if (t.dataset.meta) {
    if (meta[t.dataset.meta] === value && work.meta) return false;
    meta[t.dataset.meta] = value;
  } else {
    if ((meta.notes?.[t.dataset.note] ?? "") === value && work.meta) return false;
    meta.notes = { ...meta.notes, [t.dataset.note]: value };
  }
  work.meta = meta;
  for (const b of document.querySelectorAll('[data-action="schedule-save"]')) b.disabled = !hasDraft();
  for (const b of document.querySelectorAll('[data-action="schedule-temp"]')) b.disabled = !schedDirty();
  const status = document.getElementById("sched-status");
  if (status) status.innerHTML = renderSchedStatus();
  return true;
}
app.addEventListener("input", (e) => {
  if (e.target.classList.contains("sc-period") || e.target.dataset?.note !== undefined) keepMetaInput(e.target);
});
app.addEventListener("focusin", (e) => {
  if (!e.target.classList.contains("sc-period")) return;
  e.target.value = normalizePeriod(e.target.value);
  e.target.dataset.digits = e.target.value.replace(/\D/g, "");
  fitPeriod(e.target);
});
app.addEventListener("change", (e) => {
  if (e.target.id === "slot-emp") liveSlot();
});

// ---------- 온라인 저장소 (Firebase Realtime Database) ----------
// 같은 매장의 모든 기기가 같은 기록을 본다. 이 기기의 localStorage 는 빠르게 띄우기 위한 캐시일 뿐이다.
//   owners/{uid}            관리자 계정 → 매장 코드
//   stores/{코드}/meta      매장 이름·관리자 (누구나 읽기)
//   stores/{코드}/public/   누구나 읽기 — 직원 이름·근무 요일, 출근 기록, 날짜별 근무 시간 (달력에 필요한 것)
//   stores/{코드}/private/  그 매장 관리자만 — 전화번호·시급, 수당, 세금 설정, 근무표 기간·초안 등
// 항목마다 JSON 문자열로 저장해서, 바뀐 항목만 올리고 받는다. 규칙은 database.rules.json.

// MGC 근무와는 다른 Firebase 프로젝트를 쓴다 (가입한 다른 매장 계정이 MGC 데이터에 접근하지 못하게)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDT4umtAOHW8ZVl0J6QCNIBMHcEBsvGVvU",
  authDomain: "shift-calendar-e973e.firebaseapp.com",
  databaseURL: "https://shift-calendar-e973e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "shift-calendar-e973e",
  storageBucket: "shift-calendar-e973e.firebasestorage.app",
  messagingSenderId: "1039732498702",
  appId: "1:1039732498702:web:e31c9d2f3abb4140e9375f",
};

const storePath = (sub) => `stores/${storeId}/${sub}`;

var cloud = null; // { auth, db } — SDK 를 못 불러오면 이 기기에만 저장
var remote = { pub: null, priv: null, pubLoaded: false, privLoaded: false, last: {}, seedAsked: false };

const PUBLIC_EMP_KEYS = ["id", "name", "active", "role", "color", "weekly", "weeklyBase", "weeklyHistory", "no"];

// store → { "경로": "JSON 문자열" }
function flattenStore(withPrivate) {
  const out = {};
  const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
  for (const e of store.employees) {
    out[`public/employees/${e.id}`] = JSON.stringify(pick(e, PUBLIC_EMP_KEYS));
    if (withPrivate) out[`private/employees/${e.id}`] = JSON.stringify({ phone: e.phone ?? null, hourlyWage: e.hourlyWage ?? DEFAULT_WAGE, hireDate: e.hireDate ?? null, leaveDate: e.leaveDate ?? null });
  }
  out["public/order"] = JSON.stringify(store.employees.map((e) => e.id));
  if (ADMIN_SITE) out["public/absent"] = JSON.stringify(store.absent ?? {});
  for (const r of store.records) out[`public/records/${r.id}`] = JSON.stringify(r);
  for (const [date, byEmp] of Object.entries(store.shifts ?? {})) {
    if (Object.keys(byEmp ?? {}).length) out[`public/shifts/${date}`] = JSON.stringify(byEmp);
  }
  if (withPrivate) {
    const { scheduleMeta, settings, allowances, scheduleDraft, absent, salary } = store;
    out["private/main"] = JSON.stringify({ scheduleMeta, settings, allowances, scheduleDraft, absent, salary });
    // 근로계약서는 서명 그림이 들어가 크기가 커서 한 장씩 따로 (바뀐 계약서만 올라가게)
    for (const c of store.contracts ?? []) out[`private/contracts/${c.id}`] = JSON.stringify(c);
  }
  return out;
}

// 받은 데이터 → { "경로": "JSON 문자열" } (마지막으로 맞춰 둔 상태)
function flattenRemote() {
  const out = {};
  const walk = (prefix, obj) => {
    for (const [k, v] of Object.entries(obj ?? {})) out[`${prefix}/${k}`] = v;
  };
  const pub = remote.pub ?? {};
  walk("public/employees", pub.employees);
  walk("public/records", pub.records);
  walk("public/shifts", pub.shifts);
  if (pub.order) out["public/order"] = pub.order;
  if (pub.absent) out["public/absent"] = pub.absent;
  if (remote.privLoaded) {
    const priv = remote.priv ?? {};
    walk("private/employees", priv.employees);
    walk("private/contracts", priv.contracts);
    if (priv.main) out["private/main"] = priv.main;
  }
  return out;
}

// ---------- 받은 데이터 검사 ----------
// 직원용 달력은 로그인 없이 쓸 수 있어 누구나 데이터를 쓸 수 있다. 화면에 그대로 넣는 값(id·색·시간·날짜)은
// 정해진 모양만 받아들이고 나머지는 버린다 (관리자 화면에 코드가 끼어들거나 화면이 멈추지 않게).
function safeId(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}
function cssColor(v) {
  return typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|hsl\(\d{1,3} \d{1,3}% \d{1,3}%\))$/.test(v) ? v : "#ffffff";
}
function cleanRange(r) {
  const ok = (t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
  return r && ok(r.start) && ok(r.end) ? { start: r.start, end: r.end } : null;
}
function cleanWeekly(w) {
  const out = {};
  for (const [wd, r] of Object.entries(w && typeof w === "object" ? w : {})) {
    const range = /^[0-6]$/.test(wd) && cleanRange(r);
    if (range) out[wd] = range;
  }
  return out;
}
function safeDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
const safeIso = (v) => typeof v === "string" && v.length < 40 && !Number.isNaN(Date.parse(v));

function cleanStore(data) {
  const employees = (Array.isArray(data.employees) ? data.employees : [])
    .filter((e) => e && safeId(e.id) && typeof e.name === "string" && e.name.trim())
    .map((e) => ({
      ...e,
      name: e.name.slice(0, 40),
      ...(e.hireDate ? { hireDate: safeDate(e.hireDate) ? e.hireDate : null } : {}),
      ...(e.leaveDate ? { leaveDate: safeDate(e.leaveDate) ? e.leaveDate : null } : {}),
      color: e.color ? cssColor(e.color) : e.color,
      weekly: cleanWeekly(e.weekly),
      ...(e.weeklyBase ? { weeklyBase: cleanWeekly(e.weeklyBase) } : {}),
      ...(Array.isArray(e.weeklyHistory)
        ? { weeklyHistory: e.weeklyHistory.filter((h) => h && safeDate(h.from)).map((h) => ({ from: h.from, weekly: cleanWeekly(h.weekly) })) }
        : {}),
    }));
  let nextNo = employees.reduce((max, e) => (Number.isInteger(e.no) && e.no > max ? e.no : max), 0);
  for (const e of employees) if (!Number.isInteger(e.no) || e.no < 1) e.no = ++nextNo;
  const records = (Array.isArray(data.records) ? data.records : []).filter(
    (r) => r && safeId(r.id) && safeId(r.employeeId) && safeDate(r.date) && safeIso(r.clockIn) && (!r.clockOut || safeIso(r.clockOut)),
  );
  const shifts = {};
  for (const [date, byEmp] of Object.entries(data.shifts && typeof data.shifts === "object" ? data.shifts : {})) {
    if (!safeDate(date)) continue;
    const day = {};
    for (const [id, r] of Object.entries(byEmp && typeof byEmp === "object" ? byEmp : {})) {
      const range = safeId(id) && cleanRange(r);
      if (range) day[id] = range;
    }
    shifts[date] = day;
  }
  const absent = {};
  for (const [k, v] of Object.entries(data.absent && typeof data.absent === "object" ? data.absent : {})) {
    if (v && /^[A-Za-z0-9_-]{1,64}\|\d{4}-\d{2}-\d{2}$/.test(k)) absent[k] = true;
  }
  return { ...data, employees, records, shifts, absent, salary: cleanSalary(data.salary), contracts: cleanContracts(data.contracts) };
}

// 근로계약서: 서명 그림은 PNG data URL 만, 글자는 길이 제한
function cleanContracts(list) {
  const sign = (v) => (typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length < 300000 ? v : null);
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && safeId(c.id) && safeId(c.empId) && c.f && typeof c.f === "object")
    .map((c) => ({
      id: c.id,
      empId: c.empId,
      createdAt: safeIso(c.createdAt) ? c.createdAt : new Date().toISOString(),
      status: c.status === "signed" ? "signed" : "draft",
      signedAt: safeIso(c.signedAt) ? c.signedAt : null,
      f: JSON.parse(JSON.stringify(c.f, (k, v) => (typeof v === "string" ? v.slice(0, 300) : v))),
      empSign: sign(c.empSign),
      ownerSign: sign(c.ownerSign),
    }));
}

// 월급제 설정: { 직원id: { on, hist: [{ from: "YYYY-MM", salary, meal, ded: {국민연금…} | null }] } }
function cleanSalary(v) {
  const out = {};
  const money = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.round(Number(n)) : 0);
  for (const [id, x] of Object.entries(v && typeof v === "object" ? v : {})) {
    if (!safeId(id) || !x || typeof x !== "object") continue;
    const hist = (Array.isArray(x.hist) ? x.hist : [])
      .filter((h) => h && /^\d{4}-\d{2}$/.test(h.from))
      .map((h) => ({
        from: h.from,
        salary: money(h.salary),
        meal: money(h.meal),
        ded: h.ded && typeof h.ded === "object" ? Object.fromEntries(DED_KEYS.map(([k]) => [k, money(h.ded[k])])) : null,
      }))
      .sort((a, b) => (a.from < b.from ? -1 : 1));
    out[id] = { on: Boolean(x.on), hist };
  }
  return out;
}

function parse(json, fallback) {
  try {
    return JSON.parse(json) ?? fallback;
  } catch {
    return fallback;
  }
}

// 받은 데이터로 store 를 다시 만든다
function storeFromRemote() {
  const pub = remote.pub ?? {};
  const priv = remote.privLoaded ? (remote.priv ?? {}) : null;
  const order = parse(pub.order, []);
  const rank = (id) => (order.indexOf(id) < 0 ? 1e6 : order.indexOf(id));
  const employees = Object.values(pub.employees ?? {})
    .map((json) => parse(json, null))
    .filter(Boolean)
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((e) => {
      const p = priv ? parse(priv.employees?.[e.id], {}) : employeeById(e.id) ?? {};
      return { weekly: {}, ...e, phone: p.phone ?? null, hourlyWage: p.hourlyWage ?? DEFAULT_WAGE, hireDate: p.hireDate ?? null, leaveDate: p.leaveDate ?? null };
    });
  const main = priv ? parse(priv.main, {}) : store;
  return cleanStore({
    employees,
    records: Object.values(pub.records ?? {}).map((json) => parse(json, null)).filter(Boolean),
    shifts: Object.fromEntries(Object.entries(pub.shifts ?? {}).map(([d, json]) => [d, parse(json, {})])),
    scheduleMeta: main.scheduleMeta ?? store.scheduleMeta,
    settings: main.settings,
    allowances: main.allowances,
    salary: main.salary ?? store.salary,
    contracts: priv ? Object.values(priv.contracts ?? {}).map((json) => parse(json, null)).filter(Boolean) : store.contracts,
    scheduleDraft: main.scheduleDraft,
    absent: parse(pub.absent, null) ?? main.absent,
  });
}

const remoteHasData = () => Boolean(remote.pub?.employees);

// 바뀐 항목만 올린다
function pushChanges() {
  if (!cloud || !storeId || !remote.pubLoaded) return; // 처음 받기 전에는 올리지 않는다 (예전 캐시로 덮어쓰지 않게)
  const admin = isAdmin();
  if (!remoteHasData() && !admin) return; // 비어 있으면 매니저가 처음 올린다
  const withPrivate = admin && remote.privLoaded;
  const now = flattenStore(withPrivate);
  const updates = {};
  for (const [k, v] of Object.entries(now)) if (remote.last[k] !== v) updates[k] = v;
  for (const k of Object.keys(remote.last)) {
    if (!(k in now) && (withPrivate || !(k.startsWith("private/") || k === "public/absent"))) updates[k] = null;
  }
  if (!Object.keys(updates).length) return;
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete remote.last[k];
    else remote.last[k] = v;
  }
  const fail = (err) => console.warn("온라인 저장 실패", err);
  if (admin) cloud.db.ref(`stores/${storeId}`).update(updates).catch(fail);
  // 직원 화면은 항목마다 따로 (권한 없는 항목 하나 때문에 출근 기록까지 막히지 않게)
  else for (const [k, v] of Object.entries(updates)) cloud.db.ref(storePath(k)).set(v).catch(fail);
}

function applyRemote() {
  remote.last = flattenRemote();
  if (!remoteHasData()) {
    maybeSeed();
    return;
  }
  store = storeFromRemote();
  saveCache();
  requestRender();
}

// 아직 직원이 없는 매장: 받은 내용이 비어 있으면 이 기기의 내용(직원을 막 추가했다면 그것)을 그대로 둔다
function maybeSeed() {
  if (!isAdmin() || !remote.pubLoaded || !remote.privLoaded || remoteHasData() || remote.seedAsked) return;
  remote.seedAsked = true;
  if (store.employees.length) pushChanges();
}

// 다른 기기에서 바뀐 내용이 오면 다시 그린다. 입력 중이면 입력칸을 벗어난 뒤에.
function requestRender() {
  const el = document.activeElement;
  if (el && app.contains(el) && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
    state.renderPending = true;
    return;
  }
  state.renderPending = false;
  render();
}
app.addEventListener("focusout", () => {
  setTimeout(() => {
    if (state.renderPending) requestRender();
  });
});

let privRef = null;
function watchPrivate(on) {
  if (privRef) privRef.off();
  privRef = null;
  remote.priv = null;
  remote.privLoaded = false;
  if (!on) return;
  const sid = storeId;
  privRef = cloud.db.ref(storePath("private"));
  privRef.on(
    "value",
    (snap) => {
      if (sid !== storeId) return;
      const first = !remote.privLoaded;
      remote.priv = snap.val();
      remote.privLoaded = true;
      applyRemote();
      if (first) queueSlipPublish();
    },
    (err) => console.warn("매니저 데이터 읽기 실패", err),
  );
}

// 지금 매장(storeId)의 공개 데이터와 매장 이름을 받는다. 매장이 바뀌면 다시 연결한다.
let pubRef = null;
let metaRef = null;
function watchStore() {
  if (pubRef) pubRef.off();
  if (metaRef) metaRef.off();
  pubRef = metaRef = null;
  remote = { pub: null, priv: null, pubLoaded: false, privLoaded: false, last: {}, seedAsked: false };
  if (!cloud || !storeId) return;
  // 매장을 바꾼 뒤 늦게 도착한 이전 매장 데이터는 버린다 (다른 매장 데이터가 섞이지 않게)
  const sid = storeId;
  pubRef = cloud.db.ref(storePath("public"));
  pubRef.on(
    "value",
    (snap) => {
      if (sid !== storeId) return;
      remote.pub = snap.val();
      remote.pubLoaded = true;
      applyRemote();
      if (ADMIN_SITE) queueSlipPublish();
    },
    (err) => console.warn("온라인 데이터 읽기 실패", err),
  );
  metaRef = cloud.db.ref(storePath("meta/name"));
  metaRef.on(
    "value",
    (snap) => {
      if (sid !== storeId) return;
      state.storeName = snap.val() ?? "";
      document.title = ADMIN_SITE ? `${storeName()} · ${APP_NAME} 관리자` : `${storeName()} · ${APP_NAME}`;
      requestRender();
    },
    (err) => console.warn("매장 정보 읽기 실패", err),
  );
}

// 이 기기에서 쓸 매장을 바꾼다. admin 이면 그 매장의 관리자로 연다.
function openStore(code, admin = false) {
  const changed = code !== storeId || !pubRef || demoLoaded;
  if (code !== storeId || demoLoaded) {
    storeId = code;
    demoLoaded = false;
    store = loadStore();
    ensureColors();
    resetDayUi();
    state.selectedDate = null;
  }
  rememberStore(code);
  if (admin) state.adminStore = code;
  if (changed) watchStore();
  if (admin) watchPrivate(true);
}

// 관리자 사이트에서 로그아웃하면 다시 샘플 매장 둘러보기로
function enterDemo() {
  if (pubRef) pubRef.off();
  if (metaRef) metaRef.off();
  pubRef = metaRef = null;
  watchPrivate(false);
  remote = { pub: null, priv: null, pubLoaded: false, privLoaded: false, last: {}, seedAsked: false };
  state.adminStore = null;
  state.storeName = "";
  if (!demoLoaded) {
    demoLoaded = true;
    store = demoData();
    resetDayUi();
    state.selectedDate = null;
  }
  document.title = `${APP_NAME} 관리자`;
}

(function startCloud() {
  try {
    if (!FIREBASE_CONFIG) throw new Error("Firebase 설정 없음");
    if (!window.firebase) throw new Error("Firebase SDK 없음");
    firebase.initializeApp(FIREBASE_CONFIG);
    cloud = { auth: firebase.auth(), db: firebase.database() };
  } catch (err) {
    console.warn("온라인 저장소를 쓰지 못해 이 기기에만 저장합니다", err);
    state.authReady = true;
    render();
    return;
  }
  // 관리자 사이트는 로그인해서 내 매장을 열 때 연결한다 (그 전에는 샘플 매장)
  if (!ADMIN_SITE) watchStore();
  cloud.auth.onAuthStateChanged(async (user) => {
    state.authReady = true;
    if (!ADMIN_SITE) {
      render();
      return;
    }
    // 매장 등록 중에는 createStore 가 매장을 연다
    if (state.busy === "signup") return;
    if (!user) enterDemo();
    else {
      state.adminStore = null;
      watchPrivate(false);
      state.busy = "check";
      render();
      try {
        const code = (await cloud.db.ref(`owners/${user.uid}`).once("value")).val();
        if (code && cloud.auth.currentUser?.uid === user.uid) openStore(code, true);
      } catch (err) {
        console.warn("매장 정보를 읽지 못했어요", err);
      }
      if (state.busy === "check") state.busy = null;
    }
    render();
  });
})();
