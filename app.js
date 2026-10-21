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

// 새 매장 코드: 헷갈리는 글자(0/o, 1/l/i)를 뺀 6자리
function newStoreCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(6)), (n) => chars[n % chars.length]).join("");
}

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
          <button type="submit" class="btn-primary"${busy ? " disabled" : ""}>${busy ? "등록 중…" : "매장 등록"}</button>
          ${errorLine()}
        </form>
        <a class="lock-link" href="#/login">이미 등록했어요 · 로그인</a>
        ${BACK_TO_DEMO}
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
        <input id="pick-code" class="field" maxlength="12" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="매장 코드" aria-label="매장 코드" required />
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
      ${demoLoaded ? `<a class="logout login-btn" href="#/login">로그인</a>` : `<button type="button" class="logout" data-action="logout">로그아웃</button>`}
    </nav>
    ${demoLoaded ? `<p class="demo-bar">샘플 매장을 둘러보는 중이에요. 내 매장으로 쓰려면 <a href="#/signup">매장 등록</a> 또는 <a href="#/login">로그인</a>해주세요.</p>` : ""}
    <main class="admin-main${center ? " centered" : ""}${wide ? " wide" : ""}${state.pageEnter ? " page-enter" : ""}">${content}</main>
    ${toastHtml()}`;
}

// ? 버튼을 누르면 펼쳐지는 설명 (다른 화면에 갔다 오면 다시 접힘)
function helpToggle(key, html) {
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
        <td class="name"><span class="name-cell"><span class="swatch" style="background:${cssColor(e.color)}" title="근무표 색 (자동)"></span>${nameLabel(e)}</span><div class="muted small">${esc(e.phone ? formatPhone(e.phone) : "")}</div></td>
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
          `<button type="button" class="status${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}" title="매니저는 근무표에만 나오고 출근에서 빠져요 (월급제로 하면 급여에 나와요)">${isManager(e) ? "매니저" : "알바"}</button>`
        }</td>
        <td><button type="button" class="danger" data-action="remove-employee" data-id="${e.id}">삭제</button></td>
      </tr>`,
    )
    .join("");

  return renderAdminShell(
    "employees",
    `
    <form class="toolbar" id="add-employee" style="margin-bottom:32px">
      <div><label for="f-name">이름</label><input id="f-name" class="field" style="width:112px" placeholder="홍길동" required /></div>
      <div><label for="f-phone">전화번호 (선택)</label><input id="f-phone" class="field phone" style="width:144px" type="text" inputmode="numeric" placeholder="010-0000-0000" /></div>
      <div><label for="f-wage">시급(원)</label><input id="f-wage" class="field money" style="width:112px" type="text" inputmode="numeric" value="${formatMoney(DEFAULT_WAGE)}" required /></div>
      <button type="submit" class="pill">추가</button>
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
      <b>월급으로</b>를 누르면 월급제(4대보험) 직원이 돼요. 월급·식대·공제액은 급여 화면에서 이름 옆 <b>명세서</b>를 눌러 입력해요.`,
    )}`,
    { center: true },
  );
}

// 직원용 달력으로 가는 버튼 (새 탭)
const staffCalLink = (cls = "") =>
  `<a${cls ? ` class="${cls}"` : ""} href="${esc(staffUrl())}" target="_blank" rel="noopener" title="매장 코드 ${storeId} · 이 주소를 매장 기기에서 열어주세요">직원용 달력 ↗</a>`;

// 직원용 달력 주소: 매장 기기에서 한 번 열면 그 기기가 매장을 기억한다
const staffUrl = () => new URL(`../?s=${storeId}`, location.href).href;
function renderStaffLink() {
  return `
    <div class="staff-link">
      <div>
        <p class="staff-link-title">직원용 달력 · 매장 코드 <b>${storeId}</b></p>
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
      ${demoLoaded ? `<a class="m-login" href="#/login">로그인</a>` : `<button type="button" class="m-logout" data-action="logout">로그아웃</button>`}
    </header>
    ${demoLoaded ? `<p class="demo-bar">샘플 매장을 둘러보는 중이에요. <a href="#/signup">매장 등록</a> · <a href="#/login">로그인</a></p>` : ""}
    ${renderInstallHint()}
    <main class="m-main${state.pageEnter ? " page-enter" : ""}">${content}</main>
    <nav class="m-tabbar" aria-label="관리자 메뉴">
      ${tab("employees", "직원")}${tab("schedule", "근무표")}${tab("calendar", "달력")}${tab("records", "급여")}
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
            <div><b>직원용 달력</b><small>매장 코드 ${storeId}</small></div>
            <button type="button" class="pill" data-action="copy-staff-link">주소 복사</button>
          </div>`
    }
    <div class="m-list">${list || `<p class="m-empty">아직 직원이 없어요.<br />오른쪽 위 <b>+ 추가</b>로 등록해주세요.</p>`}</div>`,
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
    </div>
    <p class="sheet-note">매니저는 근무표에만 나오고 출근에서 빠져요. 월급제로 하면 출근 기록이 없어도 급여에 나와요.</p>
    <div class="sheet-actions">
      <button type="button" class="btn-ghost danger-ghost" data-action="remove-employee" data-id="${e.id}">삭제</button>
      <button type="button" class="btn-primary" data-action="close-sheet">완료</button>
    </div>`;
}

function renderAddEmpSheet() {
  return `
    <div class="sheet-head"><div><h2>직원 추가</h2></div></div>
    <form id="add-employee" class="m-form">
      <label class="sheet-label" for="f-name">이름</label>
      <input id="f-name" class="field" placeholder="홍길동" required autocomplete="off" />
      <label class="sheet-label" for="f-phone">전화번호 (선택)</label>
      <input id="f-phone" class="field phone" type="text" inputmode="numeric" placeholder="010-0000-0000" />
      <label class="sheet-label" for="f-wage">시급(원)</label>
      <input id="f-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(DEFAULT_WAGE)}" required />
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
    </div>
    <div class="m-list">${cards || `<p class="m-empty">이 달의 근무 기록이 없어요.</p>`}</div>
    <details class="m-fold">
      <summary>날짜별 근무 시간 표</summary>
      ${renderTimesheet(month, "")}
    </details>
    <div class="m-btns">
      <button type="button" class="btn-ghost" data-action="save-xlsx-template" title="매장 엑셀 양식(\"N월 근로현황\" 시트가 있는 파일)을 골라 이 브라우저에 저장해요">엑셀 양식 저장</button>
      <button type="button" class="btn-ghost" data-action="fill-template-xlsx"${recs.length ? "" : " disabled"} title="저장한 엑셀 양식에 이 달 근무·급여를 채운 새 파일을 받아요">엑셀로 옮기기</button>
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


