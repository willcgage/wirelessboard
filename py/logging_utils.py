import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

LOG_NAMESPACE = 'micboard'
LOG_SOURCES = {
    f'{LOG_NAMESPACE}': 'core',
    f'{LOG_NAMESPACE}.core': 'core',
    f'{LOG_NAMESPACE}.slot': 'slot',
    f'{LOG_NAMESPACE}.pco': 'pco',
    f'{LOG_NAMESPACE}.web': 'web',
    f'{LOG_NAMESPACE}.discovery': 'discovery',
    f'{LOG_NAMESPACE}.device': 'device',
    f'{LOG_NAMESPACE}.telemetry': 'telemetry',
}
LOGGER_NAMES: Iterable[str] = (
    f'{LOG_NAMESPACE}',
    f'{LOG_NAMESPACE}.core',
    f'{LOG_NAMESPACE}.slot',
    f'{LOG_NAMESPACE}.pco',
    f'{LOG_NAMESPACE}.web',
    f'{LOG_NAMESPACE}.discovery',
    f'{LOG_NAMESPACE}.device',
    f'{LOG_NAMESPACE}.telemetry',
)

DEFAULT_SETTINGS: Dict[str, Any] = {
    'level': 'INFO',
    'console_level': 'WARNING',
    'levels': {},
    'max_bytes': 10 * 1024 * 1024,
    'backups': 5,
}

LOG_FILENAME = 'application.log'

LEVEL_VALUES = {
    'DEBUG': 10,
    'INFO': 20,
    'WARNING': 30,
    'ERROR': 40,
    'CRITICAL': 50,
}

_RESERVABLE_ATTRS = {
    'name',
    'msg',
    'args',
    'levelname',
    'levelno',
    'pathname',
    'filename',
    'module',
    'exc_info',
    'exc_text',
    'stack_info',
    'lineno',
    'funcName',
    'created',
    'msecs',
    'relativeCreated',
    'thread',
    'threadName',
    'processName',
    'process',
    'message',
}


def default_settings() -> Dict[str, Any]:
    return dict(DEFAULT_SETTINGS)


def normalize_level(value: Any, fallback: str = 'INFO') -> str:
    if not value:
        return fallback
    try:
        return str(value).strip().upper() or fallback
    except Exception:  # pragma: no cover - defensive
        return fallback


def normalize_settings(raw: Any) -> Dict[str, Any]:
    settings = default_settings()
    if isinstance(raw, dict):
        for key in ('level', 'console_level'):
            if key in raw:
                settings[key] = normalize_level(raw.get(key), settings[key])
        if 'max_bytes' in raw:
            try:
                settings['max_bytes'] = int(raw['max_bytes'])
            except (TypeError, ValueError):
                pass
        if 'backups' in raw:
            try:
                settings['backups'] = int(raw['backups'])
            except (TypeError, ValueError):
                pass
        if isinstance(raw.get('levels'), dict):
            overrides = {}
            for key, value in raw['levels'].items():
                overrides[str(key)] = normalize_level(value, settings['level'])
            settings['levels'] = overrides
    return settings


def resolve_source(logger_name: str) -> str:
    if logger_name in LOG_SOURCES:
        return LOG_SOURCES[logger_name]
    if logger_name.startswith(f'{LOG_NAMESPACE}.'):
        return logger_name.split('.', 1)[1]
    return logger_name


def level_to_number(level: Any) -> int:
    return LEVEL_VALUES.get(normalize_level(level, 'DEBUG'), LEVEL_VALUES['DEBUG'])


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):  # type: ignore[arg-type]
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)


def _collect_context(record: logging.LogRecord) -> Dict[str, Any]:
    context: Dict[str, Any] = {}
    existing = getattr(record, 'context', None)
    if isinstance(existing, dict):
        context.update(existing)
    for key, value in record.__dict__.items():
        if key in _RESERVABLE_ATTRS or key.startswith('_'):
            continue
        if key == 'context':
            continue
        context.setdefault(key, value)
    return {k: _json_safe(v) for k, v in context.items() if v is not None}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            'ts': datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'source': resolve_source(record.name),
            'message': record.getMessage(),
        }
        context = _collect_context(record)
        if context:
            payload['context'] = context
        if record.exc_info:
            payload['exc_info'] = self.formatException(record.exc_info)
        if record.stack_info:
            payload['stack'] = record.stack_info
        return json.dumps(payload, ensure_ascii=False)


def build_logging_config(settings: Dict[str, Any], logfile_path: str) -> Dict[str, Any]:
    file_handler = {
        'class': 'logging.handlers.RotatingFileHandler',
        'filename': logfile_path,
        'maxBytes': int(settings.get('max_bytes', DEFAULT_SETTINGS['max_bytes'])),
        'backupCount': int(settings.get('backups', DEFAULT_SETTINGS['backups'])),
        'encoding': 'utf-8',
        'formatter': 'json',
    }

    console_handler = {
        'class': 'logging.StreamHandler',
        'level': settings.get('console_level', DEFAULT_SETTINGS['console_level']),
        'formatter': 'console',
    }

    levels = dict(settings.get('levels') or {})
    base_level = settings.get('level', DEFAULT_SETTINGS['level'])

    loggers: Dict[str, Dict[str, Any]] = {}
    for name in LOGGER_NAMES:
        short = resolve_source(name)
        level = levels.get(name)
        if not level:
            level = levels.get(short, base_level)
        loggers[name] = {
            'handlers': ['console', 'file'],
            'level': level,
            'propagate': False,
        }

    config_dict = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'json': {
                '()': JsonFormatter,
            },
            'console': {
                'format': '%(asctime)s %(levelname)s %(name)s: %(message)s',
            },
        },
        'handlers': {
            'file': file_handler,
            'console': console_handler,
        },
        'loggers': loggers,
        'root': {
            'handlers': ['console', 'file'],
            'level': base_level,
        },
    }
    return config_dict


