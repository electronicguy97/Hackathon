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
| 주간보고 | 사내 엑셀 양식(xlsx)을 끌어다 놓으면 서버가 읽어 금주 실적·차주 계획으로 저장, 읽은 내용 미리보기 후 제출, 원본 파일 보관·다운로드, 지난 보고 목록 (웹에서 직접 작성하는 화면은 없음) |
| 주간보고 - 팀 종합 (팀장) | 주차별 팀원 제출 현황, 프로젝트별 시간 합계, 이슈·요청·개인일정 모음, 팀원 보고 상세, 팀 종합 의견 작성 |
| 주간보고 - 팀별 현황 (임원) | 주차별 전체 팀 요약 카드(제출률, 총 시간, 프로젝트별 시간, 이슈·요청, 팀장 종합 의견), 팀 선택 시 팀 종합 화면과 팀원 보고 열람(읽기 전용) |
| 연차 | 연차·반차 신청, 대기 건 취소, 잔여 연차, 내 신청 내역, 팀 월간 연차 캘린더 |
| 승인 | 팀장: 결재 대기(연차 + 주간보고)와 처리 완료 목록, 의견 입력 후 승인·반려 / 구성원: 내가 올린 결재 현황 |
| 공지사항 | 홈에 상위 3건 표시, 팀장 작성 가능, 상단 고정 |
| 문서 (위키) | Confluence·Jira 느낌의 문서 공간: 스페이스별 페이지 목록, 마크다운 문서 보기(표·목록·제목), 작성·수정, 키워드 검색. 챗봇이 질문과 관련된 문서 구간을 찾아 일정·내용을 답하고 출처를 단다 |
| 회의실 예약 (마곡 사무실) | 날짜별 회의실 × 시간대 예약 현황표, 빈 시간 선택 후 예약(제목·참석자), 중복 예약 차단, 내 예약 목록과 취소, 홈에 오늘 내 회의 표시 |

## 3. 시연 시나리오 (8분 발표 중 약 3~4분)

1. `김신입`으로 접속 → 홈에서 출근 버튼 클릭 → 출근 시각과 지각 여부 표시
2. 연차 메뉴에서 2일 신청 → 홈의 잔여 연차 카드에 대기 2일 반영
3. 주간보고 메뉴 → 평소 쓰던 주간보고 xlsx를 끌어다 놓기 → 읽은 내용(금주 실적·차주 계획) 미리보기 확인 → 제출
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

**주간보고 xlsx 읽기 규칙** (외부 라이브러리 없이 Node 내장 `zlib`으로 zip을 풀고 XML을 읽는다)
- 첫 번째 시트만 읽는다. 공유 문자열(sharedStrings), 인라인 문자열, 숫자 셀, 병합 셀을 처리한다. 수식 오류(`#REF!` 등)는 빈 값으로 본다.
- 1행: B1 = 금주 주차 라벨, F1 = 차주 주차 라벨(예: `11월 4주차(11/23 ~ 11/27)`). 라벨의 `(MM/DD`에서 월요일 날짜를 구해 weekStart로 쓴다(연도는 오늘과 가장 가까운 해). 라벨을 못 읽으면 400.
- A열 라벨로 위쪽 항목을 찾는다: `개인일정`으로 시작 → personalSchedule, `이슈` → issues, `요청` → requests. 금주 값은 B열, 차주 값은 F열.
- A열이 `요일`인 행이 머리글. 그 아래 행에서 A열의 `월`~`금`(병합 셀이므로 다음 요일이 나올 때까지 이어짐)을 day로, 금주는 B(구분)·C(형태)·D(내용)·E(시간), 차주는 F·G·H·I로 읽는다. 구분과 내용이 모두 빈 행은 건너뛴다. 요일 블록이 끝난 뒤의 합계 행은 무시한다.
- 형태가 목록(회사·재택·출장·외근·휴가)에 없으면 그대로 두지 않고 `회사`로 바꾸고 경고. 시간이 비었거나 숫자가 아니면 0으로 두고 경고. 하루 합계 24 초과는 경고.
- 업로드 보고는 직접 입력 검증(시간 0 초과 등) 대신 위 규칙과 경고만 적용한다. 제출 조건은 금주 실적 entries 1개 이상.
- 원본은 `data/uploads/<보고 id>.xlsx`에 저장하고 weekly_reports에 `file_name`(원래 파일명)을 둔다.
- 저장소가 공개 상태이므로 실제 주간보고 파일은 저장소에 넣지 않는다. 테스트용 xlsx는 가상 내용으로 테스트 코드가 직접 만든다.

