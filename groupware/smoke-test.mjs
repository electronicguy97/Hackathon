import { crc32, deflateRawSync } from 'node:zlib';

const baseUrl = new URL(process.argv[2] ?? 'http://localhost:3000');
const employeeId = 1;
const managerId = 3;
const dataManagerId = 6;
const executiveId = 7;
const balancePath = `/api/users/${employeeId}/balance`;
const historyPath = `/api/leave-requests?userId=${employeeId}`;
const queuePath = `/api/approvals?approverId=${managerId}`;
const employeeHomePath = `/api/home?userId=${employeeId}`;
const managerHomePath = `/api/home?userId=${managerId}`;
const teamPath = `/api/attendance/team?managerId=${managerId}`;
const currentReportPath = `/api/weekly-reports/current?userId=${employeeId}`;
const reportsPath = '/api/weekly-reports';
const teamReportPath = `${reportsPath}/team?viewerId=${managerId}`;
const executivePath = `/api/executive/weekly?executiveId=${executiveId}`;
const chatPath = '/api/chat';
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
const reportCurrent = {
  personalSchedule: '금요일 오후 반차',
  issues: '없음',
  requests: '연동 일정 공유 요청',
  entries: [
    { day: 'mon', category: '운영 지원', workType: '회사', content: '출퇴근 기록 점검', hours: 1.5 },
    { day: 'mon', category: '사내 그룹웨어', workType: '회사', content: '연차 신청 화면 구현', hours: 4 },
    { day: 'tue', category: '사내 그룹웨어', workType: '재택', content: '검증 결과 정리\n결재 흐름 점검', hours: 2 }
  ]
};
const reportNext = {
  personalSchedule: '',
  issues: '차주 검증 환경 구성',
  requests: '',
  entries: [{ day: 'wed', category: 'AI 챗봇 PoC', workType: '회사', content: '질문 흐름 검증', hours: 3 }]
};
const managerSummary = '그룹웨어 시연 결과를 정리하고 후속 검증을 진행합니다.';
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

function offsetDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function expectedWeekLabel(start) {
  const [, month, date] = offsetDay(start, 3).split('-').map(Number);
  const range = [start, offsetDay(start, 4)].map((day) => day.slice(5).replace('-', '/'));
  return `${month}월 ${Math.ceil(date / 7)}주차(${range.join(' ~ ')})`;
}