// ---------- 월급제 직원 (4대보험) ----------
// 월급·식대·공제액은 세무사에게 받은 금액을 한 번 입력하면 그달부터 다음 달, 그다음 달에도 그대로 이어진다.
// 금액이 바뀐 달에만 새로 입력하면 그달부터 새 금액. 지난달 명세서는 그때 금액 그대로.
const DED_KEYS = [["pension", "국민연금"], ["health", "건강보험"], ["care", "장기요양보험"], ["employ", "고용보험"], ["income", "근로소득세"], ["local", "지방소득세"]];
const isSalaried = (emp) => Boolean(emp && store.salary?.[emp.id]?.on);

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

  return `
    <div class="payslip">
      <header class="ps-top">
        <span class="ps-brand">급여명세서</span>
        <span class="ps-month">${y}년 ${m}월</span>
      </header>
      <h1 class="ps-name">${esc(r.emp.name)} 님</h1>
      <p class="ps-meta">${r.salaried ? "월급제" : `시급 ${won(r.emp.hourlyWage)}`} · 근무 ${r.days}일 · 총 ${Number(r.hours.toFixed(2))}시간</p>

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

      <footer class="ps-foot">
        <p class="ps-thanks">이번 한 달도 수고 많으셨어요. 감사합니다.</p>
        <p class="ps-store">${esc(storeName())}</p>
        <p class="ps-issued">발행일 ${issued}</p>
      </footer>
    </div>`;
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
        <button type="button" class="pill plain-dark" data-action="save-xlsx-template" title="매장 엑셀 양식(\"N월 근로현황\" 시트가 있는 파일)을 골라 이 브라우저에 저장해요">엑셀 양식 저장</button>
        <button type="button" class="pill plain-dark" data-action="fill-template-xlsx"${recs.length ? "" : " disabled"} title="저장한 엑셀 양식에 이 달 근무·급여를 채운 새 파일을 받아요">엑셀로 옮기기</button>
        <button type="button" class="pill" data-action="export-ledger"${rows.length ? "" : " disabled"} title="세무사에게 보내는 급여대장 (알바·직원·날짜별 근무시간·주휴수당 내역)">급여대장 받기</button>
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
  fflate: { src: "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", ready: () => window.fflate },
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

// ---------- 엑셀: 매장 양식 저장 · 엑셀로 옮기기 ----------
// 매장마다 처음 한 번 고른 기본양식(빈 엑셀, "N월 근로현황" 시트가 있는 양식)에 이 달 근무시간·수당·근무표를 채워 새 파일로 저장한다 (Chrome/Edge PC 전용).

// days[i]가 속한 주(일~토, 월 경계는 안 넘음)의 [시작 인덱스, 끝 인덱스] 목록
function weekDayIndexRanges(days) {
  const ranges = [];
  let i = 0;
  while (i < days.length) {
    const toSat = (6 - weekdayOf(days[i]) + 7) % 7;
    const end = Math.min(i + toSat, days.length - 1);
    ranges.push([i, end]);
    i = end + 1;
  }
  return ranges;
}

function idbHandle(mode, key, value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("pum-fs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction("handles", mode);
      const store = tx.objectStore("handles");
      const op = mode === "readwrite" ? store.put(value, key) : store.get(key);
      op.onsuccess = () => resolve(op.result);
      op.onerror = () => reject(op.error);
    };
  });
}

// 매장 엑셀 양식: [엑셀 양식 저장]으로 고른 파일 내용을 이 브라우저(IndexedDB)에 매장별로 보관한다
const templateKey = () => `xlsxTemplate:${storeId}`;

function pickXlsxFile() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    input.addEventListener("change", () => resolve(input.files[0] ?? null));
    input.click();
  });
}

function saveXlsxTemplate(button) {
  return withBusy(button, "저장 중…", async () => {
    const file = await pickXlsxFile();
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fflate = await loadLib("fflate");
    let wb;
    try {
      wb = fflate.strFromU8(fflate.unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" })["xl/workbook.xml"]);
    } catch {
      throw new Error("엑셀(.xlsx) 파일이 아니에요. 엑셀 양식 파일을 골라주세요.");
    }
    if (!/<sheet name="(\d+|○)월 근로현황"/.test(wb)) throw new Error('이 파일에는 "N월 근로현황" 시트가 없어요. 매장 엑셀 양식 파일을 골라주세요.');
    await idbHandle("readwrite", templateKey(), { name: file.name, bytes, savedAt: new Date().toISOString() });
    showToast(`엑셀 양식을 저장했어요 (${file.name})`, "ok");
  });
}

// 엑셀 파일(zip) 안에서 날짜 칸의 <v>만 바꿔치기한다 (SheetJS로 전체를 다시 조립하면 서식이 깨지거나
// 용량이 크게 불어나는 경우가 있어서, 건드릴 칸만 문자열로 직접 패치하고 나머지는 원본 그대로 둔다).

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function colToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}
function indexToCol(n) {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function splitCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return { col: colToIndex(m[1]), row: Number(m[2]) };
}
function excelSerialToIso(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function decodeXmlText(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
// 칸의 글자 내용을 꺼낸다 (t="s"는 공유 문자열 색인, t="str"/"inlineStr"는 수식이 돌려준 글자 자체)
function cellText(cell, strings) {
  if (!cell) return null;
  if (cell.type === "s") return strings[Number(cell.raw)];
  if ((cell.type === "str" || cell.type === "inlineStr") && cell.raw != null) return decodeXmlText(cell.raw);
  return null;
}
function parseSharedStrings(xml) {
  const out = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(decodeXmlText(text));
  }
  return out;
}

// <row>들을 {r, startIndex, endIndex, inner} 목록으로 쪼갠다
function parseRows(xml) {
  const rows = [];
  for (const m of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    rows.push({ r: Number(m[1]), inner: m[2], start: m.index, end: m.index + m[0].length, innerStart: m.index + m[0].indexOf(">") + 1 });
  }
  return rows;
}
// 행 안의 <c>들을 {ref, col, type, raw} 목록으로 쪼갠다
function parseCells(rowInner) {
  const cells = [];
  for (const m of rowInner.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const tMatch = m[3].match(/\st="(\w+)"/);
    const vMatch = (m[4] || "").match(/<v>([\s\S]*?)<\/v>/);
    cells.push({ ref: m[1] + m[2], col: colToIndex(m[1]), type: tMatch ? tMatch[1] : null, raw: vMatch ? vMatch[1] : null, start: m.index, end: m.index + m[0].length, attrs: m[3] });
  }
  return cells;
}

// 시트 전체에서 글자가 label과 정확히 같은 칸을 찾는다 (헤더 위치 찾기용)
function findLabelCell(rowsWithCells, strings, label) {
  for (const row of rowsWithCells) {
    for (const c of row.cells) {
      if (cellText(c, strings) === label) return { row: row.r, col: c.col };
    }
  }
  return null;
}

// row.inner 안에서 ref 칸을 새 값(숫자)으로 바꾸거나(value!=null) 비운다(value==null). 칸이 없으면 알맞은 위치에 새로 끼워 넣는다.
function patchCell(rowInner, cells, ref, col, value) {
  const existing = cells.find((c) => c.ref === ref);
  const newXml = value == null ? `<c r="${ref}"${existing ? existing.attrs.replace(/\st="\w+"/, "") : ""}/>` : `<c r="${ref}"${existing ? existing.attrs.replace(/\st="\w+"/, "") : ""}><v>${value}</v></c>`;
  if (existing) return rowInner.slice(0, existing.start) + newXml + rowInner.slice(existing.end);
  if (value == null) return rowInner; // 원래 없던 칸이면 비울 것도 없음
  const next = cells.find((c) => c.col > col);
  const at = next ? next.start : rowInner.length;
  return rowInner.slice(0, at) + newXml + rowInner.slice(at);
}

function xmlEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const styleOf = (cell) => cell?.attrs.match(/\ss="(\d+)"/)?.[1];

// 칸을 통째로 새로 쓴다: v(값, t="s"면 공유 문자열 번호) 또는 f(수식). 둘 다 없으면 서식만 남긴 빈칸.
function putCell(rowInner, cells, ref, col, { v = null, t = null, f = null } = {}) {
  const existing = cells.find((c) => c.ref === ref);
  const attrs = existing ? existing.attrs.replace(/\st="\w+"/, "") : "";
  const tAttr = t ? ` t="${t}"` : "";
  const xml = f != null ? `<c r="${ref}"${attrs}${tAttr}><f>${xmlEsc(f)}</f></c>` : v != null ? `<c r="${ref}"${attrs}${tAttr}><v>${v}</v></c>` : `<c r="${ref}"${attrs}/>`;
  if (existing) return rowInner.slice(0, existing.start) + xml + rowInner.slice(existing.end);
  if (v == null && f == null) return rowInner;
  const next = cells.find((c) => c.col > col);
  const at = next ? next.start : rowInner.length;
  return rowInner.slice(0, at) + xml + rowInner.slice(at);
}

// 시트의 행마다 fn(row, api)를 불러 고친다. 뒤 행부터 고쳐서 앞 행들의 위치가 안 틀어지게 한다.
function editSheetRows(xml, fn) {
  const rows = parseRows(xml).map((row) => ({ ...row, cells: parseCells(row.inner) }));
  for (const row of [...rows].sort((a, b) => b.r - a.r)) {
    let inner = row.inner;
    let cells = row.cells;
    const cellAt = (col) => cells.find((c) => c.col === col);
    const api = {
      cellAt,
      hasF: (col) => { const c = cellAt(col); return Boolean(c && inner.slice(c.start, c.end).includes("<f")); },
      put: (col, opts) => { inner = putCell(inner, cells, indexToCol(col) + row.r, col, opts); cells = parseCells(inner); },
      restyle: (col, s) => {
        const c = cellAt(col);
        if (!c) return;
        const cx = inner.slice(c.start, c.end);
        const nx = /\ss="\d+"/.test(c.attrs) ? cx.replace(/^(<c\b[^>]*?)\ss="\d+"/, `$1 s="${s}"`) : cx.replace(/^<c r="([A-Z]+\d+)"/, `<c r="$1" s="${s}"`);
        inner = inner.slice(0, c.start) + nx + inner.slice(c.end);
        cells = parseCells(inner);
      },
    };
    fn(row, api);
    if (inner !== row.inner) xml = xml.slice(0, row.innerStart) + inner + xml.slice(row.innerStart + row.inner.length);
  }
  return xml;
}

// 공유 수식에서 원본 칸(ref가 있는 칸)이 사라진 참조 수 — 하나라도 있으면 엑셀이 파일을 못 연다
function orphanSharedRefs(xml) {
  const masters = new Set();
  const kids = [];
  for (const m of xml.matchAll(/<f\b([^>]*?)\/?>/g)) {
    const a = attrsOf(m[1]);
    if (a.t !== "shared") continue;
    if (a.ref) masters.add(a.si);
    else kids.push(a.si);
  }
  return kids.filter((si) => !masters.has(si)).length;
}

function assertWorkbookIntact(fflate, zip) {
  for (const name of Object.keys(zip)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name) && orphanSharedRefs(fflate.strFromU8(zip[name]))) {
      throw new Error("엑셀 파일 구조가 예상과 달라서 저장을 멈췄어요. 원본 파일은 그대로예요.");
    }
  }
}

