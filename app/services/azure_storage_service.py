import json
from typing import Any, Dict, Optional

from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import BlobServiceClient, ContentSettings

from app.core.config import settings
from app.utils.logger import get_logger


class AzureStorageService:
    """
    Service for interacting with Azure Blob Storage
    """

    def __init__(self):
        """
        Initialize the Azure Storage service
        """
        self.logger = get_logger(__name__)
        self.logger.info("Initializing AzureStorageService")

        # Check if Azure Storage is configured
        if not settings.AZURE_STORAGE_CONNECTION_STRING:
            self.logger.warning("Azure Storage connection string not configured")
            self.enabled = False
            return

        self.enabled = settings.AZURE_STORAGE_ENABLED

        if not self.enabled:
            self.logger.info("Azure Storage is disabled")
            return

        # Initialize the blob service client
        try:
            self.blob_service_client = BlobServiceClient.from_connection_string(
                settings.AZURE_STORAGE_CONNECTION_STRING
            )

            # Create containers if they don't exist
            self.containers = {
                "di": settings.AZURE_STORAGE_DI_CONTAINER,
                "openai": settings.AZURE_STORAGE_OPENAI_CONTAINER,
                "result": settings.AZURE_STORAGE_RESULTS_CONTAINER,
            }

            for container_name in self.containers.values():
                try:
                    self.blob_service_client.create_container(container_name)
                    self.logger.info(f"Container created: {container_name}")
                except ResourceExistsError:
                    self.logger.info(f"Container already exists: {container_name}")

            self.logger.info("Azure Storage service initialized successfully")
        except Exception as e:
            self.logger.error(f"Failed to initialize Azure Storage service: {str(e)}")
            self.enabled = False

    def save_json_to_blob(
        self, container_name: str, blob_name: str, data: Dict[str, Any]
    ) -> bool:
        """
        Save JSON data to a blob

        Args:
            container_name: The name of the container
            blob_name: The name of the blob
            data: The JSON data to save

        Returns:
            True if successful, False otherwise
        """
        if not self.enabled:
            self.logger.info("Azure Storage is disabled, skipping blob save")
            return False

        try:
            # Convert data to JSON string
            json_data = json.dumps(data, indent=2)

            # Get container client
            container_client = self.blob_service_client.get_container_client(
                container_name
            )

            # Upload blob
            blob_client = container_client.get_blob_client(blob_name)
            blob_client.upload_blob(
                json_data,
                overwrite=True,
                content_settings=ContentSettings(content_type="application/json"),
            )

            self.logger.info(f"Successfully saved blob: {container_name}/{blob_name}")
            return True
        except Exception as e:
            self.logger.error(
                f"Error saving blob {container_name}/{blob_name}: {str(e)}"
            )
            return False

    def get_json_from_blob(
        self, container_name: str, blob_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get JSON data from a blob

        Args:
            container_name: The name of the container
            blob_name: The name of the blob

        Returns:
            The JSON data if successful, None otherwise
        """
        if not self.enabled:
            self.logger.info("Azure Storage is disabled, skipping blob retrieval")
            return None

        try:
            # Get container client
            container_client = self.blob_service_client.get_container_client(
                container_name
            )

            # Get blob client
            blob_client = container_client.get_blob_client(blob_name)

            # Check if blob exists
            if not blob_client.exists():
                self.logger.info(f"Blob not found: {container_name}/{blob_name}")
                return None

            # Download blob
            download_stream = blob_client.download_blob()
            json_data = download_stream.readall()

            # Parse JSON
            data = json.loads(json_data)

            self.logger.info(
                f"Successfully retrieved blob: {container_name}/{blob_name}"
            )
            return data
        except Exception as e:
            self.logger.error(
                f"Error retrieving blob {container_name}/{blob_name}: {str(e)}"
            )
            return None
