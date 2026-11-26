# 사내 그룹웨어 - 홈 · 출퇴근 · 주간보고 · 연차 · 승인 (해커톤 주제 ①)

## 1. 문제 정의

- 출퇴근, 주간보고, 연차 신청, 결재가 메신저·엑셀·구두로 흩어져 있어 이력 확인과 승인 상태 파악이 어렵다.
- 팀장은 오늘 누가 출근했고 누가 쉬는지, 어떤 결재가 대기 중인지 한눈에 보기 어렵다.
- 주간보고는 개인별 엑셀 파일로 오가서 팀장이 팀 단위로 모아 보기 어렵고, 임원은 팀별 현황을 비교하려면 파일을 일일이 열어야 한다.

목표: 4개 업무를 한 앱에 묶고, 홈 대시보드에서 오늘 할 일과 대기 건을 바로 처리하게 한다.

## 2. 범위

국내 그룹웨어(다우오피스, 네이버웍스, 하이웍스, flex 등)에서 공통으로 제공하는 핵심 기능을 2시간 데모 규모로 줄였다.

| 메뉴 | 기능 |
|---|---|
| 홈 | 출근·퇴근 버튼, 잔여 연차, 결재 대기 건수, 이번 주 주간보고 상태, 오늘 팀 부재자, 공지사항 |
| 출퇴근 | 출근·퇴근 기록, 지각 표시(09:00 기준), 월별 근태 기록표와 합계, 팀장용 오늘 팀 근태 현황 |
| 주간보고 | 사내 엑셀 양식과 같은 형태로 작성(금주 실적과 차주 계획을 나란히, 요일별 업무 행), 지난주 차주 계획을 금주 실적에 자동으로 채움, 임시저장·제출, 지난 보고 목록 |
| 주간보고 - 팀 종합 (팀장) | 주차별 팀원 제출 현황, 프로젝트별 시간 합계, 이슈·요청·개인일정 모음, 팀원 보고 상세, 팀 종합 의견 작성 |
| 주간보고 - 팀별 현황 (임원) | 주차별 전체 팀 요약 카드(제출률, 총 시간, 프로젝트별 시간, 이슈·요청, 팀장 종합 의견), 팀 선택 시 팀 종합 화면과 팀원 보고 열람(읽기 전용) |
| 연차 | 연차·반차 신청, 대기 건 취소, 잔여 연차, 내 신청 내역, 팀 월간 연차 캘린더 |
| 승인 | 팀장: 결재 대기(연차 + 주간보고)와 처리 완료 목록, 의견 입력 후 승인·반려 / 구성원: 내가 올린 결재 현황 |
| 공지사항 | 홈에 상위 3건 표시, 팀장 작성 가능, 상단 고정 |
| 회의실 예약 (마곡 사무실) | 날짜별 회의실 × 시간대 예약 현황표, 빈 시간 선택 후 예약(제목·참석자), 중복 예약 차단, 내 예약 목록과 취소, 홈에 오늘 내 회의 표시 |

## 3. 시연 시나리오 (8분 발표 중 약 3~4분)

1. `김신입`으로 접속 → 홈에서 출근 버튼 클릭 → 출근 시각과 지각 여부 표시
2. 연차 메뉴에서 2일 신청 → 홈의 잔여 연차 카드에 대기 2일 반영
3. 주간보고 메뉴 → 금주 실적에 지난주 차주 계획이 미리 채워져 있음 → 실적·차주 계획·이슈 수정 → 제출
4. `박팀장`으로 전환 → 홈의 결재 대기 2건 → 승인 메뉴에서 연차 승인, 주간보고 반려(의견: "이슈 항목 보완")
5. `김신입`으로 전환 → 승인 메뉴에서 결과와 의견 확인 → 주간보고 수정 후 재제출
6. `박팀장` → 주간보고(팀 종합): 제출 현황, 프로젝트별 시간, 이슈·요청 모음 확인 → 김신입 보고 승인 → 팀 종합 의견 저장
7. `강상무`(임원) → 주간보고(팀별 현황): 개발팀·데이터팀 요약 비교 → 개발팀 선택 → 팀장 종합 의견과 팀원 보고 열람
8. 회의실 예약 → 오늘 빈 시간에 소회의실 A 예약 → 같은 시간 중복 예약 시 오류 확인
9. 상단 홈 버튼으로 복귀 → 오늘 내 회의, 잔여 연차, 오늘 팀 부재자, 공지 확인

