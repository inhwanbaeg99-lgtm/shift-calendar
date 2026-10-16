# 근무 달력

여러 매장이 각자 매장을 등록해서 쓰는 알바 출퇴근·근무표·급여 앱입니다. (MGC 근무에서 복사해 만든 버전)

- 관리자: `/admin/` → **매장 등록하기** (매장 이름 + 이메일 + 비밀번호)
- 직원용 달력: 관리자 화면 왼쪽 위 **직원용 달력 ↗** 주소(`/?s=매장코드`)를 매장 기기에서 열면 그 기기에 매장이 기억됩니다.

## Firebase 설정 (처음 한 번)

MGC 근무와는 **다른 Firebase 프로젝트**를 씁니다. 같은 프로젝트를 쓰면 가입한 다른 매장 계정이 MGC 데이터를 읽을 수 있기 때문입니다.

1. Firebase 콘솔에서 새 프로젝트 만들기
2. Authentication → 이메일/비밀번호 로그인 사용 설정
3. Realtime Database 만들기 → 규칙에 `database.rules.json` 내용 붙여넣기
4. 웹 앱 추가 → 나오는 설정값을 `app.js` 의 `FIREBASE_CONFIG` 에 넣기
5. Authentication → 설정 → 승인된 도메인에 `inhwanbaeg99-lgtm.github.io` 추가

## 데이터 구조

- `owners/{uid}` — 관리자 계정의 매장 코드
- `stores/{코드}/meta` — 매장 이름, 관리자
- `stores/{코드}/public` — 직원 이름·근무 요일, 출근 기록 (누구나 읽기)
- `stores/{코드}/private` — 시급·전화번호·수당 등 (그 매장 관리자만)
