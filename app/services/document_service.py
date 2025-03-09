import base64
import io
import json
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
from app.services.confidence_service import ConfidenceService
from app.utils.stopwatch import Stopwatch


class DocumentService:
    """
    Service for processing documents using Azure Document Intelligence and OpenAI
    """

    def __init__(self):
        # Initialize logger
        import logging

        self.logger = logging.getLogger(__name__)

        # Initialize cache service
        self.cache_service = CacheService()
        self.logger.info("Cache service initialized")

        # Initialize confidence service
        self.confidence_service = ConfidenceService()
        self.logger.info("Confidence service initialized")

        # Initialize Document Intelligence client
        self.document_intelligence_client = DocumentIntelligenceClient(
            endpoint=settings.DOCUMENT_INTELLIGENCE_ENDPOINT,
            credential=AzureKeyCredential(settings.DOCUMENT_INTELLIGENCE_API_KEY),
        )
        self.logger.info("Document Intelligence client initialized")

        # Initialize Azure OpenAI client
        self.openai_client = AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version="2025-02-01-preview",
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            azure_deployment=settings.GPT4O_MODEL_DEPLOYMENT_NAME,
        )
        self.logger.info("Azure OpenAI client initialized")

        self.logger.info("OpenAI client initialized")

    async def process_bir2307(self, document_bytes: bytes) -> Dict[str, Any]:
        """
        Process a BIR 2307 document using Azure Document Intelligence and OpenAI

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

        # Initialize the execution time
        execution_time = 0.0

        # Initialize the BIR 2307 data
        bir2307 = None

        # Process the document with Document Intelligence
        di_result = None
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

                # Convert the result to markdown
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

        # Process the document with OpenAI
        openai_response = None

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

                openai_response = openai_cached_result

                # Extract token usage from cached result
                prompt_tokens = openai_cached_result["raw_response"]["usage"][
                    "prompt_tokens"
                ]
                completion_tokens = openai_cached_result["raw_response"]["usage"][
                    "completion_tokens"
                ]
                total_tokens = openai_cached_result["raw_response"]["usage"][
                    "total_tokens"
                ]

                self.logger.info(
                    f"Token usage: {prompt_tokens} prompt, "
                    f"{completion_tokens} completion, {total_tokens} total"
                )
            else:
                self.logger.info("Calling OpenAI API")

                # Prepare the user content
                user_content = []

                # Add the prompt
                user_text_prompt = """Extract the data from this document.
                - If a value is not present, provide null.
                - Some values must be inferred based on the rules defined in the policy.
                - Dates should be in the format YYYY-MM-DD."""

                user_content.append({"type": "text", "text": user_text_prompt})
                # Add markdown content
                user_content.append({"type": "text", "text": markdown})

                # Add page images
                user_content.extend(page_images)

                # Call the OpenAI API
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
                    logprobs=True,  # Enabled to determine confidence of the response.
                )

                # Parse the response
                try:
                    self.logger.info("Parsing OpenAI response")
                    extracted_data = response.choices[0].message.parsed

                    # Create a BIR 2307 object from the extracted data
                    bir2307 = Bir2307.model_validate(extracted_data)

                    # Log token usage
                    prompt_tokens = response.usage.prompt_tokens
                    completion_tokens = response.usage.completion_tokens
                    total_tokens = response.usage.total_tokens

                    self.logger.info(
                        f"Token usage: {prompt_tokens} prompt, "
                        f"{completion_tokens} completion, {total_tokens} total"
                    )

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
                except Exception as e:
                    self.logger.error(f"Error parsing OpenAI response: {e}")
                    raise

        execution_time += openai_stopwatch.elapsed_seconds
        self.logger.info(
            f"OpenAI processing completed in "
            f"{openai_stopwatch.elapsed_seconds:.2f} seconds"
        )

        # If bir2307 is not set, use the cached result
        if bir2307 is None and openai_response:
            bir2307 = Bir2307.model_validate(openai_response["extracted_data"])

        # Calculate confidence scores
        with Stopwatch() as confidence_stopwatch:
            self.logger.info("Calculating confidence scores")
            confidence = self.confidence_service.calculate_confidence(
                bir2307, di_result, openai_response
            )

        execution_time += confidence_stopwatch.elapsed_seconds
        self.logger.info(
            f"Confidence calculation completed in "
            f"{confidence_stopwatch.elapsed_seconds:.2f} seconds"
        )

        # Calculate estimated costs
        # Azure OpenAI GPT-4o cost calculation
        # Current pricing: Input tokens: $2.50/1M, Output tokens: $10/1M
        openai_input_cost = (prompt_tokens / 1000000) * 2.50
        openai_output_cost = (completion_tokens / 1000000) * 10
        openai_total_cost = openai_input_cost + openai_output_cost

        # Azure Document Intelligence cost calculation ($10 per 1000 pages)
        doc_intelligence_cost = (len(pages) / 1000) * 10

        # Total cost
        total_cost = openai_total_cost + doc_intelligence_cost

        # Prepare the result
        result = {
            "data": bir2307.model_dump(),
            "confidence": confidence,
            "execution_time": execution_time,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "estimated_cost": {
                "openai_input_cost": openai_input_cost,
                "openai_output_cost": openai_output_cost,
                "openai_total_cost": openai_total_cost,
                "document_intelligence_cost": doc_intelligence_cost,
                "total_cost": total_cost,
            },
        }

        # Save the result to cache
        self.cache_service.save_final_result(file_hash, result)

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
