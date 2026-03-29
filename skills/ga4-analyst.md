# ga4-analyst skill

## 役割

GA4 MCP サーバーを使用してデータを取得・集計するスキル。
**コメント生成・文章化は行わない**。後段のエージェントに渡すための構造化データを返すことが責務。

## 使用ツール

Google Analytics MCP サーバー（`google-analytics` as `ga4`）。
Property ID は呼び出し元コンテキストから取得するか、引数として受け取る。

## 入力仕様

| パラメータ | 型 | 説明 |
|---|---|---|
| `purpose` | string | 分析の目的（例: "昨日の概況", "チャネル別CV比較"） |
| `period` | string | 集計期間（後述） |
| `property_id` | string | GA4 プロパティID（例: "properties/123456789"） |

### period の指定形式

- `"yesterday"` — 昨日1日
- `"last_7_days"` — 過去7日間
- `"last_week"` — 先週月〜日
- `"last_30_days"` — 過去30日間
- `"last_month"` — 先月1日〜末日
- `"YYYY-MM-DD/YYYY-MM-DD"` — 任意範囲（開始/終了）

period を日付に変換する際は、実行時の**JST（UTC+9）**を基準にすること。

## メトリクス・ディメンション選択ルール

`purpose` の内容を解釈し、適切なメトリクスとディメンションを**動的に選択**する。
以下は選択候補の一覧。過不足なく選ぶこと（多すぎると API コストが増加する）。

### よく使うメトリクス

| メトリクス名 | API名 | 用途 |
|---|---|---|
| セッション数 | `sessions` | 基本指標 |
| ユーザー数 | `totalUsers` | リーチ把握 |
| 新規ユーザー数 | `newUsers` | 獲得評価 |
| エンゲージメント率 | `engagementRate` | 質の評価 |
| コンバージョン数 | `conversions` | 成果指標 |
| コンバージョン率 | `sessionConversionRate` | 効率指標 |
| 直帰率 | `bounceRate` | 離脱評価 |
| 平均エンゲージメント時間 | `averageSessionDuration` | 滞在質 |
| 表示回数 | `screenPageViews` | コンテンツ消費量 |

### よく使うディメンション

| ディメンション名 | API名 | 用途 |
|---|---|---|
| チャネルグループ | `sessionDefaultChannelGroup` | 流入元分類 |
| 参照元/メディア | `sessionSourceMedium` | 詳細流入元 |
| デバイスカテゴリ | `deviceCategory` | デバイス別 |
| ランディングページ | `landingPage` | 入口ページ |
| ページパス | `pagePath` | ページ別 |
| イベント名 | `eventName` | イベント詳細 |
| 国 | `country` | 地域別 |

### purpose → メトリクス/ディメンション 選択例

| purpose | 推奨メトリクス | 推奨ディメンション |
|---|---|---|
| 概況・サマリー | sessions, totalUsers, newUsers, conversions, sessionConversionRate | （なし、全体集計） |
| チャネル別分析 | sessions, conversions, sessionConversionRate | sessionDefaultChannelGroup |
| ページ分析 | screenPageViews, averageSessionDuration, bounceRate | pagePath |
| デバイス別分析 | sessions, conversions | deviceCategory |
| 流入元詳細 | sessions, newUsers, conversions | sessionSourceMedium |

上記に当てはまらない purpose は、目的を解釈して最適な組み合わせを選ぶこと。

## 出力仕様

以下の JSON 構造を返す。文章・コメント・解釈は含めない。
```json
{
  "property_id": "properties/123456789",
  "period": {
    "label": "yesterday",
    "start_date": "2026-03-29",
    "end_date": "2026-03-29"
  },
  "purpose": "昨日の概況",
  "fetched_at": "2026-03-30T09:00:00+09:00",
  "summary": {
    "sessions": 1234,
    "totalUsers": 987,
    "newUsers": 456,
    "conversions": 23,
    "sessionConversionRate": 0.0186
  },
  "breakdown": [
    {
      "dimension": "sessionDefaultChannelGroup",
      "rows": [
        { "value": "Organic Search", "sessions": 500, "conversions": 10 },
        { "value": "Paid Search", "sessions": 300, "conversions": 8 }
      ]
    }
  ],
  "errors": []
}
```

- `summary`: ディメンションなしの全体集計
- `breakdown`: ディメンションあり集計（ディメンションを使わない場合は空配列 `[]`）
- `errors`: API エラーや取得失敗があれば記録（空配列が正常）

## エラーハンドリング

- API 呼び出しに失敗した場合は `errors` に記録し、取得できたデータだけで返す
- Property ID が無効な場合は即座に終了し、エラー内容を `errors` に記録
- データが0件の場合はエラーではなく、値が `0` のまま返す

## 注意事項

- GA4 MCP サーバーのツール名・パラメータ名は実際のサーバー仕様に従うこと
- `sessionConversionRate` は GA4 API が返す値をそのまま使用（再計算不要）
- ディメンション別データは上位10行に絞る（デフォルト）。必要に応じて呼び出し元が上限を指定可能
