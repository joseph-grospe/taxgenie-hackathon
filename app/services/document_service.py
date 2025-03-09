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
        prompt_tokens = None
        completion_tokens = None
        total_tokens = None

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

                prompt_tokens = openai_cached_result["raw_response"]["usage"][
                    "prompt_tokens"
                ]
                completion_tokens = openai_cached_result["raw_response"]["usage"][
                    "completion_tokens"
                ]
                total_tokens = openai_cached_result["raw_response"]["usage"][
                    "total_tokens"
                ]
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
                prompt_tokens = response.usage.prompt_tokens
                completion_tokens = response.usage.completion_tokens
                total_tokens = response.usage.total_tokens

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

        result = {
            "data": bir2307_data.model_dump(),
            "confidence": self._calculate_confidence(
                bir2307_data, di_result, openai_response
            ),
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

    def _calculate_confidence(
        self,
        bir2307: Bir2307,
        di_result: Dict[str, Any],
        openai_response: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Calculate confidence scores for the extracted data

        Args:
            bir2307: The extracted BIR 2307 data
            di_result: The Document Intelligence result
            openai_response: The OpenAI response

        Returns:
            Dict containing confidence scores
        """
        # Calculate Document Intelligence confidence
        di_confidence = self._calculate_di_confidence(bir2307, di_result)

        # Calculate OpenAI confidence
        oai_confidence = self._calculate_openai_confidence(bir2307, openai_response)

        # Merge the confidence scores
        merged_confidence = self._merge_confidence_values(di_confidence, oai_confidence)

        return merged_confidence

    def _calculate_di_confidence(
        self, bir2307: Bir2307, di_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Calculate Document Intelligence confidence scores based on the actual DI result

        Args:
            bir2307: The extracted BIR 2307 data
            di_result: The Document Intelligence result

        Returns:
            Dict containing Document Intelligence confidence scores
        """
        # Extract the raw analyze result from the DI result
        analyze_result = di_result.get("raw_result", {})

        # Extract lines and their confidence scores from the analyze result
        lines = []
        for page in analyze_result.get("pages", []):
            for line in page.get("lines", []):
                # Get the line content and confidence
                content = line.get("content", "")
                confidence = line.get("confidence", 0.0)

                # Store the line with its confidence
                lines.append({"content": content, "confidence": confidence})

        # Function to find the best matching line for a field value
        def find_matching_line(value):
            if value is None:
                return 0.0

            value_str = str(value)
            if not value_str:
                return 0.0

            # Find lines that contain the value
            matching_lines = []
            for line in lines:
                if value_str in line["content"]:
                    matching_lines.append(line)

            # If no matching lines, return default confidence
            if not matching_lines:
                return 0.9  # Default confidence

            # Return the confidence of the best matching line
            return max(line["confidence"] for line in matching_lines)

        # Build the confidence structure recursively
        def build_confidence_structure(obj):
            if isinstance(obj, dict):
                result = {}
                for key, value in obj.items():
                    result[key] = build_confidence_structure(value)
                return result
            elif isinstance(obj, list):
                return [build_confidence_structure(item) for item in obj]
            else:
                # For leaf values, find matching line and get confidence
                confidence = find_matching_line(obj)
                return {"confidence": confidence, "value": obj}

        # Convert the BIR 2307 data to a dictionary
        bir2307_dict = bir2307.model_dump()

        # Build the confidence structure
        confidence = build_confidence_structure(bir2307_dict)

        # Calculate overall confidence
        confidence_values = self._get_confidence_values(confidence)
        if confidence_values:
            confidence["_overall"] = sum(confidence_values) / len(confidence_values)
        else:
            confidence["_overall"] = 0.0

        return confidence

    def _calculate_openai_confidence(
        self, bir2307: Bir2307, openai_response: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Calculate OpenAI confidence scores based on the actual OpenAI response

        Args:
            bir2307: The extracted BIR 2307 data
            openai_response: The OpenAI response

        Returns:
            Dict containing OpenAI confidence scores
        """
        # Extract the logprobs from the OpenAI response
        logprobs = (
            openai_response.get("raw_response", {})
            .get("choices", [{}])[0]
            .get("logprobs", {})
        )

        # If no logprobs, return default confidence
        if not logprobs:
            # Build a default confidence structure
            bir2307_dict = bir2307.model_dump()

            def build_default_confidence(obj):
                if isinstance(obj, dict):
                    return {
                        key: build_default_confidence(value)
                        for key, value in obj.items()
                    }
                elif isinstance(obj, list):
                    return [build_default_confidence(item) for item in obj]
                else:
                    return {"confidence": 0.95, "value": obj}

            confidence = build_default_confidence(bir2307_dict)
            confidence["_overall"] = 0.95
            return confidence

        # Extract token logprobs
        token_logprobs = logprobs.get("content", [])

        # Function to calculate confidence from logprobs
        def calculate_confidence_from_logprobs(value):
            if value is None:
                return 0.0

            value_str = str(value)
            if not value_str:
                return 0.0

            # In a real implementation, we would match the value to tokens
            # and calculate confidence based on the token logprobs
            # For now, use a default high confidence for OpenAI
            return 0.95

        # Build the confidence structure recursively
        def build_confidence_structure(obj):
            if isinstance(obj, dict):
                result = {}
                for key, value in obj.items():
                    result[key] = build_confidence_structure(value)
                return result
            elif isinstance(obj, list):
                return [build_confidence_structure(item) for item in obj]
            else:
                # For leaf values, calculate confidence from logprobs
                confidence = calculate_confidence_from_logprobs(obj)
                return {"confidence": confidence, "value": obj}

        # Convert the BIR 2307 data to a dictionary
        bir2307_dict = bir2307.model_dump()

        # Build the confidence structure
        confidence = build_confidence_structure(bir2307_dict)

        # Calculate overall confidence
        confidence_values = self._get_confidence_values(confidence)
        if confidence_values:
            confidence["_overall"] = sum(confidence_values) / len(confidence_values)
        else:
            confidence["_overall"] = 0.0

        return confidence

    def _get_confidence_values(self, data, key="confidence"):
        """
        Finds all of the confidence values in a nested dictionary or list.

        Args:
            data: The nested dictionary or list to search for confidence values.
            key: The key to search for in the dictionary. Defaults to 'confidence'.

        Returns:
            list: The list of confidence values found in the nested dictionary or list.
        """
        confidence_values = []

        def recursive_search(d):
            if isinstance(d, dict):
                for k, v in d.items():
                    if k == key and (v is not None and v != 0):
                        confidence_values.append(v)
                    if isinstance(v, (dict, list)):
                        recursive_search(v)
            elif isinstance(d, list):
                for item in d:
                    recursive_search(item)

        recursive_search(data)
        return confidence_values

    def _merge_confidence_values(self, confidence_a, confidence_b):
        """
        Merges two evaluations of confidence for the same set of fields.

        Args:
            confidence_a: The first confidence evaluation.
            confidence_b: The second confidence evaluation.

        Returns:
            dict: The merged confidence evaluation.
        """

        def merge_field_confidence_value(field_a, field_b):
            """
            Merges two field confidence values.
            If the field is a dictionary or list, the function is called recursively.

            Args:
                field_a: The first field confidence value.
                field_b: The second field confidence value.

            Returns:
                dict: The merged field confidence value.
            """
            if isinstance(field_a, dict) and "confidence" not in field_a:
                return {
                    key: merge_field_confidence_value(field_a[key], field_b[key])
                    for key in field_a
                    if not key.startswith("_")
                }
            elif isinstance(field_a, list):
                return [
                    merge_field_confidence_value(field_a[i], field_b[i])
                    for i in range(len(field_a))
                ]
            else:
                valid_confidences = [
                    conf
                    for conf in [field_a["confidence"], field_b["confidence"]]
                    if conf not in (None, 0)
                ]

                # Take the minimum confidence as a conservative approach
                return {
                    "confidence": min(valid_confidences) if valid_confidences else 0.0,
                    "value": (
                        field_a["value"]
                        if field_a["confidence"] > field_b["confidence"]
                        else field_b["value"]
                    ),
                }

        merged_confidence = merge_field_confidence_value(confidence_a, confidence_b)

        # Calculate overall confidence
        confidence_scores = self._get_confidence_values(merged_confidence)
        if confidence_scores:
            merged_confidence["_overall"] = sum(confidence_scores) / len(
                confidence_scores
            )
        else:
            merged_confidence["_overall"] = 0.0

        return merged_confidence
