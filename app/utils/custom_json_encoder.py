import json
from datetime import datetime

from pydantic import BaseModel


class CustomJsonEncoder(json.JSONEncoder):
    """
    Custom JSON encoder for handling complex objects.
    """

    def default(self, obj):
        """
        Override the default method to handle custom types.

        Args:
            obj: The object to encode

        Returns:
            A JSON serializable object
        """
        # Handle datetime objects
        if isinstance(obj, datetime):
            return obj.isoformat()

        # Handle Pydantic models
        if isinstance(obj, BaseModel):
            return obj.model_dump()

        # Let the base class handle other types
        return super().default(obj)
