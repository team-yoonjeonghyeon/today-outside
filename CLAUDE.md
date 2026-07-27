# 오늘 나가도 되나

앱인토스 미니앱. 토스 7월 바이브코딩 챌린지 출품작. 마감 7/29.

## 읽고 시작할 것
- docs/오늘나가도되나_기획서.md — 전체 기획, 판정 로직, 정책 대응
- docs/오늘나가도되나_디자인프레임.html — 화면 6개 디자인
- docs/judge-api-spec.md — API 계약

## 폴더
- worker/ : 완성. 배포 끝. 수정 금지
- app/    : 프론트. 지금 작업 대상
- data/   : 지역·격자 매핑
- docs/   : 스펙

## API
GET https://today-outside-api.yoonjeonghyeon.workers.dev/judge?nx=57&ny=127&profile=dog

계산은 서버가 전부 한다. 프론트는 응답 JSON을 그리기만 한다.

## 제약
- Vite + React + TypeScript + TDS
- CSR 전용. SSR 금지
- 라이트모드만
- 진입 직후 바텀시트 금지, 뒤로가기로 알림 동의 유도 금지
- 위치 권한을 거부해도 전 기능이 동작해야 함 (지역 직접 선택)
- 노면온도에는 항상 '추정' 배지 표시
- 의료·진단 표현 금지

## 등급 색
1 #0E9F6E / 2 #A3C13A / 3 #F5A524 / 4 #F2711C / 5 #E03131
브랜드 #0E9F6E