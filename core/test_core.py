#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
核心模块测试：订阅解析与配置生成。

运行：
  python3 test_core.py
"""

import base64
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_config as bc  # noqa: E402


REALITY_KEY = "tJqBgNHuFiVusSSfpQ6CnWMVv5q9TRLjXZ6chIe2HlU"


class TestUriParsing(unittest.TestCase):
    def test_vmess(self):
        import json as _json
        payload = _json.dumps({
            "v": "2", "ps": "香港-测试", "add": "1.2.3.4", "port": "443",
            "id": "00000000-0000-0000-0000-000000000001", "aid": "0",
            "scy": "auto", "net": "ws", "host": "cdn.example.com",
            "path": "/ws", "tls": "tls", "sni": "cdn.example.com",
        })
        uri = "vmess://" + base64.b64encode(payload.encode()).decode()
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "vmess")
        self.assertEqual(n["server"], "1.2.3.4")
        self.assertEqual(n["port"], 443)
        self.assertEqual(n["network"], "ws")
        self.assertTrue(n.get("tls"))

    def test_vless_reality(self):
        uri = (
            "vless://550e8400-e29b-41d4-a716-446655440000@v.example.com:443"
            f"?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk={REALITY_KEY}"
            "&sid=abcd&type=tcp&flow=xtls-rprx-vision#VLESS-Reality"
        )
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "vless")
        self.assertEqual(n["port"], 443)
        self.assertTrue(n.get("tls"))
        self.assertEqual(n.get("flow"), "xtls-rprx-vision")
        self.assertEqual(n.get("servername"), "www.microsoft.com")

    def test_vless_ws(self):
        uri = (
            "vless://550e8400-e29b-41d4-a716-446655440000@w.example.com:8443"
            "?encryption=none&security=tls&sni=w.example.com&type=ws&path=%2Fws&host=w.example.com#VLESS-WS"
        )
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["network"], "ws")
        self.assertEqual(n["ws-opts"]["path"], "/ws")

    def test_trojan(self):
        uri = "trojan://pass123@t.example.com:443?security=tls&sni=t.example.com#Trojan"
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "trojan")
        self.assertEqual(n["password"], "pass123")
        self.assertEqual(n["port"], 443)

    def test_ss(self):
        userinfo = base64.b64encode(b"aes-256-gcm:pass123").decode()
        uri = f"ss://{userinfo}@s.example.com:8388#SS"
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "ss")
        self.assertEqual(n["cipher"], "aes-256-gcm")
        self.assertEqual(n["port"], 8388)

    def test_ss_with_plugin(self):
        userinfo = base64.b64encode(b"aes-256-gcm:pass123").decode()
        uri = f"ss://{userinfo}@s2.example.com:8389/?plugin=obfs-local%3Bobfs%3Dhttp#SS-Obfs"
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["server"], "s2.example.com")
        self.assertEqual(n["port"], 8389)
        self.assertEqual(n.get("plugin"), "obfs")

    def test_ssr(self):
        b64 = lambda s: base64.b64encode(s.encode()).decode()  # noqa: E731
        raw = (
            "sr.example.com:9000:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:pw"
            f"/?obfsparam={b64('tls1.2_ticket_auth_compatible')}"
            f"&protoparam={b64('')}"
            f"&remarks={b64('SSR-测试')}"
        )
        uri = "ssr://" + base64.b64encode(raw.encode()).decode()
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "ssr")
        self.assertEqual(n["obfs"], "tls1.2_ticket_auth")
        self.assertEqual(n["password"], "pw")
        self.assertEqual(n["name"], "SSR-测试")

    def test_hysteria2(self):
        uri = "hysteria2://hys-pass@h2.example.com:8443?sni=h2.example.com&insecure=1#HY2"
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "hysteria2")
        self.assertEqual(n["password"], "hys-pass")
        self.assertTrue(n.get("skip-cert-verify"))

    def test_hysteria1(self):
        uri = "hysteria://h1.example.com:36712?auth=secret&up=50&down=200&obfs=xplus#HY1"
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "hysteria")
        self.assertEqual(n["auth-str"], "secret")
        self.assertEqual(n.get("obfs"), "xplus")

    def test_tuic(self):
        uri = (
            "tuic://00000000-0000-0000-0000-000000000009:tk@tuic.example.com:7788"
            "?sni=tuic.example.com&congestion_control=bbr&udp_relay_mode=native#TUIC"
        )
        n = bc.uri_to_clash_proxy(uri)
        self.assertIsNotNone(n)
        self.assertEqual(n["type"], "tuic")
        self.assertEqual(n["uuid"], "00000000-0000-0000-0000-000000000009")
        self.assertEqual(n.get("congestion-controller"), "bbr")

    def test_unknown_scheme(self):
        self.assertIsNone(bc.uri_to_clash_proxy("unknown://whatever"))


class TestSubscriptionParsing(unittest.TestCase):
    def test_base64_subscription(self):
        lines = [
            "vmess://" + base64.b64encode(
                '{"ps":"n1","add":"1.1.1.1","port":"443","id":"00000000-0000-0000-0000-000000000001","aid":"0","scy":"auto","net":"tcp","tls":""}'.encode()
            ).decode(),
            "trojan://pw@t.example.com:443#n2",
        ]
        text = base64.b64encode("\n".join(lines).encode()).decode()
        nodes = bc.parse_subscription_content(text)
        self.assertEqual(len(nodes), 2)

    def test_yaml_subscription(self):
        text = """
