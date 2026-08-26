#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多机场订阅自动切换器：把 2~N 个机场订阅合并成一份 Clash 配置。

生成的 merged.yaml 里：
  - 每个机场一个 url-test 组（组内自动挑延迟最低的可用节点）
  - 顶层「自动选择」url-test 组（在所有机场之间自动切换）
  - 只要有一个机场活着，你的流量就不断

用法：
  python3 build_config.py                       # 读取 config.yaml
  python3 build_config.py -u <url> -u <url> ... # 或直接给订阅链接
  python3 build_config.py -c my.yaml -o out.yaml

依赖：Python3 + PyYAML（brew install python-yaml 或 pip install pyyaml）
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

try:
    import yaml
except ImportError:
    sys.exit("缺少 PyYAML，请先安装：pip3 install pyyaml")

DEFAULT_UA = "clash.meta/v1.19.25"


# ---------------------------------------------------------------- 抓取订阅

def fetch_subscription(url: str, proxy: str | None, timeout: int = 30) -> str:
    """下载订阅内容，返回文本。"""
    if url.startswith("file://"):
        path = url[len("file://"):]
        if sys.platform == "win32" and path.startswith("/"):
            path = path[1:]
        with open(path, "rb") as f:
            raw = f.read()
        for enc in ("utf-8", "gbk", "latin-1"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")
    req = urllib.request.Request(url, headers={
        "User-Agent": DEFAULT_UA,
        "Accept": "*/*",
    })
    opener = urllib.request.build_opener()
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({
                "http": proxy,
                "https": proxy,
            })
        )
    with opener.open(req, timeout=timeout) as resp:
        raw = resp.read()
    # 先按 utf-8，失败再按 gbk（部分机场用了 GBK）
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_subscription_content(text: str):
    """把订阅内容解析成 Clash proxy 字典列表。

    支持两种格式：
      1. Clash YAML（包含 proxies: 列表）
      2. base64 编码的 v2ray 订阅（每行一个 vmess:// vless:// trojan:// ss:// ...）
    """
    stripped = text.lstrip()
    # 1) Clash YAML
    if stripped.startswith("proxies") or "proxies:" in stripped[:200]:
        try:
            data = yaml.safe_load(text)
        except Exception:
            data = None
        if isinstance(data, dict) and isinstance(data.get("proxies"), list):
            return data["proxies"]

    # 2) 尝试 base64 解码（v2ray 订阅通常整体 base64）
    decoded_text = text
    try:
        decoded = base64.b64decode(re.sub(r"\s+", "", text), validate=True)
        decoded_text = decoded.decode("utf-8", errors="replace")
    except Exception:
        pass  # 不是 base64，按纯文本处理

    nodes = []
    for line in decoded_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        node = uri_to_clash_proxy(line)
        if node:
            nodes.append(node)
    return nodes


# ---------------------------------------------------------------- URI 解析

def _b64decode_safe(s: str) -> str:
    s = s.strip()
    s += "=" * (-len(s) % 4)
    try:
        return base64.b64decode(s).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _split_host_port(info: str):
    """把 'host:port?query' 拆成 (host, port_str, query_dict)。"""
    query = {}
    if "?" in info:
        info, qs = info.split("?", 1)
        query = urllib.parse.parse_qs(qs)
    host, _, port_str = info.rpartition(":")
    return host, port_str, query


def uri_to_clash_proxy(uri: str):
    """把单条订阅链接解析成 Clash proxy 字典，解析不了返回 None。"""
    try:
        scheme, rest = uri.split("://", 1)
    except ValueError:
        return None
    scheme = scheme.lower()
    try:
        if scheme == "vmess":
            return _parse_vmess(rest)
        if scheme == "vless":
            return _parse_vless(rest)
        if scheme == "trojan":
            return _parse_trojan(rest)
        if scheme == "ss":
            return _parse_ss(rest)
        if scheme == "ssr":
            return _parse_ssr(rest)
        if scheme in ("hysteria2", "hy2"):
            return _parse_hysteria2(rest)
        if scheme == "hysteria":
            return _parse_hysteria1(rest)
        if scheme == "tuic":
            return _parse_tuic(rest)
    except Exception:
        return None
    return None


