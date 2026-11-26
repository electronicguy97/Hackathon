// 우측 하단 업무 챗봇
// - 서버 /api/chat 이 문장을 해석해 답장과 "제안 동작"을 돌려준다.
// - 실제 신청·저장·승인은 카드의 확인 버튼을 눌렀을 때 기존 API 로 실행한다.
// - 실행 뒤에는 hashchange 를 발생시켜 현재 화면(app.js)을 새로 그린다.
(() => {
  'use strict';

  const TYPE_LABEL = { annual: '연차', half_am: '오전 반차', half_pm: '오후 반차' };
  const SUGGESTIONS = ['오늘 요약', '다음 주 월화 연차 쓸게요', '출근', '주간보고: AICC 유지보수 16시간 로그 분석, 해커톤 8시간 챗봇 구현 / 차주 계획: 발표 준비'];
  const MANAGER_SUGGESTIONS = ['오늘 요약', '결재 대기 보여줘'];

  // ---------- 공통 ----------

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child != null) node.append(child);
    }
    return node;
  }

  async function api(url, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('서버에 연결할 수 없어요.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `요청에 실패했어요. (HTTP ${res.status})`);
    return data;
  }

  const userSelect = () => document.getElementById('user-select');
  const currentUserId = () => Number(userSelect()?.value) || null;
  const currentUserLabel = () => userSelect()?.selectedOptions?.[0]?.textContent ?? '';
  const refreshPage = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  // ---------- 화면 뼈대 ----------

  const fab = h('button', { type: 'button', className: 'cb-fab', 'aria-label': '업무 도우미 열기' });
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

  const log = h('div', { className: 'cb-log', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', {
    className: 'cb-input', rows: '1', maxlength: '500',
    placeholder: '예: 다음 주 월화 연차 쓸게요', 'aria-label': '메시지 입력'
  });
  const sendBtn = h('button', { type: 'submit', className: 'cb-send', text: '보내기' });
  const form = h('form', { className: 'cb-form' }, input, sendBtn);
  const closeBtn = h('button', { type: 'button', className: 'cb-close', 'aria-label': '닫기', text: '×' });
  const panel = h('section', { className: 'cb-panel', 'aria-label': '업무 도우미', hidden: '' },
    h('header', { className: 'cb-header' },
      h('div', {},
        h('strong', { text: '업무 도우미' }),
        h('span', { className: 'cb-sub', text: '연차 · 주간보고 · 출퇴근 · 결재' })),
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
      list.map((text) => h('button', { type: 'button', className: 'cb-chip', text, onclick: () => send(text) })));
  }

  let usersCache = null;
  async function greet() {
    const name = currentUserLabel().replace(/\s*\(.*\)$/, '');
    let isManager = false;
    try {
      usersCache ??= await api('/api/users');
      isManager = usersCache.find((u) => u.id === currentUserId())?.role === 'manager';
    } catch {
      // 역할을 못 불러와도 인사는 한다
    }
    say('bot', `${name || ''} 님, 무엇을 도와드릴까요?\n연차 신청, 주간보고 작성, 출퇴근, 결재를 말로 처리할 수 있어요.`,
      chips(isManager ? MANAGER_SUGGESTIONS : SUGGESTIONS));
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
    const typing = say('bot', '생각 중…');
    typing.classList.add('is-typing');

    try {
      const res = await api('/api/chat', { method: 'POST', body: { userId, text } });
      typing.remove();
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

  // ---------- 제안 동작 ----------

  async function run(card, buttons, task) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const doneText = await task();
      card.classList.add('is-done');
      say('bot', doneText);
      refreshPage();
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

    if (action.kind === 'navigate') {
      const go = () => { window.location.hash = `#/${action.route}`; };
      if (action.auto) {
        go();
      } else {
        anchor.append(h('div', { className: 'cb-actions' },
          h('button', { type: 'button', className: 'cb-btn', text: `${action.label} 화면 열기`, onclick: go })));
        scrollDown();
      }
      return;
    }

    if (action.kind === 'check_in' || action.kind === 'check_out') {
      const isIn = action.kind === 'check_in';
      try {
        const rec = await api(`/api/attendance/${isIn ? 'check-in' : 'check-out'}`, { method: 'POST', body: { userId } });
        say('bot', isIn
          ? `${rec.checkIn ?? ''} 출근 완료${rec.late ? ' (09:00 이후라 지각으로 기록됐어요)' : ''}.`
          : `${rec.checkOut ?? ''} 퇴근 완료.`);
        refreshPage();
      } catch (err) {
        say('bot', err.message).classList.add('is-error');
      }
      return;
    }

    if (action.kind === 'leave') {
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
              method: 'POST', body: { type: p.type, startDate: p.startDate, endDate: p.endDate, avoid: p.reason }
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
      const p = action.payload;
      const total = p.items.reduce((sum, it) => sum + it.hours, 0);
      const card = h('div', { className: 'cb-card' },
        h('div', { className: 'cb-label', text: `업무 (총 ${total}시간)` }),
        h('ul', { className: 'cb-items' },
          p.items.map((it) => h('li', {},
            h('strong', { text: it.project }),
            h('span', { text: ` ${it.hours}시간` }),
            it.content ? h('div', { className: 'cb-muted', text: it.content }) : null))),
        p.nextPlan ? row('차주 계획', p.nextPlan) : null,
        p.issues ? row('이슈', p.issues) : null);

      const draft = h('button', { type: 'button', className: 'cb-btn', text: '임시저장' });
      const submit = h('button', { type: 'button', className: 'cb-btn cb-primary', text: '제출' });
      const cancel = h('button', { type: 'button', className: 'cb-btn', text: '취소' });
      const buttons = [submit, draft, cancel];
      if (!action.canSubmit) submit.disabled = true;

      const save = (isSubmit) => run(card, buttons, async () => {
        await api('/api/weekly-reports', { method: 'PUT', body: { userId, ...p, submit: isSubmit } });
        return isSubmit ? '주간보고를 제출했어요. 팀장 결재를 기다리고 있어요.' : '임시저장했어요. 주간보고 메뉴에서 이어서 수정할 수 있어요.';
      });
      submit.addEventListener('click', () => save(true));
      draft.addEventListener('click', () => save(false));
      cancel.addEventListener('click', () => {
        buttons.forEach((b) => { b.disabled = true; });
        card.classList.add('is-done');
        say('bot', '저장하지 않았어요.');
      });

      card.append(h('div', { className: 'cb-actions' }, buttons));
      anchor.append(card);
      scrollDown();
      return;
    }

    if (action.kind === 'approvals') {
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