## 4. 구조

- 의존성 없는 Node.js(v22.5 이상, 내장 `node:http` + `node:sqlite`)
- 실행: `cd groupware` → `node server.js` → http://localhost:3000
- 데이터: `groupware/data/groupware.db` (최초 실행 시 자동 생성 및 시드). 스키마가 바뀌면 `data/`를 지우고 재실행한다.
- 날짜·시각은 서버 로컬 시간 기준. 날짜 `YYYY-MM-DD`, 시각 `HH:MM`, 생성·처리 일시는 ISO 8601.
- 화면: `public/` 정적 파일(HTML·CSS·바닐라 JS), 해시 라우팅 `#/home`, `#/attendance`, `#/weekly`, `#/leave`, `#/approvals`, `#/rooms`

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

**users**: id, name, role(`employee`|`manager`|`executive`), team, annual_total(REAL)
시드(이름은 모두 가상):
- 개발팀: 1 김신입(employee, 15) · 2 이분석(employee, 15) · 3 박팀장(manager, 20)
- 데이터팀: 4 최데이터(employee, 15) · 5 정연구(employee, 15) · 6 한팀장(manager, 20)
- 경영진: 7 강상무(executive, 20)

팀장은 자기 팀 구성원의 연차·주간보고를 결재한다. 팀장 본인은 개인 주간보고 대신 팀 종합 의견을 쓴다. 임원은 모든 팀의 주간보고를 읽기만 하고 결재하지 않는다.

**leave_requests**: id, user_id, type(`annual`|`half_am`|`half_pm`), start_date, end_date, days(REAL, 서버 계산: 평일 수, 반차 0.5), reason, status(`pending`|`approved`|`rejected`|`cancelled`), approver_id, comment, created_at, decided_at

**attendance**: id, user_id, work_date, check_in(`HH:MM`), check_out(`HH:MM` 또는 NULL). (user_id, work_date) 유일.
시드: 이번 달 1일부터 어제까지의 평일에 3명 모두 기록 생성(08:40~09:10 출근, 18:00~19:30 퇴근, 사람마다 지각 1~2회). 값은 고정 규칙으로 만들어 실행할 때마다 같게 한다.

**weekly_reports**: id, user_id, week_start(해당 주 월요일), current_json(금주 실적), next_json(차주 계획), status(`draft`|`submitted`|`approved`|`rejected`), approver_id, comment, submitted_at, decided_at, updated_at. (user_id, week_start) 유일.

사내 엑셀 양식 구조를 그대로 옮긴다. 한 보고서 = 금주 실적 + 차주 계획이고, 둘은 같은 형태(WeekPart)다.

```json
{
  "personalSchedule": "없음",
  "issues": "",
  "requests": "없음",
  "entries": [
    {"day": "mon", "category": "사내 그룹웨어", "workType": "회사", "content": "- 요구사항 정리\n- 화면 설계", "hours": 7},
    {"day": "mon", "category": "운영 지원", "workType": "회사", "content": "- 서버 모니터링", "hours": 1}
  ]
}
```

- 양식 항목 대응: 개인일정(휴가 등) = personalSchedule, 이슈사항 = issues, 요청사항/전달사항 = requests, 요일 = day(`mon`~`fri`), 구분 = category(프로젝트명), 형태 = workType(`회사`|`재택`|`출장`|`외근`|`휴가`), 진행 계획·내용 = content(여러 줄), 예상 소요시간 = hours
- hours는 0 초과 24 이하, 하루 합계 24 이하. 제출 시 금주 실적 entries 1개 이상
- 주차 표기: 해당 주 목요일이 속한 달 기준, 주차 = ceil(목요일 날짜 / 7). 예: 11/23 주 → `11월 4주차(11/23 ~ 11/27)`, 11/30 주 → `12월 1주차(11/30 ~ 12/04)`

