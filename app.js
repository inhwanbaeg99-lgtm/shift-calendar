// 품 (근무 달력) — 여러 매장이 각자 매장을 등록해서 쓰는 버전 (GitHub Pages + Firebase)
// 매장마다 데이터는 Firebase 의 stores/{매장 코드}/ 아래에 따로 저장되고, 이 브라우저의 localStorage 는 캐시로만 쓴다.

const TIME_ZONE = "Asia/Seoul";
const APP_NAME = "품";
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
const DEMO_NAME = "샘플 매장";
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
    .filter((e) => e.active && !isManager(e) && (weeklyOn(e, date)[wd] || extra[e.id]) && !store.absent?.[`${e.id}|${date}`])
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
      <span class="logo big" aria-hidden="true">품</span>
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
          <input id="login-password" class="field" type="password" minlength="6" autocomplete="new-password" placeholder="비밀번호 (6자 이상)" aria-label="비밀번호" required />
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
        <input id="login-password" class="field" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호" required />
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
        <span class="logo big" aria-hidden="true">품</span>
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
          return `<span class="chip">${esc(emp.name)} <span class="chip-time${diff}">${formatTime(r.clockIn)}~${formatTime(r.clockOut)}</span></span>`;
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
            <span class="in-name">${esc(employeeById(r.employeeId).name)}</span>
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
        <span class="staff-name">${esc(emp.name)}</span>
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
  return renderAdminShell("calendar", `${isDesktop() ? "" : mHead("달력")}<div class="admin-cal">${renderCalendarCard()}</div>`, { center: true, wide: true });
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
        <td class="name"><span class="name-cell"><span class="swatch" style="background:${cssColor(e.color)}" title="근무표 색 (자동)"></span>${esc(e.name)}</span><div class="muted small">${esc(e.phone ? formatPhone(e.phone) : "")}</div></td>
        ${order
          .map(
            (wd) =>
              `<td class="day-cell${wd === 0 ? " rest" : ""}" data-label="${WEEKDAYS[wd]}"><input class="field range" type="text" placeholder="-" value="${rangeLabel(e.weekly[wd])}" data-weekly="${wd}" data-id="${e.id}" aria-label="${esc(e.name)} ${WEEKDAYS[wd]}요일 근무 시간" /></td>`,
          )
          .join("")}
        <td class="wage-cell" data-label="시급"><input class="field money" style="width:88px;padding:4px 8px" type="text" inputmode="numeric" value="${formatMoney(e.hourlyWage)}" data-wage="${e.id}" aria-label="${esc(e.name)} 시급" /></td>
        <td><button type="button" class="status${e.active ? " on" : ""}" data-action="toggle-active" data-id="${e.id}">${e.active ? "재직중" : "비활성"}</button></td>
        <td><button type="button" class="status${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}" title="매니저는 근무표에만 나오고 출근·급여 계산에서 빠져요">${isManager(e) ? "매니저" : "알바"}</button></td>
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
        <thead><tr><th>이름</th>${order.map((wd) => `<th class="${wd === 0 ? "rest" : ""}">${WEEKDAYS[wd]}</th>`).join("")}<th>시급</th><th>상태</th><th>구분</th><th>관리</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="12" class="empty">등록된 직원이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
    ${helpToggle(
      "employees",
      `요일 칸에 <b>7-12</b>, <b>18-2230</b> 처럼 입력하면 근무 시간이 저장돼요. 비우면 쉬는 날이에요.<br />
      이름 앞 색은 근무표 색이에요(자동으로 겹치지 않게 정해져요). 근무표에서 같은 시각에 시작하면 위에 있는 사람이 왼쪽 칸에 들어가요.`,
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
    <label class="sheet-label" for="m-wage">시급</label>
    <div class="m-wage"><input id="m-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(e.hourlyWage)}" data-wage="${e.id}" aria-label="${esc(e.name)} 시급" /><span>원</span></div>
    <div class="m-toggles">
      <button type="button" class="m-toggle${e.active ? " on" : ""}" data-action="toggle-active" data-id="${e.id}">${e.active ? "재직중" : "비활성"}</button>
      <button type="button" class="m-toggle${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}">${isManager(e) ? "매니저" : "알바"}</button>
    </div>
    <p class="sheet-note">매니저는 근무표에만 나오고 출근·급여 계산에서 빠져요.</p>
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
      <input class="sc-period" value="${esc(meta.period ?? "")}" data-meta="period" inputmode="numeric" placeholder="2026.06.04 ~ 2026.07.05" aria-label="기간" />
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
      <button type="button" class="btn-ghost" data-action="schedule-pdf">PDF</button>
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
        <span class="m-pay-net net">${won(r.net)}</span>
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
      <button type="button" class="btn-ghost" data-action="export-xlsx"${recs.length ? "" : " disabled"}>엑셀 다운로드</button>
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
    <div class="m-hero small"><small>받을 금액</small><strong>${won(r.net)}</strong></div>
    <ul class="m-lines">
      ${line("기본급", r.base)}
      ${line("주휴수당", r.weekly.total)}
      ${r.allowances.filter((a) => a.name || Number(a.amount)).map((a) => line(esc(a.name || "수당"), Number(a.amount) || 0)).join("")}
      ${line("지급 합계", r.gross, "sum")}
      ${line("소득세", r.income)}
      ${line("지방소득세", r.local)}
    </ul>
    <p class="sheet-label">날짜별 근무</p>
    <ul class="m-days-list">${days || `<li><span>근무 기록이 없어요</span></li>`}</ul>
    <div class="sheet-actions">
      <button type="button" class="btn-ghost" data-action="open-payslip" data-id="${emp.id}">수당 · 명세서</button>
      <button type="button" class="btn-primary" data-action="payslip-pdf-one" data-id="${emp.id}">명세서 PDF</button>
    </div>`;
}

// ---------- 급여 계산 ----------
// 주휴수당 (근로기준법 제55조): 월~일 한 주의 소정근로시간(근무표의 요일별 고정 근무 시간 합계)이
//   15시간 이상이고 근무표상 근무일에 모두 출근했으면
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
    let reason = "";
    if (sun >= today) reason = "주가 아직 안 끝남";
    else if (planned < 15) reason = "소정근로 15시간 미만";
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

// 직원별·월별 추가 수당 (교육수당, 특근수당 등). 기본은 교육수당 한 줄.
function allowancesFor(ym, empId) {
  return store.allowances?.[ym]?.[empId] ?? [{ name: "교육수당", amount: 0 }];
}

function setAllowances(ym, empId, list) {
  store.allowances = store.allowances ?? {};
  store.allowances[ym] = { ...store.allowances[ym], [empId]: list };
}

function payrollRow(emp, ym, recs, allowanceOverride) {
  const mine = recs.filter((r) => r.employeeId === emp.id);
  const hours = mine.reduce((sum, r) => sum + hoursBetween(r.clockIn, r.clockOut), 0);
  const base = Math.round(hours * emp.hourlyWage);
  const weekly = weeklyAllowance(emp, ym);
  const allowances = allowanceOverride ?? allowancesFor(ym, emp.id);
  const extra = allowances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const gross = base + weekly.total + extra;
  const tax = taxes(gross);
  return { emp, days: mine.length, hours, base, weekly, allowances, extra, gross, ...tax, net: gross - tax.income - tax.local };
}

function payrollFor(ym, employeeId) {
  const recs = monthRecords(ym, employeeId);
  const ids = new Set(recs.map((r) => r.employeeId));
  const rows = store.employees.filter((e) => ids.has(e.id)).map((emp) => payrollRow(emp, ym, recs));
  const sum = (k) => rows.reduce((acc, r) => acc + r[k], 0);
  const total = {
    days: sum("days"),
    hours: sum("hours"),
    base: sum("base"),
    weekly: rows.reduce((acc, r) => acc + r.weekly.total, 0),
    extra: sum("extra"),
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
              <td class="ts-name">${esc(r.emp.name)}</td>
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
  const pay = [
    ["기본급", r.base],
    ["주휴수당", r.weekly.total],
    ...r.allowances.filter((a) => a.name || Number(a.amount)).map((a) => [a.name || "수당", Number(a.amount) || 0]),
  ];
  const deduct = [
    ["소득세 (3%)", r.income],
    ["지방소득세 (0.3%)", r.local],
  ];
  const deductTotal = r.income + r.local;
  const line = ([label, value]) => `<li><span>${esc(label)}</span><b>${won(value)}</b></li>`;
  const issued = todayDateString().replaceAll("-", ".");

  return `
    <div class="payslip">
      <header class="ps-top">
        <span class="ps-brand">급여명세서</span>
        <span class="ps-month">${y}년 ${m}월</span>
      </header>
      <h1 class="ps-name">${esc(r.emp.name)} 님</h1>
      <p class="ps-meta">시급 ${won(r.emp.hourlyWage)} · 근무 ${r.days}일 · 총 ${Number(r.hours.toFixed(2))}시간</p>

      <div class="ps-net">
        <span>이번 달 받으실 금액</span>
        <strong>${won(r.net)}</strong>
      </div>

      <section class="ps-sec">
        <h2>지급</h2>
        <ul>${pay.map(line).join("")}</ul>
        <p class="ps-sum"><span>지급 합계</span><b>${won(r.gross)}</b></p>
      </section>

      <section class="ps-sec">
        <h2>공제</h2>
        <ul>${deductTotal ? deduct.map(line).join("") : `<li><span>공제 없음</span><b>0원</b></li>`}</ul>
        <p class="ps-sum"><span>공제 합계</span><b>${won(deductTotal)}</b></p>
      </section>

      <footer class="ps-foot">
        <p class="ps-thanks">이번 한 달도 수고 많으셨어요. 감사합니다.</p>
        <p class="ps-store">${esc(storeName())}</p>
        <p class="ps-issued">발행일 ${issued} · 품</p>
      </footer>
    </div>`;
}

function renderPayslipModal() {
  const empId = state.payslipId;
  if (!empId) return "";
  const { month } = state.payroll;
  const emp = employeeById(empId);
  // 명세서 창에서는 저장 전까지 수정 중인 수당(state.allowDraft)으로 미리 계산
  const r = payrollRow(emp, month, monthRecords(month, empId), state.allowDraft);
  const list = r.allowances;
  return `
    <div class="ps-backdrop${state.modalEnter ? " enter" : ""}" data-action="close-payslip">
      <div class="ps-dialog" data-stop>
        <div class="ps-side">
          <p class="staff-title">${esc(emp.name)} · ${Number(month.slice(5, 7))}월 명세서</p>
          <p class="sub">수당을 입력하면 지급액과 세금이 다시 계산돼요. 저장한 뒤 근무 기록의 <b>명세서 PDF</b>로 한꺼번에 받을 수 있어요.</p>
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
        <td class="name">${esc(r.emp.name)}</td>
        <td class="num" data-label="근무일">${r.days}일</td>
        <td class="num" data-label="근무시간">${hrs(r.hours)}</td>
        <td class="num" data-label="기본급">${won(r.base)}</td>
        <td class="num" data-label="주휴수당" title="${esc(r.weekly.weeks.map((w) => `${shortDate(w.mon)}~${shortDate(w.sun)} 소정 ${hrs(w.planned)} (실근무 ${hrs(w.hours)}) ${w.reason || `→ ${won(w.amount)}`}`).join("\n"))}">${won(r.weekly.total)}</td>
        <td class="num" data-label="수당">${won(r.extra)}</td>
        <td class="num strong" data-label="지급총액">${won(r.gross)}</td>
        <td class="num" data-label="소득세">${won(r.income)}</td>
        <td class="num" data-label="지방소득세">${won(r.local)}</td>
        <td class="num strong net" data-label="실지급액">${won(r.net)}</td>
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
          ${store.employees.filter((e) => !isManager(e)).map((e) => `<option value="${e.id}"${e.id === employeeId ? " selected" : ""}>${esc(e.name)}</option>`).join("")}
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
        <button type="button" class="pill plain-dark" data-action="export-xlsx"${recs.length ? "" : " disabled"}>엑셀 다운로드</button>
      </div>
    </div>
    ${renderTimesheet(month, employeeId)}

    <div class="section-head">
      <h3>급여 정산</h3>
      <button type="button" class="pill" data-action="payslip-pdf-all"${rows.length ? "" : " disabled"}>명세서 PDF${rows.length > 1 ? " (전체)" : ""}</button>
    </div>
    <div class="table-wrap pay-wrap">
      <table class="pay-table">
        <thead><tr><th>이름</th><th class="num">근무일</th><th class="num">근무시간</th><th class="num">기본급</th><th class="num">주휴수당</th><th class="num">수당</th><th class="num">지급총액</th><th class="num">소득세</th><th class="num">지방소득세</th><th class="num">실지급액</th><th></th></tr></thead>
        <tbody>
          ${summary || `<tr><td colspan="11" class="empty">이 달의 근무 기록이 없습니다.</td></tr>`}
          ${
            rows.length > 1
              ? `<tr class="total-row"><td class="name">합계</td><td class="num" data-label="근무일">${total.days}일</td><td class="num" data-label="근무시간">${hrs(total.hours)}</td><td class="num" data-label="기본급">${won(total.base)}</td><td class="num" data-label="주휴수당">${won(total.weekly)}</td><td class="num" data-label="수당">${won(total.extra)}</td><td class="num" data-label="지급총액">${won(total.gross)}</td><td class="num" data-label="소득세">${won(total.income)}</td><td class="num" data-label="지방소득세">${won(total.local)}</td><td class="num net" data-label="실지급액">${won(total.net)}</td><td class="ps-cell"></td></tr>`
              : ""
          }
        </tbody>
      </table>
    </div>
    ${helpToggle(
      "records",
      `주휴수당: 월~일 한 주의 소정근로시간(근무표의 고정 근무 시간)이 15시간 이상이고 근무표상 근무일에 모두 출근하면 (소정근로시간 ÷ 40) × 8시간 × 시급. 대타·추가 근무 시간은 넣지 않아요. 그 주가 끝나는 일요일이 속한 달에 포함되고, 아직 끝나지 않은 주는 빠져요. 금액에 마우스를 올리면 주별 내역이 보여요.<br />
      수당(교육수당·특근수당 등)은 이름 옆 <b>명세서</b>를 눌러 입력해요.<br />
      ${taxOn ? "세금: 소득세 3% + 지방소득세(소득세의 10%), 10원 미만 절사. 소득세가 1,000원 미만이면 공제하지 않아요." : "세금을 공제하지 않고 계산했어요."}`,
    )}
    ${renderPayslipModal()}`,
  );
}

// ---------- 외부 라이브러리 (필요할 때만 불러옴) ----------

const LIBS = {
  xlsx: { src: "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js", ready: () => window.XLSX },
  html2canvas: { src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", ready: () => window.html2canvas },
  jspdf: { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", ready: () => window.jspdf?.jsPDF },
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

async function withBusy(button, text, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = text;
  try {
    await task();
  } catch (err) {
    window.alert(err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ---------- 엑셀 ----------

function exportXlsx(button) {
  return withBusy(button, "만드는 중…", async () => {
    const XLSX = await loadLib("xlsx");
    const { month, employeeId } = state.payroll;
    const { recs, rows, total } = payrollFor(month, employeeId);
    const round2 = (n) => Math.round(n * 100) / 100;

    const thin = { style: "thin", color: { rgb: "000000" } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    const center = { horizontal: "center", vertical: "center" };
    const style = (extra = {}) => ({ border, alignment: center, font: { name: "맑은 고딕", sz: 10 }, ...extra });
    const blue = { fill: { patternType: "solid", fgColor: { rgb: "DCE9F7" } } };

    // 근무표 시트: 사진처럼 No. / 성명 / 요일·날짜 / 시간
    const ts = timesheet(month, employeeId);
    const isWeekend = (d) => [0, 6].includes(weekdayOf(d));
    const head1 = ["No.", "성명", ...ts.days.map((d) => WEEKDAYS[weekdayOf(d)]), "시간"];
    const head2 = ["", "", ...ts.days.map((d) => Number(d.slice(8))), ""];
    const body = ts.rows.map((r, i) => [i + 1, r.emp.name, ...r.cells.map((h) => (h ? round2(h) : "")), round2(r.total)]);
    const wsTs = XLSX.utils.aoa_to_sheet([head1, head2, ...body]);
    const lastCol = head1.length - 1;
    for (let R = 0; R < body.length + 2; R++) {
      for (let C = 0; C <= lastCol; C++) {
        const ref = XLSX.utils.encode_cell({ r: R, c: C });
        wsTs[ref] = wsTs[ref] ?? { t: "s", v: "" };
        const day = C >= 2 && C < lastCol ? ts.days[C - 2] : null;
        const s = style(day && isWeekend(day) ? blue : {});
        if (R < 2) s.font = { ...s.font, bold: true };
        if (R >= 2 && day && typeof wsTs[ref].v === "number") wsTs[ref].z = "0.0";
        if (R >= 2 && C === lastCol) {
          wsTs[ref].z = "0.0";
          s.font = { ...s.font, bold: true };
        }
        wsTs[ref].s = s;
      }
    }
    wsTs["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: lastCol }, e: { r: 1, c: lastCol } },
    ];
    wsTs["!cols"] = [{ wch: 5 }, { wch: 9 }, ...ts.days.map(() => ({ wch: 4.5 })), { wch: 7 }];
    wsTs["!rows"] = [{ hpt: 22 }, { hpt: 22 }, ...body.map(() => ({ hpt: 22 }))];

    const summary = [
      ["이름", "근무일", "근무시간", "시급", "기본급", "주휴수당", "수당", "지급총액", "소득세", "지방소득세", "실지급액"],
      ...rows.map((r) => [r.emp.name, r.days, round2(r.hours), r.emp.hourlyWage, r.base, r.weekly.total, r.extra, r.gross, r.income, r.local, r.net]),
    ];
    if (rows.length > 1) summary.push(["합계", total.days, round2(total.hours), "", total.base, total.weekly, total.extra, total.gross, total.income, total.local, total.net]);

    const detail = [
      ["날짜", "요일", "이름", "출근", "퇴근", "근무시간", "시급", "금액"],
      ...recs.map((r) => {
        const emp = employeeById(r.employeeId);
        const h = hoursBetween(r.clockIn, r.clockOut);
        return [r.date, WEEKDAYS[weekdayOf(r.date)], emp.name, formatTime(r.clockIn), formatTime(r.clockOut), round2(h), emp.hourlyWage, Math.round(h * emp.hourlyWage)];
      }),
    ];

    const weekly = [["이름", "주 시작(월)", "주 끝(일)", "소정근로시간", "실근무시간", "주휴시간", "주휴수당", "비고"]];
    for (const r of rows) {
      for (const w of r.weekly.weeks) weekly.push([r.emp.name, w.mon, w.sun, round2(w.planned), round2(w.hours), round2(w.allowHours), w.amount, w.reason || ""]);
    }

    const plain = (aoa, widths, moneyFrom) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = widths.map((wch) => ({ wch }));
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let R = 0; R <= range.e.r; R++) {
        for (let C = 0; C <= range.e.c; C++) {
          const ref = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[ref]) continue;
          ws[ref].s = { border, font: { name: "맑은 고딕", sz: 10, bold: R === 0 }, ...(R === 0 ? blue : {}) };
          if (R > 0 && moneyFrom !== undefined && C >= moneyFrom && typeof ws[ref].v === "number") ws[ref].z = "#,##0";
        }
      }
      return ws;
    };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsTs, "근무 상세");
    XLSX.utils.book_append_sheet(wb, plain(summary, [10, 8, 10, 9, 12, 12, 10, 12, 10, 11, 12], 3), "급여 정산");
    XLSX.utils.book_append_sheet(wb, plain(detail, [12, 6, 10, 8, 8, 10, 9, 11], 6), "출퇴근 목록");
    XLSX.utils.book_append_sheet(wb, plain(weekly, [10, 12, 12, 12, 11, 10, 11, 20], 6), "주휴수당 내역");
    const who = employeeId ? `_${employeeById(employeeId).name}` : "";
    XLSX.writeFile(wb, `근무기록_${month}${who}.xlsx`);
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
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      for (const [i, id] of empIds.entries()) {
        const r = payrollRow(employeeById(id), month, recs);
        stage.innerHTML = renderPayslip(r, month);
        const canvas = await html2canvas(stage.firstElementChild, { scale: 2, backgroundColor: "#ffffff" });
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
      }
      const who = empIds.length === 1 ? `_${employeeById(empIds[0]).name}` : "_전체";
      pdf.save(`급여명세서_${month}${who}.pdf`);
    } finally {
      stage.remove();
    }
  });
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

function scheduleLayout() {
  const order = new Map(store.employees.map((e, i) => [e.id, i]));
  const days = SCHEDULE_DAYS.map((wd) => {
    const people = store.employees
      .map((e) => ({ e, w: effWeekly(e)[wd] }))
      .filter(({ e, w }) => e.active && w)
      .map(({ e, w }) => ({ emp: e, start: toMin(w.start), end: toMin(w.end) }))
      .sort((a, b) => a.start - b.start || order.get(a.emp.id) - order.get(b.emp.id));
    const cols = [];
    for (const p of people) {
      const col = cols.find((c) => c[c.length - 1].end <= p.start);
      if (col) col.push(p);
      else cols.push([p]);
    }
    while (cols.length < 2) cols.push([]);
    return { wd, cols };
  });

  // 행 경계: 정시 + 누군가 시작/끝나는 시각
  const all = days.flatMap((d) => d.cols.flat());
  const first = Math.floor(Math.min(...all.map((p) => p.start), 7 * 60) / 60) * 60;
  const last = Math.max(...all.map((p) => p.end), 23 * 60);
  const marks = new Set();
  for (let t = first; t <= last; t += 60) marks.add(t);
  all.forEach((p) => marks.add(p.start).add(p.end));
  marks.add(last);
  const bounds = [...marks].filter((t) => t <= last).sort((a, b) => a - b);
  const rows = bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1] }));
  return { days, rows };
}

function renderScheduleSheet() {
  const { days, rows } = scheduleLayout();
  const meta = schedMeta();
  const compact = !isDesktop();
  const occupant = (col, row) => col.find((p) => p.start <= row.start && p.end >= row.end);
  // 같은 정시(예: 22:00~22:30, 22:30~23:00)에 속한 행들은 같은 사람이면 한 칸으로 합친다
  const hourOf = (row) => Math.floor(row.start / 60);

  const body = rows
    .map((row, i) => {
      const cells = days
        .map((d) =>
          d.cols
            .map((col) => {
              const who = occupant(col, row);
              const group = rows.filter((r) => hourOf(r) === hourOf(row));
              const gi = group.indexOf(row);
              const sameAll = Boolean(who) && group.length > 1 && group.every((r) => occupant(col, r) === who);
              if (sameAll && gi > 0) return "";
              const span = sameAll ? ` rowspan="${group.length}"` : "";
              const slot = `data-action="edit-slot" data-wd="${d.wd}" data-start="${row.start}"`;
              if (!who) return `<td class="sc-empty" ${slot}${span}></td>`;
              const bg = cssColor(who.emp.color);
              const ed = state.slotEdit;
              const editing = ed && String(ed.wd) === String(d.wd) && (ed.empId ?? ed.addEmpId) === who.emp.id;
              // 휴대폰: 칸이 좁아 이름 대신 색만 (누구인지는 아래 색 안내)
              const label = compact ? "" : esc(who.emp.name);
              return `<td class="sc-name${editing ? " sc-editing" : ""}" ${slot} data-id="${who.emp.id}"${span} style="background:${bg};color:${textOn(bg)}"${compact ? ` title="${esc(who.emp.name)}" aria-label="${esc(who.emp.name)}"` : ""}>${label}</td>`;
            })
            .join(""),
        )
        .join("");
      // 시간 칸: "7:00 ~ 8:00" (휴대폰은 칸이 좁아 "7~8")
      const time = compact ? `${shortTime(fromMin(row.start))}~${shortTime(fromMin(row.end))}` : `${fromMin(row.start)} ~ ${fromMin(row.end)}`;
      return `<tr><td class="sc-time">${time}</td>${cells}</tr>`;
    })
    .join("");

  const head = days
    .map((d) => `<th colspan="${d.cols.length}" class="${d.wd === 0 || d.wd === 6 ? "sc-rest" : ""}">${WEEKDAYS[d.wd]}</th>`)
    .join("");
  const notes = days
    .map((d) => `<td colspan="${d.cols.length}" class="sc-note"><input value="${esc(meta.notes?.[d.wd] ?? "")}" data-note="${d.wd}" aria-label="${WEEKDAYS[d.wd]}요일 비고" /></td>`)
    .join("");
  // 휴대폰에서는 표·색 안내 아래에
  const actions = `
        <div class="sc-actions" data-html2canvas-ignore>
          <button type="button" class="pill plain-dark" data-action="schedule-temp"${schedDirty() ? "" : " disabled"}>임시저장</button>
          <button type="button" class="pill" data-action="schedule-save"${hasDraft() ? "" : " disabled"}>저장</button>
          <button type="button" class="pill plain-dark" data-action="schedule-pdf">PDF 저장</button>
        </div>`;

  return `
    <div class="sched-sheet" id="sched-sheet">
      <div class="sc-print-head">
        <span class="ps-brand">${esc(storeName())} 근무표${meta.period ? `<span class="sc-print-period">${esc(meta.period.trim())}</span>` : ""}</span>
      </div>
      <div class="sc-head">
        <h2 class="sc-title">[${esc(storeName())} 근무표]( <input class="sc-period" value="${esc(meta.period ?? "")}" size="${Math.max(6, [...(meta.period || "2026.06.04 ~ 2026.07.05")].length)}" data-meta="period" inputmode="numeric" placeholder="2026.06.04 ~ 2026.07.05" aria-label="기간" /> )</h2>
        ${compact ? "" : actions}
      </div>
      ${compact ? `<div class="sc-help" data-html2canvas-ignore>${schedHelp()}</div>` : ""}
      <table class="sched modern${compact ? " compact" : ""}">
        <thead><tr><th>시간</th>${head}</tr></thead>
        <tbody>
          ${body}
          <tr class="sc-foot"><td>비고</td>${notes}</tr>
        </tbody>
      </table>
      ${compact ? renderSchedLegend(days) + actions : ""}
      <p class="sc-brand">${esc(storeName())} · ${todayDateString().replaceAll("-", ".")} 출력 · 품</p>
    </div>`;
}

function schedHelp() {
  return helpToggle(
    "schedule",
    `${isDesktop() ? "이름 칸을 누르면 시간 수정·삭제, 회색 빈 칸을 누르면 근무자 추가예요. 옆에서 입력하면 표에 바로 보여요." : "색 칸을 누르면 시간 수정·삭제, 회색 빈 칸을 누르면 근무자 추가예요. 아래에서 입력하면 표에 바로 보여요."}<br />
    <b>저장</b>하면 직원 관리·달력·근무 기록에 반영되고, <b>임시저장</b>은 반영하지 않고 고친 내용만 보관해요.<br />
    지난 근무 기록은 제목 기간의 시작일(<b>${shortDate(scheduleStart())}</b>)부터 바뀌어요. 제목의 기간과 비고 칸도 눌러서 고칠 수 있어요.`,
  );
}

// 근무표 칸을 누르면 편집 패널("월요일 · 근무자 추가")이 화면 위쪽에 보이게 옮기고 입력칸에 커서
// (패널이 표 아래에 있는 좁은 화면에서 눌러도 안 보이는 일이 없게)
function revealSlotPanel() {
  if (!isDesktop()) {
    document.getElementById(state.slotEdit?.empId ? "slot-start" : "slot-emp")?.focus({ preventScroll: true });
    return;
  }
  const panel = document.querySelector(".sched-panel");
  if (!panel) return;
  const { top, bottom } = panel.getBoundingClientRect();
  // 패널이 표 아래에 있으면(좁은 화면) 항상 제목이 맨 위로 오게 — 키보드가 올라와도 입력칸이 가리지 않게
  const below = window.matchMedia("(max-width: 1099px)").matches;
  if (below || top < 0 || bottom > window.innerHeight) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById(state.slotEdit?.empId ? "slot-start" : "slot-emp")?.focus({ preventScroll: true });
}

// 휴대폰 근무표 아래 색 안내: 근무표에 나오는 사람만
function renderSchedLegend(days) {
  const ids = new Set(days.flatMap((d) => d.cols.flatMap((col) => col.map((p) => p.emp.id))));
  const people = store.employees.filter((e) => ids.has(e.id));
  if (!people.length) return "";
  return `
    <ul class="sc-legend">
      ${people.map((e) => `<li><span class="sc-swatch" style="background:${cssColor(e.color)}"></span>${esc(e.name)}</li>`).join("")}
    </ul>`;
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
    <div class="sched-layout">
      <div class="sched-main">
        <div class="sched-scroll" id="sched-scroll">${renderScheduleSheet()}</div>
        ${isDesktop() ? schedHelp() : ""}
      </div>
      <div class="sched-side${state.slotEdit ? " editing" : ""}">
        <div id="sched-status">${renderSchedStatus()}</div>
        <aside class="sched-panel">${renderSlotPanel()}</aside>
      </div>
    </div>`,
    { center: true, wide: true },
  );
}

