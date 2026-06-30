import pathlib
import re

root = pathlib.Path(__file__).resolve().parent
legacy_src = root / "_void_rng_conversation_restore" / "random-prompt-responder.html"
if not legacy_src.is_file():
    legacy_src = root / "void-rng" / "index.html"
html = legacy_src.read_text(encoding="utf-8")

# Extract CSS from legacy if present
out_css = root / "void-rng" / "css" / "app.css"
if "<style>" in html:
    s0 = html.index("<style>") + len("<style>")
    s1 = html.index("</style>", s0)
    css = html[s0:s1].strip()
    extra = """

/* v2 */
#boot-error{display:none;position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;background:#2a1010;color:#e84040;font-size:11px;border-bottom:1px solid #441818}
#boot-error.show{display:block}
"""
    out_css.parent.mkdir(parents=True, exist_ok=True)
    if "#boot-error" not in css:
        out_css.write_text(css + extra, encoding="utf-8")

# Body: legacy monolith between <body> and bridge script
body_start = html.index("<body>")
body_start = html.index(">", body_start) + 1
marker = '<script src="js/void-rng-bridge.js"></script>'
body_end = html.index(marker, body_start)
body = html[body_start:body_end].strip()
body = re.sub(
    r"<script>\s*\(function\(\)\{var p=new URLSearchParams.*?</script>\s*",
    "",
    body,
    count=1,
    flags=re.DOTALL,
)
body = re.sub(r'<div class="toast" id="toast"></div>\s*', "", body)

shell = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<base href="/">
<title>VOID.RNG — Prompt · 角色 · 飾品生成器</title>
<link rel="stylesheet" href="/void-rng/css/app.css">
<link rel="stylesheet" href="/css/void-rng-search.css">
</head>
<body>
<div id="boot-error" role="alert"></div>
__BODY__
<div class="toast" id="toast"></div>
<script src="/js/void-rng-bridge.js"></script>
<script src="/js/void-translate.js"></script>
<script src="/js/void-search.js"></script>
<script src="/void-rng/js/rng-engine.js" id="rng-engine-script"></script>
<script src="/void-rng/js/app.js"></script>
</body>
</html>
""".replace("__BODY__", body)

out_html = root / "void-rng" / "index.html"
out_html.write_text(shell, encoding="utf-8")
(root / "random-prompt-responder.html").write_text(shell, encoding="utf-8")
print(f"wrote {out_html}")
print(f"wrote {root / 'random-prompt-responder.html'}")