**team_summaries**: id, team, week_start, manager_id, summary(팀장 종합 의견), updated_at. (team, week_start) 유일.

**docs**: id, space(스페이스 이름), doc_key(예: `GW`), title, body(마크다운), labels(쉼표 구분), author_id, updated_by, created_at, updated_at
- 시드 2건(모두 가상 내용, 본문 첫 줄에 "> 예시 문서입니다. 실제 일정·규정이 아닙니다." 표시):
  1. 스페이스 `그룹웨어 프로젝트`, 제목 `그룹웨어 v1 출시 일정`: 개요, 마일스톤 표(단계·기간·담당·상태: 요구사항 정리 11/23~11/27 김신입 완료, 화면 설계 11/30~12/04 이분석 진행 중, API 개발 12/07~12/18 박사원 예정, 사내 시범 운영 12/21~12/24 박팀장 예정, 정식 오픈 2027-01-04), 작업 목록 표(이슈 키 GW-101~GW-106, 요약, 담당, 기한, 상태), 정기 회의(매주 월 10:00 주간 회의 · 중회의실, 매주 목 16:00 데모 리뷰), 리스크
  2. 스페이스 `사내 가이드`, 제목 `연차·회의실 이용 가이드`: 연차 신청 기준(사용 3일 전까지 신청 권장, 반차 시간 오전 09:00~14:00 · 오후 14:00~18:00, 연말 미사용 연차 안내), 결재 흐름(구성원 → 팀장, 반려 시 의견 확인 후 재신청), 회의실 예약 규칙(30분 단위, 08:00~20:00, 사용하지 않으면 미리 취소, 대회의실은 팀장 이상 우선), 문의처(경영지원팀 내선 100)
- 검색 단위(구간): 본문을 `##`·`###` 제목 기준으로 나눈 조각. 제목 없는 앞부분은 문서 제목을 구간 제목으로 쓴다.

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
| POST | `/api/weekly-reports/upload?userId=&fileName=` | 요청 본문 = xlsx 파일 바이트(`application/octet-stream`, 2MB 이하) | 200 `{report, warnings}`. 파일을 읽어 해당 주 보고를 `draft`로 저장(이미 있으면 덮어씀)하고 원본 보관. 현재 `submitted`·`approved`면 409, 팀장·임원 403, 양식을 읽을 수 없으면 400 |
| POST | `/api/weekly-reports/:id/submit` | `{userId}` | 200, 본인 `draft`·`rejected`만 `submitted`로(아니면 403/409). 금주 실적 entries가 없으면 400 |
| GET | `/api/weekly-reports/:id/file?viewerId=` | | 원본 xlsx 다운로드(`Content-Disposition` 포함). 작성자, 같은 팀 팀장, 임원만(아니면 403), 원본이 없으면 404 |
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

