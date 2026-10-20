import json
import os
from datetime import date, timedelta

from sqlglot import exp, parse_one
from sqlglot.errors import ParseError


class IrrifarmScopeError(ValueError):
    pass


def load_scope_policy() -> tuple[dict[str, str], set[str]]:
    raw_columns = os.environ.get("IRRIFARM_MBO_SCOPE_COLUMNS", "{}")
    try:
        parsed = json.loads(raw_columns)
    except json.JSONDecodeError as error:
        raise IrrifarmScopeError(
            "IRRIFARM_MBO_SCOPE_COLUMNS must be a JSON object"
        ) from error
    if not isinstance(parsed, dict) or not all(
        isinstance(table, str) and isinstance(column, str)
        for table, column in parsed.items()
    ):
        raise IrrifarmScopeError(
            "IRRIFARM_MBO_SCOPE_COLUMNS must map table names to column names"
        )

    columns = {table.lower(): column for table, column in parsed.items()}
    unscoped = {
        table.strip().lower()
        for table in os.environ.get("IRRIFARM_MBO_UNSCOPED_TABLES", "").split(",")
        if table.strip()
    }
    return columns, unscoped


def apply_irrifarm_scope(
    sql: str,
    allowed_mbo_sns: list[str],
    dialect: str,
    scope_columns: dict[str, str] | None = None,
    unscoped_tables: set[str] | None = None,
) -> str:
    columns, unscoped = (
        (scope_columns, unscoped_tables or set())
        if scope_columns is not None
        else load_scope_policy()
    )
    if not columns:
        raise IrrifarmScopeError("No Irrifarm MBO scope policy is configured")

    safe_serials = _validate_serials(allowed_mbo_sns)
    sqlglot_dialect = _sqlglot_dialect(dialect)
    try:
        statement = parse_one(sql, read=sqlglot_dialect)
    except ParseError as error:
        raise IrrifarmScopeError("The SQL query could not be scoped safely") from error

    if not isinstance(statement, (exp.Select, exp.Union)):
        raise IrrifarmScopeError("Only SELECT queries are allowed for Irrifarm users")

    cte_names = {
        cte.alias_or_name.lower()
        for cte in statement.find_all(exp.CTE)
        if cte.alias_or_name
    }
    physical_tables = [
        table
        for table in list(statement.find_all(exp.Table))
        if table.name.lower() not in cte_names
    ]
    if not physical_tables:
        raise IrrifarmScopeError("The query does not reference a scoped table")

    for table in physical_tables:
        table_name = table.name.lower()
        column = columns.get(table_name)
        if column is None:
            if table_name in unscoped:
                continue
            raise IrrifarmScopeError(
                f"Table '{table.name}' has no Irrifarm MBO scope rule"
            )
        _replace_with_scoped_subquery(table, column, safe_serials)

    return statement.sql(dialect=sqlglot_dialect)


def apply_irrifarm_query_guardrails(
    sql: str,
    dialect: str,
    max_rows: int,
    timeout_ms: int,
) -> tuple[str, int]:
    if max_rows <= 0:
        raise IrrifarmScopeError("IRRIFARM_MAX_QUERY_ROWS must be positive")
    if timeout_ms <= 0:
        raise IrrifarmScopeError("IRRIFARM_QUERY_TIMEOUT_MS must be positive")

    sqlglot_dialect = _sqlglot_dialect(dialect)
    try:
        statement = parse_one(sql, read=sqlglot_dialect)
    except ParseError as error:
        raise IrrifarmScopeError("The SQL query could not be guarded safely") from error

    if not isinstance(statement, (exp.Select, exp.Union)):
        raise IrrifarmScopeError("Only SELECT queries are allowed for Irrifarm users")

    _validate_senshistory_period(statement)

    existing_limit = _literal_row_limit(statement)
    applied_limit = min(existing_limit, max_rows) if existing_limit else max_rows
    if existing_limit is None or existing_limit > max_rows:
        statement.limit(max_rows, copy=False)

    if sqlglot_dialect == "mysql":
        _set_mysql_execution_timeout(statement, timeout_ms)

    return statement.sql(dialect=sqlglot_dialect), applied_limit


def _validate_senshistory_period(statement: exp.Select | exp.Union) -> None:
    if not any(
        table.name.lower() == "senshistory" for table in statement.find_all(exp.Table)
    ):
        return

    time_column = "sns_dtevent"
    for disjunction in statement.find_all(exp.Or):
        if any(
            column.name.lower() == time_column
            for column in disjunction.find_all(exp.Column)
        ):
            raise IrrifarmScopeError(
                "senshistory time bounds must be combined with AND"
            )

    lower_bounds: list[date] = []
    upper_bounds: list[date] = []
    has_lower_bound = False
    has_upper_bound = False

    for predicate in statement.walk():
        if isinstance(predicate, exp.Between) and _is_time_column(predicate.this):
            has_lower_bound = has_upper_bound = True
            if lower := _static_date(predicate.args.get("low")):
                lower_bounds.append(lower)
            if upper := _static_date(predicate.args.get("high")):
                upper_bounds.append(upper)
            continue

        if not isinstance(predicate, (exp.GT, exp.GTE, exp.LT, exp.LTE)):
            continue

        left, right = predicate.this, predicate.expression
        if _is_time_column(left):
            is_lower = isinstance(predicate, (exp.GT, exp.GTE))
            value = right
        elif _is_time_column(right):
            is_lower = isinstance(predicate, (exp.LT, exp.LTE))
            value = left
        else:
            continue

        if is_lower:
            has_lower_bound = True
            if bound := _static_date(value):
                lower_bounds.append(bound)
        else:
            has_upper_bound = True
            if bound := _static_date(value):
                upper_bounds.append(bound)

    if not has_lower_bound or not has_upper_bound:
        raise IrrifarmScopeError(
            "senshistory queries require both lower and upper SNS_DtEvent bounds"
        )

    if not lower_bounds or not upper_bounds:
        raise IrrifarmScopeError(
            "senshistory time bounds must use fixed dates or CURRENT_DATE day intervals"
        )

    period_start = max(lower_bounds)
    period_end = min(upper_bounds)
    period = period_end - period_start
    if period > timedelta(days=366):
        raise IrrifarmScopeError(
            "senshistory queries cannot span more than 366 days; narrow the period"
        )
    if _returns_raw_rows(statement) and period > timedelta(days=7):
        raise IrrifarmScopeError(
            "raw senshistory queries cannot span more than 7 days; aggregate the data or narrow the period"
        )