def _entry_matches(
    entry: Dict[str, Any],
    level_threshold: Optional[int],
    allowed_sources: Optional[Set[str]],
    search_term: Optional[str],
) -> bool:
    source = entry.get('source')
    if allowed_sources and (not isinstance(source, str) or source.lower() not in allowed_sources):
        return False

    if level_threshold is not None:
        entry_level = level_to_number(entry.get('level'))
        if entry_level < level_threshold:
            return False

    if search_term:
        haystacks: List[str] = []
        message = entry.get('message')
        if isinstance(message, str):
            haystacks.append(message)
        logger_name = entry.get('logger')
        if isinstance(logger_name, str):
            haystacks.append(logger_name)
        context = entry.get('context')
        if isinstance(context, dict):
            try:
                haystacks.append(json.dumps(context, ensure_ascii=False))
            except TypeError:
                haystacks.append(str(context))
        elif context is not None:
            haystacks.append(str(context))
        if search_term not in ' '.join(haystacks).lower():
            return False

    return True


def read_log_entries(
    logfile_path: str,
    *,
    limit: int = 200,
    cursor: Optional[str] = None,
    level: Optional[str] = None,
    sources: Optional[Iterable[str]] = None,
    search: Optional[str] = None,
    newer: bool = False,
) -> Dict[str, Any]:
    try:
        with open(logfile_path, 'r', encoding='utf-8') as handle:
            lines = handle.readlines()
    except FileNotFoundError:
        return {'entries': [], 'next_cursor': None, 'has_more': False}

    total = len(lines)
    if total == 0:
        return {'entries': [], 'next_cursor': None, 'has_more': False}

    limit = max(1, int(limit))
    cursor_default = -1 if newer else total
    try:
        cursor_idx = int(cursor) if cursor is not None else cursor_default
    except (TypeError, ValueError):
        cursor_idx = cursor_default
    cursor_idx = min(total, cursor_idx)

    allowed_sources = {s.lower() for s in sources} if sources else None
    search_term = search.lower() if search else None
    level_threshold = level_to_number(level) if level else None

    entries: List[Dict[str, Any]] = []
    has_more = False

    if newer:
        start = max(-1, cursor_idx)
        for idx in range(start + 1, total):
            raw = lines[idx].strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue

            entry.setdefault('source', resolve_source(entry.get('logger', '')))
            context = entry.get('context')
            if context is None:
                entry['context'] = {}
            elif not isinstance(context, dict):
                entry['context'] = {'value': context}

            if not _entry_matches(entry, level_threshold, allowed_sources, search_term):
                continue

            entry['cursor'] = str(idx)
            entry['index'] = idx
            entries.append(entry)

            if len(entries) >= limit:
                for remaining in range(idx + 1, total):
                    candidate_raw = lines[remaining].strip()
                    if not candidate_raw:
                        continue
                    try:
                        candidate = json.loads(candidate_raw)
                    except json.JSONDecodeError:
                        continue
                    candidate.setdefault('source', resolve_source(candidate.get('logger', '')))
                    context_candidate = candidate.get('context')
                    if context_candidate is None:
                        candidate['context'] = {}
                    elif not isinstance(context_candidate, dict):
                        candidate['context'] = {'value': context_candidate}
                    if _entry_matches(candidate, level_threshold, allowed_sources, search_term):
                        has_more = True
                        break
                break
    else:
        for idx in range(total - 1, -1, -1):
            if idx >= cursor_idx:
                continue
            raw = lines[idx].strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue

            entry.setdefault('source', resolve_source(entry.get('logger', '')))
            context = entry.get('context')
            if context is None:
                entry['context'] = {}
            elif not isinstance(context, dict):
                entry['context'] = {'value': context}

            if not _entry_matches(entry, level_threshold, allowed_sources, search_term):
                continue

            entry['cursor'] = str(idx)
            entry['index'] = idx

            if len(entries) < limit:
                entries.append(entry)
                continue

            has_more = True
            break

    return {
        'entries': entries,
        'next_cursor': entries[-1]['cursor'] if entries else None,
        'has_more': has_more,
    }


def purge_logs(logfile_path: str, backups: int = 5) -> None:
    with open(logfile_path, 'w', encoding='utf-8') as handle:
        handle.truncate(0)

    for idx in range(1, backups + 1):
        backup_path = f"{logfile_path}.{idx}"
        try:
            os.remove(backup_path)
        except FileNotFoundError:
            continue


def available_sources() -> List[str]:
    return sorted({resolve_source(name) for name in LOGGER_NAMES})


def available_levels() -> List[str]:
    return ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
