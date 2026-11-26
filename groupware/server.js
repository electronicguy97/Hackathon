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
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    approver_id INTEGER REFERENCES users(id),
    comment TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  INSERT INTO users (id, name, role, team, annual_total)
  SELECT * FROM (
    VALUES (1, '김신입', 'employee', '개발팀', 15),
           (2, '이분석', 'employee', '개발팀', 15),
           (3, '박팀장', 'manager', '개발팀', 20)
  ) WHERE NOT EXISTS (SELECT 1 FROM users);
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
const findUser = db.prepare('SELECT id, role, team, annual_total FROM users WHERE id = ?');
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
  const approver = findUser.get(id);
  if (approver?.role !== 'manager') {
    throw new HttpError(403, '팀장만 결재할 수 있습니다.');
  }
  return approver;
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

function decideLeave(id, status, { approverId, comment }) {
  const approver = getManager(readId(approverId));
  if (comment != null && typeof comment !== 'string') {
    throw new HttpError(400, '결재 의견은 문자로 입력해 주세요.');
  }
  const leave = findLeave.get(id);
  if (!leave) throw new HttpError(404, '연차 신청을 찾을 수 없습니다.');
  if (getUser(leave.userId).team !== approver.team) {
    throw new HttpError(403, '다른 팀의 연차 신청은 결재할 수 없습니다.');
  }
  const { changes } = updateLeave.run(
    status, approver.id, comment?.trim() || null, new Date().toISOString(), id
  );
  if (changes === 0) throw new HttpError(409, '이미 처리된 연차 신청입니다.');
  return findLeave.get(id);
}

async function handleApi(req, res, pathname, query) {
  if (req.method === 'GET') {
    if (pathname === '/api/users') return json(res, 200, listUsers.all());

    const match = /^\/api\/users\/([^/]+)\/balance$/.exec(pathname);
    if (match) return json(res, 200, balance(getUser(readId(match[1]))));

    if (pathname === '/api/leave-requests') {
      const user = getUser(readId(query.get('userId')));
      return json(res, 200, listLeave.all(user.id));
    }
    if (pathname === '/api/approvals') {
      const approver = getManager(readId(query.get('approverId')));
      return json(res, 200, listPending.all(approver.team));
    }
  }
  if (req.method === 'POST') {
    if (pathname === '/api/leave-requests') {
      return json(res, 201, createLeave(await readJson(req)));
    }
    const match = /^\/api\/leave-requests\/([^/]+)\/(approve|reject)$/.exec(pathname);
    if (match) {
      const status = match[2] === 'approve' ? 'approved' : 'rejected';
      return json(res, 200, decideLeave(readId(match[1]), status, await readJson(req)));
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
