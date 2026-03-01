from fastapi import APIRouter

from app.api.routes.extraction import router as extraction_router
from app.core.config import settings

# Create main router
router = APIRouter(prefix=settings.API_PREFIX)

# Include all route modules
router.include_router(extraction_router)
