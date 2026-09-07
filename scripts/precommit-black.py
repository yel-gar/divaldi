import subprocess
import sys

files = [f.removeprefix("backend/") for f in sys.argv[1:]]

subprocess.run(
    ["poetry", "run", "black", *files],
    cwd="backend",
    check=False,
)
