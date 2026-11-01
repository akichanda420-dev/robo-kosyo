import re,sys
# claude-artifact.html から docs/index.html（GitHub Pages・デスクトップ版）を作る。リポジトリ直下で実行: python3 tools/build_docs.py
s=open('claude-artifact.html',encoding='utf-8').read()
s=re.sub(r'<link rel="preconnect"[^>]*>\n?','',s)
s=re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>','<link rel="stylesheet" href="fonts/fonts.css">',s)
inj='<style>\n/* デスクトップアプリ版：オンライン対戦は claude.ai のブラウザ版のみ */\n#onlineBtn,#onlineBtn2,[data-mode="onstd"],[data-mode="onrobo"]{display:none!important}\n</style>\n<script>window.ROBO_APP=true;</script>\n'
i=s.index('<style>');s=s[:i]+inj+s[i:]
for t in ['このブラウザに保存しています（他の端末からは見えません）','記録はこのブラウザに保存しています。']:
    q="'"+t+"'";n=s.count(q);print(t,n)
    s=s.replace(q,"(window.ROBO_APP?'"+('このパソコンに保存しています' if '他の' in t else '記録はこのパソコンに保存しています。')+"':"+q+")")
assert 'fonts.googleapis' not in s
head='<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>:root{color-scheme:dark}body{margin:0;font:14px system-ui,-apple-system,"Segoe UI","Yu Gothic UI","Meiryo",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
open('docs/index.html','w',encoding='utf-8').write(head+s+'\n</body>\n</html>\n')
