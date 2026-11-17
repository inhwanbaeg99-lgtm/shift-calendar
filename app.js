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

// ISO 시각이 매장 시간대로 며칠인지 (YYYY-MM-DD)
const dateOfIso = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso));

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
  "#f8cbad", "#a9d08e", "#ff99cc", "#9bc2e6", "#ffc000", "#b4a7d6", "#FF05BF", "#00b0f0", "#ffd966",
  "#548235", "#f4b183", "#d9d2e9", "#70ad47", "#FF05BF", "#dbdbdb",
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

// 급여에 쓰는 퇴근 시각은 그날 근무 종료 시간으로 본다 (자정을 넘기면 다음 날)
function scheduledEnd(emp, date) {
  const { start, end } = shiftFor(emp, date);
  return endIso(date, start, end);
}

// 직원 화면에서 이름만 넣은 대타: 정해진 근무 시간이 없다 (start · end 는 등록한 시각, 화면에는 "대타"로 나온다)
const noTimeShift = (emp, date) => Boolean(store.shifts[date]?.[emp.id]?.noTime);
const shiftLabel = (emp, date) => {
  const { start, end } = shiftFor(emp, date);
  return noTimeShift(emp, date) ? "대타" : `${start} ~ ${end}`;
};

// 찍은 시각을 10분 단위로 반올림 (초는 버림, 13:52 → 13:50, 13:55 · 13:57 → 14:00)
function roundPunch(now) {
  const TEN_MIN = 600_000;
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(Math.floor((minute + TEN_MIN / 2) / TEN_MIN) * TEN_MIN).toISOString();
}

// 기록에 넣는 시각은 모두 10분 단위 (관리자가 고친 시간 · 근무표로 채운 시간도 같다)
const roundIso = (iso) => roundPunch(new Date(iso));

// 출근은 오늘 날짜에만 기록된다 (미래 날짜에는 출근 버튼이 나오지 않음)
function clockIn(employeeId, now = new Date()) {
  const emp = employeeById(employeeId);
  if (!emp || !emp.active) return "직원을 찾을 수 없습니다.";
  const date = todayDateString();
  if (recordFor(employeeId, date)?.clockIn) return "이미 출근 처리되었습니다.";
  // MGC 근무와 같은 방식: 출근만 찍고, 퇴근은 그날 근무 종료 시간으로 들어간다.
  // 예정보다 일찍 누르면 예정 시작 시각, 늦게 누르면 10분 단위로 반올림한 시각 (반올림해도 예정 시작 전으로는 가지 않음).
  // 시간이 다르면 직원은 수정 요청, 관리자는 직접 수정한다. 실제로 누른 시각은 punchedAt 에 남긴다.
  // 이름만 넣은 대타는 정해진 종료 시간이 없어서 예전처럼 퇴근을 찍는다 (punchIn · punchOut)
  const noEnd = noTimeShift(emp, date);
  const scheduled = kstIso(date, shiftFor(emp, date).start);
  const rounded = roundPunch(now);
  const start = noEnd ? rounded : (now <= new Date(scheduled) || rounded < scheduled ? roundIso(scheduled) : rounded);
  const end = noEnd ? start : roundIso(scheduledEnd(emp, date));
  store.records.push({
    manual: true,
    id: uid(),
    employeeId,
    date,
    clockIn: start,
    clockOut: end > start ? end : start,
    ...(noEnd ? { punchIn: now.toISOString(), noEnd: true } : { punchedAt: now.toISOString() }),
    createdAt: now.toISOString(),
  });
  save();
  return null;
}

// 출근은 찍었는데 퇴근을 아직 안 찍은 기록 (퇴근 찍기를 넣기 전 기록은 punchIn 이 없어서 해당 없음)
const punchOpen = (rec) => Boolean(rec?.punchIn && !rec.punchOut);
// 이름만 넣은 대타가 아직 일하는 중 (달력에 퇴근 시간 대신 - 를 보여 준다)
const noEndOpen = (rec) => Boolean(rec.noEnd && punchOpen(rec) && !rec.edited);
// 출근을 찍고 근무표 종료 시간이 지났는데 퇴근을 안 찍은 기록 (관리자가 시간을 고쳤거나 퇴근 처리하면 사라진다)
function needsCheck(rec) {
  if (!punchOpen(rec) || rec.edited) return false;
  if (rec.noEnd) return todayDateString() > rec.date; // 대타는 종료 시간이 없으니 자정이 지나면
  const emp = employeeById(rec.employeeId);
  return Boolean(emp) && new Date() > new Date(scheduledEnd(emp, rec.date));
}

// 급여 화면 맨 위 안내: 그달 퇴근 확인이 필요한 기록
function payCheckNotice(month) {
  const list = store.records.filter((r) => r.date.startsWith(month) && needsCheck(r)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!list.length) return "";
  const how = list.some((r) => r.noEnd) ? "근무표가 있으면 종료 시간으로, 이름만 넣은 대타는 0시간으로 계산하고 있어요." : "근무표 종료 시간으로 계산하고 있어요.";
  return `
    <div class="pay-check">
      <p><b>퇴근 확인 필요 ${list.length}건</b> 퇴근을 안 찍었어요. ${how} 눌러서 시간을 확인해 주세요.</p>
      <div class="pay-check-list">${list.map((r) => `<a href="#/day/${r.date}">${esc(employeeById(r.employeeId).name)} ${shortDate(r.date)}</a>`).join("")}</div>
    </div>`;
}

// 어제 시작해서 오늘 끝나는 근무 (자정 넘김): 오늘 화면에서 퇴근을 찍게 한다
function overnightOpen(today) {
  return recordsOn(addDays(today, -1)).filter((r) => punchOpen(r) && (r.noEnd || dateOfIso(r.clockOut) === today));
}

// 퇴근 찍기: 오늘 기록, 또는 어제 시작해서 오늘 끝나는 근무만
function clockOut(employeeId, date, now = new Date()) {
  const rec = recordFor(employeeId, date);
  if (!punchOpen(rec)) return "이미 퇴근 처리되었습니다.";
  const today = todayDateString();
  if (date !== today && !(date === addDays(today, -1) && (rec.noEnd || dateOfIso(rec.clockOut) === today))) return "지난 날짜의 퇴근은 관리자에게 말해주세요.";
  rec.punchOut = now.toISOString();
  if (!rec.edited) rec.clockOut = roundPunch(now); // 관리자가 직접 고친 시간은 그대로 둔다
  save();
  return null;
}

// 관리자 달력에서 그날 근무 기록을 직접 넣거나 고친다. 근무 상세·급여 정산은 기록으로 계산되므로 바로 반영된다.
// 직접 고친 기록(edited)은 이후 근무표를 저장해도 덮어쓰지 않는다.
function setRecordTimes(empId, date, start, end) {
  const clockIn = roundIso(kstIso(date, start));
  const clockOut = roundIso(endIso(date, start, end));
  const rec = recordFor(empId, date);
  if (rec) Object.assign(rec, { clockIn, clockOut, edited: true });
  else store.records.push({ id: uid(), employeeId: empId, date, clockIn, clockOut, createdAt: new Date().toISOString(), edited: true });
  if (store.absent) delete store.absent[`${empId}|${date}`];
}

function nameLabel(emp) {
  return esc(emp.name);
}

