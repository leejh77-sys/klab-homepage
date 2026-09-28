# 산업뉴스 · 메일링 브리프 자동 발행 운영 기준

2026-09-23 자동화 전환. 이전 버전(주 1회 수동 정리, 예약 실행 없음)은 `weekly-news-policy.md`였다.
원본 메모장은 변경하지 않았다.
원본: C:/ai/프로젝트/트렌드 조사 레포트/[신발 글로벌 뉴스 및 비즈니스 분석 사이트].txt (14:05 수정본)

## 실행 주체

**2026-09-28부로 산업뉴스는 GitHub Actions 기반으로 전환했다** (`scripts/crawl_industry_news.py` +
`.github/workflows/industry-news-crawl.yml`). 이전에는 `/schedule`로 등록한 Claude 클라우드
루틴(`trig_01GdSPEYSSuDRX9vkoYC617t`, "KLAB 산업뉴스 자동발행")이 실행마다 WebSearch로 기사를
찾았는데, 그 실행 샌드박스가 WebFetch를 모든 외부 도메인에 차단하는 바람에 원문을 직접 열 수
없었고, WebSearch 교차검증만으로는 당일~수일 이내 기사를 확인할 수 없어 항상 며칠~1주일 지난
기사만 게시되는 신선도 문제가 있었다(2026-09-28 leejh77 보고, 상세 내역은 아래 '실행 상태' 참고).

새 구조:
1. **수집(GitHub Actions, egress 제한 없음)** — `scripts/crawl_industry_news.py`가
   `data/news-sources.json`의 `status: active` 17개 출처를 RSS 또는 실제 기사 페이지 직접 fetch로
   조사해 진짜 발행일이 확인된 후보를 모은다(무신사 크롤러 `crawl_musinsa.py`와 같은 방식 — 이
   워크플로우 실행 환경은 애초에 egress 제한이 없다는 것이 이미 확인돼 있다).
2. **분류·요약(Claude API 단발 호출 1회)** — 수집된 후보 전체를 한 번의 배치 API 호출로 넘겨
   선정·region/category 분류·issueKey 병합·한국어 번역요약만 수행한다. url/date는 모델이 절대
   새로 만들거나 바꿀 수 없고, 수집 단계에서 이미 확보한 값을 그대로 재사용한다 — 이 호출은
   "리서치"가 아니라 "이미 검증된 후보 중에서 편집 판단"만 한다.
3. **검증·반영** — 기존과 동일하게 `node --test scripts/news-policy.test.cjs` +
   `node scripts/validate-news.cjs`를 통과한 경우에만 `data/industry-news.json`을 갱신하고,
   워크플로우가 변경분을 커밋·푸시한다.

메일링 브리프는 Gmail 개인 구독함을 읽어야 해서(Gmail MCP 연결 필요) 계속 기존 Claude 클라우드
루틴("KLAB 메일링 브리프 자동발행")이 담당한다 — 이건 WebFetch 문제와 무관했고 처음부터 정상
작동해왔다.

| 대상 | 실행 주체 | 데이터 | 주기 | cron(UTC) | KST |
| --- | --- | --- | --- | --- | --- |
| 글로벌·국내 산업뉴스 | GitHub Actions (`industry-news-crawl.yml`) | `data/industry-news.json` | 주 2회 | `0 23 * * 0,3` | 매주 월·목 08:00 |
| 메일링 브리프 | Claude 클라우드 루틴 | `data/mailing-brief.json` | 주 1회 | `0 23 * * 0` | 매주 월 08:00 |

무신사 트렌드(`data/weekly.json`/`monthly.json`/`content.json`)는 기존 `musinsa-dashboard.yml`이
매주 월요일 08:00 KST에 실행되며, 실행마다 이전 데이터를 통째로 덮어쓰는 방식이라 별도 보관기간
정책이 필요 없다(코드 변경 없음).

## 보관 기간 (28일 롤링, 신규)

- 산업뉴스·메일링 브리프 모두 항목의 `date` 기준 오늘로부터 28일(KST)이 지나면 **자동화 스크립트가
  실제로 파일에서 삭제**한다. 화면에서 숨기는 것이 아니라 `data/*.json`에서 제거한다.