function weeklyPayload(overrides = {}) {
  return { userId: employeeId, weekStart, current: reportCurrent, next: reportNext, submit: true, ...overrides };
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

async function chat(text, userId = employeeId) {
  const response = await request(chatPath, 200, { userId, text });
  expectFields(response, { source: 'rule', warning: null });
  return response;
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
  const seeds = [
    [1, '김신입', 'employee', '개발팀'],
    [2, '이분석', 'employee', '개발팀'],
    [3, '박팀장', 'manager', '개발팀'],
    [4, '최데이터', 'employee', '데이터팀'],
    [5, '정연구', 'employee', '데이터팀'],
    [6, '한팀장', 'manager', '데이터팀'],
    [7, '강상무', 'executive', '경영진'],
    [8, '박사원', 'employee', '개발팀']
  ];
  expect(users.length, seeds.length, 'user count');
  for (const [id, name, role, team] of seeds) {
    expectFields(users.find((user) => user.id === id), { id, name, role, team });
  }
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

await step('Seeded attendance records and monthly summaries agree for all seven users', async () => {
  const month = today.slice(0, 7);
  const day = new Date(`${month}-01T00:00:00Z`);
  const workdays = [];
  while (day.toISOString().slice(0, 10) < today) {
    if ([1, 2, 3, 4, 5].includes(day.getUTCDay())) workdays.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  for (const userId of [1, 2, 3, 4, 5, 6, 7]) {
    const { records, summary } = await request(`/api/attendance?userId=${userId}&month=${month}`);
    expect(records.map((row) => row.workDate).join(), workdays.join(), `seeded weekday records for ${userId}`);
    expectFields(summary, {
      days: workdays.length,
      totalMinutes: records.reduce((sum, row) => sum + row.workMinutes, 0),
      lateCount: records.filter((row) => row.late).length
    });
    if (workdays.length) {
      expect(summary.totalMinutes > 0, true, 'seeded work minutes');
      expect([1, 2].includes(summary.lateCount), true, 'seeded late count');
      if (userId === employeeId) expect(summary.lateCount, 1, 'employee seeded late count');
    }
  }
});

await step('Chat proposes check-in without changing attendance', async () => {
  const response = await chat('출근');
  expectFields(response.action, { kind: 'check_in' });
  expect((await request(employeeHomePath)).attendance.status, 'none', 'chat never checks in directly');
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
  expect(team.length, 4, 'team member count');
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

await step('Validate seeded week labels and prefill only last week’s next entries', async () => {
  const template = await request(currentReportPath);
  const previousWeek = offsetDay(weekStart, -7);
  const blankNotes = { personalSchedule: '', issues: '', requests: '' };
  expectFields(template, {
    weekStart, status: 'none', weekLabel: expectedWeekLabel(weekStart),
    nextWeekLabel: expectedWeekLabel(offsetDay(weekStart, 7)), nextTotalHours: 0
  });
  expectFields(template.current, blankNotes);
  expectFields(template.next, blankNotes);
  expect(template.next.entries.length, 0, 'empty next entries');
  for (const userId of [employeeId, 2, 4, 5]) {
    const history = await request(`${reportsPath}?userId=${userId}`);
    const previous = history.at(-1);
    expect(history.length, userId <= 2 ? 1 : 2, 'seeded weekly report count');
    expectFields(previous, {
      userId, weekStart: previousWeek, status: 'approved', approverId: userId <= 2 ? managerId : dataManagerId,
      weekLabel: expectedWeekLabel(previousWeek), nextWeekLabel: expectedWeekLabel(weekStart), fileName: null
    });
    if (userId > 2) {
      expectFields(history[0], {
        userId, weekStart, weekLabel: expectedWeekLabel(weekStart), status: userId === 4 ? 'submitted' : 'draft'
      });
    }
    if (userId === employeeId) {
      expect(previous.next.entries.length > 0, true, 'seeded next entries');
      expect(JSON.stringify(template.current.entries), JSON.stringify(previous.next.entries), 'prefilled entries');
      expect(template.totalHours, previous.nextTotalHours, 'prefilled hours');
    }
  }
  const november = await request(`${teamReportPath}&weekStart=2026-11-23`);
  const december = await request(`${teamReportPath}&weekStart=2026-11-30`);
  expect(november.weekLabel, '11월 4주차(11/23 ~ 11/27)', 'November week label');
  expect(december.weekLabel, '12월 1주차(11/30 ~ 12/04)', 'Thursday month at boundary');
});

await step('Save the team member’s weekly form as a draft', async () => {
  const row = await request(reportsPath, 200, weeklyPayload({ submit: false }), 'PUT');
  reportId = row.id;
  expectFields(row, { status: 'draft', team: '개발팀', totalHours: 7.5, nextTotalHours: 3, submittedAt: null, comment: null });
  expectFields(row.current, { personalSchedule: reportCurrent.personalSchedule, issues: '없음' });
  expectFields(row.next, { issues: reportNext.issues });
  expect(row.current.entries[2].content, reportCurrent.entries[2].content, 'multiline work content');
  expectFields(await request(currentReportPath), { id: reportId, status: 'draft' });
  expect((await request(minePath)).some((item) => item.kind === 'weekly' && item.id === reportId),
    false, 'draft excluded from approvals');
});

await step('Weekly validation returns 400 for invalid days, work types, hours, daily totals and empty submission', async () => {
  const entry = reportCurrent.entries[0];
  const invalid = [
    weeklyPayload({ current: { ...reportCurrent, entries: [{ ...entry, day: 'sat' }] } }),
    weeklyPayload({ next: { ...reportNext, entries: [{ ...entry, workType: '기타' }] } }),
    weeklyPayload({ current: { ...reportCurrent, entries: [{ ...entry, hours: 0 }] }, submit: false }),
    weeklyPayload({ current: { ...reportCurrent, entries: [{ ...entry, hours: 25 }] } }),
    weeklyPayload({ next: { ...reportNext, entries: [{ ...entry, hours: 12 }, { ...entry, hours: 13 }] } }),
    weeklyPayload({ current: { ...reportCurrent, entries: [] } }),
    weeklyPayload({ weekStart: offsetDay(weekStart, 1) })
  ];
  for (const payload of invalid) await request(reportsPath, 400, payload, 'PUT');
  expectFields(await request(currentReportPath), { id: reportId, status: 'draft', totalHours: 7.5 });
});

await step('Managers and executives cannot save personal reports', async () => {
  await request(reportsPath, 403, weeklyPayload({ userId: managerId }), 'PUT');
  await request(reportsPath, 403, weeklyPayload({ userId: executiveId }), 'PUT');
});

await step('Submit the weekly report and verify two pending approvals on manager home', async () => {
  const payload = weeklyPayload();
  const row = await request(reportsPath, 200, payload, 'PUT');
  expectFields(row, {
    id: reportId, userId: employeeId, userName: '김신입', weekStart,
    status: 'submitted', totalHours: 7.5, nextTotalHours: 3, approverId: null, decidedAt: null
  });
  expect(new Date(row.submittedAt).toISOString(), row.submittedAt, 'report submittedAt');
  await request(reportsPath, 409, payload, 'PUT');
  const queue = await request(queuePath);
  expect(queue.length, 2, 'combined queue count');
  expectFields(queue[0], { kind: 'leave', id: requestId, status: 'pending' });
  expectFields(queue[1], {
    kind: 'weekly', id: reportId, status: 'submitted',
    title: `주간보고 ${expectedWeekLabel(weekStart)} (총 7.5시간)`
  });
  expectFields(queue[1].detail, { id: reportId, status: 'submitted', totalHours: 7.5 });
  expectFields(await request(managerHomePath), { approvalPendingCount: 2 });
  expectFields(await request(employeeHomePath), { myPendingCount: 2, approvalPendingCount: 0 });
});

await step('Manager roll-up uses only submitted current work and includes members with no report', async () => {
  const team = await request(teamReportPath);
  expectFields(team, { team: '개발팀', managerName: '박팀장', weekStart, teamSummary: null });
  expectFields(team.stats, { memberCount: 3, submittedCount: 1, approvedCount: 0, totalHours: 7.5 });
  expectFields(team.members[0], { userId: employeeId, status: 'submitted', totalHours: 7.5 });
  expectFields(team.members[0].report, { id: reportId, nextTotalHours: 3 });
  expectFields(team.members[1], { userId: 2, status: 'none', totalHours: 0, report: null });
  expect(team.members.length, 3, 'employees only');
  expect(team.projectHours.length, 2, 'current projects only');
  expectFields(team.projectHours[0], { category: '사내 그룹웨어', hours: 6 });
  expectFields(team.projectHours[1], { category: '운영 지원', hours: 1.5 });
  expect(team.issues.length, 0, 'exclude "없음" and next-week issues');
  expectFields(team.requests[0], { userName: '김신입', text: reportCurrent.requests });
  expectFields(team.personalSchedules[0], { userName: '김신입', text: reportCurrent.personalSchedule });
  await request(`${reportsPath}/team?viewerId=${dataManagerId}&team=${encodeURIComponent('개발팀')}`, 403);
  await request(`${reportsPath}/team?viewerId=${employeeId}`, 403);
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
  const payload = weeklyPayload({ current: { ...reportCurrent, issues } });
  const row = await request(reportsPath, 200, payload, 'PUT');
  expectFields(row, { id: reportId, status: 'submitted', comment: null, decidedAt: null });
  expect(row.current.issues, issues, 'submitted current issues');
  const current = await request(currentReportPath);
  expectFields(current, { id: reportId, status: 'submitted' });
  expect(current.current.issues, issues, 'reloaded current issues');
  expectFields((await request(employeeHomePath)).weeklyReport, { weekStart, status: 'submitted' });
  expect((await request(managerHomePath)).approvalPendingCount, 1, 'manager home pending');
});

await step('Manager approves a submitted report and saves the team summary', async () => {
  const approvalPath = `${reportsPath}/${reportId}/approve`;
  await request(approvalPath, 403, { ...decision, approverId: dataManagerId });
  await request(approvalPath, 403, { ...decision, approverId: executiveId });
  const report = await request(approvalPath, 200, decision);
  expectFields(report, { id: reportId, status: 'approved', ...decision });
  await request(approvalPath, 409, decision);
  await request(reportsPath, 409, weeklyPayload(), 'PUT');

  const payload = { managerId, weekStart, summary: managerSummary };
  await request('/api/team-summaries', 403, { ...payload, managerId: employeeId }, 'PUT');
  await request('/api/team-summaries', 403, { ...payload, managerId: executiveId }, 'PUT');
  const saved = await request('/api/team-summaries', 200, payload, 'PUT');
  expectFields(saved, { summary: managerSummary, managerName: '박팀장' });
  expect(new Date(saved.updatedAt).toISOString(), saved.updatedAt, 'team summary updatedAt');
  const team = await request(teamReportPath);
  expectFields(team.stats, { memberCount: 3, submittedCount: 1, approvedCount: 1, totalHours: 7.5 });
  expectFields(team.teamSummary, saved);
  expectFields(team.issues[0], { userName: '김신입', text: report.current.issues });
});

await step('Executive compares both teams and can read their summaries', async () => {
  const overview = await request(`${executivePath}&weekStart=${weekStart}`);
  expectFields(overview, { weekStart, weekLabel: expectedWeekLabel(weekStart) });
  expect(overview.teams.map((team) => team.team).join(), '개발팀,데이터팀', 'sorted reporting teams');
  const [development, data] = overview.teams;
  expectFields(development.teamSummary, { summary: managerSummary, managerName: '박팀장' });
  expectFields(development.stats, { memberCount: 3, submittedCount: 1, approvedCount: 1, totalHours: 7.5 });
  expectFields(data.stats, { memberCount: 2, submittedCount: 1, approvedCount: 0, totalHours: 6 });
  expectFields(data.projectHours[0], { category: '데이터 대시보드', hours: 6 });
  expect(data.issues.length, 1, 'draft issue excluded from overview');
  expect(overview.teams.some((team) => 'members' in team), false, 'overview omits members');
  const previous = await request(`${executivePath}&weekStart=${offsetDay(weekStart, -7)}`);
  for (const team of previous.teams) {
    expectFields(team.stats, { memberCount: team.team === '개발팀' ? 3 : 2, submittedCount: 2, approvedCount: 2 });
    expect(Boolean(team.teamSummary?.summary), true, 'seeded team summary');
  }
  await request(`/api/executive/weekly?executiveId=${employeeId}`, 403);
});

await step('Executive drill-down exposes approved and submitted reports while hiding draft detail', async () => {
  const path = `${reportsPath}/team?viewerId=${executiveId}&weekStart=${weekStart}`;
  const development = await request(`${path}&team=${encodeURIComponent('개발팀')}`);
  expectFields(development.teamSummary, { summary: managerSummary, managerName: '박팀장' });
  expectFields(development.members[0].report, { id: reportId, status: 'approved' });
  const data = await request(`${path}&team=${encodeURIComponent('데이터팀')}`);
  expectFields(data.members[0].report, { userId: 4, status: 'submitted' });
  expectFields(data.members[1], { userId: 5, status: 'draft', report: null });
  const managerView = await request(`${reportsPath}/team?viewerId=${dataManagerId}&weekStart=${weekStart}`);
  expectFields(managerView.members[1].report, { userId: 5, status: 'draft' });
  await request(path, 400);
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

await step('Manager can reject a pending leave', async () => {
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

const reservationsPath = '/api/room-reservations';
const myReservationsPath = `${reservationsPath}/mine?userId=${employeeId}`;
let nextBooking;
let booked;
let bookedToday;

await step('Four Magok rooms and five seeded reservations are visible for their dates', async () => {
  const rooms = await request('/api/rooms');
  const expectedRooms = [
    [1, '대회의실', 12, 'TV·화상회의'],
    [2, '중회의실', 8, 'TV'],
    [3, '소회의실 A', 4, ''],
    [4, '소회의실 B', 4, '']
  ];
  expect(rooms.length, expectedRooms.length, 'room count');
  for (const [id, name, capacity, equipment] of expectedRooms) {
    expectFields(rooms[id - 1], { id, office: '마곡 사무실', name, capacity, equipment });
  }
  const current = await request(`${reservationsPath}?date=${today}`);
  expect(current.length, 3, 'reservations seeded for today');
  expect(current.map((row) => row.roomId).join(), '1,2,3', 'reservations ordered by room');
  expectFields(current[0], {
    date: today, roomName: '대회의실', status: 'reserved', userName: '박팀장', startTime: '10:00', endTime: '11:00'
  });

  let nextWeekday = offsetDay(today, 1);
  while ([0, 6].includes(new Date(`${nextWeekday}T00:00:00Z`).getUTCDay())) {
    nextWeekday = offsetDay(nextWeekday, 1);
  }
  const next = await request(`${reservationsPath}?date=${nextWeekday}`);
  expect(next.length, 2, 'reservations seeded for the next weekday');
  expect(next.every((row) => row.date === nextWeekday && row.status === 'reserved'), true, 'next weekday dates');
  nextBooking = {
    userId: employeeId, roomId: 4, date: nextWeekday, startTime: '10:00', endTime: '11:00',
    title: '그룹웨어 시연 점검', attendees: '김신입, 이분석'
  };
});

await step('A free next-weekday slot can be booked and appears in my reservations and the daily schedule', async () => {
  booked = await request(reservationsPath, 201, nextBooking);
  expectFields(booked, {
    ...nextBooking, roomName: '소회의실 B', userName: '김신입', team: '개발팀', status: 'reserved'
  });
  expect(new Date(booked.createdAt).toISOString(), booked.createdAt, 'reservation createdAt');
  const mine = await request(myReservationsPath);
  expectFields(mine.at(-1), { id: booked.id, date: nextBooking.date, status: 'reserved' });
  const day = await request(`${reservationsPath}?date=${nextBooking.date}`);
  expectFields(day.find((row) => row.id === booked.id), { title: nextBooking.title, roomId: nextBooking.roomId });
});

await step('A reservation today appears in my reservations and the ordered home summary', async () => {
  bookedToday = await request(reservationsPath, 201, {
    ...nextBooking, date: today, startTime: '08:00', endTime: '08:30', title: '오늘 시연 준비'
  });
  const mine = await request(myReservationsPath);
  expect(mine[0].id, bookedToday.id, 'mine ordered by date and start time');
  const home = await request(employeeHomePath);
  expectFields(home.myReservationsToday[0], {
    id: bookedToday.id, roomName: '소회의실 B', startTime: '08:00', endTime: '08:30', title: '오늘 시연 준비'
  });
  expect(Object.keys(home.myReservationsToday[0]).sort().join(), 'endTime,id,roomName,startTime,title',
    'home reservation response fields');
  expect(home.myReservationsToday.some((row) => row.id === booked.id), false, 'future reservation in home');
});

await step('Overlap returns the Korean 409 conflict and an adjacent booking succeeds', async () => {
  const overlap = await request(reservationsPath, 409, {
    ...nextBooking, userId: 2, startTime: '10:30', endTime: '11:30'
  });
  expect(overlap.error, '이미 예약된 시간입니다 (10:00~11:00, 김신입)', 'overlap error');
  const adjacent = await request(reservationsPath, 201, {
    ...nextBooking, startTime: '09:30', endTime: '10:00', title: '이전 회의'
  });
  expectFields(adjacent, { startTime: '09:30', endTime: booked.startTime, status: 'reserved' });
  const day = await request(`${reservationsPath}?date=${nextBooking.date}`);
  expect(day.filter((row) => row.roomId === booked.roomId).map((row) => row.id).join(),
    [adjacent.id, booked.id].join(), 'same-room start time order');
});

await step('Reservation rejects past dates, invalid hours, non-half-hour slots and missing titles', async () => {
  const invalid = [
    { ...nextBooking, date: offsetDay(today, -1) },
    { ...nextBooking, date: '2026-02-30' },
    { ...nextBooking, startTime: '07:30' },
    { ...nextBooking, startTime: '19:30', endTime: '20:30' },
    { ...nextBooking, startTime: '10:15' },
    { ...nextBooking, startTime: '11:00' },
    { ...nextBooking, startTime: '11:30' },
    { ...nextBooking, title: undefined }
  ];
  for (const payload of invalid) await request(reservationsPath, 400, payload);
});

await step('Cancellation is owner-only, removes the active booking and frees the same slot', async () => {
  const cancelPath = `${reservationsPath}/${booked.id}/cancel`;
  await request(cancelPath, 403, { userId: 2 });
  const cancelled = await request(cancelPath, 200, check);
  expectFields(cancelled, { id: booked.id, userId: employeeId, status: 'cancelled' });
  await request(cancelPath, 409, check);
  const day = await request(`${reservationsPath}?date=${nextBooking.date}`);
  expect(day.some((row) => row.id === booked.id), false, 'cancelled reservation in daily schedule');
  const mine = await request(myReservationsPath);
  expect(mine.some((row) => row.id === booked.id), false, 'cancelled reservation in mine');
  const rebooked = await request(reservationsPath, 201, { ...nextBooking, userId: 2 });
  expectFields(rebooked, { startTime: booked.startTime, endTime: booked.endTime, userId: 2, status: 'reserved' });

  await request(`${reservationsPath}/${bookedToday.id}/cancel`, 200, check);
  const home = await request(employeeHomePath);
  expect(home.myReservationsToday.some((row) => row.id === bookedToday.id), false, 'cancelled reservation in home');
});

await step('Chat proposes a half-day leave with the parsed date and reason', async () => {
  const date = nextBooking.date;
  const response = await chat(`${date} 오후 반차 신청, 사유: 개인 일정`);
  expectFields(response.action, { kind: 'leave', days: 0.5, story: null });
  expectFields(response.action.payload, { type: 'half_pm', startDate: date, endDate: date, reason: '개인 일정' });
});

await step('Chat proposes weekly entries, and merging them with the template can be submitted', async () => {
  const reportUserId = 2;
  const reportPath = `${reportsPath}/current?userId=${reportUserId}`;
  const example = '주간보고: 월 사내 그룹웨어 7시간 화면 설계, 운영 지원 1시간 서버 점검 / 차주: 화 AI 챗봇 PoC 8시간 / 이슈: 없음';
  const response = await chat(example, reportUserId);
  expectFields(response.action, { kind: 'weekly', canSubmit: true });
  const { current, next, weekStart: proposalWeek } = response.action.payload;
  expect(proposalWeek, weekStart, 'chat proposal week');
  expect(current.entries.length, 2, 'current entries');
  expect(next.entries.length, 1, 'next entries');
  expectFields(current.entries[0], {
    day: 'mon', category: '사내 그룹웨어', workType: '회사', content: '화면 설계', hours: 7
  });
  expectFields(current.entries[1], {
    day: 'mon', category: '운영 지원', workType: '회사', content: '서버 점검', hours: 1
  });
  expectFields(next.entries[0], { day: 'tue', category: 'AI 챗봇 PoC', workType: '회사', hours: 8 });
  expectFields(current, { issues: '없음', requests: '', personalSchedule: '' });

  const template = await request(reportPath);
  expect(template.status, 'none', 'chat never writes a report');
  const incomplete = await chat(
    '주간보고: 재택 운영 지원 1시간 서버 점검 / 차주: 사내 그룹웨어 / 요청사항: 결과 공유 / 개인일정: 금요일 반차',
    reportUserId
  );
  expectFields(incomplete.action, { kind: 'weekly', canSubmit: false });
  const { current: partialCurrent, next: partialNext } = incomplete.action.payload;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const defaultDay = ['fri', 'mon', 'tue', 'wed', 'thu', 'fri', 'fri'][weekday];
  expectFields(partialCurrent.entries[0], { day: defaultDay, workType: '재택', category: '운영 지원' });
  expectFields(partialCurrent, { requests: '결과 공유', personalSchedule: '금요일 반차' });
  expectFields(partialNext.entries[0], { day: 'mon', workType: '회사', hours: 0 });
  const longWeekday = await chat('주간보고: 수요일 운영 지원 3시간 서버 점검', reportUserId);
  expect(longWeekday.action.payload.current.entries[0].day, 'wed', '요일 suffix');

  const mergedCurrent = { ...template.current, entries: [...template.current.entries, ...current.entries] };
  for (const field of ['issues', 'requests', 'personalSchedule']) {
    if (current[field]) mergedCurrent[field] = current[field];
  }
  const saved = await request(reportsPath, 200, {
    userId: reportUserId, weekStart: proposalWeek, submit: true,
    current: mergedCurrent, next: { ...template.next, entries: [...template.next.entries, ...next.entries] }
  }, 'PUT');
  expectFields(saved, { status: 'submitted', totalHours: template.totalHours + 8, nextTotalHours: 8 });
  expect(saved.current.issues, '없음', 'merged issues');
});

await step('Chat gives managers and executives weekly summaries with navigation', async () => {
  const manager = await chat('주간보고', managerId);
  expectFields(manager, { screen: 'weekly', action: null });
  expect(manager.reply.includes('제출 2/3명'), true, 'manager team counts');
  const executive = await chat('주간보고 현황 알려줘', executiveId);
  expectFields(executive, { screen: 'weekly', action: null });
  for (const phrase of ['개발팀', '데이터팀', '%', '총']) {
    expect(executive.reply.includes(phrase), true, `executive weekly mentions ${phrase}`);
  }
  for (const text of ['출근', '퇴근', `${nextBooking.date} 연차`, '결재 대기 보여줘', '출퇴근 화면 열어줘']) {
    const response = await chat(text, executiveId);
    expect(response.action, null, 'executive restricted action');
    expect(response.reply.includes('임원 메뉴에서 지원하지 않는 기능'), true, 'executive role message');
  }
});

await step('Chat proposes a room and suggests only free rooms when that slot is taken', async () => {
  const text = '다음 평일 15:00 소회의실 A 1시간 예약, 제목 스프린트 회의';
  const proposal = await chat(text);
  expectFields(proposal.action, { kind: 'room' });
  expectFields(proposal.action.payload, {
    roomId: 3, roomName: '소회의실 A', date: nextBooking.date, startTime: '15:00', endTime: '16:00',
    title: '스프린트 회의', attendees: ''
  });
  const rows = await request(`${reservationsPath}?date=${nextBooking.date}`);
  expect(rows.some((row) => row.roomId === 3 && row.startTime === '15:00'), false, 'chat never books a room');
  await request(reservationsPath, 201, { userId: employeeId, ...proposal.action.payload });
  const conflict = await chat(text);
  expect(conflict.action, null, 'no overlapping booking proposal');
  expect(conflict.reply.includes('대회의실, 소회의실 B'), true, 'only available alternative rooms');
  expect(conflict.reply.includes('중회의실'), false, 'occupied room excluded from alternatives');

  const halfHour = await chat('오늘 오후 4시 반 소회의실 A 30분 예약, 참석자 김신입, 이분석');
  expectFields(halfHour.action.payload, {
    date: today, startTime: '16:30', endTime: '17:00', title: '회의', attendees: '김신입, 이분석'
  });
});

await step('Chat opens rooms and reports room availability and today’s meetings', async () => {
  const nav = await chat('회의실 예약 화면 열어줘');
  expectFields(nav, { screen: 'rooms', action: null });
  const rooms = await chat('오늘 회의실 현황');
  expectFields(rooms, { screen: 'rooms', action: null });
  expect(rooms.reply.includes('대회의실 10:00~11:00 개발팀 주간 회의'), true, 'room status from seeded reservations');
  const status = await chat('오늘 요약');
  expect(status.reply.includes('오늘 내 회의'), true, 'meetings in employee status');
  expect(status.reply.includes('그룹웨어 시연 준비'), true, 'my meeting title in status');
  const executive = await chat('오늘 요약', executiveId);
  expect(executive.reply.includes('개발팀') && executive.reply.includes('데이터팀'), true, 'executive team status');
});

await step('Chat returns 400 for messages over 500 characters', async () => {
  await request(chatPath, 400, { userId: employeeId, text: '가'.repeat(501) });
});

function fixtureZip(parts, storedPart) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [filename, xml] of Object.entries(parts)) {
    const name = Buffer.from(filename);
    const original = Buffer.from(xml);
    const method = filename === storedPart ? 0 : 8;
    const compressed = method === 0 ? original : deflateRawSync(original);
    const crc = crc32(original);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(original.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centralParts.length / 2, 8);
  end.writeUInt16LE(centralParts.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

function fictionalWorkbook({ label = expectedWeekLabel(weekStart), detail = '화면 설계 & 검토',
  selectedWeek = weekStart, stored = false, empty = false } = {}) {
  const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const types = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const relations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const text = (value) => `<t xml:space="preserve">${escape(value)}</t>`;
  const strings = [];
  function shared(address, ...runs) {
    const content = runs.length === 1 ? text(runs[0]) : runs.map((run) => `<r>${text(run)}</r>`).join('');
    strings.push(`<si>${content}</si>`);
    return `<c r="${address}" t="s"><v>${strings.length - 1}</v></c>`;
  }
  const inline = (address, value) => `<c r="${address}" t="inlineStr"><is>${text(value)}</is></c>`;
  const numeric = (address, value) => `<c r="${address}"><v>${value}</v></c>`;
  const row = (number, ...cells) => `<row r="${number}">${cells.join('')}</row>`;
  const rows = [
    row(1, shared('B1', label), inline('F1', expectedWeekLabel(offsetDay(selectedWeek, 7)))),
    row(2, shared('A2', '개인일정(휴가 등)'), inline('B2', '금요일 오후 반차'), inline('F2', '수요일 재택')),
    row(3, inline('A3', '이슈사항'), shared('B3', '테스트 일정 확인'), inline('F3', '검증 환경 준비')),
    row(4, inline('A4', '요청사항/전달사항'), inline('B4', '결과 공유'), shared('F4', '시연 일정 확인')),
    row(5, shared('A5', '요일'), inline('B5', '구분'), inline('C5', '형태'), inline('D5', '내용'),
      inline('E5', '시간'), inline('F5', '구분'), inline('G5', '형태'), inline('H5', '내용'), inline('I5', '시간'))
  ];
  function entry(rowNumber, start, category, workType, detailCell, hours) {
    const letters = start === 'B' ? 'BCDE' : 'FGHI';
    return [
      shared(letters[0] + rowNumber, category),
      inline(letters[1] + rowNumber, workType),
      detailCell,
      hours === null ? `<c r="${letters[3]}${rowNumber}"/>` : numeric(letters[3] + rowNumber, hours)
    ];
  }
  const current = (...args) => empty ? [] : entry(...args);
  rows.push(
    row(6, shared('A6', '월'),
      ...current(6, 'B', '사내 그룹웨어', '회사', empty ? '' : shared('D6', `${detail}\n`, '시연 시나리오 정리'), 7),
      ...entry(6, 'F', '사내 그룹웨어', '회사', inline('H6', '접근성 점검'), 5)),
    row(7, ...current(7, 'B', '운영 지원', '재택', inline('D7', '가상 서버 점검'), null)),
    row(10, inline('A10', '화'),
      ...current(10, 'B', '데이터 대시보드', '사무실', inline('D10', '가상 지표 검증'), 8),
      ...entry(10, 'F', 'AI 챗봇 PoC', '출장', inline('H10', '질문 흐름 확인'), 6)),
    row(14, shared('A14', '수'), ...entry(14, 'F', '운영 지원', '재택', inline('H14', '점검 문서 정리'), 2)),
    row(18, inline('A18', '목'), ...current(18, 'B', '사내 그룹웨어', '회사', inline('D18', '통합 테스트'), 14)),
    row(19, ...current(19, 'B', '운영 지원', '외근', inline('D19', '가상 점검 시연'), 11)),
    row(22, shared('A22', '금'), ...current(22, 'B', 'AI 챗봇 PoC', '회사', inline('D22', '정리'), 2)),
    row(26, inline('B26', '합계'), '<c r="E26" t="e"><f>SUM(E6:E25)</f><v>#REF!</v></c>')
  );
  const merges = ['B1:E1', 'F1:I1', 'B2:E2', 'F2:I2', 'B3:E3', 'F3:I3', 'B4:E4', 'F4:I4',
    'A6:A9', 'A10:A13', 'A14:A17', 'A18:A21', 'A22:A25'];
  const sheet = `<worksheet xmlns="${spreadsheet}"><sheetData>${rows.join('')}</sheetData>` +
    `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`;
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${types}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
    '_rels/.rels': `<Relationships xmlns="${relations}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="${office}"><sheets><sheet name="주간보고" sheetId="1" r:id="rId42"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relations}">` +
      `<Relationship Id="rId9" Type="${office}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId42" Type="${office}/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<sst xmlns="${spreadsheet}">${strings.join('')}</sst>`,
    'xl/worksheets/sheet1.xml': sheet
  };
  for (const filename of Object.keys(parts)) parts[filename] = declaration + parts[filename];
  return fixtureZip(parts, stored ? 'xl/sharedStrings.xml' : null);
}

const uploadUserId = 8;
const uploadName = '주간보고 시연.xlsx';
const revisedName = '주간보고 수정본.xlsx';
let uploadedId;
let revisedBytes;

async function uploadWorkbook(bytes, expectedStatus = 200, { userId = uploadUserId, fileName = uploadName } = {}) {
  const query = new URLSearchParams({ userId, fileName });
  const response = await fetch(new URL(`${reportsPath}/upload?${query}`, baseUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes, signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  expect(response.status, expectedStatus, `upload response: ${JSON.stringify(result)}`);
  return result;
}

await step('XLSX upload parses week labels, both halves, merged weekdays and worksheet warnings', async () => {
  const { report, warnings } = await uploadWorkbook(fictionalWorkbook());
  uploadedId = report.id;
  expectFields(report, {
    userId: uploadUserId, team: '개발팀', weekStart, weekLabel: expectedWeekLabel(weekStart),
    nextWeekLabel: expectedWeekLabel(offsetDay(weekStart, 7)), status: 'draft', fileName: uploadName,
    totalHours: 42, nextTotalHours: 13, submittedAt: null
  });
  expectFields(report.current, { personalSchedule: '금요일 오후 반차', issues: '테스트 일정 확인', requests: '결과 공유' });
  expectFields(report.next, { personalSchedule: '수요일 재택', issues: '검증 환경 준비', requests: '시연 일정 확인' });
  expect(report.current.entries.map((entry) => entry.day).join(), 'mon,mon,tue,thu,thu,fri', 'current weekdays');
  expect(report.next.entries.map((entry) => entry.day).join(), 'mon,tue,wed', 'planned weekdays');
  expectFields(report.current.entries[0], {
    category: '사내 그룹웨어', workType: '회사', content: '화면 설계 & 검토\n시연 시나리오 정리', hours: 7
  });
  expectFields(report.current.entries[1], { category: '운영 지원', workType: '재택', hours: 0 });
  expectFields(report.current.entries[2], { category: '데이터 대시보드', workType: '회사', hours: 8 });
  expectFields(report.next.entries[1], { category: 'AI 챗봇 PoC', workType: '출장', hours: 6 });
  expect(warnings.length, 3, 'warnings without a total-row error');
  expect(warnings.some((value) => /7행.*0시간/.test(value)), true, 'empty-hours warning');
  expect(warnings.some((value) => /10행.*회사/.test(value)), true, 'invalid work-type warning');
  expect(warnings.some((value) => /목요일.*24시간/.test(value)), true, 'daily total warning');
  const current = await request(`${reportsPath}/current?userId=${uploadUserId}`);
  expectFields(current, { id: uploadedId, status: 'draft', fileName: uploadName });
});

await step('Re-upload overwrites the same draft and reads stored ZIP entries', async () => {
  revisedBytes = fictionalWorkbook({ detail: '가상 장애 화면 검토', stored: true });
  const { report } = await uploadWorkbook(revisedBytes, 200, { fileName: revisedName });
  expectFields(report, { id: uploadedId, status: 'draft', fileName: revisedName });
  expect(report.current.entries[0].content, '가상 장애 화면 검토\n시연 시나리오 정리', 'replacement contents');
});

await step('Only the owner submits the upload, and the manager receives its parsed approval detail', async () => {
  const path = `${reportsPath}/${uploadedId}/submit`;
  await request(path, 403, { userId: employeeId });
  const report = await request(path, 200, { userId: uploadUserId });
  expectFields(report, { id: uploadedId, status: 'submitted', fileName: revisedName, totalHours: 42 });
  expect(report.current.entries[1].hours, 0, 'submit accepts a warned upload row');
  const queue = await request(queuePath);
  const item = queue.find(({ kind, id }) => kind === 'weekly' && id === uploadedId);
  expectFields(item.detail, { userId: uploadUserId, status: 'submitted', fileName: revisedName });
  expectFields(item.detail.current.entries[2], { day: 'tue', category: '데이터 대시보드', workType: '회사' });
  await request(path, 409, { userId: uploadUserId });
  await uploadWorkbook(revisedBytes, 409);
  await uploadWorkbook(revisedBytes, 409, { userId: employeeId });
});

await step('Workbook download returns original bytes to authorized roles and 403 to other users', async () => {
  for (const viewerId of [uploadUserId, managerId, executiveId]) {
    const url = new URL(`${reportsPath}/${uploadedId}/file?viewerId=${viewerId}`, baseUrl);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    expect(response.status, 200, `download for user ${viewerId}`);
    expect(response.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX media type');
    expect(response.headers.get('content-disposition').includes(`filename*=UTF-8''${encodeURIComponent(revisedName)}`),
      true, 'original filename in attachment header');
    expect(Buffer.from(await response.arrayBuffer()).equals(revisedBytes), true, 'download matches re-upload bytes');
  }
  for (const viewerId of [employeeId, 4, dataManagerId]) {
    await request(`${reportsPath}/${uploadedId}/file?viewerId=${viewerId}`, 403);
  }
  const reports = await request(`${reportsPath}?userId=${employeeId}`);
  const seed = reports.find((report) => report.weekStart === offsetDay(weekStart, -7));
  expect(seed.fileName, null, 'seed has no original');
  await request(`${reportsPath}/${seed.id}/file?viewerId=${employeeId}`, 404);
});

await step('Workbook upload rejects forbidden roles, invalid formats, missing label dates and oversize files', async () => {
  await uploadWorkbook(revisedBytes, 403, { userId: managerId });
  await uploadWorkbook(revisedBytes, 403, { userId: executiveId });
  const garbage = await uploadWorkbook(Buffer.from('this is not a workbook'), 400);
  expect(garbage.error.startsWith('주간보고 양식을 읽을 수 없습니다: '), true, 'ZIP format error');
  const missingDate = await uploadWorkbook(fictionalWorkbook({ label: '날짜 없는 주차 라벨' }), 400);
  expect(missingDate.error.startsWith('주간보고 양식을 읽을 수 없습니다: B1'), true, 'invalid label error');
  await uploadWorkbook(Buffer.alloc(2 * 1024 * 1024 + 1), 413);
});

await step('Rejected upload can be replaced and resubmitted, while empty current work cannot be submitted', async () => {
  const rejected = await request(`${reportsPath}/${uploadedId}/reject`, 200, rejection);
  expectFields(rejected, { status: 'rejected', fileName: revisedName });
  const { report } = await uploadWorkbook(fictionalWorkbook({ detail: '반려 의견 반영' }));
  expectFields(report, { id: uploadedId, status: 'draft', comment: null, approverId: null, fileName: uploadName });
  const resubmitted = await request(`${reportsPath}/${uploadedId}/submit`, 200, { userId: uploadUserId });
  expectFields(resubmitted, { id: uploadedId, status: 'submitted', fileName: uploadName });

  const futureWeek = offsetDay(weekStart, 7);
  const emptyWorkbook = fictionalWorkbook({ label: expectedWeekLabel(futureWeek), selectedWeek: futureWeek, empty: true });
  const { report: empty } = await uploadWorkbook(emptyWorkbook);
  expect(empty.current.entries.length, 0, 'empty current report allowed for upload');
  await request(`${reportsPath}/${empty.id}/submit`, 400, { userId: uploadUserId });
});

const docsPath = '/api/docs';
const searchDocsPath = (q, limit) =>
  `${docsPath}/search?${new URLSearchParams(limit === undefined ? { q } : { q, limit })}`;
const docDraft = {
  userId: employeeId, space: '가상 검증 공간', title: '가상 검증 기록',
  body: '앞부분의 검증 기록입니다.\n\n## 진행 내역\n가상 사례를 확인했습니다.',
  labels: '검증,기록'
};
let releaseDoc;
let guideDoc;

await step('Wiki lists and reads the two fictional seed documents', async () => {
  const docs = await request(docsPath);
  expect(docs.length, 2, 'seeded wiki documents');
  expectFields(docs[0], { space: '그룹웨어 프로젝트', docKey: 'GW', title: '그룹웨어 v1 출시 일정' });
  expectFields(docs[1], { space: '사내 가이드', title: '연차·회의실 이용 가이드' });
  expect('body' in docs[0], false, 'list contains only metadata');
  releaseDoc = await request(`${docsPath}/${docs[0].id}`);
  guideDoc = await request(`${docsPath}/${docs[1].id}`);
  for (const doc of [releaseDoc, guideDoc]) {
    expect(doc.body.split('\n')[0], '> 예시 문서입니다. 실제 일정·규정이 아닙니다.', 'fictional document notice');
    expect(typeof doc.authorName, 'string', 'document author');
  }
  for (const key of ['GW-101', 'GW-102', 'GW-103', 'GW-104', 'GW-105', 'GW-106']) {
    expect(releaseDoc.body.includes(key), true, `seed issue ${key}`);
  }
  await request(`${docsPath}/99999`, 404);
});

await step('Wiki creates and updates Markdown with the correct author and last editor', async () => {
  const created = await request(docsPath, 201, docDraft);
  expectFields(created, {
    space: docDraft.space, title: docDraft.title, body: docDraft.body, labels: docDraft.labels,
    authorName: '김신입', updatedByName: '김신입'
  });
  expect(/^DOC-\d+$/.test(created.docKey), true, 'new document key');
  const nextBody = `${docDraft.body}\n\n### 격리검증표식\n  단계와 결과를 기록합니다.\n`;
  const edited = await request(`${docsPath}/${created.id}`, 200, {
    userId: 2, title: '가상 검증 기록 수정본', body: nextBody, labels: '검증,수정'
  }, 'PUT');
  expectFields(edited, {
    id: created.id, docKey: created.docKey, space: docDraft.space, authorName: '김신입',
    updatedByName: '이분석', body: nextBody, labels: '검증,수정', createdAt: created.createdAt
  });
  expectFields(await request(`${docsPath}/${created.id}`), { updatedByName: '이분석', body: nextBody });
  const subsection = await request(searchDocsPath('격리검증표식', 1));
  expectFields(subsection[0], { docId: created.id, heading: '격리검증표식', excerpt: '단계와 결과를 기록합니다.' });
});

await step('Wiki rejects missing fields, oversized bodies and invalid search parameters', async () => {
  for (const fields of [{ title: ' ' }, { body: '' }, { space: '' }, { body: '가'.repeat(20001) }, { labels: [] }]) {
    await request(docsPath, 400, { ...docDraft, ...fields });
  }
  await request(`${docsPath}/${releaseDoc.id}`, 400, { ...docDraft, body: '가'.repeat(20001) }, 'PUT');
  await request(searchDocsPath('정식 오픈', 0), 400);
  await request(`${docsPath}/search`, 400);
});

await step('Wiki search ranks the milestone first, excludes zero-score sections and honors the limit', async () => {
  const results = await request(searchDocsPath('정식 오픈'));
  expectFields(results[0], { docId: releaseDoc.id, heading: '마일스톤', title: releaseDoc.title });
  expect(results[0].excerpt.includes('2027-01-04'), true, 'release date in the excerpt');
  expect(results.every((result, index) => result.score > 0 && result.excerpt.length <= 300 &&
    (index === 0 || results[index - 1].score >= result.score)), true, 'scoring and excerpt bounds');
  expect(Object.keys(results[0]).sort().join(), 'docId,excerpt,heading,score,space,title', 'search result shape');
  expect((await request(searchDocsPath('정식 오픈은', 1))).length, 1, 'search limit');
  expect((await request(searchDocsPath('꽁쀼잉꽈쿵'))).length, 0, 'no matches for nonsense');
});

await step('Chat quotes the correct wiki sections and facts for release, issue, half-day and API schedule', async () => {
  const questions = [
    ['그룹웨어 정식 오픈 언제야?', releaseDoc, '마일스톤', '2027-01-04'],
    ['GW-104 담당자 누구야?', releaseDoc, '작업 목록', 'GW-104 | 주간보고 업로드 구현 | 박사원'],
    ['반차 시간 몇 시부터야?', guideDoc, '연차 신청 기준', '09:00~14:00'],
    ['API 개발 일정 알려줘', releaseDoc, '마일스톤', '12/07~12/18']
  ];
  for (const [question, doc, heading, fact] of questions) {
    const answer = await chat(question);
    expect(answer.reply.includes(fact), true, `fact for ${question}`);
    expect(answer.reply.startsWith('문서에서 찾은 내용이에요.'), true, 'grounded quote introduction');
    expectFields(answer.citations[0], { docId: doc.id, title: doc.title, heading });
    expectFields(answer.action, { kind: 'navigate', route: 'docs', docId: doc.id, label: doc.title });
  }
});

await step('Chat uses high-scoring wiki matches on general questions and preserves the daily status', async () => {
  const inferred = await chat('시범 운영은 며칠이야?');
  expect(inferred.citations.some(({ docId }) => docId === releaseDoc.id), true, 'high-score implicit grounding');
  const missing = await chat('GW-999999?');
  expect(missing.reply.includes('문서에서 찾지 못했어요'), true, 'no grounded evidence');
  expect(missing.citations.length, 0, 'no citations for a missing issue');
  expectFields(missing.action, { kind: 'navigate', route: 'docs' });
  const status = await chat('오늘 요약');
  expect(status.reply.includes('요약이에요') && status.reply.includes('오늘 내 회의'), true, 'daily status reply');
  expectFields(status, { action: null });
  expect(status.citations.length, 0, 'no citations for live home status');
});
