from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables
    """

    # Azure OpenAI
    AZURE_OPENAI_API_KEY: str
    AZURE_OPENAI_ENDPOINT: str
    AZURE_OPENAI_REGION: str
    AZURE_OPENAI_DEPLOYMENT_NAME: str = "gpt-4o"
    GPT4O_MODEL_DEPLOYMENT_NAME: str = "gpt-4o"
    GPT4O_MINI_MODEL_DEPLOYMENT_NAME: Optional[str] = "gpt-4o-mini"
    TEXT_EMBEDDING_MODEL_DEPLOYMENT_NAME: Optional[str] = "text-embedding-3-large"

    # Azure Document Intelligence
    DOCUMENT_INTELLIGENCE_API_KEY: str
    DOCUMENT_INTELLIGENCE_ENDPOINT: str
    DOCUMENT_INTELLIGENCE_REGION: str

    # Resource Group and Storage
    RESOURCE_GROUP_NAME: Optional[str] = None
    STORAGE_ACCOUNT_NAME: Optional[str] = None

    # API Settings
    API_PREFIX: str = "/api/v1"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
