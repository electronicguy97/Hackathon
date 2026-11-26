# 사내 그룹웨어 기능 정리 (이식용)

다른 프로젝트로 옮길 때 기능 단위로 떼어 갈 수 있도록 정리한 문서다. 설계 배경과 시연 시나리오는 `DESIGN.md`, 화면 와이어프레임은 `SCREENS.md`를 본다.

> 작성 시점: 2026-11-26, 커밋 `a00754a` 기준.
> **진행 중**으로 표시한 항목(주간보고 xlsx 업로드, 화면 디자인 변경)은 설계(API 계약) 기준으로 적었고, 구현이 끝나면 이 문서를 갱신한다.

## 목차

0. [공통 기반](#0-공통-기반)
1. [사용자 · 역할 · 권한](#1-사용자--역할--권한)
2. [대시보드(홈)](#2-대시보드홈)
3. [출퇴근](#3-출퇴근)
4. [연차](#4-연차)
5. [주간보고](#5-주간보고)
6. [결재 관리(승인)](#6-결재-관리승인)
7. [회의실 예약 (마곡)](#7-회의실-예약-마곡)
8. [공지사항](#8-공지사항)
9. [업무 챗봇](#9-업무-챗봇)
10. [테스트](#10-테스트)
11. [이식 체크리스트](#11-이식-체크리스트)

---

## 0. 공통 기반

| 항목 | 내용 |
|---|---|
| 런타임 | Node.js 22.5 이상(내장 `node:sqlite` 사용). 기본 기능은 npm 의존성 없음 |
| 실행 | `cd groupware` → `node server.js` → http://localhost:3000 (`PORT` 환경변수로 변경) |
| 서버 | `server.js` 한 파일: `node:http` 라우팅(`handleApi`), 정적 파일(`serveStatic`), SQLite 접근 |
| DB | `data/groupware.db`. 서버 시작 시 테이블 생성(`CREATE TABLE IF NOT EXISTS`) 후 `seedDatabase()`가 **users가 비어 있을 때만** 시드 |
| 화면 | `public/index.html` + `app.js` + `style.css`, 바닐라 JS, 해시 라우팅 |
| 환경설정 | `.env`(선택, git 제외): 챗봇 LLM 설정만. `.env.example` 참고 |
| git 제외 | `data/`, `.env`, `node_modules/`, `public/files/` |

공통 규칙
- 요청·응답 JSON, 필드명 camelCase. 오류는 `{ "error": "한국어 메시지" }`와 상태 코드(400 형식·검증, 403 권한, 404 없음, 409 상태 충돌).
- 인증 없음(데모). 요청마다 `userId`·`approverId`·`viewerId` 등으로 현재 사용자를 보낸다. **이식 시 세션·토큰 인증으로 바꿔야 한다.**
- 날짜 `YYYY-MM-DD`, 시각 `HH:MM`(서버 로컬 시간), 일시 ISO 8601.
- 서버 공용 함수: `json`, `readJson`, `readId`, `getUser`, `getManager`, `requireSameTeam`, `textValue`, `parseDate`, `localDate`, `addDays`, `monday`, `weekLabel`.
- 스키마를 바꾸면 기존 DB에는 시드가 다시 들어가지 않으므로 `data/`를 지우고 재시작한다(새 테이블은 생기지만 비어 있음).

## 1. 사용자 · 역할 · 권한

**DB** `users`: id, name, role(`employee`|`manager`|`executive`), team, annual_total

| 역할 | 할 수 있는 일 |
|---|---|
| employee(구성원) | 출퇴근, 연차 신청·취소, 주간보고 제출, 회의실 예약, 내가 올린 결재 조회 |
| manager(팀장) | 위 기능 + 같은 `team` 구성원의 연차·주간보고 결재, 팀 근태 조회, 주간보고 팀 종합·팀 의견 작성, 공지 작성. 개인 주간보고는 쓰지 않음 |
| executive(임원) | 대시보드, 주간보고 팀별 현황(읽기 전용), 회의실 예약. 출퇴근·연차·결재 메뉴 없음 |

시드(가상 인물): 개발팀 1 김신입 · 2 이분석 · 8 박사원 · 3 박팀장(manager), 데이터팀 4 최데이터 · 5 정연구 · 6 한팀장(manager), 경영진 7 강상무(executive)

**API** `GET /api/users` → `[{id, name, role, team}]`

**화면** 상단 사용자 전환 선택 상자(팀별 묶음, `localStorage`에 기억), 역할 배지. `app.js`: `initUsersAndStart`, `renderHeaderForUser`

**이식 메모** 팀장 권한은 "role=manager 이고 team이 같음"으로만 판단한다(`requireSameTeam`). 조직도가 있는 시스템이면 이 함수만 바꾸면 된다.

## 2. 대시보드(홈)

**화면** `#/home`. `app.js`: `renderHomeRoute`, 임원은 `renderExecutiveHomeRoute`
- 공통 카드: 오늘 출퇴근(버튼 포함), 잔여 연차, 내 결재 현황, 이번 주 주간보고, 오늘 내 회의, 오늘 팀 부재자, 공지사항
- 팀장: 결재 대기 건수(목차 배지에도 표시)
- 임원: 팀별 주간보고 요약 + 오늘 내 회의 + 공지

**API** `GET /api/home?userId=` (`home()`), 한 번에 집계해서 돌려준다.

```json
{
  "user": {}, "today": "2026-11-26",
  "attendance": {"checkIn": "08:55", "checkOut": null, "status": "working", "late": false},
  "balance": {"total": 15, "used": 0, "pending": 2, "remaining": 15},
  "weeklyReport": {"weekStart": "2026-11-23", "status": "none"},
  "myPendingCount": 1, "approvalPendingCount": 0,
  "teamOnLeaveToday": [{"userName": "이분석", "type": "annual"}],
  "myReservationsToday": [{"id": 1, "roomName": "소회의실 A", "startTime": "11:30", "endTime": "12:00", "title": "..."}],
  "notices": []
}
```

**의존** 출퇴근, 연차, 주간보고, 결재, 회의실, 공지. 이식할 때 없는 기능의 필드만 빼면 된다.

## 3. 출퇴근

**DB** `attendance`: id, user_id, work_date, check_in, check_out. (user_id, work_date) 유일

**규칙** 지각 = 출근 > 09:00. 근무 분 = 퇴근 - 출근(퇴근 전 0). 상태 `none`|`working`|`done`. 시드는 이번 달 1일~어제 평일, 고정 규칙으로 생성.

**API**

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/attendance/check-in` `{userId}` | 201. 이미 출근 409 |
| POST | `/api/attendance/check-out` `{userId}` | 200. 미출근·이미 퇴근 409 |
| GET | `/api/attendance?userId=&month=YYYY-MM` | `{records: [{workDate, checkIn, checkOut, workMinutes, late}], summary: {days, totalMinutes, lateCount}}` |
| GET | `/api/attendance/team?managerId=` | 팀원 오늘 현황 `[{userId, userName, checkIn, checkOut, status, late, onLeave}]`, 팀장만 |

**서버** `markAttendance`, `attendanceRecord`, `attendanceStatus`, `getMonthAttendance`, `getTeamAttendance`
**화면** `#/attendance`, `renderAttendanceRoute`(오늘 기록·버튼, 월 선택 근태표·합계, 팀장용 팀 현황)
**의존** 팀 현황의 `onLeave`는 연차(승인된 신청)를 참조.

## 4. 연차

**DB** `leave_requests`: id, user_id, type(`annual`|`half_am`|`half_pm`), start_date, end_date, days, reason, status(`pending`|`approved`|`rejected`|`cancelled`), approver_id, comment, created_at, decided_at

**규칙**
- days 서버 계산: 연차 = 기간 내 평일 수(`countWeekdays`), 반차 = 0.5(시작일 = 종료일 필수)
- 잔여 = annual_total - 승인 합계, 대기 = pending 합계. 신청 시 `잔여 - 대기 < 신청 일수`면 400 `잔여 연차가 부족합니다 (가능: X일)`
- 취소는 본인 pending만

**API**

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/users/:id/balance` | `{total, used, pending, remaining}` |
| GET | `/api/leave-requests?userId=` | 내 신청(최신순) |
| POST | `/api/leave-requests` `{userId, type, startDate, endDate, reason}` | 201 |
| POST | `/api/leave-requests/:id/cancel` `{userId}` | 본인 pending만 |
| POST | `/api/leave-requests/:id/approve`·`/reject` `{approverId, comment}` | 같은 팀 팀장만, pending만(409) |
| GET | `/api/leave-calendar?userId=&month=` | 팀의 그 달 pending·approved 신청 |

**서버** `createLeave`, `getLeave`, `decideLeave`, `cancelLeave`, `balance`, `countWeekdays`
**화면** `#/leave`, `renderLeaveRoute`(잔여 카드, 신청 폼과 평일 수 미리보기, 내역과 취소, 팀 월간 캘린더)
**이식 메모** 공휴일은 계산하지 않는다(평일만 셈). 필요하면 `countWeekdays`에 공휴일 목록을 넣는다.

## 5. 주간보고

사내 엑셀 주간보고 양식을 그대로 데이터로 옮긴다. 한 보고 = 금주 실적 + 차주 계획.

**DB**
- `weekly_reports`: id, user_id, week_start(월요일), current_json, next_json, status(`draft`|`submitted`|`approved`|`rejected`), approver_id, comment, submitted_at, decided_at, updated_at, (진행 중) file_name. (user_id, week_start) 유일
- `team_summaries`: id, team, week_start, manager_id, summary, updated_at. (team, week_start) 유일

**WeekPart(JSON) 형태와 엑셀 양식 대응**

```json
{
  "personalSchedule": "없음", "issues": "", "requests": "없음",
  "entries": [{"day": "mon", "category": "사내 그룹웨어", "workType": "회사", "content": "- 화면 설계", "hours": 7}]
}
```

| 엑셀 | 필드 |
|---|---|
| 1행 B1 / F1 (예: `11월 4주차(11/23 ~ 11/27)`) | 금주 / 차주 라벨, weekStart |
| 개인일정(휴가 등) / 이슈사항 / 요청사항·전달사항 | personalSchedule / issues / requests (금주 B열, 차주 F열) |
| 요일 · 구분 · 형태 · 진행 계획 · 예상 소요시간 | day(`mon`~`fri`) · category · workType(`회사`·`재택`·`출장`·`외근`·`휴가`) · content · hours |

**주차 라벨 규칙** 해당 주 목요일이 속한 달, 주차 = ceil(목요일 날짜 / 7). `weekLabel()`

### 5-1. 작성·제출 (구성원)

**(진행 중) xlsx 끌어다 놓기 업로드**: 웹 입력 폼 대신 평소 쓰던 xlsx를 올리면 서버가 읽는다.
- `POST /api/weekly-reports/upload?userId=&fileName=` 본문 = xlsx 바이트(2MB 이하) → `{report, warnings}`. 해당 주 보고를 draft로 저장(덮어씀), 원본은 `data/uploads/<id>.xlsx`
- `POST /api/weekly-reports/:id/submit {userId}` → submitted
- `GET /api/weekly-reports/:id/file?viewerId=` → 원본 다운로드(작성자, 같은 팀 팀장, 임원)
- 읽기 규칙(`xlsx.js`, Node 내장 `zlib`만 사용): 첫 시트, sharedStrings·숫자·병합 셀 처리, A열 `요일` 머리글 아래에서 요일 블록별로 금주 B~E열, 차주 F~I열. 시간이 없거나 형태가 목록 밖이면 경고. 상세는 `DESIGN.md` 5절 "주간보고 xlsx 읽기 규칙"
- 화면: 드롭 영역 → 읽은 내용을 2단 표로 미리보기 + 경고 → 제출. 반려 후 다시 올리기 가능

기존 API(챗봇이 사용, 유지)
- `GET /api/weekly-reports/current?userId=`: 이번 주 보고, 없으면 템플릿(지난주 차주 계획을 금주 실적에 복사)
- `GET /api/weekly-reports?userId=`: 내 보고 목록
- `PUT /api/weekly-reports {userId, weekStart, current, next, submit}`: 직접 저장(시간 0 초과, 하루 24시간 이하 검증)

### 5-2. 팀장 종합

- `GET /api/weekly-reports/team?viewerId=&weekStart=&team=`: 팀원별 상태·시간·보고, 프로젝트별 시간 합계(내림차순), 이슈·요청·개인일정 모음, 제출 통계, 팀 의견. 집계는 submitted·approved 보고의 금주 실적만
- `PUT /api/team-summaries {managerId, weekStart, summary}`: 팀 종합 의견
- 결재: `POST /api/weekly-reports/:id/approve`·`/reject`(반려 시 의견 필수)

### 5-3. 임원 팀별 현황

- `GET /api/executive/weekly?executiveId=&weekStart=`: 팀별 요약(팀 종합에서 members 제외)
- 팀 상세는 5-2의 team API에 `team`을 넣어 호출. 임원에게는 draft 보고 내용을 숨김

**서버** `readWeekPart`, `putReport`, `currentReport`, `reportObject`, `decideReport`, `teamReport`, `getTeamReport`, `putTeamSummary`, `executiveWeekly`, `seedWeeklyReports`
**화면** `#/weekly`, `renderWeeklyRoute` → 역할별 `renderEmployeeWeeklyRoute` / `renderManagerWeeklyRoute`(`renderTeamRollupContent`) / `renderExecutiveWeeklyRoute`, 보고 상세 `openMemberReportModal`
**이식 메모** 양식이 다르면 `xlsx.js`의 칸 위치 규칙만 바꾸면 되고, 저장 형태(WeekPart)는 그대로 쓸 수 있다.

## 6. 결재 관리(승인)

연차와 주간보고를 한 목록으로 보여 준다. 결재 실행은 각 기능의 approve·reject API를 쓴다.

**API** 항목 형태 `{kind: "leave"|"weekly", id, userId, userName, title, status, createdAt, decidedAt, detail}`

| 경로 | 설명 |
|---|---|
| `GET /api/approvals?approverId=` | 팀의 대기 건(오래된 순), 팀장만 |
| `GET /api/approvals/history?approverId=` | 내가 처리한 건, 팀장만 |
| `GET /api/approvals/mine?userId=` | 내가 올린 건(연차 cancelled 제외, 주간보고 draft 제외) |

**서버** `approvals(scope, value)`, `approvalItem`
**화면** `#/approvals`, `renderApprovalsRoute`, `renderApprovalDetail`. (진행 중) 참고 시안 디자인: 통계 카드(대기·승인·반려), 필터 탭(결재 대기/전체/승인/반려), 표 + 처리 버튼, 주간보고 행은 2단 표 상세와 원본 다운로드
**이식 메모** 결재선이 여러 단계인 시스템이면 `approvals()`와 각 decide 함수에 단계 개념을 추가해야 한다(현재는 팀장 1단계).

## 7. 회의실 예약 (마곡)

**DB**
- `rooms`: id, office, name, capacity, equipment. 시드: 대회의실(12) · 중회의실(8) · 소회의실 A(4) · 소회의실 B(4) **예시 이름이므로 실제 회의실로 바꿀 것**
- `room_reservations`: id, room_id, user_id, date, start_time, end_time, title, attendees, status(`reserved`|`cancelled`), created_at

**규칙** 08:00~20:00, 30분 단위, 시작 < 종료, 과거 날짜 불가. 같은 회의실·날짜의 reserved끼리 `start < 상대 end AND end > 상대 start`면 409 `이미 예약된 시간입니다 (10:00~11:00, 박팀장)`. 바로 이어지는 시간(종료 = 상대 시작)은 허용. 취소는 본인만.

**API**

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/rooms` | 회의실 목록 |
| GET | `/api/room-reservations?date=` | 그날 예약 전체 |
| GET | `/api/room-reservations/mine?userId=` | 오늘 이후 내 예약 |
| POST | `/api/room-reservations` `{userId, roomId, date, startTime, endTime, title, attendees}` | 201 / 400 / 409 |
| POST | `/api/room-reservations/:id/cancel` `{userId}` | 본인만(403), 이미 취소 409 |

**서버** `validateReservationTime`, `createReservation`, `cancelReservation`, `seedReservations`
**화면** `#/rooms`, `renderRoomsRoute`(회의실 × 30분 칸 현황표, 빈 칸 클릭 → `openRoomBookingModal`, 예약 상세 `openReservationDetailModal`, 내 예약과 취소, 좁은 화면은 회의실별 목록)
**이식 메모** 다른 지점을 추가하려면 `rooms.office`로 구분하고 화면에 지점 선택만 넣으면 된다. 기능 자체는 다른 기능에 의존하지 않아 가장 떼어 가기 쉽다.

## 8. 공지사항

**DB** `notices`: id, author_id, title, body, pinned, created_at / `notice_attachments`: id, notice_id, name, url

**API** `GET /api/notices`(고정 우선, 최신순, `attachments` 포함), `POST /api/notices {userId, title, body, pinned}`(팀장만)
**첨부** 첨부 파일은 `public/files/`에 두고 URL로 연결한다. 이 폴더는 사내 문서라 git에서 제외되며, 파일이 있을 때만 시드에 첨부가 붙는다.
**서버** `noticeObject`, `createNotice` / **화면** 대시보드 공지 카드, `openNoticeDetailModal`

## 9. 업무 챗봇

화면 우측 하단 챗봇. 문장을 해석해 **동작을 제안**하고, 사용자가 카드에서 확인하면 화면이 기존 API를 호출한다(챗봇이 직접 데이터를 바꾸지 않음). 팀원 kimzoo 구현을 기반으로 주간보고 양식·임원·회의실에 맞게 확장했다.

| 파일 | 역할 |
|---|---|
| `assistant.js` | 의도 분류와 값 추출(규칙 기반 + 선택적 LLM), 답변 생성. `respond`, `writeStory`, `interpret`, `providerName` |
| `server.js` | `POST /api/chat {userId, text}`(500자 이내), `POST /api/chat/story`, 질문 답변 근거용 `chatSnapshot()` |
| `public/chatbot.js`, `chatbot.css` | 대화창, 제안 카드(`handleAction`), 주간보고 병합(`mergeWeekPart`), 화면 새로고침(`window.groupwareRefresh`) |

**의도** leave_request, weekly_report, room_request, room_status, check_in, check_out, status, approvals, navigate, question, help
**제안 동작(action.kind)** navigate, check_in, check_out, leave, weekly, approvals, room. 형태는 `DESIGN.md` 6절 "업무 챗봇"
**LLM** `.env`의 `LLM_PROVIDER` = anthropic | azure | openai. 비어 있거나 실패·시간 초과(`LLM_TIMEOUT_MS`)면 규칙 기반으로 대체. Anthropic을 쓸 때만 `npm install @anthropic-ai/sdk` 필요
**역할 처리** 팀장 주간보고 → 팀 제출 현황, 임원 → 팀별 요약, 임원의 출퇴근·연차·결재 요청 → 미지원 안내
**의존** 대부분의 기능 API. 이식할 때 옮기지 않는 기능의 의도와 `ROUTE_LABEL` 항목을 빼야 한다.

## 10. 테스트

- `smoke-test.mjs <baseUrl>`: 서버를 따로 띄운 뒤 실행. 시연 시나리오 전체와 권한·검증 오류를 API로 확인하고 실패 시 종료 코드 1
- 실행 예: `data/` 삭제 → `PORT=3099 LLM_PROVIDER= node server.js` → `node smoke-test.mjs http://localhost:3099`
- 챗봇은 규칙 기반 모드로만 테스트한다(LLM 호출 없음)
- (진행 중) 주간보고 업로드 테스트는 가상 내용의 xlsx를 테스트 코드가 직접 만들어 쓴다. 실제 주간보고 파일은 저장소에 넣지 않는다

## 11. 이식 체크리스트

1. **인증**: `userId` 등을 쿼리·본문으로 받는 부분을 세션·토큰의 사용자로 바꾼다(`handleApi`의 `user()`, `manager()` 등 사용자 조회 지점).
2. **조직·권한**: `users.team`/`role`과 `requireSameTeam`, `getManager`를 대상 시스템의 조직도에 맞춘다.
3. **DB**: SQLite 스키마는 `server.js` 상단 `CREATE TABLE` 블록에 모여 있다. 다른 DB로 옮기면 `db.prepare` 쿼리들을 함께 옮긴다. JSON 컬럼은 `current_json`, `next_json` 두 개뿐이다.
4. **시드**: `seedInitialRows`, `seedReservations`, `seedWeeklyReports`는 데모용이므로 운영 이식 시 제외한다.
5. **기능 단위로 가져갈 때**: 회의실·공지는 독립적이다. 결재 관리는 연차·주간보고에 의존하고, 대시보드와 챗봇은 거의 모든 기능에 의존한다.
6. **기밀 자료**: 실제 주간보고 xlsx, `public/files/`의 사내 문서, `.env`의 API 키는 저장소에 올리지 않는다.
7. **Node 버전**: `node:sqlite`는 22.5 이상에서 제공되고 아직 실험 기능 경고가 출력된다. 운영에서는 버전을 고정한다.
