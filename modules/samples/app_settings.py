class AppSettings:
    """
    A class representing the configuration settings for the application.

    Attributes:
        resource_group_name: The name of the resource group.
        storage_account_name: The name of the storage account.
        gpt4o_model_deployment_name: The name of the GPT-4o model deployment.
        gpt4o_mini_model_deployment_name: The name of the GPT-4o Mini model deployment.
        text_embedding_model_deployment_name: The name of the text embedding model deployment.
        azure_openai_api_key: The API key for the Azure OpenAI service.
        azure_openai_endpoint: The endpoint for the Azure OpenAI service.
        azure_openai_region: The region for the Azure OpenAI service.
        azure_openai_deployment_name: The deployment name for the Azure OpenAI service.
        document_intelligence_api_key: The API key for the Document Intelligence service.
        document_intelligence_endpoint: The endpoint for the Document Intelligence service.
        document_intelligence_region: The region for the Document Intelligence service.
    """

    def __init__(self, config: dict):
        """
        Initializes a new instance of the AppSettings class.

        Args:
            config (dict): The environment configuration settings.
        """

        self.resource_group_name = config["RESOURCE_GROUP_NAME"]
        self.storage_account_name = config["STORAGE_ACCOUNT_NAME"]
        self.gpt4o_model_deployment_name = config["GPT4O_MODEL_DEPLOYMENT_NAME"]
        self.gpt4o_mini_model_deployment_name = config[
            "GPT4O_MINI_MODEL_DEPLOYMENT_NAME"
        ]
        self.text_embedding_model_deployment_name = config[
            "TEXT_EMBEDDING_MODEL_DEPLOYMENT_NAME"
        ]
        self.azure_openai_api_key = config["AZURE_OPENAI_API_KEY"]
        self.azure_openai_endpoint = config["AZURE_OPENAI_ENDPOINT"]
        self.azure_openai_region = config["AZURE_OPENAI_REGION"]
        self.azure_openai_deployment_name = config["AZURE_OPENAI_DEPLOYMENT_NAME"]
        self.document_intelligence_api_key = config["DOCUMENT_INTELLIGENCE_API_KEY"]
        self.document_intelligence_endpoint = config["DOCUMENT_INTELLIGENCE_ENDPOINT"]
        self.document_intelligence_region = config["DOCUMENT_INTELLIGENCE_REGION"]