function sharedStringIndex(sst, text) {
  let i = sst.strings.indexOf(text);
  if (i >= 0) return i;
  i = sst.strings.length;
  sst.strings.push(text);
  sst.xml = sst.xml.replace("</sst>", `<si><t>${xmlEsc(text)}</t></si></sst>`).replace(/uniqueCount="\d+"/, `uniqueCount="${sst.strings.length}"`);
  return i;
}

const isSerialCell = (c) => !c.type && c.raw && Number(c.raw) > 30000 && Number(c.raw) < 60000;
const serialOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};

// 날짜 열(firstCol부터 31칸)에서 양식 달의 주말/평일 서식을 보고, 새 달의 주말 위치에 맞게 서식을 바꾼다
// 날짜 열(firstCol부터 31칸)의 색칠을 새 달에 맞게 옮긴다. 양식에 어느 달 날짜가 있든 상관없이
// 줄마다 가장 많이 쓴 서식 = 안 칠한 칸, 두 번째로 많이 쓴 서식(4칸 이상) = 칠한 칸으로 본다.
// shaded(i)가 참인 칸을 칠한다. 첫 칸 테두리처럼 둘 다 아닌 특별 서식은 그대로 둔다.
function restyleDayColumns(xml, firstCol, shaded) {
  return editSheetRows(xml, (row, api) => {
    const count = {};
    for (let i = 0; i < 31; i++) {
      const s = styleOf(api.cellAt(firstCol + i));
      if (s) count[s] = (count[s] || 0) + 1;
    }
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
    if (ranked.length < 2 || ranked[1][1] < 4) return;
    const [plain, marked] = [ranked[0][0], ranked[1][0]];
    for (let i = 0; i < 31; i++) {
      const s = styleOf(api.cellAt(firstCol + i));
      if (s !== plain && s !== marked) continue;
      const want = shaded(i) ? marked : plain;
      if (s !== want) api.restyle(firstCol + i, want);
    }
  });
}
// 근로현황: 토·일 칸을 칠함
const restyleWeekends = (xml, firstCol, days) => restyleDayColumns(xml, firstCol, (i) => Boolean(days[i]) && [0, 6].includes(weekdayOf(days[i])));
// 알바(사업소득): 주휴수당 주(일~토) 구간을 한 주 걸러 칠함 (2·4·6째 주)
const restyleWeekBands = (xml, firstCol, days) => {
  const segs = weekDayIndexRanges(days);
  return restyleDayColumns(xml, firstCol, (i) => segs.findIndex(([s, e]) => i >= s && i <= e) % 2 === 1);
};

