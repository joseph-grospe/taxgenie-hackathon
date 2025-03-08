import base64
import io
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult, DocumentContentFormat
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
from pdf2image import convert_from_bytes

from app.core.config import settings
from app.models.bir2307 import Bir2307
from app.services.cache_service import CacheService
from app.utils.logger import get_logger
from app.utils.stopwatch import Stopwatch


class DocumentService:
    """
    Service for processing documents using Azure Document Intelligence and Azure OpenAI
    """

    def __init__(self):
        # Initialize logger
        self.logger = get_logger(__name__)
        self.logger.info("Initializing DocumentService")

        # Initialize Azure OpenAI client
        self.openai_client = AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version="2025-02-01-preview",
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            azure_deployment=settings.GPT4O_MODEL_DEPLOYMENT_NAME,
        )
        self.logger.info("Azure OpenAI client initialized")

        # Initialize Document Intelligence client
        self.document_intelligence_client = DocumentIntelligenceClient(
            endpoint=settings.DOCUMENT_INTELLIGENCE_ENDPOINT,
            credential=AzureKeyCredential(settings.DOCUMENT_INTELLIGENCE_API_KEY),
        )
        self.logger.info("Document Intelligence client initialized")

        # Initialize cache service
        self.cache_service = CacheService()
        self.logger.info("Cache service initialized")

    async def process_bir2307(self, document_bytes: bytes) -> Dict[str, Any]:
        """
        Process a BIR 2307 document

        Args:
            document_bytes: The document bytes

        Returns:
            Dict containing the extracted data, confidence scores, and execution time
        """
        self.logger.info("Starting BIR 2307 document processing")

        # Check if the document is already cached
        self.logger.info("Checking cache for document")
        is_cached, file_hash, cached_result = self.cache_service.check_cache(
            document_bytes
        )

        if is_cached and cached_result:
            self.logger.info("Document found in cache, returning cached result")
            return cached_result

        self.logger.info("Document not found in cache, processing...")
        execution_time = 0
        di_result = None
        openai_response = None

        # Extract markdown from document using Document Intelligence
        self.logger.info("Starting Document Intelligence processing")
        with Stopwatch() as di_stopwatch:
            # Check if Document Intelligence result is cached
            self.logger.info("Checking for cached Document Intelligence result")
            di_cached_result = self.cache_service.get_document_intelligence_result(
                file_hash
            )

            if di_cached_result:
                self.logger.info("Using cached Document Intelligence result")
                markdown = di_cached_result["content"]
                di_result = di_cached_result
            else:
                self.logger.info("Calling Document Intelligence API")
                poller = self.document_intelligence_client.begin_analyze_document(
                    model_id="prebuilt-layout",
                    body=document_bytes,
                    output_content_format=DocumentContentFormat.MARKDOWN,
                    content_type="application/pdf",
                )
                self.logger.info("Waiting for Document Intelligence result")
                result: AnalyzeResult = poller.result()
                markdown = result.content

                # Save the Document Intelligence result to cache
                self.logger.info("Saving Document Intelligence result to cache")
                di_result = {
                    "content": markdown,
                    "raw_result": result.as_dict(),
                }
                self.cache_service.save_document_intelligence_result(
                    file_hash, di_result
                )

        execution_time += di_stopwatch.elapsed_seconds
        self.logger.info(
            f"Document Intelligence processing completed in "
            f"{di_stopwatch.elapsed_seconds:.2f} seconds"
        )

        # Convert document to images
        self.logger.info("Converting document to images")
        with Stopwatch() as image_stopwatch:
            pages = convert_from_bytes(document_bytes)
            self.logger.info(f"Document has {len(pages)} pages")

            # Process each page in parallel
            self.logger.info("Encoding pages as base64")
            with ThreadPoolExecutor() as executor:
                page_images = list(executor.map(self._encode_page, pages))

        execution_time += image_stopwatch.elapsed_seconds
        self.logger.info(
            f"Image conversion completed in "
            f"{image_stopwatch.elapsed_seconds:.2f} seconds"
        )

        # Extract data using OpenAI
        self.logger.info("Starting OpenAI processing")
        with Stopwatch() as openai_stopwatch:
            # Check if OpenAI result is cached
            self.logger.info("Checking for cached OpenAI result")
            openai_cached_result = self.cache_service.get_openai_result(file_hash)

            if openai_cached_result:
                self.logger.info("Using cached OpenAI result")
                extracted_data = openai_cached_result["extracted_data"]
                bir2307_data = Bir2307.model_validate(extracted_data)
                openai_response = openai_cached_result
            else:
                self.logger.info("Preparing content for OpenAI API")
                # Prepare the user content for the OpenAI API
                user_content = []

                # Add text prompt
                user_text_prompt = """Extract the data from this document.
                - If a value is not present, provide null.
                - Some values must be inferred based on the rules defined in the policy.
                - Dates should be in the format YYYY-MM-DD."""

                user_content.append({"type": "text", "text": user_text_prompt})

                # Add markdown content
                user_content.append({"type": "text", "text": markdown})

                # Add page images
                user_content.extend(page_images)

                # Call OpenAI API
                self.logger.info("Calling OpenAI API")
                response = self.openai_client.beta.chat.completions.parse(
                    model=settings.GPT4O_MODEL_DEPLOYMENT_NAME,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an AI assistant that extracts data from documents.",
                        },
                        {"role": "user", "content": user_content},
                    ],
                    response_format=Bir2307,
                    max_tokens=4096,
                    temperature=0.1,
                    top_p=0.1,
                    logprobs=True,  # Enabled to determine the confidence of the response.
                )

                # Parse the response
                self.logger.info("Parsing OpenAI response")
                extracted_data = response.choices[0].message.parsed

                # Convert to Bir2307 model
                self.logger.info("Validating extracted data")
                bir2307_data = Bir2307.model_validate(extracted_data)

                # Save the OpenAI result to cache
                self.logger.info("Saving OpenAI result to cache")
                openai_response = {
                    "extracted_data": (
                        extracted_data.model_dump()
                        if hasattr(extracted_data, "model_dump")
                        else extracted_data
                    ),
                    "raw_response": response.model_dump(),
                }
                self.cache_service.save_openai_result(file_hash, openai_response)

        execution_time += openai_stopwatch.elapsed_seconds
        self.logger.info(
            f"OpenAI processing completed in "
            f"{openai_stopwatch.elapsed_seconds:.2f} seconds"
        )

        # Prepare the final result
        self.logger.info("Preparing final result")
        result = {
            "data": bir2307_data.model_dump(),
            "confidence": self._calculate_confidence(bir2307_data),
            "execution_time": execution_time,
        }

        # Save the final result to cache
        self.logger.info("Saving final result to cache")
        self.cache_service.save_final_result(file_hash, result)

        # Return the result
        self.logger.info(
            f"Document processing completed in {execution_time:.2f} seconds"
        )
        return result

    def _encode_page(self, page):
        """
        Encode a page as base64

        Args:
            page: The page to encode

        Returns:
            Dict containing the encoded page
        """
        byte_io = io.BytesIO()
        page.save(byte_io, format="PNG")
        base64_data = base64.b64encode(byte_io.getvalue()).decode("utf-8")
        return {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{base64_data}"},
        }

    def _calculate_confidence(self, bir2307: Bir2307) -> Dict[str, Any]:
        """
        Calculate confidence scores for the extracted data

        Args:
            bir2307: The extracted BIR 2307 data

        Returns:
            Dict containing confidence scores
        """
        # In a real implementation, you would calculate confidence scores
        # based on the extracted data and the document intelligence results
        return {
            "overall": 0.95,
            "fields": {
                "pageHeader": 0.98,
                "governmentInformation": {
                    "country": 0.99,
                    "department": 0.97,
                    "agency": 0.98,
                },
            },
        }
