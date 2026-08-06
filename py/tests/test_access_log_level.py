"""The request log must not bury the diagnostic log.

Tornado writes one line per HTTP request, and a board polls /data.json every
five seconds and re-fetches its static assets on every reload. In a captured day
from a site that was 22,626 of 22,651 lines -- 99.9% of the file -- so the few
lines describing an actual fault were scattered across rotated files and
effectively unfindable, and rotation by size only made that worse by discarding
the older ones sooner.

Tornado grades access lines by status: 2xx/3xx at INFO, 4xx at WARNING, 5xx at
ERROR. Defaulting this logger to WARNING therefore drops only the successful
requests and keeps every failed one.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging_utils  # noqa: E402


def build(raw=None):
    settings = logging_utils.normalize_settings(raw or {})
    return logging_utils.build_logging_config(settings, '/tmp/application.log')


def test_successful_requests_are_not_logged_by_default():
    loggers = build()['loggers']

    assert loggers['tornado.access']['level'] == 'WARNING'


def test_failed_requests_are_still_logged():
    """WARNING must be the floor, not a level that also hides 4xx and 5xx."""
    level = build()['loggers']['tornado.access']['level']

    assert logging_utils.level_to_number(level) <= logging_utils.LEVEL_VALUES['WARNING']


def test_the_diagnostic_loggers_keep_their_own_level():
    """Quieting the request log must not quiet the application log with it."""
    loggers = build()['loggers']

    assert loggers['micboard.core']['level'] == 'INFO'
    assert loggers['micboard.device']['level'] == 'INFO'


def test_full_request_logging_can_be_turned_back_on():
    loggers = build({'access_level': 'INFO'})['loggers']

    assert loggers['tornado.access']['level'] == 'INFO'


def test_a_per_logger_override_still_wins():
    loggers = build({'levels': {'tornado.access': 'DEBUG'}})['loggers']

    assert loggers['tornado.access']['level'] == 'DEBUG'


def test_the_access_logger_does_not_also_propagate_to_root():
    """Otherwise root's INFO level would re-emit everything this filtered out."""
    assert build()['loggers']['tornado.access']['propagate'] is False


def test_rotation_stays_bounded():
    """Size-based rotation is the disk cap; assert the default is a real bound."""
    handler = build()['handlers']['file']

    assert handler['class'] == 'logging.handlers.RotatingFileHandler'
    assert handler['maxBytes'] == 10 * 1024 * 1024
    assert handler['backupCount'] == 5