// ---------- 근무 수정 요청 (MGC 근무와 같게) ----------
// 직원이 그날 근무 시간을 고쳐 달라고 요청하면 stores/{코드}/public/changeRequests/{직원id_날짜} 에 남는다.
// 관리자가 승인하기 전까지 기록은 그대로다. 직원·날짜당 대기 중인 요청은 하나만.
const REQ_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function changeRequests() {
  return Object.entries(remote?.pub?.changeRequests ?? {})
    .filter(([id, r]) => /^[\w-]{1,80}$/.test(id) && r && typeof r === "object" && /^[\w-]{1,40}$/.test(r.employeeId ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") && REQ_TIME.test(r.start ?? "") && REQ_TIME.test(r.end ?? "") && ["pending", "processing", "approved", "rejected"].includes(r.status))
    .map(([id, r]) => ({ id, employeeId: r.employeeId, date: r.date, start: r.start, end: r.end, beforeStart: REQ_TIME.test(r.beforeStart ?? "") ? r.beforeStart : "", beforeEnd: REQ_TIME.test(r.beforeEnd ?? "") ? r.beforeEnd : "", reason: typeof r.reason === "string" ? r.reason.slice(0, 300) : "", status: r.status, createdAt: String(r.createdAt ?? "") }));
}
const pendingRequestsOn = (date) => changeRequests().filter((r) => r.date === date && ["pending", "processing"].includes(r.status)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
const pendingRequestFor = (empId, date) => pendingRequestsOn(date).find((r) => r.employeeId === empId);

// 관리자: 그날 대기 중인 수정 요청 (승인 · 반려)
function renderChangeRequests(date) {
  if (!ADMIN_SITE || !isAdmin()) return "";
  const rows = pendingRequestsOn(date);
  if (!rows.length) return "";
  return `<section class="change-inbox" aria-label="근무 수정 요청"><h3>근무 수정 요청 <span>${rows.length}건</span></h3>${rows.map((r) => {
    const emp = employeeById(r.employeeId);
    const worked = hoursBetween(kstIso(r.date, r.start), endIso(r.date, r.start, r.end));
    return `<article class="change-request"><div><b>${esc(emp?.name || "삭제된 직원")}</b><p class="request-time">${r.beforeStart ? `${esc(r.beforeStart)} ~ ${esc(r.beforeEnd)} → ` : ""}<strong class="request-new-time${emp ? diffClass(emp, r.date, worked) : ""}">${esc(r.start)} ~ ${esc(r.end)}</strong></p>${r.reason ? `<p class="request-reason">${esc(r.reason)}</p>` : ""}</div><div class="action-row"><button type="button" class="btn-ghost" data-action="reject-shift-change" data-id="${esc(r.id)}"${r.status === "processing" ? " disabled" : ""}>반려</button><button type="button" class="btn-primary" data-action="approve-shift-change" data-id="${esc(r.id)}"${!emp || r.status === "processing" ? " disabled" : ""}>${r.status === "processing" ? "처리 중" : "승인"}</button></div></article>`;
  }).join("")}</section>`;
}

// 직원: 수정 요청 보내기 (같은 요청이 동시에 두 번 들어가지 않게 transaction)
async function submitShiftChange(emp, date, start, end, reason) {
  if (!cloud || !remote.pubLoaded || !storeId) { state.error = "온라인 연결 후 다시 요청해주세요."; render(); return; }
  const rec = recordFor(emp.id, date);
  const sh = shiftFor(emp, date);
  const before = rec ? { start: formatTime(rec.clockIn), end: formatTime(rec.clockOut) } : { start: sh.start, end: sh.end };
  try {
    const result = await cloud.db.ref(storePath(`public/changeRequests/${emp.id}_${date}`)).transaction((old) => {
      if (old && ["pending", "processing"].includes(old.status)) return;
      return { employeeId: emp.id, date, start, end, beforeStart: before.start, beforeEnd: before.end, reason: reason.slice(0, 300), status: "pending", createdAt: new Date().toISOString() };
    });
    if (!result.committed) throw new Error("이미 승인 대기 중인 요청이 있어요.");
    resetDayUi();
    queueToast("수정 요청을 보냈어요. 승인 후 반영돼요.");
    render();
  } catch (err) {
    state.error = err?.message || "요청을 보내지 못했어요.";
    render();
  }
}

// 관리자: 승인하면 그날 기록(오늘 · 지난 날짜) 또는 그날 근무 시간(앞으로의 날짜)에 반영, 반려하면 기록은 그대로
async function reviewShiftChange(id, approve, button) {
  if (!isAdmin() || !cloud) return;
  if (!(await uiConfirm(approve ? "요청한 근무시간을 승인하고 급여에 반영할까요?" : "이 수정 요청을 반려할까요?", { ok: approve ? "승인" : "반려" }))) return;
  button.disabled = true;
  try {
    const r = changeRequests().find((x) => x.id === id);
    if (!r || r.status !== "pending") throw new Error("이미 처리된 요청이에요.");
    if (approve) {
      const emp = employeeById(r.employeeId);
      if (!emp) throw new Error("직원을 찾을 수 없어요.");
      if (r.date <= todayDateString()) setRecordTimes(emp.id, r.date, r.start, r.end);
      else setShift(emp.id, r.date, r.start, r.end);
      save();
    }
    await cloud.db.ref(storePath(`public/changeRequests/${id}`)).update({ status: approve ? "approved" : "rejected", reviewedAt: new Date().toISOString() });
    showToast(approve ? "승인했어요. 근무시간과 급여에 반영됐어요." : "요청을 반려했어요.");
  } catch (err) {
    button.disabled = false;
    uiAlert(err?.message || "처리하지 못했어요. 다시 시도해주세요.");
  }
}

// 관리자가 대신 출근 처리: 그날 근무 시간(근무표 또는 그날 바꾼 시간) 그대로 기록한다
function adminClockIn(empId, date) {
  const emp = employeeById(empId);
  if (!emp || recordFor(empId, date) || noTimeShift(emp, date)) return;
  const { start } = shiftFor(emp, date);
  store.records.push({ manual: true, id: uid(), employeeId: empId, date, clockIn: roundIso(kstIso(date, start)), clockOut: roundIso(scheduledEnd(emp, date)), createdAt: new Date().toISOString() });
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
// - 출근 기록은 새로 만들지 않는다 (직접 출근 또는 관리자 출근 처리로만 생긴다)
// - 예전에 자동으로 채운 기록: 시간 변경 / 근무 삭제 시 제거
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
    if (rec?.edited || rec?.punchIn) continue; // 관리자가 달력에서 직접 고친 날, 직원이 직접 찍은 날
    if (store.absent?.[`${emp.id}|${date}`]) continue; // 관리자가 기록을 지운 날 (결근)
    if (shift) {
      const clockIn = roundIso(kstIso(date, shift.start));
      const clockOut = roundIso(endIso(date, shift.start, shift.end));
      if (rec) Object.assign(rec, { clockIn, clockOut });
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
// 클립보드 복사 (막혀 있으면 숨긴 입력칸을 골라 복사하는 옛 방식으로)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("copy failed");
  }
}
const ICON_COPY = svg(15, '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 2);
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
  expandedRecId: null, // 관리자: 출근 기록에서 이름을 눌러 수정/삭제 버튼이 펼쳐진 직원
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
const BACK_TO_DEMO = `<a class="lock-link lock-demo" href="#/employees">샘플 매장 둘러보기</a>`;
const errorLine = () => (state.error ? `<p class="error">${esc(state.error)}</p>` : "");

// 관리자 사이트 첫 화면: 로그인 / 매장 등록(회원가입) / 로그인했는데 매장이 없으면 매장 만들기
function renderLock() {
  const title = `
    <div class="lock-brand">
      <span class="logo big" aria-hidden="true">콕</span>
      <p class="lock-title">사장님</p>
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
  if (cloud.auth.currentUser && state.ownerFailed && state.busy !== "signup") {
    return `
      <div class="lock-page">
        ${title}
        <p class="error">매장 정보를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해주세요.</p>
        <button type="button" class="lock-link" data-action="logout">다른 계정으로 로그인</button>
      </div>`;
  }
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
          <input id="login-email" class="field" type="email" autocomplete="username" placeholder="사장님 이메일" aria-label="사장님 이메일" required />
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
      <a class="lock-link lock-cta" href="#/signup">처음이에요 · 매장 등록하기</a>
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
        <input id="pick-code" class="field" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="매장 코드" aria-label="매장 코드" required />
        <button type="submit" class="btn-primary"${state.busy ? " disabled" : ""}>${state.busy ? "확인 중…" : "시작하기"}</button>
        ${errorLine()}
      </form>
    </div>`;
}

// 6주인 달은 칸이 작아지므로, "+N명" 줄까지 칸에 들어가는 만큼만 이름을 보여 준다 (style.css 의 --cell-h 와 같은 계산)
function sixWeekChips() {
  const fiveWeekCell = Math.min(168, Math.max(100, (window.innerHeight - 244) / 6));
  const cell = (fiveWeekCell * 5 - 4) / 6;
  return Math.max(1, Math.floor((cell - 38) / 14.64) - 1);
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function renderCalendar(period = state) {
  const { year, month } = period;
  const { selectedDate } = state;
  const today = todayDateString();
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);
  const sixWeeks = cells.length > 35;
  const maxVisible = sixWeeks ? sixWeekChips() : MAX_VISIBLE;

  const body = cells
    .map((date, i) => {
      if (!date) return `<div class="empty-cell"></div>`;
      const entries = recordsOn(date);
      const holiday = HOLIDAYS[date];
      const isRest = i % 7 === 0 || Boolean(holiday);
      const numClass = date === today ? "today" : isRest ? "rest" : "";
      const chips = [
        ...entries.slice(0, maxVisible).map((r) => {
          const emp = employeeById(r.employeeId);
          const diff = diffClass(emp, date, hoursBetween(r.clockIn, r.clockOut));
          return `<span class="chip">${nameLabel(emp, r)} ${needsCheck(r) ? `<span class="chip-time under">${formatTime(r.clockIn)}~확인 필요</span>` : noEndOpen(r) ? `<span class="chip-time">${formatTime(r.clockIn)}~-</span>` : `<span class="chip-time${diff}">${formatTime(r.clockIn)}~${formatTime(r.clockOut)}</span>`}</span>`;
        }),
        entries.length > maxVisible ? `<span class="chip more">+${entries.length - maxVisible}명</span>` : "",
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
    <div class="grid${sixWeeks ? " six-weeks" : ""}${state.monthDir ? ` slide-${state.monthDir}` : ""}">
      ${weekdayRow()}
      ${body}
    </div>`;
}

function weekdayRow() {
  return WEEKDAYS.map((w, i) => `<div class="weekday${i === 0 ? " rest" : ""}">${w}</div>`).join("");
}

// 날짜 박스: 그날 출근한 사람들
// 모바일 관리자 날짜 상세: 직원 · 근무표 화면처럼 요약 카드 + 목록 카드
const mobileAdminCal = () => ADMIN_SITE && !isDesktop() && ["calendar", "day"].includes(route().name);
const mobileDayPage = mobileAdminCal;
const calDay = () => state.calDay ?? todayDateString();

function renderDateBox(date, { closable }) {
  const [, m, d] = date.split("-").map(Number);
  const mobile = mobileDayPage();
  const wd = weekdayOf(date);
  const holiday = HOLIDAYS[date];
  const isRest = wd === 0 || Boolean(holiday);
  const records = recordsOn(date);

  const rows = records
    .map(
      (r) => `
        <li class="in-item${r.id === state.justAddedId ? " new" : ""}">
          <${ADMIN_SITE && !mobile ? `button type="button" data-action="toggle-rec" data-id="${r.employeeId}"` : "div"} class="in-row">
            <span class="in-name">${nameLabel(employeeById(r.employeeId), r)}</span>
            ${needsCheck(r) ? `<span class="in-time under">${formatTime(r.clockIn)} ~ 퇴근 확인 필요</span>` : noEndOpen(r) ? `<span class="in-time">${formatTime(r.clockIn)} ~ -</span>` : `<span class="in-time${diffClass(employeeById(r.employeeId), date, hoursBetween(r.clockIn, r.clockOut))}">${formatTime(r.clockIn)} ~ ${formatTime(r.clockOut)}</span>`}
          </${ADMIN_SITE && !mobile ? "button" : "div"}>
          ${ADMIN_SITE && !mobile && state.expandedRecId === r.employeeId ? `<div class="in-action">${renderRecordActions(r)}</div>` : ""}
        </li>`,
    )
    .join("");

  if (mobile) return `
    <section class="date-box m-date" aria-label="${m}월 ${d}일 출근 기록">
      ${renderChangeRequests(date)}
      <div class="m-hero m-date-hero">
        <span class="m-date-num${isRest ? " rest" : ""}">${d}</span>
        <span class="m-date-wd${isRest ? " rest" : ""}">${WEEKDAYS[wd]}요일${holiday ? ` · ${esc(holiday)}` : ""}</span>
        <ul class="in-list m-in-boxes">${rows || `<li class="in-empty">${date > todayDateString() ? "아직 오지 않은 날이에요" : "아직 출근한 사람이 없어요"}</li>`}</ul>
      </div>
    </section>`;  return `
    <section class="date-box" aria-label="${m}월 ${d}일 출근 기록">
      <div class="date-box-head">
        <div>
          <p class="date-box-day${isRest ? " rest" : ""}">${d}</p>
          <p class="date-box-wd${isRest ? " rest" : ""}">${WEEKDAYS[wd]}요일${holiday ? ` · ${esc(holiday)}` : ""}</p>
        </div>
        ${closable ? `<button type="button" class="close-btn" data-action="close-panel" aria-label="닫기">${ICON_CLOSE}</button>` : ""}
      </div>
      <p class="box-label">출근 ${records.length}명${ADMIN_SITE && records.length ? " · 이름을 눌러 시간을 고쳐요" : ""}</p>
      ${renderChangeRequests(date)}
      <ul class="in-list">
        ${rows || `<li class="in-empty">아직 출근한 사람이 없어요</li>`}
      </ul>
    </section>`;
}

// 관리자: 출근 기록의 수정 · 삭제. 고치면 기록만 바뀌고 근무자 목록의 근무표 시간은 그대로다
function renderRecordActions(rec) {
  const id = rec.employeeId;
  if (state.editingWhere === "box" && state.editingId === id) {
    // 이름만 넣은 대타가 퇴근을 안 찍었으면 퇴근 칸은 비워 둔다
    return renderTimeEditor(id, formatTime(rec.clockIn), noEndOpen(rec) || (rec.noEnd && needsCheck(rec)) ? "" : formatTime(rec.clockOut)) + (state.error ? `<p class="error">${esc(state.error)}</p>` : "");
  }
  return `
    <div class="action-row">
      <button type="button" class="btn-ghost danger-ghost" data-action="remove-record" data-id="${id}">기록 삭제</button>
      <button type="button" class="btn-primary" data-action="edit-shift" data-where="box" data-id="${id}">수정</button>
    </div>`;
}

function renderStaffItem(emp, date) {
  const today = todayDateString();
  const isToday = date === today;
  const rec = recordFor(emp.id, date);
  const done = Boolean(rec?.clockIn);
  // 직원 화면: 오늘 찍을 게 남아 있을 때만 이름을 누를 수 있다 (시간 수정은 관리자만)
  // 관리자 화면: 출근 기록이 없을 때만 (기록이 있으면 위쪽 출근 기록에서 고친다)
  // 직원: 오늘 · 지난 날짜는 이름을 눌러 출근 또는 수정 요청 (MGC 근무와 같게)
  const pending = pendingRequestFor(emp.id, date);
  const editable = ADMIN_SITE ? !done || mobileAdminCal() : date <= today;
  // 이름 밑에는 항상 근무표 시간. 관리자가 고치는 칸에는 기록이 있으면 기록된 시간을 넣는다
  const shift = shiftFor(emp, date);
  // 직원 수정 요청 칸에는 기록이 있으면 기록된 시간을 넣는다
  const useRec = rec && (!ADMIN_SITE || mobileAdminCal());
  const start = useRec ? formatTime(rec.clockIn) : shift.start;
  const end = useRec ? (noEndOpen(rec) || (rec.noEnd && needsCheck(rec)) ? "" : formatTime(rec.clockOut)) : noTimeShift(emp, date) ? "" : shift.end;
  const expanded = editable && state.expandedId === emp.id;

  let action = "";
  if (expanded && state.editingWhere === "staff" && state.editingId === emp.id) {
    action = renderTimeEditor(emp.id, start, end);
  } else if (expanded) {
    action = `
      <div class="action-row">
        ${ADMIN_SITE && (date > today || (mobileAdminCal() && done)) ? `<button type="button" class="btn-ghost" data-action="edit-shift" data-id="${emp.id}">수정</button>` : ""}
        ${ADMIN_SITE && mobileAdminCal() && done ? `<button type="button" class="btn-ghost danger-ghost" data-action="remove-record" data-id="${emp.id}">기록 삭제</button>` : ""}
        ${!ADMIN_SITE && isToday && !done ? `<button type="button" class="btn-primary" data-action="clock-in" data-id="${emp.id}">출근</button>` : ""}
        ${!ADMIN_SITE && isToday && punchOpen(rec) ? `<button type="button" class="btn-primary" data-action="clock-out" data-id="${emp.id}">퇴근</button>` : ""}
        ${!ADMIN_SITE && !pending ? `<button type="button" class="btn-ghost" data-action="edit-shift" data-id="${emp.id}">수정 요청</button>` : ""}
        ${ADMIN_SITE && !done && date <= today ? (noTimeShift(emp, date) ? `<button type="button" class="btn-primary" data-action="edit-shift" data-id="${emp.id}">출근 처리</button>` : `<button type="button" class="btn-primary" data-action="admin-clock-in" data-id="${emp.id}">출근 처리</button>`) : ""}
      </div>`;
  }
  if (expanded && state.error && state.editingWhere !== "staff") action += `<p class="error">${esc(state.error)}</p>`;

  return `
    <li class="staff-item${expanded ? " expanded" : ""}">
      <button type="button" class="staff-name-btn" data-action="toggle-staff" data-id="${emp.id}"${editable ? "" : " disabled"}>
        <span class="staff-name">${nameLabel(emp, rec)}</span>
        ${pending ? `<span class="badge req">수정 요청 중</span>` : needsCheck(rec) ? `<span class="badge check">퇴근 확인 필요</span>` : done ? `<span class="badge done${rec.id === state.justAddedId ? " just" : ""}">출근 완료</span>` : ""}
        <span class="staff-time">${shiftLabel(emp, date)}</span>
      </button>
      ${action ? `<div class="staff-action${state.expandEnter ? " enter" : ""}">${action}</div>` : ""}
    </li>`;
}

// 시간 수정 칸 (근무자 목록·날짜 박스 공용). 비워 두면 기존 시간 유지.
function renderTimeEditor(empId, start, end) {
  return `
    ${ADMIN_SITE ? "" : `<p class="edit-note">고칠 시간을 넣고 <b>요청</b>을 누르면 관리자가 확인한 뒤 반영돼요.</p>`}
    <div class="edit-row">
      ${timeInput("edit-start", start, "시작 시간")}
      <span>~</span>
      ${timeInput("edit-end", end, "종료 시간")}
    </div>
    ${ADMIN_SITE ? "" : `<input id="change-reason" class="field change-reason" maxlength="100" placeholder="사유 (선택)" autocomplete="off" aria-label="수정 요청 사유" />`}
    <div class="action-row">
      <button type="button" class="btn-ghost" data-action="cancel-edit">취소</button>
      <button type="button" class="btn-primary" data-action="save-shift" data-id="${empId}">${ADMIN_SITE ? "저장" : "요청"}</button>
    </div>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}`;
}

function renderAddExtra() {
  const button = `<button type="button" class="add-btn" data-action="open-add" aria-label="근무자 추가">${mobileDayPage() ? "+ 근무자 추가" : "+"}</button>`;
  if (!state.adding) return button;
  // 휴대폰: 누르면 글래시 박스로
  if (!isDesktop()) return button + glassCard("cancel-add", `<p class="staff-title">근무자 추가</p>${renderAddExtraForm()}`);
  return renderAddExtraForm();
}

// 글래시 박스: 그린 뒤 #app 바로 아래로 옮긴다 (움직이는 부모 안에서도 화면 가운데에 고정되게)
function glassCard(close, body, cls = "") {
  return `
    <div class="m-blur-layer" data-action="${close}" data-portal>
      <div class="m-blur-card m-glass-form ${cls}" data-stop role="dialog" aria-modal="true">${body}</div>
    </div>`;
}

function renderAddExtraForm() {
  return `
    <form class="add-form" id="add-extra">
      <input id="extra-name" class="field" placeholder="이름" required autocomplete="off" />
      ${ADMIN_SITE ? `<div class="edit-row">
        ${timeInput("extra-start", "09:00", "시작 시간")}
        <span>~</span>
        ${timeInput("extra-end", "18:00", "종료 시간")}
      </div>` : ""}
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
  let sub = isToday ? "본인 이름을 눌러 출근 · 퇴근을 찍으세요" : date > today ? "근무표에 있는 근무 예정이에요" : "지난 날짜예요";
  if (ADMIN_SITE) {
    // 근무 예정인 사람 + 근무표에 없지만 그날 기록이 있는 사람
    const ids = new Set(scheduled.map((e) => e.id));
    const extra = recordsOn(date).map((r) => employeeById(r.employeeId)).filter((e) => !ids.has(e.id));
    scheduled = [...scheduled, ...extra];
    sub = date > today ? "이름을 눌러 그날만 근무 시간을 바꿀 수 있어요" : "출근 기록이 없는 사람은 이름을 눌러 출근 처리해요";
  }

  // 자정을 넘겨 어제 시작한 근무: 오늘 화면 맨 위에서 퇴근을 찍는다
  const overnight = !ADMIN_SITE && isToday
    ? overnightOpen(today).map((r) => `
        <li class="staff-item expanded">
          <div class="staff-name-btn"><span class="staff-name">${nameLabel(employeeById(r.employeeId))}</span>${needsCheck(r) ? `<span class="badge check">퇴근 확인 필요</span>` : `<span class="badge done">어제 출근</span>`}<span class="staff-time">${shiftLabel(employeeById(r.employeeId), r.date)}</span></div>
          <div class="staff-action"><div class="action-row"><button type="button" class="btn-primary" data-action="clock-out" data-id="${r.employeeId}" data-rec-date="${r.date}">퇴근</button></div></div>
        </li>`).join("")
    : "";

  return `
    <section class="staff" aria-label="근무자">
      <p class="staff-title${mobileDayPage() ? " m-day-heading" : ""}">${isToday ? "오늘 근무자" : "근무 예정"}</p>
      <p class="sub">${sub}</p>
      <ul class="staff-list">
        ${overnight}
        ${scheduled.map((e) => renderStaffItem(e, date)).join("") || `<li class="in-empty">근무 예정인 직원이 없어요</li>`}
      </ul>
      ${ADMIN_SITE || isToday ? renderAddExtra() : ""}
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
    <button type="button" class="tour-fab" data-action="start-tour" aria-label="사용법 보기"><span>?</span>사용법</button>
    ${toastHtml()}`;
}

// 관리자 달력: 직원용 달력과 같은 화면. 출근 버튼은 없고 지난 날짜도 근무 시간을 고칠 수 있다.
function renderAdminCalendar() {
  if (isDesktop()) return renderAdminShell("calendar", `<div class="admin-cal">${renderCalendarCard()}</div>`, { center: true, wide: true });
  if (state.yearView) return renderAdminShell("calendar", renderYearView());
  return renderAdminShell("calendar", renderKc());
}

// ---------- 모바일 관리자 출·퇴근: 주간 줄 (펼치면 위아래로 이어지는 월 달력) + 고른 날 상세 ----------
const KC_ROW = 56; // 주간 줄 한 줄 높이
let kcStreamStart = ""; // 월 달력 맨 위 줄 일요일
function kcDay(d, cls = "") {
  const i = weekdayOf(d), recs = recordsOn(d);
  const warn = recs.some(needsCheck) || (isAdmin() && pendingRequestsOn(d).length > 0);
  return `<button type="button" class="kc-day${i === 0 ? " sun" : i === 6 ? " sat" : ""}${d === todayDateString() ? " today" : ""}${d === calDay() ? " on" : ""}${cls}" data-date="${d}" aria-label="${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일"><span class="kc-num">${Number(d.slice(8))}</span><span class="kc-mark${warn ? " warn" : recs.length ? " ok" : ""}"></span></button>`;
}
function kcWeek(offset) {
  const sun = addDays(calDay(), offset * 7 - weekdayOf(calDay()));
  return `<div class="kc-page"><div class="kc-row">${Array.from({ length: 7 }, (_, i) => {
    const d = addDays(sun, i);
    return kcDay(d, d.slice(0, 7) !== calDay().slice(0, 7) ? " other" : "");
  }).join("")}</div></div>`;
}
function kcStream(months) {
  const ym = state.activeYm;
  const [y, m] = ym.split("-").map(Number);
  const first = ymd(new Date(y, m - 1 - months, 1));
  kcStreamStart = addDays(first, -weekdayOf(first));
  const end = ymd(new Date(y, m + months, 0));
  let html = "";
  for (let sun = kcStreamStart; sun <= end; sun = addDays(sun, 7)) {
    const firstWeek = Number(addDays(sun, 6).slice(8)) <= 7; // 매달 1일이 든 주에서 멈춤
    html += `<div class="kc-wk${firstWeek ? " month-start" : ""}">${Array.from({ length: 7 }, (_, i) => {
      const d = addDays(sun, i);
      return kcDay(d, d.slice(0, 7) !== ym ? " dim" : "");
    }).join("")}</div>`;
  }
  return `<div class="kc-stream" id="kcStream"><div class="kc-rows" id="kcRows">${html}</div></div>`;
}
const kcRowOf = (d) => Math.round((new Date(`${d}T12:00:00`) - new Date(`${kcStreamStart}T12:00:00`)) / 864e5 / 7);
function renderKc() {
  const open = Boolean(state.monthOpen);
  const enter = state.calEnter;
  state.calEnter = false;
  return `
    <div class="kc${open ? " open" : ""}">
      <section class="kc-cal" aria-label="날짜 고르기">
        <div class="kc-wd" aria-hidden="true">${WEEKDAYS.map((w, i) => `<span${i === 0 ? ' class="sun"' : ""}>${w}</span>`).join("")}</div>
        <div class="kc-vp" id="kcVp">${open ? kcStream(state.streamMonths ?? 6) : `<div class="kc-scroller" id="kcScroller">${[-1, 0, 1].map(kcWeek).join("")}</div>`}</div>
        <button type="button" class="kc-grip" data-action="toggle-month" aria-label="${open ? "주간으로 접기" : "월 달력 펼치기"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
      </section>
      ${open ? "" : `<div class="kc-content${enter ? ` enter ${calDay() > todayDateString() ? "from-left" : calDay() < todayDateString() ? "from-right" : "fade"}` : ""}">${renderDayArea(calDay(), { closable: false })}</div>`}
    </div>`;
}
// 상단: 주간이면 < 11월 (누르면 월 달력), 월 달력이면 < 2026년 · 11월 (누르면 연도별 달력)
function kcHeader() {
  const ym = state.monthOpen ? state.activeYm : calDay().slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  // 달이 바뀌었을 때만 월 글자가 옆에서 들어온다 (뒤의 달이면 왼쪽에서, 앞의 달이면 오른쪽에서)
  const prev = state.kcHeaderYm;
  state.kcHeaderYm = ym;
  const slide = prev && prev !== ym ? (ym > prev ? " from-left" : " from-right") : "";
  return `<button type="button" class="m-cal-back" data-action="${state.monthOpen ? "open-year" : "toggle-month"}" aria-label="${state.monthOpen ? "연도별 달력 보기" : "월 달력 펼치기"}">${ICON_PREV}${state.monthOpen ? `<span class="kc-y">${y}년 · </span>` : ""}<span class="kc-m${slide}">${m}월</span></button>`;
}
// 월 달력을 넘기는 중: 연도가 같으면 연도는 그대로 두고 월만 바꿈
function kcSetHeader(ym) {
  const [y, m] = ym.split("-").map(Number);
  const year = app.querySelector(".m-cal-back .kc-y"), month = app.querySelector(".m-cal-back .kc-m");
  if (!month) return;
  const prev = state.kcHeaderYm;
  state.kcHeaderYm = ym;
  if (year && !year.textContent.startsWith(`${y}년`)) year.textContent = `${y}년 · `;
  month.textContent = `${m}월`;
  month.classList.remove("from-left", "from-right");
  void month.offsetWidth;
  month.classList.add(prev && ym < prev ? "from-right" : "from-left");
}
// 월 달력 한 줄 높이: 6줄이 하단 메뉴 위까지 꽉 차게
function kcRowH(vp) {
  const menu = app.querySelector(".m-text-nav")?.getBoundingClientRect().top ?? window.innerHeight - 70;
  return Math.max(KC_ROW, Math.floor((menu - vp.getBoundingClientRect().top - 34 - 12) / 6));
}
// 그린 뒤: 주간 줄은 가운데 주로, 월 달력은 보고 있는 달 첫 주가 맨 위로
function setupKc() {
  const vp = app.querySelector("#kcVp");
  if (!vp) return;
  if (!state.monthOpen) {
    vp.style.height = `${KC_ROW}px`;
    const sc = app.querySelector("#kcScroller");
    sc.scrollLeft = sc.clientWidth;
    let timer = null;
    sc.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!sc.isConnected || !sc.clientWidth || state.kcResizing) return;
        const idx = Math.round(sc.scrollLeft / sc.clientWidth);
        if (idx === 1) return;
        // 옆으로 넘기면 같은 요일의 지난주 · 다음 주
        state.calDay = addDays(calDay(), (idx - 1) * 7);
        resetDayUi();
        state.calEnter = true;
        render();
      }, 140);
    }, { passive: true });
    return;
  }
  const rows = app.querySelector("#kcRows"), st = app.querySelector("#kcStream");
  const h = kcRowH(vp);
  rows.style.setProperty("--kc-row", `${h}px`);
  vp.style.height = `${6 * h}px`;
  st.scrollTop = kcRowOf(`${state.activeYm}-01`) * h;
  if (!state.kcAnimating) st.classList.add("ready");
  let timer = null;
  st.addEventListener("scroll", () => {
    if (state.kcAnimating) return;
    // 맨 위 줄 토요일이 속한 달 = 지금 보는 달 → 그 달만 진하게, 상단 연월도 바로
    const sat = rows.children[Math.round(st.scrollTop / h)]?.children[6];
    const ym = sat?.dataset.date.slice(0, 7);
    if (ym && ym !== state.activeYm) {
      state.activeYm = ym;
      rows.querySelectorAll(".kc-day").forEach((b) => b.classList.toggle("dim", !b.dataset.date.startsWith(ym)));
      kcSetHeader(ym);
    }
    // 끝에 가까워지면 지금 달을 가운데로 다시 그린다
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!st.isConnected) return;
      const left = st.scrollHeight - st.scrollTop - st.clientHeight;
      if (st.scrollTop < st.clientHeight * 2 || left < st.clientHeight * 2) render();
    }, 400);
  }, { passive: true });
}
// 보이는 줄만 옮겨서 끊김 없이 (나머지 줄은 화면 밖)
function kcMove(list, done) {
  const vp = app.querySelector("#kcVp");
  list.forEach(({ el, from }) => { el.style.transform = from ? `translateY(${from}px)` : ""; });
  void vp.offsetHeight;
  vp.classList.remove("no-anim");
  list.forEach(({ el, to }) => { el.classList.add("move"); el.style.transform = to ? `translateY(${to}px)` : "none"; });
  setTimeout(done, 440);
}
// 펼치기: 고른 주는 제자리에 있다가 위아래 주가 열리며 이어진 월 달력이 화면을 채움
function kcOpen() {
  if (state.kcAnimating) return;
  window.scrollTo({ top: 0 });
  const sel = calDay();
  Object.assign(state, { monthOpen: true, activeYm: sel.slice(0, 7), streamMonths: 1, kcAnimating: true });
  resetDayUi();
  render();
  const vp = app.querySelector("#kcVp"), rows = app.querySelector("#kcRows");
  if (!vp || !rows || reducedMotion()) {
    Object.assign(state, { kcAnimating: false, streamMonths: 6 });
    render();
    return;
  }
  const h = parseFloat(rows.style.getPropertyValue("--kc-row"));
  const s = kcRowOf(sel), ms = kcRowOf(`${state.activeYm}-01`);
  const list = [];
  for (let i = ms; i <= ms + 6; i++) if (rows.children[i]) list.push({ el: rows.children[i], from: (i - s) * KC_ROW - (i - ms) * h, to: 0 });
  vp.classList.add("no-anim");
  vp.style.height = `${KC_ROW}px`;
  void vp.offsetHeight;
  vp.classList.remove("no-anim");
  vp.style.height = `${6 * h}px`;
  kcMove(list, () => {
    Object.assign(state, { kcAnimating: false, streamMonths: 6 });
    render();
  });
}
// 접기 (날짜를 누르거나 손잡이): 고른 날짜의 주 한 줄로 줄어들고 아래 상세가 다시 나타남
function kcClose() {
  if (state.kcAnimating) return;
  const vp = app.querySelector("#kcVp"), rows = app.querySelector("#kcRows"), st = app.querySelector("#kcStream");
  const finish = () => {
    Object.assign(state, { kcAnimating: false, monthOpen: false, calEnter: true });
    resetDayUi();
    render();
  };
  if (!vp || !rows || !st || reducedMotion()) return finish();
  state.kcAnimating = true;
  const h = parseFloat(rows.style.getPropertyValue("--kc-row"));
  const top = st.scrollTop, s = kcRowOf(calDay());
  st.classList.remove("ready");
  st.scrollTop = top;
  const first = Math.floor(top / h);
  const list = [];
  for (let i = first; i <= first + 7; i++) if (rows.children[i]) list.push({ el: rows.children[i], from: 0, to: (i - s) * KC_ROW - (i * h - top) });
  vp.style.height = `${KC_ROW}px`;
  kcMove(list, finish);
}

// 모바일 달력: 앞뒤 1년 반의 주를 끊김 없이 한 줄로. 보고 있는 달만 진하고 나머지 날짜는 흐리다
const WEEK_STREAM_MONTHS = 18;
function renderWeekStream() {
  const today = todayDateString();
  const active = `${state.year}-${String(state.month).padStart(2, "0")}`;
  const day = new Date(state.year, state.month - 1 - WEEK_STREAM_MONTHS, 1);
  day.setDate(1 - day.getDay());
  const end = new Date(state.year, state.month + WEEK_STREAM_MONTHS, 0);
  let html = "";
  while (day <= end) {
    for (let i = 0; i < 7; i++) {
      const date = ymd(day);
      const holiday = HOLIDAYS[date];
      const numClass = date === today ? "today" : i === 0 || holiday ? "rest" : "";
      // 매달 1일이 든 주에서 멈추도록 그 주 첫 칸에 표시
      const firstWeek = i === 0 && new Date(day.getFullYear(), day.getMonth(), day.getDate() + 6).getDate() <= 7;
      html += `<button type="button" class="cell${date.slice(0, 7) === active ? "" : " dim"}${firstWeek ? " month-start" : ""}" data-date="${date}"><span class="cell-top"><span class="day-num ${numClass}">${day.getDate()}</span></span><span class="dot${recordsOn(date).length ? " on" : ""}"></span></button>`;
      day.setDate(day.getDate() + 1);
    }
  }
  return `<div class="grid">${html}</div>`;
}

const calCell = (date) => app.querySelector(`[data-date="${date}"]`);

