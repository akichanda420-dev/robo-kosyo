# ロボ工廠

工場を組んでパーツを作り、ロボを組み上げて戦わせるゲームです。工場づくり、ローグライクの3連戦、対戦の要素があります。

## 遊び方

| 版 | 場所 | オンライン対戦 |
|---|---|---|
| ブラウザ版（claude.ai） | `claude-artifact.html` を claude.ai のアーティファクトとして公開したもの | できる |
| Web版（GitHub Pages） | `docs/` | できない |
| Windows版（exe） | Releases | できない |

オンライン対戦は claude.ai のアーティファクト機能（room / user / db）を使っているため、claude.ai の上で開いたときだけ動きます。Web版とWindows版ではオンライン系のモードを隠しています。

### GitHub Pages で公開する

Settings → Pages で「Deploy from a branch」、ブランチ `main`、フォルダ `/docs` を選びます。

## ファイル構成

- `claude-artifact.html` … ゲーム本体（1ファイル。絵素材 `robo-assets` も中に埋め込み済み）
- `docs/` … Web版・デスクトップ版。`tools/build_docs.py` で `claude-artifact.html` から作ります
  - `docs/fonts/` … 同梱フォント（DotGothic16、Zen Kaku Gothic New、JetBrains Mono。いずれも SIL Open Font License 1.1。ライセンス文は同じフォルダ）
- `neutralino.config.json` … デスクトップ版（Neutralinojs）の設定

## ビルド

```sh
# 1. ゲーム本体を変更したら docs を作り直す
python3 tools/build_docs.py

# 2. デスクトップ版（Neutralinojs v6.4.0）
npm i -g @neutralinojs/neu
neu update            # bin/ に Neutralino のバイナリを取得
neu build --embed-resources --release
# → dist/robo-kosho/robo-kosho-win_x64.exe
```

Windows版の起動には WebView2 が必要です（Windows 10/11 は標準搭載）。
