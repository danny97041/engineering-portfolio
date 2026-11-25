# Online PINN PDE Framework V3 · 연구 결과

공식 v3.0.4의 저장 실험 65개를 9개 PDE 구성과 5개 방법으로 비교했다. 아래 수치는 각 실험에서 선택된 체크포인트의 원본 상대 L2 오차이며 값이 작을수록 기준장과 가깝다. 다중 출력 후보의 값은 출력 성분별 상대 L2의 최댓값이다.

Wave는 원본 historical reference를, 나머지 구성은 해당 후보의 고정 평가점을 사용한다. Wave와 Heat는 방법별 3개 시드, 나머지는 1개다. 단일 시드의 재현 변동성은 추정할 수 없다. 계수 오차는 Wave와 Kovasznay 역문제에서만 제공한다.

| PDE | 평가점 | 방법 | 시드 수 | 평균 상대 L2 | 시드 표준편차 |
|---|---|---|---:|---:|---:|
| burgers | fixed_4096_LHS | baseline | 1 | 0.000235185 | — |
| burgers | fixed_4096_LHS | ff | 1 | 0.0181156 | — |
| burgers | fixed_4096_LHS | ff_curriculum | 1 | 0.0453273 | — |
| burgers | fixed_4096_LHS | ff_loss_sa | 1 | 0.03339 | — |
| burgers | fixed_4096_LHS | loss_sa | 1 | 0.000214329 | — |
| darcy2d | fixed_4096_LHS | baseline | 1 | 0.00164943 | — |
| darcy2d | fixed_4096_LHS | ff | 1 | 0.00207431 | — |
| darcy2d | fixed_4096_LHS | ff_curriculum | 1 | 0.00343963 | — |
| darcy2d | fixed_4096_LHS | ff_loss_sa | 1 | 0.000488743 | — |
| darcy2d | fixed_4096_LHS | loss_sa | 1 | 0.000484092 | — |
| heat2d | fixed_4096_LHS | baseline | 3 | 0.00107466 | 0.000125752 |
| heat2d | fixed_4096_LHS | ff | 3 | 0.00461187 | 0.00070194 |
| heat2d | fixed_4096_LHS | ff_curriculum | 3 | 0.00557871 | 0.000905698 |
| heat2d | fixed_4096_LHS | ff_loss_sa | 3 | 0.00538775 | 0.00144707 |
| heat2d | fixed_4096_LHS | loss_sa | 3 | 0.00127787 | 0.000127288 |
| kovasznay_forward | fixed_4096_LHS | baseline | 1 | 0.00217906 | — |
| kovasznay_forward | fixed_4096_LHS | ff | 1 | 0.00224008 | — |
| kovasznay_forward | fixed_4096_LHS | ff_curriculum | 1 | 0.00217585 | — |
| kovasznay_forward | fixed_4096_LHS | ff_loss_sa | 1 | 0.00167412 | — |
| kovasznay_forward | fixed_4096_LHS | loss_sa | 1 | 0.00246671 | — |
| kovasznay_inverse | fixed_4096_LHS | baseline | 1 | 0.00213683 | — |
| kovasznay_inverse | fixed_4096_LHS | ff | 1 | 0.00388477 | — |
| kovasznay_inverse | fixed_4096_LHS | ff_curriculum | 1 | 0.00330838 | — |
| kovasznay_inverse | fixed_4096_LHS | ff_loss_sa | 1 | 0.00274859 | — |
| kovasznay_inverse | fixed_4096_LHS | loss_sa | 1 | 0.00260257 | — |
| poisson2d | fixed_4096_LHS | baseline | 1 | 0.00156316 | — |
| poisson2d | fixed_4096_LHS | ff | 1 | 0.00183036 | — |
| poisson2d | fixed_4096_LHS | ff_curriculum | 1 | 0.00314828 | — |
| poisson2d | fixed_4096_LHS | ff_loss_sa | 1 | 0.000455964 | — |
| poisson2d | fixed_4096_LHS | loss_sa | 1 | 0.000472187 | — |
| reaction_diffusion | fixed_4096_LHS | baseline | 1 | 0.00764944 | — |
| reaction_diffusion | fixed_4096_LHS | ff | 1 | 0.0147974 | — |
| reaction_diffusion | fixed_4096_LHS | ff_curriculum | 1 | 0.0166948 | — |
| reaction_diffusion | fixed_4096_LHS | ff_loss_sa | 1 | 0.0162145 | — |
| reaction_diffusion | fixed_4096_LHS | loss_sa | 1 | 0.00665983 | — |
| taylor_green | fixed_4096_LHS | baseline | 1 | 0.00599725 | — |
| taylor_green | fixed_4096_LHS | ff | 1 | 0.0362884 | — |
| taylor_green | fixed_4096_LHS | ff_curriculum | 1 | 0.0342104 | — |
| taylor_green | fixed_4096_LHS | ff_loss_sa | 1 | 0.0340823 | — |
| taylor_green | fixed_4096_LHS | loss_sa | 1 | 0.00579079 | — |
| wave2d | historical_reference | baseline | 3 | 0.0531847 | 0.00902195 |
| wave2d | historical_reference | ff | 3 | 0.00243048 | 0.000394113 |
| wave2d | historical_reference | ff_curriculum | 3 | 0.00204891 | 6.59249e-05 |
| wave2d | historical_reference | ff_loss_sa | 3 | 0.00289852 | 0.000539131 |
| wave2d | historical_reference | loss_sa | 3 | 0.0242806 | 0.00266614 |

[65개 실험의 원본 지표 CSV](experiments.csv) · [공식 릴리스](https://github.com/danny97041/online-pinn-pde-framework/releases/tag/v3.0.4)

브라우저 변환 결과는 고정 좌표에서 TensorFlow 출력을 재현하는지 검사한 것이다. 원본의 물리 승인 상태는 CSV의 overall_physics_approved에 보존했다.
