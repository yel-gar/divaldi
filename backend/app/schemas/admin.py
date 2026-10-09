from datetime import datetime

from processing.calculator.calc import DEFAULT_PARAMETERS
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.auth import MAX_USERNAME_LENGTH, NAME_SURNAME_MAX_LENGTH, AccountRole
from app.models.settings import MAX_PROMPT_EXTENSION_LENGTH
from app.schemas import PasswordField


class AdminUserFilters(BaseModel):
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    role: AccountRole | None = None
    is_expired: bool | None = None


class AdminCreateUserSchema(BaseModel):
    username: str = Field(max_length=MAX_USERNAME_LENGTH)
    password: str
    first_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    last_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    expires_at: datetime | None = None
    role: AccountRole = AccountRole.USER


class AdminEditUserSchema(BaseModel):
    username: str | None = Field(None, max_length=MAX_USERNAME_LENGTH)
    first_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    last_name: str | None = Field(None, max_length=NAME_SURNAME_MAX_LENGTH)
    expires_at: datetime | None = None
    role: AccountRole | None = None

    @field_validator("username", "role")
    @classmethod
    def reject_none(cls, value):
        if value is None:
            raise ValueError("Field cannot be None")
        return value


class AdminRatesSchema(BaseModel):
    """The editable production rates, one field per rate.

    Every field is required, so a payload naming one rate cannot silently reset the
    other three to their defaults — these numbers become prices. Positivity is
    enforced because the rates are divisors, and NaN and infinity are refused
    outright: Pydantic accepts them as floats by default, and a NaN rate produces a
    workbook full of `#NUM!` rather than an error.

    `max_positions` is not here. It is fixed at 10 because the backend truncates the
    position list to 10 and the system prompt states that limit to the model; see
    `DECISIONS.md`.
    """

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    laser_speed_m_per_hour: float = Field(gt=0)
    welding_speed_m_per_hour: float = Field(gt=0)
    bending_rate_per_hour: float = Field(gt=0)
    painting_rate_m2_per_hour: float = Field(gt=0)


class AdminSettingsResponse(BaseModel):
    """The instance-wide settings, as stored.

    `last_update_at` is null until something has been saved: "never set" and "set
    to the empty extension" are different states and only the second one has a
    timestamp. `parameters` reports the effective rates rather than the stored
    blob, so an unconfigured instance still returns a form worth rendering.
    """

    prompt_extension: str
    parameters: AdminRatesSchema
    last_update_by: int | None
    last_update_at: datetime | None


class AdminSettingsUpdate(BaseModel):
    """A partial settings update.

    Every field is optional so a later option can be added to this payload without
    touching the ones already here, and the three states a field can be in are all
    meaningful:

    - **absent** — leave the stored value alone;
    - **`null`** — for `prompt_extension`, a 422, because it would be
      indistinguishable from absent while meaning the opposite; for `parameters`,
      the reset to defaults;
    - **a value** — set it.

    The asymmetry is deliberate: an empty string is a perfectly good "no extension",
    so `prompt_extension` never needs null, whereas resetting rates is exactly what
    an admin reaches for after a bad edit, and forcing them to restate four numbers
    to say "undo that" invites a typo. `model_fields_set` is what tells the route
    which of the two nulls it is looking at.
    """

    prompt_extension: str | None = Field(None, max_length=MAX_PROMPT_EXTENSION_LENGTH)
    parameters: AdminRatesSchema | None = None

    @field_validator("prompt_extension")
    @classmethod
    def reject_none(cls, value):
        if value is None:
            raise ValueError("Field cannot be None")
        return value


def default_rates() -> AdminRatesSchema:
    """The rates an unconfigured instance runs with, taken from `processing`.

    Read off the dataclass by attribute rather than mapped field by field, so this
    cannot drift from the calculator it configures: a rate renamed or removed in
    `processing` fails here immediately, and one added there is caught by
    `test_rates_cover_every_editable_parameter`.

    `max_positions` is excluded simply by not being a field on `AdminRatesSchema`.
    In attribute mode Pydantic looks up only the fields a model declares and ignores
    the rest of the source, so `extra="forbid"` does not reject it — verified, since
    the alternative would be filtering the dataclass to exclude it by hand.
    """
    return AdminRatesSchema.model_validate(DEFAULT_PARAMETERS, from_attributes=True)


class AdminSetPasswordSchema(BaseModel):
    password: PasswordField
