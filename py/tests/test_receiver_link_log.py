"""A receiver coming and going leaves a line in the log.

⛔⛔ On the venue board the log's `device` source was empty after five days:
`set_rx_com_status` was a bare assignment, so a receiver dropping out during a
service left no trace at all.
"""

import logging

import networkdevice


def _receiver():
    return networkdevice.ShureNetworkDevice('10.0.0.51', 'qlxd')


def _lines(caplog):
    return [(r.levelname, r.getMessage()) for r in caplog.records if r.name == 'micboard.device']


def test_first_connect_drop_and_return_are_each_said_once(caplog):
    caplog.set_level(logging.INFO, logger='micboard.device')
    rx = _receiver()
    rx.set_rx_com_status('CONNECTING')
    rx.set_rx_com_status('CONNECTED')
    for _ in range(50):  # set again on every packet read
        rx.set_rx_com_status('CONNECTED')
    rx.set_rx_com_status('DISCONNECTED')
    rx.set_rx_com_status('CONNECTING')
    rx.set_rx_com_status('CONNECTED')

    lines = _lines(caplog)
    assert lines[0] == ('INFO', 'Receiver 10.0.0.51 (qlxd) connected')
    assert lines[1] == ('WARNING', 'Receiver 10.0.0.51 (qlxd) stopped answering')
    assert lines[2][0] == 'INFO'
    assert lines[2][1].startswith('Receiver 10.0.0.51 (qlxd) is answering again after ')
    assert len(lines) == 3


def test_a_receiver_that_is_switched_off_is_not_news_every_retry(caplog):
    caplog.set_level(logging.INFO, logger='micboard.device')
    rx = _receiver()
    for _ in range(10):  # connect attempts that never get an answer
        rx.set_rx_com_status('CONNECTING')
        rx.set_rx_com_status('DISCONNECTED')
    assert _lines(caplog) == []


def test_the_lines_land_under_the_device_source():
    from logging_utils import LOG_NAMESPACE  # noqa: F401  (the mapping's own prefix)
    assert networkdevice.logger.name == 'micboard.device'
