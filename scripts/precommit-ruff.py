import subprocess
import sys

files = [f.removeprefix(sys.argv[1]) for f in sys.argv[2:]]

subprocess.run(
    ["poetry", "run", "ruff", "check", "--fix", *files],
    cwd="backend",
    check=False,
)