// 위아래로 넘기면 한 달씩 멈추고, 멈춘 달의 날짜가 진해진다 (다음 달 날짜가 새로 생기지 않고 흐린 글씨가 그대로 진해짐)
function setupMonthScroll() {
  const box = app.querySelector(".month-scroll");
  if (!box) return;
  const rows = () => box.clientHeight / 6;
  const align = () => {
    if (!box.clientHeight) return;
    box.style.setProperty("--row-h", `${rows()}px`);
    const first = box.querySelector(`[data-date="${box.dataset.active}-01"]`);
    if (first) box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top;
  };
  box.alignMonth = align;
  align();
  let timer = null;
  box.addEventListener("scroll", () => {
    if (!box.clientHeight) return;
    // 맨 위 줄 토요일이 속한 달 = 지금 보는 달
    const row = Math.round(box.scrollTop / rows());
    const sat = box.querySelector(".grid").children[row * 7 + 6];
    const ym = sat?.dataset.date.slice(0, 7);
    if (ym && ym !== box.dataset.active) {
      box.dataset.active = ym;
      [state.year, state.month] = ym.split("-").map(Number);
      box.querySelectorAll(".cell").forEach(c => c.classList.toggle("dim", !c.dataset.date.startsWith(ym)));
      const title = app.querySelector(".m-month-title");
      const year = app.querySelector(".m-year-back span");
      if (title) title.textContent = `${state.month}월`;
      if (year) year.textContent = `${state.year}년`;
    }
    // 끝에 가까워지면 지금 달을 가운데로 다시 그린다
    clearTimeout(timer);
    timer = setTimeout(() => {
      const left = box.scrollHeight - box.scrollTop - box.clientHeight;
      if (box.scrollTop < box.clientHeight * 3 || left < box.clientHeight * 3) render();
    }, 400);
  }, { passive: true });
}

// 연도 화면: 해마다 열두 달을 작게. 달을 누르면 그 달로
function miniMonth(year, month, today) {
  const start = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const nums = [];
  for (let i = 0; i < start; i++) nums.push("<span></span>");
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    nums.push(`<span class="${date === today ? "today" : (start + d - 1) % 7 === 0 ? "sun" : ""}">${d}</span>`);
  }
  const current = today.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
  return `<button type="button" class="mini-month${current ? " now" : ""}" data-action="pick-month" data-ym="${year}-${month}" aria-label="${year}년 ${month}월"><b>${month}월</b><span class="mini-days">${nums.join("")}</span></button>`;
}
function renderYearView() {
  const today = todayDateString();
  const thisYear = Number(today.slice(0, 4));
  const first = Math.min(thisYear - 5, state.year, ...store.records.map(r => Number(r.date.slice(0, 4))).filter(Number.isFinite));
  const last = Math.max(thisYear + 5, state.year);
  let html = "";
  for (let y = first; y <= last; y++) {
    html += `<section class="year-block" data-year="${y}"><h2 class="year-title${y === thisYear ? " now" : ""}">${y}년</h2><div class="year-months">${Array.from({ length: 12 }, (_, i) => miniMonth(y, i + 1, today)).join("")}</div></section>`;
  }
  return `<div class="year-view">${html}</div>`;
}


function dayWeekDates(date) {
  const base = new Date(`${date}T12:00:00`);
  base.setDate(base.getDate()-base.getDay());
  return Array.from({length:7},(_,i)=>{
    const day = new Date(base);
    day.setDate(base.getDate()+i);
    return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;
  });
}
// 요일 글자는 제자리, 날짜 줄은 옆으로 밀면 지난주 · 다음 주
function renderDayWeek(date) {
  const today=todayDateString();
  const week = (offset) => {
    const base = new Date(`${date}T12:00:00`);
    base.setDate(base.getDate()+offset);
    return `<nav class="day-week${offset ? "" : " current"}" data-offset="${offset}" aria-label="${offset ? (offset < 0 ? "지난주" : "다음 주") : "선택한 주"} 날짜"${offset ? ' aria-hidden="true"' : ""}>${dayWeekDates(ymd(base)).map((day,i)=>
      `<button type="button" class="day-week-cell${day===date ? " selected" : ""}${day===today ? " today" : ""}${i===0 ? " sun" : i===6 ? " sat" : ""}" data-date="${day}" aria-label="${Number(day.slice(5,7))}월 ${Number(day.slice(8))}일 ${WEEKDAYS[i]}요일"${day===date ? ' aria-current="date"' : ""}${offset ? ' tabindex="-1"' : ""}><span class="day-week-num">${Number(day.slice(8))}</span></button>`
    ).join("")}</nav>`;
  };
  return `<div class="day-week-wrap"><div class="day-week-labels" aria-hidden="true">${WEEKDAYS.map((w,i)=>`<span class="day-week-wd${i===0 ? " sun" : ""}">${w}</span>`).join("")}</div><div class="day-week-scroll">${[-7,0,7].map(week).join("")}</div></div>`;
}

// 주간 줄을 옆으로 넘겨 멈추면 같은 요일의 지난주 · 다음 주로
function setupWeekScroll() {
  const box = app.querySelector(".day-week-scroll");
  if (!box) return;
  box.scrollLeft = box.clientWidth;
  let timer = null;
  const settle = () => {
    if (!box.clientWidth) return;
    const idx = Math.round(box.scrollLeft / box.clientWidth);
    if (idx === 1) return;
    const base = new Date(`${app.querySelector(".day-page").dataset.detailDate}T12:00:00`);
    base.setDate(base.getDate() + (idx - 1) * 7);
    const next = ymd(base);
    state.year = base.getFullYear();
    state.month = base.getMonth() + 1;
    location.replace(`#/day/${next}`);
    // 새 주의 상세는 넘긴 쪽에서 들어온다
    requestAnimationFrame(() => app.querySelector(".day-page .day-area-inner")?.animate(
      [{ opacity: 0, transform: `translateX(${(idx - 1) * 24}px)` }, { opacity: 1, transform: "none" }],
      { duration: 300, easing: "cubic-bezier(.22,.75,.2,1)" }));
  };
  box.addEventListener("scroll", () => { clearTimeout(timer); timer = setTimeout(settle, 140); }, { passive: true });
  if ("onscrollend" in window) box.addEventListener("scrollend", () => { clearTimeout(timer); settle(); });
}

function renderDayPage(date) {
  if (ADMIN_SITE && !isDesktop()) {
    if (state.calRoute !== date) Object.assign(state, { calRoute: date, calDay: date, monthOpen: false });
    return renderAdminShell("calendar", renderKc());
  }
  const page = `
    <div class="day-page" data-detail-date="${date}">
      <div class="day-page-inner">
        <button type="button" class="round-btn back-btn" data-action="go-home" aria-label="달력으로 돌아가기">${ICON_PREV}</button>
        ${ADMIN_SITE && !isDesktop() ? renderDayWeek(date) : ""}
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
      ${link("#/schedule", "스케줄", "schedule")}
      ${link("#/calendar", "출·퇴근", "calendar")}
      ${link("#/records", "급여", "records")}
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
        <td class="name"><div class="name-info"><span class="name-cell"><span class="swatch" style="background:${copyDisplayColor(e.color)}" title="근무표 색 (자동)"></span>${nameLabel(e)}</span><span class="muted small">${esc(e.phone ? formatPhone(e.phone) : "")}</span></div></td>
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
          `<button type="button" class="status${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}" title="직원으로 바꾸면 월급제, 알바로 바꾸면 시급제가 돼요">${isManager(e) ? "직원" : "알바"}</button>`
        }</td>
        <td class="manage-cell"><button type="button" class="danger" data-action="remove-employee" data-id="${e.id}">삭제</button></td>
      </tr>`,
    )
    .join("");

  return renderAdminShell(
    "employees",
    `
    <form class="toolbar" id="add-employee" style="margin-bottom:32px">
      <div><span class="f-label" id="f-role-label">구분</span><div class="seg" role="radiogroup" aria-labelledby="f-role-label"><label><input type="radio" name="f-role" value="alba" checked /><span>알바</span></label><label><input type="radio" name="f-role" value="manager" /><span>직원</span></label></div></div>
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
      구분을 <b>직원</b>로 바꾸면 자동으로 월급제(4대보험), <b>알바</b>로 바꾸면 시급제(3.3%)가 돼요. 알바인데 월급제면 급여 칸의 <b>월급으로</b>를 눌러요. 월급·식대·공제액은 급여 화면에서 이름 옆 <b>명세서</b>를 눌러 입력해요.`,
    )}`,
    { center: true },
  );
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
        <p class="staff-link-title">직원용 달력 · 매장 코드 <b>${codeLabel()}</b><button type="button" class="code-copy" data-action="copy-store-code" aria-label="매장 코드 복사" title="매장 코드 복사">${ICON_COPY}</button></p>
        ${isDesktop() ? `<p class="staff-link-url">${esc(staffUrl())}</p>` : ""}
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

function mobilePayrollMonthSelect(calendar = false) {
  const selected = calendar ? `${state.year}-${String(state.month).padStart(2,"0")}` : state.payroll.month;
  const now = new Date();
  const base = now.getFullYear()*12+now.getMonth();
  const monthIndex = ym => Number(ym.slice(0,4))*12+Number(ym.slice(5,7))-1;
  const earliest = Math.min(base-60, monthIndex(selected), ...store.records.map(r=>monthIndex(r.date)).filter(Number.isFinite));
  const latest = Math.max(base+12, monthIndex(selected));
  let options = "";
  for (let i=earliest;i<=latest;i++) {
    const y=Math.floor(i/12),m=i%12+1,value=`${y}-${String(m).padStart(2,"0")}`;
    options += `<option value="${value}"${calendar ? ` data-short="${m}월"` : ""}${value===selected ? " selected" : ""}>${y}년 ${m}월</option>`;
  }
  return `<select class="field m-payroll-month-select${calendar ? " m-calendar-month-select" : ""}" ${calendar ? 'data-calendar-month="true"' : 'data-payroll="month"'} aria-label="${calendar ? "출퇴근 조회 월" : "급여 조회 월"}">${options}</select>`;
}

function mobilePayEmployeeSelect(id) {
  return `<select class="field m-pay-employee-select" data-pay-employee="true" aria-label="급여 직원 선택">${store.employees.map(e=>`<option value="${esc(e.id)}"${e.id===id ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select>`;
}

// 하단 메뉴 순서 (왼쪽부터)
const M_TABS = ["employees", "schedule", "calendar", "records"];
const M_TAB_LABELS = { employees: "직원", schedule: "스케줄", calendar: "출·퇴근", records: "급여" };

function renderMobileShell(active, content) {
  const tab = (key, label, i) =>
    `<a href="#/${key}" class="m-tab${active === key ? " active" : ""}"${active === key ? ' aria-current="page"' : ""} aria-label="${label}"><span>${label}</span></a>`;
  const navIndex = Math.max(0, M_TABS.indexOf(active));
  const accountIcon = '<svg class="m-account-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5z"/></svg>';
  const logoutIcon = '<svg class="m-exit-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>';
  return `
    <header class="m-top${["calendar","records"].includes(route().name) || mobileAdminCal() ? " m-calendar-top" : ["day","pay-detail"].includes(route().name) ? ` m-day-top${route().name === "pay-detail" ? " m-pay-detail-top" : ""}` : ""}">
      ${mobileAdminCal() ? (state.yearView && route().name === "calendar" ? `<div class="m-cal-heading"></div>` : kcHeader()) : ""}
      ${route().name === "records" ? mobilePayrollMonthSelect() : ""}
      ${route().name === "day" && !mobileAdminCal() ? `<button type="button" class="m-day-back m-back-label" data-action="go-home" aria-label="달력으로 돌아가기">${ICON_PREV}<span>${Number(route().date.slice(5, 7))}월</span></button>` : ""}
      ${route().name === "pay-detail" ? `<a class="m-day-back" href="#/records" aria-label="급여 목록으로 돌아가기">${ICON_PREV}</a>` : ""}
      ${route().name === "pay-detail" ? `<div class="m-pay-header-person">${mobilePayEmployeeSelect(route().id)}</div>` : `${["employees", "schedule"].includes(route().name) ? `<h1 class="m-page-title">${esc(storeName())}</h1>` : route().name === "employee-detail" && employeeById(route().id) ? `<a class="m-cal-back" href="#/employees" aria-label="직원 목록으로 돌아가기">${ICON_PREV}<span>${esc(employeeById(route().id).name)}</span></a>` : `<span class="m-store" aria-hidden="true"></span>`}${M_TABS.includes(route().name === "day" && mobileAdminCal() ? "calendar" : route().name) && !(state.yearView && route().name === "calendar") ? `<button type="button" class="m-tour" data-action="start-tour" aria-label="도움말" title="도움말">?</button>` : ""}`}
      ${route().name === "pay-detail" ? `<span class="m-pay-download-gap" aria-hidden="true"></span>` : demoLoaded ? `<a class="m-login" href="#/login" aria-label="로그인" title="로그인">${accountIcon}</a>` : `<a class="m-login" href="#/mypage" aria-label="마이페이지" title="마이페이지">${accountIcon}</a>`}
    </header>
    ${demoLoaded ? "" : `<div class="m-staff-shortcut">${staffCalLink("m-staff-link")}</div>`}
    ${demoLoaded ? `<p class="demo-bar">샘플 매장을 둘러보는 중이에요. <a href="#/signup">매장 등록</a> · <a href="#/login">로그인</a></p>` : ""}
    ${renderInstallHint()}
    <main class="m-main m-screen-${active}${state.pageEnter ? " page-enter" : ""}">${content}</main>
    <nav class="m-tabbar m-text-nav" style="--nav-position:${navIndex}" aria-label="관리자 메뉴">
      <div class="m-text-links">
        <span class="m-text-pill" aria-hidden="true"></span>
        ${M_TABS.map((key, i) => tab(key, M_TAB_LABELS[key], i)).join("")}
      </div>
    </nav>
    ${renderSheet()}
    ${toastHtml()}`;
}

// 아래에서 올라오는 시트 (근무표 칸 편집 · 직원 정보 · 직원 추가 · 급여 내역)
function renderSheet() {
  let body = "";
  let close = "close-sheet";
  const r = route();
  if (r.name === "schedule" && state.slotEdit && isDesktop()) {
    body = renderSlotPanel();
    close = "cancel-slot";
  } else if (state.sheet?.type === "emp" && employeeById(state.sheet.id)) body = renderEmpSheet(employeeById(state.sheet.id));
  else if (state.sheet?.type === "add-emp") {
    // 휴대폰: 직원 추가는 아래 시트 대신 글래시 박스로
    if (!isDesktop())
      return `
    <div class="m-blur-layer" data-action="close-sheet">
      <div class="m-blur-card m-add-emp-card" data-stop role="dialog" aria-modal="true" aria-label="직원 추가">${renderAddEmpSheet()}</div>
    </div>`;
    body = renderAddEmpSheet();
  }
  else if (state.sheet?.type === "pay" && employeeById(state.sheet.id)) body = renderPaySheet(employeeById(state.sheet.id));
  if (!body) return "";
  const enter = state.sheetEnter;
  return `
    <div class="sheet-backdrop${enter ? " enter" : ""}" data-action="${close}">
      <div class="sheet" data-stop role="dialog" aria-modal="true">
        <span class="sheet-grip" aria-hidden="true"></span>
        <button type="button" class="m-sheet-close" data-action="${close}" aria-label="편집 창 닫기">닫기 <span aria-hidden="true">×</span></button>
        ${body}
      </div>
    </div>`;
}

// ---------- 직원 ----------
function weeklySummary(e) {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((wd) => e.weekly[wd]);
  if (!days.length) return "근무 요일 없음";
  return days.map((wd) => `${WEEKDAYS[wd]} ${rangeLabel(e.weekly[wd])}`).join(" · ");
}

function renderMyPage() {
  const email = cloud?.auth.currentUser?.email || "";
  return renderAdminShell("mypage", `
    <div class="m-pay-detail-heading"><a class="m-pay-back" href="#/calendar" aria-label="출퇴근으로 돌아가기">${ICON_PREV}</a><div class="m-pay-person"><h1>마이페이지</h1></div></div>
    <section class="m-profile-card"><h2>${esc(storeName())}</h2>${email ? `<p>${esc(email)}</p>` : ""}<p>매장 코드 ${codeLabel()}</p></section>
    <button type="button" class="btn-ghost m-profile-logout" data-action="logout">로그아웃</button>`);
}

function renderEmployeesMobile() {
  const list = store.employees
    .map(
      (e, i) => `
      <button type="button" class="m-row" style="--i:${i}" data-action="open-employee-page" data-id="${e.id}">
        <span class="swatch big" style="background:${copyDisplayColor(e.color)}"></span>
        <span class="m-row-body">
          <b>${esc(e.name)}${isManager(e) ? `<em class="m-chip">직원</em>` : ""}${e.active ? "" : `<em class="m-chip off">비활성</em>`}</b>
          <small>${esc(weeklySummary(e))}</small>
        </span>
        <span class="m-chev">${ICON_CHEVRON}</span>
      </button>`,
    )
    .join("");
  const active = store.employees.filter((e) => e.active);
  const managers = active.filter(isManager).length;
  const inactive = store.employees.length - active.length;
  return renderAdminShell(
    "employees",
    `
    <div class="m-hero m-emp-hero">
      <small>함께 일하는 직원</small>
      <strong>${active.length}명</strong>
      <div class="m-hero-meta">
        <span>알바 ${active.length - managers} · 직원 ${managers}${inactive ? ` · 비활성 ${inactive}` : ""}</span>
        <button type="button" class="m-add" data-action="open-sheet" data-sheet="add-emp">+ 직원 추가</button>
      </div>
    </div>
    ${demoLoaded ? "" : renderStaffLink()}
    <div class="m-list">${list || `<p class="m-empty">아직 직원이 없어요.<br /><b>+ 직원 추가</b>로 등록해주세요.</p>`}</div>`,
  );
}

// 직원 상세 시급 칸: 숫자 길이만큼만 (바로 옆에 '원')
const wageWidth = (text) => `${Math.max(2, String(text).length) * 0.6 + 0.15}em`;
app.addEventListener("input", (e) => {
  if (e.target.matches?.(".m-emp-wage input")) e.target.style.width = wageWidth(e.target.value);
});

function renderEmployeePage(id) {
  const emp = employeeById(id);
  if (!emp) return renderEmployees();
  if (isDesktop()) {
    const content = renderEmpSheet(emp).replace('data-action="close-sheet"', 'data-action="employee-list"');
    return renderAdminShell("employees", `
    <section class="m-employee-detail">
      <div class="m-pay-detail-heading">
        <a class="m-pay-back" href="#/employees" aria-label="직원 목록으로 돌아가기">${ICON_PREV}</a>
        <div class="m-pay-person"><h1>${esc(emp.name)}</h1>${emp.phone ? `<p>${esc(formatPhone(emp.phone))}</p>` : ""}</div>
      </div>
      ${content}
    </section>`);
  }
  // 휴대폰: 요약 카드(급여) → 근무 요일 카드 → 설정 카드 (이름 · 뒤로가기는 상단 왼쪽)
  const order = [1, 2, 3, 4, 5, 6, 0];
  const salaried = isSalaried(emp);
  const days = order.filter((wd) => emp.weekly[wd]);
  const weekHours = days.reduce((sum, wd) => sum + hoursBetween(kstIso("2026-01-05", emp.weekly[wd].start), endIso("2026-01-05", emp.weekly[wd].start, emp.weekly[wd].end)), 0);
  // 두 칸 중 지금 상태는 표시만, 다른 칸을 누르면 바뀐다
  const seg = (action, current, a, b) => `<div class="m-emp-seg"><button type="button" class="m-emp-toggle${current ? " on" : ""}"${current ? "" : ` data-action="${action}" data-id="${emp.id}"`}>${a}</button><button type="button" class="m-emp-toggle${current ? "" : " on"}"${current ? ` data-action="${action}" data-id="${emp.id}"` : ""}>${b}</button></div>`;
  return renderAdminShell("employees", `
    <section class="m-emp-detail">
      <div class="m-hero m-emp-pay">
        <small>${salaried ? "월급제 (4대보험)" : "시급"}</small>
        ${salaried
          ? `<strong>급여 화면에서 입력</strong>`
          : `<label class="m-emp-wage"><input id="m-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(emp.hourlyWage)}" data-wage="${emp.id}" aria-label="${esc(emp.name)} 시급" style="width:${wageWidth(formatMoney(emp.hourlyWage))}" /><span>원</span></label>`}
        <div class="m-hero-meta"><span>${days.length ? `주 ${days.length}일 · ${hour1(weekHours)}시간` : "근무 요일 없음"}${emp.phone ? ` · ${esc(formatPhone(emp.phone))}` : ""}</span></div>
      </div>
      <h2 class="m-sec-title">근무 요일</h2>
      <div class="m-emp-week">
        ${order.map((wd) => `
        <label class="m-emp-day${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}">
          <span>${WEEKDAYS[wd]}</span>
          <input class="field range" type="text" placeholder="휴무" value="${formatRange(emp.weekly[wd])}" data-weekly="${wd}" data-id="${emp.id}" aria-label="${esc(emp.name)} ${WEEKDAYS[wd]}요일 근무 시간" />
        </label>`).join("")}
      </div>
      <h2 class="m-sec-title">설정</h2>
      <div class="m-emp-settings">
        <div class="m-emp-set"><span>급여 방식</span>${seg("toggle-paytype", !salaried, "시급제", "월급제")}</div>
        <div class="m-emp-set"><span>구분</span>${seg("toggle-role", !isManager(emp), "알바", "직원")}</div>
        <div class="m-emp-set"><span>상태</span>${seg("toggle-active", emp.active, "재직중", "비활성")}</div>
      </div>
      ${salaried ? `<p class="m-emp-note">월급 · 식대 · 공제액은 급여 화면에서 이 직원을 눌러 <b>명세서</b>에서 입력해요.</p>` : ""}
      <button type="button" class="m-emp-remove" data-action="remove-employee" data-id="${emp.id}">직원 삭제</button>
    </section>`);
}

function renderEmpSheet(e) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const changeIcon = '<svg class="employee-change-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 2a8 8 0 0 0 0 16h1.3A11 11 0 0 1 7 10H4l5-5 5 5h-3a8 8 0 0 0 8 8 8 8 0 0 0 0-16h-1.3A11 11 0 0 1 21 10h3l-5 5-5-5h3a8 8 0 0 0-8-8Z" transform="translate(0 2) scale(.92)"/></svg>';
  const payToggle = `<button type="button" class="m-toggle${isSalaried(e) ? " on" : ""}" data-action="toggle-paytype" data-id="${e.id}" aria-label="급여 방식 변경: 현재 ${isSalaried(e) ? "월급제" : "시급제"}">${isSalaried(e) ? "월급제" : "시급제"}${changeIcon}</button>`;
  return `
    <div class="sheet-head">
      <span class="swatch big" style="background:${copyDisplayColor(e.color)}"></span>
      <div><h2>${esc(e.name)}</h2>${e.phone ? `<small>${esc(formatPhone(e.phone))}</small>` : ""}</div>
    </div>
    <div class="m-week">
      ${order
        .map(
          (wd) => `
        <label class="m-week-row${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}">
          <span>${WEEKDAYS[wd]}</span>
          <input class="field range" type="text" placeholder="휴무" value="${formatRange(e.weekly[wd])}" data-weekly="${wd}" data-id="${e.id}" aria-label="${esc(e.name)} ${WEEKDAYS[wd]}요일 근무 시간" />
        </label>`,
        )
        .join("")}
    </div>
    ${
      isSalaried(e)
        ? `<div class="m-paytype-heading"><p class="sheet-label">급여</p>${payToggle}</div><p class="sheet-note">월급제(4대보험)예요. 월급·식대·공제액은 급여 화면에서 이 직원을 눌러 <b>수당 · 명세서</b>에서 입력해요.</p>`
        : `<div class="m-wage"><label class="sheet-label" for="m-wage">시급</label><input id="m-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(e.hourlyWage)}" data-wage="${e.id}" aria-label="${esc(e.name)} 시급" /><span>원</span>${payToggle}</div>`
    }
    <div class="m-toggles">
      <button type="button" class="m-toggle${e.active ? " on" : ""}" data-action="toggle-active" data-id="${e.id}">${e.active ? "재직중" : "비활성"}${changeIcon}</button>
      <button type="button" class="m-toggle${isManager(e) ? " on" : ""}" data-action="toggle-role" data-id="${e.id}">${isManager(e) ? "직원" : "알바"}${changeIcon}</button>
    </div>
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
      <div class="seg" role="radiogroup" aria-labelledby="f-role-label"><label><input type="radio" name="f-role" value="alba" checked /><span>알바</span></label><label><input type="radio" name="f-role" value="manager" /><span>직원</span></label></div>
      <label class="sheet-label" for="f-name">이름</label>
      <input id="f-name" class="field" placeholder="홍길동" required autocomplete="off" />
      <label class="sheet-label" for="f-phone">전화번호 (선택)</label>
      <input id="f-phone" class="field phone" type="text" inputmode="numeric" placeholder="010-0000-0000" />
      <div class="f-pay-area">
      <div class="f-wage-wrap">
        <label class="sheet-label" for="f-wage">시급(원)</label>
        <input id="f-wage" class="field money" type="text" inputmode="numeric" value="${formatMoney(DEFAULT_WAGE)}" required />
      </div>
      <div class="f-mgr-group">
      <div class="f-mgr-wrap" hidden>
        <label class="sheet-label" for="f-salary">기본급 (월급)</label>
        <input id="f-salary" class="field money" type="text" inputmode="numeric" placeholder="2,000,000" />
        <label class="sheet-label" for="f-meal">식대 (선택)</label>
        <input id="f-meal" class="field money" type="text" inputmode="numeric" placeholder="0 · 비과세, 월 20만 원까지" />
      </div>
      <p class="f-mgr-note" hidden>공제액(4대보험·근로소득세)은 추가한 뒤 급여 화면 <b>명세서</b>에서 입력해요.</p>
      </div>
      </div>
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
      // 누른 근무자는 그 자리에서 바로 수정
      if (state.slotEdit?.empId === e.id && String(state.slotEdit.wd) === String(wd))
        return `<div class="m-slot-inline m-slot-edit" id="m-slot-edit">${renderSlotPanel()}</div>`;
      const hours = hoursBetween(kstIso("2026-01-05", shift.start), endIso("2026-01-05", shift.start, shift.end));
      return `
        <button type="button" class="m-shift m-row" style="--i:${i};--emp:${copyDisplayColor(e.color)}" data-action="edit-slot" data-wd="${wd}" data-id="${e.id}" data-start="${toMin(shift.start)}">
          <span class="swatch big" style="background:${copyDisplayColor(e.color)}"></span>
          <span class="m-shift-body"><b>${esc(e.name)}${isManager(e) ? `<em class="m-chip">직원</em>` : ""}</b><small>${shift.start} ~ ${shift.end}</small></span>
          <span class="m-shift-hours">${hour1(hours)}시간</span>
          <span class="m-chev">${ICON_CHEVRON}</span>
        </button>`;
    })
    .join("");
  return `
    ${rows || `<p class="m-empty">${WEEKDAYS[wd]}요일 근무자가 없어요.</p>`}`;
}

// ---------- 이전 근무표 (목록) ----------
// 근무표를 반영할 때마다 직원별로 남는 기록(weeklyHistory: 시작 날짜 + 요일 시간)을 시작 날짜별로 모아 보여 준다
function scheduleVersions() {
  const froms = new Set();
  let hasBase = false;
  for (const e of store.employees) {
    if (e.weeklyBase) hasBase = true;
    for (const h of e.weeklyHistory ?? []) if (h?.from) froms.add(h.from);
  }
  const list = [...froms].sort().reverse().map((from) => ({ key: from, from }));
  if (hasBase || !list.length) list.push({ key: "base", from: null });
  const today = todayDateString();
  const current = list.find((v) => !v.from || v.from <= today);
  return list.map((v) => ({ ...v, now: v === current, upcoming: Boolean(v.from && v.from > today) }));
}
const weeklyAt = (emp, from) => (from ? weeklyOn(emp, from) : (emp.weeklyBase ?? emp.weekly));
function versionSummary(from) {
  let shifts = 0, hours = 0;
  for (const e of store.employees.filter((x) => x.active)) {
    for (const sh of Object.values(weeklyAt(e, from) ?? {})) {
      if (!sh) continue;
      shifts += 1;
      hours += hoursBetween(kstIso("2026-01-05", sh.start), endIso("2026-01-05", sh.start, sh.end));
    }
  }
  return `한 주 ${shifts}근무 · ${hour1(hours)}시간`;
}
function renderVersionDetail(from) {
  return `<div class="m-ver-detail">${[1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const people = store.employees.filter((e) => e.active && weeklyAt(e, from)?.[wd])
      .map((e) => ({ e, sh: weeklyAt(e, from)[wd] })).sort((a, b) => (a.sh.start < b.sh.start ? -1 : 1));
    return `<p><b class="${wd === 0 ? "sun" : ""}">${WEEKDAYS[wd]}</b><span>${people.length ? people.map(({ e, sh }) => `${esc(e.name)} ${rangeLabel(sh)}`).join(" · ") : "근무 없음"}</span></p>`;
  }).join("")}</div>`;
}
function renderScheduleHistory() {
  const versions = scheduleVersions();
  return `
    <div class="m-blur-layer" data-action="close-sched-history">
      <div class="m-blur-card m-ver-card" role="dialog" aria-modal="true" aria-label="이전 근무표">
        <p class="m-blur-title">근무표 목록</p>
        <div class="m-ver-list">${versions.map((v) => `
          <div class="m-ver${state.historyView === v.key ? " open" : ""}">
            <button type="button" class="m-ver-head" data-action="view-sched-version" data-key="${esc(v.key)}">
              <b>${v.from ? `${v.from.replaceAll("-", ".")}부터` : "처음 근무표"}${v.now ? `<em>지금</em>` : v.upcoming ? `<em class="next">예정</em>` : ""}</b>
              <small>${versionSummary(v.from)}</small>
            </button>
            ${state.historyView === v.key && v.from && versions.length > 1 ? `<button type="button" class="m-ver-del" data-action="delete-sched-version" data-key="${esc(v.key)}">삭제</button>` : ""}
            ${state.historyView === v.key ? `${renderVersionDetail(v.from)}<button type="button" class="m-blur-btn m-ver-load" data-action="load-sched-version" data-key="${esc(v.key)}"><b>이 근무표 불러오기</b><small>불러온 뒤 시작 날짜를 넣고 근무표 반영을 눌러요</small></button>` : ""}
          </div>`).join("")}</div>
        <button type="button" class="m-blur-close" data-action="close-sched-history" data-close>닫기</button>
      </div>
    </div>`;
}
// 근무표 하나 지우기: 직원마다 그 시작 날짜 기록을 빼고, 지금 근무표는 남은 것 중 마지막으로
// (이미 찍힌 출근 기록은 건드리지 않는다)
function deleteScheduleVersion(from) {
  for (const e of store.employees) {
    if (!e.weeklyHistory?.some((h) => h.from === from)) continue;
    e.weeklyHistory = e.weeklyHistory.filter((h) => h.from !== from);
    e.weekly = structuredClone(e.weeklyHistory.at(-1)?.weekly ?? e.weeklyBase ?? e.weekly);
  }
  state.historyView = null;
  save();
}

// 고른 근무표를 초안으로: 지금 근무표와 다른 요일만 초안에 넣는다
function loadScheduleVersion(key) {
  const v = scheduleVersions().find((x) => x.key === key);
  if (!v) return;
  const weekly = {};
  for (const e of store.employees.filter((x) => x.active)) {
    const target = weeklyAt(e, v.from) ?? {};
    for (let wd = 0; wd < 7; wd++) {
      if (JSON.stringify(target[wd] ?? null) === JSON.stringify(e.weekly[wd] ?? null)) continue;
      weekly[e.id] = { ...weekly[e.id], [wd]: target[wd] ?? null };
    }
  }
  schedWork().weekly = weekly;
  state.historyOpen = false;
  state.historyView = null;
  state.slotEdit = null;
}

function renderScheduleMobile() {
  const wd = state.schedDay ?? weekdayOf(todayDateString());
  const meta = schedMeta();
  const count = (d) => store.employees.filter((e) => e.active && effWeekly(e)[d]).length;
  // 한 주 전체 근무 수 · 시간
  let shifts = 0, weekHours = 0;
  store.employees.filter((e) => e.active).forEach((e) => Object.values(effWeekly(e)).forEach((sh) => {
    if (!sh) return;
    shifts += 1;
    weekHours += hoursBetween(kstIso("2026-01-05", sh.start), endIso("2026-01-05", sh.start, sh.end));
  }));
  return renderAdminShell(
    "schedule",
    `
    <div class="m-hero m-sched-hero">
      <label class="m-period">
        <small>적용 시작일</small>
        <input class="sc-period" value="${esc(normalizePeriod(meta.period ?? ""))}" data-meta="period" inputmode="numeric" placeholder="예: 2026.11.09" aria-label="근무표 적용 시작일" />
      </label>
      <div class="m-hero-meta">
        <span>한 주 ${shifts}근무 · ${hour1(weekHours)}시간</span>
        <button type="button" class="m-add m-share-btn" data-action="schedule-share">공유하기</button>
      </div>
    </div>
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
    <h2 class="m-day-heading">${WEEKDAYS[wd]}요일 근무자 <span>${count(wd)}명</span></h2>
    <div class="m-shifts m-list${state.dayListEnter ? " enter" : ""}" id="sched-day-list">${renderDayShifts()}</div>
    <button type="button" class="m-add-shift" data-action="edit-slot" data-wd="${wd}" data-start="540">+ ${WEEKDAYS[wd]}요일 근무자 추가</button>
    ${state.slotEdit && !state.slotEdit.empId ? glassCard("cancel-slot", renderSlotPanel()) : ""}
    <div id="sched-status">${renderSchedStatus()}</div>
    <div class="m-btns m-pay-exports m-savebar">
      <button type="button" class="btn-ghost" data-action="open-sched-history">목록</button>
      <button type="button" class="btn-primary" data-action="schedule-save"${hasDraft() ? "" : " disabled"}>근무표 반영</button>
    </div>
    ${state.historyOpen ? renderScheduleHistory() : ""}`,
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
      <button type="button" class="m-row m-pay" style="--i:${i}" data-action="open-pay-page" data-id="${r.emp.id}">
        <span class="swatch big" style="background:${copyDisplayColor(r.emp.color)}"></span>
        <span class="m-row-body"><b>${esc(r.emp.name)}</b><small>${r.days}일 · ${hrs(r.hours)}</small></span>
        <span class="m-pay-net net">${r.net === null ? `<small class="need">공제 입력 필요</small>` : won(r.net)}</span>
        <span class="m-chev">${ICON_CHEVRON}</span>
      </button>`,
    )
    .join("");
  return renderAdminShell(
    "records",
    `
    ${payCheckNotice(month)}
    <div class="m-hero m-pay-hero">
      <button type="button" class="m-hero-dl" data-action="open-exports" aria-label="엑셀 · 명세서 받기" title="엑셀 · 명세서 받기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg></button>
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
    ${state.exportsOpen ? `
    <div class="m-blur-layer" data-action="close-exports">
      <div class="m-blur-card" role="dialog" aria-modal="true" aria-label="엑셀 · 명세서 받기">
        <p class="m-blur-title">${y}년 ${m}월</p>
        <button type="button" class="m-blur-btn" data-action="export-ledger"${rows.length ? "" : " disabled"}><b>엑셀 파일</b><small>세무사에게 보낼 급여대장</small></button>
        <button type="button" class="m-blur-btn" data-action="payslip-pdf-all"${rows.length ? "" : " disabled"}><b>명세서 PDF</b><small>${rows.length}명 명세서를 한 번에</small></button>
        <button type="button" class="m-blur-close" data-action="close-exports" data-close>닫기</button>
      </div>
    </div>` : ""}
    ${renderPayslipModal()}`,
  );
}

