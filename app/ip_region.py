"""Offline IP → region lookup with an ip2region xdb file (optional).

Compatible reimplementation of the ip2region xdb searcher
(https://github.com/lionsoul2014/ip2region, Apache-2.0 / MIT). Place
ip2region_v4.xdb (and optionally ip2region_v6.xdb) in the data directory;
without them lookups simply return ''. Region strings look like
"中国|广东省|深圳市|电信|CN" (fields depend on the data release).
"""
from __future__ import annotations

from functools import lru_cache
import ipaddress
from pathlib import Path
import struct
import threading

HEADER = 256
VECTOR = 256 * 256 * 8


class XdbSearcher:
    def __init__(self, path: Path):
        self.path = Path(path)
        with self.path.open('rb') as handle:
            header = handle.read(HEADER)
            structure, = struct.unpack_from('<H', header, 0)
            ip_version, = struct.unpack_from('<H', header, 16)
            self.bytes = 16 if structure >= 3 and ip_version == 6 else 4
            self.vector = handle.read(VECTOR)
        if len(self.vector) != VECTOR:
            raise ValueError('xdb file is truncated')
        self.index_size = 2 * self.bytes + 6
        self._handle = self.path.open('rb')
        self._lock = threading.Lock()

    def _read(self, offset, length):
        with self._lock:
            self._handle.seek(offset)
            return self._handle.read(length)

    def _compare(self, ip: bytes, block: bytes, offset: int) -> int:
        if self.bytes == 4:  # IPv4 index entries are stored little-endian.
            other = block[offset:offset + 4][::-1]
        else:
            other = block[offset:offset + self.bytes]
        return (ip > other) - (ip < other)

    def search(self, ip: bytes) -> str:
        start, end = struct.unpack_from('<II', self.vector, (ip[0] * 256 + ip[1]) * 8)
        if not start or not end:
            return ''
        low, high = 0, (end - start) // self.index_size
        while low <= high:
            mid = (low + high) >> 1
            block = self._read(start + mid * self.index_size, self.index_size)
            if self._compare(ip, block, 0) < 0:
                high = mid - 1
            elif self._compare(ip, block, self.bytes) > 0:
                low = mid + 1
            else:
                length, pointer = struct.unpack_from('<HI', block, 2 * self.bytes)
                return self._read(pointer, length).decode('utf-8', 'replace') if length else ''
        return ''


class RegionLookup:
    def __init__(self, data_dir: Path):
        self.searchers = {}
        for version, name in ((4, 'ip2region_v4.xdb'), (6, 'ip2region_v6.xdb')):
            path = Path(data_dir) / name
            if path.is_file():
                try:
                    self.searchers[version] = XdbSearcher(path)
                except (OSError, ValueError, struct.error):
                    pass
        self.lookup = lru_cache(maxsize=4096)(self._lookup)

    @property
    def available(self) -> bool:
        return bool(self.searchers)

    def _lookup(self, address: str) -> str:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            return ''
        if ip.is_loopback:
            return '本机'
        if ip.is_private or ip.is_link_local:
            return '内网'
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        searcher = self.searchers.get(ip.version)
        if searcher is None:
            return ''
        try:
            return searcher.search(ip.packed)
        except (OSError, struct.error):
            return ''


def fields(region: str) -> list[str]:
    """Positional fields: country, province, city, ISP (empty when unknown)."""
    parts = [('' if p == '0' else p) for p in (region or '').split('|')]
    return (parts + ['', '', '', ''])[:4] if len(parts) >= 4 else [region or '', '', '', '']


def pretty(region: str) -> str:
    """'中国|广东省|深圳市|电信|CN' → '中国 广东省 深圳市 · 电信'."""
    if not region or '|' not in region:
        return region or ''
    country, province, city, isp = fields(region)
    place = []
    for part in (country, province, city):
        if part and part not in place:
            place.append(part)
    return ' '.join(place) + (' · ' + isp if isp else '')


def area(region: str) -> str:
    """Grouping label for charts: province within China, otherwise the country."""
    if not region or '|' not in region:
        return region or '未知'
    country, province, _, _ = fields(region)
    if country == '中国':
        return province or '中国'
    return country or '未知'
