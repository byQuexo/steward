import math

import pytest

from steward_eval.stats import cluster_bootstrap_ci, cohen_kappa


def test_kappa_known_value():
    # p_o = 0.8, p_e = 0.6*0.6 + 0.4*0.4 = 0.52 -> (0.8-0.52)/(0.48) = 0.5833
    a = [1, 1, 1, 0, 0, 1, 1, 0, 1, 0]
    b = [1, 1, 0, 0, 0, 1, 1, 1, 1, 0]
    assert cohen_kappa(a, b) == pytest.approx(0.58333, abs=1e-4)


def test_kappa_perfect_and_chance():
    assert cohen_kappa([True, False, True], [True, False, True]) == 1.0
    assert cohen_kappa([1, 0, 1, 0], [1, 1, 0, 0]) == pytest.approx(0.0)


def test_kappa_undefined_cases():
    assert math.isnan(cohen_kappa([], []))
    assert math.isnan(cohen_kappa([True, True], [True, True]))  # one class only
    with pytest.raises(ValueError):
        cohen_kappa([1], [1, 0])


def test_kappa_one_rater_constant_is_zero_not_nan():
    # Labels differ overall (two classes), rater a is constant: p_e = p_o -> kappa 0.
    assert cohen_kappa([1, 1, 1, 1], [1, 0, 1, 0]) == pytest.approx(0.0)


def test_bootstrap_mean_and_degenerate_ci():
    mean, lo, hi, n = cluster_bootstrap_ci([1.0, 1.0, 1.0], ["a", "b", "c"])
    assert (mean, lo, hi, n) == (1.0, 1.0, 1.0, 3)


def test_bootstrap_drops_nan_and_is_seeded():
    values = [1.0, 0.0, float("nan"), 1.0, 0.0, 1.0]
    clusters = ["d1", "d1", "d2", "d2", "d3", "d4"]
    r1 = cluster_bootstrap_ci(values, clusters, n_boot=500, seed=0)
    r2 = cluster_bootstrap_ci(values, clusters, n_boot=500, seed=0)
    assert r1 == r2
    mean, lo, hi, n = r1
    assert n == 5 and mean == pytest.approx(0.6)
    assert 0.0 <= lo <= mean <= hi <= 1.0


def test_bootstrap_resamples_clusters_not_questions():
    # One big all-correct cluster and many single wrong ones: resampling clusters keeps
    # the big cluster together, so the interval is much wider than a per-question bootstrap.
    values = [1.0] * 10 + [0.0] * 5
    clusters = ["big"] * 10 + [f"s{i}" for i in range(5)]
    _, lo, hi, _ = cluster_bootstrap_ci(values, clusters, n_boot=2000, seed=0)
    assert hi - lo > 0.5


def test_bootstrap_empty():
    mean, lo, hi, n = cluster_bootstrap_ci([float("nan")], ["a"])
    assert n == 0 and math.isnan(mean)