def _parse_vmess(rest: str) -> dict | None:
    raw = _b64decode_safe(rest)
    try:
        d = json.loads(raw)
    except Exception:
        return None
    node = {
        "name": d.get("ps", ""),
        "type": "vmess",
        "server": d.get("add", ""),
        "port": int(d.get("port", 0) or 0),
        "uuid": d.get("id", ""),
        "alterId": int(d.get("aid", 0) or 0),
        "cipher": d.get("scy", "auto") or "auto",
        "udp": True,
    }
    net = d.get("net", "tcp")
    tls = d.get("tls", "")
    if tls:
        node["tls"] = True
        if d.get("sni"):
            node["servername"] = d["sni"]
        elif d.get("host"):
            node["servername"] = d["host"]
        if d.get("fp"):
            node["client-fingerprint"] = d["fp"]
    if net == "ws":
        node["network"] = "ws"
        node["ws-opts"] = {"path": d.get("path", "/"), "headers": {"Host": d.get("host", "")}}
    elif net == "grpc":
        node["network"] = "grpc"
        node["grpc-opts"] = {"grpc-service-name": d.get("path", "") or d.get("serviceName", "")}
    elif net == "h2":
        node["network"] = "h2"
        node["h2-opts"] = {"path": d.get("path", "/"), "host": [d.get("host", "")]}
    if not node["server"] or not node["port"] or not node["uuid"]:
        return None
    return node


def _parse_vless(rest: str) -> dict | None:
    info, _, frag = rest.partition("#")
    userinfo, _, hostpart = info.rpartition("@")
    uuid = userinfo
    host, port_str, query = _split_host_port(hostpart)
    if not port_str.isdigit():
        return None
    # query 可能覆盖 host/port 参数
    if query.get("port"):
        port_str = query["port"][0]
    if query.get("host"):
        host = query["host"][0]
    name = urllib.parse.unquote(frag.split("?", 1)[0]) if frag else host
    node = {
        "name": name or host,
        "type": "vless",
        "server": host,
        "port": int(port_str),
        "uuid": uuid,
        "udp": True,
    }
    security = query.get("security", ["none"])[0]
    network = query.get("type", ["tcp"])[0]
    if security in ("tls", "reality"):
        node["tls"] = True
        if query.get("sni"):
            node["servername"] = query["sni"][0]
        if query.get("fp"):
            node["client-fingerprint"] = query["fp"][0]
        if security == "reality":
            node["reality-opts"] = {}
            if query.get("pbk"):
                node["reality-opts"]["public-key"] = query["pbk"][0]
            if query.get("sid"):
                node["reality-opts"]["short-id"] = query["sid"][0]
            if query.get("spx"):
                node["reality-opts"]["spider-x"] = query["spx"][0]
    if query.get("flow"):
        node["flow"] = query["flow"][0]
    if network == "ws":
        node["network"] = "ws"
        ws_path = query.get("path", ["/"])[0]
        ws_host = query.get("host", [""])[0]
        node["ws-opts"] = {"path": ws_path, "headers": {"Host": ws_host}}
    elif network == "grpc":
        node["network"] = "grpc"
        node["grpc-opts"] = {"grpc-service-name": query.get("serviceName", [""])[0]}
    elif network == "http":
        node["network"] = "http"
        node["http-opts"] = {
            "method": "GET",
            "path": [query.get("path", ["/"])[0]],
            "headers": {"Host": [query.get("host", [""])[0]]},
        }
    if not node["server"] or not node["port"] or not node["uuid"]:
        return None
    return node