function renderPayPage(id, month) {
  const emp = employeeById(id);
  if (!emp) return renderRecords();
  state.payroll.month = month;
  const summary = payrollRow(emp, month, monthRecords(month, emp.id));
  return renderAdminShell("records", `
    <section class="m-pay-detail" aria-label="직원 급여 상세">
      ${renderPaySheet(emp)}
    </section>
    ${renderPayslipModal()}`);
}

function previewPayslipFromAmount(id) {
  const emp = employeeById(id);
  const source = app.querySelector(".m-pay-amount");
  if (!emp || !source || source.classList.contains("is-payslip")) return;
  const original = source.innerHTML;
  const amount = source.querySelector(":scope > strong");
  const amountMarker = document.createElement("span");
  if (amount) { amountMarker.textContent = amount.textContent; amountMarker.style.display = "inline-block"; amount.replaceChildren(amountMarker); }
  const amountRect = amount ? amountMarker.getBoundingClientRect() : null;
  const cardRect = source.getBoundingClientRect();
  const amountStyle = amount ? getComputedStyle(amount) : null;
  const amountFont = amountStyle ? {family:amountStyle.fontFamily,size:amountStyle.fontSize,weight:amountStyle.fontWeight,color:amountStyle.color} : null;
  const amountText = amount?.textContent;
  const month = state.payroll.month;
  const previousHeight = source.getBoundingClientRect().height;
  source.classList.remove("m-hero", "small");
  source.classList.add("is-payslip");
  source.setAttribute("aria-label", "급여명세서 미리보기");
  source.innerHTML = `<div class="pay-preview-toolbar"><button type="button" class="pay-preview-close m-payslip-preview-btn" aria-label="금액 보기로 돌아가기">닫기</button></div><div class="pay-inline-paper">${renderPayslip(payrollRow(emp,month,monthRecords(month,id)),month)}</div>`;
  const paper = source.querySelector(".pay-inline-paper");
  const cardStyle = getComputedStyle(source);
  const paperWidth = source.clientWidth - parseFloat(cardStyle.paddingLeft) - parseFloat(cardStyle.paddingRight);
  // CSS zoom과 Range 좌표를 섞지 않고 실제 transform 좌표계 하나로 통일한다.
  const scale = Math.min(1,paperWidth/794);
  const paperFrame = document.createElement("div");
  paperFrame.className = "pay-inline-frame";
  paper.before(paperFrame);
  paperFrame.append(paper);
  // 명세서 용지 오른쪽 위: PDF 다운로드 (연한 분홍)
  paperFrame.insertAdjacentHTML("beforeend", `<button type="button" class="pay-inline-download" data-action="payslip-pdf-one" data-id="${esc(emp.id)}" aria-label="명세서 PDF 다운로드" title="명세서 PDF 다운로드"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg></button>`);
  paper.style.transformOrigin = "top left";
  paper.style.transform = `scale(${scale})`;
  paperFrame.style.height = `${paper.offsetHeight*scale}px`;
  const expandedHeight = source.getBoundingClientRect().height;
  let clearAmountMorph = () => {};
  if (!reducedMotion()) {
    const target = source.querySelector(".ps-net strong");
    if (amountRect && amountFont && target && target.textContent.trim() === amountText.trim()) {
      const targetMarker = document.createElement("span");
      targetMarker.textContent = target.textContent;
      Object.assign(targetMarker.style, {display:"inline-block",font:"inherit",color:"inherit",letterSpacing:"inherit"});
      target.replaceChildren(targetMarker);
      const to = targetMarker.getBoundingClientRect();
      const targetStyle = getComputedStyle(target);
      const color = targetStyle.color;
      const destination = source.getBoundingClientRect();
      // 숫자는 축소 종이 밖의 독립 레이어에서 계속 보이며 이동한다.
      // 끝나면 같은 DOM 숫자를 명세서 자리로 옮겨 페이드/글자 교체를 피한다.
      target.textContent = amountText;
      target.style.visibility = "hidden";
      source.append(targetMarker);
      const left = to.left-destination.left-source.clientLeft;
      const top = to.top-destination.top-source.clientTop;
      Object.assign(targetMarker.style, {
        position:"absolute",left:`${left}px`,top:`${top}px`,zIndex:"5",pointerEvents:"none",
        fontFamily:targetStyle.fontFamily,fontSize:`${parseFloat(targetStyle.fontSize)*scale}px`,
        fontWeight:targetStyle.fontWeight,lineHeight:`${to.height}px`,color,
        letterSpacing:"0px",whiteSpace:"nowrap",transformOrigin:"top left"
      });
      const dx = amountRect.left-cardRect.left-source.clientLeft-left;
      const dy = amountRect.top-cardRect.top-source.clientTop-top;
      const move = targetMarker.animate([
        {transform:`translate(${dx}px,${dy}px) scale(${amountRect.width/to.width},${amountRect.height/to.height})`,color:amountFont.color},
        {transform:"translate(0px,0px) scale(1)",color}
      ],{duration:600,easing:"cubic-bezier(.22,.75,.2,1)",fill:"both"});
      let settled=false;
      clearAmountMorph=()=>{
        if(settled) return;
        settled=true;
        target.replaceChildren(targetMarker);
        targetMarker.removeAttribute("style");
        Object.assign(targetMarker.style,{display:"inline-block",font:"inherit",color:"inherit",letterSpacing:"inherit"});
        target.style.removeProperty("visibility");
        move.cancel();
      };
      move.finished.then(clearAmountMorph,()=>{});
    }
    // height 애니메이션 대신 한 번 배치한 결과를 clip/transform으로 표시한다.
    const hiddenBottom = Math.max(0, expandedHeight-previousHeight);
    source.animate([{clipPath:`inset(0 0 ${hiddenBottom}px 0 round 18px)`},{clipPath:"inset(0 0 0px 0 round 18px)"}],{duration:460,easing:"cubic-bezier(.22,.75,.2,1)"});
    for (let sibling=source.nextElementSibling;sibling;sibling=sibling.nextElementSibling) {
      sibling.animate([{transform:`translateY(${-hiddenBottom}px)`},{transform:"translateY(0)"}],{duration:460,easing:"cubic-bezier(.22,.75,.2,1)"});
    }
    paper.querySelectorAll(".payslip > :not(.ps-net), .ps-net > span").forEach(el =>
      el.animate([{opacity:0},{opacity:1}],{duration:260,delay:220,fill:"both"})
    );
  }
  source.querySelector(".pay-preview-close").addEventListener("click", () => {
    clearAmountMorph();
    const from = source.getBoundingClientRect().height;
    source.classList.remove("is-payslip");
    source.classList.add("m-hero", "small");
    source.removeAttribute("aria-label");
    source.innerHTML = original;
    const to = source.getBoundingClientRect().height;
    if (!reducedMotion()) {
      source.animate([{opacity:.7},{opacity:1}],{duration:180,easing:"ease-out"});
      for (let sibling=source.nextElementSibling;sibling;sibling=sibling.nextElementSibling) {
        sibling.animate([{transform:`translateY(${from-to}px)`},{transform:"translateY(0)"}],{duration:320,easing:"cubic-bezier(.22,.75,.2,1)"});
      }
    }
  });
}