### 문서 (위키)

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/docs` | | `[{id, space, docKey, title, labels, updatedByName, updatedAt}]` (스페이스, 제목순) |
| GET | `/api/docs/:id` | | 문서 객체 `{id, space, docKey, title, body, labels, authorName, updatedByName, createdAt, updatedAt}` |
| POST | `/api/docs` | `{userId, space, title, body, labels}` | 201, 생성된 문서. 제목·본문 필수, 본문 20000자 이하 |
| PUT | `/api/docs/:id` | `{userId, title, body, labels}` | 200, 수정된 문서(누구나 수정 가능, updated_by 갱신) |
| GET | `/api/docs/search?q=&limit=5` | | `[{docId, title, space, heading, excerpt, score}]` 점수 내림차순, 0점 제외 |

검색 점수(라이브러리 없이): 질문과 구간을 공백·문장부호로 나누고 흔한 조사(은·는·이·가·을·를·에·의·로·으로·와·과·도·만·까지·부터·에서·요)를 떼어 낸 단어 일치 + 한글 두 글자 묶음(bigram) 일치를 합산. 구간 제목·문서 제목 일치는 가중치를 더 준다. excerpt는 구간 본문 앞 300자(마크다운 그대로).

챗봇 연동(`assistant.js`):
- 새 의도 `doc_question`: 문서·위키·가이드·규정·일정·마일스톤·출시·오픈·이슈 키(`GW-123`)·담당·기한·언제 등이 들어간 질문, 또는 일반 질문 중 문서 검색 최고 점수가 기준 이상인 경우
- 상위 구간 3개를 근거로 쓴다. LLM이 있으면 "주어진 문서 구간만 근거로, 없으면 모른다고" 답하게 하고, 없으면 "문서에서 찾은 내용이에요" + 상위 1~2개 구간 요약(앞부분 인용)으로 답한다.
- 응답에 `citations: [{docId, title, heading}]`를 추가하고, `action`은 `{kind: "navigate", route: "docs", docId, label: 문서 제목}`
- 근거가 없으면 "문서에서 찾지 못했어요"와 문서 메뉴 안내

### 업무 챗봇 (우측 하단, 팀원 kimzoo 구현을 확장)

- 파일: `assistant.js`(문장 해석·답변), `server.js`의 `/api/chat`, `/api/chat/story`, `public/chatbot.js`·`chatbot.css`
- LLM은 선택 사항: `groupware/.env`의 `LLM_PROVIDER`(anthropic | azure | openai). 비었거나 실패·시간 초과면 규칙 기반 해석으로 대체. 테스트는 규칙 기반으로만 한다.
- 챗봇은 동작을 제안만 하고, 실행은 사용자가 카드에서 확인한 뒤 화면이 기존 API를 호출한다.

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | `/api/chat` | `{userId, text}` (500자 이내) | `{reply, source: "rule"\|"llm", warning, action}` |
| POST | `/api/chat/story` | `{type, startDate, endDate, avoid}` | `{story, source}` |

`action.kind`와 payload:

| kind | payload | 화면 동작 |
|---|---|---|
| `navigate` | `{route, label, auto}` | route: home, attendance, weekly, leave, approvals, rooms |
| `check_in`, `check_out` | 없음 | 출퇴근 API 호출 |
| `leave` | `{payload: {type, startDate, endDate, reason}, days, story}` | 연차 신청 API |
| `weekly` | `{payload: {weekStart, current: {entries, issues, requests, personalSchedule}, next: {entries}}, canSubmit}` | 아래 병합 규칙 후 `PUT /api/weekly-reports` |
| `approvals` | `{items: [{kind, id, userName, title, reason}]}` | 팀장만, 승인·반려 API |
| `room` | `{payload: {roomId, roomName, date, startTime, endTime, title, attendees}}` | `POST /api/room-reservations` |

주간보고 병합 규칙(챗봇은 일부만 말하므로 기존 보고에 더한다):
- 화면이 `GET /api/weekly-reports/current`로 현재 보고(또는 템플릿)를 받아, `current.entries`·`next.entries`에 챗봇 entries를 덧붙이고, issues·requests·personalSchedule은 챗봇 값이 비어 있지 않을 때만 덮어쓴 뒤 저장한다.
- entries의 day가 문장에 없으면 금주는 오늘 요일(주말이면 금요일), 차주는 월요일. workType이 없으면 `회사`. 차주 entries에 시간이 없으면 hours 0으로 두고 `canSubmit: false`(임시저장만).
- 예: "주간보고: 월 사내 그룹웨어 7시간 화면 설계, 운영 지원 1시간 서버 점검 / 차주: 화 AI 챗봇 PoC 8시간 / 이슈: 없음"

역할별 처리:
- 팀장의 주간보고 요청: 개인 보고 대신 팀 종합 화면 안내(navigate weekly)와 제출 현황 요약(제출 n/m명)
- 임원: 주간보고 요청은 팀별 현황 요약(팀별 제출률·총 시간) + navigate weekly. 출퇴근·연차·승인 요청은 "임원 메뉴에서 지원하지 않는 기능"으로 안내
- 회의실: "내일 오후 3시 소회의실 A 1시간 예약, 제목 스프린트 회의" → 날짜(오늘·내일·모레·요일·M월 D일), 시각(오전·오후 H시(반), HH:MM), 길이(N시간·N분, 기본 1시간), 회의실 이름, 제목(없으면 "회의")을 해석. 제안 전에 그날 예약과 겹치는지 확인해, 겹치면 같은 시간에 비어 있는 다른 회의실을 알려 준다. "오늘 회의실 현황"은 그날 예약 요약 + navigate rooms
- "오늘 요약"(status)에 오늘 내 회의를 추가. 임원은 팀별 주간보고 요약
- 질문 답변용 snapshot에 다가오는 내 회의실 예약을 포함

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
  - 구성원: xlsx 끌어다 놓기 영역(클릭해서 파일 선택도 가능, .xlsx만) → 업로드 → 읽은 내용을 엑셀 양식과 같은 2단 표(금주 | 차주, 개인일정·이슈·요청, 요일별 행, 합계)로 읽기 전용 미리보기 + 경고 표시 → 제출 버튼. 다시 놓으면 덮어씀(제출 전·반려 후). 상태 배지, 반려 의견, 원본 다운로드, 지난 보고 목록. 좁은 화면에서는 금주·차주를 탭으로 전환
  - 결재 관리에서 주간보고 행을 누르면 같은 2단 표 상세 + 원본 다운로드 + 승인·반려
  - 팀장(팀 종합): 제출 현황 카드, 팀원 목록(상태 배지, 시간, 클릭 시 양식 그대로 읽기 전용 보고), 프로젝트별 시간 막대, 이슈·요청·개인일정 모음, 승인·반려 바로가기, 팀 종합 의견 입력
  - 임원(팀별 현황): 팀별 요약 카드(제출률, 총 시간, 상위 프로젝트, 이슈·요청 건수, 팀장 종합 의견 미리보기). 카드 클릭 시 팀 종합 화면을 읽기 전용으로 표시
- 회의실 예약(마곡): 날짜 이동(이전·오늘·다음), 회의실(행) × 08:00~20:00 30분 칸(열) 현황표, 예약된 칸에 제목·예약자 표시(내 예약은 다른 색), 빈 칸 클릭 시 예약 폼(회의실·날짜·시작·종료 미리 채움, 제목·참석자 입력), 내 예약 목록과 취소. 좁은 화면에서는 회의실별 목록으로 전환
- 문서(위키): 경로 `#/docs`(목록), `#/docs/<id>`(보기), `#/docs/new`, `#/docs/<id>/edit`. Confluence처럼 왼쪽에 스페이스별 페이지 트리, 오른쪽에 브레드크럼(스페이스 > 제목), 제목, 라벨 칩, "최종 수정 이름 · 일시", 마크다운 본문(제목·표·목록·인용·굵게·코드, HTML은 이스케이프 후 변환). 상단 검색창(`/api/docs/search`) 결과는 구간 제목과 발췌로 표시. 편집은 제목·라벨·본문 textarea + 미리보기. 챗봇 답변의 출처 칩을 누르면 해당 문서로 이동
- 임원 메뉴: 홈 / 주간보고(팀별 현황) / 문서 / 회의실 예약. 출퇴근·연차·승인 메뉴는 숨긴다. 임원 홈은 팀별 주간보고 요약, 오늘 내 회의, 공지
- 모든 역할의 홈에 "오늘 내 회의" 카드(없으면 회의실 예약 바로가기)
- 연차: 잔여 카드, 신청 폼, 내 신청 내역(대기 건 취소 버튼), 팀 월간 캘린더
- 승인: 팀장은 "결재 대기 / 처리 완료" 탭, 구성원은 "내가 올린 결재" 목록. 항목 클릭 시 상세(연차 정보 또는 주간보고 전체)