시드(내용은 가상 프로젝트명만 사용: 사내 그룹웨어, AI 챗봇 PoC, 데이터 대시보드, 운영 지원 등):
- 지난주: 1·2·4·5번의 보고 `approved`, 두 팀의 팀 종합 의견
- 이번 주: 4번 `submitted`, 5번 `draft`. 개발팀(1·2번)은 비워 두어 시연에서 작성

**team_summaries**: id, team, week_start, manager_id, summary(팀장 종합 의견), updated_at. (team, week_start) 유일.

**rooms**: id, office, name, capacity, equipment
시드(마곡 사무실, 실제 회의실 이름으로 바꿔 쓰는 예시): 1 대회의실(12인, TV·화상회의) · 2 중회의실(8인, TV) · 3 소회의실 A(4인) · 4 소회의실 B(4인)

**room_reservations**: id, room_id, user_id, date, start_time, end_time(`HH:MM`), title, attendees(자유 입력), status(`reserved`|`cancelled`), created_at
- 예약 가능 시간 08:00~20:00, 30분 단위, 시작 < 종료
- 같은 회의실·같은 날짜에서 `reserved`끼리 시간이 겹치면(start < 상대 end 그리고 end > 상대 start) 거절
- 시드: 오늘과 다음 평일에 가상 회의 4~5건(예: 개발팀 주간 회의, 데이터팀 스프린트 리뷰)

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
| GET | `/api/weekly-reports/current?userId=` | | 이번 주 보고. 없으면 `status: "none"`인 템플릿: `current.entries`에 지난주 보고의 `next.entries`를 복사하고, 나머지는 빈 값 |
| GET | `/api/weekly-reports?userId=` | | 내 보고 목록(최신 주 우선) |
| PUT | `/api/weekly-reports` | `{userId, weekStart, current, next, submit}` | 200, 저장된 보고. `submit: true`면 `submitted`, 아니면 `draft`. 현재 `submitted`·`approved`면 409. 팀장·임원은 403 |
| POST | `/api/weekly-reports/:id/approve` | `{approverId, comment}` | 200 (submitted만, 아니면 409) |
| POST | `/api/weekly-reports/:id/reject` | `{approverId, comment}` | 200 (submitted만, 반려 시 comment 필수) |
| GET | `/api/weekly-reports/team?viewerId=&weekStart=&team=` | | 팀 종합(아래). 팀장은 team 생략 시 자기 팀, 다른 팀이면 403. 임원은 team 필수. 그 외 403. weekStart 생략 시 이번 주 |
| PUT | `/api/team-summaries` | `{managerId, weekStart, summary}` | 200, 팀 종합 의견 저장(팀장만) |
| GET | `/api/executive/weekly?executiveId=&weekStart=` | | 전체 팀 요약(아래). 임원만, 아니면 403 |

보고 객체: `{id, userId, userName, team, weekStart, weekLabel, nextWeekLabel, current, next, totalHours, nextTotalHours, status, approverId, approverName, comment, submittedAt, decidedAt, updatedAt}` (`current`·`next`는 WeekPart, `totalHours`·`nextTotalHours`는 각 entries 시간 합계)

팀 종합 응답:

```json
{
  "team": "개발팀", "weekStart": "2026-11-23", "weekLabel": "11월 4주차(11/23 ~ 11/27)",
  "managerName": "박팀장",
  "stats": {"memberCount": 2, "submittedCount": 1, "approvedCount": 0, "totalHours": 40},
  "members": [{"userId": 1, "userName": "김신입", "status": "submitted", "totalHours": 40, "report": {"...": "보고 객체, 미작성이면 null"}}],
  "projectHours": [{"category": "사내 그룹웨어", "hours": 30}],
  "issues": [{"userName": "김신입", "text": "..."}],
  "requests": [{"userName": "김신입", "text": "..."}],
  "personalSchedules": [{"userName": "김신입", "text": "..."}],
  "teamSummary": {"summary": "...", "managerName": "박팀장", "updatedAt": "..."}
}
```

- members는 팀의 employee 전원(미작성은 `status: "none"`). 임원이 볼 때는 draft 보고의 `report`를 null로 준다.
- 집계(stats.totalHours, projectHours, issues, requests, personalSchedules)는 `submitted`·`approved` 보고의 금주 실적만 대상. 빈 값과 "없음"은 모음에서 제외. projectHours는 시간 내림차순.
- submittedCount = submitted + approved, teamSummary는 없으면 null.