def _parse_trojan(rest: str) -> dict | None:
    info, _, frag = rest.partition("#")
    userinfo, _, hostpart = info.rpartition("@")
    host, port_str, query = _split_host_port(hostpart)
    if not port_str.isdigit():
        return None
    name = urllib.parse.unquote(frag.split("?", 1)[0]) if frag else host
    node = {
        "name": name or host,
        "type": "trojan",
        "server": host,
        "port": int(port_str),
        "password": userinfo,
        "udp": True,
    }
    if query.get("sni"):
        node["sni"] = query["sni"][0]
    if query.get("allowInsecure") and query["allowInsecure"][0].lower() == "true":
        node["skip-cert-verify"] = True
    if query.get("type", ["tcp"])[0] == "ws":
        node["network"] = "ws"
        node["ws-opts"] = {
            "path": query.get("path", ["/"])[0],
            "headers": {"Host": query.get("host", [""])[0]},
        }
    return node


def _parse_ss(rest: str) -> dict | None:
    # 两种格式：
    #   ss://base64(method:password)@server:port#name
    #   ss://base64(method:password@server:port?plugin=...#name)
    frag = ""
    if "#" in rest:
        rest, frag = rest.split("#", 1)
    if "@" in rest:
        userinfo_b64, hostpart = rest.split("@", 1)
        method_pass = _b64decode_safe(userinfo_b64)
        if ":" not in method_pass:
            return None
        method, password = method_pass.split(":", 1)
        hostpart_noq = hostpart.split("?", 1)[0].rstrip("/")
        host, _, port_str = hostpart_noq.rpartition(":")
        plugin = None
        if "?" in hostpart:
            plugin = urllib.parse.unquote(hostpart.partition("?")[2])
    else:
        decoded = _b64decode_safe(rest)
        if "@" not in decoded:
            return None
        method_pass, hostpart = decoded.split("@", 1)
        method, password = method_pass.split(":", 1)
        host, _, port_str = hostpart.rpartition(":")
        plugin = None
    if not port_str.isdigit():
        return None
    node = {
        "name": urllib.parse.unquote(frag) or host,
        "type": "ss",
        "server": host,
        "port": int(port_str),
        "cipher": method,
        "password": password,
        "udp": True,
    }
    if plugin and "obfs" in plugin:
        node["plugin"] = "obfs"
        node["plugin-opts"] = {"mode": "http", "host": "www.bing.com"}
    return node


