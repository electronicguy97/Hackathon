# 사내 그룹웨어 - 홈 · 출퇴근 · 주간보고 · 연차 · 승인 (해커톤 주제 ①)

## 1. 문제 정의

- 출퇴근, 주간보고, 연차 신청, 결재가 메신저·엑셀·구두로 흩어져 있어 이력 확인과 승인 상태 파악이 어렵다.
- 팀장은 오늘 누가 출근했고 누가 쉬는지, 어떤 결재가 대기 중인지 한눈에 보기 어렵다.

목표: 4개 업무를 한 앱에 묶고, 홈 대시보드에서 오늘 할 일과 대기 건을 바로 처리하게 한다.

## 2. 범위

국내 그룹웨어(다우오피스, 네이버웍스, 하이웍스, flex 등)에서 공통으로 제공하는 핵심 기능을 2시간 데모 규모로 줄였다.

| 메뉴 | 기능 |
|---|---|
| 홈 | 출근·퇴근 버튼, 잔여 연차, 결재 대기 건수, 이번 주 주간보고 상태, 오늘 팀 부재자, 공지사항 |
| 출퇴근 | 출근·퇴근 기록, 지각 표시(09:00 기준), 월별 근태 기록표와 합계, 팀장용 오늘 팀 근태 현황 |
| 주간보고 | 주차별 작성(업무 항목별 프로젝트·시간·내용, 차주 계획, 이슈), 임시저장·제출, 지난 보고 목록 |
| 연차 | 연차·반차 신청, 대기 건 취소, 잔여 연차, 내 신청 내역, 팀 월간 연차 캘린더 |
| 승인 | 팀장: 결재 대기(연차 + 주간보고)와 처리 완료 목록, 의견 입력 후 승인·반려 / 구성원: 내가 올린 결재 현황 |
| 공지사항 | 홈에 상위 3건 표시, 팀장 작성 가능, 상단 고정 |

## 3. 시연 시나리오 (8분 발표 중 약 3~4분)

1. `김신입`으로 접속 → 홈에서 출근 버튼 클릭 → 출근 시각과 지각 여부 표시
2. 연차 메뉴에서 2일 신청 → 홈의 잔여 연차 카드에 대기 2일 반영
3. 주간보고 메뉴에서 이번 주 보고 작성 → 제출
4. `박팀장`으로 전환 → 홈의 결재 대기 2건 → 승인 메뉴에서 연차 승인, 주간보고 반려(의견: "이슈 항목 보완")
5. `김신입`으로 전환 → 승인 메뉴에서 결과와 의견 확인 → 주간보고 수정 후 재제출
6. 상단 홈 버튼으로 복귀 → 잔여 연차 13일, 오늘 팀 부재자, 공지 확인

## 4. 구조

- 의존성 없는 Node.js(v22.5 이상, 내장 `node:http` + `node:sqlite`)
- 실행: `cd groupware` → `node server.js` → http://localhost:3000
- 데이터: `groupware/data/groupware.db` (최초 실행 시 자동 생성 및 시드). 스키마가 바뀌면 `data/`를 지우고 재실행한다.
- 날짜·시각은 서버 로컬 시간 기준. 날짜 `YYYY-MM-DD`, 시각 `HH:MM`, 생성·처리 일시는 ISO 8601.
- 화면: `public/` 정적 파일(HTML·CSS·바닐라 JS), 해시 라우팅 `#/home`, `#/attendance`, `#/weekly`, `#/leave`, `#/approvals`

```
groupware/
  DESIGN.md        설계안 (이 문서)
  SCREENS.md       화면 설계 (agy)
  server.js        API + 정적 파일 서버 (codex)
  smoke-test.mjs   API 시나리오 테스트 (codex)
  public/          index.html, style.css, app.js (agy)
  data/            SQLite 파일 (실행 시 생성, git 제외)
```

데모용이므로 로그인 대신 상단에서 사용자를 전환한다. 요청마다 현재 사용자 id를 함께 보낸다.

## 5. 데이터 모델

**users**: id, name, role(`employee`|`manager`), team, annual_total(REAL)
시드: 1 김신입(employee, 개발팀, 15) · 2 이분석(employee, 개발팀, 15) · 3 박팀장(manager, 개발팀, 20)

**leave_requests**: id, user_id, type(`annual`|`half_am`|`half_pm`), start_date, end_date, days(REAL, 서버 계산: 평일 수, 반차 0.5), reason, status(`pending`|`approved`|`rejected`|`cancelled`), approver_id, comment, created_at, decided_at

