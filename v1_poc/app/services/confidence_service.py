import logging
import math
from typing import Any, Dict

from app.models.bir2307 import Bir2307


class ConfidenceService:
    """
    Service for calculating confidence scores for extracted data
    """

    def __init__(self):
        """
        Initialize the ConfidenceService
        """
        # Initialize logger
        self.logger = logging.getLogger(__name__)
        self.logger.info("ConfidenceService initialized")

    def calculate_confidence(
        self,
        bir2307: Bir2307,
        di_result: Dict[str, Any],
        openai_response: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Calculate confidence scores for the extracted data

        Args:
            bir2307: The extracted BIR 2307 data
            di_result: The Document Intelligence result
            openai_response: The OpenAI response

        Returns:
            Dict containing confidence scores
        """
        # Calculate Document Intelligence confidence
        di_confidence = self._calculate_di_confidence(bir2307, di_result)

        # Calculate OpenAI confidence
        oai_confidence = self._calculate_openai_confidence(bir2307, openai_response)

        # Merge the confidence scores
        merged_confidence = self._merge_confidence_values(di_confidence, oai_confidence)

        return merged_confidence

    def _calculate_di_confidence(
        self, bir2307: Bir2307, di_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Calculate Document Intelligence confidence scores based on the actual DI result

        Args:
            bir2307: The extracted BIR 2307 data
            di_result: The Document Intelligence result

        Returns:
            Dict containing Document Intelligence confidence scores
        """
        # Extract the raw analyze result from the DI result
        analyze_result = di_result.get("raw_result", {})

        # Extract lines and their confidence scores from the analyze result
        lines = []
        for page in analyze_result.get("pages", []):
            for line in page.get("lines", []):
                # Get the line content and confidence
                content = line.get("content", "")
                confidence = line.get("confidence", 0.0)

                # Store the line with its confidence
                lines.append({"content": content, "confidence": confidence})

        # Function to find the best matching line for a field value
        def find_matching_line(value):
            if value is None:
                return 0.0

            value_str = str(value)
            if not value_str:
                return 0.0

            # Find lines that contain the value
            matching_lines = []
            for line in lines:
                if value_str in line["content"]:
                    matching_lines.append(line)

            # If no matching lines, return default confidence
            if not matching_lines:
                return 0.0  # No matching line found, so zero confidence

            # Return the confidence of the best matching line
            return max(line["confidence"] for line in matching_lines)

        # Build the confidence structure recursively
        def build_confidence_structure(obj):
            if isinstance(obj, dict):
                result = {}
                for key, value in obj.items():
                    result[key] = build_confidence_structure(value)
                return result
            elif isinstance(obj, list):
                return [build_confidence_structure(item) for item in obj]
            else:
                # For leaf values, find matching line and get confidence
                confidence = find_matching_line(obj)
                return {"confidence": confidence, "value": obj}

        # Convert the BIR 2307 data to a dictionary
        bir2307_dict = bir2307.model_dump()

        # Build the confidence structure
        confidence = build_confidence_structure(bir2307_dict)

        # Calculate overall confidence
        confidence_values = self._get_confidence_values(confidence)
        if confidence_values:
            confidence["_overall"] = sum(confidence_values) / len(confidence_values)
        else:
            confidence["_overall"] = 0.0

        return confidence

    def _calculate_openai_confidence(
        self, bir2307: Bir2307, openai_response: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Calculate OpenAI confidence scores based on the actual OpenAI response

        Args:
            bir2307: The extracted BIR 2307 data
            openai_response: The OpenAI response

        Returns:
            Dict containing OpenAI confidence scores
        """
        # Extract the logprobs from the OpenAI response
        raw_response = openai_response.get("raw_response", {})
        choices = raw_response.get("choices", [{}])

        if not choices:
            return self._build_default_confidence(bir2307)

        logprobs = choices[0].get("logprobs", {})

        # If no logprobs, return default confidence
        if not logprobs:
            return self._build_default_confidence(bir2307)

        # Extract token logprobs and tokens
        token_logprobs_data = logprobs.get("content", [])
        if not token_logprobs_data:
            return self._build_default_confidence(bir2307)

        # Extract tokens and their logprobs
        tokens = []
        token_logprobs = []

        for item in token_logprobs_data:
            tokens.append(item.get("token", ""))
            token_logprobs.append(item.get("logprob", -100.0))

        # Get the generated text
        generated_text = ""
        if choices and choices[0].get("message", {}).get("content"):
            generated_text = choices[0]["message"]["content"]
        else:
            return self._build_default_confidence(bir2307)

        # Calculate token offsets in the generated text
        token_offsets = []
        current_pos = 0
        for token in tokens:
            token_length = len(token)
            token_offsets.append((current_pos, current_pos + token_length))
            current_pos += token_length

        # Function to find token indices for a substring
        def find_token_indices(substring, start_char):
            """
            Find the indices of tokens that contain a given substring.

            Args:
                substring: The substring to search for
                start_char: The starting character position of the substring

            Returns:
                list: The list of token indices that contain the substring
            """
            substring_length = len(substring)
            end_char = start_char + substring_length
            indices = []

            for idx, (start, end) in enumerate(token_offsets):
                if start >= end_char:
                    break
                if end > start_char:
                    indices.append(idx)

            return indices

        # Track substring offset for sequential search
        substr_offset = 0

        # Function to calculate confidence from logprobs
        def calculate_confidence_from_logprobs(value):
            """
            Calculate confidence for a value based on the logprobs of the tokens
            that make up the value.

            Args:
                value: The value to calculate confidence for

            Returns:
                float: The confidence score
            """
            nonlocal substr_offset

            if value is None:
                return 0.0

            value_str = str(value)
            if not value_str:
                return 0.0

            try:
                # Find the start index of the value in the generated text
                start_index = generated_text.index(value_str, substr_offset)
                substr_offset = start_index + len(value_str)
            except ValueError:
                return 0.0  # Value not found in text, so zero confidence

            # Find all token indices that cover the value string
            token_indices = find_token_indices(value_str, start_index)

            if not token_indices:
                return 0.0  # No tokens found, so zero confidence

            # Get the logprobs for the tokens that cover the value string
            value_logprobs = []
            for idx in token_indices:
                if idx < len(token_logprobs):
                    logprob = token_logprobs[idx]
                    if logprob is not None:
                        value_logprobs.append(logprob)

            if not value_logprobs:
                return 0.0  # No logprobs found, so zero confidence

            # Filter out extremely low logprobs
            filtered_logprobs = [
                logprob for logprob in value_logprobs if logprob > -10.0
            ]

            if not filtered_logprobs:
                return 0.0  # All logprobs are extremely low, so zero confidence

            # Calculate the average log probability
            avg_logprob = sum(filtered_logprobs) / len(filtered_logprobs)

            # Convert log probability to confidence score (exp(logprob))
            confidence = math.exp(avg_logprob)

            # Clamp to [0.0, 1.0] range
            confidence = max(0.0, min(1.0, confidence))

            return confidence

        # Build the confidence structure recursively
        def build_confidence_structure(obj):
            """
            Build a confidence structure for an object recursively.

            Args:
                obj: The object to build confidence for

            Returns:
                dict: The confidence structure
            """
            if isinstance(obj, dict):
                result = {}
                for key, value in obj.items():
                    result[key] = build_confidence_structure(value)
                return result
            elif isinstance(obj, list):
                return [build_confidence_structure(item) for item in obj]
            else:
                # For leaf values, calculate confidence from logprobs
                confidence = calculate_confidence_from_logprobs(obj)
                return {"confidence": confidence, "value": obj}

        # Convert the BIR 2307 data to a dictionary
        bir2307_dict = bir2307.model_dump()

        # Build the confidence structure
        confidence = build_confidence_structure(bir2307_dict)

        # Calculate overall confidence
        confidence_values = self._get_confidence_values(confidence)
        if confidence_values:
            confidence["_overall"] = sum(confidence_values) / len(confidence_values)
        else:
            confidence["_overall"] = 0.0

        return confidence

    def _build_default_confidence(self, bir2307: Bir2307) -> Dict[str, Any]:
        """
        Build a default confidence structure when logprobs are not available.

        Args:
            bir2307: The extracted BIR 2307 data

        Returns:
            Dict containing default confidence scores
        """
        # Build a default confidence structure
        bir2307_dict = bir2307.model_dump()

        def build_default_confidence(obj):
            if isinstance(obj, dict):
                return {
                    key: build_default_confidence(value) for key, value in obj.items()
                }
            elif isinstance(obj, list):
                return [build_default_confidence(item) for item in obj]
            else:
                return {
                    "confidence": 0.5,
                    "value": obj,
                }  # Moderate confidence when we can't calculate

        confidence = build_default_confidence(bir2307_dict)
        confidence["_overall"] = (
            0.5  # Moderate overall confidence when we can't calculate
        )
        return confidence

    def _get_confidence_values(self, data, key="confidence"):
        """
        Finds all of the confidence values in a nested dictionary or list.

        Args:
            data: The nested dictionary or list to search for confidence values.
            key: The key to search for in the dictionary. Defaults to 'confidence'.

        Returns:
            list: The list of confidence values found in the nested dictionary or list.
        """
        confidence_values = []

        def recursive_search(d):
            if isinstance(d, dict):
                for k, v in d.items():
                    if k == key and (v is not None and v != 0):
                        confidence_values.append(v)
                    if isinstance(v, (dict, list)):
                        recursive_search(v)
            elif isinstance(d, list):
                for item in d:
                    recursive_search(item)

        recursive_search(data)
        return confidence_values

    def _merge_confidence_values(
        self, di_confidence: Dict[str, Any], openai_confidence: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Merges two evaluations of confidence for the same set of fields.

        Args:
            di_confidence: The first confidence evaluation.
            openai_confidence: The second confidence evaluation.

        Returns:
            dict: The merged confidence evaluation.
        """

        def merge_field_confidence_value(field_a, field_b):
            """
            Merges two field confidence values.
            If the field is a dictionary or list, the function is called recursively.

            Args:
                field_a: The first field confidence value.
                field_b: The second field confidence value.

            Returns:
                dict: The merged field confidence value.
            """
            if isinstance(field_a, dict) and "confidence" not in field_a:
                return {
                    key: merge_field_confidence_value(field_a[key], field_b[key])
                    for key in field_a
                    if not key.startswith("_")
                }
            elif isinstance(field_a, list):
                return [
                    merge_field_confidence_value(field_a[i], field_b[i])
                    for i in range(len(field_a))
                ]
            else:
                valid_confidences = [
                    conf
                    for conf in [field_a["confidence"], field_b["confidence"]]
                    if conf not in (None, 0)
                ]

                # Take the minimum confidence as a conservative approach
                return {
                    "confidence": min(valid_confidences) if valid_confidences else 0.0,
                    "value": (
                        field_a["value"]
                        if field_a["confidence"] > field_b["confidence"]
                        else field_b["value"]
                    ),
                }

        merged_confidence = merge_field_confidence_value(
            di_confidence, openai_confidence
        )

        # Calculate overall confidence
        confidence_scores = self._get_confidence_values(merged_confidence)
        if confidence_scores:
            merged_confidence["_overall"] = sum(confidence_scores) / len(
                confidence_scores
            )
        else:
            merged_confidence["_overall"] = 0.0

        return merged_confidence
