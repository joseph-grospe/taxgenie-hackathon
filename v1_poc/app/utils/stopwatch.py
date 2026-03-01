import time
from typing import Optional


class Stopwatch:
    """
    A simple stopwatch for measuring execution time.
    """

    def __init__(self):
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None
        self.elapsed_seconds: float = 0

    def __enter__(self):
        """
        Start the stopwatch when entering a context.
        """
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Stop the stopwatch when exiting a context.
        """
        self.stop()

    def start(self):
        """
        Start the stopwatch.
        """
        self.start_time = time.time()

    def stop(self):
        """
        Stop the stopwatch and calculate elapsed time.
        """
        self.end_time = time.time()
        self.elapsed_seconds = self.end_time - self.start_time
        return self.elapsed_seconds
