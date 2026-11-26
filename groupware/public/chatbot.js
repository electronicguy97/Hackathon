// 우측 하단 업무 챗봇
// - 서버 /api/chat 이 문장을 해석해 답장과 "제안 동작"을 돌려준다.
// - 실제 신청·저장·승인은 카드의 확인 버튼을 눌렀을 때 기존 API 로 실행한다.
// - 실행 뒤에는 현재 화면(app.js)과 네비게이션 배지를 새로 고친다.
(() => {
  'use strict';

  const STORAGE_KEY = 'groupware.selectedUserId';
  const TYPE_LABEL = { annual: '연차', half_am: '오전 반차', half_pm: '오후 반차' };
  const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const DAY_LABEL = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금' };
  const EXEC_ALLOWED_ROUTES = new Set(['home', 'weekly', 'rooms']);

  const EMPLOYEE_SUGGESTIONS = [
    '오늘 요약',
    '다음 주 월화 연차 쓸게요',
    '출근',
    '주간보고: 월 사내 그룹웨어 7시간 화면 설계, 운영 지원 1시간 서버 점검 / 차주: 화 AI 챗봇 PoC 8시간 / 이슈: 없음',
    '내일 오후 3시 소회의실 A 1시간 예약, 제목 스프린트 회의',
  ];
  const MANAGER_SUGGESTIONS = [
    '오늘 요약',
    '결재 대기 보여줘',
    '출근',
    '내일 오후 3시 소회의실 A 1시간 예약, 제목 주간 점검',
  ];
  const EXEC_SUGGESTIONS = [
    '오늘 요약',
    '주간보고 팀별 현황 보여줘',
    '오늘 오후 3시 소회의실 A 1시간 예약, 제목 임원 점검',
  ];

  // ---------- 공통 ----------

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'disabled') node.disabled = Boolean(value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child != null && child !== false) node.append(child);
    }
    return node;
  }

  async function api(url, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('서버에 연결할 수 없어요.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `요청에 실패했어요. (HTTP ${res.status})`);
    return data;
  }

  const userSelect = () => document.getElementById('user-select');

  function currentUserId() {
    const selected = Number(userSelect()?.value);
    if (Number.isFinite(selected) && selected > 0) return selected;
    try {
      const stored = Number(window.localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(stored) && stored > 0 ? stored : null;
    } catch {
      return null;
    }
  }

  const currentUserLabel = () => userSelect()?.selectedOptions?.[0]?.textContent ?? '';

  async function refreshApp() {
    if (typeof window.groupwareRefresh === 'function') {
      await window.groupwareRefresh();
    } else {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  // ---------- 화면 뼈대 ----------

  const fab = h('button', { type: 'button', className: 'cb-fab', 'aria-label': '업무 도우미 열기' });
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

  const log = h('div', { className: 'cb-log', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', {
    className: 'cb-input',
    rows: '1',
    maxlength: '500',
    placeholder: '예: 다음 주 월화 연차 / 내일 3시 소회의실 A 예약',
    'aria-label': '메시지 입력',
  });
  const sendBtn = h('button', { type: 'submit', className: 'cb-send', text: '보내기' });
  const form = h('form', { className: 'cb-form' }, input, sendBtn);
  const closeBtn = h('button', { type: 'button', className: 'cb-close', 'aria-label': '닫기', text: '×' });
  const panel = h('section', { className: 'cb-panel', 'aria-label': '업무 도우미', hidden: '' },
    h('header', { className: 'cb-header' },
      h('div', {},
        h('strong', { text: '업무 도우미' }),
        h('span', { className: 'cb-sub', text: '연차 · 주간보고 · 출퇴근 · 결재 · 회의실' })),
      closeBtn),
    log,
    form);

  document.body.append(panel, fab);

  function open() {
    panel.hidden = false;
    fab.classList.add('is-open');
    if (!log.childElementCount) greet();
    input.focus();
  }
  function close() {
    panel.hidden = true;
    fab.classList.remove('is-open');
  }
  fab.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  // ---------- 메시지 ----------

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function say(who, text, extra) {
    const bubble = h('div', { className: `cb-msg cb-${who}` }, h('div', { className: 'cb-bubble', text }));
    if (extra) bubble.append(extra);
    log.append(bubble);
    scrollDown();
    return bubble;
  }

  function chips(list) {
    return h('div', { className: 'cb-chips' },
      list.map((text) => h('button', { type: 'button', className: 'cb-chip', text, onClick: () => send(text) })));
  }

  let usersCache = null;
  async function getCurrentUserInfo() {
    const id = currentUserId();
    if (!id) return null;
    try {
      usersCache ??= await api('/api/users');
      return usersCache.find((u) => u.id === id) || null;
    } catch {
      return null;
    }
  }

  async function greet() {
    const user = await getCurrentUserInfo();
    const fallbackName = currentUserLabel().replace(/\s*\(.*\)$/, '');
    const name = user?.name || fallbackName;
    const role = user?.role || 'employee';

    let suggestionList = EMPLOYEE_SUGGESTIONS;
    let capabilitiesText = '연차 신청, 주간보고 작성, 출퇴근, 회의실 예약을 말로 처리할 수 있어요.';
    if (role === 'manager') {
      suggestionList = MANAGER_SUGGESTIONS;
      capabilitiesText = '결재 처리, 출퇴근, 연차 신청, 회의실 예약, 팀 주간보고 조회를 도와드릴 수 있어요.';
    } else if (role === 'executive') {
      suggestionList = EXEC_SUGGESTIONS;
      capabilitiesText = '팀별 주간보고 요약, 회의실 예약, 화면 이동을 도와드릴 수 있어요.';
    }

    say('bot', `${name || ''} 님, 무엇을 도와드릴까요?\n${capabilitiesText}`, chips(suggestionList));
  }

  userSelect()?.addEventListener('change', () => {
    log.replaceChildren();
    if (!panel.hidden) greet();
  });

  // ---------- 보내기 ----------

  let busy = false;
  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    const userId = currentUserId();
    if (!userId) {
      say('bot', '사용자 정보를 불러오는 중이에요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    busy = true;
    sendBtn.disabled = true;
    say('me', text);
    input.value = '';
    const typing = say('bot', '');
    typing.classList.add('is-typing');
    typing.querySelector('.cb-bubble').append(
      h('span', { className: 'cb-dot' }), h('span', { className: 'cb-dot' }), h('span', { className: 'cb-dot' }));

    // 사람처럼 보이도록 답장까지 최소 2~3초 기다린다 (서버가 더 오래 걸리면 추가로 기다리지 않음)
    const minDelay = 2000 + Math.random() * 1000;
    const started = performance.now();
    const pad = () => new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, minDelay - (performance.now() - started))));

    try {
      const res = await api('/api/chat', { method: 'POST', body: { userId, text } })
        .finally(pad);
      typing.remove();
      // 관련 화면으로 먼저 전환 (출퇴근, 주간보고, 연차, 승인, 홈)
      if (res.screen && window.location.hash !== `#/${res.screen}`) {
        window.location.hash = `#/${res.screen}`;
      }
      const msg = say('bot', res.reply);
      if (res.warning) msg.append(h('div', { className: 'cb-note', text: res.warning }));
      if (res.action) await handleAction(res.action, msg);
    } catch (err) {
      typing.remove();
      say('bot', err.message).classList.add('is-error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });

  // ---------- 주간보고 병합 · 렌더링 ----------

  function sumEntriesHours(entries) {
    return (Array.isArray(entries) ? entries : []).reduce((sum, e) => {
      const n = Number(e?.hours);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
  }

  function renderGroupedWeeklySection(title, entries) {
    const list = Array.isArray(entries) ? entries : [];
    const total = sumEntriesHours(list);
    const section = h('div', { className: 'cb-weekly-section' },
      h('div', { className: 'cb-label', text: `${title} (총 ${total}시간)` }));

    if (list.length === 0) {
      section.append(h('div', { className: 'cb-muted', text: '추가된 항목 없음' }));
      return section;
    }

    const byDay = new Map();
    for (const entry of list) {
      const dayKey = DAY_LABEL[entry.day] ? entry.day : 'mon';
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey).push(entry);
    }

    const orderedDays = [...DAY_ORDER.filter((d) => byDay.has(d)), ...[...byDay.keys()].filter((d) => !DAY_ORDER.includes(d))];
    for (const dayKey of orderedDays) {
      const dayEntries = byDay.get(dayKey);
      const dayHours = sumEntriesHours(dayEntries);
      const dayWrap = h('div', { className: 'cb-weekly-day' },
        h('div', { className: 'cb-weekly-day-head' },
          h('span', { className: 'cb-day-tag', text: DAY_LABEL[dayKey] || dayKey }),
          h('span', { text: `${dayHours}시간` })));

      for (const it of dayEntries) {
        dayWrap.append(h('div', { className: 'cb-weekly-entry' },
          h('div', { className: 'cb-weekly-entry-top' },
            h('span', {},
              h('strong', { text: it.category || '일반 업무' }),
              h('span', { className: 'cb-type-tag', text: it.workType || '회사' })),
            h('strong', { text: `${Number(it.hours) || 0}h` })),
          it.content ? h('div', { className: 'cb-muted', text: it.content }) : null));
      }
      section.append(dayWrap);
    }

    return section;
  }

  function mergeWeekPart(basePart = {}, patchPart = {}) {
    const baseEntries = Array.isArray(basePart?.entries) ? basePart.entries : [];
    const patchEntries = Array.isArray(patchPart?.entries) ? patchPart.entries : [];
    const pickText = (field) => {
      const nextVal = typeof patchPart?.[field] === 'string' ? patchPart[field].trim() : '';
      return nextVal || (typeof basePart?.[field] === 'string' ? basePart[field] : '');
    };
    return {
      personalSchedule: pickText('personalSchedule'),
      issues: pickText('issues'),
      requests: pickText('requests'),
      entries: [...baseEntries, ...patchEntries],
    };
  }

  // ---------- 제안 동작 ----------

  async function run(card, buttons, task) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const doneText = await task();
      card.classList.add('is-done');
      say('bot', doneText);
      await refreshApp();
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      say('bot', err.message).classList.add('is-error');
    }
  }

  function row(label, value) {
    return h('div', { className: 'cb-row' }, h('span', { text: label }), h('span', { text: value }));
  }

  async function handleAction(action, anchor) {
    const userId = currentUserId();
    const userInfo = await getCurrentUserInfo();
    const role = userInfo?.role || 'employee';

    if (action.kind === 'navigate') {
      if (role === 'executive' && !EXEC_ALLOWED_ROUTES.has(action.route)) {
        return;
      }
      const go = () => { window.location.hash = `#/${action.route}`; };
      if (action.auto) {
        go();
      } else {
        anchor.append(h('div', { className: 'cb-actions' },
          h('button', { type: 'button', className: 'cb-btn', text: `${action.label} 화면 열기`, onClick: go })));
        scrollDown();
      }
      return;
    }

    if (action.kind === 'check_in' || action.kind === 'check_out') {
      if (role === 'executive') return;
      const isIn = action.kind === 'check_in';
      try {
        const rec = await api(`/api/attendance/${isIn ? 'check-in' : 'check-out'}`, { method: 'POST', body: { userId } });
        say('bot', isIn
          ? `${rec.checkIn ?? ''} 출근 완료${rec.late ? ' (09:00 이후라 지각으로 기록됐어요)' : ''}.`
          : `${rec.checkOut ?? ''} 퇴근 완료.`);
        await refreshApp();
      } catch (err) {
        say('bot', err.message).classList.add('is-error');
      }
      return;
    }

    if (action.kind === 'leave') {
      if (role === 'executive') return;
      const p = action.payload;
      const period = p.startDate === p.endDate ? p.startDate : `${p.startDate} ~ ${p.endDate}`;
      const reasonBox = h('div', { className: 'cb-reason', text: p.reason });
      const card = h('div', { className: 'cb-card' },
        row('유형', TYPE_LABEL[p.type] ?? p.type),
        row('기간', period),
        row('차감', `${action.days}일`),
        h('div', { className: 'cb-label', text: action.story ? '사유 (기가 막힌 사연)' : '사유' }),
        reasonBox);

      const submit = h('button', { type: 'button', className: 'cb-btn cb-primary', text: '신청' });
      const cancel = h('button', { type: 'button', className: 'cb-btn', text: '취소' });
      const buttons = [submit, cancel];

      if (action.story) {
        const another = h('button', { type: 'button', className: 'cb-btn', text: '다른 사연' });
        const plain = h('button', { type: 'button', className: 'cb-btn', text: `그냥 '${action.story.fallback}'` });
        another.addEventListener('click', async () => {
          another.disabled = true;
          another.textContent = '쓰는 중…';
          try {
            const { story } = await api('/api/chat/story', {
              method: 'POST',
              body: { type: p.type, startDate: p.startDate, endDate: p.endDate, avoid: p.reason },
            });
            p.reason = story;
            reasonBox.textContent = story;
            card.querySelector('.cb-label').textContent = '사유 (기가 막힌 사연)';
          } catch (err) {
            say('bot', err.message).classList.add('is-error');
          } finally {
            another.disabled = false;
            another.textContent = '다른 사연';
          }
        });
        plain.addEventListener('click', () => {
          p.reason = action.story.fallback;
          reasonBox.textContent = p.reason;
          card.querySelector('.cb-label').textContent = '사유';
        });
        buttons.splice(1, 0, another, plain);
      }

      submit.addEventListener('click', () => run(card, buttons, async () => {
        const saved = await api('/api/leave-requests', { method: 'POST', body: { userId, ...p } });
        return `${TYPE_LABEL[saved.type]} ${saved.days}일 신청 완료! 팀장 승인을 기다리고 있어요.`;
      }));
      cancel.addEventListener('click', () => {
        buttons.forEach((b) => { b.disabled = true; });
        card.classList.add('is-done');
        say('bot', '신청을 취소했어요.');
      });

      card.append(h('div', { className: 'cb-actions' }, buttons));
      anchor.append(card);
      scrollDown();
      return;
    }

    if (action.kind === 'weekly') {
      if (role !== 'employee') return;
      const p = action.payload || {};
      const curPatch = p.current || {};
      const nextPatch = p.next || {};

      const card = h('div', { className: 'cb-card' },
        renderGroupedWeeklySection('금주 실적', curPatch.entries),
        renderGroupedWeeklySection('차주 계획', nextPatch.entries),
        curPatch.personalSchedule ? row('개인일정', curPatch.personalSchedule) : null,
        curPatch.issues ? row('이슈사항', curPatch.issues) : null,
        curPatch.requests ? row('요청/전달', curPatch.requests) : null);

      const submit = h('button', { type: 'button', className: 'cb-btn cb-primary', text: '제출', disabled: !action.canSubmit });
      const draft = h('button', { type: 'button', className: 'cb-btn', text: '임시저장' });
      const cancel = h('button', { type: 'button', className: 'cb-btn', text: '취소' });
      const buttons = action.canSubmit ? [submit, draft, cancel] : [draft, cancel];

      const save = (isSubmit) => run(card, buttons, async () => {
        const baseReport = await api(`/api/weekly-reports/current?userId=${encodeURIComponent(userId)}`);
        const mergedCurrent = mergeWeekPart(baseReport.current, curPatch);
        const mergedNext = mergeWeekPart(baseReport.next, nextPatch);
        await api('/api/weekly-reports', {
          method: 'PUT',
          body: {
            userId,
            weekStart: baseReport.weekStart || p.weekStart,
            current: mergedCurrent,
            next: mergedNext,
            submit: isSubmit,
          },
        });
        return isSubmit ? '주간보고를 제출했어요. 팀장 결재를 기다리고 있어요.' : '임시저장했어요. 주간보고 메뉴에서 이어서 수정할 수 있어요.';
      });

      submit.addEventListener('click', () => save(true));
      draft.addEventListener('click', () => save(false));
      cancel.addEventListener('click', () => {
        buttons.forEach((b) => { b.disabled = true; });
        card.classList.add('is-done');
        say('bot', '저장하지 않았어요.');
      });

      card.append(h('div', { className: 'cb-actions' }, [submit, draft, cancel]));
      anchor.append(card);
      scrollDown();
      return;
    }

    if (action.kind === 'room') {
      const p = action.payload || {};
      const card = h('div', { className: 'cb-card' },
        row('회의실', p.roomName || `회의실 #${p.roomId}`),
        row('날짜', p.date || '-'),
        row('시간', `${p.startTime || '-'} ~ ${p.endTime || '-'}`),
        row('제목', p.title || '회의'),
        row('참석자', p.attendees || '-'));

      const reserve = h('button', { type: 'button', className: 'cb-btn cb-primary', text: '예약' });
      const cancel = h('button', { type: 'button', className: 'cb-btn', text: '취소' });
      const buttons = [reserve, cancel];

      reserve.addEventListener('click', () => run(card, buttons, async () => {
        const saved = await api('/api/room-reservations', {
          method: 'POST',
          body: {
            userId,
            roomId: p.roomId,
            date: p.date,
            startTime: p.startTime,
            endTime: p.endTime,
            title: p.title,
            attendees: p.attendees ?? '',
          },
        });
        return `${saved.roomName} ${saved.date} ${saved.startTime}~${saved.endTime} 예약 완료!`;
      }));

      cancel.addEventListener('click', () => {
        buttons.forEach((b) => { b.disabled = true; });
        card.classList.add('is-done');
        say('bot', '예약하지 않았어요.');
      });

      card.append(h('div', { className: 'cb-actions' }, buttons));
      anchor.append(card);
      scrollDown();
      return;
    }

    if (action.kind === 'approvals') {
      if (role !== 'manager') return;
      const list = h('div', { className: 'cb-card' });
      for (const item of action.items) {
        const approve = h('button', { type: 'button', className: 'cb-btn cb-primary', text: '승인' });
        const entry = h('div', { className: 'cb-approval' },
          h('div', {},
            h('strong', { text: item.userName }),
            h('div', { text: item.title }),
            item.reason ? h('div', { className: 'cb-muted', text: `사유: ${item.reason}` }) : null),
          approve);
        approve.addEventListener('click', () => run(entry, [approve], async () => {
          const base = item.kind === 'leave' ? 'leave-requests' : 'weekly-reports';
          await api(`/api/${base}/${item.id}/approve`, { method: 'POST', body: { approverId: userId } });
          approve.textContent = '승인됨';
          return `${item.userName} 님의 ${item.kind === 'leave' ? '연차' : '주간보고'}를 승인했어요.`;
        }));
        list.append(entry);
      }
      list.append(h('div', { className: 'cb-note', text: '반려는 의견이 필요해서 승인 메뉴에서 해 주세요.' }));
      anchor.append(list);
      scrollDown();
    }
  }
})();