proxies:
  - name: y-1
    type: vmess
    server: 1.2.3.4
    port: 443
    uuid: 00000000-0000-0000-0000-000000000002
    alterId: 0
    cipher: auto
"""
        nodes = bc.parse_subscription_content(text)
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]["name"], "y-1")

    def test_html_garbage(self):
        text = "<!DOCTYPE html><html><body>Forbidden</body></html>"
        nodes = bc.parse_subscription_content(text)
        self.assertEqual(nodes, [])


class TestGenerateConfig(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ps-test-")

    def _write(self, name, content):
        p = os.path.join(self.tmp, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return "file://" + p

    def test_two_subscriptions(self):
        lines = [
            "trojan://pw@a.example.com:443#A1",
            "ss://" + base64.b64encode(b"aes-256-gcm:pw").decode() + "@a.example.com:8388#A2",
        ]
        url_a = self._write("a.txt", base64.b64encode("\n".join(lines).encode()).decode())
        url_b = self._write("b.txt", """
proxies:
  - name: B1
    type: vmess
    server: 5.6.7.8
    port: 443
    uuid: 00000000-0000-0000-0000-000000000003
    alterId: 0
    cipher: auto
""")
        subs = [{"name": "机场A", "url": url_a}, {"name": "机场B", "url": url_b}]
        cfg, warnings = bc.generate_config(subs)
        self.assertEqual(warnings, [])
        self.assertEqual(len(cfg["proxies"]), 3)
        names = [g["name"] for g in cfg["proxy-groups"]]
        self.assertIn("机场A", names)
        self.assertIn("机场B", names)
        self.assertIn("自动选择", names)
        self.assertIn("手动选择", names)
        # 名称带机场前缀，避免冲突
        pnames = [p["name"] for p in cfg["proxies"]]
        self.assertTrue(any(x.startswith("机场A|") for x in pnames))
        self.assertIn("MATCH,手动选择", cfg["rules"])

    def test_failed_subscription_keeps_others(self):
        url_ok = self._write("ok.txt", "trojan://pw@ok.example.com:443#OK")
        subs = [{"name": "坏的", "url": "file:///nonexistent/nope"}, {"name": "好的", "url": url_ok}]
        cfg, warnings = bc.generate_config(subs)
        self.assertEqual(len(cfg["proxies"]), 1)
        self.assertTrue(any("坏的" in w for w in warnings))

    def test_no_subscriptions_fails(self):
        with self.assertRaises(SystemExit):
            bc.generate_config([])


if __name__ == "__main__":
    unittest.main(verbosity=2)
