# 校閲APIの応答

ローカルAPIのhealthと、校閲を呼ばない不正要求への応答を確認する。2026-10-01 initで`service.1`〜`service.4`を実HTTPで確認済み。証拠は`.agent/qa/runs/init-20261001-retry/`。実AIや標準サービスの実行枠の証明ではない。

## Sub-features

- `service.1`: `GET /health`が稼働状態と設定有無を返す。
- `service.2`: 未許可Originを403で拒否する。
- `service.3`: `GET /review`を405で拒否する。
- `service.4`: 不正なJSONの`POST /review`を400で拒否する。

## How to get to it (user POV)

- ローカル校閲APIの`GET /health`。
- 同APIへのOrigin付き`GET /health`、`GET /review`、JSONの`POST /review`。

## Driving it with Orca / HTTP

Preconditions:

- 共通LaunchとDoctor成功。当runの`ports.json`に指定したportを使う。
- `https://minaosi-qa.invalid`は許可Originに含めない。外部へアクセスするURLではなく合成のrequest header。
- 新runなのでレート制限に達していない。要求は不正JSONまでで、外部AIを呼ばない。

- **health (`service.1`, GET /health)。** `mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts service qa-20261001-01`が実際に`GET /health`する。200、`ok:true`、booleanの`configured`、`cache-control:no-store`を確認。`service.1-action.json`とbody/responseを保存する。
- **Origin拒否 (`service.2`, Origin付きGET /health)。** 同commandが`Origin: https://minaosi-qa.invalid`でGETする。403、本文「許可されていない接続元です」を確認し、`service.2-*`へ保存する。
- **メソッド拒否 (`service.3`, GET /review)。** 同commandがGETする。405、本文「POST を使ってください」を確認し、`service.3-*`へ保存する。
- **JSON拒否 (`service.4`, POST /review)。** 同commandが`content-type: application/json`と本文`{`でPOSTする。400、本文「JSON 形式が不正です」を確認し、`service.4-*`へ保存する。最後に共通Cleanupを行い、`cleanup-result.txt`と応答ファイルの残存を確認する。

## Gotchas

- `configured:true`は環境設定の存在だけ。実AI、DO接続、許可Origin付きの校閲完了を証明しない。
- 403ではJSON検証へ到達しないので、JSON検証要求にはOriginを付けない。
- このfeatureの定義済みentrypointはすべてinitで実行済み。許可OriginのOPTIONS、キー不足、標準503、429/DOの通常起動構成はこのsmokeの範囲外であり未確認。
