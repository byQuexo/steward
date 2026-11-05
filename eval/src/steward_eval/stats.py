"""Uncertainty and agreement: cluster-bootstrap CIs and Cohen's kappa.

`cluster_bootstrap_ci` is adapted from docrag-bench's `doc_bootstrap_ci`
(docrag-bench, src/docrag/eval/stats.py): questions about the same document are
correlated, so we resample clusters (documents; non-document questions are their own cluster),
not single questions. Resampling questions would give intervals that are too narrow.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Hashable, Sequence

import numpy as np


def cluster_bootstrap_ci(
    values: Sequence[float],
    clusters: Sequence[str],
    n_boot: int = 2000,
    seed: int = 0,
    alpha: float = 0.05,
) -> tuple[float, float, float, int]:
    """(mean, lower, upper, n) of the per-question mean, resampling clusters.

    NaN values (metric not applicable to that question) are dropped first; `n` is the number
    of questions that remain.
    """
    by_cluster: defaultdict[str, list[float]] = defaultdict(list)
    for v, c in zip(values, clusters, strict=True):
        if v is not None and not math.isnan(v):
            by_cluster[c].append(float(v))
    if not by_cluster:
        return math.nan, math.nan, math.nan, 0
    sums = np.array([sum(vs) for vs in by_cluster.values()])
    counts = np.array([len(vs) for vs in by_cluster.values()])
    n = int(counts.sum())
    mean = float(sums.sum() / n)
    rng = np.random.default_rng(seed)
    # Each row = one bootstrap replicate: which clusters were drawn.
    picks = rng.integers(0, len(sums), size=(n_boot, len(sums)))
    means = sums[picks].sum(axis=1) / counts[picks].sum(axis=1)
    lo, hi = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return mean, float(lo), float(hi), n


def cohen_kappa(a: Sequence[Hashable], b: Sequence[Hashable]) -> float:
    """Cohen's kappa of two raters on the same items.

    kappa = (p_o - p_e) / (1 - p_e), p_o = observed agreement, p_e = chance agreement from the
    raters' marginals. NaN when undefined: no items, or only one class in total (p_e = 1).
    """
    if len(a) != len(b):
        raise ValueError("raters must label the same items")
    n = len(a)
    if n == 0:
        return math.nan
    labels = set(a) | set(b)
    if len(labels) < 2:
        return math.nan
    p_o = sum(x == y for x, y in zip(a, b, strict=True)) / n
    p_e = sum((sum(x == lab for x in a) / n) * (sum(y == lab for y in b) / n) for lab in labels)
    if p_e >= 1.0:
        return math.nan
    return (p_o - p_e) / (1 - p_e)
