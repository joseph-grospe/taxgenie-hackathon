from typing import Any, Dict, Optional

from pydantic import BaseModel


class ExtractResponse(BaseModel):
    """
    Response model for document extraction
    """

    data: Dict[str, Any]
    confidence: Optional[Dict[str, Any]] = None
    execution_time: Optional[float] = None

    class Config:
        json_schema_extra = {
            "example": {
                "data": {
                    "pageHeader": {"value": "TS-WF-205F-0012327", "type": "string"},
                    "governmentInformation": {
                        "country": {
                            "value": "Republic of the Philippines",
                            "type": "string",
                        },
                        "department": {
                            "value": "Department of Finance",
                            "type": "string",
                        },
                        "agency": {
                            "value": "Bureau of Internal Revenue",
                            "type": "string",
                        },
                    },
                    # Additional fields would be here
                },
                "confidence": {
                    "overall": 0.95,
                    "fields": {
                        "pageHeader": 0.98,
                        "governmentInformation": {
                            "country": 0.99,
                            "department": 0.97,
                            "agency": 0.98,
                        },
                    },
                },
                "execution_time": 2.45,
            }
        }
