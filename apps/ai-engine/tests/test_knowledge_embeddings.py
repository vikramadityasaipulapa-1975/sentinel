import pytest
from knowledge_embeddings import vector_values


def test_embedding_vectors_are_finite_normalized_and_have_fixed_dimension():
    vector = vector_values([1] * 384)
    assert abs(sum(v * v for v in vector) - 1) < 1e-8
    for invalid in ([0] * 384, [1] * 383, [float("nan")] * 384, [float("inf")] * 384):
        with pytest.raises(ValueError):
            vector_values(invalid)