- `js/news-policy.js`의 `select()`는 표시 시점에 같은 28일 창을 한 번 더 확인하는 안전장치이며,
  실제 삭제 책임은 매 실행 시작 시 routine에 있다.
- 매 실행은 "이전 회차를 통째로 교체"하지 않고 기존 데이터에 **새 항목을 추가(append)**한다.
  `issueKey` 또는 정규화된 URL이 이미 저장돼 있으면 다시 추가하지 않는다.

## 글로벌·국내 산업뉴스 — 선정과 분류

- 글로벌: 해외 시장·생산·소재·기업 전략의 주요 이슈. 건수를 채우기 위한 고정 할당은 없다.
- **카테고리·출처 다양성 (신규, 2026-09-23 추가)**: `globalNewsSubTabs`의 8개 카테고리(신모델,
  신규브랜드, 글로벌비즈니스, 신소재, 생산기술, 유행아이템, 거시트렌드, 미시트렌드)가 글로벌 누적
  데이터에서 최대한 고르게 채워지도록 조사한다. 한두 출처(예: 특정 매체 하나)나 한두 카테고리(특히
  글로벌비즈니스)에 몰아서 채우지 않는다 — `data/news-sources.json`의 `status: active` 목록에 있는
  여러 출처를 실제로 하나씩 확인한다. 특정 카테고리에 해당하는 검증 가능한 최근 기사를 찾지 못하면
  억지로 채우지 말고 다음 실행에서 다시 시도한다(과거·미확인 기사로 채우지 않는다는 원칙이 여기도
  적용된다).
- 국내: 한국 시장·국내 브랜드·국내 유통·국내 산업에 직접 연결되는 주요 이슈. **실행 1회당 최대
  10건**을 목표로 한다(`domesticTarget`) — 이는 누적 표시 상한이 아니라 매 실행의 편집 목표다.
- 외국 브랜드의 한국 매장 개점은 국내, 한국 매체가 쓴 해외 시장 기사는 글로벌로 분류한다.
- 같은 사건의 기사·보도자료는 `issueKey` 하나로 묶고 가장 명확한 원문 하나를 사용한다.
- 중요도 순서는 신발·스포츠 직접 관련성, 시장 파급력, 연구·시험·소재 활용도, 수치·근거의 구체성을
  함께 고려한다. `rank`는 해당 실행(에디션) 내부의 중요도 순서이며, 여러 실행에 걸쳐 전역적으로
  연속될 필요는 없다.
- 단순 할인, 색상 추가, 연예인 화보, 광고성 구매 가이드, 신발과 무관한 일반 소식은 제외한다.
- 국내 적격 이슈가 목표보다 적으면 확인된 수량만 게시하고 `shortfallReason`에 사유를 기록한다.
  과거·미확인 기사로 채우지 않는다.
- `verified: true`는 이제 "`scripts/crawl_industry_news.py`가 해당 출처(RSS 또는 기사 페이지)를
  실제로 직접 fetch해서 얻은 날짜·URL"이라는 뜻이다 — 스크립트가 수집한 후보만 Claude API 분류
  단계로 넘어가므로, 그 단계를 통과해 저장된 항목은 전부 `verified: true`다. 지어낸 날짜나 미확인
  기사는 애초에 후보 목록에 들어올 수 없다.
- **지난 이력(2026-09-23 ~ 2026-09-27, 지금은 해당 없음)**: 이전에는 claude.ai 예약 루틴이 매
  실행마다 WebFetch/WebSearch로 실시간 리서치를 했는데, 그 샌드박스의 네트워크 egress 정책이
  WebFetch를 모든 외부 도메인에 차단해 원문을 직접 열 수 없었다. 대체로 WebSearch 2건 이상 교차
  검증을 썼지만, 당일~며칠 이내 기사는 교차 인용이 안 돼 확인이 안 됐고(신선도 지연의 원인), 문서에
  한때 적혀 있던 국내 기사용 "Naver 뉴스API"(`mcp__PlayMCP__NaverSearch-search_news`)는 실제로
  존재하지 않는 도구였다(2026-09-28 확인). 2026-09-28 GitHub Actions 기반 수집으로 전환하면서 이
  문제 자체가 해소됐다 — 아래 '실행 상태' 참고.

## 조사 사이트

