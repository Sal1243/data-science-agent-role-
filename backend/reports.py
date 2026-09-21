from __future__ import annotations

import re


def escape(value: object) -> str:
    text = str(value).replace("\n", " ").replace("\r", " ")
    return re.sub(r"([\\`*_{}\[\]<>()#+.!|>~-])", r"\\\1", text)


def markdown_report(profile: dict, model: dict | None = None) -> str:
    p = profile
    lines = [
        f"# Fieldnote · {escape(p['name'])}",
        "",
        f"Generated: {p['created_at']}",
        "",
        "> Synthetic demonstration data."
        if p["is_demo"]
        else "> Automated, descriptive analysis. Validate findings with domain expertise.",
        "",
        "## At a glance",
        "",
        f"- Rows: {p['row_count']:,}",
        f"- Columns: {p['column_count']}",
        f"- Quality score: {p['quality_score']} / 100",
        f"- Cell completeness: {p['completeness']}%",
        f"- Missing cells: {p['missing_cells']:,}",
        f"- Exact duplicate rows: {p['duplicate_rows']:,}",
        "",
        "## Key findings",
        "",
    ]
    for insight in p["insights"]:
        lines.extend([f"### {escape(insight['title'])}", "", escape(insight["description"]), ""])
    lines.extend(
        [
            "## Column profile",
            "",
            "| Column | Type | Unique | Missing | Missing % |",
            "| --- | --- | ---: | ---: | ---: |",
        ]
    )
    for c in p["columns"]:
        lines.append(
            f"| {escape(c['name'])} | {c['kind']} | {c['unique']:,} | {c['missing']:,} | {c['missing_pct']}% |"
        )
    if p["correlations"]:
        lines.extend(
            [
                "",
                "## Strongest observed relationships",
                "",
                "| First | Second | Pearson r | Complete pairs |",
                "| --- | --- | ---: | ---: |",
            ]
        )
        for pair in p["correlations"][:8]:
            lines.append(
                f"| {escape(pair['first'])} | {escape(pair['second'])} | {pair['value']} | {pair['n']:,} |"
            )
    if model:
        lines.extend(
            [
                "",
                "## Predictive baseline",
                "",
                f"Target: {escape(model['target'])} · Task: {model['task']} · Split: {model['split']}",
                "",
                f"Training rows: {model['train_rows']:,} · Test rows: {model['test_rows']:,} · Seed: {model['seed']}",
                "",
                f"Features: {', '.join(escape(f) for f in model['features'])}",
                "",
                "| Metric | Random forest | Naive baseline |",
                "| --- | ---: | ---: |",
            ]
        )
        for key, value in model["metrics"].items():
            lines.append(f"| {escape(key)} | {value} | {model['baseline_metrics'][key]} |")
        lines.extend(["", "### Experiment caveats", ""])
        lines.extend(f"- {escape(note)}" for note in model["notes"])
    lines.extend(
        [
            "",
            "## Suggested next steps",
            "",
            "1. Confirm the unit of observation, data provenance, date coverage, and meaning of each field.",
            "2. Review missingness and exact duplicates with domain context before changing data.",
            "3. Treat correlations and outlier flags as investigation leads, not causal conclusions.",
            "4. For prediction, choose features available at inference time and validate on independent, representative data.",
            "",
            "## Methods & limitations",
            "",
        ]
    )
    lines.extend(
        f"- **{escape(key.capitalize())}:** {escape(value)}"
        for key, value in p["methodology"].items()
    )
    lines.extend(
        [
            "- Dates are inferred from common year-first and numeric date strings. Ambiguous numeric dates are parsed month-first; prefer ISO 8601.",
            "- No multiple-comparison correction, causal inference, forecasting, or fairness audit is performed.",
            "- Aggregations exclude missing metric values. Missing categories are grouped separately. No currency is inferred.",
        ]
    )
    if p["notes"]:
        lines.extend(["", "## Dataset notes", ""])
        lines.extend(f"- {escape(note)}" for note in p["notes"])
    return "\n".join(lines) + "\n"
