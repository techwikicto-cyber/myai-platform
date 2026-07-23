from pydantic import BaseModel


class ModelSettingsIn(BaseModel):
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    embedding_base_url: str | None = None
    embedding_api_type: str = "tei"
    embedding_model: str | None = None
    reviewer_llm_base_url: str | None = None
    reviewer_llm_api_key: str | None = None
    reviewer_llm_model: str | None = None


class ModelSettingsOut(BaseModel):
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key_set: bool = False
    embedding_base_url: str | None = None
    embedding_api_type: str = "tei"
    embedding_model: str | None = None
    reviewer_llm_base_url: str | None = None
    reviewer_llm_model: str | None = None
    reviewer_llm_api_key_set: bool = False


class ConnectionTestResult(BaseModel):
    success: bool
    message: str