정규화·중복 제거한 전체 목록과 최근 접근 점검 결과는 `../data/news-sources.json`에 기록한다.

| 구분 | 정기 핵심 매체 | 범위 |
| --- | --- | --- |
| 글로벌 | World Footwear, Footwearbiz, Sportstextiles 등(`news-sources.json`의 `status: active`) | 신발 산업·기업·소재·생산 |
| 국내 | 테넌트뉴스, 패션인사이트 등(`news-sources.json`의 `status: active`) | 신발·스포츠·연관 유통·시장 |

- 접근 오류나 본문/발행일 확인 실패는 사이트 폐쇄·업로드 중단의 증거가 아니다. 해당 실행에서
  보류하고 반복 우회 접근하지 않는다.
- `status: excluded`(유료 봇 게이트, 로그인 필요, 403 등)인 출처는 사용하지 않는다.
- 최근 4주간 관련 게시물이 없는 출처는 `paused`로 전환하고 사유·확인일을 `news-sources.json`에 기록한다.

## 산업뉴스 실행 절차 (2026-09-28부로 `scripts/crawl_industry_news.py` + GitHub Actions가 수행)

1. `data/news-sources.json`에서 `status: active`인 출처의 최신 목록을 읽는다.
2. 출처별로 RSS(`RSS_SOURCES`) 또는 사이트별 HTML 스크래퍼(`SCRAPERS`)를 실제로 fetch해 최근
   10일 이내 발행된 후보(제목·URL·날짜·짧은 발췌)를 모은다. 이미 저장된 `issueKey`/정규화 URL과
   겹치는 후보는 이 단계에서 걸러낸다.
3. 모인 후보 전체 + 기존 region/category별 보유 현황을 Claude API에 **한 번의 배치 호출**로 넘겨
   선정·region/category 분류·issueKey 병합(같은 사건 병합)·한국어 번역요약만 시킨다(리서치 아님 —
   url·date는 모델이 절대 바꿀 수 없고 수집 단계 값을 그대로 재사용, 코드에서 강제 검증함).
4. 모델이 고른 항목만 `rank, region, issueKey, category, title, summary, source, url, date,
   verified: true`를 채워 `data/industry-news.json`의 `items`에 추가한다. (`significance`/KLAB
   관점 필드는 2026-09-28부로 폐지.)
5. `date` 기준 28일이 지난 기존 항목을 삭제한다.
6. `updatedAt`을 실행 완료 시각으로 갱신한다.
7. `node --test scripts/news-policy.test.cjs`와 `node scripts/validate-news.cjs`를 실행해 통과를
   확인한 경우에만 파일을 유지한다 — 실패하면 스크립트가 `data/industry-news.json`을 실행 전
   상태로 되돌리고 게시하지 않는다(GitHub Actions의 "커밋/푸시" 스텝은 이후 실제 변경이 있을
   때만 동작).
8. `docs/news-sources.json`에 없는 활성 출처가 새로 추가되면 `scripts/crawl_industry_news.py`의
   `RSS_SOURCES`/`SCRAPERS`에도 fetcher를 추가해야 실제로 수집된다 — 정책 문서만 고쳐서는
   자동으로 수집되지 않는다.

## 메일링 브리프 실행 절차 (routine이 매주 월요일 수행)

- 소스: 이정호 이사(leejh77@k2korea.co.kr) 개인 Gmail 구독 뉴스레터함(Gmail MCP 연결).
  공식 검증 뉴스(위 산업뉴스)와 달리 `verified` 개념이 없는 가벼운 소스다.
1. 직전 실행 이후 도착한 구독 뉴스레터를 Gmail에서 읽는다.
2. 신발·패션·산업트렌드·연구·디자인·기어리뷰(`data/mailing-brief.json`의 `categories`) 중
   관련 있는 항목만 한국어 1~2문장으로 요약해 추린다.
3. 이미 저장된 항목(제목+발신처 URL 기준)과 중복되면 다시 추가하지 않는다.
4. `date` 기준 28일이 지난 기존 항목을 삭제한다.
5. `updatedAt`을 실행 완료 시각으로 갱신한다.
6. `node scripts/validate-mailing-brief.cjs`를 실행해 통과를 확인한 뒤에만 커밋·푸시한다.

