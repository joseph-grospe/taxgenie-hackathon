from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.models.responses import ExtractResponse
from app.services.document_service import DocumentService

router = APIRouter(prefix="/extraction", tags=["Extraction"])


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
    # Check if file is PDF
    if not file.content_type or "pdf" not in file.content_type.lower():
        raise HTTPException(
            status_code=400, detail="Invalid file type. Only PDF files are supported."
        )

    try:
        # Read file content
        content = await file.read()

        # Process the document
        result = await document_service.process_bir2307(content)

        return result
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error processing document: {str(e)}"
        )
