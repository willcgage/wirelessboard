from audio_technica_protocol import frame, get_channel, get_levels, parse


def test_frame_keeps_partial_message_for_next_read():
    messages, remainder = frame('ACK\r gprch 0000 00 NC\r n')
    assert messages == ['ACK', ' gprch 0000 00 NC']
    assert remainder == ' n'


def test_parse_preserves_tokens_and_raw_line():
    result = parse('gprch 0000 00 NC 2,,0,,,1,580925000,03,12,1\r')
    assert result['command'] == 'gprch'
    assert result['fields'][:4] == ['0000', '00', 'NC', '2,,0,,,1,580925000,03,12,1']
    assert result['raw'].endswith(',1')


def test_command_builders_use_cr_terminated_wire_shape():
    assert get_channel(0, 0) == 'gprch 0000 00\r'
    assert get_levels(12, 2) == 'garlv 0012 02\r'