**attendance**: id, user_id, work_date, check_in(`HH:MM`), check_out(`HH:MM` 또는 NULL). (user_id, work_date) 유일.
시드: 이번 달 1일부터 어제까지의 평일에 3명 모두 기록 생성(08:40~09:10 출근, 18:00~19:30 퇴근, 사람마다 지각 1~2회). 값은 고정 규칙으로 만들어 실행할 때마다 같게 한다.

**weekly_reports**: id, user_id, week_start(해당 주 월요일), items(JSON 배열 `[{project, hours, content}]`), next_plan, issues, status(`draft`|`submitted`|`approved`|`rejected`), approver_id, comment, submitted_at, decided_at, updated_at. (user_id, week_start) 유일.
시드: 김신입·이분석의 지난주 보고를 `approved`로 1건씩.

**notices**: id, author_id, title, body, pinned(0|1), created_at
시드: 3건(예: 워크샵 해커톤 안내(고정), 연말 연차 사용 권장, 사내 시스템 점검 안내)

계산 규칙:
- 잔여 연차 = annual_total - 승인된 days 합계. 대기 = pending days 합계. 신청 시 `잔여 - 대기 < 신청 일수`면 거절.
- 지각 = check_in > `09:00`. 근무 분 = check_out - check_in(퇴근 전이면 0).
- 이번 주 = 오늘이 속한 주의 월요일.

## 6. API 계약

요청·응답은 JSON, 필드명은 camelCase. 오류는 4xx와 `{ "error": "사용자에게 보여줄 한국어 메시지" }`.
공통: 잘못된 형식이나 누락 400, 권한 없음(팀장 아님 또는 다른 팀) 403, 대상 없음 404, 상태 충돌 409.

### 공통 · 홈

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/users` | | `[{id, name, role, team}]` |
| GET | `/api/home?userId=` | | 아래 참조 |
| GET | `/api/notices` | | 고정 우선, 최신순 `[{id, authorName, title, body, pinned, createdAt}]` |
| POST | `/api/notices` | `{userId, title, body, pinned}` | 201, 생성된 공지 (팀장만, 아니면 403) |

`/api/home` 응답:

```json
{
  "user": {"id": 1, "name": "김신입", "role": "employee", "team": "개발팀"},
  "today": "2026-11-26",
  "attendance": {"checkIn": "08:55", "checkOut": null, "status": "working", "late": false},
  "balance": {"total": 15, "used": 0, "pending": 2, "remaining": 15},
  "weeklyReport": {"weekStart": "2026-11-23", "status": "none"},
  "myPendingCount": 1,
  "approvalPendingCount": 0,
  "teamOnLeaveToday": [{"userName": "이분석", "type": "annual"}],
  "notices": [{"id": 1, "title": "...", "pinned": true, "createdAt": "..."}]
}
```

`attendance.status`: `none`(미출근), `working`, `done`. `weeklyReport.status`: `none` 또는 보고서 상태. `approvalPendingCount`는 팀장만 의미 있음(구성원은 0). `myPendingCount`는 내가 올린 대기 건(연차 + 주간보고).

### 출퇴근

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | `/api/attendance/check-in` | `{userId}` | 201, 오늘 기록. 이미 출근이면 409 |
| POST | `/api/attendance/check-out` | `{userId}` | 200, 오늘 기록. 미출근이거나 이미 퇴근이면 409 |
| GET | `/api/attendance?userId=&month=YYYY-MM` | | `{records: [{workDate, checkIn, checkOut, workMinutes, late}], summary: {days, totalMinutes, lateCount}}` (날짜 오름차순) |
| GET | `/api/attendance/team?managerId=` | | 팀원별 오늘 현황 `[{userId, userName, checkIn, checkOut, status, late, onLeave}]` (팀장 아니면 403) |

### 주간보고

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/weekly-reports/current?userId=` | | 이번 주 보고. 없으면 `{weekStart, status: "none", items: [], nextPlan: "", issues: ""}` |
| GET | `/api/weekly-reports?userId=` | | 내 보고 목록(최신 주 우선) |
| PUT | `/api/weekly-reports` | `{userId, weekStart, items, nextPlan, issues, submit}` | 200, 저장된 보고. `submit: true`면 `submitted`, 아니면 `draft`. 현재 `submitted`·`approved`면 409. 제출 시 items 1개 이상, 각 hours는 0 초과 |
| POST | `/api/weekly-reports/:id/approve` | `{approverId, comment}` | 200 (submitted만, 아니면 409) |
| POST | `/api/weekly-reports/:id/reject` | `{approverId, comment}` | 200 (submitted만, 반려 시 comment 필수) |