def _is_time_column(expression: exp.Expression | None) -> bool:
    return (
        isinstance(expression, exp.Column) and expression.name.lower() == "sns_dtevent"
    )


def _static_date(expression: exp.Expression | None) -> date | None:
    if isinstance(expression, exp.Literal) and expression.is_string:
        try:
            return date.fromisoformat(expression.this.strip()[:10])
        except (TypeError, ValueError):
            return None
    if isinstance(expression, exp.CurrentDate):
        return date.today()
    if isinstance(expression, (exp.Add, exp.Sub)):
        base = _static_date(expression.this)
        interval = expression.expression
        if base is None or not isinstance(interval, exp.Interval):
            return None
        delta = _day_delta(interval.this, interval.args.get("unit"))
        if delta is None:
            return None
        return base + delta if isinstance(expression, exp.Add) else base - delta
    if isinstance(expression, (exp.DateAdd, exp.DateSub)):
        base = _static_date(expression.this)
        delta = _day_delta(expression.expression, expression.args.get("unit"))
        if base is None or delta is None:
            return None
        return base + delta if isinstance(expression, exp.DateAdd) else base - delta
    return None


def _day_delta(
    amount: exp.Expression | None, unit: exp.Expression | None
) -> timedelta | None:
    if not isinstance(unit, exp.Var) or unit.name.upper() != "DAY":
        return None
    if not isinstance(amount, exp.Literal):
        return None
    try:
        return timedelta(days=int(amount.this))
    except (TypeError, ValueError):
        return None


def _returns_raw_rows(statement: exp.Select | exp.Union) -> bool:
    if next(statement.find_all(exp.Group), None) is not None:
        return False
    return not any(
        aggregate.find_ancestor(exp.Window) is None
        for aggregate in statement.find_all(exp.AggFunc)
    )


def _replace_with_scoped_subquery(
    table: exp.Table, column: str, serials: list[str]
) -> None:
    alias = table.alias_or_name
    source = table.copy()
    source.set("alias", None)

    predicate: exp.Expression
    if serials:
        predicate = exp.In(
            this=exp.column(column),
            expressions=[exp.Literal.string(serial) for serial in serials],
        )
    else:
        predicate = exp.false()

    scoped = exp.select("*").from_(source).where(predicate)
    table.replace(
        exp.Subquery(
            this=scoped,
            alias=exp.TableAlias(this=exp.to_identifier(alias)),
        )
    )


def _validate_serials(values: list[str]) -> list[str]:
    if len(values) > 5000:
        raise IrrifarmScopeError("Too many Irrifarm MBO serials")
    normalized: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise IrrifarmScopeError("Invalid Irrifarm MBO serial")
        serial = value.strip()
        if not serial or len(serial) > 128 or any(ord(char) < 32 for char in serial):
            raise IrrifarmScopeError("Invalid Irrifarm MBO serial")
        normalized.append(serial)
    return sorted(set(normalized))


def _literal_row_limit(statement: exp.Select | exp.Union) -> int | None:
    limit = statement.args.get("limit")
    if not isinstance(limit, exp.Limit) or not isinstance(
        limit.expression, exp.Literal
    ):
        return None
    if limit.expression.is_string:
        return None
    try:
        value = int(limit.expression.name)
    except ValueError:
        return None
    return value if value > 0 else None


def _set_mysql_execution_timeout(
    statement: exp.Select | exp.Union, timeout_ms: int
) -> None:
    target = statement if isinstance(statement, exp.Select) else statement.this
    if not isinstance(target, exp.Select):
        return

    existing_hint = target.args.get("hint")
    expressions = (
        [
            expression
            for expression in existing_hint.expressions
            if not (
                isinstance(expression, exp.Anonymous)
                and expression.name.upper() == "MAX_EXECUTION_TIME"
            )
        ]
        if isinstance(existing_hint, exp.Hint)
        else []
    )
    expressions.append(
        exp.Anonymous(
            this="MAX_EXECUTION_TIME",
            expressions=[exp.Literal.number(timeout_ms)],
        )
    )
    target.set("hint", exp.Hint(expressions=expressions))


def _sqlglot_dialect(dialect: str) -> str:
    return {"mssql": "tsql", "postgresql": "postgres"}.get(dialect, dialect)
