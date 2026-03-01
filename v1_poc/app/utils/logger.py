import logging
import sys
from typing import Optional

# Configure the root logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """
    Get a logger with the specified name.

    Args:
        name: The name of the logger. If None, returns the root logger.

    Returns:
        A configured logger instance
    """
    return logging.getLogger(name)
