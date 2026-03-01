from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.utils.logger import get_logger

# Initialize logger
logger = get_logger(__name__)

app = FastAPI(
    title="BIR 2307 Extractor API",
    description="API for extracting data from BIR 2307 documents",
    version="1.0.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(router)

# Log application startup
logger.info("BIR 2307 Extractor API starting up")


@app.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {
        "message": "Welcome to BIR 2307 Extractor API. "
        "Visit /docs for API documentation."
    }


@app.on_event("startup")
async def startup_event():
    logger.info("Application startup complete")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Application shutting down")
