import hashlib


def generate_file_hash(file_bytes: bytes) -> str:
    """
    Generate a unique hash for a file based on its content

    Args:
        file_bytes: The bytes of the file

    Returns:
        A string hash that uniquely identifies the file
    """
    return hashlib.sha256(file_bytes).hexdigest()
