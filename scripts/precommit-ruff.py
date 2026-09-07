import subprocess
import sys

files = [f.removeprefix("backend/") for f in sys.argv[1:]]

subprocess.run(
    ["poetry", "run", "ruff", "check", "--fix", *files],
    cwd="backend",
    check=False,
)
