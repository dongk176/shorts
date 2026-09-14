# 제목 말투 지침 복원 비교 — 2026-09-14
## 변경 범위
단순화본 a75fa0ef에서 localized_selection_prompts.json의 영어·일본어 제목 말투 문단 두 개만 b11de2b 원문으로 복원했다. 금액·조건·비유 규칙 삭제 및 댓글·번역 단순화는 유지했다. 일반 사용자 워커·운영 배포·설정 변경은 없다.
## 방법과 한계
승인 대본 11932·11938·11941·11944의 이전 수정본이 고른 16개 장면을 고정했다. 각 대본에 단순화/복원 조건을 3회씩 적용하고 순서를 교차했다. Gemini 3.5 Flash Lite, 요청당 90초, 재시도 0회, 24회 요청으로 96개 제목을 비교했다. 기존 선택 시스템 지시문에 동일한 제목 전용 요청과 스키마를 적용했다. 장면 재선정·댓글·자막·영상 렌더링을 수행한 운영 파이프라인 검증은 아니다. 이전에 생성한 제목은 입력에 넣지 않았다.
## 결과
24회 모두 응답 형식과 출력 언어 확인에 성공했다. 영어는 복원본에서 주제·행동이 더 드러나는 결과가 관찰됐다. 특히 판정 개선 구간은 복원본 3회 모두 “Call it fair / Fix it later”로 같은 해결책을 드러냈다. 영어 제품 영상도 “Samsung’s / Genius Move”보다 “Samsung’s Clever / Apple Trap”처럼 대상은 구체적이지만 과장 가능성은 남았다. 일본어는 개선이 일관되지 않았고 복원본에서도 3만5천 톤을 3만 톤으로, 104.5mm를 104mm로 쓰는 결과가 있었다. 지침 복원만으로 정확성 개선을 주장하지 않는다. 단일 모델·4개 영상·3회 비교이므로 전체 품질 개선율을 추정하지 않는다.
## 검사
관련 프롬프트·보완 검사 34개 통과. JSON 변경이 정확히 두 말투 문단뿐이며 두 문단 모두 이전 원문과 일치함을 별도 대조했다. 새 예시·금지 지침·검사 로직을 추가하지 않았다.
## 전체 원문 비교
각 줄의 /는 제목 줄바꿈이다.
### 11932
| 반복 | 장면 | 단순화본 | 말투 복원본 |
|---|---|---|---|
| 1 | 1 | 学習後の画像生成が / 楽しすぎる理由とは | 学習したLoRAを / 外部ツールへ移行する裏技 |
| 1 | 2 | 完全無料で自分だけの / AIモデルを作る方法 | 完全無料でAIを学習 / 画像生成の全工程を公開 |
| 1 | 3 | 初心者でも簡単すぎ！ / 無料ポイントの裏技 | 初心者でも簡単すぎた / 無料のAIトレーニング手順 |
| 1 | 4 | 有料級なのに無料！？ / 最強の神ツール登場 | 有料サービスはもう不要 / 話題の神ツールを徹底解説 |
| 2 | 1 | 学習済みのLoRAを / 外部で使う方法 | 学習したLoRAを / 外部ツールへ移行する |
| 2 | 2 | 完全無料でAIを学習 / 画像生成の全工程 | 完全無料で自分だけの / AIモデルを作る方法 |
| 2 | 3 | 初心者でも簡単すぎ / 無料のLoRA作成 | 毎日ポイントが復活し / トレーニングが無料 |
| 2 | 4 | 有料級のAI学習が / まさかの完全無料 | 有料サービスを超える / 次世代のAIプラットフォーム |
| 3 | 1 | 学習したLoRAで画像生成 / 外部ツールへの持ち出しも可能 | 学習済みのLoRAで / 理想の画像を量産する |
| 3 | 2 | 完全無料でAIを自作する / 自分だけのモデルを作る方法 | 完全無料でAI学習 / 画像生成の裏技を公開 |
| 3 | 3 | 初心者でも迷わない設定 / 毎日無料で使える仕組みとは | 毎日ポイント回復で / ずっと無料で使える |
| 3 | 4 | 有料サービスはもう不要？ / 無料で使える最強ツール | 有料サービスはもう不要 / 最強の代替ツールを発見 |
### 11938
| 반복 | 장면 | 단순화본 | 말투 복원본 |
|---|---|---|---|
| 1 | 1 | 名古屋を救った / 地下の巨大空間 | 名古屋を救った地下の正体 / 最大3万トンの巨大空間 |
| 1 | 2 | 雨水10万トンを / 貯める地下トンネル | 地下に広がる涼しい空間 / 10万トンの雨水調整池 |
| 1 | 3 | 観測史上最大雨量で / 店が水浸しに | 観測史上最大の104ミリ / 居酒屋を襲った甚大な被害 |
| 1 | 4 | 名古屋の治水対策は / 先進的だが課題も | 名古屋市の洪水対策とは / 専門家が評価する理由 |
| 2 | 1 | 名古屋を救った / 謎の巨大地下空間 | 上社駅の地下に隠された / 3万5千トンの巨大空間 |
| 2 | 2 | 貯水量はなんと / 10万トンの地下施設 | 名古屋を水害から守る / 10万トンの地下施設 |
| 2 | 3 | 観測史上最大の雨で / 居酒屋が水浸しに | 観測史上最大104ミリ / 街を襲った豪雨の爪痕 |
| 2 | 4 | 名古屋の洪水対策 / 専門家の意外な評価 | 名古屋の治水対策は / 実はかなり先進的だった |
| 3 | 1 | 名古屋を救った地下の秘密 / 巨大空間が洪水を防いだ | 上社駅の地下に隠された / 3万5千トンの巨大空間 |
| 3 | 2 | 地下に眠る巨大な調整池 / 十万トンの雨水を溜める | 名古屋を水害から守る / 10万トンの地下トンネル |
| 3 | 3 | 観測史上最大の豪雨被害 / 居酒屋が水に浸かった夜 | 観測史上最大104ミリ / 居酒屋を襲った浸水被害 |
| 3 | 4 | 名古屋の洪水対策は先進的 / 専門家が評価する理由 | 専門家が評価する / 名古屋の先進的な治水対策 |
### 11941
| 반복 | 장면 | 단순화본 | 말투 복원본 |
|---|---|---|---|
| 1 | 1 | Samsung's / Genius Move | Samsung's Clever / Apple Trap |
| 1 | 2 | The New / Smaller Fold | Why This Foldable / Is Actually Good |
| 1 | 3 | No More / Visible Crease | Samsung Fixed / The Big Crease |
| 1 | 4 | Over Two / Thousand Dollars | Foldables Just / Got Way More Pricey |
| 2 | 1 | Samsung's / Big Move | Samsung's Clever / Apple Trap |
| 2 | 2 | The New / Foldable | Why This Foldable / Feels So Good |
| 2 | 3 | No More / Crease? | Samsung Finally / Fixed The Crease |
| 2 | 4 | Over / $2,000? | The Brutal Price / Of New Phones |
| 3 | 1 | Samsung's / Genius Move | Samsung's Clever / Apple Trap |
| 3 | 2 | The New / Smaller Fold | The New Small / Foldable Phone |
| 3 | 3 | Samsung's / Biggest Fix | Samsung Fixed / The Big Crease |
| 3 | 4 | Why Phones / Cost More | Why Phones Are / Getting Pricier |
### 11944
| 반복 | 장면 | 단순화본 | 말투 복원본 |
|---|---|---|---|
| 1 | 1 | Terrible Call / Just A Guess | Total guess / Bad call! |
| 1 | 2 | Fix The Game / Easier Cleanups | Call it fair / Fix it later |
| 1 | 3 | Total Rage / Stolen Run | How did he / Not score? |
| 1 | 4 | Side By Side / Proof It Scored | Judge Jimmy / Rules on it |
| 2 | 1 | Total Guess / Bad Umpire? | Awful Umpire / Total Guess |
| 2 | 2 | Rule Change / Needed Now | Call It Fair / Fix It Later |
| 2 | 3 | Robbed Run / Pure Rage | Robbed Run / Absolute Rage |
| 2 | 4 | Instant Replay / Proves Truth | The Overlap / Proof It Counts |
| 3 | 1 | Bad Call? / Total Guess! | Total guess / Bad umpiring |
| 3 | 2 | Fair Or Foul? / The Fix Is In | Call it fair / Fix it later |
| 3 | 3 | Robbed Run! / Pure Rage! | Two outs left / Stolen run |
| 3 | 4 | Video Proof / He Was Safe | Editing magic / Proof he scores |
## 배포 상태
로컬 수정 및 제목 비교만 완료했다. 실제 관리자 워커는 아직 기존 배포를 사용한다. 원시 요청·응답·사용량은 .tmp/title-style-retest-20260914/results.json 및 SUMMARY.json에 기록했다.
