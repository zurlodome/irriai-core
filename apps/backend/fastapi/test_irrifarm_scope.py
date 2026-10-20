import pytest

from irrifarm_scope import (
    IrrifarmScopeError,
    apply_irrifarm_query_guardrails,
    apply_irrifarm_scope,
)


POLICY = {"motherboards": "MBO_SN", "senshistory": "MBO_SN"}


def test_scopes_a_table_and_preserves_its_alias():
    sql = apply_irrifarm_scope(
        "SELECT m.MBO_SN, m.MBO_Alias FROM motherboards m",
        ["SN002", "SN001"],
        "mysql",
        POLICY,
    )

    assert (
        "FROM (SELECT * FROM motherboards WHERE MBO_SN IN ('SN001', 'SN002')) AS m"
        in sql
    )


def test_scopes_every_table_in_a_join():
    sql = apply_irrifarm_scope(
        "SELECT s.MBO_SN FROM senshistory s JOIN motherboards m ON m.MBO_SN = s.MBO_SN",
        ["SN001"],
        "mysql",
        POLICY,
    )

    assert sql.count("MBO_SN IN ('SN001')") == 2


def test_empty_access_list_returns_no_rows_from_scoped_sources():
    sql = apply_irrifarm_scope("SELECT * FROM motherboards", [], "mysql", POLICY)

    assert "WHERE FALSE" in sql


def test_rejects_an_unclassified_table():
    with pytest.raises(IrrifarmScopeError, match="no Irrifarm MBO scope rule"):
        apply_irrifarm_scope("SELECT * FROM users", ["SN001"], "mysql", POLICY)


def test_allows_an_explicit_global_table():
    sql = apply_irrifarm_scope(
        "SELECT * FROM products", ["SN001"], "mysql", POLICY, {"products"}
    )

    assert sql == "SELECT * FROM products"


def test_rejects_non_select_statements():
    with pytest.raises(IrrifarmScopeError, match="Only SELECT"):
        apply_irrifarm_scope("DELETE FROM motherboards", ["SN001"], "mysql", POLICY)


def test_query_guardrails_add_limit_and_mysql_timeout():
    guarded, applied_limit = apply_irrifarm_query_guardrails(
        "SELECT MBO_SN FROM motherboards ORDER BY MBO_SN",
        "mysql",
        max_rows=500,
        timeout_ms=30_000,
    )

    assert "MAX_EXECUTION_TIME(30000)" in guarded
    assert guarded.endswith("LIMIT 500")
    assert applied_limit == 500


def test_query_guardrails_clamp_large_limit_and_preserve_small_limit():
    clamped, clamped_limit = apply_irrifarm_query_guardrails(
        "SELECT * FROM motherboards LIMIT 1000", "mysql", 500, 30_000
    )
    preserved, preserved_limit = apply_irrifarm_query_guardrails(
        "SELECT * FROM motherboards LIMIT 20", "mysql", 500, 30_000
    )

    assert clamped.endswith("LIMIT 500")
    assert clamped_limit == 500
    assert preserved.endswith("LIMIT 20")
    assert preserved_limit == 20


def test_query_guardrails_do_not_add_mysql_hint_to_other_dialects():
    guarded, applied_limit = apply_irrifarm_query_guardrails(
        "SELECT * FROM motherboards", "postgresql", 100, 30_000
    )

    assert "MAX_EXECUTION_TIME" not in guarded
    assert guarded.endswith("LIMIT 100")
    assert applied_limit == 100


def test_query_guardrails_require_bounded_senshistory_period():
    with pytest.raises(IrrifarmScopeError, match="both lower and upper"):
        apply_irrifarm_query_guardrails(
            "SELECT MBO_SN FROM senshistory WHERE SNS_DtEvent >= '2025-01-01'",
            "mysql",
            500,
            30_000,
        )


def test_query_guardrails_reject_senshistory_period_over_366_days():
    with pytest.raises(IrrifarmScopeError, match="more than 366 days"):
        apply_irrifarm_query_guardrails(
            """
            SELECT MBO_SN
            FROM senshistory
            WHERE SNS_DtEvent >= '2024-01-01'
              AND SNS_DtEvent < '2025-01-02'
            """,
            "mysql",
            500,
            30_000,
        )


def test_query_guardrails_allow_bounded_dynamic_senshistory_period():
    guarded, applied_limit = apply_irrifarm_query_guardrails(
        """
        SELECT COUNT(*) AS readings_count
        FROM senshistory
        WHERE SNS_DtEvent >= CURRENT_DATE - INTERVAL 29 DAY
          AND SNS_DtEvent < CURRENT_DATE + INTERVAL 1 DAY
        """,
        "mysql",
        500,
        30_000,
    )

    assert guarded.endswith("LIMIT 500")
    assert applied_limit == 500


def test_query_guardrails_reject_raw_senshistory_period_over_7_days():
    with pytest.raises(IrrifarmScopeError, match="more than 7 days"):
        apply_irrifarm_query_guardrails(
            """
            SELECT MBO_SN, SNS_DtEvent
            FROM senshistory
            WHERE SNS_DtEvent >= '2025-01-01'
              AND SNS_DtEvent < '2025-01-09'
            """,
            "mysql",
            500,
            30_000,
        )


def test_query_guardrails_allow_raw_senshistory_period_of_7_days():
    guarded, applied_limit = apply_irrifarm_query_guardrails(
        """
        SELECT MBO_SN, SNS_DtEvent
        FROM senshistory
        WHERE SNS_DtEvent >= '2025-01-01'
          AND SNS_DtEvent < '2025-01-08'
        """,
        "mysql",
        500,
        30_000,
    )

    assert guarded.endswith("LIMIT 500")
    assert applied_limit == 500


def test_query_guardrails_reject_wide_dynamic_senshistory_period():
    with pytest.raises(IrrifarmScopeError, match="more than 366 days"):
        apply_irrifarm_query_guardrails(
            """
            SELECT COUNT(*) AS readings_count
            FROM senshistory
            WHERE SNS_DtEvent >= CURRENT_DATE - INTERVAL 500 DAY
              AND SNS_DtEvent < CURRENT_DATE + INTERVAL 1 DAY
            """,
            "mysql",
            500,
            30_000,
        )


def test_query_guardrails_reject_disjunctive_senshistory_time_bounds():
    with pytest.raises(IrrifarmScopeError, match="combined with AND"):
        apply_irrifarm_query_guardrails(
            """
            SELECT MBO_SN
            FROM senshistory
            WHERE SNS_DtEvent >= '2025-01-01'
               OR SNS_DtEvent < '2025-02-01'
            """,
            "mysql",
            500,
            30_000,
        )
