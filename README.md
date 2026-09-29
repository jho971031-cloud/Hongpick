# Hong Pick

개인용 투자 대시보드. Flask 서버와 정적 HTML/CSS/JS로 실행됩니다.

## 실행

```bash
pip install -r requirements.txt
python server.py
```

Render의 `render.yaml`은 무료 Python 웹 서비스, `gunicorn server:app`, `/health` 점검, GitHub 커밋 자동 배포를 설정합니다. 코드는 API 키를 저장하지 않습니다.

## 데이터 상태

- **실제 데이터**: Alternative.me 암호화폐 Fear & Greed(최근 31일, 1시간 캐시). 미국 주식시장 CNN Fear & Greed와 다른 지표입니다.
- **조건부 실제 데이터**: Yahoo Finance 공개 검색·일봉 API가 응답하면 검색 후보, 가격, RSI(14), 1년 일봉 최고가 대비 낙폭을 표시합니다. 해당 서비스는 비공식 접근이며 429 제한이 생길 수 있습니다. 브라우저는 실패 시 숫자를 숨깁니다.
- **미연결**: 한국/미국 전체 거래대금 TOP50, 거래대금 급증, 13F 종목별 증감과 투자자 공통매수, 트럼프 공시 거래. 이들 메뉴는 확인된 공급원 없이 가상 수치를 보여주지 않습니다. TOP50에는 두 시장을 포괄하는 거래소 수준의 공급원이 필요합니다.
- **차트**: TradingView 무료 Advanced Chart 위젯. 정확한 기간별 MA 중복 적용, RSI/일목 설정 상태 동기화, 구름 투명도 제어는 이 임베드로 보장되지 않아 별도 버튼을 비활성화했습니다. 미국 종목 차트에서는 TradingView 자체 지표 메뉴를 이용할 수 있습니다. 한국 KRX 심볼은 무료 임베드에서 표시되지 않아 전체 TradingView 차트로 연결합니다.
- **관심종목**: 해당 브라우저 localStorage에 저장됩니다. 다른 기기와 동기화되지 않습니다.

`/api/search`, `/api/stock`, `/api/fng`, `/api/turnover`, `/api/gurus`, `/api/trump`, `/health`가 사용됩니다. 공급원 오류 시 HTTP 503 또는 명시적 빈 결과를 반환합니다. 13F는 분기말 공시 포지션이며 실시간 매매가 아닙니다. 트럼프 공개 공시는 13F와 별개이며 운용 주체를 확인하지 않고 직접 투자 판단으로 표현하지 않습니다.

기존 `README.txt`는 버전3의 기록입니다. 현재 동작 기준은 이 문서입니다.
