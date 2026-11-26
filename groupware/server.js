'use strict';

const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT ?? 3000);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'groupware.db'));

db.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
    team TEXT NOT NULL,
    annual_total REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('annual', 'half_am', 'half_pm')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approver_id INTEGER REFERENCES users(id),
    comment TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT,
    UNIQUE (user_id, work_date)
  );
  CREATE TABLE IF NOT EXISTS weekly_reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_start TEXT NOT NULL,
    items TEXT NOT NULL,
    next_plan TEXT NOT NULL,
    issues TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    approver_id INTEGER REFERENCES users(id),
    comment TEXT,
    submitted_at TEXT,
    decided_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    created_at TEXT NOT NULL
  );
`);

const leaveRows = `
  SELECT r.id, r.user_id AS userId, u.name AS userName, r.type,
         r.start_date AS startDate, r.end_date AS endDate, r.days,
         r.reason, r.status, r.approver_id AS approverId,
         a.name AS approverName, r.comment,
         r.created_at AS createdAt, r.decided_at AS decidedAt
  FROM leave_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users a ON a.id = r.approver_id
`;
const listUsers = db.prepare('SELECT id, name, role, team FROM users ORDER BY id');
const findUser = db.prepare('SELECT id, name, role, team, annual_total FROM users WHERE id = ?');
const findLeave = db.prepare(`${leaveRows} WHERE r.id = ?`);
const listLeave = db.prepare(`
  ${leaveRows} WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC
`);
const listPending = db.prepare(`
  ${leaveRows} WHERE u.team = ? AND r.status = 'pending' ORDER BY r.created_at, r.id
`);
const sumLeave = db.prepare(`
  SELECT COALESCE(SUM(days) FILTER (WHERE status = 'approved'), 0) AS used,
         COALESCE(SUM(days) FILTER (WHERE status = 'pending'), 0) AS pending
  FROM leave_requests WHERE user_id = ?
