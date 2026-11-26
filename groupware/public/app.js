(() => {
  'use strict';

  const STORAGE_KEY = 'groupware.selectedUserId';
  const ROUTES = ['home', 'attendance', 'weekly', 'leave', 'approvals'];

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
    employee: { label: '사원', className: 'role-badge role-badge-employee' },
    manager: { label: '팀장', className: 'role-badge role-badge-manager' },
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
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return null;
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcMs = Date.UTC(y, m - 1, d);
    const dt = new Date(utcMs);
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return utcMs;
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
    const dow = WEEKDAY_NAMES[new Date(utcMs).getUTCDay()];
    return `${dateStr} (${dow})`;
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

    const dayMs = 86400000;
    let total = 0;
    let weekdays = 0;
    for (let cur = startMs; cur <= endMs; cur += dayMs) {
      total += 1;
      const dow = new Date(cur).getUTCDay();
      if (dow !== 0 && dow !== 6) weekdays += 1;
    }
    if (weekdays === 0) return { valid: false, text: '0일 (주말만 포함됨)' };
    if (total > weekdays) return { valid: true, text: `${weekdays}일 (주말 제외)` };
    return { valid: true, text: `${weekdays}일` };
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

  function openModal(title, contentNodes) {
    dom.modalTitle.textContent = title;
    const nodes = Array.isArray(contentNodes) ? contentNodes : [contentNodes];
    dom.modalBody.replaceChildren(...nodes);
    setVisible(dom.modalBackdrop, true);
  }

  function closeModal() {
    setVisible(dom.modalBackdrop, false);
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
      // Keep previous badge if background sync fails.
    }
  }

  /* ---------- Routing & Header ---------- */

  function parseRouteFromHash() {
    const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
    return ROUTES.includes(raw) ? raw : 'home';
  }

  function syncSidebarActive() {
    for (const link of dom.navLinks) {
      const active = link.dataset.route === state.route;
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
      return;
    }
    const roleInfo = ROLE_META[user.role] || {
      label: user.role,
      className: 'role-badge role-badge-employee',
    };
    dom.roleBadge.textContent = roleInfo.label;
    dom.roleBadge.className = roleInfo.className;
    setVisible(dom.roleBadge, true);
    if (user.role !== 'manager') {
      updateNavApprovalsBadge(0);
    }
  }

  function renderLoadingState(text = '데이터를 불러오는 중입니다...') {
    dom.routeView.replaceChildren(el('div', { className: 'card state-box', textContent: text }));
  }

  /* ---------- Screen 1: Home (#/home) ---------- */

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

  async function renderHomeRoute(seq) {
    const user = state.currentUser;
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

    let attActionEl = null;
    if (att.status === 'none') {
      attActionEl = el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '출근하기',
        onClick: (e) => handleHomeAttendance('check-in', e.currentTarget),
      });
    } else if (att.status === 'working') {
      attActionEl = el('button', {
        type: 'button',
        className: 'btn btn-approve',
        textContent: '퇴근하기',
        onClick: (e) => handleHomeAttendance('check-out', e.currentTarget),
      });
    } else {
      attActionEl = makeBadge('오늘 근무 완료', 'badge badge-done');
    }

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
    const wrEditable = wr.status === 'none' || wr.status === 'draft' || wr.status === 'rejected';
    const weeklyCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '이번 주 주간보고' }),
        el('a', {
          href: '#/weekly',
          className: 'card-link',
          textContent: wrEditable ? '작성하기 →' : '확인하기 →',
        }),
      ]),
      el('div', { className: 'approval-summary-left' }, [
        el('strong', { textContent: `${wr.weekStart} 주` }),
        makeStatusBadge(wr.status),
      ]),
      el('div', {
        className: 'kpi-meta',
        textContent: wr.status === 'rejected'
          ? '반려된 보고서입니다. 의견을 확인하고 보완 후 다시 제출하세요.'
          : wr.status === 'none'
            ? '이번 주 업무 항목과 차주 계획을 작성해 주세요.'
            : '주간보고 화면에서 상세 내용을 확인할 수 있습니다.',
      }),
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

    const notices = Array.isArray(home.notices) ? home.notices : [];
    const noticesCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '공지사항' }),
        el('div', { className: 'approval-summary-left' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline',
            textContent: '전체 보기',
            onClick: () => openNoticeDetailModal(null),
          }),
          isManager
            ? el('button', {
              type: 'button',
              className: 'btn btn-sm btn-primary',
              textContent: '+ 공지 작성',
              onClick: () => buildNoticeComposeModal(() => renderCurrentRoute()),
            })
            : null,
        ]),
      ]),
      notices.length === 0
        ? el('div', { className: 'state-box', textContent: '등록된 공지사항이 없습니다.' })
        : el('ul', { className: 'list-clean' }, notices.map((n) =>
          el('li', {}, [
            el('button', {
              type: 'button',
              className: 'list-item-row notice-btn-item',
              onClick: () => openNoticeDetailModal(n.id),
            }, [
              el('div', { className: 'notice-title-wrap' }, [
                n.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
                el('span', { className: 'notice-title-text', textContent: n.title }),
                n.attachments && n.attachments.length
                  ? el('span', { className: 'notice-clip', title: '첨부파일', textContent: '📎' })
                  : null,
              ]),
              el('span', { className: 'notice-date', textContent: formatIsoDate(n.createdAt) }),
            ]),
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
          absentCard,
          noticesCard,
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

  /* ---------- Screen 3: Weekly Report (#/weekly) ---------- */

  async function renderWeeklyRoute(seq) {
    const user = state.currentUser;
    const [current, pastReports] = await Promise.all([
      apiFetch(`/api/weekly-reports/current?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/weekly-reports?userId=${encodeURIComponent(user.id)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const isLocked = current.status === 'submitted' || current.status === 'approved';
    const rowModels = [];
    const tbody = el('tbody');
    const totalHoursEl = el('strong', { textContent: '0시간' });
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    const updateTotalHours = () => {
      const sum = rowModels.reduce((acc, r) => {
        const val = Number(r.hoursInput.value);
        return acc + (Number.isFinite(val) && val > 0 ? val : 0);
      }, 0);
      totalHoursEl.textContent = formatHours(sum);
    };

    const addRow = (initial = { project: '', hours: '', content: '' }) => {
      const projectInput = el('input', {
        type: 'text',
        className: 'form-control',
        placeholder: '예: 그룹웨어',
        value: initial.project || '',
        disabled: isLocked,
      });
      const hoursInput = el('input', {
        type: 'number',
        className: 'form-control',
        min: '0',
        step: '0.5',
        placeholder: '0',
        value: initial.hours !== undefined && initial.hours !== null && initial.hours !== '' ? String(initial.hours) : '',
        disabled: isLocked,
        onInput: updateTotalHours,
      });
      const contentInput = el('input', {
        type: 'text',
        className: 'form-control',
        placeholder: '주요 수행 업무 내용',
        value: initial.content || '',
        disabled: isLocked,
      });

      const model = { projectInput, hoursInput, contentInput, tr: null };
      const removeBtn = el('button', {
        type: 'button',
        className: 'btn btn-sm btn-reject',
        textContent: '삭제',
        disabled: isLocked,
        onClick: () => {
          const idx = rowModels.indexOf(model);
          if (idx >= 0) rowModels.splice(idx, 1);
          model.tr.remove();
          updateTotalHours();
        },
      });

      const tr = el('tr', {}, [
        el('td', { className: 'weekly-col-project' }, [projectInput]),
        el('td', { className: 'weekly-col-hours' }, [hoursInput]),
        el('td', {}, [contentInput]),
        el('td', { className: 'weekly-col-action' }, [removeBtn]),
      ]);
      model.tr = tr;
      rowModels.push(model);
      tbody.appendChild(tr);
      updateTotalHours();
    };

    const initialItems = Array.isArray(current.items) ? current.items : [];
    if (initialItems.length > 0) {
      initialItems.forEach((item) => addRow(item));
    } else if (!isLocked) {
      addRow();
    }

    const nextPlanInput = el('textarea', {
      className: 'form-control',
      rows: 3,
      placeholder: '다음 주 주요 계획을 입력하세요',
      disabled: isLocked,
      textContent: current.nextPlan || '',
    });
    nextPlanInput.value = current.nextPlan || '';

    const issuesInput = el('textarea', {
      className: 'form-control',
      rows: 3,
      placeholder: '이슈 및 건의사항을 입력하세요',
      disabled: isLocked,
      textContent: current.issues || '',
    });
    issuesInput.value = current.issues || '';

    const saveDraftBtn = el('button', {
      type: 'button',
      className: 'btn btn-outline',
      textContent: '임시저장',
      disabled: isLocked,
    });
    const submitBtn = el('button', {
      type: 'button',
      className: 'btn btn-primary',
      textContent: '제출하기',
      disabled: isLocked,
    });

    const saveWeekly = async (submit) => {
      setInlineAlert(errBox, '');
      const items = [];
      for (const r of rowModels) {
        const project = r.projectInput.value.trim();
        const content = r.contentInput.value.trim();
        const rawHours = r.hoursInput.value.trim();
        if (!project && !content && !rawHours) continue;
        items.push({
          project,
          hours: Number(rawHours) || 0,
          content,
        });
      }

      saveDraftBtn.disabled = true;
      submitBtn.disabled = true;
      try {
        await apiFetch('/api/weekly-reports', {
          method: 'PUT',
          body: JSON.stringify({
            userId: user.id,
            weekStart: current.weekStart,
            items,
            nextPlan: nextPlanInput.value.trim(),
            issues: issuesInput.value.trim(),
            submit,
          }),
        });
        showToast(submit ? '주간보고가 제출되었습니다.' : '주간보고가 임시저장되었습니다.');
        await renderCurrentRoute();
      } catch (err) {
        setInlineAlert(errBox, err.message);
        saveDraftBtn.disabled = isLocked;
        submitBtn.disabled = isLocked;
      }
    };

    saveDraftBtn.addEventListener('click', () => saveWeekly(false));
    submitBtn.addEventListener('click', () => saveWeekly(true));

    const statusBanner = current.status === 'rejected'
      ? el('div', {
        className: 'alert alert-warning',
        textContent: `반려 의견 (${current.approverName || '팀장'}): ${current.comment || '보완 후 재제출해 주세요.'}`,
      })
      : current.status === 'approved' && current.comment
        ? el('div', {
          className: 'alert alert-info',
          textContent: `승인 의견 (${current.approverName || '팀장'}): ${current.comment}`,
        })
        : isLocked
          ? el('div', {
            className: 'alert alert-info',
            textContent: '제출 또는 승인 완료된 보고서는 수정할 수 없습니다.',
          })
          : null;

    const currentCard = el('section', { className: 'card form-stack' }, [
      el('div', { className: 'card-header' }, [
        el('div', { className: 'approval-summary-left' }, [
          el('h3', { className: 'card-title', textContent: `이번 주 주간보고 (${current.weekStart} 주)` }),
          makeStatusBadge(current.status),
        ]),
        el('button', {
          type: 'button',
          className: 'btn btn-sm btn-outline',
          textContent: '+ 항목 추가',
          disabled: isLocked,
          onClick: () => addRow(),
        }),
      ]),
      statusBanner,
      el('div', { className: 'table-wrap' }, [
        el('table', { className: 'weekly-items-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { className: 'weekly-col-project', textContent: '프로젝트' }),
              el('th', { className: 'weekly-col-hours', textContent: '시간(h)' }),
              el('th', { textContent: '업무 내용' }),
              el('th', { className: 'weekly-col-action', textContent: '관리' }),
            ]),
          ]),
          tbody,
        ]),
      ]),
      el('div', { className: 'weekly-total-bar' }, [
        el('span', { textContent: '총 투입 시간' }),
        totalHoursEl,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '차주 계획' }),
        nextPlanInput,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '이슈 / 건의사항' }),
        issuesInput,
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [saveDraftBtn, submitBtn]),
    ]);

    const historyList = Array.isArray(pastReports) ? pastReports : [];
    const historyCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '지난 주간보고 목록' }),
        makeBadge(`총 ${historyList.length}건`, 'badge badge-neutral'),
      ]),
      historyList.length === 0
        ? el('div', { className: 'state-box', textContent: '작성된 주간보고 내역이 없습니다.' })
        : el('div', { className: 'stack-md' }, historyList.map((rep) => buildPastReportItem(rep))),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '주간보고' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team}` }),
          ]),
        ]),
        currentCard,
        historyCard,
      ])
    );
  }

  function buildWeeklyDetailContent(rep) {
    const items = Array.isArray(rep.items) ? rep.items : [];
    return el('div', { className: 'approval-detail-box' }, [
      items.length === 0
        ? el('div', { className: 'page-subtitle', textContent: '등록된 업무 항목이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '프로젝트' }),
                el('th', { textContent: '시간' }),
                el('th', { textContent: '업무 내용' }),
              ]),
            ]),
            el('tbody', {}, items.map((it) =>
              el('tr', {}, [
                el('td', { textContent: it.project || '-' }),
                el('td', { textContent: formatHours(it.hours) }),
                el('td', { textContent: it.content || '-' }),
              ])
            )),
          ]),
        ]),
      el('div', { className: 'detail-kv-grid' }, [
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '차주 계획' }),
          el('div', { className: 'detail-kv-value', textContent: rep.nextPlan || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '이슈 / 건의사항' }),
          el('div', { className: 'detail-kv-value', textContent: rep.issues || '-' }),
        ]),
        rep.comment
          ? el('div', {}, [
            el('div', { className: 'detail-kv-label', textContent: `결재 의견 (${rep.approverName || '팀장'})` }),
            el('div', { className: 'detail-kv-value', textContent: rep.comment }),
          ])
          : null,
      ]),
    ]);
  }

  function buildPastReportItem(rep) {
    const detailBox = buildWeeklyDetailContent(rep);
    setVisible(detailBox, false);
    const toggleBtn = el('button', {
      type: 'button',
      className: 'btn btn-sm btn-outline',
      textContent: '상세 보기',
    });
    toggleBtn.addEventListener('click', () => {
      const opening = detailBox.hidden;
      setVisible(detailBox, opening);
      toggleBtn.textContent = opening ? '접기' : '상세 보기';
    });

    return el('article', { className: 'approval-card' }, [
      el('div', { className: 'approval-summary-btn' }, [
        el('div', { className: 'approval-summary-left' }, [
          el('strong', { className: 'approval-summary-title', textContent: `${rep.weekStart} 주` }),
          makeStatusBadge(rep.status),
          el('span', { className: 'page-subtitle', textContent: `총 ${formatHours(rep.totalHours)}` }),
          rep.comment ? el('span', { className: 'page-subtitle', textContent: `의견: ${rep.comment}` }) : null,
        ]),
        toggleBtn,
      ]),
      detailBox,
    ]);
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
      const box = buildWeeklyDetailContent(d);
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
    const detailPanel = renderApprovalDetail(item);
    setVisible(detailPanel, false);

    const chevron = el('span', { className: 'card-link', textContent: '상세 보기 ▾' });
    const toggleDetail = () => {
      const opening = detailPanel.hidden;
      setVisible(detailPanel, opening);
      chevron.textContent = opening ? '접기 ▴' : '상세 보기 ▾';
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
      detailPanel,
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

    const [mineList] = await Promise.all([
      apiFetch(`/api/approvals/mine?userId=${encodeURIComponent(user.id)}`),
    ]);
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

  /* ---------- Route Dispatcher & Bootstrap ---------- */

  async function renderCurrentRoute() {
    state.route = parseRouteFromHash();
    syncSidebarActive();
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

    dom.userSelect.replaceChildren(...users.map((u) =>
      el('option', { value: String(u.id), textContent: `${u.name} (${u.team})` })
    ));
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
    bindGlobalEvents();
    initUsersAndStart();
  }

  bootstrap();
})();