function renderPaySheet(emp) {
  const { month } = state.payroll;
  const recs = monthRecords(month, emp.id);
  // 수당을 그 자리에서 고치는 중이면 입력한 대로 미리 계산
  const editing = !isDesktop() && state.payslipId === emp.id;
  const r = editing ? payrollRow(emp, month, recs, allowWithNew(), state.salDraft ? normalizeSalary(state.salDraft) : undefined) : payrollRow(emp, month, recs);
  const line = (label, value, cls = "") => `<li class="${cls}"><span>${label}</span><b>${won(value)}</b></li>`;
  const days = recs
    .map((rec) => {
      const h = hoursBetween(rec.clockIn, rec.clockOut);
      return `<li><span>${shortDate(rec.date)}</span><span class="m-day-time">${formatTime(rec.clockIn)} ~ ${formatTime(rec.clockOut)}</span><b class="${diffClass(emp, rec.date, h).trim()}">${hour1(h)}시간</b></li>`;
    })
    .join("");
  return `
    <div class="sheet-head">
      <span class="swatch big" style="background:${copyDisplayColor(emp.color)}"></span>
      <div><h2>${esc(emp.name)}</h2><small>${Number(month.slice(5, 7))}월 · ${r.days}일 · ${hrs(r.hours)}</small></div>
    </div>
    <div class="m-hero small m-pay-amount"><button type="button" class="m-payslip-preview-btn" data-action="preview-payslip" data-id="${emp.id}">명세서</button><small>받을 금액</small><strong>${r.net === null ? "공제액 입력 필요" : won(r.net)}</strong></div>
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
    <button type="button" class="m-allowance-add" data-action="open-payslip" data-id="${emp.id}"><span aria-hidden="true">＋</span> 수당 추가하기</button>
    ${editing ? renderAllowInline(emp.id, month) : ""}
    <details class="m-work-days"><summary><span class="m-work-days-heading"><span>날짜별 근무</span><strong>${hrs(r.hours)}</strong></span><span class="m-work-chevron" aria-hidden="true">${DD_CHEVRON}</span></summary><ul class="m-days-list">${days || `<li><span>근무 기록이 없어요</span></li>`}</ul>
    <button type="button" class="btn-ghost m-share" data-action="share-ts-image" data-id="${emp.id}">공유하기</button></details>
`;
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
const hrs = (n) => `${Number(n.toFixed(1))}시간`;
// 근무 상세 칸: 소수 첫째 자리까지 (5, 4.5, 0.8). 금액은 반올림 전 시간으로 계산한다
const hour1 = (n) => (n ? String(Number(n.toFixed(1))) : "");
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
              <td class="ts-total">${Number(r.total.toFixed(1))}</td>
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
          <tr class="ts-sum"><th class="ts-date">합계</th>${rows.map((r) => `<td class="ts-total">${Number(r.total.toFixed(1))}</td>`).join("")}</tr>
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
        `기본급: 근무 ${Number(r.hours.toFixed(1))}시간 × 시급 ${won(wage)}`,
        r.weekly.total
          ? `주휴수당: ${weeks.filter((w) => w.allowHours).length}주 · 주휴 ${Number(juHours.toFixed(1))}시간 × 시급 ${won(wage)} (주별: 1주 소정근로시간 ÷ 40 × 8시간)`
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
      <p class="ps-meta">${r.salaried ? "월급제" : `시급 ${won(r.emp.hourlyWage)}`} · 근무 ${r.days}일 · 총 ${Number(r.hours.toFixed(1))}시간</p>
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

// 휴대폰 급여 상세에서 수당을 입력하는 중이면 금액 줄만 새로 그린다
// (화면 전체를 다시 그리면 다음 칸을 누르는 순간 그 칸이 바뀌어 입력이 사라진다)
function refreshPayInline() {
  const box = document.querySelector(".m-allow-inline");
  const emp = employeeById(state.payslipId);
  if (!box || !emp || isDesktop()) return false;
  const tpl = document.createElement("template");
  tpl.innerHTML = renderPaySheet(emp);
  for (const sel of [".m-lines", ".m-pay-amount strong", ".sheet-head small", ".m-allow-net"]) {
    const now = document.querySelector(sel.startsWith(".m-allow") ? sel : `.m-pay-detail ${sel}`);
    const fresh = tpl.content.querySelector(sel);
    if (now && fresh) now.replaceWith(fresh);
  }
  return true;
}

// 휴대폰 수당 창: 추가한 수당은 한 줄 글자로, 입력칸은 새 수당 하나만 (state.allowNew)
const allowNewFilled = () => Boolean(state.allowNew && (state.allowNew.name || Number(state.allowNew.amount)));
const allowWithNew = () => (allowNewFilled() ? [...state.allowDraft, state.allowNew] : state.allowDraft);
function commitAllowNew() {
  if (allowNewFilled()) state.allowDraft.push({ name: state.allowNew.name || "수당", amount: Number(state.allowNew.amount) || 0 });
  state.allowNew = { name: "", amount: 0 };
}

// 휴대폰 급여 상세: 수당(월급제는 월급·공제액까지)을 그 자리에서 입력
function renderAllowInline(empId, month) {
  const emp = employeeById(empId);
  const r = payrollRow(emp, month, monthRecords(month, empId), allowWithNew(), state.salDraft ? normalizeSalary(state.salDraft) : undefined);
  return glassCard("close-payslip", `
    <div class="m-allow-inline">
      <p class="staff-title">${esc(emp.name)} · 수당</p>
      <p class="m-allow-net"><span>받을 금액</span><b>${r.net === null ? "공제액 입력 필요" : won(r.net)}</b></p>
      ${state.salDraft ? renderSalaryInputs(empId, month) : ""}
      ${state.allowDraft.some((a) => a.name || Number(a.amount)) ? `<ul class="m-allow-lines">${state.allowDraft
        .map((a, i) => (a.name || Number(a.amount) ? `
        <li><span>${esc(a.name || "수당")}</span><b>${won(Number(a.amount) || 0)}</b><button type="button" class="m-allow-del" data-action="remove-allowance" data-index="${i}" aria-label="${esc(a.name || "수당")} 삭제">삭제</button></li>` : ""))
        .join("")}</ul>` : ""}
      <div class="m-allow-row m-allow-new">
        <input class="field" value="${esc(state.allowNew?.name ?? "")}" placeholder="수당 이름" data-allow-new="name" aria-label="새 수당 이름" />
        <label class="m-won"><input class="field money" type="text" inputmode="numeric" value="${state.allowNew?.amount ? Number(state.allowNew.amount).toLocaleString() : ""}" placeholder="금액" data-allow-new="amount" aria-label="새 수당 금액" /><span aria-hidden="true">원</span></label>
      </div>
      <button type="button" class="m-allowance-add" data-action="add-allowance"><span aria-hidden="true">＋</span> 수당 추가하기</button>
      <div class="action-row">
        <button type="button" class="btn-ghost" data-action="close-payslip">취소</button>
        <button type="button" class="btn-primary" data-action="save-payslip">저장</button>
      </div>
    </div>`, "m-allow-card");
}

function renderPayslipModal() {
  const empId = state.payslipId;
  if (!empId || (!isDesktop() && route().name === "pay-detail")) return "";
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
    ${payCheckNotice(month)}
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
      <div class="payday-box">
        <label>급여 지급일 <b>${dot(payDateFor(month))}</b></label>
        <div class="payday-pick">${payDaySelects()}</div>
      </div>
    </div>

    <div class="section-head">
      <h3>근무 상세</h3>
      <div class="head-actions">
        ${employeeId ? `<button type="button" class="pill" data-action="share-ts-image" data-id="${employeeId}">공유하기</button>` : ""}
        <button type="button" class="pill plain-dark" data-action="export-ledger"${rows.length ? "" : " disabled"} title="세무사에게 보내는 급여대장 (알바·직원·날짜별 근무시간·주휴수당 내역)">엑셀 파일</button>
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

const uiConfirm = (message, options = {}) => uiDialog({ message, cancel: "취소", ...options });

async function withBusy(button, text, task) {
  const original = button.innerHTML;
  // 아이콘 버튼과 엑셀·PDF 받기는 "만드는 중…" 글자 대신 도는 아이콘만 (버튼 크기는 그대로)
  const spinOnly = !button.textContent.trim() || /export|pdf/i.test(button.dataset.action ?? "");
  const size = [button.style.width, button.style.height];
  button.disabled = true;
  button.classList.add("is-busy");
  if (spinOnly) {
    const { width, height } = button.getBoundingClientRect();
    button.style.width = `${width}px`;
    button.style.height = `${height}px`;
    button.innerHTML = `<span class="busy-spin" aria-hidden="true"></span>`;
  }
  else button.textContent = text;
  try {
    await task();
  } catch (err) {
    uiAlert(err.message);
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
    button.innerHTML = original;
    if (spinOnly) [button.style.width, button.style.height] = size;
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

    const C = { line: { style: "thin", color: { rgb: "FFD5DCDA" } } };
    const border = { top: C.line, bottom: C.line, left: C.line, right: C.line };
    const st = {
      title: { font: { bold: true, sz: 14 } },
      meta: { font: { color: { rgb: "66736F" } } },
      head: { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFE2F4F2" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border },
      text: { border },
      name: { font: { bold: true }, border },
      num: { numFmt: "#,##0", alignment: { horizontal: "right" }, border },
      dec: { numFmt: "#,##0.##", alignment: { horizontal: "right" }, border },
      net: { numFmt: "#,##0", font: { bold: true, color: { rgb: "0E8F8A" } }, alignment: { horizontal: "right" }, border },
      sum: { numFmt: "#,##0", font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFF3F6F5" } }, alignment: { horizontal: "right" }, border },
      sumText: { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "FFF3F6F5" } }, border },
      note: { font: { color: { rgb: "B45309" } }, border },
      mid: { alignment: { horizontal: "center" }, border },
      sun: { font: { color: { rgb: "D64545" } }, alignment: { horizontal: "center" }, border },
      headSun: { font: { bold: true, color: { rgb: "D64545" } }, fill: { patternType: "solid", fgColor: { rgb: "FFE2F4F2" } }, alignment: { horizontal: "center", wrapText: true }, border },
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
              cell(r.emp.name, st.name), cell(r.days, st.num), cell(Number(r.hours.toFixed(1)), st.dec), cell(r.emp.hourlyWage, st.num),
              cell(r.base, st.num), cell(r.weekly.total, st.num), cell(r.extra, st.num), cell(r.gross, st.num),
              cell(r.income, st.num), cell(r.local, st.num), cell(r.net, st.net), cell(memo(r), st.text),
            ]),
            [
              cell("합계", st.sumText), cell(tot(hourly, "days"), st.sum), cell(Number(tot(hourly, "hours").toFixed(1)), st.sum), cell("", st.sumText),
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
              cell(r.emp.name, st.name), cell(r.days, st.num), cell(Number(r.hours.toFixed(1)), st.dec),
              cell(r.base, st.num), cell(r.meal, st.num), cell(r.extra, st.num), cell(r.gross, st.num),
              ...DED_KEYS.map(([k]) => (r.ded ? cell(r.ded[k], st.num) : cell("", st.text))),
              r.ded ? cell(r.dedTotal, st.num) : cell("", st.text),
              r.ded ? cell(r.net, st.net) : cell("", st.text),
              r.ded ? cell([r.setFrom ? `${Number(r.setFrom.slice(5, 7))}월부터 같은 금액` : "", memo(r)].filter(Boolean).join(" · "), st.text) : cell(["공제액 입력 필요 (세무사 계산)", empDates(r.emp)].filter(Boolean).join(" · "), st.note),
            ]),
            [
              cell("합계", st.sumText), cell(tot(salaried, "days"), st.sum), cell(Number(tot(salaried, "hours").toFixed(1)), st.sum),
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
          ...hs.map((h, i) => cell(h ? Number(h.toFixed(1)) : "", weekdayOf(days[i]) === 0 ? st.sun : st.mid)),
          cell(hs.filter((h) => h).length, st.num), cell(Number(hs.reduce((a, h) => a + h, 0).toFixed(1)), st.dec),
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
          cell(Number(w.planned.toFixed(1)), st.dec),
          cell(Number(avgPlannedHours(r.emp, w.sun).toFixed(1)), st.dec),
          cell(Number(w.hours.toFixed(1)), st.dec),
          cell(Number(w.allowHours.toFixed(1)), st.dec),
          cell(w.amount, st.num),
          cell(w.reason, w.reason ? st.note : st.text),
        ]),
      ).concat(hourly.length ? [[cell("합계", st.sumText), cell("", st.sumText), cell("", st.sumText), cell("", st.sumText), cell("", st.sumText), cell("", st.sumText), cell(hourly.reduce((a, r) => a + r.weekly.total, 0), st.sum), cell("", st.sumText)]] : [[cell("이 달에는 시급제(알바) 직원이 없어요.", st.text)]]),
      [10, 16, 12, 10, 10, 9, 11, 22],
    );

    // 어두운 화면(휴대폰 미리보기·다크 모드)에서 열어도 검게 보이지 않게, 모든 칸에 흰 바탕·검은 글자를 직접 넣는다
    const paint = (ws) => {
      const r = XLSX.utils.decode_range(ws["!ref"]);
      // 제목·기간 줄은 표 너비만큼 합쳐서 글자가 잘리지 않게
      ws["!merges"] = [0, 1].map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: r.e.c } }));
      // 표 바깥도 오른쪽 8칸 · 아래 40줄까지 흰 칸(옅은 칸 선)으로 채워서, 어두운 화면에서도 빈 엑셀 칸처럼 보이게
      const grid = { style: "thin", color: { rgb: "FFE5E8EB" } };
      const blank = { fill: { patternType: "solid", fgColor: { rgb: "FFFFFFFF" } }, border: { top: grid, bottom: grid, left: grid, right: grid } };
      const lastR = r.e.r + 40;
      const lastC = r.e.c + 8;
      for (let R = r.s.r; R <= lastR; R++) {
        for (let C = r.s.c; C <= lastC; C++) {
          const ref = XLSX.utils.encode_cell({ r: R, c: C });
          const inTable = R <= r.e.r && C <= r.e.c;
          const c = (ws[ref] = ws[ref] ?? { t: "s", v: "", s: inTable ? undefined : blank });
          const st0 = c.s ?? {};
          c.s = {
            ...st0,
            fill: st0.fill ?? { patternType: "solid", fgColor: { rgb: "FFFFFFFF" } },
            font: { ...st0.font, color: { rgb: `FF${(st0.font?.color?.rgb ?? "191F28").slice(-6)}` } },
          };
        }
      }
      ws["!ref"] = XLSX.utils.encode_range({ s: r.s, e: { r: lastR, c: lastC } });
    };
    [ws1, ws2, ws3, ws4].forEach(paint);
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
    else showToast("엑셀 파일을 저장했어요", "ok");
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
      <p class="tsc-sum">근무 <b>${workDays}일</b> · 총 <b>${row ? Number(row.total.toFixed(1)) : 0}시간</b></p>
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
        ${canShare ? `<button type="button" class="btn-primary" data-share="send">전송하기</button>` : ""}
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
          const bg = copyDisplayColor(it.e.color);
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
          <button type="button" class="pill plain-dark" data-action="schedule-share">공유하기</button>
        </div>`;

  return `
    <div class="sched-sheet" id="sched-sheet">
      <div class="sc-print-head">
        <span class="ps-brand">${esc(storeName())} 근무표${meta.period ? `<span class="sc-print-period">${esc(normalizePeriod(meta.period.trim()))}</span>` : ""}</span>
      </div>
      <div class="sc-head">
        <h2 class="sc-title">[${esc(storeName())} 근무표]( <input class="sc-period" value="${esc(normalizePeriod(meta.period ?? ""))}" size="${Math.max(6, [...(normalizePeriod(meta.period ?? "") || "2026.06.04 ~")].length)}" data-meta="period" inputmode="numeric" placeholder="예: 2026.11.09" aria-label="근무표 적용 시작일" /> )</h2>
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
  // 휴대폰: 칸만 열고 커서는 두지 않는다 (키보드나 기본 선택 목록이 저절로 뜨지 않게)
  if (!isDesktop()) return;
  const panel = document.getElementById("tl-edit");
  if (!panel) return;
  const { top, bottom } = panel.getBoundingClientRect();
  if (top < 0 || bottom > window.innerHeight) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  document.getElementById(state.slotEdit?.empId || state.slotEdit?.fixedEmp ? "slot-start" : "slot-emp")?.focus({ preventScroll: true });
}

