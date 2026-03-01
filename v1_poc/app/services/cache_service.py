import json
import os
from typing import Any, Dict, Optional, Tuple

from app.core.config import settings
from app.services.azure_storage_service import AzureStorageService
from app.utils.file_hash import generate_file_hash
from app.utils.logger import get_logger


class CacheService:
    """
    Service for caching document processing results
    """

    def __init__(self):
        """
        Initialize the cache service
        """
        # Initialize logger
        self.logger = get_logger(__name__)
        self.logger.info("Initializing CacheService")

        # Create subdirectories for different types of cached data
        self.di_cache_dir = os.path.join(settings.CACHE_DIR, "document_intelligence")
        self.openai_cache_dir = os.path.join(settings.CACHE_DIR, "openai")
        self.results_cache_dir = os.path.join(settings.CACHE_DIR, "results")

        os.makedirs(self.di_cache_dir, exist_ok=True)
        os.makedirs(self.openai_cache_dir, exist_ok=True)
        os.makedirs(self.results_cache_dir, exist_ok=True)

        self.logger.info(f"Cache directories created at {settings.CACHE_DIR}")
        self.logger.info(f"Cache enabled: {settings.CACHE_ENABLED}")

        # Initialize Azure Storage service if enabled
        self.azure_storage = AzureStorageService()
        self.logger.info(
            f"Azure Storage for cache enabled: {self.azure_storage.enabled}"
        )

    def get_cache_paths(self, file_hash: str) -> Dict[str, str]:
        """
        Get the cache file paths for a given file hash

        Args:
            file_hash: The hash of the file

        Returns:
            Dict containing the paths for different cache types
        """
        return {
            "di": os.path.join(self.di_cache_dir, f"{file_hash}.json"),
            "openai": os.path.join(self.openai_cache_dir, f"{file_hash}.json"),
            "result": os.path.join(self.results_cache_dir, f"{file_hash}.json"),
        }

    def check_cache(
        self, file_bytes: bytes
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """
        Check if a document is already cached

        Args:
            file_bytes: The document bytes

        Returns:
            Tuple containing:
            - Boolean indicating if the document is cached
            - The file hash
            - The cached result (if available)
        """
        if not settings.CACHE_ENABLED:
            self.logger.info("Cache is disabled, skipping cache check")
            return False, "", None

        file_hash = generate_file_hash(file_bytes)
        self.logger.info(f"Generated file hash: {file_hash}")

        cache_paths = self.get_cache_paths(file_hash)

        # Check if the result is cached locally
        if os.path.exists(cache_paths["result"]):
            self.logger.info(f"Local cache hit: {cache_paths['result']}")
            try:
                with open(cache_paths["result"], "r") as f:
                    return True, file_hash, json.load(f)
            except Exception as e:
                self.logger.error(f"Error reading local cache: {str(e)}")
                # If there's an error reading the cache, try Azure Storage

        # Check if the result is cached in Azure Storage
        if self.azure_storage.enabled:
            self.logger.info("Checking Azure Storage cache")
            result = self.azure_storage.get_json_from_blob(
                self.azure_storage.containers["result"], f"{file_hash}.json"
            )
            if result:
                self.logger.info("Azure Storage cache hit")
                # Save to local cache for future use
                self.save_final_result(file_hash, result)
                return True, file_hash, result

        self.logger.info(f"Cache miss for hash: {file_hash}")
        return False, file_hash, None

    def save_document_intelligence_result(
        self, file_hash: str, result: Dict[str, Any]
    ) -> None:
        """
        Save the Document Intelligence result to cache

        Args:
            file_hash: The hash of the file
            result: The Document Intelligence result
        """
        if not settings.CACHE_ENABLED:
            self.logger.info(
                "Cache is disabled, skipping Document Intelligence cache save"
            )
            return

        # Save to local cache
        cache_paths = self.get_cache_paths(file_hash)
        self.logger.info(f"Saving Document Intelligence result to {cache_paths['di']}")
        with open(cache_paths["di"], "w") as f:
            json.dump(result, f, indent=2)

        # Save to Azure Storage if enabled
        if self.azure_storage.enabled:
            self.logger.info("Saving Document Intelligence result to Azure Storage")
            self.azure_storage.save_json_to_blob(
                self.azure_storage.containers["di"], f"{file_hash}.json", result
            )

    def save_openai_result(self, file_hash: str, result: Dict[str, Any]) -> None:
        """
        Save the OpenAI result to cache

        Args:
            file_hash: The hash of the file
            result: The OpenAI result
        """
        if not settings.CACHE_ENABLED:
            self.logger.info("Cache is disabled, skipping OpenAI cache save")
            return

        # Save to local cache
        cache_paths = self.get_cache_paths(file_hash)
        self.logger.info(f"Saving OpenAI result to {cache_paths['openai']}")
        with open(cache_paths["openai"], "w") as f:
            json.dump(result, f, indent=2)

        # Save to Azure Storage if enabled
        if self.azure_storage.enabled:
            self.logger.info("Saving OpenAI result to Azure Storage")
            self.azure_storage.save_json_to_blob(
                self.azure_storage.containers["openai"], f"{file_hash}.json", result
            )

    def save_final_result(self, file_hash: str, result: Dict[str, Any]) -> None:
        """
        Save the final processed result to cache

        Args:
            file_hash: The hash of the file
            result: The final processed result
        """
        if not settings.CACHE_ENABLED:
            self.logger.info("Cache is disabled, skipping final result cache save")
            return

        # Save to local cache
        cache_paths = self.get_cache_paths(file_hash)
        self.logger.info(f"Saving final result to {cache_paths['result']}")
        with open(cache_paths["result"], "w") as f:
            json.dump(result, f, indent=2)

        # Save to Azure Storage if enabled
        if self.azure_storage.enabled:
            self.logger.info("Saving final result to Azure Storage")
            self.azure_storage.save_json_to_blob(
                self.azure_storage.containers["result"], f"{file_hash}.json", result
            )

    def get_document_intelligence_result(
        self, file_hash: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the cached Document Intelligence result

        Args:
            file_hash: The hash of the file

        Returns:
            The cached Document Intelligence result, or None if not cached
        """
        if not settings.CACHE_ENABLED:
            self.logger.info(
                "Cache is disabled, skipping Document Intelligence cache check"
            )
            return None

        # Check local cache first
        cache_paths = self.get_cache_paths(file_hash)
        if os.path.exists(cache_paths["di"]):
            self.logger.info(f"Document Intelligence cache hit: {cache_paths['di']}")
            try:
                with open(cache_paths["di"], "r") as f:
                    return json.load(f)
            except Exception as e:
                self.logger.error(
                    f"Error reading Document Intelligence cache: {str(e)}"
                )
                # If there's an error reading the cache, try Azure Storage

        # Check Azure Storage if enabled
        if self.azure_storage.enabled:
            self.logger.info("Checking Azure Storage for Document Intelligence result")
            result = self.azure_storage.get_json_from_blob(
                self.azure_storage.containers["di"], f"{file_hash}.json"
            )
            if result:
                self.logger.info("Azure Storage Document Intelligence cache hit")
                # Save to local cache for future use
                with open(cache_paths["di"], "w") as f:
                    json.dump(result, f, indent=2)
                return result

        self.logger.info(f"Document Intelligence cache miss for hash: {file_hash}")
        return None

    def get_openai_result(self, file_hash: str) -> Optional[Dict[str, Any]]:
        """
        Get the cached OpenAI result

        Args:
            file_hash: The hash of the file

        Returns:
            The cached OpenAI result, or None if not cached
        """
        if not settings.CACHE_ENABLED:
            self.logger.info("Cache is disabled, skipping OpenAI cache check")
            return None

        # Check local cache first
        cache_paths = self.get_cache_paths(file_hash)
        if os.path.exists(cache_paths["openai"]):
            self.logger.info(f"OpenAI cache hit: {cache_paths['openai']}")
            try:
                with open(cache_paths["openai"], "r") as f:
                    return json.load(f)
            except Exception as e:
                self.logger.error(f"Error reading OpenAI cache: {str(e)}")
                # If there's an error reading the cache, try Azure Storage

        # Check Azure Storage if enabled
        if self.azure_storage.enabled:
            self.logger.info("Checking Azure Storage for OpenAI result")
            result = self.azure_storage.get_json_from_blob(
                self.azure_storage.containers["openai"], f"{file_hash}.json"
            )
            if result:
                self.logger.info("Azure Storage OpenAI cache hit")
                # Save to local cache for future use
                with open(cache_paths["openai"], "w") as f:
                    json.dump(result, f, indent=2)
                return result

        self.logger.info(f"OpenAI cache miss for hash: {file_hash}")
        return None
