"""
Shared pytest configuration for the ``processing`` package.

Adds ``processing/src`` to ``sys.path`` so that tests can import
``processing.<subpackage>`` even when the package has not been installed
via ``poetry install``.
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