def _parse_ssr(rest: str) -> dict | None:
    decoded = _b64decode_safe(rest)
    if not decoded:
        return None
    # 标准格式：server:port:protocol:method:obfs:password/?obfsparam=..&protoparam=..&remarks=..
    main, _, parampart = decoded.partition("/?")
    parts = main.split(":")
    if len(parts) < 6:
        return None
    server, port_str = parts[0], parts[1]
    if not port_str.isdigit():
        return None
    protocol, method, obfs = parts[2], parts[3], parts[4]
    password = ":".join(parts[5:])
    params = {}
    for kv in parampart.split("&"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            params[k] = _b64decode_safe(v) if k in ("remarks", "group", "obfsparam", "protoparam") else v
    name = params.get("remarks") or server
    return {
        "name": name,
        "type": "ssr",
        "server": server,
        "port": int(port_str),
        "cipher": method,
        "password": password,
        "protocol": protocol,
        "protocol-param": params.get("protoparam", ""),
        "obfs": obfs,
        "obfs-param": params.get("obfsparam", ""),
        "udp": True,
    }


def _parse_hysteria2(rest: str) -> dict | None:
    info, _, frag = rest.partition("#")
    userinfo, _, hostpart = info.rpartition("@")
    host, port_str, query = _split_host_port(hostpart)
    if not port_str.isdigit():
        return None
    node = {
        "name": urllib.parse.unquote(frag) or host,
        "type": "hysteria2",
        "server": host,
        "port": int(port_str),
        "password": userinfo,
    }
    if query.get("sni"):
        node["sni"] = query["sni"][0]
    if query.get("insecure") and query["insecure"][0].lower() in ("1", "true"):
        node["skip-cert-verify"] = True
    if query.get("obfs"):
        node["obfs"] = query["obfs"][0]
        node["obfs-password"] = query.get("obfs-password", [""])[0]
    return node


def _parse_hysteria1(rest: str) -> dict | None:
    info, _, frag = rest.partition("#")
    host, port_str, query = _split_host_port(info)
    if not port_str.isdigit():
        return None
    node = {
        "name": urllib.parse.unquote(frag) or host,
        "type": "hysteria",
        "server": host,
        "port": int(port_str),
        "up": query.get("up", ["100"])[0],
        "down": query.get("down", ["100"])[0],
        "auth-str": query.get("auth", [""])[0],
    }
    if query.get("obfs"):
        node["obfs"] = query["obfs"][0]
    if query.get("insecure") and query["insecure"][0].lower() in ("1", "true"):
        node["skip-cert-verify"] = True
    return node


def _parse_tuic(rest: str) -> dict | None:
    info, _, frag = rest.partition("#")
    userinfo, _, hostpart = info.rpartition("@")
    host, port_str, query = _split_host_port(hostpart)
    if not port_str.isdigit():
        return None
    uuid = userinfo
    password = query.get("password", [""])[0]
    if ":" in userinfo:
        uuid, _, pw = userinfo.partition(":")
        if pw:
            password = pw
    node = {
        "name": urllib.parse.unquote(frag) or host,
        "type": "tuic",
        "server": host,
        "port": int(port_str),
        "uuid": uuid,
        "password": password,
        "congestion-controller": query.get("congestion_control", ["bbr"])[0],
        "udp-relay-mode": query.get("udp_relay_mode", ["native"])[0],
    }
    if query.get("sni"):
        node["sni"] = query["sni"][0]
    if query.get("allow_insecure") and query["allow_insecure"][0].lower() in ("1", "true"):
        node["skip-cert-verify"] = True
    return node


# ---------------------------------------------------------------- 生成配置

def generate_config(subscriptions, health_url="http://www.gstatic.com/generate_204",
                    interval=30, tolerance=80, fetch_proxy=None):
    """核心入口：抓取并解析订阅，返回合并后的 Clash 配置字典。

    参数：
      subscriptions: [{"name": "机场A", "url": "https://..."}, ...]
      health_url:    健康检查地址
      interval:      健康检查间隔（秒）
      tolerance:     延迟容差（毫秒）
      fetch_proxy:   抓取订阅时使用的代理，如 "http://127.0.0.1:7897"

    返回：
      (config_dict, warnings_list)

    前端可以直接 import build_config 后调用本函数，拿到 dict 再自行
    展示/序列化，不需要走命令行。
    """
    all_proxies = []
    per_sub_groups = []
    warnings = []

    for idx, sub in enumerate(subscriptions):
        name = sub.get("name") or f"机场{idx+1}"
        url = sub.get("url", "").strip()
        if not url:
            warnings.append(f"[{name}] 没有 url，跳过")
            continue
        print(f"正在抓取：{name}  {url[:80]}...")
        try:
            text = fetch_subscription(url, fetch_proxy)
        except Exception as e:
            warnings.append(f"[{name}] 抓取失败：{e}")
            continue
        nodes = parse_subscription_content(text)
        if not nodes:
            warnings.append(f"[{name}] 没有解析出任何节点（可能链接失效或格式不支持）")
            continue

        sub_nodes = []
        seen = set()
        for n in nodes:
            nname = n.get("name") or n.get("server") or "node"
            nname = f"{name}|{nname}"
            if nname in seen:
                continue
            seen.add(nname)
            n["name"] = nname
            sub_nodes.append(n)
        all_proxies.extend(sub_nodes)
        per_sub_groups.append({
            "name": name,
            "type": "url-test",
            "url": health_url,
            "interval": interval,
            "tolerance": tolerance,
            "lazy": False,
            "proxies": [n["name"] for n in sub_nodes],
        })
        print(f"  ✓ 解析到 {len(sub_nodes)} 个节点")

    if not all_proxies:
        sys.exit("没有任何可用订阅，请检查 config.yaml 里的链接后重试。\n" + "\n".join(warnings))

    config = {
        "mode": "rule",
        "proxies": all_proxies,
        "proxy-groups": [
            *per_sub_groups,
            {
                "name": "手动选择",
                "type": "select",
                "proxies": ["自动选择", "DIRECT", *[g["name"] for g in per_sub_groups]],
            },
            {
                "name": "自动选择",
                "type": "url-test",
                "url": health_url,
                "interval": interval,
                "tolerance": tolerance,
                "lazy": False,
                "proxies": [g["name"] for g in per_sub_groups],
            },
        ],
        "rules": [
            "GEOIP,private,DIRECT,no-resolve",
            "GEOIP,CN,DIRECT",
            "MATCH,手动选择",
        ],
    }
    return config, warnings


def write_config(config, output):
    """把配置字典写成带说明头的 YAML 文件。"""
    header = (
        "# 由 build_config.py 自动生成\n"
        f"# 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "# 节点会按机场分组自动健康检查，全部失效时自动切换到其他机场\n\n"
    )
    with open(output, "w", encoding="utf-8") as f:
        f.write(header)
        yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False, width=200)


