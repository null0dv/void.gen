# Run on the Colab VM with `colab exec -s void -f tools/peek_setup_log.py`: tail of the VOID setup/motion logs and running processes.
import os
import subprocess

for path in ('/content/void-setup.log', '/content/void-motion.log', '/content/void-runtime/comfy.log'):
    if os.path.exists(path):
        print(f'== {path}')
        print(''.join(open(path, errors='replace').readlines()[-15:]))
print(subprocess.run('ps aux | grep -E "colab_vm|colab_motion|main.py|curl|pip" | grep -v grep | cut -c1-200',
                     shell=True, capture_output=True, text=True).stdout)
