from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("请输入有效邮箱")
        return value


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    display_name: str
    created_at: datetime


class AuthOut(BaseModel):
    access_token: str
    user: UserOut


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    chunk_count: int
    created_at: datetime


class Evidence(BaseModel):
    title: str
    url: HttpUrl
    snippet: str
    source_name: str
    kind: Literal["shopping", "specs", "reviews"]
    observed_at: datetime
    price_text: str | None = None
    rating_text: str | None = None
    is_purchase_link: bool = False


class ResearchOut(BaseModel):
    query: str
    sources: list[Evidence]
    observed_at: datetime


class FavoriteIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    source_url: HttpUrl
    source_name: str = Field(min_length=1, max_length=100)
    price_text: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=2000)


class FavoriteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    source_url: str
    source_name: str
    price_text: str | None
    note: str | None
    saved_at: datetime


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    provider: Literal["deepseek", "anthropic", "openai"]
    conversation_id: int | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    role: str
    content: str
    created_at: datetime


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    created_at: datetime


class ChatOut(BaseModel):
    conversation_id: int
    answer: str
    sources: list[Evidence]