## 실행 상태

- 2026-09-23부로 위 두 routine이 실제로 예약 실행 중이다(`https://claude.ai/code/routines`에서
  이름으로 확인 가능: "KLAB 산업뉴스 자동발행", "KLAB 메일링 브리프 자동발행").
- 검증기는 발행일·중복·분류·출처·보관기간(28일)을 기계적으로 검사한다. `verified` 값은 에이전트가
  원문을 확인했다는 편집 기록이며, 검증기가 사실관계를 판정한다는 뜻은 아니다.
- 2026-09-23 첫 테스트 실행 결과: 메일링 브리프는 정상 작동(Gmail 10건 반영, 커밋·푸시 완료).
  산업뉴스는 이 클라우드 환경의 네트워크 egress 정책이 WebFetch를 모든 외부 도메인에 차단하는 것을
  발견해 원문을 열 수 없었고, 미검증 스니펫으로 채우는 대신 0건 발행·미커밋으로 안전하게 종료했다.
  이후 '선정과 분류'의 대체 검증 방법(당시엔 Naver 뉴스API/WebSearch 교차검증)을 정책에 추가했다.
- **2026-09-28 발견**: 위 대체 방법 중 "Naver 뉴스API"(`mcp__PlayMCP__NaverSearch-search_news`)는
  실제로 존재하지 않는 도구였다(PlayMCP 커넥터에 미연결). 이 때문에 산업뉴스 routine이 매 실행마다
  국내 기사도 결국 WebSearch 교차검증에만 의존했고, 그 결과 확인 가능한 기사가 항상 발행 후 며칠~
  1주일 지난 것들이라 최신정보 페이지 최신 날짜가 실행일보다 계속 뒤처지는 현상이 있었다(2026-09-28
  leejh77 보고). 정책·routine 프롬프트에서 존재하지 않는 Naver 언급을 제거했다. 근본적 신선도
  한계(WebFetch 차단)는 해소되지 않았으니, 최신정보 페이지의 "최신" 날짜가 실행일보다 며칠 뒤처지는
  것은 당분간 정상 동작이다 — 완전히 해결하려면 WebFetch 차단 해제 또는 실제 작동하는 뉴스 검색
  API/MCP 연결이 필요하다.
- **2026-09-28 아키텍처 전환**: 위 신선도 한계를 근본적으로 없애기 위해 산업뉴스를 GitHub
  Actions 기반(`scripts/crawl_industry_news.py` + `industry-news-crawl.yml`)으로 옮겼다(위 '실행
  주체' 참고). 17개 active 출처 중 15개는 실제 fetch로 동작 확인(RSS 9개, HTML 스크래핑 6개),
  2개는 확인 못함 — `retaildive.com`은 Cloudflare managed JS challenge로 완전히 막혀 있어 일반
  HTTP로는 우회 불가(봇 탐지 우회는 시도하지 않음), `worldfootwear.com`은 작성 시점에 사이트 자체가
  503으로 다운돼 있어 스크래퍼를 넣긴 했지만 미검증 상태다(사이트 복구 후 재확인 필요). 이 2개
  출처는 당분간 산업뉴스에 반영되지 않는다.
- **2026-09-28 전환 완료**: `ANTHROPIC_API_KEY`를 GitHub Secrets에 등록한 뒤 수동 실행(workflow_dispatch)
  으로 검증. 첫 두 번은 분류 단계에서 `Connection error`로 실패했는데, 원인은 GitHub Secret에 등록된
  키 끝에 공백/줄바꿈이 섞여 있어 h11이 `LocalProtocolError: Illegal header value`로 요청 자체를
  거부한 것이었다(스크립트가 `.strip()`으로 방어 처리하도록 수정, `scripts/crawl_industry_news.py`).
  수정 후 실제 실행에서 **당일(9/28) 발행 기사 포함 9건**이 정상 발행됨 — 신선도 문제 해결 확인.
  이어서 기존 Claude 클라우드 루틴("KLAB 산업뉴스 자동발행", `trig_01GdSPEYSSuDRX9vkoYC617t`)을
  비활성화해 중복 발행을 막았다. 산업뉴스는 이제 전적으로 GitHub Actions
  (`industry-news-crawl.yml`)가 담당한다.
