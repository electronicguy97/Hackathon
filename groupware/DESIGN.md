# 사내 그룹웨어 - 연차 신청 · 승인 (해커톤 주제 ①)

## 1. 문제 정의

- 연차 신청을 메신저·구두로 하면 신청 이력과 승인 여부가 흩어지고, 잔여 연차를 매번 따로 확인해야 한다.
- 팀장은 누가 언제 쉬는지, 어떤 신청이 대기 중인지 한눈에 보기 어렵다.

목표: 신청 → 팀장 승인 → 잔여 연차 자동 반영을 하나의 화면 흐름으로 묶는다.

## 2. 범위

| 구분 | 기능 | 이번 구현 |
|---|---|---|
| 연차 | 연차·반차 신청, 내 신청 내역, 잔여 연차 조회 | O |
| 승인(결재) | 팀장 결재함, 승인·반려(의견 포함) | O |
| 출퇴근 | 출근·퇴근 기록 | 확장 과제 |
| 주간보고 | Timesheet 작성 | 확장 과제 |

공고 최소 요건(4개 중 2개)과 MVP 가점 기준(입력 → 처리·저장 → 조회)을 모두 충족한다.

## 3. 시연 시나리오 (8분 발표 중 약 3분)

1. 사용자 `김신입`으로 접속 → 잔여 연차 15일 확인
2. 연차 신청: 2일, 사유 입력 → 내역에 `대기` 표시, 대기 일수 2일 반영
3. 상단 사용자 전환으로 `박팀장` 선택 → 결재함에 1건 표시
4. 승인(의견 입력) → 결재함에서 사라짐
5. 다시 `김신입`으로 전환 → 상태 `승인`, 잔여 연차 13일 확인
6. (선택) 잔여 일수보다 많이 신청 → 오류 메시지 확인

## 4. 구조

- 의존성 없는 Node.js(v22.5 이상, 내장 `node:http` + `node:sqlite`)
- 실행: `cd groupware` → `node server.js` → http://localhost:3000
- 데이터: `groupware/data/groupware.db` (최초 실행 시 자동 생성 및 시드)
- 화면: `public/` 정적 파일(HTML·CSS·바닐라 JS), 서버가 함께 제공

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

**users**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | |
| role | TEXT | `employee` 또는 `manager` |
| team | TEXT | 팀장은 같은 팀 구성원의 신청을 결재 |
| annual_total | REAL | 연간 부여 연차 |

시드: 1 김신입(employee, 개발팀, 15) · 2 이분석(employee, 개발팀, 15) · 3 박팀장(manager, 개발팀, 20)

**leave_requests**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER | 신청자 |
| type | TEXT | `annual`(연차), `half_am`(오전 반차), `half_pm`(오후 반차) |
| start_date, end_date | TEXT | `YYYY-MM-DD`, 반차는 두 값이 같아야 함 |
| days | REAL | 서버가 계산: 연차는 기간 내 평일 수, 반차는 0.5 |
| reason | TEXT | |
| status | TEXT | `pending`, `approved`, `rejected` |
| approver_id | INTEGER NULL | 결재자 |
| comment | TEXT NULL | 결재 의견 |
| created_at, decided_at | TEXT | ISO 8601 |

잔여 연차 = `annual_total` - 승인된 `days` 합계. 대기 중인 일수는 따로 표시하고, 신청 시 `잔여 - 대기 < 신청 일수`이면 거절한다.

## 6. API 계약

모든 요청과 응답은 JSON이다. 오류는 4xx 상태 코드와 `{ "error": "사용자에게 보여줄 한국어 메시지" }`로 응답한다.

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/users` | | `[{id, name, role, team}]` |
| GET | `/api/users/:id/balance` | | `{total, used, pending, remaining}` |
| GET | `/api/leave-requests?userId=:id` | | 해당 사용자의 신청 목록(최신순) |
| GET | `/api/approvals?approverId=:id` | | 결재자 팀의 `pending` 신청 목록(오래된 순), 각 항목에 `userName` 포함 |
| POST | `/api/leave-requests` | `{userId, type, startDate, endDate, reason}` | 201, 생성된 신청 |
| POST | `/api/leave-requests/:id/approve` | `{approverId, comment}` | 200, 갱신된 신청 |
| POST | `/api/leave-requests/:id/reject` | `{approverId, comment}` | 200, 갱신된 신청 |

신청 객체 형태:

```json
{
  "id": 1, "userId": 1, "userName": "김신입", "type": "annual",
  "startDate": "2026-12-01", "endDate": "2026-12-02", "days": 2,
  "reason": "개인 사유", "status": "pending",
  "approverId": null, "approverName": null, "comment": null,
  "createdAt": "2026-11-26T05:00:00.000Z", "decidedAt": null
}
```

검증 규칙(400):
- 필수 값 누락, 잘못된 날짜 형식, `endDate < startDate`, 반차인데 시작일과 종료일이 다른 경우
- 평일이 하나도 없는 기간(계산된 `days`가 0)
- 잔여 연차 부족: `"잔여 연차가 부족합니다 (가능: X일)"`
- 승인·반려 시 결재자가 `manager`가 아니거나 다른 팀인 경우 403, 이미 처리된 신청이면 409

## 7. 화면 목록 (상세는 SCREENS.md)

| 화면 | 사용자 | 주요 요소 |
|---|---|---|
| 상단 바 | 공통 | 서비스명, 사용자 전환 드롭다운, 역할 배지 |
| 내 연차 | 전체 | 잔여·사용·대기·총 연차 카드, 신청 버튼, 내 신청 내역 표(상태 배지, 결재 의견) |
| 연차 신청 | 전체 | 유형, 기간, 사유, 예상 일수 미리보기, 오류 메시지 |
| 결재함 | 팀장 | 대기 건 목록(신청자, 기간, 일수, 사유), 의견 입력, 승인·반려 |

## 8. 역할 분담 (해커톤 제출용 예시)

| 담당 | 업무 |
|---|---|
| 신입 | 문제 정의, 화면 기획(SCREENS.md 검토·수정), 발표 |
| 개발 | server.js, 화면 구현, Demo |
| 분석 | 요구사항, 데이터 모델·검증 규칙 |

## 9. 대안: Microsoft 365 (SharePoint)

사내 M365를 쓰는 경우 SharePoint 목록(연차 신청)과 Power Automate 승인 흐름으로도 같은 시나리오를 만들 수 있다. 다만 테넌트 화면에서 직접 클릭하며 구성해야 해서 이번에는 코드로 구현하고 예비안으로만 둔다.