function renderSchedStatus() {
  if (!hasDraft()) return "";
  if (!isDesktop()) return `<p class="sched-status warn">반영하지 않은 변경이 있어요. 시작 날짜를 넣고 <b>근무표 반영</b>을 누르면 그날부터 적용돼요.</p>`;
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
              ${choices.map((e) => `<option value="${e.id}"${e.id === ed.addEmpId ? " selected" : ""}>${esc(e.name)}${isManager(e) ? " (직원)" : ""}</option>`).join("")}
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
  if (dayList) {
    // 줄 자리에서 열린 수정 칸도 그대로 옮겨 붙인다
    const form = dayList.querySelector("#m-slot-edit");
    const focused = form?.contains(document.activeElement) ? document.activeElement : null;
    const caret = focused && "selectionStart" in focused ? [focused.selectionStart, focused.selectionEnd] : null;
    dayList.innerHTML = renderDayShifts();
    const slot = dayList.querySelector("#m-slot-edit");
    if (form && slot) {
      slot.replaceWith(form);
      focused?.focus({ preventScroll: true });
      if (caret) focused.setSelectionRange(...caret);
    }
  }
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
// 휴대폰: 직원 화면 · 급여 화면 단계 (목록 화면 튜토리얼에서는 scene 으로 그 화면을 열어 이어서 보여 준다)
const EMP_DETAIL_STEPS = (scene) => [
  { scene, sel: ".m-emp-pay", title: "시급", text: "숫자를 눌러 바로 고쳐요. 월급제 직원은 월급을 급여 화면 명세서에서 넣어요." },
  { scene, sel: ".m-emp-week", title: "근무 요일", text: "요일 칸에 <b>7-12</b>, <b>18-2230</b>처럼 넣으면 그 요일 고정 근무 시간이 돼요. 비우면 쉬는 날이에요." },
  { scene, sel: ".m-emp-settings", title: "설정", text: "<b>시급제 / 월급제</b>, <b>알바 / 직원</b>, <b>재직중 / 비활성</b>을 바꿔요. 그만둔 직원은 비활성으로 두면 기록은 남고 근무표 · 출퇴근에서만 빠져요." },
  { scene, sel: ".m-emp-remove", title: "직원 삭제", text: "직원과 근무 기록을 모두 지워요. 기록을 남기려면 삭제 대신 <b>비활성</b>으로 바꿔요." },
];
const PAY_DETAIL_STEPS = (scene) => [
  { scene, sel: ".m-pay-header-person", title: "직원 바꾸기", text: "위의 이름을 누르면 다른 직원 급여로 바로 넘어가요." },
  { scene, sel: ".m-pay-amount", title: "받을 금액 · 명세서", text: "이 직원이 받을 금액이에요. <b>명세서</b>를 누르면 그 자리에서 급여명세서가 펼쳐지고, 안의 다운로드 버튼으로 이 직원 명세서 PDF를 받아요." },
  { scene, sel: ".m-lines", title: "급여 내역", text: "기본급, 주휴수당, 수당, 세금이에요. 알바 기본급은 출근 기록의 근무시간으로, 주휴수당은 근무표 시간 기준으로 계산해요." },
  { scene, sel: ".m-pay-detail .m-allowance-add", title: "수당 추가하기", text: "특근수당 같은 수당을 넣어요. 누르면 글래시 창이 떠요." },
  { scene: "allow", sel: ".m-allow-card", title: "수당 입력", text: "수당 이름과 금액을 넣으면 <b>받을 금액</b>이 바로 바뀌어요. <b>수당 추가하기</b>로 여러 개 넣고 <b>저장</b>해요. 월급제 직원은 여기서 월급 · 식대 · 공제액도 넣어요." },
  { scene, sel: ".m-work-days", title: "날짜별 근무", text: "누르면 날짜별 근무 시간이 펼쳐지고, 맨 아래 <b>공유하기</b>로 이 직원의 한 달 근무를 사진으로 보내요." },
];

const TOURS = {
  employees: (pc) =>
    pc
      ? [
          { sel: "#add-employee .seg", title: "알바 / 직원", text: "새로 넣을 사람이 알바인지 직원인지 골라요. 직원을 고르면 시급 대신 기본급(월급)과 식대를 넣어요." },
          { sel: "#add-employee", title: "직원 추가", text: "이름과 시급(직원은 월급)을 넣고 <b>추가</b>를 눌러요. 전화번호는 넣지 않아도 돼요." },
          { sel: ".staff-link", title: "직원용 달력 주소", text: "직원들이 출근과 퇴근을 찍는 달력 주소예요. <b>주소 복사</b>로 단톡방에 보내 주세요." },
          { sel: "table.schedule tbody tr:first-child .day-cell", title: "요일별 근무 시간", text: "칸에 <b>7-12</b>, <b>18-2230</b>처럼 입력하면 그 요일 고정 근무 시간이 저장돼요. 비우면 쉬는 날이에요." },
          { sel: "table.schedule tbody tr:first-child .wage-cell", title: "시급 · 월급", text: "알바는 시급을 고쳐요. <b>월급으로</b>를 누르면 월급제(4대보험) 직원이 되고, 월급은 급여 화면 명세서에서 입력해요." },
          { sel: "table.schedule tbody tr:first-child [data-action=toggle-active]", title: "재직중 · 비활성", text: "그만둔 직원은 <b>비활성</b>으로 바꿔요. 기록은 남고, 달력과 근무표에서만 빠져요." },
          { sel: "table.schedule tbody tr:first-child [data-action=toggle-role]", title: "알바 · 직원", text: "직원으로 바꾸면 목록 맨 위로 오고 월급제가 돼요. 다시 알바로 바꾸면 시급제로 돌아가요." },
        ]
      : [
          { sel: ".m-emp-hero .m-add", title: "직원 추가", text: "누르면 직원 추가 창이 떠요." },
          { scene: "addSheet", sel: ".m-add-emp-card", title: "직원 추가 창", text: "<b>알바 / 직원</b>을 고르고 이름을 넣어요. 알바는 시급, 직원은 기본급(월급)과 식대(선택)를 넣고 <b>추가</b>를 눌러요. 전화번호는 비워도 돼요." },
          { sel: ".staff-link", title: "직원용 달력 주소", text: "직원들이 출근을 찍는 달력 주소예요. <b>주소 복사</b>로 단톡방에 보내 주세요." },
          { sel: ".m-list .m-row", title: "직원 누르기", text: "직원을 누르면 그 직원 화면으로 가요." },
          ...EMP_DETAIL_STEPS("empDetail"),
        ],
  "employee-detail": () => EMP_DETAIL_STEPS(),
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
          { sel: ".sc-actions [data-action=schedule-share]", title: "공유하기", text: "누르면 근무표를 사진으로 만들어요." },
          { scene: "schedShare", sel: ".share-box", title: "근무표 사진", text: "이런 사진이 만들어져요. <b>복사하기</b>를 누르고 단톡방에 붙여넣으면 돼요." },
        ]
      : [
          { sel: ".m-sched-hero", title: "적용 시작일", text: "이 근무표를 언제부터 쓸지예요. 날짜를 눌러 숫자 8자리로 고쳐요(예: 20261201). 아래 <b>근무표 반영</b>을 누르면 이 날짜부터 반영돼요." },
          { sel: ".m-share-btn", title: "공유하기", text: "누르면 지금 근무표를 사진으로 만들어요." },
          { scene: "schedShare", sel: ".share-box", title: "근무표 사진", text: "이런 사진이 만들어져요. <b>전송하기</b>로 단톡방에 보내거나 <b>사진 저장</b>으로 앨범에 저장해요." },
          { sel: ".m-days", title: "요일 고르기", text: "요일을 누르면 그날 근무자가 아래에 나와요." },
          { sel: "#sched-day-list .m-shift", title: "근무자 누르기", text: "근무자를 누르면 그 줄이 그 자리에서 수정 칸으로 바뀌어요." },
          { scene: "slot", sel: "#m-slot-edit", title: "근무 고치기 · 삭제", text: "시작·끝 시간을 고치고 <b>완료</b>, 이 요일 근무를 빼려면 <b>근무 삭제</b>를 눌러요. <b>취소</b>하면 고치기 전으로 돌아가요." },
          { sel: ".m-add-shift", title: "근무자 추가", text: "이 요일에 근무자를 넣어요. 누르면 글래시 창이 떠요." },
          { scene: "slotAdd", sel: ".m-glass-form", title: "근무자 추가 창", text: "<b>직원 선택</b>을 눌러 목록에서 고르고 시간을 넣은 뒤 <b>완료</b>를 눌러요. 그 요일 근무가 없는 직원만 목록에 나와요." },
          { sel: ".m-savebar [data-action=open-sched-history]", title: "목록", text: "고친 내용은 자동으로 <b>임시저장</b>돼요. <b>목록</b>에서는 지금까지 반영한 근무표들을 시작 날짜별로 보고 불러올 수 있어요." },
          { scene: "schedHistory", sel: ".m-blur-card", title: "근무표 목록", text: "누르면 그 근무표를 불러와요. 불러온 뒤 고치고 <b>근무표 반영</b>을 누르면 새 근무표가 돼요." },
          { sel: ".m-savebar [data-action=schedule-save]", title: "근무표 반영", text: "적용 시작일부터 직원 화면 · 출퇴근 · 급여에 반영돼요. 그 전 날짜의 기록은 그대로예요." },
        ],
  calendar: (pc) =>
    pc
      ? [
          { sel: ".cal-head", title: "달 바꾸기", text: "화살표로 지난달, 다음 달을 봐요." },
          { sel: [".cell:has(.day-num.today)", ".grid .cell"], title: "날짜 칸", text: "그날 출근 기록이 이름과 시간으로 보여요. 근무표보다 <b style=\"color:var(--more)\">더 일하면 파랑</b>, <b style=\"color:var(--red)\">덜 일하면 빨강</b>이에요. 날짜를 누르면 그날이 열려요." },
          { scene: "day", sel: ".date-box", title: "그날 출근 기록", text: "날짜를 누르면 이렇게 열려요. 여기 보이는 시간이 급여에 들어가요. 직원은 <b>출근만</b> 찍어요. 근무표 시작 전에 찍으면 <b>근무표 시작 시간</b>으로, 늦게 찍으면 찍은 시각을 <b>10분 단위로 반올림</b>한 시간(13:04 → 13:00, 13:05 → 13:10)으로 들어가요. 퇴근은 따로 안 찍고 <b>근무표 끝나는 시간</b>으로 들어가요." },
          { scene: "day", sel: ".staff", title: "근무 예정", text: "그날 근무표에 있는 사람이에요. 이름 밑 시간은 <b>근무표 시간</b>이라 출퇴근 기록을 고쳐도 바뀌지 않아요." },
          { scene: "staff", sel: ".staff-item.expanded", title: "출근 처리", text: "출근 기록이 없는 사람은 이름을 눌러 <b>출근 처리</b>해요. 근무표 시간대로 출근 기록에 들어가요. 앞으로의 날짜는 여기서 <b>수정</b>으로 그날만 근무 시간을 바꿔요." },
          { scene: "rec", sel: ".in-action", title: "출퇴근 시간 수정", text: "출근 기록에서 이름을 누르면 <b>수정</b>과 <b>기록 삭제</b>가 나와요. 고친 시간은 급여에 바로 반영돼요." },
          { scene: "add", sel: "#add-extra", title: "대타 · 추가 근무", text: "<b>+</b>를 누르면 이름과 시간을 넣어 그날만 근무자를 추가해요. 처음 보는 이름이면 새 직원으로 등록할지 물어요." },
        ]
      : [
          { sel: ".kc-scroller", title: "날짜 고르기", text: "날짜를 누르면 아래에 그날 출근 기록과 근무자가 나와요. 옆으로 밀면 지난주 · 다음 주예요. <b style=\"color:#59B5FF\">파란 점</b>은 기록이 있는 날이에요." },
          { sel: ".m-cal-back", title: "달 전체 보기", text: "<b>&lt; 월</b>이나 날짜 아래 화살표를 누르면 달 전체가 펼쳐져요. 위아래로 넘기면 한 달씩 바뀌고, 날짜를 누르면 그날로 돌아와요. 펼친 상태에서 <b>&lt; 연도</b>를 누르면 올해 열두 달이 작게 보여요." },
          { sel: ".change-inbox", title: "근무 수정 요청", text: "직원이 보낸 근무 시간 수정 요청이에요. <b>승인</b>하면 급여에 반영되고, <b>반려</b>하면 그대로예요." },
          { scene: "kcDay", sel: ".m-date-hero", title: "그날 출근 기록", text: "고른 날짜와 출근한 사람이에요. 여기 보이는 시간이 급여에 들어가요. 직원은 <b>출근만</b> 찍어요. 근무표 시작 전에 찍으면 <b>근무표 시작 시간</b>으로, 늦게 찍으면 찍은 시각을 <b>10분 단위로 반올림</b>한 시간(13:04 → 13:00, 13:05 → 13:10)으로 들어가요. 퇴근은 따로 안 찍고 <b>근무표 끝나는 시간</b>으로 들어가요." },
          { scene: "kcDay", sel: ".kc-content .staff", title: "근무자", text: "그날 근무표에 있는 사람이에요. 이름 밑 시간은 <b>근무표 시간</b>이에요." },
          { scene: "kcStaff", sel: ".kc-content .staff-item.expanded", title: "출근 처리", text: "아직 출근 안 한 사람은 이름을 눌러 <b>출근 처리</b>해요. 근무표 시간대로 들어가요. 앞으로의 날짜는 <b>수정</b>으로 그날만 근무 시간을 바꿔요." },
          { scene: "kcRec", sel: ".kc-content .staff-item.expanded", title: "기록 수정 · 삭제", text: "출근한 사람을 누르면 <b>수정</b>과 <b>기록 삭제</b>가 나와요. 고친 시간은 급여에 바로 반영돼요." },
          { scene: "kcDay", sel: ".kc-content .add-btn", title: "근무자 추가", text: "근무표에 없는 대타나 추가 근무를 넣어요. 누르면 글래시 창이 떠요." },
          { scene: "kcAdd", sel: ".m-glass-form", title: "근무자 추가 창", text: "이름과 시간을 넣고 <b>등록</b>해요. 처음 보는 이름이면 새 직원으로 등록할지 물어요." },
        ],
  // 직원용 달력 (출근 화면)
  home: (pc) => [
    { sel: ".cal-head", title: "달 바꾸기", text: "화살표로 지난달, 다음 달을 봐요." },
    pc
      ? { sel: [".cell:has(.day-num.today)", ".grid .cell"], title: "날짜 칸", text: "그날 출근한 사람과 시간이 보여요. 근무표보다 <b style=\"color:var(--more)\">더 일하면 파랑</b>, <b style=\"color:var(--red)\">덜 일하면 빨강</b>이에요. 날짜를 누르면 그날이 열려요." }
      : { sel: [".cell:has(.day-num.today)", ".grid .cell"], title: "날짜 칸", text: "점이 있는 날은 출근 기록이 있는 날이에요. 날짜를 누르면 그날 화면이 열려요." },
    { scene: "day", sel: ".date-box", title: "출근 기록", text: "날짜를 누르면 이렇게 열려요. 근무표 시작 전에 찍으면 <b>근무표 시작 시간</b>, 늦게 찍으면 찍은 시각을 <b>10분 단위로 반올림</b>한 시간이 출근 시간이 돼요." },
    { scene: "day", sel: ".staff", title: "오늘 근무자", text: "근무표에 있는 오늘 근무자예요. 이름 밑 시간은 <b>근무표 시간</b>이에요. <b>본인 이름</b>을 찾아 눌러요." },
    { scene: "staff", sel: ".staff-item.expanded", title: "출근 · 퇴근 찍기", text: "이름을 누르면 <b>출근</b> 버튼이 나와요. 매장에 도착하면 <b>출근만</b> 눌러 주세요. 퇴근은 근무표 끝나는 시간으로 자동으로 들어가요. 시간이 실제와 다르면 이름을 눌러 <b>수정 요청</b>을 보내면 사장님이 확인해요." },
    { scene: "add", sel: "#add-extra", title: "대타 · 추가 근무", text: "근무표에 없는데 오늘 일하게 됐으면 <b>+</b>를 눌러 <b>이름만</b> 넣고 <b>등록</b>해요. 근무표 시간이 없으니 이름을 눌러 <b>출근</b>과 <b>퇴근</b>을 모두 찍어 주세요." },
  ],
  records: (pc) =>
    pc
      ? [
          { sel: ".month-nav", title: "달 바꾸기", text: "화살표로 지난달 급여를 볼 수 있어요." },
          { sel: ".pay-check", title: "퇴근 확인 필요", text: "출근을 찍고 근무표 종료 시간이 지나도록 퇴근을 안 찍은 기록이에요. 눌러서 그날 화면으로 간 뒤, 출근 기록에서 이름을 눌러 <b>수정</b>으로 시간을 넣으면 사라져요." },
          { sel: "#r-emp", title: "직원 고르기", text: "한 명을 고르면 그 사람 것만 보여요." },
          { sel: ".payday-box", title: "급여 지급일", text: "오른쪽에서 지급 달과 날짜를 골라요. 위에 이 달 급여의 실제 지급일이 보이고, 명세서에 들어가요." },
          { scene: "emp", sel: "[data-action=share-ts-image]", title: "공유하기", text: "직원을 고르면 나타나요. 누르면 이 직원의 한 달 근무를 달력 사진으로 만들어요." },
          { scene: "share", sel: ".share-box img", title: "근무 사진 미리보기", text: "이런 사진이 만들어져요. 날짜별 근무 시간과 출퇴근 시간, 한 달 합계가 들어가요." },
          { scene: "share", sel: ".share-actions", title: "복사하기 · 사진 저장", text: "<b>복사하기</b>를 누르고 카톡 채팅방에 붙여넣으면 사진으로 보내져요. 복사하면 <b>다음 직원으로 자동으로 넘어가서</b> 한 명씩 차례로 보낼 수 있어요." },
          { scene: "emp", sel: [".ts-wrap", ".timesheet"], title: "이 직원 근무 상세", text: "날짜별 근무 시간이에요. 근무표보다 더 일하면 파랑, 덜 일하면 빨강으로 보여요." },
          { sel: "#r-tax", title: "세금", text: "알바(시급제) 세금이에요. 보통 3.3%를 떼요. 월급제 직원의 공제액은 명세서에서 따로 입력해요." },
          { sel: "[data-action=export-ledger]", title: "엑셀 파일", text: "세무사에게 보낼 급여대장이에요. 알바·직원(4대보험)·날짜별 근무시간·주휴수당 내역이 한 파일에 들어가요." },
          { sel: ".pay-table", title: "급여 정산", text: "기본급, 주휴수당, 수당, 세금, 실지급액이 계산돼요. 알바 기본급은 찍은 시각을 <b>10분 단위로 반올림</b>한 근무시간으로 계산해요(퇴근을 안 찍은 날은 근무표 종료 시각). 주휴수당은 근무표 시간 기준이고, 마우스를 올리면 주별 내역이 보여요." },
          { sel: ".pay-table .ps-cell [data-action=open-payslip]", title: "명세서", text: "이름 옆 <b>명세서</b>를 누르면 명세서 창이 열려요. 알바와 직원은 창이 조금 달라요." },
          { scene: "payslipAlba", sel: ".ps-allow", title: "알바 명세서 · 수당 입력", text: "특근수당 같은 수당을 이름과 금액으로 넣어요. <b>+ 수당 추가</b>로 여러 개 넣을 수 있어요." },
          { scene: "payslipAlba", sel: ".ps-preview", title: "알바 명세서", text: "기본급, 주휴수당, 수당에서 3.3%를 뗀 금액이에요. 입력하는 대로 바로 바뀌고, 이 모양 그대로 PDF가 돼요." },
          { scene: "payslipAlba", sel: ".ps-side [data-action=save-payslip]", title: "저장", text: "저장하면 급여 정산과 명세서에 반영돼요." },
          { scene: "payslipMgr", sel: ".sal-box", title: "직원 명세서 · 월급 · 공제액", text: "직원(월급제)는 기본급·식대와 세무사에게 받은 공제액 6가지를 넣어요. 한 번 넣으면 다음 달에도 그대로 이어지고, 바뀐 달에만 고치면 돼요." },
          { scene: "payslipMgr", sel: ".ps-preview", title: "직원 명세서", text: "기본급·식대에서 4대보험과 근로소득세를 뗀 금액이에요. 공제액을 아직 안 넣었으면 \"공제액 입력 필요\"로 보여요." },
          { sel: ".section-head [data-action=payslip-pdf-all]", title: "명세서 PDF", text: "직원마다 따로 급여명세서 PDF를 받아요. 직원에게 보내 주면 돼요." },
        ]
      : [
          { sel: ".m-top .dd", title: "달 바꾸기", text: "위의 연월을 누르면 달 목록이 펼쳐져요. 확인할 달을 골라요." },
          { sel: ".pay-check", title: "퇴근 확인 필요", text: "근무표에 없던 대타가 출근만 찍고 퇴근을 안 찍은 기록이에요. 눌러서 그날로 간 뒤 이름을 눌러 <b>수정</b>으로 시간을 넣으면 사라져요." },
          { sel: ".m-pay-hero", title: "이번 달 합계", text: "이번 달 실지급액 합계예요. 아래에서 알바 세금(3.3% 공제 / 공제 안 함)과 <b>급여 지급일</b>을 골라요. 지급일은 명세서에 들어가요." },
          { sel: ".m-hero-dl", title: "엑셀 · 명세서 받기", text: "누르면 받을 파일을 고르는 창이 떠요." },
          { scene: "exports", sel: ".m-blur-card", title: "엑셀 파일 · 명세서 PDF", text: "<b>엑셀 파일</b>은 세무사에게 보낼 급여대장, <b>명세서 PDF</b>는 직원 모두의 급여명세서를 한 번에 받아요." },
          { sel: ".m-pay", title: "직원 누르기", text: "직원을 누르면 그 사람 급여 화면으로 가요." },
          ...PAY_DETAIL_STEPS("payDetail"),
        ],
  "pay-detail": () => PAY_DETAIL_STEPS(),
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
// 기록 수정 단계에서 보여 줄 날짜: 오늘, 오늘 기록이 없으면 어제
const tourRecDate = () => (recordsOn(todayDateString()).length ? todayDateString() : addDays(todayDateString(), -1));
const TOUR_SCENES = {
  day: { hash: () => (isDesktop() ? null : `#/day/${todayDateString()}`), set: () => isDesktop() && Object.assign(state, { selectedDate: todayDateString(), animateOpen: false }) },
  staff: {
    hash: () => (isDesktop() ? null : `#/day/${todayDateString()}`),
    set: () => {
      const d = todayDateString();
      if (isDesktop()) Object.assign(state, { selectedDate: d, animateOpen: false });
      // 관리자 화면은 출근 기록이 없는 사람만 펼쳐진다
      const list = scheduledOn(d);
      const emp = (ADMIN_SITE ? list.find((e) => !recordFor(e.id, d)) : list[0]) ?? employeeById(recordsOn(d)[0]?.employeeId);
      state.expandedId = emp?.id ?? null;
    },
  },
  rec: {
    hash: () => (isDesktop() ? null : `#/day/${tourRecDate()}`),
    set: () => {
      const d = tourRecDate();
      if (isDesktop()) Object.assign(state, { selectedDate: d, animateOpen: false });
      state.expandedRecId = recordsOn(d)[0]?.employeeId ?? null;
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
  // 휴대폰 화면
  empDetail: { hash: () => (store.employees[0] ? `#/employees/${encodeURIComponent(store.employees[0].id)}` : null) },
  payDetail: { hash: () => tourPayHash() },
  allow: {
    hash: () => tourPayHash(),
    set: () => {
      const id = tourPayEmp();
      if (!id) return;
      openPayslipState(id);
      state.allowDraft.push({ name: "특근수당", amount: 20000 }); // 보여 주기용 (저장하지 않음)
    },
  },
  exports: { set: () => (state.exportsOpen = true) },
  schedHistory: { set: () => (state.historyOpen = true) },
  kcDay: { hash: () => "#/calendar", set: () => (state.calDay = todayDateString()) },
  kcStaff: {
    hash: () => "#/calendar",
    set: () => {
      const d = todayDateString();
      state.calDay = d;
      const list = scheduledOn(d);
      state.expandedId = (list.find((e) => !recordFor(e.id, d)) ?? list[0])?.id ?? null;
    },
  },
  kcRec: {
    hash: () => "#/calendar",
    set: () => {
      const d = tourRecDate();
      state.calDay = d;
      state.expandedId = recordsOn(d)[0]?.employeeId ?? null;
    },
  },
  kcAdd: { hash: () => "#/calendar", set: () => Object.assign(state, { calDay: todayDateString(), adding: true }) },
};
const tourPayEmp = () => (route().name === "pay-detail" ? route().id : firstAlbaEmp() ?? firstPayEmp());
const tourPayHash = () => (tourPayEmp() ? `#/records/${encodeURIComponent(tourPayEmp())}/${state.payroll.month}` : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function applyTourScene(name) {
  if (tour.scene === name) return;
  const b = tour.base;
  // 튜토리얼 시작 때 모습으로 되돌린 뒤 이 단계의 화면을 펼친다
  closeTourShare();
  Object.assign(state, { selectedDate: b.selectedDate, calDay: b.calDay, expandedId: null, expandedRecId: null, adding: false, editingId: null, editingWhere: null, sheet: null, payslipId: null, allowDraft: null, salDraft: null, slotEdit: null, contractDraft: null, exportsOpen: false, historyOpen: false });
  state.payroll.employeeId = b.payrollEmp;
  const sc = name ? TOUR_SCENES[name] : null;
  const target = sc?.hash?.() ?? b.hash;
  if (location.hash !== target) {
    tour.nav = true;
    location.hash = target;
    await sleep(80); // 화면이 바뀐 뒤에 펼친다
    tour.nav = false;
  }
  const done = sc?.set?.();
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
    base: { hash: location.hash, selectedDate: state.selectedDate, calDay: state.calDay, payrollEmp: state.payroll.employeeId },
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
    Object.assign(state, { selectedDate: t.base.selectedDate, calDay: t.base.calDay, expandedId: null, expandedRecId: null, adding: false, sheet: null, payslipId: null, allowDraft: null, salDraft: null, slotEdit: null, contractDraft: null, exportsOpen: false, historyOpen: false });
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
  if (!ADMIN_SITE) return { name: "home" };
  const employee = hash.match(/^\/employees\/([^/]+)$/);
  if (employee) return { name: "employee-detail", id: decodeURIComponent(employee[1]) };
  const pay = hash.match(/^\/records\/([^/]+)\/(\d{4}-(?:0[1-9]|1[0-2]))$/);
  if (pay) return { name: "pay-detail", id: decodeURIComponent(pay[1]), month: pay[2] };
  const page = { "/mypage": "mypage", "/records": "records", "/schedule": "schedule", "/calendar": "calendar" }[hash];
  return { name: page ?? "employees" };
}

// 달력 첫 화면 주소 (직원용은 #/, 관리자는 #/calendar)
const homeHash = () => (ADMIN_SITE ? "#/calendar" : "#/");

// 다시 그릴 때 입력 중이던 시간 칸 값을 지키는 칸들 (편집이 끝나면 칸이 사라지므로 그대로 남지 않는다)
let lastRouteName = "";
const KEEP_FIELDS = ["login-email", "login-password", "signup-store", "store-name", "edit-start", "edit-end", "extra-name", "extra-start", "extra-end", "change-reason"];

let calendarFitFrame = 0;
let calendarFitObserver = null;
function fitMobileAttendanceCalendar() {
  cancelAnimationFrame(calendarFitFrame);
  calendarFitFrame = requestAnimationFrame(() => {
    if (isDesktop()) return;
    const grid = app.querySelector(".month-picker-calendar .grid, .year-view");
    const menu = app.querySelector(".m-text-nav");
    if (!grid || !menu) return;
    const menuStyle = getComputedStyle(menu);
    const menuHeight = parseFloat(menuStyle.height) || menu.offsetHeight;
    const menuBottom = parseFloat(menuStyle.bottom) || 0;
    const main = grid.closest(".m-main");
    const header = app.querySelector(".m-top");
    if (main && header) {
      const install = app.querySelector(".m-install");
      const top = install ? install.getBoundingClientRect().bottom : header.getBoundingClientRect().bottom;
      main.style.top = `${Math.ceil(top)}px`;
      main.style.bottom = `${Math.ceil(menuHeight + menuBottom + 12)}px`;
      main.style.paddingBottom = "0px";
    }
    // 본문 자체를 메뉴 위에서 끝내고, 그 안에서 날짜 줄을 균등 배분한다.
    grid.style.removeProperty("height");
    // 크기가 바뀌면 줄 높이를 다시 재고 지금 달에 맞춘다
    app.querySelector(".month-scroll")?.alignMonth?.();
  });
}
function observeMobileCalendarLayout() {
  calendarFitObserver?.disconnect();
  if (!app.querySelector(".month-picker-calendar, .year-view") || !window.ResizeObserver) return;
  calendarFitObserver = new ResizeObserver(fitMobileAttendanceCalendar);
  app.querySelectorAll(".m-top, .m-text-nav, .m-install").forEach(el => calendarFitObserver.observe(el));
}
window.addEventListener("resize", fitMobileAttendanceCalendar);
// 화면 크기가 바뀌어도(회전 · 주소창) 주간 줄은 고른 주를 가운데에
window.addEventListener("resize", () => {
  const sc = app.querySelector("#kcScroller");
  if (!sc) return;
  state.kcResizing = true;
  sc.scrollLeft = sc.clientWidth;
  clearTimeout(state.kcResizeTimer);
  state.kcResizeTimer = setTimeout(() => { sc.scrollLeft = sc.clientWidth; state.kcResizing = false; }, 250);
});
window.addEventListener("orientationchange", fitMobileAttendanceCalendar);
window.addEventListener("pageshow", fitMobileAttendanceCalendar);
window.visualViewport?.addEventListener("resize", fitMobileAttendanceCalendar);

document.fonts?.ready.then(fitMobileAttendanceCalendar);

function render() {
  if (ADMIN_SITE && !isDesktop() && !demoLoaded && route().name === "schedule" && state.schedWork && schedDirty()) tempSaveSchedule();
  const kept = KEEP_FIELDS.map((id) => [id, document.getElementById(id)?.value]).filter(([, v]) => v);
  const focusedId = document.activeElement?.id;
  const r = route();
  document.documentElement.classList.toggle("attendance-viewport", !isDesktop() && r.name === "calendar" && !ADMIN_SITE);
  if (r.name === "lock") app.innerHTML = renderLock();
  else if (r.name === "pick") app.innerHTML = renderPick();
  else if (r.name === "day") app.innerHTML = renderDayPage(r.date);
  else if (r.name === "calendar") app.innerHTML = renderAdminCalendar();
  else if (r.name === "mypage") app.innerHTML = renderMyPage();
  else if (r.name === "employees") app.innerHTML = renderEmployees();
  else if (r.name === "employee-detail") app.innerHTML = renderEmployeePage(r.id);
  else if (r.name === "records") app.innerHTML = renderRecords();
  else if (r.name === "pay-detail") app.innerHTML = renderPayPage(r.id, r.month);
  else if (r.name === "schedule") app.innerHTML = renderSchedule();
  else app.innerHTML = renderHome();

  for (const [id, value] of kept) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = value;
  }
  for (const layer of app.querySelectorAll("[data-portal]")) app.append(layer);
  if (KEEP_FIELDS.includes(focusedId)) document.getElementById(focusedId)?.focus({ preventScroll: true });
  // 로그인 화면에서 넘어오면 맨 위부터 (키보드 때문에 내려간 스크롤이 남지 않게)
  if (lastRouteName === "lock" && r.name !== "lock") window.scrollTo(0, 0);
  lastRouteName = r.name;

  const period = document.querySelector(".sc-period");
  if (period) fitPeriod(period);
  lockDemoFields();
  enhanceSelects();
  setupMonthScroll();
  setupWeekScroll();
  setupKc();
  observeMobileCalendarLayout();
  fitMobileAttendanceCalendar();
  placeNavPill();
  if (state.pageEnter && r.name === "records") countUp(app.querySelectorAll(".pay-table td.net, .m-main .net"));
  // 카톡 복사 후 다음 직원으로 넘어갔음을 보여준다: 직원 칸 반짝, 표 새로 들어옴, 전송 버튼 두근
  // (저장 직후 다시 그려져도 이어서 돌도록 지난 시간만큼 앞당겨 시작)
  const flashMs = Date.now() - (state.nextFlashAt ?? 0);
  if (flashMs < 2600 && r.name === "records") {
    for (const sel of [".dd:has(#r-emp) .dd-btn", "#r-emp:not(.dd *)", ".ts-desktop", '[data-action="share-ts-image"]']) {
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

  if ((r.name === "lock" || r.name === "pick") && isDesktop()) {
    const first = document.querySelector(".lock-form .field");
    if (first && !first.value) first.focus();
  }
}

// ---------- 드롭다운 (컴퓨터 화면) ----------
// 브라우저 기본 select 목록은 모양을 바꿀 수 없어서, select 는 값만 들고 있게 숨기고 그 위에 사이트 모양의 목록을 띄운다.
// 고르면 select 값을 바꾸고 change 를 내보내므로 저장 처리는 원래 코드 그대로다. 휴대폰은 기본 선택창을 쓴다.
const DD_CHEVRON = svg(14, '<path d="m6 9 6 6 6-6"/>', 2.5);
function enhanceSelects() {
  const selector = isDesktop() ? "select.field" : ".m-screen-records select.m-tax, .m-payroll-month-select, .m-pay-employee-select, select#slot-emp";
  for (const sel of app.querySelectorAll(selector)) {
    const dd = document.createElement("div");
    dd.className = "dd";
    sel.before(dd);
    dd.append(sel);
    sel.tabIndex = -1;
    const label = sel.selectedOptions[0]?.dataset.short || sel.selectedOptions[0]?.textContent || "";
    dd.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"${sel.disabled ? " disabled" : ""}${sel.getAttribute("aria-label") ? ` aria-label="${esc(sel.getAttribute("aria-label"))}"` : ""}><span>${esc(label)}</span>${DD_CHEVRON}</button>`,
    );
  }
}
function closeDropdowns() {
  for (const dd of document.querySelectorAll(".dd.open")) {
    dd.classList.remove("open");
    dd.querySelector(".dd-list")?.remove();
    dd.querySelector(".dd-btn")?.setAttribute("aria-expanded", "false");
  }
}
function openDropdown(dd) {
  closeDropdowns();
  const sel = dd.querySelector("select");
  const list = document.createElement("div");
  list.className = "dd-list";
  list.setAttribute("role", "listbox");
  list.innerHTML = [...sel.options]
    .map((o) => `<button type="button" class="dd-opt${o.selected ? " on" : ""}" role="option" aria-selected="${o.selected}" data-value="${esc(o.value)}">${esc(o.textContent)}</button>`)
    .join("");
  dd.append(list);
  dd.classList.add("open");
  dd.querySelector(".dd-btn").setAttribute("aria-expanded", "true");
  // 화면 오른쪽을 넘어가면 오른쪽에 맞춰 연다
  list.classList.toggle("right", list.getBoundingClientRect().right > document.documentElement.clientWidth - 8);
  const on = list.querySelector(".dd-opt.on") ?? list.firstElementChild;
  on?.focus({ preventScroll: true });
  if (on) list.scrollTop = sel.matches(".m-payroll-month-select") ? (on.previousElementSibling || on).offsetTop - 6 : on.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2;
}
function pickDropdown(opt) {
  const dd = opt.closest(".dd");
  const sel = dd.querySelector("select");
  const changed = sel.value !== opt.dataset.value;
  sel.value = opt.dataset.value;
  dd.querySelector(".dd-btn span").textContent = sel.selectedOptions[0]?.dataset.short || opt.textContent;
  closeDropdowns();
  dd.querySelector(".dd-btn").focus({ preventScroll: true });
  if (changed) sel.dispatchEvent(new Event("change", { bubbles: true }));
}
document.addEventListener("click", (e) => {
  const opt = e.target.closest(".dd-opt");
  if (opt) return pickDropdown(opt);
  const btn = e.target.closest(".dd-btn");
  if (!btn) return closeDropdowns();
  const dd = btn.closest(".dd");
  if (dd.classList.contains("open")) closeDropdowns();
  else openDropdown(dd);
});
document.addEventListener("keydown", (e) => {
  const opt = e.target.closest?.(".dd-opt");
  if (!opt) {
    if (e.target.closest?.(".dd-btn") && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      openDropdown(e.target.closest(".dd"));
    }
    return;
  }
  const dd = opt.closest(".dd");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    (e.key === "ArrowDown" ? opt.nextElementSibling : opt.previousElementSibling)?.focus();
  } else if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    closeDropdowns();
    dd.querySelector(".dd-btn").focus({ preventScroll: true });
  }
});

function navigate(hash) {
  endTour();
  state.error = "";
  if (location.hash === hash) render();
  else location.hash = hash;
}

// 누른 날짜의 주가 그대로 위로 올라가 주간 날짜 줄이 되고, 고른 날은 파란 원, 그 밑에 상세가 떠오른다
async function animateDateIntoDetails(date) {
  const week = dayWeekDates(date);
  const grid = app.querySelector(".month-scroll .grid") || app.querySelector(".grid");
  const view = (app.querySelector(".month-scroll") || grid).getBoundingClientRect();
  if (!grid) { render(); return; }
  // 달력 숫자들의 지금 자리를 기억해 둔다 (그 주는 위로 올라가고, 나머지는 겹쳐 그린 뒤 흐려지며 사라진다)
  const from = new Map();
  const ghost = document.createElement("div");
  ghost.className = "date-morph-layer week-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const weekTop = Math.min(...week.map(d => grid.querySelector(`[data-date="${d}"] .day-num`)?.getBoundingClientRect().top ?? Infinity));
  const weekdays = Array.from(app.querySelectorAll(".m-weekdays .weekday, .grid .weekday"), el => el.getBoundingClientRect()).slice(0, 7);
  grid.querySelectorAll(".day-num, .dot.on").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.bottom < view.top || r.top > view.bottom) return; // 화면 밖 주는 건너뜀
    const cell = el.closest("[data-date]");
    if (el.classList.contains("day-num") && week.includes(cell?.dataset.date)) {
      from.set(cell.dataset.date, { rect: r, font: parseFloat(getComputedStyle(el).fontSize) });
      return;
    }
    const cs = getComputedStyle(el);
    const copy = document.createElement("span");
    copy.textContent = el.textContent;
    Object.assign(copy.style, {
      position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
      font: cs.font, letterSpacing: cs.letterSpacing, color: cs.color, background: cs.backgroundColor,
      borderRadius: cs.borderRadius, boxShadow: cs.boxShadow,
    });
    copy.dataset.dir = r.top < weekTop ? "-1" : "1";
    copy.style.opacity = copy.dataset.op = getComputedStyle(el.closest(".cell") || el).opacity;
    ghost.append(copy);
  });
  // 상단: 큰 '11월'은 뒤로 가기 글자 자리로 작아지며 옮겨 가고, '2026년'은 흐려진다
  const header = [".m-month-title", ".m-year-back span"].map(sel => {
    const el = app.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const copy = document.createElement("span");
    copy.textContent = el.textContent;
    Object.assign(copy.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, height: `${r.height}px`, display: "flex", alignItems: "center", whiteSpace: "nowrap", font: cs.font, letterSpacing: cs.letterSpacing, color: cs.color, transformOrigin: "0 50%" });
    return { copy, r, font: parseFloat(cs.fontSize) };
  });
  const headerLayer = document.createElement("div");
  headerLayer.className = "date-morph-layer week-ghost";
  header.forEach(h => h && headerLayer.append(h.copy));
  document.body.append(ghost, headerLayer);
  state.pageEnter = false;
  state.dayEnter = false;
  render();
  const strip = app.querySelector(".day-week.current");
  const labels = app.querySelectorAll(".day-week-labels .day-week-wd");
  const box = app.querySelector(".day-page .day-area-inner");
  const ease = "cubic-bezier(.22,.75,.2,1)";
  const anims = [];
  try {
    Array.from(ghost.children).forEach(el => anims.push(el.animate(
      [{ opacity: Number(el.dataset.op), transform: "none" }, { opacity: 0, transform: `translateY(${el.dataset.dir * 18}px)` }],
      { duration: 260, easing: "ease-out", fill: "forwards" })));
    strip?.querySelectorAll(".day-week-cell").forEach(cell => {
      const num = cell.querySelector(".day-week-num");
      const start = from.get(cell.dataset.date);
      if (start) {
        const to = num.getBoundingClientRect();
        const dx = start.rect.left + start.rect.width / 2 - (to.left + to.width / 2);
        const dy = start.rect.top + start.rect.height / 2 - (to.top + to.height / 2);
        const scale = start.font / parseFloat(getComputedStyle(num).fontSize);
        anims.push(num.animate([{ transform: `translate(${dx}px,${dy}px) scale(${scale})` }, { transform: "none" }], { duration: 480, easing: ease }));
      } else {
        // 다른 달 날짜는 달력에 없으므로 제자리에서 나타난다
        anims.push(num.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 220, easing: "ease-out", fill: "backwards" }));
      }
      const i = Array.prototype.indexOf.call(strip.children, cell);
      const wd = labels[i];
      const wdFrom = weekdays[i];
      if (wdFrom) {
        const to = wd.getBoundingClientRect();
        anims.push(wd.animate([{ transform: `translate(${wdFrom.left + wdFrom.width / 2 - (to.left + to.width / 2)}px,${wdFrom.top + wdFrom.height / 2 - (to.top + to.height / 2)}px)` }, { transform: "none" }], { duration: 480, easing: ease }));
      }
    });
    if (box) anims.push(box.animate([{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 220, easing: ease, fill: "backwards" }));
    const [title, year] = header;
    const back = app.querySelector(".m-back-label span");
    if (title && back) {
      const to = back.getBoundingClientRect(), cs = getComputedStyle(back);
      title.copy.textContent = back.textContent;
      back.style.visibility = "hidden";
      const move = title.copy.animate([
        { transform: "none" },
        { transform: `translate(${to.left - title.r.left}px,${to.top + to.height / 2 - (title.r.top + title.r.height / 2)}px) scale(${parseFloat(cs.fontSize) / title.font})`, color: cs.color },
      ], { duration: 460, easing: ease, fill: "forwards" });
      anims.push(move);
      move.finished.finally(() => back.style.removeProperty("visibility"));
    }
    if (year) anims.push(year.copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out", fill: "forwards" }));
    await Promise.all(anims.map(a => a.finished.catch(() => {})));
  } finally {
    ghost.remove();
    headerLayer.remove();
    app.querySelector(".m-back-label span")?.style.removeProperty("visibility");
  }
}

