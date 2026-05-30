from sentinel_shield.protocol import (
    PROTOCOL_VERSION,
    LineDecoder,
    ToolCall,
    Verdict,
    encode,
)


def test_protocol_version():
    assert PROTOCOL_VERSION == 1


def test_toolcall_to_dict_omits_none():
    assert ToolCall(tool="shell").to_dict() == {"tool": "shell"}
    assert ToolCall(tool="shell", args={"cmd": "ls"}).to_dict() == {"tool": "shell", "args": {"cmd": "ls"}}
    assert ToolCall(tool="x", text="hi").to_dict() == {"tool": "x", "text": "hi"}


def test_encode_is_newline_terminated_json():
    out = encode({"type": "ping", "id": "1"})
    assert out.endswith(b"\n")
    assert out == b'{"type":"ping","id":"1"}\n'


def test_line_decoder_splits_messages():
    dec = LineDecoder()
    msgs = dec.push(b'{"a":1}\n{"a":2}\n')
    assert msgs == [{"a": 1}, {"a": 2}]


def test_line_decoder_buffers_partial():
    dec = LineDecoder()
    assert dec.push(b'{"a":1}\n{"a":') == [{"a": 1}]
    assert dec.push(b'2}\n') == [{"a": 2}]


def test_verdict_from_response():
    v = Verdict.from_response({"verdict": "block", "risk": "critical", "score": 95, "allowed": False})
    assert v.blocked is True
    assert v.allowed is False
    v2 = Verdict.from_response({"verdict": "allow", "risk": "none", "score": 0})
    assert v2.blocked is False
    assert v2.allowed is True
