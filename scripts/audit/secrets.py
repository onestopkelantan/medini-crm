#!/usr/bin/env python3
"""Fail on committed secret files and common high-confidence tokens."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT_LIMIT = 2 * 1024 * 1024

FORBIDDEN_FILES = [
    re.compile(r"(^|/)\.env$"),
    re.compile(r"(^|/)\.env\.production(?:\..+)?$"),
    re.compile(r"(^|/)secrets/"),
    re.compile(r"\.(?:pem|key)$", re.IGNORECASE),
]
ALLOW_FILES = {
    "app/.env.example",
    "backend/.env.example",
    "backend/.env.production.example",
}
TOKEN_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "Slack token": re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    "JWT": re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
}


def tracked_files() -> list[str]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT
    ).decode("utf-8", errors="surrogateescape")
    return [item for item in output.split("\0") if item]


def main() -> int:
    findings: list[str] = []
    files = tracked_files()

    for rel in files:
        normalized = rel.replace("\\", "/")
        if normalized not in ALLOW_FILES and any(
            pattern.search(normalized) for pattern in FORBIDDEN_FILES
        ):
            findings.append(f"forbidden tracked path: {normalized}")

        path = ROOT / rel
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if len(data) > TEXT_LIMIT or b"\0" in data:
            continue
        text = data.decode("utf-8", errors="ignore")
        for name, pattern in TOKEN_PATTERNS.items():
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                findings.append(f"{normalized}:{line}: possible {name}")

    if findings:
        print("Secret audit failed:")
        for finding in findings:
            print(f"- {finding}")
        print("Rotate any real exposed credential; deleting it from HEAD is not sufficient.")
        return 1

    print(f"Secret audit passed ({len(files)} tracked files scanned).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
