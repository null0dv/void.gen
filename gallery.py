from pathlib import Path
import sys

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root))

from void_mobile import Gateway, create_app, web

gateway = Gateway(data_dir=root / 'data', output=root / 'output',
                  input_dir=root / 'input', comfy='http://127.0.0.1:8190',
                  keep_awake=False)
web.run_app(create_app(gateway), host='127.0.0.1', port=8091, access_log=None)
