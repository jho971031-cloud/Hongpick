# Hong Pick 5.2

기존 Flask + HTML/CSS/JS 프로젝트를 확장한 개인용 주식 대시보드입니다.

## 실행·배포

```sh
pip install -r requirements.txt
python server.py
```

기본 운영 주소: https://jho971031-cloud.github.io/Hongpick/

GitHub Pages가 화면과 수집된 JSON을 직접 제공합니다. Python 수집기는 `.github/workflows/pages.yml`의 GitHub Actions에서 30분 간격으로 실행하고 공개 파일만 Pages에 배포합니다. 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정합니다. 최초 실행은 Actions → Collect data and publish Hong Pick → Run workflow로 시작할 수 있습니다. 새 코드를 main에 올려도 자동 실행됩니다. 예약 실행은 지연될 수 있으며 공개 저장소는 60일간 활동이 없으면 예약 실행이 비활성화될 수 있습니다.

홈·거래대금·거장·공시·심리·관심종목 및 수집된 종목 차트는 Render 없이 동작합니다. 수집 범위는 한국/미국 TOP50, 운용사별 주요 10개 보유종목, 검증된 Trump 거래와 주요 검색 종목입니다. 미수집 종목은 화면 위 **미수집 종목 API 보완**이 켜져 있을 때만 기존 Render API를 호출합니다. 이 옵션을 끄면 Render 요청 없이 운영하며 없는 데이터는 없다고 표시합니다. 실시간 시세가 아닌 수집 시각 기준 데이터입니다. 아직 수집하지 않은 임의 종목을 즉시 조회하는 기능까지 모두 유지하려면 보조 API가 필요합니다.

기존 API 운영 주소는 https://hongpick.onrender.com/ 입니다. 기존 GitHub → Render 자동 배포를 유지합니다. Build: `pip install -r requirements.txt`, Start: `gunicorn server:app`. `/health`는 상태와 버전을 반환합니다. GitHub Pages의 지정된 Origin에만 공개 GET API의 CORS 응답을 허용합니다. 유료 서비스나 새 계정은 추가하지 않습니다. SEC 연락처는 환경변수 또는 저장소 변수 `SEC_CONTACT`로 지정할 수 있습니다. 승인된 CNN 호환 제공원은 Actions secret `CNN_FNG_URL` 또는 서버 환경변수로 설정합니다.

정적 파일 생성·미리보기:

```sh
python build_static.py --output public              # 기존 실제 스냅샷으로 오프라인 생성
python build_static.py --refresh --output public    # 제공원에서 실제 데이터 수집
python -m http.server 8000 --directory public
```

로컬 정적 미리보기는 `http://localhost:8000/?mode=static`으로 엽니다. Actions의 캐시는 날짜가 있는 실제 수집 결과를 실행 간 재사용하고 일봉·13F는 6시간, 종목 디렉터리는 24시간, 공시 목록은 1시간 기준으로 갱신합니다. 제공원 오류는 다른 메뉴에 영향을 주지 않으며 원래 수집 시각을 유지합니다. CNN 기본 주소는 접근 제한이 확인되어 정적 수집에서 재시도하지 않습니다.

## 동작하는 메뉴

- 홈: S&P 500, NASDAQ, Bitcoin 실제 지연 시세, 공통 13F 신호, 주식/암호화폐 Fear & Greed 선택과 상태.
- 검색: 한국어 회사명/별칭, 영어 회사명, 티커, 한국 코드 후보 선택. KRX/NASDAQ/NYSE/AMEX 심볼은 제공원 디렉터리와 연결합니다. 지원 범위는 이 네 거래소의 주식·ETF입니다.
- 차트: TradingView Lightweight Charts 5.2.1, 실제 한국 NAVER / 미국 Yahoo OHLCV. 일·주·월봉, 3가지 크기, 복수 SMA20/60/120/200, Wilder RSI14, 일목9/26/52/26·구름30%. 주·월봉은 일봉을 집계합니다. 미래 일목 좌표는 주말을 제외한 예상 날짜이며 거래소 공휴일까지 예측한 실제 거래일이 아닙니다.
- 거래대금: 한국/미국 TOP50, TOP10/20 범위 + RSI + 52주 고점 대비 + 상대거래량 조건을 동시에 적용합니다. **거래대금은 TradingView의 현재가×누적거래량 추정값**이며 체결대금 합계와 다릅니다. 주식과 ETF를 포함합니다. 지연 모드/수집 시각을 표시합니다.
- 거장: 공식 SEC 13F 6개 운용사, 최근·이전 분기 주식수/비중 비교, 신규/추가/감축/전량매도/유지 및 공통 보유/증가 신호. 13F 전체 자산이 아닌 신고대상 보유주식이며 옵션은 주식 신호에서 제외합니다. 보고서 원문 신고금액은 비중 계산에만 사용하고 USD 금액으로 추정하지 않습니다. CUSIP/주식종류별로 비교하고 확정되지 않은 티커는 검색 후보로 연결합니다. 13F-HR/A는 RESTATEMENT 대체 / NEW HOLDINGS 추가 방식으로 반영합니다. 13F-NT에서 단일 보고 주체가 명시되면 해당 공식 CIK의 보유 공시를 연결합니다. 보고 범위가 바뀐 첫 분기는 보유만 표시하고 신규·추가·감축 신호에서 제외합니다. 복수 보고 주체 등 자동으로 확정할 수 없는 경우 이전 데이터임을 표시합니다.
- Trump: OGE 공식 공개문서 목록과 공개일, 최신 2026-09-08 보고서에서 원문 이미지와 대조한 주요 주식 거래 11건. 전체 1,156건의 전수 전사가 아닙니다. 보고서 페이지/행 번호·금액 범위·거래일·공개일을 제공하고 공개일 이후 첫 거래일 종가 대비 변화를 계산합니다. 신규 문서 목록은 갱신하지만 스캔 PDF 거래 행을 무검증 자동 전사하지 않습니다.
- Fear & Greed: CNN 주식과 Alternative.me 암호화폐를 분리했습니다. **CNN 공개 API가 수집 요청을 차단하면 주식 탭은 데이터 없음으로 표시**합니다. 암호화폐 현재 지수/90일 이력은 실제 데이터입니다. 정식으로 허가된 호환 데이터 주소가 있으면 환경변수 `CNN_FNG_URL`로 지정할 수 있습니다.
- 관심종목: localStorage 저장/삭제, 시세·RSI·52주 고점·TOP50 순위·13F 신호와 차트 이동. 다른 브라우저/기기와 동기화하지 않습니다.

