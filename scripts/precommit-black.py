import subprocess
import sys

files = [f.removeprefix(sys.argv[1]) for f in sys.argv[2:]]

subprocess.run(
    ["poetry", "run", "black", *files],
    cwd="backend",
    check=False,
)
