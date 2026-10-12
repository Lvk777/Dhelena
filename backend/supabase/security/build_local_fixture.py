"""Emit a structure-only PostgreSQL fixture from the recorded metadata.

Local staging only. Never connects to Supabase or copies production rows.
Usage: python build_local_fixture.py > <protected temporary SQL path>
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path


sys.stdout.reconfigure(encoding="utf-8")

snapshot = json.loads(
    Path(__file__).with_name("snapshot-public-2026-10-11.json").read_text(encoding="utf-8")
)


def ident(value):
    return '"' + value.replace('"', '""') + '"'


type_modifiers = json.loads(Path(__file__).with_name("snapshot-type-modifiers-2026-10-12.json").read_text(encoding="utf-8"))
precise_types = {(c["table"], c["column"]): c["type"] for c in type_modifiers}

columns = defaultdict(list)
for column in snapshot["columns"]:
    columns[column["table"]].append(column)

print("-- LOCAL SYNTHETIC STAGING ONLY; no production rows or credentials.")
print("BEGIN;")
print("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
for role in ("anon", "authenticated", "service_role", "supabase_admin"):
    attributes = "NOLOGIN BYPASSRLS" if role == "service_role" else "NOLOGIN"
    print(
        "DO $role$ BEGIN IF NOT EXISTS "
        f"(SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
        f"THEN CREATE ROLE {role} {attributes}; END IF; END $role$;"
    )

for table in sorted(snapshot["tables"], key=lambda item: item["name"]):
    definitions = []
    for column in columns[table["name"]]:
        column_type = precise_types.get((table["name"], column["column"]), column["type"])
        definition = f"{ident(column['column'])} {column_type}"
        if column["default"] is not None:
            definition += f" DEFAULT {column['default']}"
        if column["nullable"] == "NO":
            definition += " NOT NULL"
        definitions.append(definition)
    print(f"CREATE TABLE public.{ident(table['name'])} (\n  " + ",\n  ".join(definitions) + "\n);")

for constraint in sorted(
    snapshot["constraints"], key=lambda item: (item["kind"] == "f", item["table"], item["name"])
):
    print(
        f"ALTER TABLE public.{ident(constraint['table'])} "
        f"ADD CONSTRAINT {ident(constraint['name'])} {constraint['definition']};"
    )

# pg_constraint does not contain partial unique indexes. The original metadata
# snapshot omitted pg_indexes; use the checked-in non-destructive index DDL to
# reproduce application invariants. This is NOT proof of production index parity.
for migration in sorted((Path(__file__).parents[2] / "migrations").glob("*.sql")):
    for statement in re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+[^;]+;", migration.read_text(encoding="utf-8"), re.I):
        print(statement)

print("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;")
print("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;")
for owner in ("postgres", "supabase_admin"):
    print(
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public "
        "GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated, service_role;"
    )
    print(
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public "
        "GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated, service_role;"
    )
    print(
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public "
        "GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;"
    )
print("COMMIT;")