// 연도 화면으로: 달력이 작아지며 열두 달 속으로 들어간다
function openYearView() {
  state.yearView = true;
  render();
  const view = app.querySelector(".year-view");
  const target = view?.querySelector(`[data-ym="${state.year}-${state.month}"]`);
  if (!view || !target) return;
  view.scrollTop = target.closest(".year-block").offsetTop;
  if (reducedMotion()) return;
  const r = target.getBoundingClientRect(), v = view.getBoundingClientRect();
  view.style.transformOrigin = `${r.left + r.width / 2 - v.left}px ${r.top + r.height / 2 - v.top}px`;
  view.animate([{ transform: "scale(2.4)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.22,.75,.2,1)" });
}
// 작은 달을 누르면 그 달이 화면 가득 커지며 달력으로 돌아간다
function pickMonthFromYear(el) {
  const r = el.getBoundingClientRect();
  [state.year, state.month] = el.dataset.ym.split("-").map(Number);
  state.yearView = false;
  state.monthDir = null;
  if (ADMIN_SITE) Object.assign(state, { monthOpen: true, activeYm: `${state.year}-${String(state.month).padStart(2, "0")}`, streamMonths: 6 });
  render();
  const pager = app.querySelector("#kcVp") || app.querySelector(".month-scroll");
  if (!pager || reducedMotion()) return;
  const p = pager.getBoundingClientRect();
  pager.style.transformOrigin = "0 0";
  pager.animate([
    { transform: `translate(${r.left - p.left}px,${r.top - p.top}px) scale(${r.width / p.width},${r.height / p.height})`, opacity: 0.4 },
    { transform: "none", opacity: 1 },
  ], { duration: 380, easing: "cubic-bezier(.22,.75,.2,1)" }).finished.then(() => pager.style.removeProperty("transform-origin"));
}

let pendingTabShift = 0;
function navigateMobileTab(hash) {
  const order = M_TABS;
  const previous = app.querySelector(".m-text-nav .m-tab.active")?.getAttribute("href");
  const from = order.indexOf((previous || "").replace("#/",""));
  const to = order.indexOf(hash.replace("#/",""));
  pendingTabShift = from >= 0 && to >= 0 ? Math.sign(to-from) : 0;
  navigate(hash);
}

// 탭이 바뀌었는지 보려고 마지막 화면 이름을 기억 (출·퇴근의 날짜 주소는 출·퇴근과 같은 탭)
const tabOf = (name) => (name === "day" ? "calendar" : name);
let lastTab = null;
setTimeout(() => { lastTab ??= tabOf(route().name); }, 0);
window.addEventListener("hashchange", () => {
  const wasDay = !!app.querySelector(".day-page");
  const nextPage = route().name;
  // 다른 탭으로 옮기면 맨 위부터, 출·퇴근으로 돌아오면 오늘 · 주간 화면부터
  if (lastTab !== null && tabOf(nextPage) !== lastTab) {
    window.scrollTo({ top: 0 });
    if (tabOf(nextPage) === "calendar") {
      const [year, month] = todayDateString().split("-").map(Number);
      Object.assign(state, { year, month, calDay: null, calRoute: null, monthOpen: false, yearView: false, activeYm: null, kcHeaderYm: null });
    }
  }
  lastTab = tabOf(nextPage);
  const smoothDay = !isDesktop() && !reducedMotion() &&
    ((nextPage === "day" && !!app.querySelector(".admin-cal")) || (wasDay && nextPage === "calendar"));
  if (!tour?.nav) endTour(); // 튜토리얼이 화면을 바꾸는 중이면 끄지 않는다
  state.pageEnter = true;
  state.sheet = null;
  resetDayUi();
  state.payslipId = null;
  state.allowDraft = null;
  state.slotEdit = null;
  state.helpOpen = {};
  const shift = pendingTabShift;
  pendingTabShift = 0;
  if (shift && !isDesktop() && !reducedMotion()) {
    state.pageEnter = false;
    if (document.startViewTransition) {
      document.documentElement.dataset.tabShift = shift > 0 ? "next" : "previous";
      const transition = document.startViewTransition(() => render());
      transition.finished.finally(() => { delete document.documentElement.dataset.tabShift; });
    } else {
      render();
      app.querySelector(".m-main")?.animate([{transform:`translateX(${shift*80}px)`,opacity:0},{transform:"translateX(0)",opacity:1}],{duration:420,easing:"cubic-bezier(.25,.8,.25,1)"});
    }
  } else if (smoothDay && !wasDay) {
    animateDateIntoDetails(route().date);
  } else if (smoothDay && document.startViewTransition) {
    document.documentElement.dataset.dayTransition = wasDay ? "back" : "forward";
    state.pageEnter = false;
    const date = wasDay ? app.querySelector(".day-page").dataset.detailDate : route().date;
    const source = wasDay ? app.querySelector(".day-page-inner") : calCell(date);
    if (source) source.style.viewTransitionName = "date-zoom";
    const transition = document.startViewTransition(() => {
      render();
      const target = wasDay ? calCell(date) : app.querySelector(".day-page-inner");
      if (target) target.style.viewTransitionName = "date-zoom";
    });
    transition.finished.finally(() => {
      delete document.documentElement.dataset.dayTransition;
      app.querySelectorAll('[style*="date-zoom"]').forEach(el => el.style.removeProperty("view-transition-name"));
    });
  } else {
    render();
    if (smoothDay) app.querySelector(".m-main")?.animate(
      [{ opacity: 0, transform: `translateY(${wasDay ? "-8px" : "12px"})` }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 280, easing: "cubic-bezier(.22,.61,.36,1)" }
    );
  }
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
    // 로그아웃을 누를 때까지 로그인 유지 (앱을 닫거나 다시 열어도)
    await cloud.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await cloud.auth.signInWithEmailAndPassword(email, password);
    // 매장 확인(busy "check")은 로그인 감지 쪽이 끝낸다. 여기서 지우면 "등록된 매장이 없어요"가 잠깐 뜬다
    if (state.busy === "login") state.busy = null;
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
    await cloud.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
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
  if (mobileAdminCal()) return calDay();
  return r.name === "day" ? r.date : state.selectedDate;
}

function resetDayUi() {
  state.error = "";
  state.expandedId = null;
  state.expandedRecId = null;
  state.editingId = null;
  state.editingWhere = null;
  state.adding = false;
}

function selectDate(date) {
  resetDayUi();
  state.dayEnter = true;
  if (ADMIN_SITE && !isDesktop() && mobileAdminCal()) {
    state.calDay = date;
    if (state.monthOpen) {
      // 월 달력: 고른 표시를 옮긴 뒤 그 주로 접힘
      app.querySelectorAll("#kcRows .kc-day").forEach((b) => b.classList.toggle("on", b.dataset.date === date));
      setTimeout(kcClose, 120);
      return;
    }
    state.calEnter = true;
    render();
    return;
  }
  if (!isDesktop()) {
    state.year = Number(date.slice(0, 4));
    state.month = Number(date.slice(5, 7));
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

// 날짜별 근무: 닫을 때도 내용이 사라지기 전에 카드 높이를 부드럽게 줄인다.
const workDaysAnimations = new WeakMap();
app.addEventListener("click", e => {
  const summary = e.target.closest(".m-work-days > summary");
  if (!summary) return;
  e.preventDefault();
  const card = summary.parentElement;
  const running = workDaysAnimations.get(card);
  const start = card.getBoundingClientRect().height;
  const opening = running ? !running.opening : !card.open;
  running?.animation.cancel();
  card.style.height = "";
  card.style.overflow = "hidden";
  card.open = true;
  const full = card.getBoundingClientRect().height;
  const style = getComputedStyle(card);
  const closed = summary.getBoundingClientRect().height + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  card.classList.toggle("is-expanding", opening);
  if (reducedMotion()) {
    card.open = opening;
    card.style.overflow = "";
    workDaysAnimations.delete(card);
    return;
  }
  const animation = card.animate([{height:`${start}px`},{height:`${opening ? full : closed}px`}],{duration:320,easing:"cubic-bezier(.22,.75,.2,1)",fill:"both"});
  workDaysAnimations.set(card,{animation,opening});
  animation.finished.then(()=>{
    if(workDaysAnimations.get(card)?.animation!==animation) return;
    card.open = opening;
    animation.cancel();
    card.style.overflow = "";
    workDaysAnimations.delete(card);
  },()=>{});
});

// 텍스트 메뉴의 선택 배경을 손가락으로 좌우 이동
let textNavDrag = null;
let textNavSuppressUntil = 0;
app.addEventListener("pointerdown", e => {
  const nav = e.target.closest(".m-text-nav");
  if (!nav || e.button !== 0) return;
  textNavDrag = {nav, id:e.pointerId, x:e.clientX, index:Number(nav.style.getPropertyValue("--nav-position"))};
});
app.addEventListener("pointermove", e => {
  const drag = textNavDrag;
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX-drag.x;
  if (Math.abs(dx)<6) return;
  drag.nav.classList.add("dragging");
  drag.nav.setPointerCapture(e.pointerId);
  const width = drag.nav.querySelector(".m-text-links").clientWidth/4;
  drag.position = Math.max(0,Math.min(3,drag.index+dx/width));
  drag.nav.style.setProperty("--nav-position",drag.position);
});
function finishTextNavDrag(e) {
  const drag=textNavDrag;
  if (!drag || drag.id!==e.pointerId) return;
  textNavDrag=null;
  drag.nav.classList.remove("dragging");
  if (drag.position===undefined || e.type==="pointercancel") {
    drag.nav.style.setProperty("--nav-position",drag.index); return;
  }
  textNavSuppressUntil=Date.now()+400;
  const index=Math.round(drag.position);
  drag.nav.style.setProperty("--nav-position",index);
  navigateMobileTab(["#/calendar","#/schedule","#/employees","#/records"][index]);
}
app.addEventListener("pointerup",finishTextNavDrag);
app.addEventListener("pointercancel",finishTextNavDrag);
app.addEventListener("click",e=>{
  const link=e.target.closest(".m-text-nav .m-tab");
  if (!link) return;
  e.preventDefault();
  if(Date.now()<textNavSuppressUntil) return;
  const nav=link.closest(".m-text-nav");
  nav.style.setProperty("--nav-position",Array.from(nav.querySelectorAll(".m-tab")).indexOf(link));
  const href=link.getAttribute("href");
  navigateMobileTab(href);
},true);

// 모바일 메뉴는 데이터 재렌더 없이 열고 닫아 입력 중인 내용을 유지한다.
function setMobileMenu(open) {
  state.mobileMenuOpen = open;
  const nav = app.querySelector('.m-bubble-nav');
  if (!nav) return;
  nav.classList.toggle('is-open', open);
  const toggle = nav.querySelector('.m-menu-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 펼치기');
  nav.querySelector('.m-bubble-links').inert = !open;
}
app.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-date]");
  if (cell) {
    selectDate(cell.dataset.date);
    return;
  }

  const el = e.target.closest("[data-action]");
  // 명세서 창 안쪽 빈 곳을 누르면 바깥(닫기)으로 전달되지 않게
  // 글래시 박스(.m-blur-layer)도 카드 안쪽은 바깥 닫기로 넘기지 않는다
  const isBackdrop = el?.matches(".ps-backdrop, .sheet-backdrop, .m-blur-layer");
  const insideDialog = isBackdrop && e.target.closest("[data-stop], .m-blur-card") && !e.target.closest("[data-action]:not(.ps-backdrop):not(.sheet-backdrop):not(.m-blur-layer)");
  if (!el || insideDialog) return;
  const { action, id } = el.dataset;

  switch (action) {
    case "toggle-mobile-menu":
      setMobileMenu(el.getAttribute('aria-expanded') !== 'true');
      return; // 공통 render()가 열린 메뉴를 다시 닫지 않도록 여기서 종료
    case "prev-month":
    case "next-month":
      moveMonth(action === "prev-month" ? -1 : 1);
      break;
    case "open-exports":
      state.exportsOpen = true;
      break;
    case "close-exports":
      // 카드 빈 곳을 누른 건 무시 (바깥 흐린 곳 · 닫기만 닫힘)
      if (e.target.closest(".m-blur-card") && !e.target.closest("[data-close]")) return;
      state.exportsOpen = false;
      break;
    case "open-sched-history":
      if (state.slotEdit) liveSlot({ final: true });
      state.slotEdit = null;
      state.historyOpen = true;
      state.historyView = null;
      break;
    case "close-sched-history":
      if (e.target.closest(".m-blur-card") && !e.target.closest("[data-close]")) return;
      state.historyOpen = false;
      break;
    case "view-sched-version":
      state.historyView = state.historyView === el.dataset.key ? null : el.dataset.key;
      break;
    case "delete-sched-version": {
      const from = el.dataset.key;
      uiConfirm(`${from.replaceAll("-", ".")}부터 쓰는 근무표를 삭제할까요?\n이미 찍힌 출근 기록은 그대로예요.`, { ok: "삭제", danger: true }).then((yes) => {
        if (!yes) return;
        deleteScheduleVersion(from);
        queueToast("근무표를 삭제했어요");
        render();
      });
      return;
    }
    case "load-sched-version":
      loadScheduleVersion(el.dataset.key);
      queueToast("불러왔어요. 시작 날짜를 넣고 근무표 반영을 눌러 주세요.");
      break;
    case "toggle-month":
      if (state.monthOpen) kcClose();
      else kcOpen();
      return;
    case "open-year":
      [state.year, state.month] = (state.activeYm ?? calDay().slice(0, 7)).split("-").map(Number);
      openYearView();
      return;
    case "pick-month":
      pickMonthFromYear(el);
      return;
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
      state.editingWhere = null;
      state.expandedRecId = null;
      const opening = state.expandedId !== id;
      state.expandedId = opening ? id : null;
      state.expandEnter = Boolean(state.expandedId);
      break;
    }
    case "toggle-rec":
      state.error = "";
      state.editingId = null;
      state.editingWhere = null;
      state.expandedId = null;
      state.expandedRecId = state.expandedRecId === id ? null : id;
      break;
    case "edit-shift":
      state.error = "";
      state.editingId = id;
      state.editingWhere = el.dataset.where ?? "staff";
      break;
    case "cancel-edit":
      state.error = "";
      state.editingId = null;
      state.editingWhere = null;
      break;
    case "approve-shift-change":
    case "reject-shift-change":
      reviewShiftChange(id, action === "approve-shift-change", el);
      return;
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
      // 직원: 바로 고치지 않고 관리자에게 수정 요청
      if (!ADMIN_SITE) {
        submitShiftChange(emp, date, start, end, document.getElementById("change-reason")?.value.trim() || "");
        return;
      }
      // 오늘 · 지난 날짜는 근무 기록만 고친다 (기록이 없으면 새로 넣는다). 근무표 시간은 그대로
      if (date <= todayDateString()) {
        setRecordTimes(id, date, start, end);
        save();
        queueToast(`${emp.name}님 근무 시간을 고쳤어요`);
        state.error = "";
        state.editingId = null;
        state.editingWhere = null;
        state.expandedId = null;
        state.expandedRecId = null;
        break;
      }
      // 앞으로의 날짜: 그날만 근무 시간을 바꾼다
      setShift(id, date, start, end);
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
    case "clock-out": {
      const date = el.dataset.recDate ?? todayDateString();
      state.error = clockOut(id, date) || "";
      if (!state.error) {
        state.expandedId = null;
        queueToast(`${employeeById(id).name}님 퇴근 완료! ${formatTime(recordFor(id, date).clockOut)}로 기록했어요`);
      }
      break;
    }
    case "clock-in":
      state.error = clockIn(id) || "";
      if (!state.error) {
        state.expandedId = null;
        state.justAddedId = recordFor(id, todayDateString()).id;
        queueToast(`${employeeById(id).name}님 출근 완료! ${formatTime(recordFor(id, todayDateString()).clockIn)}로 기록했어요`);
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
        state.expandedRecId = null;
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
      queueToast(isManager(emp) ? `${emp.name}님을 직원(월급제)로 바꿨어요. 급여 화면 명세서에서 월급을 입력해주세요` : `${emp.name}님을 알바(시급제)로 바꿨어요`);
      break;
    }
    case "open-employee-page":
      navigate(`#/employees/${encodeURIComponent(id)}`);
      window.scrollTo(0, 0);
      return;
    case "employee-list":
      navigate("#/employees");
      return;
    case "open-pay-page":
      navigate(`#/records/${encodeURIComponent(id)}/${state.payroll.month}`);
      window.scrollTo(0, 0);
      return;
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
    case "copy-store-code":
      copyText(storeId ?? "").then(
        () => showToast("매장 코드를 복사했어요", "ok"),
        () => showToast("복사하지 못했어요. 코드를 직접 입력해 주세요."),
      );
      return;
    case "copy-staff-link":
      copyText(staffUrl()).then(
        () => showToast("직원용 달력 주소를 복사했어요", "ok"),
        () => showToast("복사하지 못했어요. 주소를 길게 눌러 복사해주세요."),
      );
      return;
    case "start-tour":
      startTour(route().name === "day" && mobileAdminCal() ? "calendar" : route().name);
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
    case "preview-payslip":
      previewPayslipFromAmount(id);
      return;
    case "open-payslip":
      state.modalEnter = true;
      openPayslipState(id);
      // 휴대폰: 새 수당 입력칸 하나를 연다 (키보드는 칸을 누를 때만)
      state.allowNew = { name: "", amount: 0 };
      break;
    case "close-payslip":
      state.allowNew = null;
      state.payslipId = null;
      state.allowDraft = null;
      state.salDraft = null;
      break;
    case "save-payslip":
      if (!isDesktop()) commitAllowNew();
      setAllowances(state.payroll.month, state.payslipId, state.allowDraft.filter((a) => a.name || a.amount));
      if (state.salDraft) setSalary(state.payslipId, state.payroll.month, normalizeSalary(state.salDraft));
      save();
      queueToast(state.salDraft ? `저장했어요. ${Number(state.payroll.month.slice(5, 7))}월부터 다음 달에도 같은 금액으로 들어가요` : "수당을 저장했어요");
      state.payslipId = null;
      state.allowDraft = null;
      state.salDraft = null;
      state.allowNew = null;
      break;
    case "add-allowance":
      // 휴대폰: 입력한 새 수당을 목록(한 줄 글자)으로 옮기고 입력칸을 비운다
      if (!isDesktop()) {
        commitAllowNew();
        break;
      }
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

// 직원용 달력은 좌우로 밀면 달이 넘어간다
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
    if (target.closest(".sheet, input, select, textarea, .sched-scroll, .ts-mobile, .m-tabbar, .kc-scroller, .tour-pop")) return;
    if (!target.closest(".cal-wrap")) return;
    moveMonth(dx < 0 ? 1 : -1);
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
              return `<span class="m-pp${done(e) ? " on" : ""}"><i style="background:${copyDisplayColor(e.color)}"></i>${nameLabel(e)}<small>${noTimeShift(e, today) ? "대타" : `${shortTime(start)}~${shortTime(end)}`}</small></span>`;
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
  "prev-month", "next-month", "open-year", "pick-month", "toggle-month", "open-exports", "close-exports", "open-sched-history", "close-sched-history", "view-sched-version", "close-panel", "go-home", "toggle-staff", "toggle-rec", "toggle-help",
  "payroll-prev", "payroll-next", "preview-payslip", "open-payslip", "close-payslip",
  "open-employee-page", "employee-list", "open-pay-page", "open-sheet", "close-sheet", "sched-day", "open-today", "install-app", "dismiss-install", "start-tour", "toggle-mobile-menu",
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
  // 화면을 다시 그리지 않고 알림만 띄운다 (글래시 박스가 다시 뜨며 깜빡이지 않게)
  state.toast = "둘러보기 중이에요. 로그인하면 쓸 수 있어요.";
  state.toastKind = "";
  document.querySelector(".toast")?.remove();
  app.insertAdjacentHTML("beforeend", toastHtml());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2200);
};
// 보기만 바꾸는 입력칸 (급여 화면의 직원 선택)
const demoViewField = (t) => t.dataset?.payroll !== undefined || t.dataset?.calendarMonth !== undefined || t.dataset?.payEmployee !== undefined;
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
  const hire = todayDateString(); // 입사일은 추가한 날
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
  showToast(manager ? `${name}님을 직원(월급제)로 추가했어요. 공제액은 급여 화면 명세서에서 입력해주세요` : `${name}님을 알바로 추가했어요`, "ok");
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
    if (refreshPayInline()) return;
    render();
    return;
  }
  if (t.dataset.allowNew && state.allowNew) {
    state.allowNew[t.dataset.allowNew] = t.dataset.allowNew === "amount" ? parseMoney(t.value) : t.value.trim();
    if (t.dataset.allowNew === "amount") t.value = state.allowNew.amount ? Number(state.allowNew.amount).toLocaleString() : "";
    refreshPayInline();
    return;
  }
  if (t.dataset.allow) {
    const item = state.allowDraft[Number(t.dataset.index)];
    item[t.dataset.allow] = t.dataset.allow === "amount" ? parseMoney(t.value) : t.value.trim();
    if (t.dataset.allow === "amount" && !isDesktop()) t.value = item.amount ? Number(item.amount).toLocaleString() : "";
    if (refreshPayInline()) return;
    render();
    return;
  }
  if (t.dataset.payEmployee) {
    navigate(`#/records/${encodeURIComponent(t.value)}/${state.payroll.month}`);
    return;
  }
  if (t.dataset.calendarMonth) {
    [state.year, state.month] = t.value.split("-").map(Number);
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
  // 직원 화면은 이름만 받는다 (시간은 출근 · 퇴근을 찍으면 정해진다)
  const start = ADMIN_SITE ? readTime("extra-start") : null;
  const end = ADMIN_SITE ? readTime("extra-end") : null;
  if (!name) return;
  if (ADMIN_SITE && (!start || !end || start === end)) {
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
  else if (ADMIN_SITE) setShift(emp.id, date, start, end);
  else if (!scheduledOn(date).includes(emp) && !recordFor(emp.id, date)) {
    // 이미 오늘 근무자면 근무 시간을 덮어쓰지 않고 그대로 펼쳐 준다
    const now = formatTime(new Date().toISOString());
    store.shifts[date] = { ...store.shifts[date], [emp.id]: { start: now, end: now, noTime: true } };
  }
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
// 휴대폰: 입력칸을 누르면 키보드가 올라온 뒤 그 칸이 화면 가운데에 오게
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (isDesktop() || !t.matches?.("input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea")) return;
  setTimeout(() => {
    if (document.activeElement !== t) return;
    const vv = window.visualViewport;
    const r = t.getBoundingClientRect();
    const h = vv ? vv.height : innerHeight;
    if (r.top < 70 || r.bottom > h - 90) t.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, 320);
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
    // 근로계약서 기능은 없앴지만, 이미 서명한 계약서가 지워지지 않게 저장 데이터는 그대로 유지한다
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
// 복사본 표시색만 변환: 공유 데이터에 저장된 직원 색은 변경하지 않는다.
function copyDisplayColor(value) {
  const color = cssColor(value);
  const hsl = color.match(/^hsl\((\d+) (\d+)% (\d+)%\)$/);
  if (hsl) return +hsl[1] >= 234 && +hsl[1] <= 314 ? "#FF05BF" : color;
  let hex = color.slice(1);
  if (!color.startsWith("#")) return color;
  if (hex.length === 3 || hex.length === 4) hex = hex.split("").map(x => x + x).join("");
  const [r,g,b] = [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)/255);
  const max=Math.max(r,g,b), min=Math.min(r,g,b), delta=max-min;
  if (!delta) return color;
  let hue = max === r ? ((g-b)/delta)%6 : max === g ? (b-r)/delta+2 : (r-g)/delta+4;
  hue=(hue*60+360)%360;
  if (hue < 234 || hue > 314) return color;
  const light=(max+min)/2;
  return light > .85 ? "#FFE0F7" : light > .65 ? "#FF9DE6" : "#FF05BF";
}

function cssColor(v) {
  return typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|hsl\(\d{1,3} \d{1,3}% \d{1,3}%\))$/.test(v) ? v : "#ffffff";
}
function cleanRange(r) {
  const ok = (t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
  return r && ok(r.start) && ok(r.end) ? { start: r.start, end: r.end, ...(r.noTime === true ? { noTime: true } : {}) } : null;
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
    (r) => r && safeId(r.id) && safeId(r.employeeId) && safeDate(r.date) && safeIso(r.clockIn) && (!r.clockOut || safeIso(r.clockOut)) && (!r.punchIn || safeIso(r.punchIn)) && (!r.punchOut || safeIso(r.punchOut)),
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
  let authSeen = false;
  cloud.auth.onAuthStateChanged(async (user) => {
    state.authReady = true;
    const firstAuth = !authSeen;
    authSeen = true;
    if (!ADMIN_SITE) {
      render();
      return;
    }
    // 매장 등록 중에는 createStore 가 매장을 연다
    if (state.busy === "signup") return;
    if (!user) {
      enterDemo();
      // 앱을 처음 열면 로그인 화면부터 (샘플 매장은 로그인 화면에서 둘러보기로)
      if (firstAuth && !["/login", "/signup"].includes(location.hash.replace(/^#/, ""))) location.replace("#/login");
    }
    else {
      state.adminStore = null;
      watchPrivate(false);
      state.busy = "check";
      render();
      state.ownerFailed = false;
      // 로그인 직후엔 권한이 늦게 붙어 읽기가 실패할 수 있어 몇 번 다시 읽는다
      for (let i = 0; i < 3; i++) {
        try {
          const code = (await cloud.db.ref(`owners/${user.uid}`).once("value")).val();
          if (code && cloud.auth.currentUser?.uid === user.uid) openStore(code, true);
          state.ownerFailed = false;
          break;
        } catch (err) {
          console.warn("매장 정보를 읽지 못했어요", err);
          state.ownerFailed = true;
          await new Promise((r) => setTimeout(r, 700 * (i + 1)));
        }
      }
      state.busy = null;
    }
    render();
  });
})();