def build_config(subscriptions, output, health_url, interval, tolerance, fetch_proxy):
    """CLI 用：抓取订阅 → 生成配置 → 写文件 → 打印摘要。"""
    config, warnings = generate_config(
        subscriptions, health_url=health_url,
        interval=interval, tolerance=tolerance, fetch_proxy=fetch_proxy,
    )
    write_config(config, output)

    n_subs = len([g for g in config["proxy-groups"] if g["type"] == "url-test" and g["name"] != "自动选择"])
    print(f"\n✓ 已生成 {output}")
    print(f"  共 {len(config['proxies'])} 个节点，{n_subs} 个机场")
    print("  把这份文件导入 Clash Verge 即可自动切换。")
    if warnings:
        print("\n⚠ 警告：")
        for w in warnings:
            print("  " + w)


def main():
    ap = argparse.ArgumentParser(description="多机场订阅自动切换配置生成器")
    ap.add_argument("-c", "--config", default="config.yaml", help="配置文件（默认 config.yaml）")
    ap.add_argument("-u", "--url", action="append", dest="urls", help="订阅链接，可多次指定")
    ap.add_argument("-o", "--output", help="输出文件")
    ap.add_argument("--fetch-proxy", help="抓取订阅用的代理，例如 http://127.0.0.1:7897")
    args = ap.parse_args()

    if args.urls:
        subs = [{"name": f"机场{i+1}", "url": u} for i, u in enumerate(args.urls)]
        output = args.output or "merged.yaml"
        fetch_proxy = args.fetch_proxy
        health_url, interval, tolerance = "http://www.gstatic.com/generate_204", 30, 80
    else:
        if not os.path.exists(args.config):
            sys.exit(f"找不到配置文件 {args.config}。请先 cp config.example.yaml config.yaml 并填入订阅链接。")
        with open(args.config, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        subs = cfg.get("subscriptions", [])
        if not subs:
            sys.exit("config.yaml 里没有 subscriptions 配置。")
        output = args.output or cfg.get("output", "merged.yaml")
        fetch_proxy = args.fetch_proxy or cfg.get("fetch_proxy")
        health_url = cfg.get("health_url", "http://www.gstatic.com/generate_204")
        interval = int(cfg.get("check_interval", 30))
        tolerance = int(cfg.get("tolerance", 80))

    build_config(subs, output, health_url, interval, tolerance, fetch_proxy)


if __name__ == "__main__":
    main()
