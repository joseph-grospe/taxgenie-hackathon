from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.models.responses import ExtractResponse
from app.services.document_service import DocumentService
from app.utils.logger import get_logger

router = APIRouter(prefix="/extraction", tags=["Extraction"])
logger = get_logger(__name__)


@router.post("/bir2307", response_model=ExtractResponse)
async def extract_bir2307(
    file: UploadFile = File(...),
    document_service: DocumentService = Depends(),
):
    """
    Extract data from a BIR 2307 document

    - **file**: PDF file containing the BIR 2307 document

    Returns the extracted data with confidence scores
    """
    logger.info(f"Received BIR 2307 extraction request for file: {file.filename}")

    # Check if file is PDF
    if not file.content_type or "pdf" not in file.content_type.lower():
        error_msg = "Invalid file type. Only PDF files are supported."
        logger.error(f"File validation failed: {error_msg}")
        raise HTTPException(status_code=400, detail=error_msg)

    try:
        # Read file content
        logger.info("Reading file content")
        content = await file.read()
        file_size = len(content) / 1024  # Size in KB
        logger.info(f"File size: {file_size:.2f} KB")

        # Process the document
        logger.info("Processing document")
        result = await document_service.process_bir2307(content)

        # Add a flag to indicate if the result was cached
        if "execution_time" in result and result["execution_time"] == 0:
            result["cached"] = True
            logger.info("Result was retrieved from cache")
        else:
            result["cached"] = False
            logger.info(
                f"Result was processed in {result.get('execution_time', 0):.2f} seconds"
            )

        logger.info("Extraction completed successfully")
        return result
    except Exception as e:
        error_msg = f"Error processing document: {str(e)}"
        logger.error(f"Extraction failed: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)
