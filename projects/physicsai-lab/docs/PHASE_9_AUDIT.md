# V3 원본 검증 · 2026-11-25

| 대상 | 고정한 기준 |
|---|---|
| 최신 main 관찰 | ff9e551780cded103d9de8e6280d517598219320, V4가 추가된 커밋 |
| PhysicsAI Lab 입력 소스 | v3.0.4, 374051dc307aa0a66b58e6816c7e97e6dbbfe9b7 |
| 공식 V3 결과 ZIP | 43,467,923바이트, SHA-256 311d0756d342d442e33f4003a30e795a1e7f1bf06c8d408bf3783b62d4b0bfcf |
| 릴리스 노트북 | 855,200바이트, SHA-256 8a7ce5a7e6b75efc7b0ddb6d9ce892e5c858cf795a35c84662b20fa76c152dd4. 태그에 있는 파일과 일치 |
| 로컬 동명 파일 | 43,378,811바이트, SHA-256 fa0b399441052316ddd65bed1581ceae196d77bd156de0181f30c882cefe200e. 공식 사본과 별도 |

V3.0.4를 웹 확장의 입력으로 고정했다. 최신 main의 V3 대비 차이는 노트북, 안내 문서 두 개와 Wave 검사 출력 문구 한 곳이며, 최신 README가 추가 소개하는 V4 비교 실험은 별도 버전이다. [V3 태그](https://github.com/danny97041/online-pinn-pde-framework/tree/v3.0.4) · [최신 확인 커밋](https://github.com/danny97041/online-pinn-pde-framework/tree/ff9e551780cded103d9de8e6280d517598219320) · [V3.0.4 릴리스](https://github.com/danny97041/online-pinn-pde-framework/releases/tag/v3.0.4)

## 실험·저장 형식

| 문제 | 방향 | 시드 | 실험 |
|---|---|---|---:|
| Wave 2D | 역문제 | 3234, 3235, 3236 | 15 |
| Heat 2D | 순방향 | 3234, 3235, 3236 | 15 |
| Poisson 2D, Burgers, Darcy 2D, Reaction–Diffusion | 순방향 | 각 3234 | 각 5 |
| Kovasznay Forward, Taylor–Green | 순방향 | 각 3234 | 각 5 |
| Kovasznay Inverse | 역문제 | 3234 | 5 |

각 PDE·시드는 baseline, loss_sa, ff, ff_loss_sa, ff_curriculum의 조합이다. summary.json의 고유 행 65개를 확인하고 comparison.csv의 45개 PDE·방법 집계와 시드 수·물리장 평균 오차를 재계산해 일치시켰다. 물리장 오차는 저장된 평가점의 상대 L2이며, 계수 오차는 역문제 별도 항목이다. 순방향 행에 계수 오차가 들어간 경우는 0개였다. 1시드 문제에는 표본 표준편차를 제시하지 않는다.

| 입력 | 모델 복원 경로 | 주의점 |
|---|---|---|
| Wave 15건 | 중첩 inputs/wave_parent.zip의 selected.weights.h5, wave_source.zip의 설정 | 좌표 x,y,t, 설정의 레이어·정규화·Fourier 스케일, 출력 u, 역문제 계수 |
| 나머지 50건 | candidates/<equation>/seed_<seed>_<arm>/selected_weights.npz, 코드의 PDE 명세, 선택 체크포인트 | 물리 영역을 [-1,1]로 변환. Fourier 방법은 시드별 고정 투영과 sin/cos 순서를 재현해야 한다. Burgers는 x,t. 다른 문제는 모델 명세의 입력과 출력 순서를 사용한다. |

선택 가중치와 Adam 상태·재개용 배열은 서로 다른 역할을 갖는다. 저장 집계, 새 좌표의 모델 추론, 새 격자에서의 계산, 향후 학습은 각각 출처를 유지한다. [모델 등록·복원 구현](https://github.com/danny97041/online-pinn-pde-framework/blob/v3.0.4/v3/model_registry.py) · [추론 분기](https://github.com/danny97041/online-pinn-pde-framework/blob/v3.0.4/v3/distribution.py)

## 코드 진입점

- 저장 결과는 python -m v3 → release_open → ZIP manifest 검증 → summary.json·REPORT.md로 이어진다. TensorFlow가 활성화되기 전 참조 가능한 집계 경로다.
- FastAPI는 release_services → UnifiedAgent와 UnifiedRAG → v3_api_app으로 구성한다. /health, /comparison, /report, /models, /model/info, /rag/search, /rag/context, /agent/tool, /agent/ask, /predict, /predict/batch, /predict/active, /registry 및 선택 활성화·복원을 제공한다. 좌표 배치 상한은 1,024점이다. 등록 쓰기는 기본 비활성이며 배포용 인증은 별도 계약이 필요하다.
- BM25와 선택형 E5의 가중 RRF 및 NumPy/FAISS 정확 검색 경로가 있다. Qwen은 도구 의도를 제안하며 제어기가 허용된 동작을 실행한다. 학습과 재개는 별도 실행 허용과 TensorFlow·SciPy에 의존한다. Matplotlib는 보고서 시각화에, ipywidgets는 Colab 인터페이스에 사용한다.
- CI는 Python 3.12 구문 검사, 생성 노트북 동기화와 결과 조회 시 TensorFlow 비의존 확인을 수행한다. 릴리스 태그 및 최신 main의 V3 구문·노트북 동기화와 CLI 조회를 로컬에서 확인했다. 최신 main의 공개 문서 검사도 통과했다. [API 정의](https://github.com/danny97041/online-pinn-pde-framework/blob/v3.0.4/v3/api_routes.py) · [원본 CI](https://github.com/danny97041/online-pinn-pde-framework/blob/v3.0.4/.github/workflows/v3-source.yml)

## ZIP 검증 기록과 권한

공식 SHA-256, ZIP CRC, manifest 항목 503개의 해시와 포함 범위, 소스 파일 22개의 해시를 확인했다. ZIP 내부의 소스 22개는 태그 파일과 동일하다. validation/status.json의 보조 인덱스에서 current.json과 status.json에 적힌 값은 최종 내용과 일치하지 않는다. 전체 ZIP을 검증하는 외부 릴리스 해시 및 내부 manifest는 두 파일을 포함해 모두 일치했다. 따라서 보조 인덱스는 역사적 분류에 사용하고 파일 무결성은 릴리스·manifest 기준으로 확인한다.

저장 Colab run 9f88d997의 환경·실행 소스 해시·선택 검사와 이전 로컬 패치의 실패 기록은 별도 보존돼 있다. 현재 PC 실행 결과는 아래 재현 기록으로 판단한다. 65개의 원본 학습을 다시 수행한 증거는 없다.

원본 README는 별도 라이선스 미지정으로 표기한다. 포트폴리오에는 새 감사 스크립트와 검증 요약을 게시하고, 사이트용으로 원본 코드·가중치·결과 재배포가 필요한 범위는 Phase 10에서 확정한다. 릴리스 아카이브와 Git 원본은 다운로드 검증용 별도 경로에서 사용했다.

## 이번 로컬 실행

Windows x64, Python 3.12.14, TensorFlow CPU 2.20.0, Keras 3.15.1, NumPy 2.5.5, SciPy 1.16.3, FastAPI 0.121.3, HTTPX 0.28.1 환경이다.

| 실제 실행 | 결과 |
|---|---|
| tools/test_v3_interface.py | 41개 검사 통과. 로컬 폼, 65건 결과 조회, 학습 승인 경계와 노트북 소스 해시 점검 |
| tools/test_v3_services.py | 64개 검사 통과. FAISS 1.13.0의 실제 인덱스를 시험용 임베딩으로 점검. 이 회귀의 모델 응답은 형태 대역 |
| scripts/smoke_v3.py --all | 원본 TensorFlow 가중치 65/65 로드·추론. 각 모델의 물리 영역 내 3개 좌표, 출력 차원·유한값·단일/배치 일치 확인. 최대 절대차 5.0850e-7 |
| 로컬 FastAPI ASGI | 헬스·집계·실제 Heat 배치 추론·BM25 200. 영역 밖과 초과 입력 필드 422. 기본 등록 쓰기 403 |

원본 인터페이스 검사는 Colab 브라우저/Drive를 모의했다. 원본 수치 재학습과 추가 학습·재개 검사는 선택 실행 범위이며 이번에는 수행하지 않았다. 브라우저 변환 모델과 TensorFlow 사이의 직접 비교, 실제 E5·Qwen 호출은 후속 검증 대상이다. 추론 숫자는 저장 실험의 훈련 정확도 재현 또는 독립 CFD 검증 결과로 해석하지 않는다.
