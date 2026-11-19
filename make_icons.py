# 依存なしでPNGアイコンを生成（カレンダー風）
import struct, zlib, os
def png(path, n):
    S = n / 512
    def inside_rr(x, y, x0, y0, x1, y1, r):
        if x < x0 or x > x1 or y < y0 or y > y1: return False
        cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    rows = []
    for py in range(n):
        row = bytearray([0])
        for px in range(n):
            x, y = (px + .5) / S, (py + .5) / S
            c = (10, 122, 255)                      # 背景 青
            if inside_rr(x, y, 96, 120, 416, 420, 40):
                c = (255, 255, 255)                 # 紙
                if y < 200: c = (232, 65, 12)       # 上帯 オレンジ
                else:
                    # 3x3 の点（予定の印）
                    for i, gx in enumerate((176, 256, 336)):
                        for j, gy in enumerate((258, 318, 378)):
                            if (x - gx) ** 2 + (y - gy) ** 2 <= 20 ** 2:
                                c = [(46,157,91),(47,111,214),(224,80,138)][(i + j) % 3]
            for rx in (176, 336):                   # リング
                if inside_rr(x, y, rx - 14, 92, rx + 14, 150, 14): c = (40, 40, 48)
            row += bytes(c)
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
png(os.path.join(d, 'icon-192.png'), 192); png(os.path.join(d, 'icon-512.png'), 512); png(os.path.join(d, 'apple-touch-icon.png'), 180)
