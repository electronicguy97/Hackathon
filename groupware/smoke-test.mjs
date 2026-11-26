const baseUrl = new URL(process.argv[2] ?? 'http://localhost:3000');
const employeeId = 1;
const managerId = 3;
const balancePath = `/api/users/${employeeId}/balance`;
const historyPath = `/api/leave-requests?userId=${employeeId}`;
const queuePath = `/api/approvals?approverId=${managerId}`;
const application = {
  userId: employeeId,
  type: 'annual',
  startDate: '2026-12-01',
  endDate: '2026-12-02',
  reason: '개인 사유'
};
const decision = { approverId: managerId, comment: '일정 확인했습니다.' };
let requestId;

function expect(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectFields(value, fields) {
  for (const [key, expected] of Object.entries(fields)) expect(value[key], expected, key);
}

async function request(path, expectedStatus = 200, body) {
  const options = { signal: AbortSignal.timeout(5000) };
  if (body !== undefined) {
    options.method = 'POST';
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
});

await step('Manager sees one request in the approval queue', async () => {
  const queue = await request(queuePath);
  expect(queue.length, 1, 'queue count');
  expectFields(queue[0], { id: requestId, userName: '김신입', status: 'pending' });
});

await step('Non-manager approval returns 403', async () => {
  await request(`/api/leave-requests/${requestId}/approve`, 403, { approverId: 2 });
});

await step('Manager approves with a comment and clears the queue', async () => {
  const leave = await request(`/api/leave-requests/${requestId}/approve`, 200, decision);
  expectFields(leave, { id: requestId, status: 'approved', approverName: '박팀장', ...decision });
  expect(new Date(leave.decidedAt).toISOString(), leave.decidedAt, 'decidedAt');
  expect((await request(queuePath)).length, 0, 'queue count');
});

await step('Employee sees approved history and a 13-day remaining balance', async () => {
  const history = await request(historyPath);
  expectFields(history[0], { id: requestId, status: 'approved', comment: decision.comment });
  expectFields(await request(balancePath), { total: 15, used: 2, pending: 0, remaining: 13 });
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
