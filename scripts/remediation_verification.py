"""Conservative classification of bounded post-action sandbox observations."""


def classify(observations):
    if observations.get("outcome_uncertain") or observations.get("incomplete"):
        return "UNVERIFIED"
    if observations.get("command_failed_unchanged") is True:
        return "FAILED"
    required = {
        "image_matches",
        "version_matches",
        "ready",
        "successful_checkouts",
        "samples",
        "window_seconds",
    }
    if not required <= observations.keys():
        return "UNVERIFIED"
    if any(
        type(observations[key]) is not bool
        for key in ["image_matches", "version_matches", "ready"]
    ):
        return "UNVERIFIED"
    samples = observations["samples"]
    successful = observations["successful_checkouts"]
    window = observations["window_seconds"]
    if (
        type(samples) is not int
        or type(successful) is not int
        or not 0 <= successful <= samples
        or not 1 <= samples <= 3
        or type(window) not in {float, int}
        or not 0 <= window <= 15
    ):
        return "UNVERIFIED"
    if (
        not all(
            observations[key] for key in ["image_matches", "version_matches", "ready"]
        )
        or successful < samples
    ):
        return "FAILED"
    if samples < 3 or window < 2:
        return "UNVERIFIED"
    return "VERIFIED"
