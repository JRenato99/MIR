from math import cos, sin, tau
import hashlib


def _angle_from_id(node_id: str) -> float:
    h = hashlib.sha1(node_id.encode("utf-8")).digest()
    v = int.from_bytes(h[:4], "big") / 0xFFFFFFFF
    return v * tau
