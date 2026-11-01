# ロボ工廠

工場を組んでパーツを作り、ロボを組み上げて戦わせるゲームです。工場づくり、ローグライクの3連戦、対戦の要素があります。

## ダウンロード（Windows版）

**[robo-kosho-win.zip をダウンロード](https://github.com/akichanda420-dev/robo-kosyo/raw/main/download/robo-kosho-win.zip)**

展開して `robo-kosho.exe` をダブルクリックします。`robo-relay.exe` は同じフォルダに置いたままにしてください（LAN対戦で使います）。初回に「WindowsによってPCが保護されました」と出たら「詳細情報」→「実行」。遊び方は同梱の「はじめにお読みください.txt」にあります。

## 遊び方

| 版 | 場所 | オンライン対戦 |
|---|---|---|
| ブラウザ版（claude.ai） | `claude-artifact.html` を claude.ai のアーティファクトとして公開したもの | できる |
| Web版（GitHub Pages） | `docs/` | できない |
| Windows版（exe） | `download/robo-kosho-win.zip` | できる（LAN / Hamachi） |

- ブラウザ版のオンライン対戦は claude.ai のアーティファクト機能（room / user / db）を使います。
- Windows版は、ホストが `robo-relay.exe`（中継サーバー）を起動し、ゲストがホストのアドレス（Hamachi なら 25.x.x.x）へつなぐ LAN 対戦です。遊び方は `desktop/はじめにお読みください.txt`。
- Web版（GitHub Pages）ではオンライン系のモードを隠しています。

### GitHub Pages で公開する

Settings → Pages で「Deploy from a branch」、ブランチ `main`、フォルダ `/docs` を選びます。

## ファイル構成

- `claude-artifact.html` … ゲーム本体（1ファイル。絵素材 `robo-assets` も中に埋め込み済み）
- `docs/` … Web版・デスクトップ版。`tools/build_docs.py` で `claude-artifact.html` から作ります
  - `docs/fonts/` … 同梱フォント（DotGothic16、Zen Kaku Gothic New、JetBrains Mono。いずれも SIL Open Font License 1.1。ライセンス文は同じフォルダ）
- `desktop/lan.js` … デスクトップ版のLAN対戦。robo-relay と WebSocket で話し、claude.ai の room / user と同じ形のオブジェクトをゲームへ渡す（ビルド時に `docs/index.html` へ埋め込み）
- `relay/` … 中継サーバー robo-relay（Go）。部屋ごとの参加者と状態を配るだけで、対戦の計算は両方のゲームが同じシードで行う
- `neutralino.config.json` … デスクトップ版（Neutralinojs）の設定。ネイティブAPIは relay の起動・停止だけ許可

## ビルド

```sh
# 1. ゲーム本体を変更したら docs を作り直す
python3 tools/build_docs.py

# 2. デスクトップ版（Neutralinojs v6.4.0）
npm i -g @neutralinojs/neu
neu update            # bin/ に Neutralino のバイナリを取得
neu build --embed-resources --release
# → dist/robo-kosho/robo-kosho-win_x64.exe

# 3. 中継サーバー（Go 1.22 以降）
cd relay && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui" -o ../dist/robo-kosho/robo-relay.exe .
```

配布するときは `robo-kosho.exe`（`robo-kosho-win_x64.exe` を改名）、`robo-relay.exe`、`desktop/はじめにお読みください.txt` を同じフォルダに入れて zip にします。

Windows版の起動には WebView2 が必要です（Windows 10/11 は標準搭載）。
