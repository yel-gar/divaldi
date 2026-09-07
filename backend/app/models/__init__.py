# app/models/__init__.py
"""
Auto-imports every submodule in this package so all model classes register
on Base.metadata as a side effect of import. This means Alembic's env.py
(and anything else) can `import app.models` once and be guaranteed to see
every model, without needing to manually list new model files here.
"""

import importlib
import pkgutil

for _, module_name, _ in pkgutil.iter_modules(__path__):
    importlib.import_module(f"{__name__}.{module_name}")