보고 객체: `{id, userId, userName, weekStart, items, totalHours, nextPlan, issues, status, approverId, approverName, comment, submittedAt, decidedAt, updatedAt}`

### 연차

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/users/:id/balance` | | `{total, used, pending, remaining}` |
| GET | `/api/leave-requests?userId=` | | 내 신청 목록(최신순) |
| POST | `/api/leave-requests` | `{userId, type, startDate, endDate, reason}` | 201, 생성된 신청 |
| POST | `/api/leave-requests/:id/cancel` | `{userId}` | 200, 본인 `pending`만 `cancelled`로 (아니면 403/409) |
| POST | `/api/leave-requests/:id/approve` | `{approverId, comment}` | 200 |
| POST | `/api/leave-requests/:id/reject` | `{approverId, comment}` | 200 |
| GET | `/api/leave-calendar?userId=&month=YYYY-MM` | | 해당 사용자 팀의 그 달과 겹치는 `pending`·`approved` 신청 `[{id, userName, type, startDate, endDate, days, status}]` |

신청 객체: `{id, userId, userName, type, startDate, endDate, days, reason, status, approverId, approverName, comment, createdAt, decidedAt}`
검증(400): 필수 누락, 날짜 형식, `endDate < startDate`, 반차인데 시작일 ≠ 종료일, 평일 0일, 잔여 부족 `"잔여 연차가 부족합니다 (가능: X일)"`.

### 승인 (연차 + 주간보고 통합)

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/approvals?approverId=` | 팀의 대기 건(오래된 순) |
| GET | `/api/approvals/history?approverId=` | 내가 처리한 건(처리일 최신순) |
| GET | `/api/approvals/mine?userId=` | 내가 올린 건(연차: cancelled 제외 전체, 주간보고: draft 제외), 최신순 |

세 API 모두 항목 형태가 같다. 팀장이 아니면 `/api/approvals`, `/history`는 403.

```json
{
  "kind": "leave",
  "id": 3, "userId": 1, "userName": "김신입",
  "title": "연차 2일 (2026-12-01 ~ 2026-12-02)",
  "status": "pending",
  "createdAt": "...", "decidedAt": null,
  "detail": { "...": "연차 신청 객체 또는 주간보고 객체 전체" }
}
```

`kind`: `leave` 또는 `weekly`. 주간보고 title 예: `주간보고 2026-11-23 주 (총 40시간)`. 승인·반려는 kind에 따라 `/api/leave-requests/:id/...` 또는 `/api/weekly-reports/:id/...`를 호출한다.

## 7. 화면 구성 (상세는 SCREENS.md)

- 상단 바: 홈 버튼(로고 + "홈", 어느 화면에서든 `#/home`으로 이동), 사용자 전환 드롭다운, 역할 배지
- 좌측 목차(모바일에서는 상단 가로 메뉴): 홈 / 출퇴근 / 주간보고 / 연차 / 승인. 현재 메뉴 강조, 승인 옆에 대기 건수 배지(팀장)
- 홈: 출퇴근 카드(버튼 포함), 잔여 연차 카드, 결재 대기 카드, 주간보고 카드(작성하기 바로가기), 오늘 팀 부재자, 공지사항(팀장은 작성 버튼)
- 출퇴근: 오늘 기록과 버튼, 월 선택 + 근태 기록표 + 합계, 팀장용 팀 현황 표
- 주간보고: 이번 주 작성 폼(항목 행 추가·삭제, 합계 시간 자동 계산, 임시저장·제출), 반려 의견 표시, 지난 보고 목록
- 연차: 잔여 카드, 신청 폼, 내 신청 내역(대기 건 취소 버튼), 팀 월간 캘린더
- 승인: 팀장은 "결재 대기 / 처리 완료" 탭, 구성원은 "내가 올린 결재" 목록. 항목 클릭 시 상세(연차 정보 또는 주간보고 전체)

## 8. 역할 분담 (해커톤 제출용 예시)

| 담당 | 업무 |
|---|---|
| 신입 | 문제 정의, 화면 기획(SCREENS.md 검토·수정), 발표 |
| 개발 | server.js, 화면 구현, Demo |
| 분석 | 요구사항, 데이터 모델·검증 규칙 |

## 9. 대안: Microsoft 365 (SharePoint)

사내 M365를 쓰는 경우 SharePoint 목록과 Power Automate 승인 흐름으로도 같은 시나리오를 만들 수 있다. 테넌트 화면에서 직접 구성해야 해서 이번에는 코드로 구현하고 예비안으로 둔다.