`);
const insertLeave = db.prepare(`
  INSERT INTO leave_requests (user_id, type, start_date, end_date, days, reason, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
`);
const updateLeave = db.prepare(`
  UPDATE leave_requests SET status = ?, approver_id = ?, comment = ?, decided_at = ?
  WHERE id = ? AND status = 'pending'
`);

const cancelPendingLeave = db.prepare(`
  UPDATE leave_requests SET status = 'cancelled', decided_at = ? WHERE id = ? AND status = 'pending'
`);
const calendarLeave = db.prepare(`
  SELECT r.id, u.name AS userName, r.type, r.start_date AS startDate,
         r.end_date AS endDate, r.days, r.status
  FROM leave_requests r JOIN users u ON u.id = r.user_id
  WHERE u.team = ? AND r.start_date <= ? AND r.end_date >= ? AND r.status IN ('pending', 'approved')
  ORDER BY r.start_date, r.id
`);
const teamOnLeave = db.prepare(`
  SELECT u.name AS userName, r.type
  FROM leave_requests r JOIN users u ON u.id = r.user_id
  WHERE u.team = ? AND r.status = 'approved' AND r.start_date <= ? AND r.end_date >= ?
  GROUP BY u.id, r.type ORDER BY u.id, r.type
`);

const attendanceFields = 'work_date AS workDate, check_in AS checkIn, check_out AS checkOut';
const findAttendance = db.prepare(`
  SELECT ${attendanceFields} FROM attendance WHERE user_id = ? AND work_date = ?
`);
const monthAttendance = db.prepare(`
  SELECT ${attendanceFields} FROM attendance
  WHERE user_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date
`);
const teamAttendance = db.prepare(`
  SELECT u.id AS userId, u.name AS userName, a.check_in AS checkIn, a.check_out AS checkOut,
         EXISTS (
           SELECT 1 FROM leave_requests r WHERE r.user_id = u.id AND r.status = 'approved'
           AND r.start_date <= ? AND r.end_date >= ?
         ) AS onLeave
  FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
  WHERE u.team = ? ORDER BY u.id
`);
const insertCheckIn = db.prepare(`
  INSERT INTO attendance (user_id, work_date, check_in) VALUES (?, ?, ?)
  ON CONFLICT (user_id, work_date) DO NOTHING
  RETURNING ${attendanceFields}
`);
const setCheckOut = db.prepare(`
  UPDATE attendance SET check_out = ? WHERE user_id = ? AND work_date = ? AND check_out IS NULL
  RETURNING ${attendanceFields}
`);

const reportRows = `
  SELECT r.id, r.user_id AS userId, u.name AS userName, r.week_start AS weekStart,
         r.items, r.next_plan AS nextPlan, r.issues, r.status, r.approver_id AS approverId,
         a.name AS approverName, r.comment, r.submitted_at AS submittedAt,
         r.decided_at AS decidedAt, r.updated_at AS updatedAt
  FROM weekly_reports r JOIN users u ON u.id = r.user_id
  LEFT JOIN users a ON a.id = r.approver_id
`;
const findReport = db.prepare(`${reportRows} WHERE r.id = ?`);
const findWeek = db.prepare(`${reportRows} WHERE r.user_id = ? AND r.week_start = ?`);
const listReports = db.prepare(`${reportRows} WHERE r.user_id = ? ORDER BY r.week_start DESC`);
const saveReport = db.prepare(`
  INSERT INTO weekly_reports (user_id, week_start, items, next_plan, issues, status, submitted_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    items = excluded.items, next_plan = excluded.next_plan, issues = excluded.issues,
    status = excluded.status, approver_id = NULL, comment = NULL, decided_at = NULL,
    submitted_at = excluded.submitted_at, updated_at = excluded.updated_at
  WHERE weekly_reports.status IN ('draft', 'rejected')
  RETURNING id
`);
const updateReport = db.prepare(`
  UPDATE weekly_reports SET status = ?, approver_id = ?, comment = ?, decided_at = ?, updated_at = ?
  WHERE id = ? AND status = 'submitted'
`);

const noticeRows = `
  SELECT n.id, u.name AS authorName, n.title, n.body, n.pinned, n.created_at AS createdAt
  FROM notices n JOIN users u ON u.id = n.author_id
`;
const findNotice = db.prepare(`${noticeRows} WHERE n.id = ?`);
const listNotices = db.prepare(`${noticeRows} ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`);
const homeNotices = db.prepare(`
  SELECT id, title, pinned, created_at AS createdAt FROM notices
  ORDER BY pinned DESC, created_at DESC, id DESC LIMIT 3
`);
const insertNotice = db.prepare(`
  INSERT INTO notices (author_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)
`);

const approvalScopes = {
  pending: {
    leaves: listPending,
    reports: db.prepare(`${reportRows} WHERE u.team = ? AND r.status = 'submitted'`),
    sortBy: 'createdAt',
    direction: 1
  },
  history: {
    leaves: db.prepare(`${leaveRows} WHERE r.approver_id = ?`),
    reports: db.prepare(`${reportRows} WHERE r.approver_id = ?`),
    sortBy: 'decidedAt',
    direction: -1
  },
  mine: {
    leaves: db.prepare(`${leaveRows} WHERE r.user_id = ? AND r.status <> 'cancelled'`),
    reports: db.prepare(`${reportRows} WHERE r.user_id = ? AND r.status <> 'draft'`),
    sortBy: 'createdAt',
    direction: -1
  }
};
const countMyPending = db.prepare(`
  SELECT (SELECT COUNT(*) FROM leave_requests WHERE user_id = ? AND status = 'pending') +
         (SELECT COUNT(*) FROM weekly_reports WHERE user_id = ? AND status = 'submitted') AS count
`);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) body += chunk;

  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, '올바른 JSON 요청이 필요합니다.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'JSON 객체를 입력해 주세요.');
  }
  return value;
}

function readId(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, '올바른 ID를 입력해 주세요.');
  }
  return value;
}

function getUser(id) {
  const user = findUser.get(id);
  if (!user) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  return user;
}

function getManager(id) {
  const manager = getUser(id);
  if (manager.role !== 'manager') {
    throw new HttpError(403, '팀장 권한이 필요합니다.');
  }
  return manager;
}

function requireSameTeam(manager, userId) {
  if (getUser(userId).team !== manager.team) {
    throw new HttpError(403, '다른 팀의 요청은 결재할 수 없습니다.');
  }
}

function textValue(value, message, required = false) {
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new HttpError(400, message);
  }
  return value.trim();
}

function decisionComment(comment, required = false) {
  if (comment == null && !required) return null;
  const message = required ? '반려 의견을 입력해 주세요.' : '결재 의견은 문자로 입력해 주세요.';
  return textValue(comment, message, required) || null;
}

function balance(user) {
  const { used, pending } = sumLeave.get(user.id);
  const total = user.annual_total;
  return { total, used, pending, remaining: total - used };
}

function parseDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) {
      return date;
    }
  }
  throw new HttpError(400, '날짜는 실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
}

const twoDigits = (value) => String(value).padStart(2, '0');

function localDate(now) {
  return `${String(now.getFullYear()).padStart(4, '0')}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

function clockTime(minutes) {
  return `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
}

function addDays(day, offset) {
  const date = parseDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function monday(day) {
  return addDays(day, -((parseDate(day).getUTCDay() + 6) % 7));
}

function monthRange(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpError(400, '월은 YYYY-MM 형식으로 입력해 주세요.');
  }
  const first = `${month}-01`;
  const last = parseDate(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return [first, last.toISOString().slice(0, 10)];
}

function seedDatabase() {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (listUsers.all().length === 0) seedInitialRows();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedInitialRows() {
  db.exec(`
    INSERT INTO users (id, name, role, team, annual_total)
    VALUES (1, '김신입', 'employee', '개발팀', 15),
           (2, '이분석', 'employee', '개발팀', 15),
           (3, '박팀장', 'manager', '개발팀', 20)
  `);

  const today = localDate(new Date());
  const first = `${today.slice(0, 7)}-01`;
  const workdays = [];
  for (let day = first; day < today; day = addDays(day, 1)) {
    const weekday = parseDate(day).getUTCDay();
    if (weekday >= 1 && weekday <= 5) workdays.push(day);
  }
  const insertAttendance = db.prepare(`
    INSERT INTO attendance (user_id, work_date, check_in, check_out) VALUES (?, ?, ?, ?)
  `);
  for (const { id } of listUsers.all()) {
    const firstLateDay = Math.min(id - 1, workdays.length - 1);
    const secondLateDay = Math.min(id + 3, workdays.length - 1);
    for (const [index, day] of workdays.entries()) {
      const late = index === firstLateDay || (id !== 1 && index === secondLateDay);
      const checkIn = late ? 541 + ((index + id * 3) % 10) : 520 + ((index * 7 + id * 3) % 21);
      const checkOut = 1080 + ((index * 19 + id * 11) % 91);
      insertAttendance.run(id, day, clockTime(checkIn), clockTime(checkOut));
    }
  }

  const previousWeek = addDays(monday(today), -7);
  const lastFriday = addDays(previousWeek, 4);
  const submittedAt = new Date(`${lastFriday}T15:00:00`).toISOString();
  const decidedAt = new Date(`${lastFriday}T17:00:00`).toISOString();
  const insertApprovedReport = db.prepare(`
    INSERT INTO weekly_reports (
      user_id, week_start, items, next_plan, issues, status, approver_id, comment,
      submitted_at, decided_at, updated_at
    ) VALUES (?, ?, ?, ?, '', 'approved', 3, '확인했습니다.', ?, ?, ?)
  `);
  const seedTasks = [['그룹웨어', '화면 요구사항 정리'], ['업무 분석', '팀 현황 자료 분석']];
  for (const [index, [project, content]] of seedTasks.entries()) {
    const items = JSON.stringify([{ project, hours: 40, content }]);
    insertApprovedReport.run(index + 1, previousWeek, items, '검토 결과를 반영합니다.',
      submittedAt, decidedAt, decidedAt);
  }

  const seedNotices = [
    ['워크샵 해커톤 안내', '워크샵에서 사내 업무 개선 해커톤을 진행합니다.', 1],
    ['연말 연차 사용 권장', '잔여 연차를 확인하고 팀 일정에 맞춰 신청해 주세요.', 0],
    ['사내 시스템 점검 안내', '정기 점검 전에 작업 내용을 저장해 주세요.', 0]
  ];
  for (const [index, [title, body, pinned]] of seedNotices.entries()) {
    const date = addDays(today, -seedNotices.length + index);
    insertNotice.run(3, title, body, pinned, new Date(`${date}T09:00:00`).toISOString());
  }
}

function countWeekdays(start, end) {
  const calendarDays = (end - start) / 86_400_000 + 1;
  let weekdays = Math.floor(calendarDays / 7) * 5;
  for (let offset = 0; offset < calendarDays % 7; offset++) {
    const day = (start.getUTCDay() + offset) % 7;
    if (day > 0 && day < 6) weekdays++;
  }
  return weekdays;
}

function createLeave({ userId, type, startDate, endDate, reason }) {
  userId = readId(userId);
  if (!['annual', 'half_am', 'half_pm'].includes(type)) {
    throw new HttpError(400, '올바른 연차 유형을 선택해 주세요.');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new HttpError(400, '신청 사유를 입력해 주세요.');
  }
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end < start) throw new HttpError(400, '종료일은 시작일보다 빠를 수 없습니다.');
  if (type !== 'annual' && startDate !== endDate) {
    throw new HttpError(400, '반차는 시작일과 종료일이 같아야 합니다.');
  }
  const weekdays = countWeekdays(start, end);
  if (weekdays === 0) throw new HttpError(400, '신청 기간에 평일이 있어야 합니다.');
  const days = type === 'annual' ? weekdays : 0.5;

  // Reserve pending days atomically with the balance check.
  db.exec('BEGIN IMMEDIATE');
  try {
    const { remaining, pending } = balance(getUser(userId));
    const available = remaining - pending;
    if (available < days) {
      throw new HttpError(400, `잔여 연차가 부족합니다 (가능: ${available}일)`);
    }
    const { lastInsertRowid } = insertLeave.run(
      userId, type, startDate, endDate, days, reason.trim(), new Date().toISOString()
    );
    const leave = findLeave.get(lastInsertRowid);
    db.exec('COMMIT');
    return leave;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getLeave(id) {
  const leave = findLeave.get(id);
  if (!leave) throw new HttpError(404, '연차 신청을 찾을 수 없습니다.');
  return leave;
}

function decideLeave(id, status, { approverId, comment }) {
  const approver = getManager(readId(approverId));
  requireSameTeam(approver, getLeave(id).userId);
  const { changes } = updateLeave.run(
    status, approver.id, decisionComment(comment), new Date().toISOString(), id
  );
  if (changes === 0) throw new HttpError(409, '이미 처리된 연차 신청입니다.');
  return findLeave.get(id);
}

function cancelLeave(id, { userId }) {
  const user = getUser(readId(userId));
  if (getLeave(id).userId !== user.id) {
    throw new HttpError(403, '본인의 연차 신청만 취소할 수 있습니다.');
  }
  if (cancelPendingLeave.run(new Date().toISOString(), id).changes === 0) {
    throw new HttpError(409, '대기 중인 연차 신청만 취소할 수 있습니다.');
  }
  return findLeave.get(id);
}

function attendanceStatus(row) {
  const checkIn = row?.checkIn ?? null;
  const checkOut = row?.checkOut ?? null;
  const status = checkOut ? 'done' : checkIn ? 'working' : 'none';
  return { checkIn, checkOut, status, late: checkIn !== null && checkIn > '09:00' };
}

function timeMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function attendanceRecord(row) {
  const workMinutes = row.checkOut ? timeMinutes(row.checkOut) - timeMinutes(row.checkIn) : 0;
  return { ...row, workMinutes, late: row.checkIn > '09:00' };
}

function markAttendance(checkIn, { userId }) {
  const user = getUser(readId(userId));
  const now = new Date();
  const today = localDate(now);
  const time = clockTime(now.getHours() * 60 + now.getMinutes());
  const row = checkIn ? insertCheckIn.get(user.id, today, time) : setCheckOut.get(time, user.id, today);
  if (!row) {
    const message = checkIn ? '이미 출근했습니다.' : '출근 기록이 없거나 이미 퇴근했습니다.';
    throw new HttpError(409, message);
  }
  return attendanceRecord(row);
}

function getMonthAttendance(user, month) {
  const records = monthAttendance.all(user.id, ...monthRange(month)).map(attendanceRecord);
  const summary = { days: records.length, totalMinutes: 0, lateCount: 0 };
  for (const record of records) {
    summary.totalMinutes += record.workMinutes;
    summary.lateCount += Number(record.late);
  }
  return { records, summary };
}

function getTeamAttendance(manager) {
  const today = localDate(new Date());
  return teamAttendance.all(today, today, today, manager.team).map((row) => ({
    userId: row.userId, userName: row.userName, ...attendanceStatus(row), onLeave: Boolean(row.onLeave)
  }));
}

function reportObject(row) {
  const items = JSON.parse(row.items);
  const totalHours = items.reduce((total, item) => total + item.hours, 0);
  return { ...row, items, totalHours };
}

function currentReport(user) {
  const weekStart = monday(localDate(new Date()));
  const row = findWeek.get(user.id, weekStart);
  return row ? reportObject(row) : { weekStart, status: 'none', items: [], nextPlan: '', issues: '' };
}

function putReport({ userId, weekStart, items, nextPlan, issues, submit = false }) {
  const user = getUser(readId(userId));
  if (parseDate(weekStart).getUTCDay() !== 1) {
    throw new HttpError(400, '주간보고 시작일은 월요일이어야 합니다.');
  }
  if (typeof submit !== 'boolean' || !Array.isArray(items)) {
    throw new HttpError(400, '업무 항목과 제출 여부를 올바르게 입력해 주세요.');
  }
  if (submit && items.length === 0) {
    throw new HttpError(400, '제출하려면 업무 항목을 한 개 이상 입력해 주세요.');
  }
  const tasks = items.map((item) => {
    if (!item || !Number.isFinite(item.hours) || (submit && item.hours <= 0)) {
      throw new HttpError(400, '업무 시간을 올바르게 입력해 주세요. 제출 시 0보다 커야 합니다.');
    }
    return {
      project: textValue(item.project, '프로젝트를 문자로 입력해 주세요.'),
      hours: item.hours,
      content: textValue(item.content, '업무 내용을 문자로 입력해 주세요.')
    };
  });
  nextPlan = textValue(nextPlan, '차주 계획을 문자로 입력해 주세요.');
  issues = textValue(issues, '이슈를 문자로 입력해 주세요.');

  const timestamp = new Date().toISOString();
  const status = submit ? 'submitted' : 'draft';
  const saved = saveReport.get(user.id, weekStart, JSON.stringify(tasks), nextPlan, issues,
    status, submit ? timestamp : null, timestamp);
  if (!saved) throw new HttpError(409, '제출되었거나 승인된 주간보고는 수정할 수 없습니다.');
  return reportObject(findReport.get(saved.id));
}

function decideReport(id, status, { approverId, comment }) {
  const approver = getManager(readId(approverId));
  const report = findReport.get(id);
  if (!report) throw new HttpError(404, '주간보고를 찾을 수 없습니다.');
  requireSameTeam(approver, report.userId);
  if (report.status !== 'submitted') {
    throw new HttpError(409, '제출된 주간보고만 처리할 수 있습니다.');
  }
  const timestamp = new Date().toISOString();
  const { changes } = updateReport.run(
    status, approver.id, decisionComment(comment, status === 'rejected'), timestamp, timestamp, id
  );
  if (changes === 0) throw new HttpError(409, '제출된 주간보고만 처리할 수 있습니다.');
  return reportObject(findReport.get(id));
}

function noticeObject(row) {
  return { ...row, pinned: Boolean(row.pinned) };
}

function createNotice({ userId, title, body, pinned }) {
  const author = getManager(readId(userId));
  title = textValue(title, '공지 제목을 입력해 주세요.', true);
  body = textValue(body, '공지 내용을 입력해 주세요.', true);
  if (![true, false, 0, 1].includes(pinned)) {
    throw new HttpError(400, '공지 고정 여부를 올바르게 입력해 주세요.');
  }
  const { lastInsertRowid } = insertNotice.run(author.id, title, body, Number(pinned),
    new Date().toISOString());
  return noticeObject(findNotice.get(lastInsertRowid));
}

const leaveTypes = { annual: '연차', half_am: '오전 반차', half_pm: '오후 반차' };

function approvalItem(kind, detail) {
  const { id, userId, userName, status, decidedAt } = detail;
  const createdAt = kind === 'leave' ? detail.createdAt : detail.submittedAt;
  const title = kind === 'leave'
    ? `${leaveTypes[detail.type]} ${detail.days}일 (${detail.startDate} ~ ${detail.endDate})`
    : `주간보고 ${detail.weekStart} 주 (총 ${detail.totalHours}시간)`;
  return { kind, id, userId, userName, title, status, createdAt, decidedAt, detail };
}

function approvals(scope, value) {
  const { leaves, reports, sortBy, direction } = approvalScopes[scope];
  const items = [
    ...leaves.all(value).map((row) => approvalItem('leave', row)),
    ...reports.all(value).map((row) => approvalItem('weekly', reportObject(row)))
  ];
  return items.sort((a, b) => direction * (
    a[sortBy].localeCompare(b[sortBy]) || a.kind.localeCompare(b.kind) || a.id - b.id
  ));
}

function home(user) {
  const { id, name, role, team } = user;
  const today = localDate(new Date());
  const weekStart = monday(today);
  const report = findWeek.get(id, weekStart);
  return {
    user: { id, name, role, team },
    today,
    attendance: attendanceStatus(findAttendance.get(id, today)),
    balance: balance(user),
    weeklyReport: { weekStart, status: report?.status ?? 'none' },
    myPendingCount: countMyPending.get(id, id).count,
    approvalPendingCount: role === 'manager' ? approvals('pending', team).length : 0,
    teamOnLeaveToday: teamOnLeave.all(team, today, today),
    notices: homeNotices.all().map(noticeObject)
  };
}

async function handleApi(req, res, pathname, query) {
  if (req.method === 'GET') {
    const user = () => getUser(readId(query.get('userId')));
    const manager = (key) => getManager(readId(query.get(key)));
    const month = query.get('month');
    switch (pathname) {
      case '/api/users':
        return json(res, 200, listUsers.all());
      case '/api/home':
        return json(res, 200, home(user()));
      case '/api/notices':
        return json(res, 200, listNotices.all().map(noticeObject));
      case '/api/attendance':
        return json(res, 200, getMonthAttendance(user(), month));
      case '/api/attendance/team':
        return json(res, 200, getTeamAttendance(manager('managerId')));
      case '/api/weekly-reports/current':
        return json(res, 200, currentReport(user()));
      case '/api/weekly-reports':
        return json(res, 200, listReports.all(user().id).map(reportObject));
      case '/api/leave-requests':
        return json(res, 200, listLeave.all(user().id));
      case '/api/leave-calendar': {
        const { team } = user();
        const [first, last] = monthRange(month);
        return json(res, 200, calendarLeave.all(team, last, first));
      }
      case '/api/approvals':
        return json(res, 200, approvals('pending', manager('approverId').team));
      case '/api/approvals/history':
        return json(res, 200, approvals('history', manager('approverId').id));
      case '/api/approvals/mine':
        return json(res, 200, approvals('mine', user().id));
    }

    const match = /^\/api\/users\/([^/]+)\/balance$/.exec(pathname);
    if (match) return json(res, 200, balance(getUser(readId(match[1]))));
  }
  if (req.method === 'PUT' && pathname === '/api/weekly-reports') {
    return json(res, 200, putReport(await readJson(req)));
  }
  if (req.method === 'POST') {
    switch (pathname) {
      case '/api/notices':
        return json(res, 201, createNotice(await readJson(req)));
      case '/api/attendance/check-in':
        return json(res, 201, markAttendance(true, await readJson(req)));
      case '/api/attendance/check-out':
        return json(res, 200, markAttendance(false, await readJson(req)));
      case '/api/leave-requests':
        return json(res, 201, createLeave(await readJson(req)));
    }
    const leave = /^\/api\/leave-requests\/([^/]+)\/(approve|reject|cancel)$/.exec(pathname);
    if (leave) {
      const [, rawId, action] = leave;
      const id = readId(rawId);
      const body = await readJson(req);
      if (action === 'cancel') return json(res, 200, cancelLeave(id, body));
      return json(res, 200, decideLeave(id, action === 'approve' ? 'approved' : 'rejected', body));
    }
    const report = /^\/api\/weekly-reports\/([^/]+)\/(approve|reject)$/.exec(pathname);
    if (report) {
      const [, id, action] = report;
      const status = action === 'approve' ? 'approved' : 'rejected';
      return json(res, 200, decideReport(readId(id), status, await readJson(req)));
    }
  }
  throw new HttpError(404, '요청한 API를 찾을 수 없습니다.');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || /[\\:\0]/.test(pathname)) {
    throw new HttpError(404, '파일을 찾을 수 없습니다.');
  }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(publicDir, `.${requested}`);
  try {
    const realFile = fs.realpathSync(file);
    const relative = path.relative(publicDir, realFile);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
      throw new HttpError(404, '파일을 찾을 수 없습니다.');
    }
    const content = fs.readFileSync(realFile);
    const type = contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) {
      throw new HttpError(404, '파일을 찾을 수 없습니다.');
    }
    throw error;
  }
}

seedDatabase();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url.searchParams);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.message });
    } else if (error instanceof URIError) {
      json(res, 400, { error: '요청 경로가 올바르지 않습니다.' });
    } else {
      console.error(error);
      json(res, 500, { error: '요청을 처리하는 중 오류가 발생했습니다.' });
    }
  }
}).listen(port, () => console.log(`Groupware is listening on port ${port}`));
