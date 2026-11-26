const baseUrl = new URL(process.argv[2] ?? 'http://localhost:3000');
const employeeId = 1;
const managerId = 3;
const balancePath = `/api/users/${employeeId}/balance`;
const historyPath = `/api/leave-requests?userId=${employeeId}`;
const queuePath = `/api/approvals?approverId=${managerId}`;
const employeeHomePath = `/api/home?userId=${employeeId}`;
const managerHomePath = `/api/home?userId=${managerId}`;
const teamPath = `/api/attendance/team?managerId=${managerId}`;
const currentReportPath = `/api/weekly-reports/current?userId=${employeeId}`;
const reportsPath = '/api/weekly-reports';
const minePath = `/api/approvals/mine?userId=${employeeId}`;
const processedPath = `/api/approvals/history?approverId=${managerId}`;
const application = {
  userId: employeeId,
  type: 'annual',
  startDate: '2026-12-01',
  endDate: '2026-12-02',
  reason: '개인 사유'
};
const decision = { approverId: managerId, comment: '일정 확인했습니다.' };
const rejection = { approverId: managerId, comment: '이슈 항목 보완' };
const check = { userId: employeeId };
const reportItems = [
  { project: '그룹웨어', hours: 4, content: '연차 신청 화면 구현' },
  { project: '그룹웨어', hours: 3.5, content: '출퇴근 기록 검증' }
];
let today;
let weekStart;
let checkIn;
let requestId;
let reportId;

