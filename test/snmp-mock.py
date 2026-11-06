# A tiny SNMP v2c agent for testing, built on the independent pysnmp library (not on Dashboard Hub's own code).
# usage: python3 snmp-mock.py <port> <community> <mib.json>
import sys, json, socket
from pyasn1.codec.ber import decoder, encoder
from pysnmp.proto import api
from pysnmp.proto import rfc1902

port, community, mibfile = int(sys.argv[1]), sys.argv[2], sys.argv[3]
raw = json.load(open(mibfile))
def key(o): return tuple(int(x) for x in o.split('.'))
mib = []
for o, (t, v) in raw.items():
    if t == 's': val = rfc1902.OctetString(v)
    elif t == 'x': val = rfc1902.OctetString(hexValue=v)
    elif t == 't': val = rfc1902.TimeTicks(v)
    else: val = rfc1902.Integer(v)
    mib.append((key(o), val))
mib.sort(key=lambda x: x[0])

pMod = api.v2c
def g(obj, *names):
    for n in names:
        if hasattr(obj, n): return getattr(obj, n)
    raise AttributeError(names)

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('127.0.0.1', port))
print('ready', flush=True)
while True:
    data, addr = sock.recvfrom(65535)
    try:
        msg, _ = decoder.decode(data, asn1Spec=pMod.Message())
        if str(g(pMod.apiMessage, 'get_community', 'getCommunity')(msg)) != community:
            continue                      # wrong community: real agents stay silent
        req = g(pMod.apiMessage, 'get_pdu', 'getPDU')(msg)
        rsp_msg = g(pMod.apiMessage, 'get_response', 'getResponse')(msg)
        rsp = g(pMod.apiMessage, 'get_pdu', 'getPDU')(rsp_msg)
        g(pMod.apiPDU, 'set_varbinds', 'setVarBinds')
        vbs_in = g(pMod.apiPDU, 'get_varbinds', 'getVarBinds')(req)
        out = []
        is_bulk = req.tagSet == pMod.GetBulkRequestPDU.tagSet
        is_next = req.tagSet == pMod.GetNextRequestPDU.tagSet
        if is_bulk:
            maxrep = int(g(pMod.apiBulkPDU, 'get_max_repetitions', 'getMaxRepetitions')(req))
        for name, _v in vbs_in:
            q = tuple(name)
            if not (is_bulk or is_next):
                found = [v for k, v in mib if k == q]
                out.append((name, found[0] if found else rfc1902.Null('').clone()))
                if not found:
                    out[-1] = (name, pMod.NoSuchObject(''))
                continue
            after = [(k, v) for k, v in mib if k > q][: (maxrep if is_bulk else 1)]
            if not after:
                out.append((name, pMod.EndOfMibView('')))
            for k, v in after:
                out.append((k, v))
        g(pMod.apiPDU, 'set_varbinds', 'setVarBinds')(rsp, out)
        sock.sendto(encoder.encode(rsp_msg), addr)
    except Exception as e:
        print('mock error', repr(e), flush=True)
