import os

from app.providers.sber import SberProvider

provider = SberProvider(
    api_key=os.environ["SBER_API_KEY"],
    scope=os.environ["SBER_API_SCOPE"],
)
