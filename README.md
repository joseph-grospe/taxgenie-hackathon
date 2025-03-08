# BIR 2307 Extractor API

A FastAPI application for extracting data from BIR 2307 documents using Azure Document Intelligence and Azure OpenAI.

## Features

- Extract data from BIR 2307 documents
- Convert documents to structured data
- Calculate confidence scores for extracted data
- Asynchronous processing

## Requirements

- Python 3.9+
- Azure OpenAI API key
- Azure Document Intelligence API key

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/bir2307-extractor.git
cd bir2307-extractor
```

2. Create a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

3. Install dependencies:

```bash
uv install
```

4. Create a `.env` file with your Azure credentials:

```
# Azure OpenAI
AZURE_OPENAI_API_KEY="your-openai-api-key"
AZURE_OPENAI_ENDPOINT="your-openai-endpoint"
AZURE_OPENAI_REGION="your-openai-region"
AZURE_OPENAI_DEPLOYMENT_NAME="gpt-4o"
GPT4O_MODEL_DEPLOYMENT_NAME="gpt-4o"
GPT4O_MINI_MODEL_DEPLOYMENT_NAME="gpt-4o-mini"
TEXT_EMBEDDING_MODEL_DEPLOYMENT_NAME="text-embedding-3-large"

# Azure Document Intelligence
DOCUMENT_INTELLIGENCE_API_KEY="your-document-intelligence-api-key"
DOCUMENT_INTELLIGENCE_ENDPOINT="your-document-intelligence-endpoint"
DOCUMENT_INTELLIGENCE_REGION="your-document-intelligence-region"

# Optional
RESOURCE_GROUP_NAME="your-resource-group-name"
STORAGE_ACCOUNT_NAME="your-storage-account-name"
```

## Usage

1. Start the FastAPI server:

```bash
uv run uvicorn app.main:app --reload
```

2. Open your browser and navigate to http://localhost:8000/docs to access the Swagger UI.

3. Use the `/api/v1/extraction/bir2307` endpoint to upload and process BIR 2307 documents.

## API Endpoints

- `GET /`: Welcome message
- `POST /api/v1/extraction/bir2307`: Extract data from a BIR 2307 document

## License

MIT
