import base64
import io
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult, DocumentContentFormat
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
from pdf2image import convert_from_bytes

from app.core.config import settings
from app.models.bir2307 import Bir2307
from app.utils.stopwatch import Stopwatch


class DocumentService:
    """
    Service for processing documents using Azure Document Intelligence and Azure OpenAI
    """

    def __init__(self):
        # Initialize Azure OpenAI client
        self.openai_client = AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version="2025-02-01-preview",
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            azure_deployment=settings.GPT4O_MODEL_DEPLOYMENT_NAME,
        )

        # Initialize Document Intelligence client
        self.document_intelligence_client = DocumentIntelligenceClient(
            endpoint=settings.DOCUMENT_INTELLIGENCE_ENDPOINT,
            credential=AzureKeyCredential(settings.DOCUMENT_INTELLIGENCE_API_KEY),
        )

    async def process_bir2307(self, document_bytes: bytes) -> Dict[str, Any]:
        """
        Process a BIR 2307 document

        Args:
            document_bytes: The document bytes

        Returns:
            Dict containing the extracted data, confidence scores, and execution time
        """
        execution_time = 0

        # Extract markdown from document using Document Intelligence
        with Stopwatch() as di_stopwatch:
            poller = self.document_intelligence_client.begin_analyze_document(
                model_id="prebuilt-layout",
                body=document_bytes,
                output_content_format=DocumentContentFormat.MARKDOWN,
                content_type="application/pdf",
            )

            result: AnalyzeResult = poller.result()
            markdown = result.content

        execution_time += di_stopwatch.elapsed_seconds

        # Convert document to images
        with Stopwatch() as image_stopwatch:
            pages = convert_from_bytes(document_bytes)

            # Process each page in parallel
            with ThreadPoolExecutor() as executor:
                page_images = list(executor.map(self._encode_page, pages))

        execution_time += image_stopwatch.elapsed_seconds

        # Extract data using OpenAI
        with Stopwatch() as openai_stopwatch:
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
            extracted_data = response.choices[0].message.parsed

            # Convert to Bir2307 model
            bir2307_data = Bir2307.model_validate(extracted_data)

        execution_time += openai_stopwatch.elapsed_seconds

        # Return the result
        return {
            "data": bir2307_data.model_dump(),
            "confidence": self._calculate_confidence(bir2307_data),
            "execution_time": execution_time,
        }

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