## 갱신과 오류 처리

Pages는 수집된 데이터를 5분 단위로 확인하며 화면에 필요한 파일만 불러옵니다. 같은 요청은 합치고 차트 라이브러리는 차트를 열 때 로드합니다. 일봉을 한 번 받으면 주봉·월봉을 브라우저에서 계산합니다. 최근 API 일봉 20개는 브라우저 IndexedDB에 보관해 연결 오류 때 이전 자료임을 표시하며 재사용합니다. 서버의 백그라운드 갱신은 최대 4개 작업으로 제한합니다. API 모드는 시세/순위90초, 일봉15분, F&G30분, 디렉터리24시간, SEC6시간, OGE문서1시간을 유지합니다.

`providers.py`: 시장 제공원·심볼 디렉터리·일봉 집계. `disclosures.py`: SEC/OGE 수집·비교. `cache.py`: 캐시. `charts.js`: 지표 계산·차트. `server.py`: 보조 API. `app.js`: 메뉴/저장/필터. `data-client.js`: 정적 데이터 우선 전송과 브라우저 캐시. `build_static.py`: 공개 파일 생성·수집. Pages 배포는 Actions에서 자동으로 생성합니다.

## 5.2 확인 사항

`python -m unittest -v test_architecture.py` 및 `node test_data_client.js`: 네트워크 없는 공개 파일 생성, 수집 시각 보존, 캐시 복원과 장애 처리, 지정된 Origin만 CORS 허용, Render 요청 없는 후보 검색·TOP50·일봉/주봉/월봉, 중복 요청 합치기를 검증합니다. 실제 최초 수집은 일봉127개·시세128개였으며 `KRX:266690` 일봉은 제공원에서 받지 못해 없는 데이터로 처리했습니다. 숫자는 매 수집 결과에 따라 달라집니다. 모바일375px/PC1085px에서 가로 넘침이 없고 한국 TOP50 및 복합 필터, 지표·관심종목을 확인했습니다. 관심종목을 먼저 열었을 때 거장 화면이 비는 이동 순서 문제도 보완했습니다.

## 확인

실제 KR/US/NYSE/AMEX API, 2년 OHLCV 정합성, 후보 검색, 공시 비교, 공개 이후 가격 계산 및 장애 폴백을 검증했습니다. 지표 계산은 독립 기대값으로 SMA, Wilder RSI 상승/횡보, 일목 기간과 26봉 이동을 검증했습니다. `/responsive-check.html`에서 모바일390px/PC1100px을 동시에 조작할 수 있습니다.

TradingView Lightweight Charts: Apache-2.0, `LICENSE-lightweight-charts.txt`. 차트 내 로고와 TradingView attribution 링크를 유지합니다.

## 5.1 확인 사항

GitHub Pages의 정적 파일 경로 오류를 운영 사이트 이동으로 해결했습니다. 메뉴 뒤로/앞으로 가기, 한국·미국 전환 시 차트 시장 일치, 관심종목 시세와 보조 신호의 독립 로딩, 홈 지수의 실제 수집 스냅샷, F&G 시장 선택 저장, 공시 종목 검색을 추가했습니다.

`python -m unittest -v test_disclosures.py`: 정정공시 대체/추가, 동일 주식종류 합산, 알 수 없는 정정 유형 거부, 공식 보고 주체 연결 및 복수 후보 거부를 검증합니다. 실제 SEC 6개 운용사의 2026-06-30 공시와 NAVER/Yahoo/TradingView API도 확인했습니다. 13F 정정 처리 근거: https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f
