"""Publish only tabular research results and the source benchmark's evaluation conditions."""
import argparse
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

FIELDS = ["equation","arm","seed","field_points","field_l2","lambda_error","adam_iteration",
          "adam_field_l2","lbfgs_objective_evaluations","overall_physics_approved","version"]

def publish(source, dest):
    data=json.loads(source.read_text(encoding="utf-8"))
    groups=defaultdict(list)
    dest.mkdir(parents=True,exist_ok=True)
    with (dest/"experiments.csv").open("w",encoding="utf-8",newline="") as stream:
        writer=csv.DictWriter(stream,fieldnames=FIELDS,extrasaction="ignore")
        writer.writeheader()
        for row in sorted(data["runs"],key=lambda r:(r["equation"],r["arm"],r["seed"])):
            writer.writerow(row)
            groups[row["equation"],row["field_points"],row["arm"]].append(row["field_l2"])
    lines=["# Online PINN PDE Framework V3 · 연구 결과","",
           "공식 v3.0.4의 저장 실험 65개를 9개 PDE 구성과 5개 방법으로 비교했다. 아래 수치는 각 실험에서 선택된 체크포인트의 원본 상대 L2 오차이며 값이 작을수록 기준장과 가깝다. 다중 출력 후보의 값은 출력 성분별 상대 L2의 최댓값이다.","",
           "Wave는 원본 historical reference를, 나머지 구성은 해당 후보의 고정 평가점을 사용한다. Wave와 Heat는 방법별 3개 시드, 나머지는 1개다. 단일 시드의 재현 변동성은 추정할 수 없다. 계수 오차는 Wave와 Kovasznay 역문제에서만 제공한다.","",
           "| PDE | 평가점 | 방법 | 시드 수 | 평균 상대 L2 | 시드 표준편차 |",
           "|---|---|---|---:|---:|---:|"]
    for (eq,grid,arm),values in sorted(groups.items()):
        sd=f"{statistics.stdev(values):.6g}" if len(values)>1 else "—"
        lines.append(f"| {eq} | {grid} | {arm} | {len(values)} | {statistics.mean(values):.6g} | {sd} |")
    lines.extend(["","[65개 실험의 원본 지표 CSV](experiments.csv) · [공식 릴리스](https://github.com/danny97041/online-pinn-pde-framework/releases/tag/v3.0.4)","",
                  "브라우저 변환 결과는 고정 좌표에서 TensorFlow 출력을 재현하는지 검사한 것이다. 원본의 물리 승인 상태는 CSV의 overall_physics_approved에 보존했다."])
    (dest/"README.md").write_text("\n".join(lines)+"\n",encoding="utf-8")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog",type=Path)
    parser.add_argument("destination",type=Path)
    args=parser.parse_args()
    publish(args.catalog,args.destination)

