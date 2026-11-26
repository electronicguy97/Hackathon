(() => {
  'use strict';

  const STORAGE_KEY = 'groupware.selectedUserId';
  const ALL_ROUTES = ['home', 'attendance', 'weekly', 'leave', 'approvals', 'rooms'];
  const EXEC_ROUTES = ['home', 'weekly', 'rooms'];

  const DAYS = [
    { key: 'mon', label: '월' },
    { key: 'tue', label: '화' },
    { key: 'wed', label: '수' },
    { key: 'thu', label: '목' },
    { key: 'fri', label: '금' },
  ];

  const WORK_TYPES = ['회사', '재택', '출장', '외근', '휴가'];

  const LEAVE_TYPE_LABELS = {
    annual: '연차',
    half_am: '오전 반차',
    half_pm: '오후 반차',
  };

  const LEAVE_SHORT_LABELS = {
    annual: '연차',
    half_am: '오전',
    half_pm: '오후',
  };

  const STATUS_META = {
    none: { label: '미작성', className: 'badge badge-none' },
    working: { label: '근무 중', className: 'badge badge-working' },
    done: { label: '퇴근 완료', className: 'badge badge-done' },
    pending: { label: '대기', className: 'badge badge-pending' },
    draft: { label: '임시저장', className: 'badge badge-draft' },
    submitted: { label: '제출됨', className: 'badge badge-submitted' },
    approved: { label: '승인', className: 'badge badge-approved' },
    rejected: { label: '반려', className: 'badge badge-rejected' },
    cancelled: { label: '취소', className: 'badge badge-cancelled' },
  };

  const ATTENDANCE_STATUS_LABELS = {
    none: '미출근',
    working: '근무 중',
    done: '퇴근 완료',
  };

  const ROLE_META = {
    employee: { label: '구성원', className: 'role-badge role-badge-employee' },
    manager: { label: '팀장', className: 'role-badge role-badge-manager' },
    executive: { label: '임원', className: 'role-badge role-badge-executive' },
  };

  const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  const state = {
    users: [],
    currentUser: null,
    route: 'home',
    routeSeq: 0,
    attendanceMonth: '',
    leaveCalendarMonth: '',
    approvalsTab: 'pending',
    employeeWeekStart: '',
    managerWeekStart: '',
    execWeekStart: '',
    execSelectedTeam: null,
    roomsDate: '',
    toastTimer: null,
  };

  const dom = {
    userSelect: document.getElementById('user-select'),
    roleBadge: document.getElementById('role-badge'),
    navLinks: Array.from(document.querySelectorAll('.sidebar-link[data-route]')),
    navApprovalsBadge: document.getElementById('nav-approvals-badge'),
    globalError: document.getElementById('global-error'),
    globalErrorText: document.getElementById('global-error-text'),
    globalRetryBtn: document.getElementById('global-retry-btn'),
    routeView: document.getElementById('route-view'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modalDialog: document.getElementById('modal-dialog'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    toastCloseBtn: document.getElementById('toast-close-btn'),
  };

  /* ---------- Utilities ---------- */

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') {
        node.className = value;
      } else if (key === 'textContent') {
        node.textContent = value;
      } else if (key === 'checked' || key === 'disabled' || key === 'readOnly') {
        node[key] = Boolean(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === undefined || child === null || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function setVisible(element, visible) {
    element.hidden = !visible;
    element.classList.toggle('is-hidden', !visible);
  }

  function readStoredUserId() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function writeStoredUserId(userId) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(userId));
    } catch (_) {
      // Ignore storage failures in restricted contexts.
    }
  }

  function getLocalTodayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getLocalMonthISO() {
    return getLocalTodayISO().slice(0, 7);
  }

  function parseDateUTC(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcMs = Date.UTC(y, m - 1, d);
    const dt = new Date(utcMs);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return utcMs;
  }

  function shiftDateISO(dateStr, deltaDays) {
    const ms = parseDateUTC(dateStr);
    if (ms === null) return dateStr;
    const dt = new Date(ms + deltaDays * 86400000);
    return dt.toISOString().slice(0, 10);
  }

  function getMondayISO(dateStr) {
    const ms = parseDateUTC(dateStr);
    if (ms === null) return dateStr;
    const dow = new Date(ms).getUTCDay();
    const offset = -((dow + 6) % 7);
    return shiftDateISO(dateStr, offset);
  }

  function formatWeekLabel(weekStart) {
    const monMs = parseDateUTC(weekStart);
    if (monMs === null) return weekStart || '-';
    const thurs = new Date(monMs + 3 * 86400000);
    const fri = new Date(monMs + 4 * 86400000);
    const mon = new Date(monMs);
    const thursMonth = thurs.getUTCMonth() + 1;
    const thursWeek = Math.ceil(thurs.getUTCDate() / 7);
    const mmdd = (dt) => `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`;
    return `${thursMonth}월 ${thursWeek}주차(${mmdd(mon)} ~ ${mmdd(fri)})`;
  }

  function formatDays(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `${Math.round(num * 10) / 10}일`;
  }

  function formatHours(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0시간';
    return `${Math.round(num * 10) / 10}시간`;
  }

  function formatMinutes(minutes) {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return '0분';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h === 0) return `${m}분`;
    if (m === 0) return `${h}시간`;
    return `${h}시간 ${m}분`;
  }

  function formatPeriod(startDate, endDate) {
    if (!startDate) return '-';
    if (!endDate || startDate === endDate) return startDate;
    return `${startDate} ~ ${endDate}`;
  }

  function formatIsoDate(isoStr) {
    if (!isoStr) return '-';
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 10);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatWorkDateWithDay(dateStr) {
    const utcMs = parseDateUTC(dateStr);
    if (utcMs === null) return dateStr || '-';
    return `${dateStr} (${WEEKDAY_NAMES[new Date(utcMs).getUTCDay()]})`;
  }

  function makeBadge(text, className) {
    return el('span', { className, textContent: text });
  }

  function makeStatusBadge(status, customLabel) {
    const meta = STATUS_META[status] || { label: status || '-', className: 'badge badge-neutral' };
    return makeBadge(customLabel || meta.label, meta.className);
  }

  function calculatePreviewDays(type, startDateStr, endDateStr) {
    const startMs = parseDateUTC(startDateStr);
    if (type === 'half_am' || type === 'half_pm') {
      if (startMs === null) return { valid: false, text: '시작일을 선택하세요' };
      const dow = new Date(startMs).getUTCDay();
      if (dow === 0 || dow === 6) return { valid: false, text: '0일 (주말 선택 불가)' };
      return { valid: true, text: '0.5일 (반차)' };
    }
    if (startMs === null) return { valid: false, text: '시작일을 선택하세요' };
    const endMs = parseDateUTC(endDateStr);
    if (endMs === null) return { valid: false, text: '종료일을 선택하세요' };
    if (endMs < startMs) return { valid: false, text: '종료일이 시작일보다 빠릅니다' };

    let total = 0;
    let weekdays = 0;
    for (let cur = startMs; cur <= endMs; cur += 86400000) {
      total += 1;
      const dow = new Date(cur).getUTCDay();
      if (dow !== 0 && dow !== 6) weekdays += 1;
    }
    if (weekdays === 0) return { valid: false, text: '0일 (주말만 포함됨)' };
    if (total > weekdays) return { valid: true, text: `${weekdays}일 (주말 제외)` };
    return { valid: true, text: `${weekdays}일` };
  }

  function buildWeekNav(weekStart, weekLabel, onChange) {
    const currentWeekStart = getMondayISO(getLocalTodayISO());
    return el('div', { className: 'week-nav' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '< 이전 주',
        onClick: () => onChange(shiftDateISO(weekStart, -7)),
      }),
      el('span', { className: 'week-nav-label', textContent: weekLabel || formatWeekLabel(weekStart) }),
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '다음 주 >',
        onClick: () => onChange(shiftDateISO(weekStart, 7)),
      }),
      weekStart !== currentWeekStart
        ? el('button', {
          type: 'button',
          className: 'btn btn-sm btn-outline',
          textContent: '이번 주',
          onClick: () => onChange(currentWeekStart),
        })
        : null,
    ]);
  }

  /* ---------- API & Feedback ---------- */

  async function apiFetch(url, options = {}) {
    const fetchOptions = {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    };

    let response;
    try {
      response = await window.fetch(url, fetchOptions);
    } catch (_) {
      throw new Error('서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');
    }

    const rawText = await response.text();
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch (_) {
        payload = null;
      }
    }

    if (!response.ok) {
      const msg =
        payload && typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : `요청 처리에 실패했습니다. (HTTP ${response.status})`;
      const err = new Error(msg);
      err.status = response.status;
      throw err;
    }

    return payload;
  }

  function showToast(message) {
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    dom.toastText.textContent = message;
    setVisible(dom.toast, true);
    state.toastTimer = window.setTimeout(() => setVisible(dom.toast, false), 3500);
  }

  function showGlobalError(message) {
    dom.globalErrorText.textContent = message || '';
    setVisible(dom.globalError, Boolean(message));
  }

  function setInlineAlert(box, message) {
    box.textContent = message || '';
    setVisible(box, Boolean(message));
  }

  function openModal(title, contentNodes, opts = {}) {
    dom.modalTitle.textContent = title;
    dom.modalDialog.classList.toggle('modal-dialog-wide', Boolean(opts.wide));
    const nodes = Array.isArray(contentNodes) ? contentNodes : [contentNodes];
    dom.modalBody.replaceChildren(...nodes);
    setVisible(dom.modalBackdrop, true);
  }

  function closeModal() {
    setVisible(dom.modalBackdrop, false);
    dom.modalDialog.classList.remove('modal-dialog-wide');
    dom.modalBody.replaceChildren();
  }

  function updateNavApprovalsBadge(count) {
    const isManager = state.currentUser && state.currentUser.role === 'manager';
    const num = Number(count) || 0;
    if (!isManager || num <= 0) {
      dom.navApprovalsBadge.textContent = '0';
      setVisible(dom.navApprovalsBadge, false);
      return;
    }
    dom.navApprovalsBadge.textContent = String(num);
    setVisible(dom.navApprovalsBadge, true);
  }

  async function syncNavBadgeFromServer(seq) {
    if (!state.currentUser || state.currentUser.role !== 'manager') {
      updateNavApprovalsBadge(0);
      return;
    }
    try {
      const home = await apiFetch(`/api/home?userId=${encodeURIComponent(state.currentUser.id)}`);
      if (seq !== undefined && seq !== state.routeSeq) return;
      updateNavApprovalsBadge(home.approvalPendingCount);
    } catch (_) {
      // Ignore background nav badge errors.
    }
  }

  /* ---------- Routing & Header ---------- */

  function allowedRoutesForUser(user) {
    return user && user.role === 'executive' ? EXEC_ROUTES : ALL_ROUTES;
  }

  function parseRouteFromHash() {
    const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
    const allowed = allowedRoutesForUser(state.currentUser);
    return allowed.includes(raw) ? raw : 'home';
  }

  function syncSidebarForUser(user) {
    const allowed = allowedRoutesForUser(user);
    for (const link of dom.navLinks) {
      const route = link.dataset.route;
      const visible = allowed.includes(route);
      setVisible(link, visible);
      const active = visible && route === state.route;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }

  function renderHeaderForUser(user) {
    if (!user) {
      setVisible(dom.roleBadge, false);
      updateNavApprovalsBadge(0);
      syncSidebarForUser(null);
      return;
    }
    const roleInfo = ROLE_META[user.role] || {
      label: user.role,
      className: 'role-badge role-badge-employee',
    };
    dom.roleBadge.textContent = roleInfo.label;
    dom.roleBadge.className = roleInfo.className;
    setVisible(dom.roleBadge, true);
    if (user.role !== 'manager') updateNavApprovalsBadge(0);
    syncSidebarForUser(user);
  }

  function renderLoadingState(text = '데이터를 불러오는 중입니다...') {
    dom.routeView.replaceChildren(el('div', { className: 'card state-box', textContent: text }));
  }

  /* ---------- Notices Modal ---------- */

  function buildNoticeComposeModal(onSuccess) {
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const titleInput = el('input', {
      type: 'text',
      className: 'form-control',
      placeholder: '공지 제목을 입력하세요',
    });
    const bodyInput = el('textarea', {
      className: 'form-control',
      rows: 4,
      placeholder: '공지 내용을 입력하세요',
    });
    const pinnedCheck = el('input', { type: 'checkbox' });
    const submitBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: '공지 등록' });

    const form = el('form', {
      className: 'form-stack',
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        setInlineAlert(errBox, '');
        submitBtn.disabled = true;
        submitBtn.textContent = '등록 중...';
        try {
          await apiFetch('/api/notices', {
            method: 'POST',
            body: JSON.stringify({
              userId: state.currentUser.id,
              title: titleInput.value.trim(),
              body: bodyInput.value.trim(),
              pinned: pinnedCheck.checked,
            }),
          });
          closeModal();
          showToast('공지사항이 등록되었습니다.');
          await onSuccess();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = '공지 등록';
        }
      },
    }, [
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '제목' }),
        titleInput,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '내용' }),
        bodyInput,
      ]),
      el('label', { className: 'checkbox-row' }, [
        pinnedCheck,
        el('span', { textContent: '상단 고정 공지로 등록' }),
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-outline',
          textContent: '취소',
          onClick: closeModal,
        }),
        submitBtn,
      ]),
    ]);

    openModal('공지사항 작성', form);
    titleInput.focus();
  }

  function noticeAttachments(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    return el('div', { className: 'notice-attachments' }, list.map((a) =>
      el('a', { className: 'notice-attachment', href: a.url, target: '_blank', rel: 'noopener' }, ['📎 ', a.name])
    ));
  }

  async function openNoticeDetailModal(targetNoticeId) {
    openModal('공지사항', el('div', { className: 'state-box', textContent: '공지 내용을 불러오는 중입니다...' }));
    try {
      const notices = await apiFetch('/api/notices');
      const list = Array.isArray(notices) ? notices : [];
      if (targetNoticeId != null) {
        const notice = list.find((n) => n.id === targetNoticeId);
        if (!notice) {
          openModal('공지사항', el('div', { className: 'state-box', textContent: '해당 공지를 찾을 수 없습니다.' }));
          return;
        }
        openModal(notice.title, el('div', { className: 'stack-md' }, [
          el('div', { className: 'approval-summary-left' }, [
            notice.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
            el('span', {
              className: 'page-subtitle',
              textContent: `${notice.authorName || '관리자'} · ${formatIsoDate(notice.createdAt)}`,
            }),
          ]),
          el('div', { className: 'notice-full-body', textContent: notice.body || '' }),
          noticeAttachments(notice.attachments),
        ]));
        return;
      }

      if (list.length === 0) {
        openModal('전체 공지사항', el('div', { className: 'state-box', textContent: '등록된 공지사항이 없습니다.' }));
        return;
      }
      openModal('전체 공지사항', el('div', { className: 'stack-md' }, list.map((n) =>
        el('div', { className: 'approval-detail-box' }, [
          el('div', { className: 'approval-summary-left' }, [
            n.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
            el('strong', { textContent: n.title }),
            el('span', {
              className: 'notice-date',
              textContent: `${n.authorName || ''} · ${formatIsoDate(n.createdAt)}`,
            }),
          ]),
          el('div', { className: 'notice-full-body', textContent: n.body || '' }),
          noticeAttachments(n.attachments),
        ])
      )));
    } catch (err) {
      openModal('공지사항 오류', el('div', { className: 'alert alert-error', textContent: err.message }));
    }
  }

  function buildNoticesCard(notices, allowCompose) {
    const list = Array.isArray(notices) ? notices : [];
    return el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '공지사항' }),
        el('div', { className: 'approval-summary-left' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline',
            textContent: '전체 보기',
            onClick: () => openNoticeDetailModal(null),
          }),
          allowCompose
            ? el('button', {
              type: 'button',
              className: 'btn btn-sm btn-primary',
              textContent: '+ 공지 작성',
              onClick: () => buildNoticeComposeModal(() => renderCurrentRoute()),
            })
            : null,
        ]),
      ]),
      list.length === 0
        ? el('div', { className: 'state-box', textContent: '등록된 공지사항이 없습니다.' })
        : el('ul', { className: 'list-clean' }, list.map((n) =>
          el('li', {}, [
            el('button', {
              type: 'button',
              className: 'list-item-row notice-btn-item',
              onClick: () => openNoticeDetailModal(n.id),
            }, [
              el('div', { className: 'notice-title-wrap' }, [
                n.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
                el('span', { className: 'notice-title-text', textContent: n.title }),
              ]),
              el('span', { className: 'notice-date', textContent: formatIsoDate(n.createdAt) }),
            ]),
          ])
        )),
    ]);
  }

  /* ---------- Screen 1: Home (#/home) ---------- */

  function buildExecutiveTeamCards(teams, onSelectTeam) {
    const list = Array.isArray(teams) ? teams : [];
    if (list.length === 0) {
      return el('div', { className: 'card state-box', textContent: '조회할 팀 주간보고 데이터가 없습니다.' });
    }

    return el('div', { className: 'exec-team-grid' }, list.map((team) => {
      const stats = team.stats || { memberCount: 0, submittedCount: 0, approvedCount: 0, totalHours: 0 };
      const pct = stats.memberCount > 0 ? Math.round((stats.submittedCount / stats.memberCount) * 100) : 0;
      const topProjects = Array.isArray(team.projectHours) ? team.projectHours.slice(0, 3) : [];
      const issuesCount = Array.isArray(team.issues) ? team.issues.length : 0;
      const requestsCount = Array.isArray(team.requests) ? team.requests.length : 0;

      const fill = el('div', { className: 'exec-progress-fill' });
      fill.style.width = `${pct}%`;

      return el('article', { className: 'card card-clickable exec-team-card' }, [
        el('div', { className: 'card-header' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('h3', { className: 'card-title', textContent: team.team }),
            makeBadge(`팀장: ${team.managerName || '-'}`, 'badge badge-neutral'),
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline',
            textContent: '팀 상세 보기 →',
            onClick: () => onSelectTeam(team.team),
          }),
        ]),
        el('div', { className: 'stack-sm' }, [
          el('div', { className: 'bar-label-row' }, [
            el('span', { textContent: `제출률 ${pct}% (${stats.submittedCount}/${stats.memberCount}명 · 승인 ${stats.approvedCount}명)` }),
            el('span', { textContent: `총 ${formatHours(stats.totalHours)}` }),
          ]),
          el('div', { className: 'exec-progress-track' }, [fill]),
        ]),
        el('div', { className: 'exec-chip-row' }, [
          ...(topProjects.length > 0
            ? topProjects.map((p) => makeBadge(`${p.category || '미지정'} ${formatHours(p.hours)}`, 'badge badge-submitted'))
            : [makeBadge('집계된 프로젝트 시간 없음', 'badge badge-none')]),
          makeBadge(`이슈 ${issuesCount}건`, issuesCount > 0 ? 'badge badge-pending' : 'badge badge-neutral'),
          makeBadge(`요청 ${requestsCount}건`, requestsCount > 0 ? 'badge badge-working' : 'badge badge-neutral'),
        ]),
        el('div', {
          className: 'exec-summary-box',
          textContent: team.teamSummary?.summary
            ? `팀장 종합 의견: ${team.teamSummary.summary}`
            : '등록된 팀장 종합 의견이 없습니다.',
        }),
      ]);
    }));
  }

  function buildMyMeetingsCard(reservations) {
    const list = Array.isArray(reservations) ? reservations : [];
    return el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '오늘 내 회의' }),
        el('a', { href: '#/rooms', className: 'card-link', textContent: '회의실 예약 →' }),
      ]),
      list.length === 0
        ? el('div', { className: 'state-box stack-sm' }, [
          el('div', { textContent: '오늘 예정된 회의가 없습니다.' }),
          el('div', {}, [
            el('a', { href: '#/rooms', className: 'btn btn-sm btn-outline', textContent: '회의실 예약하기 →' }),
          ]),
        ])
        : el('ul', { className: 'list-clean' }, list.map((m) =>
          el('li', { className: 'list-item-row' }, [
            el('div', { className: 'approval-summary-left' }, [
              el('span', { className: 'meeting-time-pill', textContent: `${m.startTime}~${m.endTime}` }),
              el('strong', { textContent: m.title }),
            ]),
            makeBadge(m.roomName, 'badge badge-neutral'),
          ])
        )),
    ]);
  }

  async function renderExecutiveHomeRoute(seq) {
    const user = state.currentUser;
    const weekQuery = state.execWeekStart ? `&weekStart=${encodeURIComponent(state.execWeekStart)}` : '';
    const [home, execData] = await Promise.all([
      apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/executive/weekly?executiveId=${encodeURIComponent(user.id)}${weekQuery}`),
    ]);
    if (seq !== state.routeSeq) return;

    state.execWeekStart = execData.weekStart;
    updateNavApprovalsBadge(0);

    const weekNav = buildWeekNav(execData.weekStart, execData.weekLabel, async (nextWeek) => {
      state.execWeekStart = nextWeek;
      await renderCurrentRoute();
    });

    const teamGrid = buildExecutiveTeamCards(execData.teams, (teamName) => {
      state.execSelectedTeam = teamName;
      state.execWeekStart = execData.weekStart;
      window.location.hash = '#/weekly';
    });

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '임원 홈 대시보드' }),
            el('p', { className: 'page-subtitle', textContent: `${home.today} · ${user.name} (${user.team})` }),
          ]),
          weekNav,
        ]),
        el('div', { className: 'stack-md' }, [
          el('div', { className: 'page-header' }, [
            el('h3', { className: 'card-title', textContent: '팀별 주간보고 요약' }),
            el('a', { href: '#/weekly', className: 'card-link', textContent: '주간보고 전체 보기 →' }),
          ]),
          teamGrid,
        ]),
        el('div', { className: 'home-grid' }, [
          buildMyMeetingsCard(home.myReservationsToday),
          buildNoticesCard(home.notices, false),
        ]),
      ])
    );
  }

  async function renderHomeRoute(seq) {
    const user = state.currentUser;
    if (user.role === 'executive') {
      await renderExecutiveHomeRoute(seq);
      return;
    }

    const home = await apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`);
    if (seq !== state.routeSeq) return;

    updateNavApprovalsBadge(home.approvalPendingCount);

    const att = home.attendance || { status: 'none', checkIn: null, checkOut: null, late: false };
    const attErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const attStatusText = ATTENDANCE_STATUS_LABELS[att.status] || att.status;

    const handleHomeAttendance = async (action, btn) => {
      setInlineAlert(attErrBox, '');
      btn.disabled = true;
      try {
        await apiFetch(`/api/attendance/${action}`, {
          method: 'POST',
          body: JSON.stringify({ userId: user.id }),
        });
        showToast(action === 'check-in' ? '출근이 기록되었습니다.' : '퇴근이 기록되었습니다.');
        await renderCurrentRoute();
      } catch (err) {
        setInlineAlert(attErrBox, err.message);
        btn.disabled = false;
      }
    };

    const attActionEl = att.status === 'none'
      ? el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '출근하기',
        onClick: (e) => handleHomeAttendance('check-in', e.currentTarget),
      })
      : att.status === 'working'
        ? el('button', {
          type: 'button',
          className: 'btn btn-approve',
          textContent: '퇴근하기',
          onClick: (e) => handleHomeAttendance('check-out', e.currentTarget),
        })
        : makeBadge('오늘 근무 완료', 'badge badge-done');

    const attCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '오늘 출퇴근' }),
        el('a', { href: '#/attendance', className: 'card-link', textContent: '상세 보기 →' }),
      ]),
      el('div', { className: 'home-att-row' }, [
        el('div', { className: 'approval-summary-left' }, [
          makeStatusBadge(att.status, attStatusText),
          att.status !== 'none'
            ? makeBadge(att.late ? '지각' : '정상 출근', att.late ? 'badge badge-late' : 'badge badge-normal')
            : null,
        ]),
        attActionEl,
      ]),
      el('div', { className: 'home-att-times' }, [
        el('span', {}, ['출근 ', el('strong', { textContent: att.checkIn || '-' })]),
        el('span', {}, ['퇴근 ', el('strong', { textContent: att.checkOut || '-' })]),
      ]),
      attErrBox,
    ]);

    const bal = home.balance || { total: 0, used: 0, pending: 0, remaining: 0 };
    const leaveCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '잔여 연차' }),
        el('a', { href: '#/leave', className: 'card-link', textContent: '신청 · 내역 →' }),
      ]),
      el('div', { className: 'kpi-value kpi-value-primary', textContent: formatDays(bal.remaining) }),
      el('div', {
        className: 'kpi-meta',
        textContent: `대기 ${formatDays(bal.pending)} · 사용 ${formatDays(bal.used)} / 총 ${formatDays(bal.total)}`,
      }),
    ]);

    const isManager = user.role === 'manager';
    const approvalsCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: isManager ? '결재 대기' : '내 결재 현황' }),
        el('a', { href: '#/approvals', className: 'card-link', textContent: '승인 메뉴 →' }),
      ]),
      el('div', {
        className: `kpi-value${isManager && home.approvalPendingCount > 0 ? ' kpi-value-primary' : ''}`,
        textContent: isManager ? `${home.approvalPendingCount}건` : `${home.myPendingCount}건`,
      }),
      el('div', {
        className: 'kpi-meta',
        textContent: isManager
          ? `팀 결재 대기 ${home.approvalPendingCount}건 · 내가 올린 대기 ${home.myPendingCount}건`
          : '내가 올린 연차 · 주간보고 결재 대기 건수',
      }),
    ]);

    const wr = home.weeklyReport || { weekStart: '-', status: 'none' };
    const wrEditable = !isManager && (wr.status === 'none' || wr.status === 'draft' || wr.status === 'rejected');
    const weeklyCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: isManager ? '팀 주간보고 종합' : '이번 주 주간보고' }),
        el('a', {
          href: '#/weekly',
          className: 'card-link',
          textContent: isManager ? '팀 종합 보기 →' : (wrEditable ? '작성하기 →' : '확인하기 →'),
        }),
      ]),
      isManager
        ? el('div', {
          className: 'kpi-meta',
          textContent: `${user.team} 팀원 주간보고 현황 및 팀 종합 의견을 관리합니다.`,
        })
        : el('div', { className: 'stack-sm' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('strong', { textContent: formatWeekLabel(wr.weekStart) }),
            makeStatusBadge(wr.status),
          ]),
          el('div', {
            className: 'kpi-meta',
            textContent: wr.status === 'rejected'
              ? '반려된 보고서입니다. 의견을 확인하고 보완 후 다시 제출하세요.'
              : wr.status === 'none'
                ? '지난주 차주 계획을 바탕으로 이번 주 보고서를 작성하세요.'
                : '주간보고 화면에서 엑셀 양식 전체를 확인할 수 있습니다.',
          }),
        ]),
    ]);

    const absentList = Array.isArray(home.teamOnLeaveToday) ? home.teamOnLeaveToday : [];
    const absentCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '오늘 팀 부재자' }),
        el('a', { href: '#/leave', className: 'card-link', textContent: '팀 캘린더 →' }),
      ]),
      absentList.length === 0
        ? el('div', { className: 'state-box', textContent: '오늘 부재 중인 팀원이 없습니다.' })
        : el('ul', { className: 'list-clean' }, absentList.map((item) =>
          el('li', { className: 'list-item-row' }, [
            el('strong', { textContent: item.userName }),
            makeBadge(LEAVE_TYPE_LABELS[item.type] || item.type, 'badge badge-pending'),
          ])
        )),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '홈 대시보드' }),
            el('p', {
              className: 'page-subtitle',
              textContent: `${home.today} · ${user.name} (${user.team})`,
            }),
          ]),
        ]),
        el('div', { className: 'home-grid' }, [
          attCard,
          leaveCard,
          approvalsCard,
          weeklyCard,
          buildMyMeetingsCard(home.myReservationsToday),
          absentCard,
          buildNoticesCard(home.notices, isManager),
        ]),
      ])
    );
  }

  /* ---------- Screen 2: Attendance (#/attendance) ---------- */

  async function renderAttendanceRoute(seq) {
    const user = state.currentUser;
    if (!state.attendanceMonth) state.attendanceMonth = getLocalMonthISO();
    const isManager = user.role === 'manager';

    const [home, monthly, teamRows] = await Promise.all([
      apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/attendance?userId=${encodeURIComponent(user.id)}&month=${encodeURIComponent(state.attendanceMonth)}`),
      isManager
        ? apiFetch(`/api/attendance/team?managerId=${encodeURIComponent(user.id)}`)
        : Promise.resolve([]),
    ]);
    if (seq !== state.routeSeq) return;

    updateNavApprovalsBadge(home.approvalPendingCount);

    const att = home.attendance || { status: 'none', checkIn: null, checkOut: null, late: false };
    const todayErr = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    const doAttendance = async (action, btn) => {
      setInlineAlert(todayErr, '');
      btn.disabled = true;
      try {
        await apiFetch(`/api/attendance/${action}`, {
          method: 'POST',
          body: JSON.stringify({ userId: user.id }),
        });
        showToast(action === 'check-in' ? '출근이 기록되었습니다.' : '퇴근이 기록되었습니다.');
        await renderCurrentRoute();
      } catch (err) {
        setInlineAlert(todayErr, err.message);
        btn.disabled = false;
      }
    };

    const todayAction = att.status === 'none'
      ? el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '출근하기',
        onClick: (e) => doAttendance('check-in', e.currentTarget),
      })
      : att.status === 'working'
        ? el('button', {
          type: 'button',
          className: 'btn btn-approve',
          textContent: '퇴근하기',
          onClick: (e) => doAttendance('check-out', e.currentTarget),
        })
        : makeBadge('오늘 근무 완료', 'badge badge-done');

    const todayCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: `오늘 출퇴근 (${home.today})` }),
        el('span', { className: 'page-subtitle', textContent: '지각 기준 09:00' }),
      ]),
      el('div', { className: 'home-att-row' }, [
        el('div', { className: 'approval-summary-left' }, [
          makeStatusBadge(att.status, ATTENDANCE_STATUS_LABELS[att.status] || att.status),
          att.status !== 'none'
            ? makeBadge(att.late ? '지각' : '정상 출근', att.late ? 'badge badge-late' : 'badge badge-normal')
            : null,
          el('span', { className: 'page-subtitle', textContent: `출근: ${att.checkIn || '-'} / 퇴근: ${att.checkOut || '-'}` }),
        ]),
        todayAction,
      ]),
      todayErr,
    ]);

    const teamCard = isManager
      ? el('section', { className: 'card' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: `오늘 팀 근태 현황 (${user.team})` }),
          makeBadge(`${teamRows.length}명`, 'badge badge-neutral'),
        ]),
        teamRows.length === 0
          ? el('div', { className: 'state-box', textContent: '팀원 근태 정보가 없습니다.' })
          : el('div', { className: 'table-wrap' }, [
            el('table', { className: 'data-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { scope: 'col', textContent: '이름' }),
                  el('th', { scope: 'col', textContent: '상태' }),
                  el('th', { scope: 'col', textContent: '출근 시각' }),
                  el('th', { scope: 'col', textContent: '퇴근 시각' }),
                  el('th', { scope: 'col', textContent: '지각 여부' }),
                ]),
              ]),
              el('tbody', {}, teamRows.map((m) => {
                const leaveLabel = typeof m.onLeave === 'string'
                  ? (LEAVE_TYPE_LABELS[m.onLeave] || '휴가')
                  : '휴가';
                return el('tr', {}, [
                  el('td', {}, [el('strong', { textContent: m.userName })]),
                  el('td', {}, [
                    el('div', { className: 'approval-summary-left' }, [
                      makeStatusBadge(m.status, ATTENDANCE_STATUS_LABELS[m.status] || m.status),
                      m.onLeave ? makeBadge(`휴가 (${leaveLabel})`, 'badge badge-pending') : null,
                    ]),
                  ]),
                  el('td', { textContent: m.checkIn || '-' }),
                  el('td', { textContent: m.checkOut || '-' }),
                  el('td', {}, [
                    m.status === 'none'
                      ? el('span', { textContent: '-' })
                      : makeBadge(m.late ? '지각' : '정상', m.late ? 'badge badge-late' : 'badge badge-normal'),
                  ]),
                ]);
              })),
            ]),
          ]),
      ])
      : null;

    const summary = monthly.summary || { days: 0, totalMinutes: 0, lateCount: 0 };
    const records = Array.isArray(monthly.records) ? monthly.records : [];

    const monthInput = el('input', {
      type: 'month',
      className: 'form-control',
      value: state.attendanceMonth,
      'aria-label': '조회 월 선택',
      onChange: async (e) => {
        if (!e.target.value) return;
        state.attendanceMonth = e.target.value;
        await renderCurrentRoute();
      },
    });
    monthInput.style.width = 'auto';

    const monthlyCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '월별 근태 기록 및 합계' }),
        monthInput,
      ]),
      el('div', { className: 'stats-grid-3' }, [
        el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-label', textContent: '출근 일수' }),
          el('div', { className: 'stat-value', textContent: `${summary.days}일` }),
        ]),
        el('div', { className: 'stat-card stat-card-primary' }, [
          el('div', { className: 'stat-label', textContent: '총 근무 시간' }),
          el('div', { className: 'stat-value', textContent: formatMinutes(summary.totalMinutes) }),
        ]),
        el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-label', textContent: '지각 횟수' }),
          el('div', { className: 'stat-value', textContent: `${summary.lateCount}회` }),
        ]),
      ]),
      records.length === 0
        ? el('div', { className: 'state-box', textContent: '선택한 월의 출퇴근 기록이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col', textContent: '근무일' }),
                el('th', { scope: 'col', textContent: '출근 시각' }),
                el('th', { scope: 'col', textContent: '퇴근 시각' }),
                el('th', { scope: 'col', textContent: '근무 시간' }),
                el('th', { scope: 'col', textContent: '지각' }),
              ]),
            ]),
            el('tbody', {}, records.map((rec) =>
              el('tr', {}, [
                el('td', { textContent: formatWorkDateWithDay(rec.workDate) }),
                el('td', { textContent: rec.checkIn || '-' }),
                el('td', { textContent: rec.checkOut || '-' }),
                el('td', { textContent: rec.checkOut ? formatMinutes(rec.workMinutes) : '-' }),
                el('td', {}, [
                  makeBadge(rec.late ? '지각' : '정상', rec.late ? 'badge badge-late' : 'badge badge-normal'),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '출퇴근 관리' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team}` }),
          ]),
        ]),
        todayCard,
        teamCard,
        monthlyCard,
      ])
    );
  }

  /* ---------- Screen 3: Weekly Report (Excel Form Component) ---------- */

  function cloneWeekPart(part) {
    const src = part || {};
    return {
      personalSchedule: typeof src.personalSchedule === 'string' ? src.personalSchedule : '',
      issues: typeof src.issues === 'string' ? src.issues : '',
      requests: typeof src.requests === 'string' ? src.requests : '',
      entries: Array.isArray(src.entries)
        ? src.entries.map((e) => ({
          day: DAYS.some((d) => d.key === e.day) ? e.day : 'mon',
          category: typeof e.category === 'string' ? e.category : '',
          workType: WORK_TYPES.includes(e.workType) ? e.workType : '회사',
          content: typeof e.content === 'string' ? e.content : '',
          hours: e.hours !== undefined && e.hours !== null ? String(e.hours) : '',
        }))
        : [],
    };
  }

  function sumEntriesHours(entries, dayKey = null) {
    return entries.reduce((sum, e) => {
      if (dayKey && e.day !== dayKey) return sum;
      const num = Number(e.hours);
      return sum + (Number.isFinite(num) && num > 0 ? num : 0);
    }, 0);
  }

  function serializeWeekPart(part) {
    const entries = [];
    for (const e of part.entries) {
      const category = e.category.trim();
      const content = e.content.trim();
      const rawHours = String(e.hours ?? '').trim();
      if (!category && !content && !rawHours) continue;
      entries.push({
        day: e.day,
        category,
        workType: e.workType,
        content,
        hours: rawHours === '' ? 0 : Number(rawHours),
      });
    }
    return {
      personalSchedule: part.personalSchedule.trim(),
      issues: part.issues.trim(),
      requests: part.requests.trim(),
      entries,
    };
  }

  function buildExcelWeeklyForm(report, { editable = false, onSaveSuccess = null } = {}) {
    const draft = {
      current: cloneWeekPart(report.current),
      next: cloneWeekPart(report.next),
    };
    const weekStart = report.weekStart;
    const curLabel = report.weekLabel || formatWeekLabel(weekStart);
    const nextLabel = report.nextWeekLabel || formatWeekLabel(shiftDateISO(weekStart, 7));

    let activeMobileSide = 'current';
    const narrowMq = window.matchMedia('(max-width: 1100px)');

    const container = el('div', { className: 'stack-md' });
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const tableWrap = el('div', { className: 'excel-table-wrap' });
    const table = el('table', { className: 'excel-table' });
    tableWrap.appendChild(table);

    const curTotalSpan = el('span', { textContent: formatHours(sumEntriesHours(draft.current.entries)) });
    const nextTotalSpan = el('span', { textContent: formatHours(sumEntriesHours(draft.next.entries)) });
    const dayHourSpans = { current: {}, next: {}, merged: {} };
    DAYS.forEach((d) => {
      dayHourSpans.current[d.key] = el('span');
      dayHourSpans.next[d.key] = el('span');
      dayHourSpans.merged[d.key] = el('div', { className: 'excel-day-hours' });
    });

    const refreshAllTotals = () => {
      const curTotal = sumEntriesHours(draft.current.entries);
      const nextTotal = sumEntriesHours(draft.next.entries);
      curTotalSpan.textContent = formatHours(curTotal);
      nextTotalSpan.textContent = formatHours(nextTotal);
      DAYS.forEach((d) => {
        const cH = sumEntriesHours(draft.current.entries, d.key);
        const nH = sumEntriesHours(draft.next.entries, d.key);
        dayHourSpans.current[d.key].textContent = `일 합계 ${formatHours(cH)}`;
        dayHourSpans.next[d.key].textContent = `일 합계 ${formatHours(nH)}`;
        dayHourSpans.merged[d.key].textContent = `${cH}h / ${nH}h`;
      });
    };

    const tabCurBtn = el('button', { type: 'button', className: 'subtab-btn is-active', textContent: `금주 실적 (${curLabel})` });
    const tabNextBtn = el('button', { type: 'button', className: 'subtab-btn', textContent: `차주 계획 (${nextLabel})` });
    const mobileTabs = el('div', { className: 'subtabs excel-mobile-tabs' }, [tabCurBtn, tabNextBtn]);

    const renderEntryCells = (sideKey, entry) => {
      if (!editable) {
        return [
          el('td', {}, [el('div', { className: 'excel-readonly-text', textContent: entry.category || '-' })]),
          el('td', { style: 'text-align:center;' }, [makeBadge(entry.workType || '-', 'badge badge-neutral')]),
          el('td', {}, [el('div', { className: 'excel-readonly-text', textContent: entry.content || '-' })]),
          el('td', { style: 'text-align:right;font-weight:700;' }, [formatHours(entry.hours)]),
        ];
      }

      const catInput = el('input', {
        type: 'text',
        className: 'excel-input',
        placeholder: '프로젝트명',
        value: entry.category,
        onInput: (e) => { entry.category = e.target.value; },
      });

      const typeSelect = el('select', {
        className: 'excel-input',
        onChange: (e) => { entry.workType = e.target.value; },
      }, WORK_TYPES.map((wt) => el('option', { value: wt, textContent: wt })));
      typeSelect.value = entry.workType;

      const contentArea = el('textarea', {
        className: 'excel-input excel-textarea',
        rows: 2,
        placeholder: '업무 내용 (여러 줄 입력 가능)',
        onInput: (e) => { entry.content = e.target.value; },
      });
      contentArea.value = entry.content;

      const hoursInput = el('input', {
        type: 'number',
        className: 'excel-input excel-hours-input',
        min: '0.5',
        max: '24',
        step: '0.5',
        placeholder: '0',
        value: entry.hours,
        onInput: (e) => {
          entry.hours = e.target.value;
          refreshAllTotals();
        },
      });

      const delBtn = el('button', {
        type: 'button',
        className: 'excel-del-btn',
        title: '행 삭제',
        textContent: '×',
        onClick: () => {
          const list = draft[sideKey].entries;
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
          renderTable();
        },
      });

      return [
        el('td', {}, [catInput]),
        el('td', {}, [typeSelect]),
        el('td', {}, [contentArea]),
        el('td', {}, [el('div', { className: 'excel-hours-wrap' }, [hoursInput, delBtn])]),
      ];
    };

    const renderMetaCells = (sideKey, fieldKey, placeholder) => {
      if (!editable) {
        return el('td', { colspan: '4' }, [
          el('div', { className: 'excel-readonly-text', textContent: draft[sideKey][fieldKey] || '-' }),
        ]);
      }
      const area = el('textarea', {
        className: 'excel-input excel-textarea',
        rows: 2,
        placeholder,
        onInput: (e) => { draft[sideKey][fieldKey] = e.target.value; },
      });
      area.value = draft[sideKey][fieldKey];
      return el('td', { colspan: '4' }, [area]);
    };

    const renderTable = () => {
      const isNarrow = narrowMq.matches;
      const showCur = !isNarrow || activeMobileSide === 'current';
      const showNext = !isNarrow || activeMobileSide === 'next';

      table.classList.toggle('is-narrow-mode', isNarrow);
      tabCurBtn.classList.toggle('is-active', activeMobileSide === 'current');
      tabNextBtn.classList.toggle('is-active', activeMobileSide === 'next');

      const colgroup = el('colgroup', {}, [
        el('col', { style: 'width: 64px;' }),
        ...(showCur ? [
          el('col', { style: 'width: 112px;' }),
          el('col', { style: 'width: 82px;' }),
          el('col'),
          el('col', { style: 'width: 102px;' }),
        ] : []),
        ...(showNext ? [
          el('col', { style: 'width: 112px;' }),
          el('col', { style: 'width: 82px;' }),
          el('col'),
          el('col', { style: 'width: 102px;' }),
        ] : []),
      ]);

      const thead = el('thead', {}, [
        el('tr', {}, [
          el('th', { rowspan: '2', className: 'excel-corner-head', textContent: '구분' }),
          showCur ? el('th', { colspan: '4', className: 'excel-top-week-cur', textContent: `금주 실적 · ${curLabel}` }) : null,
          showNext ? el('th', { colspan: '4', className: 'excel-top-week-next', textContent: `차주 계획 · ${nextLabel}` }) : null,
        ]),
        el('tr', {}, [
          ...(showCur ? [
            el('th', { className: 'excel-col-head', textContent: '구분' }),
            el('th', { className: 'excel-col-head', textContent: '형태' }),
            el('th', { className: 'excel-col-head', textContent: '진행 계획(내용)' }),
            el('th', { className: 'excel-col-head', textContent: '예상 소요시간' }),
          ] : []),
          ...(showNext ? [
            el('th', { className: 'excel-col-head', textContent: '구분' }),
            el('th', { className: 'excel-col-head', textContent: '형태' }),
            el('th', { className: 'excel-col-head', textContent: '진행 계획' }),
            el('th', { className: 'excel-col-head', textContent: '예상 소요시간' }),
          ] : []),
        ]),
      ]);

      const tbody = el('tbody');

      const metaRows = [
        ['personalSchedule', '개인일정', '휴가·외출·개인일정 (없으면 없음 또는 비움)'],
        ['issues', '이슈사항', '업무 이슈나 지연 사항을 입력하세요'],
        ['requests', '요청/전달', '팀장·팀원에게 요청 또는 전달할 사항'],
      ];
      for (const [key, label, ph] of metaRows) {
        tbody.appendChild(el('tr', {}, [
          el('th', { scope: 'row', className: 'excel-meta-label', textContent: label }),
          showCur ? renderMetaCells('current', key, ph) : null,
          showNext ? renderMetaCells('next', key, ph) : null,
        ]));
      }

      for (const d of DAYS) {
        const curList = draft.current.entries.filter((e) => e.day === d.key);
        const nextList = draft.next.entries.filter((e) => e.day === d.key);
        const dataRows = Math.max(showCur ? curList.length : 0, showNext ? nextList.length : 0, 1);
        const totalDayRows = dataRows + (editable ? 1 : 0);

        for (let i = 0; i < dataRows; i++) {
          const tr = el('tr');
          if (i === 0) {
            tr.appendChild(el('th', {
              scope: 'rowgroup',
              rowspan: String(totalDayRows),
              className: 'excel-day-cell',
            }, [
              el('div', { className: 'excel-day-name', textContent: d.label }),
              dayHourSpans.merged[d.key],
            ]));
          }

          if (showCur) {
            if (i < curList.length) {
              renderEntryCells('current', curList[i]).forEach((td) => tr.appendChild(td));
            } else {
              tr.appendChild(el('td', {
                colspan: '4',
                className: 'excel-filler-cell',
                textContent: i === 0 && curList.length === 0 ? '등록된 항목 없음' : '',
              }));
            }
          }

          if (showNext) {
            if (i < nextList.length) {
              renderEntryCells('next', nextList[i]).forEach((td) => tr.appendChild(td));
            } else {
              tr.appendChild(el('td', {
                colspan: '4',
                className: 'excel-filler-cell',
                textContent: i === 0 && nextList.length === 0 ? '등록된 항목 없음' : '',
              }));
            }
          }

          tbody.appendChild(tr);
        }

        if (editable) {
          const addRowBtn = (sideKey) => el('button', {
            type: 'button',
            className: 'btn btn-xs btn-outline',
            textContent: `+ ${d.label}요일 추가`,
            onClick: () => {
              draft[sideKey].entries.push({
                day: d.key,
                category: '',
                workType: '회사',
                content: '',
                hours: '',
              });
              renderTable();
            },
          });

          tbody.appendChild(el('tr', { className: 'excel-day-footer' }, [
            showCur ? el('td', { colspan: '4' }, [
              el('div', { className: 'excel-day-footer-inner' }, [
                addRowBtn('current'),
                dayHourSpans.current[d.key],
              ]),
            ]) : null,
            showNext ? el('td', { colspan: '4' }, [
              el('div', { className: 'excel-day-footer-inner' }, [
                addRowBtn('next'),
                dayHourSpans.next[d.key],
              ]),
            ]) : null,
          ]));
        }
      }

      tbody.appendChild(el('tr', { className: 'excel-total-row' }, [
        el('th', { scope: 'row', className: 'excel-meta-label', textContent: '합계' }),
        ...(showCur ? [
          el('td', { colspan: '3', textContent: '금주 총 투입 시간' }),
          el('td', { className: 'excel-total-val' }, [curTotalSpan]),
        ] : []),
        ...(showNext ? [
          el('td', { colspan: '3', textContent: '차주 예상 시간' }),
          el('td', { className: 'excel-total-val' }, [nextTotalSpan]),
        ] : []),
      ]));

      table.replaceChildren(colgroup, thead, tbody);
      refreshAllTotals();
    };

    tabCurBtn.addEventListener('click', () => {
      activeMobileSide = 'current';
      renderTable();
    });
    tabNextBtn.addEventListener('click', () => {
      activeMobileSide = 'next';
      renderTable();
    });

    const onMediaChange = () => {
      if (!table.isConnected) {
        narrowMq.removeEventListener('change', onMediaChange);
        return;
      }
      renderTable();
    };
    narrowMq.addEventListener('change', onMediaChange);

    renderTable();
    container.append(mobileTabs, tableWrap, errBox);

    if (editable) {
      const draftBtn = el('button', { type: 'button', className: 'btn btn-outline', textContent: '임시저장' });
      const submitBtn = el('button', { type: 'button', className: 'btn btn-primary', textContent: '제출하기' });

      const save = async (submit) => {
        setInlineAlert(errBox, '');
        draftBtn.disabled = true;
        submitBtn.disabled = true;
        try {
          await apiFetch('/api/weekly-reports', {
            method: 'PUT',
            body: JSON.stringify({
              userId: state.currentUser.id,
              weekStart,
              current: serializeWeekPart(draft.current),
              next: serializeWeekPart(draft.next),
              submit,
            }),
          });
          showToast(submit ? '주간보고가 제출되었습니다.' : '주간보고가 임시저장되었습니다.');
          if (onSaveSuccess) await onSaveSuccess();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          draftBtn.disabled = false;
          submitBtn.disabled = false;
        }
      };

      draftBtn.addEventListener('click', () => save(false));
      submitBtn.addEventListener('click', () => save(true));
      container.appendChild(el('div', { className: 'form-actions' }, [draftBtn, submitBtn]));
    }

    return container;
  }

  /* ---------- Screen 3-A: Employee Weekly (#/weekly) ---------- */

  async function renderEmployeeWeeklyRoute(seq) {
    const user = state.currentUser;
    const [currentTemplate, allReports] = await Promise.all([
      apiFetch(`/api/weekly-reports/current?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/weekly-reports?userId=${encodeURIComponent(user.id)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const reports = Array.isArray(allReports) ? allReports : [];
    const thisWeekStart = currentTemplate.weekStart;
    if (!state.employeeWeekStart) state.employeeWeekStart = thisWeekStart;
    const activeWeek = state.employeeWeekStart;

    let activeReport = null;
    if (activeWeek === thisWeekStart) {
      activeReport = currentTemplate;
    } else {
      activeReport = reports.find((r) => r.weekStart === activeWeek) || null;
    }

    const weekNav = buildWeekNav(
      activeWeek,
      activeReport?.weekLabel || formatWeekLabel(activeWeek),
      async (nextWeek) => {
        state.employeeWeekStart = nextWeek;
        await renderCurrentRoute();
      }
    );

    let mainSection = null;
    if (!activeReport) {
      mainSection = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'state-box', textContent: `${formatWeekLabel(activeWeek)}에 작성된 주간보고가 없습니다.` }),
        el('div', { className: 'form-actions' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            textContent: '이번 주 보고서로 이동',
            onClick: () => {
              state.employeeWeekStart = thisWeekStart;
              renderCurrentRoute();
            },
          }),
        ]),
      ]);
    } else {
      const editable = activeReport.status !== 'submitted' && activeReport.status !== 'approved';
      const prefilledHint = activeReport.status === 'none' && activeReport.current?.entries?.length > 0
        ? el('div', {
          className: 'alert alert-info',
          textContent: '지난주 차주 계획 항목이 금주 실적에 자동으로 채워졌습니다. 실적·차주 계획·이슈를 수정한 뒤 저장 또는 제출하세요.',
        })
        : null;
      const rejectionBanner = activeReport.status === 'rejected'
        ? el('div', {
          className: 'alert alert-warning',
          textContent: `반려 의견 (${activeReport.approverName || '팀장'}): ${activeReport.comment || '보완 후 재제출해 주세요.'}`,
        })
        : null;
      const approvedBanner = activeReport.status === 'approved' && activeReport.comment
        ? el('div', {
          className: 'alert alert-info',
          textContent: `승인 의견 (${activeReport.approverName || '팀장'}): ${activeReport.comment}`,
        })
        : null;
      const lockedBanner = !editable
        ? el('div', {
          className: 'alert alert-info',
          textContent: '제출 또는 승인 완료된 보고서는 읽기 전용입니다.',
        })
        : null;

      mainSection = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('h3', { className: 'card-title', textContent: activeReport.weekLabel || formatWeekLabel(activeReport.weekStart) }),
            makeStatusBadge(activeReport.status),
          ]),
          el('span', {
            className: 'page-subtitle',
            textContent: activeReport.updatedAt ? `최근 저장: ${formatIsoDate(activeReport.updatedAt)}` : '신규 작성',
          }),
        ]),
        prefilledHint,
        rejectionBanner,
        approvedBanner,
        lockedBanner,
        buildExcelWeeklyForm(activeReport, {
          editable,
          onSaveSuccess: () => renderCurrentRoute(),
        }),
      ]);
    }

    const pastCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '지난 주간보고 목록' }),
        makeBadge(`총 ${reports.length}건`, 'badge badge-neutral'),
      ]),
      reports.length === 0
        ? el('div', { className: 'state-box', textContent: '작성된 주간보고 내역이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '주차' }),
                el('th', { textContent: '금주 시간' }),
                el('th', { textContent: '차주 시간' }),
                el('th', { textContent: '상태' }),
                el('th', { textContent: '결재 의견' }),
                el('th', { textContent: '열람' }),
              ]),
            ]),
            el('tbody', {}, reports.map((rep) =>
              el('tr', {}, [
                el('td', {}, [el('strong', { textContent: rep.weekLabel || formatWeekLabel(rep.weekStart) })]),
                el('td', { textContent: formatHours(rep.totalHours) }),
                el('td', { textContent: formatHours(rep.nextTotalHours) }),
                el('td', {}, [makeStatusBadge(rep.status)]),
                el('td', { textContent: rep.comment || '-' }),
                el('td', {}, [
                  el('button', {
                    type: 'button',
                    className: 'btn btn-sm btn-outline',
                    textContent: '양식 보기',
                    onClick: () => openModal(
                      `${rep.userName || user.name} · ${rep.weekLabel || formatWeekLabel(rep.weekStart)}`,
                      buildExcelWeeklyForm(rep, { editable: false }),
                      { wide: true }
                    ),
                  }),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '주간보고' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team}` }),
          ]),
          weekNav,
        ]),
        mainSection,
        pastCard,
      ])
    );
  }

  /* ---------- Screen 3-B & 3-C: Team Roll-up (Manager & Executive Drill-down) ---------- */

  function openMemberReportModal(member, { canDecide, onAfterDecide }) {
    const rep = member.report;
    if (!rep) return;

    const nodes = [
      el('div', { className: 'approval-summary-left' }, [
        makeStatusBadge(rep.status),
        el('span', { className: 'page-subtitle', textContent: `금주 ${formatHours(rep.totalHours)} · 차주 ${formatHours(rep.nextTotalHours)}` }),
        rep.comment ? el('span', { className: 'page-subtitle', textContent: `결재 의견: ${rep.comment}` }) : null,
      ]),
      buildExcelWeeklyForm(rep, { editable: false }),
    ];

    if (canDecide && rep.status === 'submitted') {
      const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
      const commentInput = el('input', {
        type: 'text',
        className: 'form-control approval-comment-input',
        placeholder: '결재 의견 입력 (반려 시 필수)',
      });
      const rejectBtn = el('button', { type: 'button', className: 'btn btn-reject', textContent: '반려' });
      const approveBtn = el('button', { type: 'button', className: 'btn btn-approve', textContent: '승인' });

      const decide = async (action) => {
        setInlineAlert(errBox, '');
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        commentInput.disabled = true;
        try {
          await apiFetch(`/api/weekly-reports/${encodeURIComponent(rep.id)}/${action}`, {
            method: 'POST',
            body: JSON.stringify({
              approverId: state.currentUser.id,
              comment: commentInput.value.trim(),
            }),
          });
          closeModal();
          showToast(action === 'approve' ? '주간보고가 승인되었습니다.' : '주간보고가 반려되었습니다.');
          await onAfterDecide();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          commentInput.disabled = false;
        }
      };

      approveBtn.addEventListener('click', () => decide('approve'));
      rejectBtn.addEventListener('click', () => decide('reject'));

      nodes.push(
        errBox,
        el('div', { className: 'approval-actions-row' }, [commentInput, rejectBtn, approveBtn])
      );
    }

    openModal(
      `${member.userName} · ${rep.weekLabel || formatWeekLabel(rep.weekStart)}`,
      nodes,
      { wide: true }
    );
  }

  function renderTeamRollupContent(teamData, { readOnly, onRefresh }) {
    const stats = teamData.stats || { memberCount: 0, submittedCount: 0, approvedCount: 0, totalHours: 0 };
    const members = Array.isArray(teamData.members) ? teamData.members : [];
    const projectHours = Array.isArray(teamData.projectHours) ? teamData.projectHours : [];
    const issues = Array.isArray(teamData.issues) ? teamData.issues : [];
    const requests = Array.isArray(teamData.requests) ? teamData.requests : [];
    const schedules = Array.isArray(teamData.personalSchedules) ? teamData.personalSchedules : [];

    const statsRow = el('div', { className: readOnly ? 'stats-grid-3' : 'stats-grid-4' }, [
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '대상 팀원' }),
        el('div', { className: 'stat-value', textContent: `${stats.memberCount}명` }),
        el('div', { className: 'stat-hint', textContent: `팀장: ${teamData.managerName || '-'}` }),
      ]),
      el('div', { className: 'stat-card stat-card-primary' }, [
        el('div', { className: 'stat-label', textContent: '제출 · 승인' }),
        el('div', { className: 'stat-value', textContent: `${stats.submittedCount} / ${stats.memberCount}명` }),
        el('div', { className: 'stat-hint', textContent: `승인 완료: ${stats.approvedCount}명` }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '팀 총 투입 시간' }),
        el('div', { className: 'stat-value', textContent: formatHours(stats.totalHours) }),
        el('div', { className: 'stat-hint', textContent: '제출·승인 보고 기준' }),
      ]),
      !readOnly
        ? el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-label', textContent: '결재함 이동' }),
          el('div', { style: 'margin-top:0.55rem;' }, [
            el('a', { href: '#/approvals', className: 'btn btn-sm btn-primary', textContent: '승인 화면 바로가기 →' }),
          ]),
          el('div', { className: 'stat-hint', textContent: '연차·주간보고 통합 결재' }),
        ])
        : null,
    ]);

    const membersCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '팀원 제출 현황' }),
        makeBadge(`${members.length}명`, 'badge badge-neutral'),
      ]),
      members.length === 0
        ? el('div', { className: 'state-box', textContent: '팀원이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '이름' }),
                el('th', { textContent: '상태' }),
                el('th', { textContent: '금주 시간' }),
                el('th', { textContent: '열람' }),
              ]),
            ]),
            el('tbody', {}, members.map((m) =>
              el('tr', {}, [
                el('td', {}, [el('strong', { textContent: m.userName })]),
                el('td', {}, [makeStatusBadge(m.status)]),
                el('td', { textContent: formatHours(m.totalHours) }),
                el('td', {}, [
                  m.report
                    ? el('button', {
                      type: 'button',
                      className: 'btn btn-sm btn-outline',
                      textContent: !readOnly && m.report.status === 'submitted' ? '열람 · 결재' : '보고 열람',
                      onClick: () => openMemberReportModal(m, {
                        canDecide: !readOnly,
                        onAfterDecide: onRefresh,
                      }),
                    })
                    : el('span', {
                      className: 'page-subtitle',
                      textContent: m.status === 'draft' ? '미제출(임시저장)' : '미작성',
                    }),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    const maxProjHours = projectHours.reduce((max, p) => Math.max(max, Number(p.hours) || 0), 0);
    const projectCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '프로젝트별 투입 시간' }),
        el('span', { className: 'page-subtitle', textContent: '제출·승인 실적 기준' }),
      ]),
      projectHours.length === 0
        ? el('div', { className: 'state-box', textContent: '집계된 프로젝트 시간이 없습니다.' })
        : el('div', { className: 'bar-list' }, projectHours.map((p) => {
          const pct = maxProjHours > 0 ? Math.round(((Number(p.hours) || 0) / maxProjHours) * 100) : 0;
          const fill = el('div', { className: 'bar-fill' });
          fill.style.width = `${pct}%`;
          return el('div', { className: 'bar-row' }, [
            el('div', { className: 'bar-label-row' }, [
              el('span', { textContent: p.category || '미지정' }),
              el('span', { textContent: formatHours(p.hours) }),
            ]),
            el('div', { className: 'bar-track' }, [fill]),
          ]);
        })),
    ]);

    const buildQuoteCard = (title, items, emptyMsg) => el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: title }),
        makeBadge(`${items.length}건`, 'badge badge-neutral'),
      ]),
      items.length === 0
        ? el('div', { className: 'state-box', textContent: emptyMsg })
        : el('ul', { className: 'rollup-quote-list' }, items.map((it) =>
          el('li', { className: 'rollup-quote-item' }, [
            el('span', { className: 'rollup-quote-author', textContent: `[${it.userName}]` }),
            el('span', { className: 'rollup-quote-text', textContent: it.text }),
          ])
        )),
    ]);

    const quoteGrid = el('div', { className: 'rollup-grid-3' }, [
      buildQuoteCard('이슈사항 모음', issues, '보고된 이슈사항이 없습니다.'),
      buildQuoteCard('요청 / 전달사항', requests, '요청·전달사항이 없습니다.'),
      buildQuoteCard('개인일정 모음', schedules, '등록된 개인일정이 없습니다.'),
    ]);

    const summaryErr = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const summaryData = teamData.teamSummary;
    let summaryCard = null;
    if (readOnly) {
      summaryCard = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: `팀 종합 의견 (${teamData.managerName || '팀장'})` }),
          summaryData?.updatedAt
            ? el('span', { className: 'page-subtitle', textContent: `수정: ${formatIsoDate(summaryData.updatedAt)}` })
            : null,
        ]),
        el('div', {
          className: 'exec-summary-box',
          textContent: summaryData?.summary || '작성된 팀 종합 의견이 없습니다.',
        }),
      ]);
    } else {
      const summaryInput = el('textarea', {
        className: 'form-control',
        rows: 4,
        placeholder: '이번 주 팀 종합 의견 및 경영진 전달 사항을 작성하세요',
      });
      summaryInput.value = summaryData?.summary || '';
      const saveBtn = el('button', { type: 'button', className: 'btn btn-primary', textContent: '팀 종합 의견 저장' });
      saveBtn.addEventListener('click', async () => {
        setInlineAlert(summaryErr, '');
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
        try {
          await apiFetch('/api/team-summaries', {
            method: 'PUT',
            body: JSON.stringify({
              managerId: state.currentUser.id,
              weekStart: teamData.weekStart,
              summary: summaryInput.value.trim(),
            }),
          });
          showToast('팀 종합 의견이 저장되었습니다.');
          await onRefresh();
        } catch (err) {
          setInlineAlert(summaryErr, err.message);
          saveBtn.disabled = false;
          saveBtn.textContent = '팀 종합 의견 저장';
        }
      });

      summaryCard = el('section', { className: 'card form-stack' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: '팀 종합 의견' }),
          summaryData?.updatedAt
            ? el('span', { className: 'page-subtitle', textContent: `최근 저장: ${formatIsoDate(summaryData.updatedAt)}` })
            : null,
        ]),
        summaryInput,
        summaryErr,
        el('div', { className: 'form-actions' }, [saveBtn]),
      ]);
    }

    return [
      statsRow,
      el('div', { className: 'rollup-grid-2' }, [membersCard, projectCard]),
      quoteGrid,
      summaryCard,
    ];
  }

  async function renderManagerWeeklyRoute(seq) {
    const user = state.currentUser;
    const weekQuery = state.managerWeekStart ? `&weekStart=${encodeURIComponent(state.managerWeekStart)}` : '';
    const [teamData] = await Promise.all([
      apiFetch(`/api/weekly-reports/team?viewerId=${encodeURIComponent(user.id)}${weekQuery}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    state.managerWeekStart = teamData.weekStart;
    const weekNav = buildWeekNav(teamData.weekStart, teamData.weekLabel, async (nextWeek) => {
      state.managerWeekStart = nextWeek;
      await renderCurrentRoute();
    });

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: `주간보고 - 팀 종합 (${teamData.team})` }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} 팀장 · ${teamData.weekLabel}` }),
          ]),
          weekNav,
        ]),
        ...renderTeamRollupContent(teamData, {
          readOnly: false,
          onRefresh: () => renderCurrentRoute(),
        }),
      ])
    );
  }

  async function renderExecutiveWeeklyRoute(seq) {
    const user = state.currentUser;
    updateNavApprovalsBadge(0);

    if (state.execSelectedTeam) {
      const weekQuery = state.execWeekStart ? `&weekStart=${encodeURIComponent(state.execWeekStart)}` : '';
      const teamData = await apiFetch(
        `/api/weekly-reports/team?viewerId=${encodeURIComponent(user.id)}&team=${encodeURIComponent(state.execSelectedTeam)}${weekQuery}`
      );
      if (seq !== state.routeSeq) return;

      state.execWeekStart = teamData.weekStart;
      const weekNav = buildWeekNav(teamData.weekStart, teamData.weekLabel, async (nextWeek) => {
        state.execWeekStart = nextWeek;
        await renderCurrentRoute();
      });

      dom.routeView.replaceChildren(
        el('div', { className: 'stack-lg' }, [
          el('div', { className: 'page-header' }, [
            el('div', { className: 'approval-summary-left' }, [
              el('button', {
                type: 'button',
                className: 'btn btn-sm btn-outline',
                textContent: '← 전체 팀 목록',
                onClick: () => {
                  state.execSelectedTeam = null;
                  renderCurrentRoute();
                },
              }),
              el('div', {}, [
                el('h2', { className: 'page-title', textContent: `${teamData.team} 주간보고 상세` }),
                el('p', { className: 'page-subtitle', textContent: `${teamData.weekLabel} · 읽기 전용` }),
              ]),
            ]),
            weekNav,
          ]),
          ...renderTeamRollupContent(teamData, {
            readOnly: true,
            onRefresh: () => renderCurrentRoute(),
          }),
        ])
      );
      return;
    }

    const weekQuery = state.execWeekStart ? `&weekStart=${encodeURIComponent(state.execWeekStart)}` : '';
    const execData = await apiFetch(
      `/api/executive/weekly?executiveId=${encodeURIComponent(user.id)}${weekQuery}`
    );
    if (seq !== state.routeSeq) return;

    state.execWeekStart = execData.weekStart;
    const weekNav = buildWeekNav(execData.weekStart, execData.weekLabel, async (nextWeek) => {
      state.execWeekStart = nextWeek;
      await renderCurrentRoute();
    });

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '주간보고 - 팀별 현황' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · 전사 팀 요약 비교 (카드를 클릭해 상세 열람)` }),
          ]),
          weekNav,
        ]),
        buildExecutiveTeamCards(execData.teams, (teamName) => {
          state.execSelectedTeam = teamName;
          renderCurrentRoute();
        }),
      ])
    );
  }

  async function renderWeeklyRoute(seq) {
    const role = state.currentUser.role;
    if (role === 'manager') {
      await renderManagerWeeklyRoute(seq);
    } else if (role === 'executive') {
      await renderExecutiveWeeklyRoute(seq);
    } else {
      await renderEmployeeWeeklyRoute(seq);
    }
  }

  /* ---------- Screen 4: Leave (#/leave) ---------- */

  function buildTeamCalendarGrid(monthStr, calendarItems) {
    const [yearStr, monStr] = monthStr.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monStr) - 1;
    const firstUtc = Date.UTC(year, monthIndex, 1);
    const firstDow = new Date(firstUtc).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const todayStr = getLocalTodayISO();
    const items = Array.isArray(calendarItems) ? calendarItems : [];

    const grid = el('div', { className: 'calendar-grid' });
    WEEKDAY_NAMES.forEach((d, idx) => {
      const cls = `calendar-dow${idx === 0 ? ' is-sun' : idx === 6 ? ' is-sat' : ''}`;
      grid.appendChild(el('div', { className: cls, textContent: d }));
    });

    for (let i = 0; i < firstDow; i++) {
      grid.appendChild(el('div', { className: 'calendar-cell is-empty' }));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${yearStr}-${monStr}-${String(day).padStart(2, '0')}`;
      const dow = (firstDow + day - 1) % 7;
      const isWeekend = dow === 0 || dow === 6;
      const cell = el('div', {
        className: `calendar-cell${dateStr === todayStr ? ' is-today' : ''}`,
      }, [
        el('div', { className: 'calendar-day-num', textContent: String(day) }),
      ]);

      const matching = items.filter((item) => {
        if (dateStr < item.startDate || dateStr > item.endDate) return false;
        if (isWeekend && item.startDate !== item.endDate) return false;
        return true;
      });

      for (const m of matching) {
        const shortType = LEAVE_SHORT_LABELS[m.type] || m.type;
        const pillCls = m.status === 'approved' ? 'cal-pill cal-pill-approved' : 'cal-pill cal-pill-pending';
        cell.appendChild(el('div', {
          className: pillCls,
          title: `${m.userName} · ${LEAVE_TYPE_LABELS[m.type] || m.type} (${m.status === 'approved' ? '승인' : '대기'})`,
          textContent: `${m.userName} (${shortType})`,
        }));
      }

      grid.appendChild(cell);
    }

    const totalCells = firstDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      grid.appendChild(el('div', { className: 'calendar-cell is-empty' }));
    }

    return grid;
  }

  async function renderLeaveRoute(seq) {
    const user = state.currentUser;
    if (!state.leaveCalendarMonth) state.leaveCalendarMonth = getLocalMonthISO();

    const [balance, requests, calendarItems] = await Promise.all([
      apiFetch(`/api/users/${encodeURIComponent(user.id)}/balance`),
      apiFetch(`/api/leave-requests?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/leave-calendar?userId=${encodeURIComponent(user.id)}&month=${encodeURIComponent(state.leaveCalendarMonth)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const available = Math.max(0, Math.round((Number(balance.remaining) - Number(balance.pending)) * 10) / 10);
    const balanceCards = el('div', { className: 'stats-grid-4' }, [
      el('div', { className: 'stat-card stat-card-primary' }, [
        el('div', { className: 'stat-label', textContent: '잔여 연차' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.remaining) }),
        el('div', { className: 'stat-hint', textContent: `추가 신청 가능: ${formatDays(available)}` }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '사용 연차' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.used) }),
        el('div', { className: 'stat-hint', textContent: '승인 완료 합계' }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '승인 대기' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.pending) }),
        el('div', { className: 'stat-hint', textContent: '결재 진행 중' }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '총 부여 연차' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.total) }),
        el('div', { className: 'stat-hint', textContent: '연간 기준 일수' }),
      ]),
    ]);

    const today = getLocalTodayISO();
    const typeSelect = el('select', { className: 'form-control', id: 'leave-type' }, [
      el('option', { value: 'annual', textContent: '연차 (종일)' }),
      el('option', { value: 'half_am', textContent: '오전 반차 (0.5일)' }),
      el('option', { value: 'half_pm', textContent: '오후 반차 (0.5일)' }),
    ]);
    const startInput = el('input', { type: 'date', className: 'form-control', id: 'leave-start', value: today });
    const endInput = el('input', { type: 'date', className: 'form-control', id: 'leave-end', value: today });
    const halfHint = el('p', {
      className: 'field-hint is-hidden',
      hidden: true,
      textContent: '반차는 시작일과 종료일이 동일하게 적용됩니다.',
    });
    const previewVal = el('strong', { className: 'preview-value', textContent: '-' });
    const reasonInput = el('textarea', {
      className: 'form-control',
      rows: 3,
      id: 'leave-reason',
      placeholder: '연차 사유를 입력하세요 (예: 개인 사유, 병원 방문)',
    });
    const reqErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const submitBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: '신청하기' });

    const syncPreview = () => {
      const type = typeSelect.value;
      const isHalf = type === 'half_am' || type === 'half_pm';
      if (isHalf) {
        if (startInput.value) endInput.value = startInput.value;
        endInput.disabled = true;
        setVisible(halfHint, true);
      } else {
        endInput.disabled = false;
        setVisible(halfHint, false);
        if (startInput.value && (!endInput.value || endInput.value < startInput.value)) {
          endInput.value = startInput.value;
        }
      }
      const prev = calculatePreviewDays(type, startInput.value, endInput.value);
      previewVal.textContent = prev.text;
      previewVal.classList.toggle('is-invalid', !prev.valid);
    };

    typeSelect.addEventListener('change', syncPreview);
    startInput.addEventListener('change', syncPreview);
    endInput.addEventListener('change', syncPreview);
    syncPreview();

    const formCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '연차 신청' }),
        el('span', { className: 'page-subtitle', textContent: '주말 제외 평일 계산' }),
      ]),
      el('form', {
        className: 'form-stack',
        novalidate: true,
        onSubmit: async (e) => {
          e.preventDefault();
          setInlineAlert(reqErrBox, '');
          const type = typeSelect.value;
          const startDate = startInput.value;
          const endDate = type === 'annual' ? endInput.value : startDate;
          submitBtn.disabled = true;
          submitBtn.textContent = '신청 중...';
          try {
            await apiFetch('/api/leave-requests', {
              method: 'POST',
              body: JSON.stringify({
                userId: user.id,
                type,
                startDate,
                endDate,
                reason: reasonInput.value.trim(),
              }),
            });
            showToast('연차 신청이 접수되었습니다.');
            await renderCurrentRoute();
          } catch (err) {
            setInlineAlert(reqErrBox, err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = '신청하기';
          }
        },
      }, [
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: 'leave-type', textContent: '휴가 유형' }),
          typeSelect,
        ]),
        el('div', { className: 'form-row-2' }, [
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', for: 'leave-start', textContent: '시작일' }),
            startInput,
          ]),
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', for: 'leave-end', textContent: '종료일' }),
            endInput,
          ]),
        ]),
        halfHint,
        el('div', { className: 'preview-box', 'aria-live': 'polite' }, [
          el('span', { className: 'preview-label', textContent: '예상 차감 일수' }),
          previewVal,
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: 'leave-reason', textContent: '사유' }),
          reasonInput,
        ]),
        reqErrBox,
        el('div', { className: 'form-actions' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-outline',
            textContent: '초기화',
            onClick: () => {
              typeSelect.value = 'annual';
              startInput.value = today;
              endInput.value = today;
              reasonInput.value = '';
              setInlineAlert(reqErrBox, '');
              syncPreview();
            },
          }),
          submitBtn,
        ]),
      ]),
    ]);

    const list = Array.isArray(requests) ? requests : [];
    const listErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const listCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '내 신청 내역' }),
        makeBadge(`총 ${list.length}건`, 'badge badge-neutral'),
      ]),
      listErrBox,
      list.length === 0
        ? el('div', { className: 'state-box', textContent: '아직 신청한 연차 내역이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '기간' }),
                el('th', { textContent: '유형' }),
                el('th', { textContent: '일수' }),
                el('th', { textContent: '사유' }),
                el('th', { textContent: '상태' }),
                el('th', { textContent: '결재 의견' }),
                el('th', { textContent: '관리' }),
              ]),
            ]),
            el('tbody', {}, list.map((item) => {
              const cancelBtn = item.status === 'pending'
                ? el('button', {
                  type: 'button',
                  className: 'btn btn-sm btn-reject',
                  textContent: '취소',
                  onClick: async (e) => {
                    const btn = e.currentTarget;
                    setInlineAlert(listErrBox, '');
                    btn.disabled = true;
                    try {
                      await apiFetch(`/api/leave-requests/${encodeURIComponent(item.id)}/cancel`, {
                        method: 'POST',
                        body: JSON.stringify({ userId: user.id }),
                      });
                      showToast('연차 신청이 취소되었습니다.');
                      await renderCurrentRoute();
                    } catch (err) {
                      setInlineAlert(listErrBox, err.message);
                      btn.disabled = false;
                    }
                  },
                })
                : el('span', { textContent: '-' });

              const commentText = item.comment && String(item.comment).trim()
                ? (item.approverName ? `${item.comment} (${item.approverName})` : item.comment)
                : '-';

              return el('tr', {}, [
                el('td', { textContent: formatPeriod(item.startDate, item.endDate) }),
                el('td', {}, [makeBadge(LEAVE_TYPE_LABELS[item.type] || item.type, 'badge badge-neutral')]),
                el('td', { textContent: formatDays(item.days) }),
                el('td', { textContent: item.reason || '-' }),
                el('td', {}, [makeStatusBadge(item.status)]),
                el('td', { textContent: commentText }),
                el('td', {}, [cancelBtn]),
              ]);
            })),
          ]),
        ]),
    ]);

    const calMonthInput = el('input', {
      type: 'month',
      className: 'form-control',
      value: state.leaveCalendarMonth,
      'aria-label': '팀 연차 캘린더 월 선택',
      onChange: async (e) => {
        if (!e.target.value) return;
        state.leaveCalendarMonth = e.target.value;
        await renderCurrentRoute();
      },
    });
    calMonthInput.style.width = 'auto';

    const calendarCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: `팀 월간 연차 캘린더 (${user.team})` }),
        el('div', { className: 'calendar-controls' }, [
          el('div', { className: 'calendar-legend' }, [
            el('span', {}, [el('span', { className: 'legend-dot legend-approved' }), '승인']),
            el('span', {}, [el('span', { className: 'legend-dot legend-pending' }), '대기']),
          ]),
          calMonthInput,
        ]),
      ]),
      buildTeamCalendarGrid(state.leaveCalendarMonth, calendarItems),
      calendarItems.length === 0
        ? el('div', { className: 'page-subtitle', textContent: '선택한 월에 예정된 팀 연차가 없습니다.' })
        : null,
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '연차 관리' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team}` }),
          ]),
        ]),
        balanceCards,
        el('div', { className: 'leave-workspace' }, [formCard, listCard]),
        calendarCard,
      ])
    );
  }

  /* ---------- Screen 5: Approvals (#/approvals) ---------- */

  function renderApprovalDetail(item) {
    const d = item.detail || {};
    if (item.kind === 'weekly') {
      const box = el('div', { className: 'approval-detail-box' }, [
        el('div', { className: 'approval-summary-left' }, [
          el('strong', { textContent: `${d.userName || item.userName} · ${d.weekLabel || formatWeekLabel(d.weekStart)}` }),
          el('span', { className: 'page-subtitle', textContent: `금주 ${formatHours(d.totalHours)} · 차주 ${formatHours(d.nextTotalHours)}` }),
          d.comment ? el('span', { className: 'page-subtitle', textContent: `결재 의견: ${d.comment}` }) : null,
        ]),
        buildExcelWeeklyForm(d, { editable: false }),
      ]);
      if (item.status === 'rejected' && item.userId === state.currentUser?.id) {
        box.appendChild(
          el('div', { className: 'form-actions' }, [
            el('a', { href: '#/weekly', className: 'btn btn-sm btn-primary', textContent: '주간보고 수정 · 재제출하기 →' }),
          ])
        );
      }
      return box;
    }

    return el('div', { className: 'approval-detail-box' }, [
      el('div', { className: 'detail-kv-grid' }, [
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '신청자' }),
          el('div', { className: 'detail-kv-value', textContent: d.userName || item.userName || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '휴가 유형' }),
          el('div', { className: 'detail-kv-value', textContent: LEAVE_TYPE_LABELS[d.type] || d.type || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '기간 및 일수' }),
          el('div', { className: 'detail-kv-value', textContent: `${formatPeriod(d.startDate, d.endDate)} (${formatDays(d.days)})` }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '신청 사유' }),
          el('div', { className: 'detail-kv-value', textContent: d.reason || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '신청일' }),
          el('div', { className: 'detail-kv-value', textContent: formatIsoDate(item.createdAt) }),
        ]),
        d.comment
          ? el('div', {}, [
            el('div', { className: 'detail-kv-label', textContent: `결재 의견 (${d.approverName || '팀장'})` }),
            el('div', { className: 'detail-kv-value', textContent: d.comment }),
          ])
          : null,
      ]),
    ]);
  }

  function buildApprovalItemCard(item, { canDecide, onAfterAction, pageErrBox }) {
    const kindLabel = item.kind === 'weekly' ? '주간보고' : '연차';
    const kindBadgeClass = item.kind === 'weekly' ? 'badge badge-submitted' : 'badge badge-pinned';
    let detailPanel = null;
    let isExpanded = false;

    const detailSlot = el('div', { className: 'is-hidden', hidden: true });
    const chevron = el('span', { className: 'card-link', textContent: '상세 보기 ▾' });

    const toggleDetail = () => {
      isExpanded = !isExpanded;
      if (isExpanded && !detailPanel) {
        detailPanel = renderApprovalDetail(item);
        detailSlot.replaceChildren(detailPanel);
      }
      setVisible(detailSlot, isExpanded);
      chevron.textContent = isExpanded ? '접기 ▴' : '상세 보기 ▾';
    };

    const summaryBtn = el('button', {
      type: 'button',
      className: 'approval-summary-btn',
      onClick: toggleDetail,
    }, [
      el('div', { className: 'approval-summary-left' }, [
        makeBadge(kindLabel, kindBadgeClass),
        el('span', { className: 'approval-summary-title', textContent: `${item.userName} · ${item.title}` }),
        makeStatusBadge(item.status),
      ]),
      el('div', { className: 'approval-summary-right' }, [
        el('span', {
          textContent: item.decidedAt
            ? `처리 ${formatIsoDate(item.decidedAt)}`
            : `신청 ${formatIsoDate(item.createdAt)}`,
        }),
        chevron,
      ]),
    ]);

    const detailComment = item.detail && item.detail.comment;
    const inlineOpinion = !canDecide && detailComment
      ? el('div', {
        className: `alert ${item.status === 'rejected' ? 'alert-warning' : 'alert-info'}`,
        textContent: `결재 의견 (${item.detail.approverName || '팀장'}): ${detailComment}`,
      })
      : null;

    let actionRow = null;
    if (canDecide) {
      const commentInput = el('input', {
        type: 'text',
        className: 'form-control approval-comment-input',
        placeholder: item.kind === 'weekly'
          ? '결재 의견 입력 (주간보고 반려 시 필수)'
          : '결재 의견을 입력하세요 (선택)',
        'aria-label': `${item.userName} ${item.title} 결재 의견`,
      });
      const rejectBtn = el('button', { type: 'button', className: 'btn btn-reject', textContent: '반려' });
      const approveBtn = el('button', { type: 'button', className: 'btn btn-approve', textContent: '승인' });

      const decide = async (action) => {
        setInlineAlert(pageErrBox, '');
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        commentInput.disabled = true;
        const base = item.kind === 'weekly' ? '/api/weekly-reports' : '/api/leave-requests';
        try {
          await apiFetch(`${base}/${encodeURIComponent(item.id)}/${action}`, {
            method: 'POST',
            body: JSON.stringify({
              approverId: state.currentUser.id,
              comment: commentInput.value.trim(),
            }),
          });
          showToast(action === 'approve' ? '승인 처리되었습니다.' : '반려 처리되었습니다.');
          await onAfterAction();
        } catch (err) {
          setInlineAlert(pageErrBox, err.message);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          commentInput.disabled = false;
        }
      };

      approveBtn.addEventListener('click', () => decide('approve'));
      rejectBtn.addEventListener('click', () => decide('reject'));
      actionRow = el('div', { className: 'approval-actions-row' }, [commentInput, rejectBtn, approveBtn]);
    }

    const employeeRejectedAction = !canDecide && item.kind === 'weekly' && item.status === 'rejected'
      ? el('div', { className: 'form-actions' }, [
        el('a', { href: '#/weekly', className: 'btn btn-sm btn-primary', textContent: '주간보고 수정 · 재제출 →' }),
      ])
      : null;

    return el('article', { className: 'approval-card' }, [
      summaryBtn,
      inlineOpinion,
      detailSlot,
      actionRow,
      employeeRejectedAction,
    ]);
  }

  async function renderApprovalsRoute(seq) {
    const user = state.currentUser;
    const isManager = user.role === 'manager';
    const pageErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    if (isManager) {
      const [pendingList, historyList] = await Promise.all([
        apiFetch(`/api/approvals?approverId=${encodeURIComponent(user.id)}`),
        apiFetch(`/api/approvals/history?approverId=${encodeURIComponent(user.id)}`),
      ]);
      if (seq !== state.routeSeq) return;

      const pending = Array.isArray(pendingList) ? pendingList : [];
      const history = Array.isArray(historyList) ? historyList : [];
      updateNavApprovalsBadge(pending.length);

      const activeTab = state.approvalsTab === 'history' ? 'history' : 'pending';
      const items = activeTab === 'pending' ? pending : history;

      const tabsEl = el('div', { className: 'subtabs', role: 'tablist' }, [
        el('button', {
          type: 'button',
          className: `subtab-btn${activeTab === 'pending' ? ' is-active' : ''}`,
          textContent: `결재 대기 (${pending.length})`,
          onClick: () => {
            state.approvalsTab = 'pending';
            renderCurrentRoute();
          },
        }),
        el('button', {
          type: 'button',
          className: `subtab-btn${activeTab === 'history' ? ' is-active' : ''}`,
          textContent: `처리 완료 (${history.length})`,
          onClick: () => {
            state.approvalsTab = 'history';
            renderCurrentRoute();
          },
        }),
      ]);

      const listEl = items.length === 0
        ? el('div', {
          className: 'card state-box',
          textContent: activeTab === 'pending' ? '대기 중인 결재 요청이 없습니다.' : '처리 완료된 결재 내역이 없습니다.',
        })
        : el('div', { className: 'stack-md' }, items.map((item) =>
          buildApprovalItemCard(item, {
            canDecide: activeTab === 'pending',
            onAfterAction: () => renderCurrentRoute(),
            pageErrBox,
          })
        ));

      dom.routeView.replaceChildren(
        el('div', { className: 'stack-lg' }, [
          el('div', { className: 'page-header' }, [
            el('div', {}, [
              el('h2', { className: 'page-title', textContent: '승인 관리' }),
              el('p', { className: 'page-subtitle', textContent: `${user.team} 연차 · 주간보고 결재` }),
            ]),
            tabsEl,
          ]),
          pageErrBox,
          listEl,
        ])
      );
      return;
    }

    const mineList = await apiFetch(`/api/approvals/mine?userId=${encodeURIComponent(user.id)}`);
    if (seq !== state.routeSeq) return;
    updateNavApprovalsBadge(0);

    const mine = Array.isArray(mineList) ? mineList : [];
    const listEl = mine.length === 0
      ? el('div', { className: 'card state-box', textContent: '내가 올린 결재 내역이 없습니다.' })
      : el('div', { className: 'stack-md' }, mine.map((item) =>
        buildApprovalItemCard(item, {
          canDecide: false,
          onAfterAction: () => renderCurrentRoute(),
          pageErrBox,
        })
      ));

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '내가 올린 결재' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · 연차 및 주간보고 승인 결과 확인` }),
          ]),
          makeBadge(`총 ${mine.length}건`, 'badge badge-neutral'),
        ]),
        pageErrBox,
        listEl,
      ])
    );
  }

  /* ---------- Screen 6: Meeting Rooms (#/rooms) ---------- */

  const ROOM_SLOTS = Array.from({ length: 24 }, (_, idx) => {
    const h = 8 + Math.floor(idx / 2);
    const m = idx % 2 === 0 ? '00' : '30';
    return `${String(h).padStart(2, '0')}:${m}`;
  });

  const ROOM_END_SLOTS = Array.from({ length: 24 }, (_, idx) => {
    const endIdx = idx + 1;
    const h = 8 + Math.floor(endIdx / 2);
    const m = endIdx % 2 === 0 ? '00' : '30';
    return `${String(h).padStart(2, '0')}:${m}`;
  });

  function toSlotIndex(hhmm) {
    if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return -1;
    const [h, m] = hhmm.split(':').map(Number);
    return (h - 8) * 2 + (m >= 30 ? 1 : 0);
  }

  function addOneHourCapped(startTime) {
    const idx = toSlotIndex(startTime);
    if (idx < 0) return '10:00';
    const endIdx = Math.min(24, idx + 2);
    return ROOM_END_SLOTS[endIdx - 1];
  }

  function openRoomBookingModal({ rooms, prefillRoomId, prefillDate, prefillStart, onAfterAction }) {
    const user = state.currentUser;
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    const roomSelect = el('select', { className: 'form-control' }, rooms.map((r) =>
      el('option', { value: String(r.id), textContent: `${r.name} (${r.capacity}인${r.equipment ? ' · ' + r.equipment : ''})` })
    ));
    if (prefillRoomId) roomSelect.value = String(prefillRoomId);

    const dateInput = el('input', {
      type: 'date',
      className: 'form-control',
      value: prefillDate || getLocalTodayISO(),
    });

    const startTime = ROOM_SLOTS.includes(prefillStart) ? prefillStart : '09:00';
    const startSelect = el('select', { className: 'form-control' }, ROOM_SLOTS.map((t) =>
      el('option', { value: t, textContent: t })
    ));
    startSelect.value = startTime;

    const endSelect = el('select', { className: 'form-control' }, ROOM_END_SLOTS.map((t) =>
      el('option', { value: t, textContent: t })
    ));
    endSelect.value = addOneHourCapped(startTime);

    startSelect.addEventListener('change', () => {
      if (toSlotIndex(endSelect.value) <= toSlotIndex(startSelect.value)) {
        endSelect.value = addOneHourCapped(startSelect.value);
      }
    });

    const titleInput = el('input', {
      type: 'text',
      className: 'form-control',
      placeholder: '회의 제목을 입력하세요 (예: 개발팀 주간 점검)',
    });

    const attendeesInput = el('input', {
      type: 'text',
      className: 'form-control',
      placeholder: '참석자를 입력하세요 (예: 김신입, 이분석)',
    });

    const submitBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: '예약하기' });

    const form = el('form', {
      className: 'form-stack',
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        setInlineAlert(errBox, '');
        submitBtn.disabled = true;
        submitBtn.textContent = '예약 중...';
        try {
          await apiFetch('/api/room-reservations', {
            method: 'POST',
            body: JSON.stringify({
              userId: user.id,
              roomId: Number(roomSelect.value),
              date: dateInput.value,
              startTime: startSelect.value,
              endTime: endSelect.value,
              title: titleInput.value.trim(),
              attendees: attendeesInput.value.trim(),
            }),
          });
          closeModal();
          showToast('회의실이 예약되었습니다.');
          await onAfterAction();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = '예약하기';
        }
      },
    }, [
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '회의실 (마곡)' }),
        roomSelect,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '날짜' }),
        dateInput,
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', textContent: '시작 시각' }),
          startSelect,
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', textContent: '종료 시각' }),
          endSelect,
        ]),
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '회의 제목' }),
        titleInput,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '참석자' }),
        attendeesInput,
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [
        el('button', { type: 'button', className: 'btn btn-outline', textContent: '취소', onClick: closeModal }),
        submitBtn,
      ]),
    ]);

    openModal('회의실 예약', form);
    titleInput.focus();
  }

  function openReservationDetailModal(res, onAfterCancel) {
    const user = state.currentUser;
    const isMine = res.userId === user.id;
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const cancelBtn = isMine
      ? el('button', {
        type: 'button',
        className: 'btn btn-reject',
        textContent: '예약 취소',
        onClick: async (e) => {
          const btn = e.currentTarget;
          setInlineAlert(errBox, '');
          btn.disabled = true;
          try {
            await apiFetch(`/api/room-reservations/${encodeURIComponent(res.id)}/cancel`, {
              method: 'POST',
              body: JSON.stringify({ userId: user.id }),
            });
            closeModal();
            showToast('회의실 예약이 취소되었습니다.');
            await onAfterCancel();
          } catch (err) {
            setInlineAlert(errBox, err.message);
            btn.disabled = false;
          }
        },
      })
      : null;

    openModal(res.title || '예약 상세', el('div', { className: 'stack-md' }, [
      el('div', { className: 'detail-kv-grid' }, [
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '회의실' }),
          el('div', { className: 'detail-kv-value', textContent: res.roomName }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '일시' }),
          el('div', { className: 'detail-kv-value', textContent: `${res.date} · ${res.startTime} ~ ${res.endTime}` }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '예약자' }),
          el('div', { className: 'detail-kv-value', textContent: `${res.userName}${res.team ? ` (${res.team})` : ''}` }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '참석자' }),
          el('div', { className: 'detail-kv-value', textContent: res.attendees || '-' }),
        ]),
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [
        cancelBtn,
        el('button', { type: 'button', className: 'btn btn-outline', textContent: '닫기', onClick: closeModal }),
      ]),
    ]));
  }

  async function renderRoomsRoute(seq) {
    const user = state.currentUser;
    if (!state.roomsDate) state.roomsDate = getLocalTodayISO();
    const todayStr = getLocalTodayISO();

    const refreshRoomsAndHome = async () => {
      await Promise.all([
        renderCurrentRoute(),
        apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`).catch(() => null),
      ]);
    };

    const [rooms, dayReservations, myReservations] = await Promise.all([
      apiFetch('/api/rooms'),
      apiFetch(`/api/room-reservations?date=${encodeURIComponent(state.roomsDate)}`),
      apiFetch(`/api/room-reservations/mine?userId=${encodeURIComponent(user.id)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const roomList = Array.isArray(rooms) ? rooms : [];
    const dayList = Array.isArray(dayReservations) ? dayReservations : [];
    const mineList = Array.isArray(myReservations) ? myReservations : [];

    const dateInput = el('input', {
      type: 'date',
      className: 'form-control',
      value: state.roomsDate,
      'aria-label': '예약 조회 날짜 선택',
      onChange: (e) => {
        if (!e.target.value) return;
        state.roomsDate = e.target.value;
        renderCurrentRoute();
      },
    });
    dateInput.style.width = 'auto';

    const dateNav = el('div', { className: 'week-nav' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '< 이전',
        onClick: () => {
          state.roomsDate = shiftDateISO(state.roomsDate, -1);
          renderCurrentRoute();
        },
      }),
      el('button', {
        type: 'button',
        className: `btn btn-sm ${state.roomsDate === todayStr ? 'btn-primary' : 'btn-outline'}`,
        textContent: '오늘',
        onClick: () => {
          state.roomsDate = todayStr;
          renderCurrentRoute();
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '다음 >',
        onClick: () => {
          state.roomsDate = shiftDateISO(state.roomsDate, 1);
          renderCurrentRoute();
        },
      }),
      dateInput,
    ]);

    const hourHeaders = Array.from({ length: 12 }, (_, idx) =>
      el('th', {
        colspan: '2',
        className: 'tt-hour-head',
        textContent: String(8 + idx).padStart(2, '0'),
      })
    );

    const timetableBody = el('tbody', {}, roomList.map((room) => {
      const roomRes = dayList
        .filter((r) => r.roomId === room.id && r.status === 'reserved')
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      const cells = [];
      let slotIdx = 0;
      while (slotIdx < 24) {
        const hit = roomRes.find((r) => {
          const s = toSlotIndex(r.startTime);
          const e = toSlotIndex(r.endTime);
          return s <= slotIdx && slotIdx < e;
        });

        if (hit && toSlotIndex(hit.startTime) === slotIdx) {
          const endIdx = Math.min(24, Math.max(slotIdx + 1, toSlotIndex(hit.endTime)));
          const span = endIdx - slotIdx;
          const isMine = hit.userId === user.id;
          cells.push(el('td', { colspan: String(span), className: 'tt-booked-cell' }, [
            el('button', {
              type: 'button',
              className: `tt-booking${isMine ? ' is-mine' : ''}`,
              title: `${hit.startTime}~${hit.endTime} · ${hit.title} (${hit.userName})`,
              onClick: () => openReservationDetailModal(hit, refreshRoomsAndHome),
            }, [
              el('span', { className: 'tt-booking-title', textContent: hit.title }),
              el('span', { className: 'tt-booking-user', textContent: `${hit.userName} · ${hit.startTime}~${hit.endTime}` }),
            ]),
          ]));
          slotIdx += span;
        } else if (hit) {
          cells.push(el('td', { className: `tt-slot-cell${slotIdx % 2 === 1 ? ' is-hour-end' : ''}` }));
          slotIdx += 1;
        } else {
          const slotTime = ROOM_SLOTS[slotIdx];
          cells.push(el('td', { className: `tt-slot-cell${slotIdx % 2 === 1 ? ' is-hour-end' : ''}` }, [
            el('button', {
              type: 'button',
              className: 'tt-empty-btn',
              title: `${room.name} ${slotTime} 예약`,
              'aria-label': `${room.name} ${slotTime} 예약`,
              textContent: '+',
              onClick: () => openRoomBookingModal({
                rooms: roomList,
                prefillRoomId: room.id,
                prefillDate: state.roomsDate,
                prefillStart: slotTime,
                onAfterAction: refreshRoomsAndHome,
              }),
            }),
          ]));
          slotIdx += 1;
        }
      }

      return el('tr', {}, [
        el('th', { scope: 'row', className: 'tt-room-cell' }, [
          el('div', { className: 'tt-room-name', textContent: room.name }),
          el('div', {
            className: 'tt-room-meta',
            textContent: `${room.capacity}인${room.equipment ? ` · ${room.equipment}` : ''}`,
          }),
        ]),
        ...cells,
      ]);
    }));

    const desktopTimetable = el('div', { className: 'rooms-timetable-desktop tt-wrap' }, [
      el('table', { className: 'tt-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { className: 'tt-room-head', textContent: '회의실 \\ 시각' }),
            ...hourHeaders,
          ]),
        ]),
        timetableBody,
      ]),
    ]);

    const mobileList = el('div', { className: 'rooms-mobile-list' }, roomList.map((room) => {
      const roomRes = dayList
        .filter((r) => r.roomId === room.id && r.status === 'reserved')
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      return el('article', { className: 'card stack-sm' }, [
        el('div', { className: 'card-header' }, [
          el('div', {}, [
            el('h4', { className: 'card-title', textContent: room.name }),
            el('span', {
              className: 'page-subtitle',
              textContent: `${room.capacity}인${room.equipment ? ` · ${room.equipment}` : ''}`,
            }),
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-primary',
            textContent: '+ 예약',
            onClick: () => openRoomBookingModal({
              rooms: roomList,
              prefillRoomId: room.id,
              prefillDate: state.roomsDate,
              prefillStart: '09:00',
              onAfterAction: refreshRoomsAndHome,
            }),
          }),
        ]),
        roomRes.length === 0
          ? el('div', { className: 'page-subtitle', textContent: '예약된 일정이 없습니다.' })
          : el('ul', { className: 'list-clean' }, roomRes.map((r) =>
            el('li', {}, [
              el('button', {
                type: 'button',
                className: 'list-item-row notice-btn-item',
                onClick: () => openReservationDetailModal(r, refreshRoomsAndHome),
              }, [
                el('div', { className: 'approval-summary-left' }, [
                  el('span', { className: 'meeting-time-pill', textContent: `${r.startTime}~${r.endTime}` }),
                  el('strong', { textContent: r.title }),
                ]),
                makeBadge(
                  r.userId === user.id ? `${r.userName} (내 예약)` : r.userName,
                  r.userId === user.id ? 'badge badge-working' : 'badge badge-neutral'
                ),
              ]),
            ])
          )),
      ]);
    }));

    const scheduleCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'rooms-toolbar' }, [
        el('div', { className: 'rooms-legend' }, [
          el('span', { className: 'rooms-legend-item' }, [el('span', { className: 'legend-swatch legend-swatch-free' }), '빈 칸 클릭 예약']),
          el('span', { className: 'rooms-legend-item' }, [el('span', { className: 'legend-swatch legend-swatch-mine' }), '내 예약']),
          el('span', { className: 'rooms-legend-item' }, [el('span', { className: 'legend-swatch legend-swatch-other' }), '다른 사람 예약']),
        ]),
        el('button', {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          textContent: '+ 회의실 예약',
          disabled: roomList.length === 0,
          onClick: () => openRoomBookingModal({
            rooms: roomList,
            prefillRoomId: roomList[0]?.id,
            prefillDate: state.roomsDate,
            prefillStart: '09:00',
            onAfterAction: refreshRoomsAndHome,
          }),
        }),
      ]),
      roomList.length === 0
        ? el('div', { className: 'state-box', textContent: '등록된 회의실이 없습니다.' })
        : desktopTimetable,
      roomList.length > 0 ? mobileList : null,
    ]);

    const mineErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const myCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '내 다가오는 예약' }),
        makeBadge(`총 ${mineList.length}건`, 'badge badge-neutral'),
      ]),
      mineErrBox,
      mineList.length === 0
        ? el('div', { className: 'state-box', textContent: '예정된 회의실 예약이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '날짜' }),
                el('th', { textContent: '시간' }),
                el('th', { textContent: '회의실' }),
                el('th', { textContent: '회의 제목' }),
                el('th', { textContent: '참석자' }),
                el('th', { textContent: '관리' }),
              ]),
            ]),
            el('tbody', {}, mineList.map((r) =>
              el('tr', {}, [
                el('td', { textContent: formatWorkDateWithDay(r.date) }),
                el('td', {}, [el('span', { className: 'meeting-time-pill', textContent: `${r.startTime} ~ ${r.endTime}` })]),
                el('td', {}, [makeBadge(r.roomName, 'badge badge-neutral')]),
                el('td', {}, [el('strong', { textContent: r.title })]),
                el('td', { textContent: r.attendees || '-' }),
                el('td', {}, [
                  el('button', {
                    type: 'button',
                    className: 'btn btn-sm btn-reject',
                    textContent: '취소',
                    onClick: async (e) => {
                      const btn = e.currentTarget;
                      setInlineAlert(mineErrBox, '');
                      btn.disabled = true;
                      try {
                        await apiFetch(`/api/room-reservations/${encodeURIComponent(r.id)}/cancel`, {
                          method: 'POST',
                          body: JSON.stringify({ userId: user.id }),
                        });
                        showToast('회의실 예약이 취소되었습니다.');
                        await refreshRoomsAndHome();
                      } catch (err) {
                        setInlineAlert(mineErrBox, err.message);
                        btn.disabled = false;
                      }
                    },
                  }),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '회의실 예약 (마곡 사무실)' }),
            el('p', { className: 'page-subtitle', textContent: `${formatWorkDateWithDay(state.roomsDate)} · ${user.name} (${user.team})` }),
          ]),
          dateNav,
        ]),
        scheduleCard,
        myCard,
      ])
    );
  }

  /* ---------- Route Dispatcher & Bootstrap ---------- */

  async function renderCurrentRoute() {
    state.route = parseRouteFromHash();
    if (state.currentUser && state.currentUser.role === 'executive') {
      const rawHash = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
      if (rawHash && !EXEC_ROUTES.includes(rawHash)) {
        window.history.replaceState(null, '', '#/home');
      }
    }
    syncSidebarForUser(state.currentUser);
    showGlobalError('');

    if (!state.currentUser) {
      dom.routeView.replaceChildren(
        el('div', { className: 'card state-box', textContent: '선택된 사용자가 없습니다.' })
      );
      return;
    }

    const seq = ++state.routeSeq;
    renderLoadingState();

    try {
      if (state.route === 'home') {
        await renderHomeRoute(seq);
      } else if (state.route === 'attendance') {
        await renderAttendanceRoute(seq);
      } else if (state.route === 'weekly') {
        await renderWeeklyRoute(seq);
      } else if (state.route === 'leave') {
        await renderLeaveRoute(seq);
      } else if (state.route === 'approvals') {
        await renderApprovalsRoute(seq);
      } else if (state.route === 'rooms') {
        await renderRoomsRoute(seq);
      }
    } catch (err) {
      if (seq !== state.routeSeq) return;
      showGlobalError(err.message);
      dom.routeView.replaceChildren(
        el('div', { className: 'card state-box', textContent: '화면을 불러오지 못했습니다. 상단의 다시 시도를 눌러 주세요.' })
      );
    }
  }

  function populateUserSelect(users) {
    if (!Array.isArray(users) || users.length === 0) {
      dom.userSelect.replaceChildren(el('option', { value: '', textContent: '등록된 사용자 없음' }));
      dom.userSelect.disabled = true;
      state.currentUser = null;
      renderHeaderForUser(null);
      return;
    }

    const groups = new Map();
    for (const u of users) {
      const team = u.team || '기타';
      if (!groups.has(team)) groups.set(team, []);
      groups.get(team).push(u);
    }

    const optgroups = Array.from(groups.entries()).map(([team, members]) =>
      el('optgroup', { label: team }, members.map((u) => {
        const roleLabel = ROLE_META[u.role]?.label || u.role;
        return el('option', { value: String(u.id), textContent: `${u.name} (${roleLabel})` });
      }))
    );

    dom.userSelect.replaceChildren(...optgroups);
    dom.userSelect.disabled = false;

    const storedId = readStoredUserId();
    const matched = users.find((u) => String(u.id) === storedId) || users[0];
    state.currentUser = matched;
    dom.userSelect.value = String(matched.id);
    writeStoredUserId(matched.id);
    renderHeaderForUser(matched);
  }

  async function initUsersAndStart() {
    showGlobalError('');
    dom.userSelect.disabled = true;
    renderLoadingState('사용자 정보를 불러오는 중입니다...');
    try {
      const users = await apiFetch('/api/users');
      state.users = Array.isArray(users) ? users : [];
      populateUserSelect(state.users);
      await renderCurrentRoute();
    } catch (err) {
      showGlobalError(err.message);
      dom.userSelect.replaceChildren(el('option', { value: '', textContent: '사용자 불러오기 실패' }));
      dom.routeView.replaceChildren(
        el('div', { className: 'card state-box', textContent: '서버 연결 후 다시 시도해 주세요.' })
      );
    }
  }

  function bindGlobalEvents() {
    window.addEventListener('hashchange', () => {
      closeModal();
      renderCurrentRoute();
    });

    dom.userSelect.addEventListener('change', async () => {
      const selectedId = dom.userSelect.value;
      const nextUser = state.users.find((u) => String(u.id) === selectedId) || null;
      if (!nextUser) return;
      state.currentUser = nextUser;
      state.approvalsTab = 'pending';
      state.employeeWeekStart = '';
      state.managerWeekStart = '';
      state.execWeekStart = '';
      state.execSelectedTeam = null;
      writeStoredUserId(nextUser.id);
      closeModal();
      renderHeaderForUser(nextUser);
      await renderCurrentRoute();
    });

    dom.globalRetryBtn.addEventListener('click', () => {
      if (state.users.length === 0) {
        initUsersAndStart();
      } else {
        renderCurrentRoute();
      }
    });

    dom.modalCloseBtn.addEventListener('click', closeModal);
    dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.modalBackdrop) closeModal();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dom.modalBackdrop.hidden) closeModal();
    });

    dom.toastCloseBtn.addEventListener('click', () => {
      if (state.toastTimer) window.clearTimeout(state.toastTimer);
      setVisible(dom.toast, false);
    });
  }

  function bootstrap() {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/home');
    }
    state.attendanceMonth = getLocalMonthISO();
    state.leaveCalendarMonth = getLocalMonthISO();
    state.roomsDate = getLocalTodayISO();
    window.groupwareRefresh = () => renderCurrentRoute();
    bindGlobalEvents();
    initUsersAndStart();
  }

  bootstrap();
})();
