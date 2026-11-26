'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');

// node:sqlite works without a flag from Node 22.13; older versions fail with a confusing error.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  console.error(`Node.js 22.13 이상이 필요합니다 (현재 ${process.versions.node}). https://nodejs.org 에서 LTS를 설치하세요.`);
  process.exit(1);
}
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// groupware/.env 가 있으면 환경변수로 읽음 (LLM 키 등, git 제외)
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const assistant = require('./assistant');
const { readWeeklyWorkbook } = require('./xlsx');

const port = Number(process.env.PORT ?? 3000);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// Bump when a table changes. A demo DB from another version is moved aside and recreated,
// because CREATE TABLE IF NOT EXISTS does not alter existing tables.
const SCHEMA_VERSION = 1;
const dbPath = path.join(dataDir, 'groupware.db');
fs.mkdirSync(dataDir, { recursive: true });
let db = new DatabaseSync(dbPath);
const dbVersion = db.prepare('PRAGMA user_version').get().user_version;
const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
if (hasTables && dbVersion !== SCHEMA_VERSION) {
  db.close();
  const suffix = `old-${Date.now()}`;
  for (const name of ['groupware.db', 'groupware.db-wal', 'groupware.db-shm', 'uploads']) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.${suffix}`);
  }
  console.log(`예전 버전 DB를 data/groupware.db.${suffix} 로 옮기고 새로 만듭니다.`);
  db = new DatabaseSync(dbPath);
}

db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA user_version = ${SCHEMA_VERSION};
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'executive')),
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
    current_json TEXT NOT NULL,
    next_json TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    approver_id INTEGER REFERENCES users(id),
    comment TEXT,
    submitted_at TEXT,
    decided_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS team_summaries (
    id INTEGER PRIMARY KEY,
    team TEXT NOT NULL,
    week_start TEXT NOT NULL,
    manager_id INTEGER NOT NULL REFERENCES users(id),
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (team, week_start)
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY,
    office TEXT NOT NULL,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    equipment TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_reservations (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    title TEXT NOT NULL,
    attendees TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'cancelled')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notice_attachments (
    id INTEGER PRIMARY KEY,
    notice_id INTEGER NOT NULL REFERENCES notices(id),
    name TEXT NOT NULL,
    url TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,
    space TEXT NOT NULL,
    doc_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    labels TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

db.exec('BEGIN IMMEDIATE');
try {
  if (!db.prepare('PRAGMA table_info(weekly_reports)').all().some(({ name }) => name === 'file_name')) {
    db.exec('ALTER TABLE weekly_reports ADD COLUMN file_name TEXT');
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

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
  SELECT r.id, r.user_id AS userId, u.name AS userName, u.team, r.week_start AS weekStart,
         r.current_json AS currentJson, r.next_json AS nextJson, r.status, r.approver_id AS approverId,
         a.name AS approverName, r.comment, r.file_name AS fileName, r.submitted_at AS submittedAt,
         r.decided_at AS decidedAt, r.updated_at AS updatedAt
  FROM weekly_reports r JOIN users u ON u.id = r.user_id
  LEFT JOIN users a ON a.id = r.approver_id
`;
const findReport = db.prepare(`${reportRows} WHERE r.id = ?`);
const findWeek = db.prepare(`${reportRows} WHERE r.user_id = ? AND r.week_start = ?`);
const listReports = db.prepare(`${reportRows} WHERE r.user_id = ? ORDER BY r.week_start DESC`);
const listTeamReports = db.prepare(`
  ${reportRows} WHERE u.team = ? AND u.role = 'employee' AND r.week_start = ?
`);
const saveReport = db.prepare(`
  INSERT INTO weekly_reports (user_id, week_start, current_json, next_json, status, submitted_at, updated_at, file_name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    current_json = excluded.current_json, next_json = excluded.next_json,
    status = excluded.status, approver_id = NULL, comment = NULL, decided_at = NULL,
    submitted_at = excluded.submitted_at, updated_at = excluded.updated_at,
    file_name = COALESCE(excluded.file_name, weekly_reports.file_name)
  WHERE weekly_reports.status IN ('draft', 'rejected')
  RETURNING id
`);
const updateReport = db.prepare(`
  UPDATE weekly_reports SET status = ?, approver_id = ?, comment = ?, decided_at = ?, updated_at = ?
  WHERE id = ? AND status = 'submitted'
`);
const submitDraftReport = db.prepare(`
  UPDATE weekly_reports SET status = 'submitted', approver_id = NULL, comment = NULL, decided_at = NULL,
    submitted_at = ?, updated_at = ?
  WHERE id = ? AND status IN ('draft', 'rejected')
`);

const listReportingTeams = db.prepare(`
  SELECT team, MIN(CASE WHEN role = 'manager' THEN name END) AS managerName
  FROM users WHERE role <> 'executive' GROUP BY team ORDER BY team
`);
const listTeamEmployees = db.prepare(`
  SELECT id AS userId, name AS userName FROM users WHERE team = ? AND role = 'employee' ORDER BY id
`);
const findTeamSummary = db.prepare(`
  SELECT s.summary, u.name AS managerName, s.updated_at AS updatedAt
  FROM team_summaries s JOIN users u ON u.id = s.manager_id
  WHERE s.team = ? AND s.week_start = ?
`);
const saveTeamSummary = db.prepare(`
  INSERT INTO team_summaries (team, week_start, manager_id, summary, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (team, week_start) DO UPDATE SET
    manager_id = excluded.manager_id, summary = excluded.summary, updated_at = excluded.updated_at
`);

const listRooms = db.prepare('SELECT id, office, name, capacity, equipment FROM rooms ORDER BY id');
const findRoom = db.prepare('SELECT id FROM rooms WHERE id = ?');
const reservationRows = `
  SELECT r.id, r.room_id AS roomId, room.name AS roomName, r.user_id AS userId,
         u.name AS userName, u.team, r.date, r.start_time AS startTime, r.end_time AS endTime,
         r.title, r.attendees, r.status, r.created_at AS createdAt
  FROM room_reservations r
  JOIN rooms room ON room.id = r.room_id
  JOIN users u ON u.id = r.user_id
`;
const findReservation = db.prepare(`${reservationRows} WHERE r.id = ?`);
const listDayReservations = db.prepare(`
  ${reservationRows} WHERE r.date = ? AND r.status = 'reserved'
  ORDER BY r.room_id, r.start_time, r.id
`);
const listMyReservations = db.prepare(`
  ${reservationRows} WHERE r.user_id = ? AND r.date >= ? AND r.status = 'reserved'
  ORDER BY r.date, r.start_time, r.id
`);
const homeReservations = db.prepare(`
  SELECT r.id, room.name AS roomName, r.start_time AS startTime, r.end_time AS endTime, r.title
  FROM room_reservations r JOIN rooms room ON room.id = r.room_id
  WHERE r.user_id = ? AND r.date = ? AND r.status = 'reserved'
  ORDER BY r.start_time, r.id
`);
const overlappingReservation = db.prepare(`
  SELECT r.start_time AS startTime, r.end_time AS endTime, u.name AS userName
  FROM room_reservations r JOIN users u ON u.id = r.user_id
  WHERE r.room_id = ? AND r.date = ? AND r.status = 'reserved' AND r.start_time < ? AND r.end_time > ?
  ORDER BY r.start_time, r.id LIMIT 1
`);
const insertReservation = db.prepare(`
  INSERT INTO room_reservations (room_id, user_id, date, start_time, end_time, title, attendees, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
`);
const cancelActiveReservation = db.prepare(`
  UPDATE room_reservations SET status = 'cancelled' WHERE id = ? AND status = 'reserved'
`);

const noticeRows = `
  SELECT n.id, u.name AS authorName, n.title, n.body, n.pinned, n.created_at AS createdAt
  FROM notices n JOIN users u ON u.id = n.author_id
`;
const findNotice = db.prepare(`${noticeRows} WHERE n.id = ?`);
const listAttachments = db.prepare('SELECT name, url FROM notice_attachments WHERE notice_id = ? ORDER BY id');
const insertAttachment = db.prepare('INSERT INTO notice_attachments (notice_id, name, url) VALUES (?, ?, ?)');
const docMetadata = 'd.id, d.space, d.doc_key AS docKey, d.title, d.labels, editor.name AS updatedByName, d.updated_at AS updatedAt';
const listDocs = db.prepare(`
  SELECT ${docMetadata} FROM docs d JOIN users editor ON editor.id = d.updated_by
  ORDER BY d.space, d.title, d.id
`);
const findDoc = db.prepare(`
  SELECT ${docMetadata}, d.body, author.name AS authorName, d.created_at AS createdAt
  FROM docs d JOIN users editor ON editor.id = d.updated_by JOIN users author ON author.id = d.author_id
  WHERE d.id = ?
`);
const docsExist = db.prepare('SELECT 1 FROM docs LIMIT 1');
const docSearchRows = db.prepare('SELECT id AS docId, title, space, body FROM docs ORDER BY id');
const insertDoc = db.prepare(`
  INSERT INTO docs (id, space, doc_key, title, body, labels, author_id, updated_by, created_at, updated_at)
  SELECT COALESCE(MAX(id), 0) + 1, ?, 'DOC-' || (COALESCE(MAX(id), 0) + 1), ?, ?, ?, ?, ?, ?, ? FROM docs
  RETURNING id
`);
const updateDoc = db.prepare(`
  UPDATE docs SET title = ?, body = ?, labels = ?, updated_by = ?, updated_at = ?
  WHERE id = ?
`);
// 해커톤 사전공고 첨부 (사내 문서라 git 에는 올리지 않음: public/files/ 는 .gitignore). 파일이 있을 때만 시드에 붙인다.
const hackathonNotice = {
  name: '2026워크샵_비알프레임_해커톤_사전공고.html',
  url: 'files/2026-workshop-hackathon-notice.html'
};
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

async function readWorkbookBytes(req) {
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) {
    req.resume();
    throw new HttpError(413, '주간보고 파일은 2MB 이하로 업로드해 주세요.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) break;
    chunks.push(chunk);
  }
  if (size > MAX_UPLOAD_BYTES) {
    req.resume();
    throw new HttpError(413, '주간보고 파일은 2MB 이하로 업로드해 주세요.');
  }
  return Buffer.concat(chunks, size);
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

function readWeekStart(value) {
  if (parseDate(value).getUTCDay() !== 1) {
    throw new HttpError(400, '주간보고 시작일은 월요일이어야 합니다.');
  }
  return value;
}

function selectedWeek(value) {
  return value === null ? monday(localDate(new Date())) : readWeekStart(value);
}

function weekLabel(weekStart, offset = 0) {
  const start = parseDate(weekStart);
  start.setUTCDate(start.getUTCDate() + offset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 3);
  const month = end.getUTCMonth() + 1;
  const week = Math.ceil(end.getUTCDate() / 7);
  end.setUTCDate(end.getUTCDate() + 1);
  const monthDay = (day) => `${twoDigits(day.getUTCMonth() + 1)}/${twoDigits(day.getUTCDate())}`;
  return `${month}월 ${week}주차(${monthDay(start)} ~ ${monthDay(end)})`;
}

function emptyWeekPart(entries = []) {
  return { personalSchedule: '', issues: '', requests: '', entries };
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
    if (!docsExist.get()) seedDocs();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedDocs() {
  const example = '> 예시 문서입니다. 실제 일정·규정이 아닙니다.';
  const release = [
    example,
    '',
    '## 개요',
    '출퇴근, 연차, 주간보고와 회의실 예약을 한곳에서 처리하는 첫 그룹웨어 버전입니다. 개발팀이 기능을 구현하고 사내 시범 운영에서 받은 의견을 반영합니다.',
    '',
    '## 마일스톤',
    '| 단계 | 기간 | 담당 | 상태 |',
    '| --- | --- | --- | --- |',
    '| 요구사항 정리 | 11/23~11/27 | 김신입 | 완료 |',
    '| 화면 설계 | 11/30~12/04 | 이분석 | 진행 중 |',
    '| API 개발 | 12/07~12/18 | 박사원 | 예정 |',
    '| 사내 시범 운영 | 12/21~12/24 | 박팀장 | 예정 |',
    '| 정식 오픈 | 2027-01-04 | 박팀장 | 예정 |',
    '',
    '## 작업 목록',
    '| 이슈 키 | 요약 | 담당 | 기한 | 상태 |',
    '| --- | --- | --- | --- | --- |',
    '| GW-101 | 요구사항 정리 | 김신입 | 11/27 | 완료 |',
    '| GW-102 | 홈 화면 설계 | 이분석 | 12/04 | 진행 중 |',
    '| GW-103 | 연차 결재 검증 | 김신입 | 12/11 | 예정 |',
    '| GW-104 | 주간보고 업로드 구현 | 박사원 | 12/18 | 예정 |',
    '| GW-105 | 회의실 예약 검증 | 이분석 | 12/18 | 예정 |',
    '| GW-106 | 시범 운영 회고 | 박팀장 | 12/24 | 예정 |',
    '',
    '## 정기 회의',
    '- 매주 월요일 10:00 주간 회의 · 중회의실',
    '- 매주 목요일 16:00 데모 리뷰',
    '',
    '## 리스크',
    '- 주간보고 양식이 바뀌면 읽어 오는 셀 위치가 달라질 수 있습니다. 시범 운영에서 양식 변경 사례를 확인합니다.',
    '- 시범 운영 중 결재 요청이 밀리면 팀장이 미처리 건을 확인하고 추가 검증 범위를 정합니다.'
  ].join('\n');
  const guide = [
    example,
    '',
    '## 연차 신청 기준',
    '- 연차는 사용 3일 전까지 신청하는 것을 권장합니다.',
    '- 반차 시간은 오전 09:00~14:00, 오후 14:00~18:00입니다.',
    '- 연말에는 미사용 연차 안내를 확인하고 팀 일정에 맞춰 사용 계획을 세워 주세요.',
    '',
    '## 결재 흐름',
    '1. 구성원이 연차 또는 반차 신청을 등록합니다.',
    '2. 팀장이 신청을 확인하고 승인하거나 반려합니다.',
    '3. 반려되면 결재 의견을 확인하고 신청서를 수정해 재신청합니다.',
    '',
    '## 회의실 예약 규칙',
    '- 운영 시간은 08:00~20:00이며 30분 단위로 예약합니다.',
    '- 사용하지 않을 회의실은 미리 취소해 다른 구성원이 사용할 수 있도록 합니다.',
    '- 대회의실은 팀장 이상이 우선 예약합니다.',
    '',
    '## 문의처',
    '연차와 회의실 사용 관련 문의는 경영지원팀 내선 100으로 연락해 주세요.'
  ].join('\n');
  const seed = db.prepare(`
    INSERT INTO docs (space, doc_key, title, body, labels, author_id, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const users = listUsers.all();
  const authorId = (users.find(({ role }) => role === 'manager') ?? users[0]).id;
  const timestamp = '2026-11-26T00:00:00.000Z';
  seed.run('그룹웨어 프로젝트', 'GW', '그룹웨어 v1 출시 일정', release, '출시,마일스톤', authorId, authorId,
    timestamp, timestamp);
  seed.run('사내 가이드', 'GUIDE', '연차·회의실 이용 가이드', guide, '연차,회의실', authorId, authorId,
    timestamp, timestamp);
}

function getDoc(id) {
  const doc = findDoc.get(id);
  if (!doc) throw new HttpError(404, '문서를 찾을 수 없습니다.');
  return doc;
}

function readDocFields({ title, body, labels = '' }) {
  title = textValue(title, '문서 제목을 입력해 주세요.', true);
  if (typeof body !== 'string' || !body.trim()) throw new HttpError(400, '문서 본문을 입력해 주세요.');
  if (body.length > 20000) throw new HttpError(400, '문서 본문은 20,000자 이하로 입력해 주세요.');
  labels = textValue(labels, '문서 라벨은 쉼표로 구분한 문자열로 입력해 주세요.');
  return { title, body, labels };
}

function createDoc(payload) {
  const author = getUser(readId(payload.userId));
  const space = textValue(payload.space, '스페이스 이름을 입력해 주세요.', true);
  const { title, body, labels } = readDocFields(payload);
  const timestamp = new Date().toISOString();
  const { id } = insertDoc.get(space, title, body, labels, author.id, author.id, timestamp, timestamp);
  return getDoc(id);
}

function editDoc(id, payload) {
  const editor = getUser(readId(payload.userId));
  const { title, body, labels } = readDocFields(payload);
  const { changes } = updateDoc.run(title, body, labels, editor.id, new Date().toISOString(), id);
  if (!changes) throw new HttpError(404, '문서를 찾을 수 없습니다.');
  return getDoc(id);
}

const DOC_PARTICLE = /(?:으로|까지|부터|에서|은|는|이|가|을|를|에|의|로|와|과|도|만|요)$/;

function searchTokens(text) {
  const words = new Set();
  const bigrams = new Set();
  const tokens = text.normalize('NFC').toLowerCase().match(/[a-z]+\d*-\d+|[\p{L}\p{N}]+/gu) ?? [];
  for (const token of tokens) {
    const stem = token.replace(DOC_PARTICLE, '');
    const word = stem.length >= 2 ? stem : token;
    words.add(word);
    for (const run of word.match(/[가-힣]+/g) ?? []) {
      for (let index = 0; index + 1 < run.length; index++) bigrams.add(run.slice(index, index + 2));
    }
  }
  return { words, bigrams };
}

function overlapScore(query, text) {
  const terms = searchTokens(text);
  let score = 0;
  for (const word of query.words) if (terms.words.has(word)) score += 2;
  for (const pair of query.bigrams) if (terms.bigrams.has(pair)) score += 1;
  return score;
}

function docSections(title, body) {
  const sections = [];
  let heading = title;
  let lines = [];
  let fence = '';
  function flush() {
    const text = lines.join('\n').trim();
    if (text) sections.push({ heading, body: text });
    lines = [];
  }
  for (const line of body.split(/\r?\n/)) {
    const marker = /^ {0,3}(\x60{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) fence = marker;
    else if (fence && marker?.startsWith(fence) && line.trim() === marker) fence = '';
    const match = !fence && /^ {0,3}#{2,3}[ \t]+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function searchDocs(query, limit = 5) {
  const terms = searchTokens(query);
  if (!terms.words.size) return [];
  const matches = [];
  for (const { docId, title, space, body } of docSearchRows.all()) {
    const titleScore = overlapScore(terms, title) * 2;
    for (const section of docSections(title, body)) {
      const headingScore = section.heading === title ? 0 : overlapScore(terms, section.heading) * 2;
      const score = titleScore + headingScore + overlapScore(terms, section.body);
      if (score > 0) {
        matches.push({ docId, title, space, ...section, excerpt: section.body.slice(0, 300), score });
      }
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

function seedInitialRows() {
  db.exec(`
    INSERT INTO users (id, name, role, team, annual_total)
    VALUES (1, '김신입', 'employee', '개발팀', 15),
           (2, '이분석', 'employee', '개발팀', 15),
           (3, '박팀장', 'manager', '개발팀', 20),
           (4, '최데이터', 'employee', '데이터팀', 15),
           (5, '정연구', 'employee', '데이터팀', 15),
           (6, '한팀장', 'manager', '데이터팀', 20),
           (7, '강상무', 'executive', '경영진', 20),
           (8, '박사원', 'employee', '개발팀', 15)
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

  // 박사원(8): 오늘(주말이면 다음 평일) 박팀장(3)이 승인한 연차 1일 → 홈·근태 화면에 "오늘 팀 부재자"로 보임
  let absentDay = today;
  while ([0, 6].includes(parseDate(absentDay).getUTCDay())) absentDay = addDays(absentDay, 1);
  const approvedAt = new Date(`${addDays(today, -1)}T10:00:00`).toISOString();
  db.prepare(`
    INSERT INTO leave_requests (
      user_id, type, start_date, end_date, days, reason, status, approver_id, comment, created_at, decided_at
    ) VALUES (8, 'annual', ?, ?, 1, '가족 행사', 'approved', 3, '확인했습니다.', ?, ?)
  `).run(absentDay, absentDay, approvedAt, approvedAt);

  seedWeeklyReports(today);
  seedReservations(today);

  const seedNotices = [
    ['워크샵 해커톤 안내', '워크샵에서 사내 업무 개선 해커톤을 진행합니다.', 1],
    ['연말 연차 사용 권장', '잔여 연차를 확인하고 팀 일정에 맞춰 신청해 주세요.', 0],
    ['사내 시스템 점검 안내', '정기 점검 전에 작업 내용을 저장해 주세요.', 0]
  ];
  for (const [index, [title, body, pinned]] of seedNotices.entries()) {
    const date = addDays(today, -seedNotices.length + index);
    const { lastInsertRowid } = insertNotice.run(3, title, body, pinned, new Date(`${date}T09:00:00`).toISOString());
    if (index === 0 && fs.existsSync(path.join(publicDir, hackathonNotice.url))) {
      insertAttachment.run(lastInsertRowid, hackathonNotice.name, hackathonNotice.url);
    }
  }
}

function seedReservations(today) {
  db.exec(`
    INSERT INTO rooms (id, office, name, capacity, equipment)
    VALUES (1, '마곡 사무실', '대회의실', 12, 'TV·화상회의'),
           (2, '마곡 사무실', '중회의실', 8, 'TV'),
           (3, '마곡 사무실', '소회의실 A', 4, ''),
           (4, '마곡 사무실', '소회의실 B', 4, '')
  `);

  let nextWeekday = addDays(today, 1);
  while ([0, 6].includes(parseDate(nextWeekday).getUTCDay())) {
    nextWeekday = addDays(nextWeekday, 1);
  }
  const timestamp = new Date(`${today}T00:00:00`).toISOString();
  const meetings = [
    [1, 3, today, '10:00', '11:00', '개발팀 주간 회의', '개발팀'],
    [2, 6, today, '14:00', '15:00', '데이터팀 스프린트 리뷰', '데이터팀'],
    [3, 1, today, '11:30', '12:00', '그룹웨어 시연 준비', '김신입, 이분석'],
    [1, 6, nextWeekday, '09:00', '10:00', '데이터 대시보드 공유', '데이터팀'],
    [2, 2, nextWeekday, '15:00', '16:00', '운영 지원 점검', '개발팀']
  ];
  for (const meeting of meetings) insertReservation.run(...meeting, timestamp);
}

function seedWeeklyReports(today) {
  const currentWeek = monday(today);
  const previousWeek = addDays(currentWeek, -7);
  const previousFriday = addDays(previousWeek, 4);
  const submittedAt = new Date(`${previousFriday}T15:00:00`).toISOString();
  const decidedAt = new Date(`${previousFriday}T17:00:00`).toISOString();
  const insertApproved = db.prepare(`
    INSERT INTO weekly_reports (
      user_id, week_start, current_json, next_json, status, approver_id, comment,
      submitted_at, decided_at, updated_at
    ) VALUES (?, ?, ?, ?, 'approved', ?, '확인했습니다.', ?, ?, ?)
  `);
  const tasks = [
    [1, 3, '사내 그룹웨어', '요구사항 정리'],
    [2, 3, 'AI 챗봇 PoC', '질문 유형 정리'],
    [4, 6, '데이터 대시보드', '가상 지표 구성'],
    [5, 6, '운영 지원', '점검 항목 정리']
  ];
  for (const [userId, managerId, category, content] of tasks) {
    const current = emptyWeekPart([{ day: 'mon', category, workType: '회사', content, hours: 6 }]);
    const next = {
      ...emptyWeekPart([{
        day: 'tue', category, workType: '재택', content: '다음 단계 검증\n검토 결과 정리', hours: 4
      }]),
      personalSchedule: '팀 회의', issues: '없음', requests: '검토 일정 공유'
    };
    insertApproved.run(userId, previousWeek, JSON.stringify(current), JSON.stringify(next),
      managerId, submittedAt, decidedAt, decidedAt);
  }
  saveTeamSummary.run('개발팀', previousWeek, 3, '그룹웨어와 챗봇 시연 범위를 확정했습니다.', decidedAt);
  saveTeamSummary.run('데이터팀', previousWeek, 6, '가상 지표와 점검 항목을 검토했습니다.', decidedAt);

  const timestamp = new Date(`${currentWeek}T00:00:00`).toISOString();
  const submitted = {
    ...emptyWeekPart([{
      day: 'mon', category: '데이터 대시보드', workType: '회사', content: '가상 지표 집계 검증', hours: 6
    }]),
    personalSchedule: '없음', issues: '가상 데이터 검증 일정 조정', requests: '시연 일정 공유'
  };
  const draft = {
    ...emptyWeekPart([{
      day: 'wed', category: '운영 지원', workType: '재택', content: '점검 절차 초안', hours: 3
    }]),
    issues: '초안 검토 중'
  };
  const emptyNext = JSON.stringify(emptyWeekPart());
  saveReport.get(4, currentWeek, JSON.stringify(submitted), emptyNext, 'submitted', timestamp, timestamp, null);
  saveReport.get(5, currentWeek, JSON.stringify(draft), emptyNext, 'draft', null, timestamp, null);
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

function reportWeekFields(weekStart, current, next) {
  const hours = (part) => part.entries.reduce((total, entry) => total + entry.hours, 0);
  return {
    weekStart, weekLabel: weekLabel(weekStart), nextWeekLabel: weekLabel(weekStart, 7),
    current, next, totalHours: hours(current), nextTotalHours: hours(next)
  };
}

function reportObject({ currentJson, nextJson, weekStart, ...row }) {
  return { ...row, ...reportWeekFields(weekStart, JSON.parse(currentJson), JSON.parse(nextJson)) };
}

function currentReport(user) {
  const weekStart = monday(localDate(new Date()));
  const row = findWeek.get(user.id, weekStart);
  if (row) return reportObject(row);
  const previous = findWeek.get(user.id, addDays(weekStart, -7));
  const entries = previous ? JSON.parse(previous.nextJson).entries : [];
  return { ...reportWeekFields(weekStart, emptyWeekPart(entries), emptyWeekPart()), status: 'none', fileName: null };
}

const workdays = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);
const workTypes = new Set(['회사', '재택', '출장', '외근', '휴가']);

function readWeekPart(part) {
  if (!part || typeof part !== 'object' || !Array.isArray(part.entries)) {
    throw new HttpError(400, '금주 실적과 차주 계획을 양식에 맞게 입력해 주세요.');
  }
  const dailyHours = new Map();
  const entries = part.entries.map((entry) => {
    if (!entry || !workdays.has(entry.day)) {
      throw new HttpError(400, '업무 요일은 월요일부터 금요일까지 선택해 주세요.');
    }
    if (!workTypes.has(entry.workType)) {
      throw new HttpError(400, '올바른 근무 형태를 선택해 주세요.');
    }
    const { day, workType, hours } = entry;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      throw new HttpError(400, '업무 시간은 0시간 초과 24시간 이하로 입력해 주세요.');
    }
    const total = (dailyHours.get(day) ?? 0) + hours;
    if (total > 24) throw new HttpError(400, '하루 업무 시간 합계는 24시간을 넘을 수 없습니다.');
    dailyHours.set(day, total);
    return {
      day,
      category: textValue(entry.category, '업무 구분을 문자로 입력해 주세요.'),
      workType,
      content: textValue(entry.content, '업무 내용을 문자로 입력해 주세요.'),
      hours
    };
  });
  return {
    personalSchedule: textValue(part.personalSchedule, '개인일정을 문자로 입력해 주세요.'),
    issues: textValue(part.issues, '이슈사항을 문자로 입력해 주세요.'),
    requests: textValue(part.requests, '요청사항을 문자로 입력해 주세요.'),
    entries
  };
}

function weeklyEmployee(userId) {
  const user = getUser(readId(userId));
  if (user.role !== 'employee') {
    throw new HttpError(403, '구성원만 개인 주간보고를 작성할 수 있습니다.');
  }
  return user;
}

function putReport({ userId, weekStart, current, next, submit = false }) {
  const user = weeklyEmployee(userId);
  readWeekStart(weekStart);
  if (typeof submit !== 'boolean') throw new HttpError(400, '제출 여부를 올바르게 입력해 주세요.');
  const currentPart = readWeekPart(current);
  const nextPart = readWeekPart(next);
  if (submit && currentPart.entries.length === 0) {
    throw new HttpError(400, '제출하려면 금주 실적에 업무 항목을 한 개 이상 입력해 주세요.');
  }

  const timestamp = new Date().toISOString();
  const status = submit ? 'submitted' : 'draft';
  const saved = saveReport.get(user.id, weekStart, JSON.stringify(currentPart), JSON.stringify(nextPart),
    status, submit ? timestamp : null, timestamp, null);
  if (!saved) throw new HttpError(409, '제출되었거나 승인된 주간보고는 수정할 수 없습니다.');
  return reportObject(findReport.get(saved.id));
}

function getReport(id) {
  const report = findReport.get(id);
  if (!report) throw new HttpError(404, '주간보고를 찾을 수 없습니다.');
  return report;
}

const reportFilePath = (id) => path.join(uploadsDir, `${id}.xlsx`);

function replaceReportFile(file, bytes) {
  const staged = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(staged, bytes, { flag: 'wx' });
    fs.renameSync(staged, file);
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

async function uploadReport(req, query) {
  const user = weeklyEmployee(query.get('userId'));
  const fileName = textValue(query.get('fileName'), '주간보고 파일 이름을 입력해 주세요.', true);
  if (!/\.xlsx$/i.test(fileName) || /[\\/\p{Cc}]/u.test(fileName)) {
    throw new HttpError(400, '주간보고 양식을 읽을 수 없습니다: 올바른 xlsx 파일 이름이 필요합니다.');
  }
  const bytes = await readWorkbookBytes(req);
  let workbook;
  try {
    workbook = readWeeklyWorkbook(bytes, localDate(new Date()));
  } catch (error) {
    throw new HttpError(400, `주간보고 양식을 읽을 수 없습니다: ${error.message}`);
  }
  const { weekStart, current, next, warnings } = workbook;
  const timestamp = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  let file;
  let previous;
  let replaced = false;
  try {
    const saved = saveReport.get(user.id, weekStart, JSON.stringify(current), JSON.stringify(next),
      'draft', null, timestamp, fileName);
    if (!saved) throw new HttpError(409, '제출되었거나 승인된 주간보고는 수정할 수 없습니다.');
    const report = reportObject(findReport.get(saved.id));
    fs.mkdirSync(uploadsDir, { recursive: true });
    file = reportFilePath(saved.id);
    if (fs.existsSync(file)) previous = fs.readFileSync(file);
    replaceReportFile(file, bytes);
    replaced = true;
    db.exec('COMMIT');
    return { report, warnings };
  } catch (error) {
    // DB 커밋이 실패하면 덮어썼던 원본도 복구한다.
    try {
      if (replaced) {
        if (previous) replaceReportFile(file, previous);
        else fs.rmSync(file, { force: true });
      }
    } finally {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}

function submitReport(id, { userId }) {
  const user = getUser(readId(userId));
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = getReport(id);
    if (row.userId !== user.id) throw new HttpError(403, '본인의 주간보고만 제출할 수 있습니다.');
    if (!['draft', 'rejected'].includes(row.status)) {
      throw new HttpError(409, '임시저장 또는 반려된 주간보고만 제출할 수 있습니다.');
    }
    if (JSON.parse(row.currentJson).entries.length === 0) {
      throw new HttpError(400, '제출하려면 금주 실적에 업무 항목을 한 개 이상 입력해 주세요.');
    }
    const timestamp = new Date().toISOString();
    submitDraftReport.run(timestamp, timestamp, id);
    const report = reportObject(findReport.get(id));
    db.exec('COMMIT');
    return report;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function downloadReportFile(res, id, viewerId) {
  const viewer = getUser(readId(viewerId));
  const report = getReport(id);
  if (viewer.id !== report.userId && viewer.role !== 'executive' &&
      !(viewer.role === 'manager' && viewer.team === report.team)) {
    throw new HttpError(403, '주간보고 원본을 받을 권한이 없습니다.');
  }
  if (!report.fileName) throw new HttpError(404, '주간보고 원본 파일이 없습니다.');
  let bytes;
  try {
    bytes = fs.readFileSync(reportFilePath(id));
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, '주간보고 원본 파일이 없습니다.');
    throw error;
  }
  const name = encodeURIComponent(report.fileName).replace(/['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename="weekly-report-${id}.xlsx"; filename*=UTF-8''${name}`
  });
  res.end(bytes);
}

function decideReport(id, status, { approverId, comment }) {
  const approver = getManager(readId(approverId));
  const report = getReport(id);
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

function teamReport({ team, managerName }, weekStart, executive = false) {
  const rows = listTeamReports.all(team, weekStart);
  const reports = new Map(rows.map((row) => [row.userId, reportObject(row)]));
  const members = listTeamEmployees.all(team).map((user) => {
    const report = reports.get(user.userId);
    const status = report?.status ?? 'none';
    return {
      ...user,
      status,
      totalHours: report?.totalHours ?? 0,
      report: (executive && status === 'draft') ? null : (report ?? null)
    };
  });
  const included = [...reports.values()].filter(({ status }) => status === 'submitted' || status === 'approved');
  const stats = {
    memberCount: members.length,
    submittedCount: included.length,
    approvedCount: included.filter(({ status }) => status === 'approved').length,
    totalHours: included.reduce((total, report) => total + report.totalHours, 0)
  };
  const categoryHours = new Map();
  const issues = [];
  const requests = [];
  const personalSchedules = [];
  const noteLists = [
    ['issues', issues], ['requests', requests], ['personalSchedule', personalSchedules]
  ];
  for (const { userName, current } of included) {
    for (const { category, hours } of current.entries) {
      categoryHours.set(category, (categoryHours.get(category) ?? 0) + hours);
    }
    for (const [field, list] of noteLists) {
      const text = current[field].trim();
      if (text && text !== '없음') list.push({ userName, text });
    }
  }
  const projectHours = [...categoryHours].map(([category, hours]) => ({ category, hours }))
    .sort((a, b) => b.hours - a.hours || a.category.localeCompare(b.category, 'ko'));
  return {
    team, weekStart, weekLabel: weekLabel(weekStart), managerName, stats, members, projectHours,
    issues, requests, personalSchedules, teamSummary: findTeamSummary.get(team, weekStart) ?? null
  };
}

function getTeamReport(viewer, requestedWeek, requestedTeam) {
  if (viewer.role !== 'manager' && viewer.role !== 'executive') {
    throw new HttpError(403, '팀장과 임원만 팀 주간보고를 조회할 수 있습니다.');
  }
  const executive = viewer.role === 'executive';
  const team = requestedTeam ?? (executive ? '' : viewer.team);
  if (!team.trim()) throw new HttpError(400, '조회할 팀을 선택해 주세요.');
  if (!executive && team !== viewer.team) {
    throw new HttpError(403, '자기 팀의 주간보고만 조회할 수 있습니다.');
  }
  const weekStart = selectedWeek(requestedWeek);
  const teamInfo = listReportingTeams.all().find((entry) => entry.team === team);
  if (!teamInfo) throw new HttpError(404, '팀을 찾을 수 없습니다.');
  return teamReport(teamInfo, weekStart, executive);
}

function putTeamSummary({ managerId, weekStart, summary }) {
  const manager = getManager(readId(managerId));
  readWeekStart(weekStart);
  summary = textValue(summary, '팀 종합 의견을 문자로 입력해 주세요.');
  const updatedAt = new Date().toISOString();
  saveTeamSummary.run(manager.team, weekStart, manager.id, summary, updatedAt);
  return { summary, managerName: manager.name, updatedAt };
}

function executiveWeekly(viewer, requestedWeek) {
  if (viewer.role !== 'executive') throw new HttpError(403, '임원 권한이 필요합니다.');
  const weekStart = selectedWeek(requestedWeek);
  const teams = listReportingTeams.all().map((team) => {
    const { members, ...summary } = teamReport(team, weekStart, true);
    return summary;
  });
  return { weekStart, weekLabel: weekLabel(weekStart), teams };
}

function validateReservationTime(time) {
  if (typeof time !== 'string' || time.length !== 5 || !/^(?:(?:0[89]|1\d):(?:00|30)|20:00)$/.test(time)) {
    throw new HttpError(400, '예약 시간은 08:00부터 20:00까지 30분 단위로 입력해 주세요.');
  }
}

function createReservation({ userId, roomId, date, startTime, endTime, title, attendees = '' }) {
  const user = getUser(readId(userId));
  roomId = readId(roomId);
  if (!findRoom.get(roomId)) throw new HttpError(404, '회의실을 찾을 수 없습니다.');
  parseDate(date);
  const now = new Date();
  if (date < localDate(now)) throw new HttpError(400, '지난 날짜는 예약할 수 없습니다.');
  validateReservationTime(startTime);
  validateReservationTime(endTime);
  if (startTime >= endTime) throw new HttpError(400, '종료 시각은 시작 시각보다 늦어야 합니다.');
  title = textValue(title, '회의 제목을 입력해 주세요.', true);
  attendees = textValue(attendees, '참석자는 문자로 입력해 주세요.');

  // Keep the overlap check and insertion under the same SQLite write lock.
  db.exec('BEGIN IMMEDIATE');
  try {
    const overlap = overlappingReservation.get(roomId, date, endTime, startTime);
    if (overlap) {
      throw new HttpError(409,
        `이미 예약된 시간입니다 (${overlap.startTime}~${overlap.endTime}, ${overlap.userName})`);
    }
    const { lastInsertRowid } = insertReservation.run(roomId, user.id, date, startTime, endTime,
      title, attendees, now.toISOString());
    const reservation = findReservation.get(lastInsertRowid);
    db.exec('COMMIT');
    return reservation;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cancelReservation(id, { userId }) {
  const user = getUser(readId(userId));
  const reservation = findReservation.get(id);
  if (!reservation) throw new HttpError(404, '회의실 예약을 찾을 수 없습니다.');
  if (reservation.userId !== user.id) {
    throw new HttpError(403, '본인의 회의실 예약만 취소할 수 있습니다.');
  }
  if (cancelActiveReservation.run(id).changes === 0) {
    throw new HttpError(409, '이미 취소된 회의실 예약입니다.');
  }
  return findReservation.get(id);
}

function noticeObject(row) {
  return { ...row, pinned: Boolean(row.pinned), attachments: listAttachments.all(row.id) };
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
    : `주간보고 ${detail.weekLabel} (총 ${detail.totalHours}시간)`;
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
    notices: homeNotices.all().map(noticeObject),
    myReservationsToday: homeReservations.all(id, today)
  };
}

// 챗봇이 DB 조회로 바로 답하지 못한 질문을 LLM 에 넘길 때 근거로 주는 "내 데이터" 묶음
function chatSnapshot(user) {
  const today = localDate(new Date());
  const thisMonth = today.slice(0, 7);
  const lastMonth = localDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).slice(0, 7);
  const leaveLabel = (row) => ({
    type: leaveTypes[row.type] ?? row.type, startDate: row.startDate, endDate: row.endDate,
    days: row.days, reason: row.reason, status: row.status, comment: row.comment
  });
  return {
    home: home(user),
    notices: listNotices.all().map(noticeObject).map(({ title, body, pinned, createdAt, authorName }) =>
      ({ title, body, pinned, createdAt, authorName })),
    attendance: {
      [thisMonth]: getMonthAttendance(user, thisMonth),
      [lastMonth]: getMonthAttendance(user, lastMonth).summary
    },
    myLeaveRequests: listLeave.all(user.id).slice(0, 20).map(leaveLabel),
    myWeeklyReports: listReports.all(user.id).slice(0, 6).map(reportObject)
      .map(({ weekStart, weekLabel, status, current, next, totalHours, nextTotalHours, comment }) =>
        ({ weekStart, weekLabel, status, current, next, totalHours, nextTotalHours, comment })),
    myUpcomingReservations: listMyReservations.all(user.id, today).slice(0, 20)
      .map(({ date, roomName, startTime, endTime, title, attendees }) =>
        ({ date, roomName, startTime, endTime, title, attendees })),
    teamLeaveThisMonth: calendarLeave.all(user.team, ...monthRange(thisMonth).reverse())
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
      case '/api/docs':
        return json(res, 200, listDocs.all());
      case '/api/docs/search': {
        const q = textValue(query.get('q'), '문서 검색어를 입력해 주세요.', true);
        const limit = readId(query.get('limit') ?? 5);
        return json(res, 200, searchDocs(q, limit).map(({ docId, title, space, heading, excerpt, score }) =>
          ({ docId, title, space, heading, excerpt, score })));
      }
      case '/api/rooms':
        return json(res, 200, listRooms.all());
      case '/api/room-reservations': {
        const date = query.get('date');
        parseDate(date);
        return json(res, 200, listDayReservations.all(date));
      }
      case '/api/room-reservations/mine':
        return json(res, 200, listMyReservations.all(user().id, localDate(new Date())));
      case '/api/attendance':
        return json(res, 200, getMonthAttendance(user(), month));
      case '/api/attendance/team':
        return json(res, 200, getTeamAttendance(manager('managerId')));
      case '/api/weekly-reports/current':
        return json(res, 200, currentReport(user()));
      case '/api/weekly-reports':
        return json(res, 200, listReports.all(user().id).map(reportObject));
      case '/api/weekly-reports/team': {
        const viewer = getUser(readId(query.get('viewerId')));
        return json(res, 200, getTeamReport(viewer, query.get('weekStart'), query.get('team')));
      }
      case '/api/executive/weekly': {
        const viewer = getUser(readId(query.get('executiveId')));
        return json(res, 200, executiveWeekly(viewer, query.get('weekStart')));
      }
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

    const doc = /^\/api\/docs\/([^/]+)$/.exec(pathname);
    if (doc) return json(res, 200, getDoc(readId(doc[1])));
    const reportFile = /^\/api\/weekly-reports\/([^/]+)\/file$/.exec(pathname);
    if (reportFile) return downloadReportFile(res, readId(reportFile[1]), query.get('viewerId'));
    const match = /^\/api\/users\/([^/]+)\/balance$/.exec(pathname);
    if (match) return json(res, 200, balance(getUser(readId(match[1]))));
  }
  if (req.method === 'PUT') {
    const doc = /^\/api\/docs\/([^/]+)$/.exec(pathname);
    if (doc) return json(res, 200, editDoc(readId(doc[1]), await readJson(req)));
    if (pathname === '/api/weekly-reports') {
      return json(res, 200, putReport(await readJson(req)));
    }
    if (pathname === '/api/team-summaries') {
      return json(res, 200, putTeamSummary(await readJson(req)));
    }
  }
  if (req.method === 'POST') {
    switch (pathname) {
      case '/api/notices':
        return json(res, 201, createNotice(await readJson(req)));
      case '/api/docs':
        return json(res, 201, createDoc(await readJson(req)));
      case '/api/attendance/check-in':
        return json(res, 201, markAttendance(true, await readJson(req)));
      case '/api/attendance/check-out':
        return json(res, 200, markAttendance(false, await readJson(req)));
      case '/api/leave-requests':
        return json(res, 201, createLeave(await readJson(req)));
      case '/api/room-reservations':
        return json(res, 201, createReservation(await readJson(req)));
      case '/api/weekly-reports/upload':
        return json(res, 200, await uploadReport(req, query));
      case '/api/chat': {
        const { userId, text } = await readJson(req);
        const chatUser = getUser(readId(userId));
        const message = textValue(text, '메시지를 입력해 주세요.', true);
        if (text.length > 500) throw new HttpError(400, '메시지는 500자 이내로 입력해 주세요.');
        return json(res, 200, await assistant.respond(message, {
          user: chatUser,
          home: () => home(chatUser),
          pendingApprovals: () => approvals('pending', chatUser.team),
          teamWeekly: () => getTeamReport(chatUser, null, null),
          executiveWeekly: () => executiveWeekly(chatUser, null),
          rooms: () => listRooms.all(),
          reservations: (date) => listDayReservations.all(date),
          searchDocs: (q) => searchDocs(q, 3),
          snapshot: () => chatSnapshot(chatUser)
        }));
      }
      case '/api/chat/story': {
        const { type, startDate, endDate, avoid } = await readJson(req);
        return json(res, 200, await assistant.writeStory(
          { type, startDate, endDate }, typeof avoid === 'string' ? avoid : ''
        ));
      }
    }
    const reservation = /^\/api\/room-reservations\/([^/]+)\/cancel$/.exec(pathname);
    if (reservation) {
      return json(res, 200, cancelReservation(readId(reservation[1]), await readJson(req)));
    }
    const leave = /^\/api\/leave-requests\/([^/]+)\/(approve|reject|cancel)$/.exec(pathname);
    if (leave) {
      const [, rawId, action] = leave;
      const id = readId(rawId);
      const body = await readJson(req);
      if (action === 'cancel') return json(res, 200, cancelLeave(id, body));
      return json(res, 200, decideLeave(id, action === 'approve' ? 'approved' : 'rejected', body));
    }
    const report = /^\/api\/weekly-reports\/([^/]+)\/(approve|reject|submit)$/.exec(pathname);
    if (report) {
      const [, rawId, action] = report;
      const id = readId(rawId);
      const body = await readJson(req);
      if (action === 'submit') return json(res, 200, submitReport(id, body));
      const status = action === 'approve' ? 'approved' : 'rejected';
      return json(res, 200, decideReport(id, status, body));
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
}).listen(port, () => {
  console.log(`Groupware is listening on port ${port}`);
  console.log(`챗봇 해석: ${assistant.providerName() ?? '규칙 기반 (LLM_PROVIDER 미설정)'}`);
});
