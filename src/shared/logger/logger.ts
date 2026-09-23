type LogLevel = "info" | "error" | "fatal";
type LogField = string | number | boolean | null;
type LogFields = Readonly<Record<string, LogField>>;

const max_log_text_length = 2_048;
const redacted = "[REDACTED]";
const sensitive_field_pattern = /password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key/i;

function redact_log_text(value: string): string {

  const redacted_value = value
    .replace(/\b(Bot|Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\b([A-Za-z][A-Za-z\d+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, "$1[REDACTED]@")
    .replace(/(^|[?&\s"'`])([A-Z][A-Z0-9_]{1,63})\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s&#"'`]+)/g, "$1$2=[REDACTED]")
    .replace(/(^|[?&\s"'`])((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|token|password|passwd|secret|authorization|api[_-]?key)=)([^&#\s"'`]+)/gi, "$1$2[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, redacted)
    .replace(/\b(?:mfa\.)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{16,}\b/g, redacted);

  if (redacted_value.length <= max_log_text_length) {
    return redacted_value;
  }

  const prefix = redacted_value.slice(0, max_log_text_length);
  return prefix.replace(/[\uD800-\uDBFF]$/, "") + "…";

}

function normalize_log_field(value: LogField): LogField {

  if (typeof value === "string") {
    return redact_log_text(value);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }

  return value;

}

function normalize_log_fields(fields: LogFields): Record<string, LogField> {

  return Object.fromEntries(
    Object.entries(fields).map(([field_name, field_value]) => [
      field_name,
      sensitive_field_pattern.test(field_name)
        ? redacted
        : normalize_log_field(field_value),
    ]),
  );

}

export function log(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): void {

  let line: string;

  try {
    line = JSON.stringify({
      ...normalize_log_fields(fields),
      timestamp: new Date().toISOString(),
      level,
      event: redact_log_text(event),
    });
  } catch {
    line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event: "logger_serialization_failed",
    });
  }

  if (level === "info") {
    console.info(line);
    return;
  }

  console.error(line);

}