// 기본양식(다른 달 기준)을 이 달에 맞게 바꾼다: 근로현황 시트 이름·수식 참조, 날짜·요일, 주말 서식,
// 알바(사업소득)의 요일·날짜 번호·주휴수당 주 구간 수식, "N월" 표시 글자
function adaptWorkbookMonth(fflate, zip, month) {
  const dec = (name) => fflate.strFromU8(zip[name]);
  let wbXml = dec("xl/workbook.xml");
  // 양식의 달은 숫자("9월 근로현황")거나, 달을 비워둔 양식이면 "○"("○월 근로현황")
  const found = wbXml.match(/<sheet name="(\d+|○)월 근로현황"/);
  if (!found || !zip["xl/sharedStrings.xml"]) throw new Error('기본양식에서 "N월 근로현황" 시트를 찾지 못했어요. 기본양식 파일을 다시 골라주세요.');
  const oldM = found[1] === "○" ? "○" : Number(found[1]);
  const newM = Number(month.slice(5, 7));
  const oldName = `${oldM}월 근로현황`;
  const newName = `${newM}월 근로현황`;
  const days = monthDays(month);
  const rels = dec("xl/_rels/workbook.xml.rels");
  const pathOf = (name) => {
    const tag = wbXml.match(new RegExp(`<sheet name="${escRe(name)}"[^>]*r:id="(rId\\d+)"`));
    return tag ? "xl/" + rels.match(new RegExp(`<Relationship Id="${tag[1]}"[^>]*Target="([^"]+)"`))[1] : null;
  };
  const rootPath = pathOf(oldName);
  const albaPath = pathOf("알바(사업소득)");
  const sst = { xml: dec("xl/sharedStrings.xml") };
  sst.strings = parseSharedStrings(sst.xml);

  if (oldM !== newM) {
    const swap = (s) => s.split(`'${oldName}'!`).join(`'${newName}'!`).split(`&apos;${oldName}&apos;!`).join(`&apos;${newName}&apos;!`);
    wbXml = swap(wbXml).replace(`<sheet name="${oldName}"`, `<sheet name="${newName}"`);
    zip["xl/workbook.xml"] = fflate.strToU8(wbXml);
    for (const name of Object.keys(zip)) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) zip[name] = fflate.strToU8(swap(dec(name)));
    if (zip["docProps/app.xml"]) zip["docProps/app.xml"] = fflate.strToU8(dec("docProps/app.xml").split(`>${oldName}<`).join(`>${newName}<`));
    // "9월", "[9월 급여명세서(정미진)]" 같은 글자 속 달 표시 (앞이 숫자인 "19월" 같은 건 제외)
    const monthToken = new RegExp(`(^|[^0-9])${escRe(String(oldM))}월`, "g");
    sst.xml = sst.xml.replace(/<si>([\s\S]*?)<\/si>/g, (all, inner) => {
      const text = decodeXmlText([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      if (!new RegExp(monthToken.source).test(text)) return all;
      return `<si><t xml:space="preserve">${xmlEsc(text.replace(monthToken, `$1${newM}월`))}</t></si>`;
    });
    sst.strings = parseSharedStrings(sst.xml);
  }
  const weekdayIdx = WEEKDAYS.map((w) => sharedStringIndex(sst, w));

  // 근로현황: 날짜 행과 바로 아래 요일 행. 날짜가 들어 있으면 엑셀 날짜 숫자가 가장 많은 행,
  // 날짜를 비워둔 양식이면 "구분" 머리글이 있는 행에서 같은 서식이 28칸 이상 이어지는 구간을 날짜 칸으로 본다.
  let rootXml = dec(rootPath);
  const rootRows = parseRows(rootXml).map((row) => ({ ...row, cells: parseCells(row.inner) }));
  let dateRow = null;
  let firstCol = null;
  let best = 0;
  for (const row of rootRows.slice(0, 10)) {
    const n = row.cells.filter(isSerialCell).length;
    if (n > best) { best = n; dateRow = row; }
  }
  if (dateRow) firstCol = Math.min(...dateRow.cells.filter(isSerialCell).map((c) => c.col));
  else {
    const label = findLabelCell(rootRows, sst.strings, "구분");
    dateRow = label && rootRows.find((row) => row.r === label.row);
    const cells = (dateRow?.cells ?? []).filter((c) => c.col > label.col).sort((a, b) => a.col - b.col);
    for (let i = 0; i < cells.length; ) {
      let j = i;
      while (j + 1 < cells.length && cells[j + 1].col === cells[j].col + 1 && styleOf(cells[j + 1]) === styleOf(cells[i])) j++;
      if (j - i + 1 >= 28) { firstCol = cells[i].col; break; }
      i = j + 1;
    }
  }
  if (!dateRow || firstCol == null) throw new Error("기본양식의 근로현황 시트에서 날짜 칸을 찾지 못했어요.");
  rootXml = restyleWeekends(rootXml, firstCol, days);
  rootXml = editSheetRows(rootXml, (row, api) => {
    if (row.r === dateRow.r) for (let i = 0; i < 31; i++) api.put(firstCol + i, days[i] ? { v: serialOf(days[i]) } : {});
    if (row.r === dateRow.r + 1) for (let i = 0; i < 31; i++) api.put(firstCol + i, days[i] ? { v: weekdayIdx[weekdayOf(days[i])], t: "s" } : {});
  });
  zip[rootPath] = fflate.strToU8(rootXml);

  // 알바(사업소득): 성명 행의 요일, 그 아래 날짜 번호, 주휴수당 1~5주 수식
  if (albaPath) {
    let x = dec(albaPath);
    const rows = parseRows(x).map((row) => ({ ...row, cells: parseCells(row.inner) }));
    const nameHdr = findLabelCell(rows, sst.strings, "성명");
    const wageHdr = findLabelCell(rows, sst.strings, "시급");
    const weekHdr = findLabelCell(rows, sst.strings, "주휴수당");
    if (nameHdr) {
      const first = nameHdr.col + 1;
      const segs = weekDayIndexRanges(days);
      x = restyleWeekBands(x, first, days);
      x = editSheetRows(x, (row, api) => {
        if (row.r === nameHdr.row) for (let i = 0; i < 31; i++) api.put(first + i, days[i] ? { v: weekdayIdx[weekdayOf(days[i])], t: "s" } : {});
        if (row.r === nameHdr.row + 1) for (let i = 0; i < 31; i++) api.put(first + i, days[i] ? { v: i + 1 } : {});
        if (weekHdr && wageHdr && row.r > weekHdr.row && api.hasF(weekHdr.col)) {
          const wage = indexToCol(wageHdr.col) + row.r;
          const term = ([s, e]) => {
            const a = indexToCol(first + s) + row.r;
            const b = indexToCol(first + e) + row.r;
            return `ROUNDUP(IF(SUM(${a}:${b})>=15,${wage}*8*SUM(${a}:${b})/40,0),-1)`;
          };
          // 칸은 5개(1~5주). 주가 6개로 나뉘는 달은 마지막 칸에 남은 주를 합친다
          for (let k = 0; k < 5; k++) {
            const mine = k < 4 ? segs.slice(k, k + 1) : segs.slice(4);
            api.put(weekHdr.col + k, mine.length ? { f: mine.map(term).join("+") } : { v: 0 });
          }
        }
      });
      zip[albaPath] = fflate.strToU8(x);
    }
  }
  zip["xl/sharedStrings.xml"] = fflate.strToU8(sst.xml);
}

// 근무시간표 달력의 마지막 주(L줄)를 하나 더 복제해 붙인다. 원래 마지막 주는 가운데 주 서식으로 바꾸고,
// 아래 굵은 테두리 같은 마지막 주 서식은 새로 붙인 주가 갖는다. 인쇄 범위도 같이 늘린다.
function addScheduleWeek(xml, wbXml, sheetName, lastStart, L, labelCol) {
  const before = parseRows(xml);
  const byR = Object.fromEntries(before.map((row) => [row.r, row]));
  const openTag = (row) => xml.slice(row.start, row.innerStart);
  const clones = [];
  for (let k = 0; k < L; k++) {
    const row = byR[lastStart + k];
    if (!row) continue;
    const cells = parseCells(row.inner)
      .map((c) => {
        const ref = `${indexToCol(c.col)}${row.r + L}`;
        // 오전/오후/마감 같은 왼쪽 이름표는 그대로, 나머지는 서식만
        if (c.col === labelCol) return row.inner.slice(c.start, c.end).replace(/^<c r="[A-Z]+\d+"/, `<c r="${ref}"`);
        return `<c r="${ref}"${c.attrs.replace(/\st="\w+"/, "")}/>`;
      })
      .join("");
    clones.push(`${openTag(row).replace(/<row r="\d+"/, `<row r="${row.r + L}"`)}${cells}</row>`);
  }
  const middleOpen = {};
  for (let k = 0; k < L; k++) if (byR[lastStart - L + k]) middleOpen[lastStart + k] = openTag(byR[lastStart - L + k]).replace(/<row r="\d+"/, `<row r="${lastStart + k}"`);
  xml = editSheetRows(xml, (row, api) => {
    if (row.r < lastStart || row.r >= lastStart + L) return;
    const mid = byR[row.r - L];
    if (!mid) return;
    for (const c of parseCells(mid.inner)) {
      const s = styleOf(c);
      if (s && api.cellAt(c.col)) api.restyle(c.col, s);
    }
  });
  for (const [r, tag] of Object.entries(middleOpen)) xml = xml.replace(new RegExp(`<row r="${r}"[^>]*>`), tag);
  const lastRow = parseRows(xml).find((row) => row.r === lastStart + L - 1);
  xml = xml.slice(0, lastRow.end) + clones.join("") + xml.slice(lastRow.end);
  xml = xml.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"/, (_, a, b, n) => `<dimension ref="${a}:${b}${Number(n) + L}"`);
  wbXml = wbXml.replace(new RegExp(`(<definedName name="_xlnm\\.Print_Area"[^>]*>'?${escRe(sheetName)}'?!\\$[A-Z]+\\$\\d+:\\$[A-Z]+\\$)(\\d+)`), (_, head, n) => head + (Number(n) + L));
  return { xml, wbXml };
}

// "N월 근무시간표" 달력 시트(Sheet1)를 앱 근무표로 채운다: 날짜, 그리고 날마다 오전/오후/마감 칸에
// "이름 시작-끝"(예: 김예은 7-15, 이시헌 15-22.5). 한 칸 줄 수보다 사람이 많으면 마지막 줄에 " / "로 붙인다.
function fillScheduleSheet(fflate, zip, month) {
  const dec = (name) => fflate.strFromU8(zip[name]);
  const sst = { xml: dec("xl/sharedStrings.xml") };
  sst.strings = parseSharedStrings(sst.xml);
  const titleIdx = sst.strings.findIndex((s) => /^(\d+|○)월 근무시간표$/.test(s));
  if (titleIdx < 0) return;
  let wbXml = dec("xl/workbook.xml");
  const rels = dec("xl/_rels/workbook.xml.rels");
  let path = null;
  let sheetName = null;
  for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const p = "xl/" + rels.match(new RegExp(`<Relationship Id="${m[2]}"[^>]*Target="([^"]+)"`))[1];
    if (new RegExp(`<c r="[A-Z]+\\d+"[^>]*t="s"[^>]*><v>${titleIdx}</v>`).test(dec(p))) {
      path = p;
      sheetName = m[1];
      break;
    }
  }
  if (!path) return;

  let xml = dec(path);
  const text = (c) => cellText(c, sst.strings);
  const scan = () => parseRows(xml).map((row) => ({ ...row, cells: parseCells(row.inner) }));
  let rows = scan();
  let hdr = null; // 일~토 머리글
  for (const row of rows) {
    const sun = row.cells.find((c) => text(c) === "일");
    if (sun && ["월", "화", "수", "목", "금", "토"].every((w, i) => text(row.cells.find((c) => c.col === sun.col + i + 1)) === w)) {
      hdr = { r: row.r, col: sun.col };
      break;
    }
  }
  if (!hdr) return;
  const labelCol = hdr.col - 1;
  // 주마다 날짜 줄은 왼쪽 이름표가 비어 있고, 바로 다음 줄에 첫 칸 이름표(오전)가 있는 줄 (날짜를 비워둔 양식이어도 찾을 수 있게)
  const labelOf = (r) => text(rows.find((row) => row.r === r)?.cells.find((c) => c.col === labelCol))?.trim();
  const firstLabel = rows.filter((row) => row.r > hdr.r).map((row) => labelOf(row.r)).find(Boolean);
  let dateRows = rows.filter((row) => row.r > hdr.r && !labelOf(row.r) && firstLabel && labelOf(row.r + 1) === firstLabel).map((row) => row.r);
  if (dateRows.length < 2) return;
  const L = dateRows[1] - dateRows[0];

  const days = monthDays(month);
  const offset = weekdayOf(days[0]);
  const weeks = Math.ceil((offset + days.length) / 7);
  while (dateRows.length < weeks) {
    ({ xml, wbXml } = addScheduleWeek(xml, wbXml, sheetName, dateRows.at(-1), L, labelCol));
    rows = scan();
    dateRows = [...dateRows, dateRows.at(-1) + L];
  }

  // 첫 주 칸을 보고 오전/오후/마감이 각각 몇째 줄인지 알아낸다
  const byR = Object.fromEntries(rows.map((row) => [row.r, row]));
  const cats = [];
  for (let k = 1; k < L; k++) {
    const label = text(byR[dateRows[0] + k]?.cells.find((c) => c.col === labelCol));
    if (label) cats.push({ name: label.trim(), lines: [k] });
    else if (cats.length) cats.at(-1).lines.push(k);
  }
  const hourOf = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h + m / 60;
  };
  const catOf = (start) => (hourOf(start) < 12 ? "오전" : hourOf(start) < 17 ? "오후" : "마감");
  const entries = (date, cat) =>
    scheduledOn(date)
      .map((e) => ({ e, s: shiftFor(e, date) }))
      .filter(({ s }) => catOf(s.start) === cat)
      .map(({ e, s }) => `${e.name} ${+hourOf(s.start).toFixed(2)}-${+hourOf(s.end).toFixed(2)}`);

  const title = `${Number(month.slice(5, 7))}월 근무시간표`;
  xml = editSheetRows(xml, (row, api) => {
    for (const c of row.cells) if (c.type === "s" && Number(c.raw) === titleIdx) api.put(c.col, { v: sharedStringIndex(sst, title), t: "s" });
    const w = dateRows.findIndex((r) => row.r >= r && row.r < r + L);
    if (w < 0) return;
    const k = row.r - dateRows[w];
    const cat = cats.find((x) => x.lines.includes(k));
    for (let d = 0; d < 7; d++) {
      const col = hdr.col + d;
      const n = w * 7 + d - offset + 1;
      const date = n >= 1 && n <= days.length ? days[n - 1] : null;
      if (k === 0) {
        api.put(col, date ? { v: n } : {});
        continue;
      }
      if (!cat) continue;
      const list = date ? entries(date, cat.name) : [];
      const line = cat.lines.indexOf(k);
      const value = line === cat.lines.length - 1 ? list.slice(line).join(" / ") : list[line];
      api.put(col, value ? { v: sharedStringIndex(sst, value), t: "s" } : {});
    }
  });
  zip[path] = fflate.strToU8(xml);
  zip["xl/workbook.xml"] = fflate.strToU8(wbXml);
  zip["xl/sharedStrings.xml"] = fflate.strToU8(sst.xml);
}