function expect(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectFields(value, fields) {
  for (const [key, expected] of Object.entries(fields)) expect(value[key], expected, key);
}

async function request(path, expectedStatus = 200, body, method = 'POST') {
  const options = { signal: AbortSignal.timeout(5000) };
  if (body !== undefined) {
    options.method = method;
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(new URL(path, baseUrl), options);
  const result = await response.json();
  expect(response.status, expectedStatus, `${response.status} response ${JSON.stringify(result)}`);
  if (expectedStatus >= 400) {
    expect(Object.keys(result).join(), 'error', 'error response fields');
    expect(typeof result.error === 'string' && /[가-힣]/.test(result.error), true, 'Korean error');
  }
  return result;
}

async function step(name, test) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

await step('Seeded user list and 15-day starting balance', async () => {
  const users = await request('/api/users');
  expect(users.length, 3, 'user count');
  expectFields(users.find(({ id }) => id === employeeId), {
    id: employeeId, name: '김신입', role: 'employee', team: '개발팀'
  });
  expectFields(users.find(({ id }) => id === 2), {
    id: 2, name: '이분석', role: 'employee', team: '개발팀'
  });
  expectFields(users.find(({ id }) => id === managerId), {
    id: managerId, name: '박팀장', role: 'manager', team: '개발팀'
  });
  expectFields(await request(balancePath), { total: 15, used: 0, pending: 0, remaining: 15 });
});

await step('Home shows no check-in or current report before the demo', async () => {
  const home = await request(employeeHomePath);
  today = home.today;
  weekStart = home.weeklyReport.weekStart;
  expectFields(home.user, { id: employeeId, name: '김신입', role: 'employee', team: '개발팀' });
  expectFields(home.attendance, { checkIn: null, checkOut: null, status: 'none', late: false });
  expectFields(home, { myPendingCount: 0, approvalPendingCount: 0 });
  expect(home.weeklyReport.status, 'none', 'current weekly status');
  expect(Array.isArray(home.teamOnLeaveToday), true, 'team absences');
  expect(new Date(`${weekStart}T00:00:00Z`).getUTCDay(), 1, 'current week starts Monday');
});

await step('Seeded attendance records and monthly summary agree', async () => {
  const month = today.slice(0, 7);
  const { records, summary } = await request(`/api/attendance?userId=${employeeId}&month=${month}`);
  const day = new Date(`${month}-01T00:00:00Z`);
  const workdays = [];
  while (day.toISOString().slice(0, 10) < today) {
    if ([1, 2, 3, 4, 5].includes(day.getUTCDay())) workdays.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  expect(records.map((row) => row.workDate).join(), workdays.join(), 'seeded weekday records');
  expectFields(summary, {
    days: workdays.length,
    totalMinutes: records.reduce((sum, row) => sum + row.workMinutes, 0),
    lateCount: records.filter((row) => row.late).length
  });
  if (workdays.length) {
    expect(summary.totalMinutes > 0, true, 'seeded work minutes');
    expect(summary.lateCount, 1, 'seeded late count');
  }
});

await step('Check-in updates home and duplicate check-in returns 409', async () => {
  await request('/api/attendance/check-out', 409, check);
  const row = await request('/api/attendance/check-in', 201, check);
  checkIn = row.checkIn;
  expect(/^\d{2}:\d{2}$/.test(checkIn), true, 'check-in clock format');
  expectFields(row, { workDate: today, checkOut: null, late: checkIn > '09:00', workMinutes: 0 });
  const home = await request(employeeHomePath);
  expectFields(home.attendance, { checkIn, checkOut: null, status: 'working', late: checkIn > '09:00' });
  await request('/api/attendance/check-in', 409, check);
});

await step('Manager can view team attendance and non-manager receives 403', async () => {
  const team = await request(teamPath);
  expect(team.length, 3, 'team member count');
  expectFields(team.find((row) => row.userId === employeeId), {
    userName: '김신입', checkIn, status: 'working', late: checkIn > '09:00', onLeave: false
  });
  await request(`/api/attendance/team?managerId=${employeeId}`, 403);
});

await step('Create a two-day request and verify pending history and balance', async () => {
  const leave = await request('/api/leave-requests', 201, application);
  requestId = leave.id;
  expect(Number.isSafeInteger(requestId) && requestId > 0, true, 'request ID');
  expectFields(leave, {
    ...application, userName: '김신입', days: 2, status: 'pending',
    approverId: null, approverName: null, comment: null, decidedAt: null
  });
  expect(new Date(leave.createdAt).toISOString(), leave.createdAt, 'createdAt');
  const history = await request(historyPath);
  expectFields(history[0], { id: requestId, status: 'pending', days: 2 });
  expectFields(await request(balancePath), { used: 0, pending: 2, remaining: 15 });
  const home = await request(employeeHomePath);
  expectFields(home, { myPendingCount: 1, approvalPendingCount: 0 });
  expectFields(home.balance, { used: 0, pending: 2, remaining: 15 });
});

await step('Manager sees one request in the approval queue', async () => {
  const queue = await request(queuePath);
  expect(queue.length, 1, 'queue count');
  expectFields(queue[0], {
    kind: 'leave', id: requestId, userName: '김신입', status: 'pending',
    title: '연차 2일 (2026-12-01 ~ 2026-12-02)'
  });
  expectFields(queue[0].detail, { id: requestId, userId: employeeId, days: 2 });
});

await step('Read the seeded weekly history and save this week as a draft', async () => {
  const empty = await request(currentReportPath);
  expectFields(empty, { weekStart, status: 'none', nextPlan: '', issues: '' });
  expect(empty.items.length, 0, 'empty current report items');
  const previousWeek = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 7 * 86_400_000)
    .toISOString().slice(0, 10);
  for (const userId of [employeeId, 2]) {
    const history = await request(`${reportsPath}?userId=${userId}`);
    expect(history.length, 1, 'seeded weekly report count');
    expectFields(history[0], { userId, weekStart: previousWeek, status: 'approved', approverId: managerId });
  }
  const row = await request(reportsPath, 200, {
    userId: employeeId, weekStart, items: reportItems, nextPlan: '통합 검증', issues: '', submit: false
  }, 'PUT');
  reportId = row.id;
  expectFields(row, { status: 'draft', totalHours: 7.5, submittedAt: null, comment: null });
  expectFields(await request(currentReportPath), { id: reportId, status: 'draft' });
  expect((await request(minePath)).some((item) => item.kind === 'weekly' && item.id === reportId),
    false, 'draft excluded from approvals');
});

await step('Submit the weekly report and verify two pending approvals on manager home', async () => {
  const payload = {
    userId: employeeId, weekStart, items: reportItems, nextPlan: '통합 검증', issues: '', submit: true
  };
  await request(reportsPath, 400, { ...payload, items: [] }, 'PUT');
  await request(reportsPath, 400, { ...payload, items: [{ ...reportItems[0], hours: 0 }] }, 'PUT');
  const row = await request(reportsPath, 200, payload, 'PUT');
  expectFields(row, {
    id: reportId, userId: employeeId, userName: '김신입', weekStart,
    status: 'submitted', totalHours: 7.5, approverId: null, decidedAt: null
  });
  expect(new Date(row.submittedAt).toISOString(), row.submittedAt, 'report submittedAt');
  await request(reportsPath, 409, payload, 'PUT');
  const queue = await request(queuePath);
  expect(queue.length, 2, 'combined queue count');
  expectFields(queue[0], { kind: 'leave', id: requestId, status: 'pending' });
  expectFields(queue[1], {
    kind: 'weekly', id: reportId, status: 'submitted', title: `주간보고 ${weekStart} 주 (총 7.5시간)`
  });
  expectFields(queue[1].detail, { id: reportId, status: 'submitted', totalHours: 7.5 });
  expectFields(await request(managerHomePath), { approvalPendingCount: 2 });
  expectFields(await request(employeeHomePath), { myPendingCount: 2, approvalPendingCount: 0 });
});

await step('Non-manager approval returns 403', async () => {
  await request(`/api/leave-requests/${requestId}/approve`, 403, { approverId: 2 });
});

await step('Manager approves the leave with a comment and removes it from the queue', async () => {
  const leave = await request(`/api/leave-requests/${requestId}/approve`, 200, decision);
  expectFields(leave, { id: requestId, status: 'approved', approverName: '박팀장', ...decision });
  expect(new Date(leave.decidedAt).toISOString(), leave.decidedAt, 'decidedAt');
  const queue = await request(queuePath);
  expect(queue.length, 1, 'queue count');
  expectFields(queue[0], { id: reportId, kind: 'weekly', status: 'submitted' });
});

await step('Manager rejects the weekly report with a required comment', async () => {
  const url = `${reportsPath}/${reportId}/reject`;
  await request(url, 400, { approverId: managerId, comment: ' ' });
  const row = await request(url, 200, rejection);
  expectFields(row, { id: reportId, status: 'rejected', approverName: '박팀장', ...rejection });
  expect((await request(queuePath)).length, 0, 'queue count');
  expect((await request(managerHomePath)).approvalPendingCount, 0, 'manager home pending');
  const processed = await request(processedPath);
  expectFields(processed.find((item) => item.kind === 'leave' && item.id === requestId),
    { status: 'approved' });
  expectFields(processed.find((item) => item.kind === 'weekly' && item.id === reportId),
    { status: 'rejected' });
  await request(`/api/approvals/history?approverId=${employeeId}`, 403);
});

await step('Employee sees both decisions and comments in approvals mine', async () => {
  const mine = await request(minePath);
  expectFields(mine[0], { kind: 'weekly', id: reportId, status: 'rejected' });
  expectFields(mine[0].detail, { comment: rejection.comment, approverName: '박팀장' });
  expectFields(mine[1], { kind: 'leave', id: requestId, status: 'approved' });
  expectFields(mine[1].detail, { comment: decision.comment, approverName: '박팀장' });
  expectFields(await request(currentReportPath), { id: reportId, status: 'rejected', comment: rejection.comment });
});

await step('Employee sees approved history and a 13-day remaining balance', async () => {
  const history = await request(historyPath);
  expectFields(history[0], { id: requestId, status: 'approved', comment: decision.comment });
  expectFields(await request(balancePath), { total: 15, used: 2, pending: 0, remaining: 13 });
  const home = await request(employeeHomePath);
  expectFields(home.balance, { total: 15, used: 2, pending: 0, remaining: 13 });
  expectFields(home, { myPendingCount: 0, approvalPendingCount: 0 });
});

await step('Employee fixes and resubmits the rejected weekly report', async () => {
  const issues = '일정 단축에 따른 통합 검증 이슈 정리';
  const row = await request(reportsPath, 200, {
    userId: employeeId, weekStart, items: reportItems, nextPlan: '통합 검증', issues, submit: true
  }, 'PUT');
  expectFields(row, { id: reportId, status: 'submitted', issues, comment: null, decidedAt: null });
  expectFields(await request(currentReportPath), { id: reportId, status: 'submitted', issues });
  expectFields((await request(employeeHomePath)).weeklyReport, { weekStart, status: 'submitted' });
  expect((await request(managerHomePath)).approvalPendingCount, 1, 'manager home pending');
});

await step('Check-out updates the home card and duplicate check-out returns 409', async () => {
  const row = await request('/api/attendance/check-out', 200, check);
  expect(/^\d{2}:\d{2}$/.test(row.checkOut), true, 'check-out clock format');
  expectFields(row, { workDate: today, checkIn });
  const home = await request(employeeHomePath);
  expectFields(home.attendance, { checkIn, checkOut: row.checkOut, status: 'done' });
  await request('/api/attendance/check-out', 409, check);
});

await step('Insufficient balance returns 400 with the available days', async () => {
  const result = await request('/api/leave-requests', 400, {
    ...application, startDate: '2026-12-03', endDate: '2026-12-31'
  });
  expect(result.error, '잔여 연차가 부족합니다 (가능: 13일)', 'insufficient balance message');
});

await step('Half-day request with different dates returns 400', async () => {
  await request('/api/leave-requests', 400, { ...application, type: 'half_am' });
});

await step('Repeated approval returns 409', async () => {
  await request(`/api/leave-requests/${requestId}/approve`, 409, decision);
});

await step('Owner can cancel pending leave and it is excluded from the calendar and approvals', async () => {
  const date = '2026-12-03';
  const leave = await request('/api/leave-requests', 201, {
    ...application, type: 'half_pm', startDate: date, endDate: date
  });
  const calendarPath = '/api/leave-calendar?userId=2&month=2026-12';
  expectFields((await request(calendarPath)).find((row) => row.id === leave.id),
    { status: 'pending', days: 0.5 });
  const cancelPath = `/api/leave-requests/${leave.id}/cancel`;
  await request(cancelPath, 403, { userId: 2 });
  expectFields(await request(cancelPath, 200, check), { id: leave.id, status: 'cancelled', days: 0.5 });
  await request(cancelPath, 409, check);
  const calendar = await request(calendarPath);
  expect(calendar.some((row) => row.id === leave.id), false, 'cancelled leave in calendar');
  expectFields(calendar.find((row) => row.id === requestId), {
    userName: '김신입', status: 'approved', startDate: application.startDate, endDate: application.endDate, days: 2
  });
  expect((await request(minePath)).some((item) => item.kind === 'leave' && item.id === leave.id),
    false, 'cancelled leave in approvals mine');
  expectFields(await request(balancePath), { pending: 0, remaining: 13 });
});

await step('Notice list and home are pinned first, with creation restricted to managers', async () => {
  const notices = await request('/api/notices');
  expect(notices.length, 3, 'seeded notice count');
  expectFields(notices[0], { title: '워크샵 해커톤 안내', authorName: '박팀장', pinned: true });
  const payload = { userId: employeeId, title: '검증 공지', body: '공지 내용', pinned: true };
  await request('/api/notices', 403, payload);
  const created = await request('/api/notices', 201, { ...payload, userId: managerId });
  expectFields(created, { title: payload.title, body: payload.body, pinned: true, authorName: '박팀장' });
  expect((await request('/api/notices'))[0].id, created.id, 'most recent pinned notice');
  const home = await request(employeeHomePath);
  expect(home.notices.length, 3, 'home notice count');
  expectFields(home.notices[0], { id: created.id, pinned: true, title: payload.title });
});

await step('Manager can approve a submitted report and reject a pending leave', async () => {
  const report = await request(`${reportsPath}/${reportId}/approve`, 200, decision);
  expectFields(report, { id: reportId, status: 'approved', ...decision });
  await request(`${reportsPath}/${reportId}/approve`, 409, decision);
  const date = '2026-12-04';
  const leave = await request('/api/leave-requests', 201, {
    ...application, userId: 2, startDate: date, endDate: date
  });
  const rejected = await request(`/api/leave-requests/${leave.id}/reject`, 200, decision);
  expectFields(rejected, { id: leave.id, status: 'rejected', ...decision });
});

await step('Home and manager attendance show today’s approved team absences', async () => {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday > 0 && weekday < 6) {
    const leave = await request('/api/leave-requests', 201, {
      ...application, userId: 2, startDate: today, endDate: today
    });
    await request(`/api/leave-requests/${leave.id}/approve`, 200, decision);
  }
  const onLeave = weekday > 0 && weekday < 6;
  const home = await request(employeeHomePath);
  expect(home.teamOnLeaveToday.some((entry) => entry.userName === '이분석' && entry.type === 'annual'),
    onLeave, 'approved team absence on home');
  const team = await request(teamPath);
  expectFields(team.find((row) => row.userId === 2), { onLeave });
});
