#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
查看当前 Clash Verge / mihomo 正在用的节点和延迟。

用法：
  python3 status.py                     # 默认连 Clash Verge 的 unix socket
  python3 status.py --port 9097 --secret set-your-secret
  python3 status.py --url http://127.0.0.1:9097
"""

import argparse
import http.client
import json
import socket


def fetch_proxies(base_url: str, secret: str | None, socket_path: str | None) -> dict:
    """通过 HTTP 或 unix socket 连接 mihomo 控制器，返回 /proxies 数据。"""
    conn = None
    if socket_path:
        # 自定义 socket，让 http.client 走 unix socket
        class UnixSocket(socket.socket):
            def __init__(self):
                super().__init__(socket.AF_UNIX, socket.SOCK_STREAM)
                self.connect(socket_path)

        class UnixHTTPConnection(http.client.HTTPConnection):
            def connect(self):
                self.sock = UnixSocket()

        conn = UnixHTTPConnection("localhost")
    else:
        host, _, port = base_url[len("http://"):].rpartition(":")
        conn = http.client.HTTPConnection(host, int(port or 9097))

    headers = {}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    conn.request("GET", "/proxies", headers=headers)
    resp = conn.getresponse()
    if resp.status != 200:
        raise RuntimeError(f"控制器返回 HTTP {resp.status}，请检查 --secret / --url / --socket")
    return json.loads(resp.read())


def main():
    ap = argparse.ArgumentParser(description="查看 Clash Verge / mihomo 当前使用的节点")
    ap.add_argument("--socket", default="/tmp/verge/verge-mihomo.sock", help="mihomo unix socket 路径")
    ap.add_argument("--url", help="控制器 HTTP 地址，例如 http://127.0.0.1:9097")
    ap.add_argument("--secret", default="set-your-secret", help="控制器 secret")
    args = ap.parse_args()

    use_socket = not args.url and __import__("os").path.exists(args.socket)
    try:
        data = fetch_proxies(args.url or "http://127.0.0.1:9097", args.secret,
                             args.socket if use_socket else None)
    except Exception as e:
        print(f"连接控制器失败：{e}")
        print("提示：Clash Verge 默认用 unix socket，星云/其他客户端用 --url 指定控制器地址")
        return

    ps = data["proxies"]
    print("分组当前选择：")
    for name, p in ps.items():
        if p.get("type") in ("URLTest", "Selector", "Fallback", "LoadBalance"):
            print(f"  {name}: {p.get('now')}")
    auto = ps.get("自动选择") or ps.get("GLOBAL")
    if auto and auto.get("now"):
        print(f"\n当前生效节点：{auto['now']}")


if __name__ == "__main__":
    main()
