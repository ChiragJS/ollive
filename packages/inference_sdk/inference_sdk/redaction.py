import hashlib
import re
from dataclasses import dataclass, field
from typing import Callable

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{8,}\d)(?!\d)")
CARD_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
AADHAAR_RE = re.compile(r"(?<!\d)(?:\d{4}[ -]?){2}\d{4}(?![ -]?\d)")
PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")
SECRET_RE = re.compile(
    r"(?i)\b(?:sk|pk|api[_-]?key|token|secret|bearer)[-_:=\s]+[A-Za-z0-9._\-]{12,}\b"
)

REDACTION_POLICY_VERSION = "pii-redaction-v2"


@dataclass(frozen=True)
class RedactionFinding:
    pii_type: str
    start: int
    end: int
    replacement: str


@dataclass(frozen=True)
class RedactionResult:
    text: str
    findings: list[RedactionFinding] = field(default_factory=list)
    truncated: bool = False
    policy: str = REDACTION_POLICY_VERSION
    mode: str = "standard"

    @property
    def redaction_applied(self) -> bool:
        return bool(self.findings)

    @property
    def redaction_count(self) -> int:
        return len(self.findings)

    @property
    def redaction_types(self) -> list[str]:
        return sorted({finding.pii_type for finding in self.findings})

    def metadata(self) -> dict[str, object]:
        counts: dict[str, int] = {}
        for finding in self.findings:
            counts[finding.pii_type] = counts.get(finding.pii_type, 0) + 1
        return {
            "policy": self.policy,
            "mode": self.mode,
            "truncated": self.truncated,
            "redaction_types": self.redaction_types,
            "counts_by_type": counts,
        }


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def redact_text(value: str, max_chars: int = 500, mode: str = "standard") -> RedactionResult:
    original = value or ""
    if mode == "off":
        preview, truncated = _truncate(original, max_chars)
        return RedactionResult(preview, findings=[], truncated=truncated, mode=mode)

    findings = _dedupe_overlaps(_detect_findings(original))
    if mode == "strict" and findings:
        return RedactionResult("[REDACTED_PREVIEW]", findings=findings, truncated=False, mode=mode)

    redacted = original
    for finding in sorted(findings, key=lambda item: item.start, reverse=True):
        redacted = redacted[: finding.start] + finding.replacement + redacted[finding.end :]

    preview, truncated = _truncate(redacted, max_chars)
    return RedactionResult(preview, findings=findings, truncated=truncated, mode=mode)


def _detect_findings(value: str) -> list[RedactionFinding]:
    findings: list[RedactionFinding] = []
    findings.extend(_regex_findings(SECRET_RE, value, "secret", "[REDACTED_SECRET]"))
    findings.extend(_regex_findings(EMAIL_RE, value, "email", "[REDACTED_EMAIL]"))
    findings.extend(_regex_findings(PAN_RE, value, "pan", "[REDACTED_PAN]"))
    findings.extend(
        _regex_findings(
            CARD_RE,
            value,
            "card",
            "[REDACTED_CARD]",
            validator=lambda _text, match: _luhn_valid(_digits(match.group(0))),
        )
    )
    findings.extend(
        _regex_findings(
            AADHAAR_RE,
            value,
            "aadhaar",
            "[REDACTED_AADHAAR]",
            validator=lambda text, match: _looks_like_aadhaar(text, match.start(), match.group(0)),
        )
    )
    findings.extend(
        _regex_findings(
            PHONE_RE,
            value,
            "phone",
            "[REDACTED_PHONE]",
            validator=lambda text, match: _looks_like_phone(text, match.start(), match.group(0)),
        )
    )
    return findings


def _regex_findings(
    pattern: re.Pattern[str],
    value: str,
    pii_type: str,
    replacement: str,
    validator: Callable[[str, re.Match[str]], bool] | None = None,
) -> list[RedactionFinding]:
    findings = []
    for match in pattern.finditer(value):
        if validator and not validator(value, match):
            continue
        findings.append(RedactionFinding(pii_type, match.start(), match.end(), replacement))
    return findings


def _dedupe_overlaps(findings: list[RedactionFinding]) -> list[RedactionFinding]:
    selected: list[RedactionFinding] = []
    for finding in findings:
        if any(_overlaps(finding, existing) for existing in selected):
            continue
        selected.append(finding)
    return sorted(selected, key=lambda item: item.start)


def _overlaps(left: RedactionFinding, right: RedactionFinding) -> bool:
    return left.start < right.end and right.start < left.end


def _truncate(value: str, max_chars: int) -> tuple[str, bool]:
    if len(value) <= max_chars:
        return value, False
    return value[:max_chars] + "...", True


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _luhn_valid(number: str) -> bool:
    if not 13 <= len(number) <= 19 or len(set(number)) == 1:
        return False
    total = 0
    reverse_digits = number[::-1]
    for index, char in enumerate(reverse_digits):
        digit = int(char)
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def _looks_like_aadhaar(text: str, start: int, value: str) -> bool:
    number = _digits(value)
    if len(number) != 12 or len(set(number)) == 1 or number[0] in {"0", "1"}:
        return False
    return (" " in value or "-" in value) or _has_label(text, start, {"aadhaar", "aadhar", "uidai"})


def _looks_like_phone(text: str, start: int, value: str) -> bool:
    number = _digits(value)
    if not 10 <= len(number) <= 15 or len(set(number)) == 1:
        return False
    has_phone_shape = value.strip().startswith("+") or any(separator in value for separator in (" ", "-", "(", ")", "."))
    return has_phone_shape or _has_label(text, start, {"phone", "mobile", "contact", "call", "whatsapp"})


def _has_label(text: str, start: int, labels: set[str], window: int = 32) -> bool:
    nearby = text[max(0, start - window) : start].lower()
    return any(label in nearby for label in labels)