### 시각 디자인 (참고 시안 기준)

- 레이아웃: 왼쪽 흰색 사이드바(폭 약 260px, 오른쪽 옅은 경계선). 맨 위에 로고(인디고 둥근 사각형 안 흰색 건물 아이콘) + "사내 그룹웨어"(로고 클릭 = 홈). 메뉴: 대시보드 / 출퇴근 / 주간보고 / 연차 / 결재 관리 / 회의실 예약(마곡). 선택 메뉴는 옅은 인디고 배경 + 인디고 글자, 아이콘은 선형
- 상단 바: 흰색, 왼쪽에 회색 "업무 공간", 오른쪽에 이니셜 원형 아바타(옅은 인디고 배경) + 이름(굵게)·역할(작게) + 사용자 전환 선택 상자("박팀장 · 팀장" 형식)
- 본문: 옅은 회색 배경(#F8FAFC 정도). 페이지 제목 크고 굵게(약 32px) + 회색 부제목 한 줄
- 통계 카드: 흰 카드, 옅은 테두리, 둥근 모서리(12px), 은은한 그림자. 왼쪽 위 색 아이콘 칩 + 라벨, 아래 큰 숫자 + 작은 단위("1 건")
- 표 카드: 카드 제목 + 오른쪽 보조 버튼("내역 보기"), 옅은 회색 머리글 행, 행 구분선, 이름 굵게, 보조 정보는 작은 회색 둘째 줄(예: "신청일 2026. 11. 20.")
- 상태 배지(둥근 알약형): 대기 = 호박색 배경·글자, 승인 = 초록, 반려 = 빨강, 취소·미작성 = 회색
- 필터 탭: 알약형 버튼 묶음(결재 대기 / 전체 / 승인 / 반려), 선택 = 인디고 채움 + 흰 글자
- 버튼: 주 버튼 = 인디고 채움(승인 등), 보조 = 흰 바탕 테두리(반려 등)
- 강조색 인디고(#4F46E5 근처) 하나로 통일. 이모지 없이 선형 SVG 아이콘
- 결재 관리는 **연차 결재**와 **주간보고 결재**를 분리한다. 경로 `#/approvals/leave`(기본), `#/approvals/weekly`. 페이지 상단에 두 개의 구분 탭(각각 대기 건수 배지), 사이드바 결재 관리 아래에도 두 하위 메뉴를 둔다. API는 그대로 쓰고 `kind`로 나눈다.
  - 연차 결재(팀장): 통계 카드 3개(연차 대기·승인·반려), 필터 탭(결재 대기/전체/승인/반려), 표(신청 직원, 연차 유형, 기간, 일수, 사유, 상태, 처리)
  - 주간보고 결재(팀장): 통계 카드 3개(주간보고 대기·승인·반려), 필터 탭, 표(작성자, 주차, 금주 총 시간, 이슈·요청 요약, 제출일, 상태, 처리). 행 클릭 시 2단 표 상세 + 원본 다운로드
  - 구성원: 같은 두 탭에서 각각 "내가 올린 연차" / "내가 올린 주간보고"
  - 대시보드(팀장): 연차 대기·주간보고 대기를 따로 보여 주는 카드 + "최근 결재 요청" 표(종류 열 포함). 사이드바 배지는 두 하위 메뉴에 각각

## 8. 역할 분담 (해커톤 제출용 예시)

| 담당 | 업무 |
|---|---|
| 신입 | 문제 정의, 화면 기획(SCREENS.md 검토·수정), 발표 |
| 개발 | server.js, 화면 구현, Demo |
| 분석 | 요구사항, 데이터 모델·검증 규칙 |

## 9. 대안: Microsoft 365 (SharePoint)

사내 M365를 쓰는 경우 SharePoint 목록과 Power Automate 승인 흐름으로도 같은 시나리오를 만들 수 있다. 테넌트 화면에서 직접 구성해야 해서 이번에는 코드로 구현하고 예비안으로 둔다.