// 풀어놓은 기본양식(zip)을 이 달에 맞게 바꾸고, 근무표·근무시간·수당을 채운다.
function fillWorkbook(fflate, zip, month, employeeId) {
    const ts = timesheet(month, employeeId);
    if (!ts.rows.length) throw new Error("이 달에는 입력할 근무 기록이 없어요.");
    const dec = (name) => fflate.strFromU8(zip[name]);
    adaptWorkbookMonth(fflate, zip, month);
    fillScheduleSheet(fflate, zip, month);

    // 바깥에서 셀 값만 고쳐 넣으면 엑셀이 캐시된 수식 결과를 그대로 보여줄 수 있어서,
    // 다음에 열 때 전체를 다시 계산하도록 표시해둔다.
    let workbookXml = dec("xl/workbook.xml");
    workbookXml = /<calcPr\b[^>]*fullCalcOnLoad=/.test(workbookXml)
      ? workbookXml
      : /<calcPr\b[^>]*\/>/.test(workbookXml)
        ? workbookXml.replace(/<calcPr\b([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
        : workbookXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
    zip["xl/workbook.xml"] = fflate.strToU8(workbookXml);

    // 수식을 값으로 바꾸는 칸이 생기면 calcChain(계산 순서표)이 없는 수식을 가리켜 엑셀이 "복구"를 띄운다.
    // 지워두면 엑셀이 열 때 다시 만든다.
    if (zip["xl/calcChain.xml"]) {
      delete zip["xl/calcChain.xml"];
      zip["[Content_Types].xml"] = fflate.strToU8(dec("[Content_Types].xml").replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
      zip["xl/_rels/workbook.xml.rels"] = fflate.strToU8(dec("xl/_rels/workbook.xml.rels").replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, ""));
    }

    const sheetName = `${Number(month.slice(5, 7))}월 근로현황`;
    const sheetTag = workbookXml.match(new RegExp(`<sheet name="${escRe(sheetName)}"[^>]*r:id="(rId\\d+)"`));
    if (!sheetTag) throw new Error(`선택한 파일에서 "${sheetName}" 시트를 찾지 못했어요. 이 달 파일이 맞는지 확인해주세요.`);
    const relTag = dec("xl/_rels/workbook.xml.rels").match(new RegExp(`<Relationship Id="${sheetTag[1]}"[^>]*Target="([^"]+)"`));
    const sheetPath = "xl/" + relTag[1];
    const sheetXml = dec(sheetPath);
    const strings = zip["xl/sharedStrings.xml"] ? parseSharedStrings(dec("xl/sharedStrings.xml")) : [];

    const rows = parseRows(sheetXml);
    const rowsWithCells = rows.map((row) => ({ ...row, cells: parseCells(row.inner) }));

    // 날짜(엑셀 serial) 숫자 칸이 가장 많은 행을 "날짜 행"으로 본다
    let dateRow = null, bestCount = 0;
    for (const row of rowsWithCells.slice(0, 10)) {
      const count = row.cells.filter((c) => !c.type && c.raw && Number(c.raw) > 30000 && Number(c.raw) < 60000).length;
      if (count > bestCount) { bestCount = count; dateRow = row; }
    }
    if (!dateRow) throw new Error("시트에서 날짜가 적힌 행을 찾지 못했어요.");

    const colToDate = {};
    for (const c of dateRow.cells) {
      if (c.type || !c.raw) continue;
      const serial = Number(c.raw);
      if (serial > 30000 && serial < 60000) colToDate[c.col] = excelSerialToIso(serial);
    }
    const firstDateCol = Math.min(...Object.keys(colToDate).map(Number));
    const colForDate = Object.fromEntries(Object.entries(colToDate).map(([c, d]) => [d, Number(c)]));

    // 날짜 행 바로 아래부터 행 번호가 끊기지 않고 이어지는 구간만 "직원 표"로 본다.
    // 이 시트는 그 아래에 다른 표(날짜별 급여 등)가 또 있어서, 거기까지 다 긁으면
    // 이름이 겹쳐서 엉뚱한 표에도 값을 써버릴 수 있다.
    const sortedBelow = rowsWithCells.filter((r) => r.r > dateRow.r).sort((a, b) => a.r - b.r);
    const dataRows = [];
    for (let expectR = dateRow.r + 1, i = 0; i < sortedBelow.length && sortedBelow[i].r === expectR; i++, expectR++) {
      dataRows.push(sortedBelow[i]);
    }

    // 이름 열: 날짜 열보다 왼쪽에서 글자 칸이 가장 많은 열
    const strCountByCol = {};
    for (const row of dataRows) for (const c of row.cells) if (c.col < firstDateCol && cellText(c, strings) != null) strCountByCol[c.col] = (strCountByCol[c.col] || 0) + 1;
    const nameCol = Number(Object.entries(strCountByCol).sort((a, b) => b[1] - a[1])[0]?.[0]);
    if (!Number.isFinite(nameCol)) throw new Error("시트에서 이름이 적힌 열을 찾지 못했어요.");

    // 매니저는 출퇴근·급여에서 빠지지만 근로현황 줄은 채운다: 앱 근무표의 그날 일정 시간으로.
    // 엑셀 표기는 "매니져"일 수 있어서, 이름이 같거나 "매니저/매니져"인 줄을 매니저 줄로 본다.
    const managers = store.employees.filter((e) => e.active && isManager(e));
    const managerRow = (name) => {
      const emp = managers.find((e) => e.name === name) ?? (/^매니[저져]$/.test((name || "").trim()) ? managers[0] : null);
      return emp ? { emp, cells: ts.days.map((d) => plannedOn(emp, d)) } : null;
    };

    let patched = sheetXml;
    const notFound = [];
    // 뒤에서부터 바꿔야 앞쪽 바뀐 내용이 뒤쪽 인덱스를 틀어지게 만들지 않는다
    for (const row of [...dataRows].sort((a, b) => b.r - a.r)) {
      const nameCell = row.cells.find((c) => c.col === nameCol);
      const name = cellText(nameCell, strings);
      const empRow = managerRow(name) ?? ts.rows.find((r) => r.emp.name === name);
      if (!name || !empRow) continue;
      let inner = row.inner;
      let cells = row.cells;
      ts.days.forEach((date, i) => {
        const col = colForDate[date];
        if (col === undefined) return;
        const ref = indexToCol(col) + row.r;
        // 수식이 든 칸은 건드리지 않는다 (공유 수식의 원본 칸을 덮어쓰면 같은 수식을 쓰던 칸들이 깨져 파일이 안 열림)
        const target = cells.find((c) => c.ref === ref);
        if (target && inner.slice(target.start, target.end).includes("<f")) return;
        // 매니저(역할이 매니저거나 이름이 매니저/매니져)는 근무일이면 항상 8시간으로 적는다
        const manager = isManager(empRow.emp) || /^매니[저져]$/.test(empRow.emp.name.trim());
        const hours = manager && empRow.cells[i] > 0 ? 8 : Math.round(empRow.cells[i] * 100) / 100;
        inner = patchCell(inner, cells, ref, col, hours > 0 ? hours : null);
        cells = parseCells(inner); // 다음 칸을 위해 인덱스 다시 계산
      });
      patched = patched.slice(0, row.innerStart) + inner + patched.slice(row.innerStart + row.inner.length);
    }
    for (const empRow of ts.rows) {
      if (isManager(empRow.emp)) continue;
      if (!dataRows.some((row) => cellText(row.cells.find((c) => c.col === nameCol), strings) === empRow.emp.name)) {
        notFound.push(empRow.emp.name);
      }
    }

    zip[sheetPath] = fflate.strToU8(patched);

    // "알바(사업소득)" 시트가 있으면 수당도 넣는다: 이름이 "교육수당"인 수당은 교육수당 칸,
    // 나머지 이름의 수당은 전부 합쳐서 특근수당 칸. 급여액·주휴수당은 시트 안 수식이 계산한다.
    const albaTag = workbookXml.match(/<sheet name="알바\(사업소득\)"[^>]*r:id="(rId\d+)"/);
    if (albaTag) {
      const albaRel = dec("xl/_rels/workbook.xml.rels").match(new RegExp(`<Relationship Id="${albaTag[1]}"[^>]*Target="([^"]+)"`));
      const albaPath = "xl/" + albaRel[1];
      const albaXml = dec(albaPath);
      const albaRows = parseRows(albaXml).map((row) => ({ ...row, cells: parseCells(row.inner) }));
      const nameHdr = findLabelCell(albaRows, strings, "성명");
      const eduHdr = findLabelCell(albaRows, strings, "교육수당");
      const otHdr = findLabelCell(albaRows, strings, "특근수당");
      if (nameHdr && (eduHdr || otHdr)) {
        const headerRow = Math.max(nameHdr.row, eduHdr?.row ?? 0, otHdr?.row ?? 0);
        const albaDataRows = albaRows.filter((r) => r.r > headerRow);
        const payroll = payrollFor(month, employeeId);
        const hasFormula = (row, col) => {
          const c = row.cells.find((x) => x.col === col);
          return Boolean(c && row.inner.slice(c.start, c.end).includes("<f"));
        };
        let albaPatched = albaXml;
        for (const row of [...albaDataRows].sort((a, b) => b.r - a.r)) {
          const name = cellText(row.cells.find((c) => c.col === nameHdr.col), strings);
          const empPayroll = name ? payroll.rows.find((r) => r.emp.name === name) : null;
          const sumBy = (pick) => (empPayroll ? empPayroll.allowances.filter(pick).reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0);
          const edu = sumBy((a) => (a.name || "").trim() === "교육수당");
          const ot = sumBy((a) => (a.name || "").trim() !== "교육수당");
          let inner = row.inner;
          let cells = row.cells;
          const write = (hdr, value) => {
            inner = patchCell(inner, cells, indexToCol(hdr.col) + row.r, hdr.col, value > 0 ? value : null);
            cells = parseCells(inner);
          };
          // 수당 칸에 원래 있던 수식(공유 수식)은 한 칸만 지우면 같은 수식을 쓰던 칸들이 깨지므로,
          // 수식이 든 칸은 직원이 매칭되지 않아도 전부 앱 값(없으면 빈칸)으로 바꾼다.
          if (eduHdr && (empPayroll || hasFormula(row, eduHdr.col))) write(eduHdr, edu);
          if (otHdr && (empPayroll || hasFormula(row, otHdr.col))) write(otHdr, ot);
          if (inner !== row.inner) albaPatched = albaPatched.slice(0, row.innerStart) + inner + albaPatched.slice(row.innerStart + row.inner.length);
        }
        zip[albaPath] = fflate.strToU8(albaPatched);
      }
    }

    return { notFound };
}

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

// 엑셀로 옮기기: 저장해 둔 매장 양식은 그대로 두고, 이 달 값을 채운 새 파일을 만든다
function fillTemplateXlsx(button) {
  return withBusy(button, "만드는 중…", async () => {
    const fflate = await loadLib("fflate");
    const { month } = state.payroll;
    const template = await idbHandle("readonly", templateKey()).catch(() => null);
    if (!template?.bytes) {
      uiAlert("먼저 [엑셀 양식 저장]으로 매장 엑셀 양식 파일을 저장해주세요.");
      return;
    }
    const zip = fflate.unzipSync(new Uint8Array(template.bytes));
    let notFound;
    try {
      ({ notFound } = fillWorkbook(fflate, zip, month, ""));
    } catch (err) {
      if (/기본양식/.test(err.message)) throw new Error("저장한 엑셀 양식을 읽지 못했어요. [엑셀 양식 저장]으로 양식을 다시 저장해주세요.");
      throw err;
    }
    assertWorkbookIntact(fflate, zip);
    const saved = await saveXlsxBytes(fflate.zipSync(zip, { level: 6 }), `${storeName()} ${Number(month.slice(5, 7))}월 근무.xlsx`);
    if (!saved) return;
    if (notFound.length) uiAlert(`저장했어요. 다만 "${notFound.join(", ")}" 이름은 엑셀 양식에 줄이 없어서 빠졌어요.\n양식에 그 직원 줄을 추가하고 [엑셀 양식 저장]을 다시 해주세요.`);
    showToast("엑셀 양식에 이 달 값을 옮겨 저장했어요", "ok");
  });
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
    const memo = (r) => r.allowances.filter((a) => a.name && Number(a.amount)).map((a) => `${a.name} ${Number(a.amount).toLocaleString()}`).join(", ");

    // 1. 알바 (3.3%)
    const taxNote = store.settings?.tax === "none" ? "세금 공제 안 함" : "세금 3.3% (소득세 3% + 지방소득세 0.3%)";
    const ws1 = sheet(
      `${store_} ${y}년 ${m}월 급여대장 · 알바`,
      `기간 ${period}   ·   ${taxNote}   ·   작성일 ${made}`,
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
      `기간 ${period}   ·   공제액은 세무사 금액을 앱에 입력한 값   ·   작성일 ${made}`,
      ["이름", "근무일수", "근무시간", "기본급(월급)", "식대(비과세)", "기타수당", "지급총액(세전)", ...DED_KEYS.map(([, l]) => l), "공제합계", "실지급액(세후)", "비고"],
      salaried.length
        ? [
            ...salaried.map((r) => [
              cell(r.emp.name, st.name), cell(r.days, st.num), cell(Number(r.hours.toFixed(2)), st.dec),
              cell(r.base, st.num), cell(r.meal, st.num), cell(r.extra, st.num), cell(r.gross, st.num),
              ...DED_KEYS.map(([k]) => (r.ded ? cell(r.ded[k], st.num) : cell("", st.text))),
              r.ded ? cell(r.dedTotal, st.num) : cell("", st.text),
              r.ded ? cell(r.net, st.net) : cell("", st.text),
              r.ded ? cell([r.setFrom ? `${Number(r.setFrom.slice(5, 7))}월부터 같은 금액` : "", memo(r)].filter(Boolean).join(" · "), st.text) : cell("공제액 입력 필요 (세무사 계산)", st.note),
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
    const saved = await saveXlsxBytes(new Uint8Array(bytes), `${store_} ${m}월 급여대장.xlsx`);
    if (!saved) return;
    const pending = salaried.filter((r) => !r.ded).map((r) => r.emp.name);
    if (pending.length) uiAlert(`저장했어요. 다만 ${pending.join(", ")}님은 공제액이 아직 없어서 세후 금액이 비어 있어요.\n세무사 금액을 명세서에 입력하면 채워져요.`);
    else showToast("급여대장을 저장했어요", "ok");
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
  const span = (last - first) * 60;
  const pct = (min) => `${(((min - first * 60) / span) * 100).toFixed(3)}%`;
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const step = compact ? 2 : 1; // 휴대폰은 2시간마다 글자
  // 컴퓨터: 근무 입력칸은 누른 요일 바로 아래에 (휴대폰은 아래에서 올라오는 창)
  const inlineEdit = Boolean(ed) && !wide && isDesktop();

  const axis = [...hours, last]
    .map((h, i) => (i % step ? "" : `<span style="left:${pct(h * 60)}">${h % 24}${compact ? "" : share ? "시" : ":00"}</span>`))
    .join("");
  const lines = hours.slice(1).map((h) => `<i style="left:${pct(h * 60)}"></i>`).join("");
  const rows = days
    .map(({ wd, items, lanes }) => {
      // 빈 곳을 누르면 그 시각으로 추가
      const slots = hours
        .map((hh) => `<div class="tl-slot" data-action="edit-slot" data-wd="${wd}" data-start="${(hh % 24) * 60}" aria-label="${WEEKDAYS[wd]}요일 ${hh % 24}시 근무자 추가"></div>`)
        .join("");
      const bars = items
        .map((it) => {
          const bg = cssColor(it.e.color);
          const editing = ed && String(ed.wd) === String(wd) && (ed.empId ?? ed.addEmpId) === it.e.id;
          const tight = (it.end - it.start) / span < (compact ? 0.2 : 0.14); // 짧은 근무는 이름만
          return `
            <div class="tl-bar${editing ? " sc-editing" : ""}" role="button" tabindex="0" data-action="edit-slot" data-wd="${wd}" data-id="${it.e.id}" data-start="${it.start}"
              style="left:${pct(it.start)};width:${pct(it.end - it.start + first * 60)};top:calc(var(--lh) * ${it.lane});--c:${bg};color:${textOn(bg)}" title="${esc(it.e.name)} ${it.r.start}~${it.r.end}">
              <b>${esc(it.e.name)}</b>${compact || tight ? "" : `<small>${it.r.start}~${it.r.end}</small>`}
            </div>`;
        })
        .join("");
      return `
        <div class="tl-row${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}">
          <div class="tl-day"><b>${WEEKDAYS[wd]}</b></div>
          <div class="tl-track" style="--lanes:${lanes}"><div class="tl-lines">${lines}</div><div class="tl-slots">${slots}</div>${bars}</div>
        </div>${inlineEdit && String(ed.wd) === String(wd) ? `<div class="tl-edit" id="tl-edit" data-html2canvas-ignore>${renderSlotPanel()}</div>` : ""}`;
    })
    .join("");
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
      <div class="tl${compact ? " compact" : ""}">
        <div class="tl-axis"><div></div><div class="tl-hours">${axis}</div></div>
        ${rows}
      </div>
      ${compact ? actions : ""}
      <p class="sc-brand">${esc(storeName())} · ${todayDateString().replaceAll("-", ".")} 출력 · 콕</p>
    </div>`;
}

function schedHelp() {
  return helpToggle(
    "schedule",
    `근무 막대를 누르면 수정·삭제, 빈 곳을 누르면 그 시각에 근무자를 추가해요. ${isDesktop() ? "옆에서" : "아래에서"} 입력하면 표에 바로 보여요.<br />
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

// ---------- 라우팅 ----------

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  if (ADMIN_SITE && !isAdmin()) {
    // 로그인 화면 / 로그인은 했는데 매장이 없거나 확인 중 → 로그인 화면, 그 외에는 샘플 매장 둘러보기
    if (!state.authReady || hash === "/login" || hash === "/signup" || cloud?.auth.currentUser) return { name: "lock" };
  } else if (!storeId) return { name: "pick" };
  const day = hash.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (day) return { name: "day", date: day[1] };
  if (!ADMIN_SITE) return { name: "home" };
  const page = { "/records": "records", "/schedule": "schedule", "/calendar": "calendar" }[hash];
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
  state.error = "";
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener("hashchange", () => {
  state.pageEnter = true;
  state.sheet = null;
  resetDayUi();
  state.payslipId = null;
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
  const code = document.getElementById("pick-code").value.trim().toLowerCase();
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
    case "toggle-staff":
      state.error = "";
      state.editingId = null;
      state.expandedId = state.expandedId === id ? null : id;
      state.expandEnter = Boolean(state.expandedId);
      break;
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
      const rec = (store.salary[emp.id] = store.salary[emp.id] ?? { on: false, hist: [] });
      rec.on = !rec.on;
      save();
      queueToast(rec.on ? `${emp.name}님을 월급제(4대보험)로 바꿨어요. 급여 화면 명세서에서 월급을 입력해주세요` : `${emp.name}님을 시급제(3.3%)로 바꿨어요`);
      break;
    }
    case "toggle-role": {
      const emp = employeeById(id);
      emp.role = isManager(emp) ? undefined : "manager";
      if (!isManager(emp)) emp.color = null;
      ensureColors();
      save();
      queueToast(`${emp.name}님을 ${isManager(emp) ? "매니저로" : "알바로"} 바꿨어요`);
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
    case "copy-staff-link":
      navigator.clipboard?.writeText(staffUrl()).then(
        () => showToast("직원용 달력 주소를 복사했어요", "ok"),
        () => showToast("복사하지 못했어요. 주소를 길게 눌러 복사해주세요."),
      );
      return;
    case "fill-template-xlsx":
      fillTemplateXlsx(el);
      return;
    case "export-ledger":
      exportLedger(el);
      return;
    case "save-xlsx-template":
      saveXlsxTemplate(el);
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
      state.sheet = null; // 휴대폰: 급여 시트에서 명세서 창으로 넘어간다
      state.modalEnter = true;
      state.payslipId = id;
      state.allowDraft = structuredClone(allowancesFor(state.payroll.month, id));
      {
        const cur = salaryFor(id, state.payroll.month);
        state.salDraft = isSalaried(employeeById(id))
          ? { salary: cur?.salary ?? 0, meal: cur?.meal ?? 0, ded: Object.fromEntries(DED_KEYS.map(([k]) => [k, cur?.ded ? cur.ded[k] : null])) }
          : null;
      }
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
  "open-sheet", "close-sheet", "sched-day", "open-today", "install-app", "dismiss-install",
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
  const wage = parseMoney(document.getElementById("f-wage").value);
  if (!name) return;
  store.employees.push({
    id: uid(),
    name,
    phone: phone || null,
    hourlyWage: wage || DEFAULT_WAGE,
    active: true,
    weekly: {},
  });
  ensureColors();
  save();
  state.sheet = null;
  render();
  showToast(`${name}님을 추가했어요`, "ok");
});

app.addEventListener("change", (e) => {
  const t = e.target;
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

const PUBLIC_EMP_KEYS = ["id", "name", "active", "role", "color", "weekly", "weeklyBase", "weeklyHistory"];

// store → { "경로": "JSON 문자열" }
function flattenStore(withPrivate) {
  const out = {};
  const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
  for (const e of store.employees) {
    out[`public/employees/${e.id}`] = JSON.stringify(pick(e, PUBLIC_EMP_KEYS));
    if (withPrivate) out[`private/employees/${e.id}`] = JSON.stringify({ phone: e.phone ?? null, hourlyWage: e.hourlyWage ?? DEFAULT_WAGE });
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
const safeDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const safeIso = (v) => typeof v === "string" && v.length < 40 && !Number.isNaN(Date.parse(v));

function cleanStore(data) {
  const employees = (Array.isArray(data.employees) ? data.employees : [])
    .filter((e) => e && safeId(e.id) && typeof e.name === "string" && e.name.trim())
    .map((e) => ({
      ...e,
      name: e.name.slice(0, 40),
      color: e.color ? cssColor(e.color) : e.color,
      weekly: cleanWeekly(e.weekly),
      ...(e.weeklyBase ? { weeklyBase: cleanWeekly(e.weeklyBase) } : {}),
      ...(Array.isArray(e.weeklyHistory)
        ? { weeklyHistory: e.weeklyHistory.filter((h) => h && safeDate(h.from)).map((h) => ({ from: h.from, weekly: cleanWeekly(h.weekly) })) }
        : {}),
    }));
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
  return { ...data, employees, records, shifts, absent, salary: cleanSalary(data.salary) };
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
      return { weekly: {}, ...e, phone: p.phone ?? null, hourlyWage: p.hourlyWage ?? DEFAULT_WAGE };
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
      remote.priv = snap.val();
      remote.privLoaded = true;
      applyRemote();
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
