# claude-artifact.html から docs/index.html（GitHub Pages・デスクトップ版）を作る。
# リポジトリ直下で実行: python3 tools/build_docs.py
import re,hashlib
src=open('claude-artifact.html',encoding='utf-8').read()
ver=hashlib.sha1(src.encode()).hexdigest()[:8]
s=src
s=re.sub(r'<link rel="preconnect"[^>]*>\n?','',s)
s=re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>','<link rel="stylesheet" href="fonts/fonts.css">',s)
inj=('<style>\n/* オンライン対戦：デスクトップ版はLAN（lan.js が html.lan を付ける）。GitHub Pages では隠す */\n'
     'html:not(.lan) #onlineBtn,html:not(.lan) #onlineBtn2,html:not(.lan) [data-mode="onstd"],html:not(.lan) [data-mode="onrobo"]{display:none!important}\n</style>\n'
     f'<script>window.ROBO_APP=true;window.ROBO_BUILD="{ver}";</script>\n'
     # デスクトップ版だけ neutralino.js を読む（Neutralino がここに起動情報と1回きりの鍵を入れて返す）
     '<script>if(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&location.port==="48731"){window.__nlg=new Promise(ok=>{const s=document.createElement("script");s.src="neutralino.js";s.onload=()=>ok(true);s.onerror=()=>ok(false);document.head.appendChild(s)})}</script>\n'
     '<script>\n'+open('desktop/lan.js',encoding='utf-8').read()+'\n</script>\n')
i=s.index('<style>');s=s[:i]+inj+s[i:]
for t,a in [('このブラウザに保存しています（他の端末からは見えません）','このパソコンに保存しています'),('記録はこのブラウザに保存しています。','記録はこのパソコンに保存しています。')]:
    q="'"+t+"'";assert s.count(q)==1,t
    s=s.replace(q,"(window.ROBO_APP?'"+a+"':"+q+")")
assert 'fonts.googleapis' not in s
head=('<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
      '<style>:root{color-scheme:dark}body{margin:0;font:14px system-ui,-apple-system,"Segoe UI","Yu Gothic UI","Meiryo",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n')
open('docs/index.html','w',encoding='utf-8').write(head+s+'\n</body>\n</html>\n')
print('docs/index.html build',ver)