function renderSlotPanel() {
  const ed = state.slotEdit;
  if (!ed) {
    return `
      <p class="staff-title">근무 수정</p>
      <p class="sub">${isDesktop() ? "근무표에서 이름 칸이나 회색 빈 칸을" : "근무표에서 색 칸이나 회색 빈 칸을"} 누르면 여기서 시간을 입력할 수 있어요.</p>`;
  }
  const empId = ed.empId ?? ed.addEmpId;
  const emp = empId ? employeeById(empId) : null;
  const shift = emp ? effWeekly(emp)[ed.wd] : null;
  const start = shift?.start ?? fromMin(ed.start).padStart(5, "0");
  const end = shift?.end ?? fromMin(Math.min(ed.start + 6 * 60, 23 * 60)).padStart(5, "0");
  // 추가할 때 고를 수 있는 사람: 이 칸을 열 때 그 요일 근무가 없던 사람
  const before = (e) => ({ ...e.weekly, ...(ed.snapshot[e.id] ?? {}) })[ed.wd];
  const choices = store.employees.filter((e) => e.active && (!before(e) || e.id === ed.addEmpId));
  return `
    <form class="slot-form" id="slot-form">
      <p class="staff-title">${WEEKDAYS[ed.wd]}요일 · ${ed.empId ? esc(emp.name) : "근무자 추가"}</p>
      ${
        ed.empId
          ? ""
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
  if (scroll) scroll.innerHTML = renderScheduleSheet();
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

async function schedulePdf(button) {
  return withBusy(button, "PDF 만드는 중…", async () => {
    const [html2canvas, jsPDF] = await Promise.all([loadLib("html2canvas"), loadLib("jspdf")]);
    await document.fonts.ready;
    const sheet = document.getElementById("sched-sheet");
    const fold = sheet.closest("details");
    const wasOpen = fold?.open;
    if (fold) fold.open = true;
    sheet.classList.add("capturing");
    // 기간 입력칸은 글자로 바꿔서 찍는다 (입력칸 여백이 생기지 않게)
    const period = sheet.querySelector(".sc-period");
    const periodText = document.createElement("span");
    periodText.textContent = period.value;
    period.replaceWith(periodText);
    try {
      const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      const margin = 8;
      const w = 297 - margin * 2;
      const h = Math.min(210 - margin * 2, (canvas.height / canvas.width) * w);
      const fitW = (canvas.width / canvas.height) * h;
      // A4 가로 한가운데에 (위아래 여백을 똑같이)
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", (297 - fitW) / 2, (210 - h) / 2, fitW, h);
      pdf.save(`근무표_${(store.scheduleMeta?.period || todayDateString()).replace(/[\s.~]+/g, "_")}.pdf`);
    } finally {
      periodText.replaceWith(period);
      sheet.classList.remove("capturing");
      if (fold) fold.open = wasOpen;
    }
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
    case "next-month": {
      const m = state.month + (action === "prev-month" ? -1 : 1);
      state.monthDir = action === "prev-month" ? "prev" : "next";
      state.year += m < 1 ? -1 : m > 12 ? 1 : 0;
      state.month = m < 1 ? 12 : m > 12 ? 1 : m;
      break;
    }
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
      if (!window.confirm(`${employeeById(id).name}님의 ${shortDate(date)} 근무 기록을 삭제할까요?`)) return;
      removeRecord(id, date);
      save();
      queueToast("근무 기록을 삭제했어요");
      state.expandedId = null;
      break;
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
      if (!window.confirm(`${emp.name}님을 삭제하시겠습니까? 근무 기록도 함께 삭제됩니다.`)) return;
      const finish = () => {
        store.employees = store.employees.filter((x) => x.id !== id);
        store.records = store.records.filter((x) => x.employeeId !== id);
        save();
        queueToast(`${emp.name}님을 삭제했어요`);
        if (state.sheet?.id === id) state.sheet = null;
        render();
      };
      // 줄이 옆으로 밀려나며 사라진 뒤에 지운다
      const row = el.closest("tr");
      if (row && !reducedMotion()) {
        row.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }], { duration: 220, easing: "ease-in" }).finished.then(finish);
      } else finish();
      return;
    }
    case "export-xlsx":
      exportXlsx(el);
      return;
    case "payroll-prev":
    case "payroll-next":
      state.payroll.month = shiftMonth(state.payroll.month, action === "payroll-prev" ? -1 : 1);
      state.payslipId = null;
      state.pageEnter = true; // 달을 넘기면 카드가 다시 올라오고 금액도 다시 올라간다
      break;
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
    case "schedule-pdf":
      schedulePdf(el);
      return;
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
        const from = scheduleStart(state.schedWork?.meta?.period ?? store.scheduleMeta?.period ?? "").replaceAll("-", ".");
        if (!window.confirm(`근무표를 저장하면 ${from} 부터 직원 관리·달력·근무 기록에 반영돼요. 저장할까요?`)) return;
      }
      state.slotEdit = null;
      commitSchedule();
      showToast("근무표를 저장했어요", "ok");
      return;
    case "edit-slot":
      if (state.slotEdit) liveSlot({ final: true }); // 보던 칸은 입력한 대로 두고 넘어간다
      state.sheetEnter = !state.slotEdit;
      state.error = "";
      state.slotEdit = {
        wd: el.dataset.wd,
        empId: el.dataset.id ?? null,
        addEmpId: null,
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
      break;
    case "close-payslip":
      state.payslipId = null;
      state.allowDraft = null;
      break;
    case "save-payslip":
      setAllowances(state.payroll.month, state.payslipId, state.allowDraft.filter((a) => a.name || a.amount));
      save();
      queueToast("수당을 저장했어요");
      state.payslipId = null;
      state.allowDraft = null;
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

// ---------- 둘러보기(로그인 전): 보기만, 고치는 동작은 막는다 ----------
// 화면을 옮겨 다니고 펼쳐 보는 동작만 허용. 나머지(추가·수정·삭제·저장·내보내기)는 안내만 띄운다.
const DEMO_ALLOWED = new Set([
  "prev-month", "next-month", "close-panel", "go-home", "toggle-staff", "toggle-help",
  "payroll-prev", "payroll-next", "open-payslip", "close-payslip",
  "open-sheet", "close-sheet", "sched-day",
]);

let toastTimer = null;
// 다음 그리기에 알림을 띄운다 (처리 뒤에 어차피 다시 그리는 곳에서 사용)
function queueToast(text, kind = "ok") {
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
    const work = schedWork();
    const meta = (work.meta = structuredClone(work.meta ?? store.scheduleMeta ?? { notes: {} }));
    if (t.dataset.meta) meta[t.dataset.meta] = t.value.trim();
    else meta.notes = { ...meta.notes, [t.dataset.note]: t.value.trim() };
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
function addExtra() {
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
  if (!emp && !window.confirm(`'${name}'님은 등록된 직원이 아니에요. 새 직원으로 등록할까요?`)) return;
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

// 근무표 기간: 숫자만 입력해도 "2026.06.04 ~ 2026.07.05" 꼴로 맞춘다
function formatPeriod(digits) {
  const d = digits.slice(0, 16);
  const date = (s) => [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)].filter(Boolean).join(".");
  if (d.length < 8) return date(d);
  return d.length === 8 ? `${date(d)} ~ ` : `${date(d.slice(0, 8))} ~ ${date(d.slice(8))}`;
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
  if (e.target.classList.contains("sc-period")) livePeriod(e.target, e);
});
app.addEventListener("focusin", (e) => {
  if (e.target.classList.contains("sc-period")) e.target.dataset.digits = e.target.value.replace(/\D/g, "");
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
    const { scheduleMeta, settings, allowances, scheduleDraft, absent } = store;
    out["private/main"] = JSON.stringify({ scheduleMeta, settings, allowances, scheduleDraft, absent });
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
  return { ...data, employees, records, shifts, absent };
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
