# PhysicsAI Lab v1 · 연구 서비스 계약

기준은 Online PINN PDE Framework v3.0.4의 selected weights와 Phase 9에서 검증한 공식 ZIP이다. 원본 FastAPI의 equation, arm, seed, points, prediction 필드와 순서를 보존한다. 사이트 모델 버전은 이 세 식별자에 릴리스와 가중치 SHA-256을 추가한다. 동일 실험의 새 버전은 별도 레코드이며 기본 모델 포인터만 이동한다. 원본 체크포인트, Adam 결과, L-BFGS 선택 결과와 브라우저 변환물의 해시는 개별 기록한다.

## 입력과 출력

|문제|물리좌표 순서와 닫힌 영역|출력|종류|
|---|---|---|---|
|Wave|x,y,t · wave source config의 각 min/max|u|λ 역문제|
|Heat, Reaction-diffusion|x,y,t · [0,1]³|u|순방향|
|Poisson, Darcy|x,y · [0,1]²|u|순방향|
|Burgers|x,t · [-1,1] × [0,1]|u|순방향|
|Kovasznay|x,y · [-0.5,1] × [-0.5,1.5]|u,v,p|순방향 및 ν 역문제|
|Taylor–Green|x,y,t · [-π,π]² × [0,1]|u,v,p|순방향|

원본 수치 좌표와 고정된 압력 기준을 사용한다. 별도 SI 단위 환산이나 출력 정규화는 적용하지 않는다. 요청당 1–1024행, 좌표·출력은 유한수, 응답은 N × 출력 수다. 예를 들어 heat2d/baseline/3234에 [[0.2,0.3,0.1]]을 보내면 [[u]]를 반환한다. 미등록 모델과 비활성 모델은 조회 오류, 입력 형식·차원·영역 오류는 검증 오류로 처리한다. 추론 실패 시 다른 모델의 수치를 대신 표시하지 않는다.

## 변환 판정과 연구 지표

브라우저는 물리좌표를 [-1,1]로 정규화한 후 원본 방식의 Fourier 특징, tanh 은닉층, 선형 출력층을 실행한다. 기존 TensorFlow CPU float32를 기준으로 **모든 출력 성분**에서 |JS−TF| ≤ 0.00001 + 0.0001 × |TF|를 요구한다. Phase 9 배치/단점 편차와 원점 근방의 절대 오차를 고려해 정한 응용 기준이다. 양 끝점, 중앙, 한 경계면, Halton(2,3,5) 내부 32점으로 모델당 36점을 고정한다. web/contract.mjs를 검증과 서비스에서 공유한다. 실패한 변환 모델은 라이브 선택을 차단하고 저장 지표는 계속 열람할 수 있다. 동일 좌표 순서를 사용하는 브라우저에서 재검증한다. 변환 일치는 PDE 물리 승인과 독립이다.

summary.json의 field_l2, lambda_error, field_points, adam_iteration, postprocess 조건과 출처를 보존한다. 저장 L2와 시각화 격자의 성분별 절대오차, 상대오차, 단면은 출처를 따로 표시한다. 상대오차는 |reference| ≤ 1e-8에서 결측으로 처리한다. 시드 분산은 동일 PDE·방법·평가점 정책 안에서 표본 분산(n−1)으로 계산하며 단일 시드는 결측이다. 순방향 계수 오차는 null이다. 서로 다른 PDE 잔차의 통합 순위나 종합 물리 승인을 생성하지 않는다.

## 실행 및 권한

원본 ZIP은 전체 해시와 manifest를 검증한 신뢰 경로에서만 변환한다. 선택 가중치·결과·연구 문서는 비공개 사이트에만 적재한다. 공개 포트폴리오에는 자체 작성 코드와 검증 요약을 선별한다. 라이선스/권리 확인 전 원본 코드와 파생 가중치의 공개 재배포를 보류한다. 사용자 패키지는 제한된 데이터 전용 형식, 불변 ID, 모델/파일 해시와 스키마, 드라이런 및 소유자 승인 경로를 사용한다. 새 아키텍처와 PDE는 별도 어댑터가 필요하다.

가중치 전용 NPZ/HDF5에는 계산 그래프가 없다. 원본에서 복원 후 TensorFlow.js SavedModel 변환 또는 ONNX 그래프 생성이 가능하지만 각각 지원 연산 및 별도 런타임 검증이 필요하다. 우선 JS에서 검증 가능한 연산만 구현한다. 원본 FastAPI는 Colab/Python 환경의 독립 경로다. Sites 정적 호스팅·Worker 형식은 설치된 Sites 스킬에서 확인했다. 소유자 비공개 여부는 해당 배포의 실제 접근 설정으로 판정한다.

[TensorFlow 변환](https://www.tensorflow.org/js/guide/conversion) · [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) · [OpenAI Sites 권한](https://learn.chatgpt.com/docs/enterprise/higher-education-roles-and-permissions#workspace-capabilitiessites)