`/api/executive/weekly` 응답: `{weekStart, weekLabel, teams: [팀 종합 응답에서 members를 뺀 것]}` (executive 팀 제외, 팀 이름순)

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

### 회의실 예약

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/rooms` | | `[{id, office, name, capacity, equipment}]` |
| GET | `/api/room-reservations?date=YYYY-MM-DD` | | 그날 `reserved` 예약 전체(회의실, 시작 시각 순) |
| GET | `/api/room-reservations/mine?userId=` | | 오늘 이후 내 `reserved` 예약(날짜·시각 순) |
| POST | `/api/room-reservations` | `{userId, roomId, date, startTime, endTime, title, attendees}` | 201, 생성된 예약. 형식 오류·과거 날짜·운영 시간 밖·30분 단위 아님·제목 누락은 400, 겹치면 409 `"이미 예약된 시간입니다 (10:00~11:00, 박팀장)"` |
| POST | `/api/room-reservations/:id/cancel` | `{userId}` | 200, 본인 예약만(아니면 403), 이미 취소면 409 |

예약 객체: `{id, roomId, roomName, userId, userName, team, date, startTime, endTime, title, attendees, status, createdAt}`

`/api/home` 응답에 `myReservationsToday: [{id, roomName, startTime, endTime, title}]`(오늘 내 예약, 시각 순)를 추가한다.

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
- 좌측 목차(모바일에서는 상단 가로 메뉴): 홈 / 출퇴근 / 주간보고 / 연차 / 승인 / 회의실 예약. 현재 메뉴 강조, 승인 옆에 대기 건수 배지(팀장). 사용자 전환 목록은 팀별로 묶어 보여 준다
- 홈: 출퇴근 카드(버튼 포함), 잔여 연차 카드, 결재 대기 카드, 주간보고 카드(작성하기 바로가기), 오늘 팀 부재자, 공지사항(팀장은 작성 버튼)
- 출퇴근: 오늘 기록과 버튼, 월 선택 + 근태 기록표 + 합계, 팀장용 팀 현황 표
- 주간보고는 역할에 따라 다른 화면을 보여 준다. 모두 주차 이동(이전·다음 주) 가능
  - 구성원: 엑셀 양식과 같은 2단 표. 상단에 주차 라벨(금주 | 차주), 개인일정·이슈사항·요청사항 행, 그 아래 요일(월~금)별 업무 행(구분, 형태, 내용, 소요시간)과 행 추가·삭제, 요일별·주간 합계 시간 자동 계산. 임시저장·제출, 반려 의견 표시, 지난 보고 목록. 좁은 화면에서는 금주·차주를 탭으로 전환
  - 팀장(팀 종합): 제출 현황 카드, 팀원 목록(상태 배지, 시간, 클릭 시 양식 그대로 읽기 전용 보고), 프로젝트별 시간 막대, 이슈·요청·개인일정 모음, 승인·반려 바로가기, 팀 종합 의견 입력
  - 임원(팀별 현황): 팀별 요약 카드(제출률, 총 시간, 상위 프로젝트, 이슈·요청 건수, 팀장 종합 의견 미리보기). 카드 클릭 시 팀 종합 화면을 읽기 전용으로 표시
- 회의실 예약(마곡): 날짜 이동(이전·오늘·다음), 회의실(행) × 08:00~20:00 30분 칸(열) 현황표, 예약된 칸에 제목·예약자 표시(내 예약은 다른 색), 빈 칸 클릭 시 예약 폼(회의실·날짜·시작·종료 미리 채움, 제목·참석자 입력), 내 예약 목록과 취소. 좁은 화면에서는 회의실별 목록으로 전환
- 임원 메뉴: 홈 / 주간보고(팀별 현황) / 회의실 예약. 출퇴근·연차·승인 메뉴는 숨긴다. 임원 홈은 팀별 주간보고 요약, 오늘 내 회의, 공지
- 모든 역할의 홈에 "오늘 내 회의" 카드(없으면 회의실 예약 바로가기)
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
