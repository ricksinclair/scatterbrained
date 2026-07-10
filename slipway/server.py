#!/usr/bin/env python3
"""Zero-dependency control panel for local LLM servers backing `claude-local`.

Manages two backends behind one UI:
  - MLX   : `mlx_lm.server` serving a HuggingFace-cache model on :8080
  - Ollama: the ollama daemon on :11434

Lets you start / stop / restart the active model, swap models from a dialog,
watch a live log, and quit the panel. Stdlib only.
"""
import base64
import datetime
import errno
import fcntl
import hashlib
import hmac
import json
import os
import pty
import re
import secrets
import select
import shutil
import signal
import struct
import subprocess
import termios
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PANEL_PORT = 8765
MLX_PORT = int(os.environ.get("SLIPWAY_MLX_PORT", "8080"))
OLLAMA_PORT = 11434
CFG_DIR = os.path.expanduser("~/.claude-code-router")
LOG_FILE = os.path.join(CFG_DIR, "mlx-server.log")
STATE_FILE = os.path.join(CFG_DIR, "current-model.json")
ROUTER_CFG = os.path.join(CFG_DIR, "config.json")
MARKER = os.path.join(CFG_DIR, ".starting")
ERR_FILE = os.path.join(CFG_DIR, "last-error")
# A load that hasn't served within this window has failed — the marker no longer
# counts as "starting" and the error surfaces instead of an eternal spinner.
MARKER_MAX_AGE = 300
# Default context window for Ollama lanes. Ollama otherwise allocates the model's FULL
# window — llama3.1's 131k KV cache turned a 4.9GB model into 22GB resident (observed
# 2026-07-04). 32k is generous for agent coding; override with SLIPWAY_NUM_CTX.
NUM_CTX = int(os.environ.get("SLIPWAY_NUM_CTX", "32768"))
HF_HUB = os.path.expanduser("~/.cache/huggingface/hub")
VLLM_BIN = shutil.which("vllm-mlx") or "vllm-mlx"   # MLX server, speaks Anthropic natively
OLLAMA_BIN = shutil.which("ollama") or "ollama"
HF_BIN = shutil.which("hf") or shutil.which("huggingface-cli") or "hf"
DISK_BUFFER = 10 * 1024**3  # keep at least 10 GB free after a download
DOWNLOADS = {}              # repo -> {total, proc(may be None after restart), pid, log, state}
DL_LOCK = threading.Lock()
DOWNLOADS_FILE = os.path.join(CFG_DIR, "downloads.json")  # survives panel restarts

# ---- embedded terminals ----
TERMINALS = {}              # session_id -> {pid, master_fd, kind, label, cols, rows, created, alive, token}
TERM_LOCK = threading.Lock()
TERM_SECRET = secrets.token_bytes(32)   # per-process; never persisted / sent except as derived token
SHELL = os.environ.get("SHELL", "/bin/zsh")
CLAUDE_LOCAL = os.path.expanduser("~/.local/bin/claude-local")
TERM_KILL_GRACE = 3.0       # seconds SIGTERM -> SIGKILL
TERM_DIR = os.path.join(CFG_DIR, "terminals")  # transcript logs
VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

DEFAULT = {"model": "mlx-community/Qwen3.6-35B-A3B-6bit", "backend": "mlx"}
HTTPD = None  # set in __main__, used by /api/quit

LAUNCHERS = {
    "claude": {"label": "Claude Code", "bin": "claude", "extra_paths": [],
               "install": None, "cloud_ok": True},
    "opencode": {"label": "OpenCode", "bin": "opencode",
                 "extra_paths": ["~/.opencode/bin/opencode"],
                 "install": "npm i -g opencode-ai", "cloud_ok": False},
    "hermes": {"label": "Hermes Agent", "bin": "hermes",
               "extra_paths": ["~/.hermes/bin/hermes"],
               "install": "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
               "cloud_ok": False},
}
HERMES_INSTALL_LOG = os.path.join(CFG_DIR, "hermes-install.log")
_HERMES_INSTALL = {"proc": None, "pid": None, "state": "idle"}  # single in-flight install

CLOUD_FILE = os.path.join(CFG_DIR, "cloud-providers.json")  # API keys live here (chmod 600)
# Cloud providers. "route":"ccr" → OpenAI-compatible, routed via claude-code-router.
#                  "route":"native" → Claude Code talks to it directly (Anthropic).
CLOUD_PROVIDERS = {
    "openrouter": {"label": "OpenRouter", "route": "ccr",
                   "base": "https://openrouter.ai/api/v1/chat/completions",
                   "transformer": ["openrouter"],
                   "default_models": ["anthropic/claude-sonnet-4", "deepseek/deepseek-chat",
                                      "nousresearch/hermes-4-70b"]},
    "anthropic": {"label": "Anthropic (Claude)", "route": "native",
                  "base": "https://api.anthropic.com",
                  "default_models": ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"]},
    "deepseek": {"label": "DeepSeek", "route": "ccr",
                 "base": "https://api.deepseek.com/chat/completions",
                 "transformer": ["deepseek"],
                 "default_models": ["deepseek-chat", "deepseek-reasoner"]},
    "nous": {"label": "Nous / Hermes", "route": "ccr",
             "base": "https://inference-api.nousresearch.com/v1/chat/completions",
             "transformer": [],
             "default_models": ["Hermes-4-70B", "Hermes-4-405B"]},
}


# ---------- state + router config ----------
def base_url(backend):
    port = OLLAMA_PORT if backend == "ollama" else MLX_PORT
    return f"http://127.0.0.1:{port}/v1/chat/completions"


def read_state():
    try:
        with open(STATE_FILE) as f:
            s = json.load(f)
        if s.get("model") and s.get("backend"):
            return s
    except Exception:
        pass
    return dict(DEFAULT)


def set_last_error(msg):
    try:
        with open(ERR_FILE, "w") as f:
            f.write(str(msg)[:300])
    except OSError:
        pass


def get_last_error():
    try:
        with open(ERR_FILE) as f:
            return f.read().strip() or None
    except OSError:
        return None


def clear_last_error():
    try:
        os.remove(ERR_FILE)
    except OSError:
        pass


def marker_age():
    try:
        return time.time() - os.path.getmtime(MARKER)
    except OSError:
        return None


def mlx_log_error():
    """Last error-looking line of the MLX server log — shown when a load dies."""
    try:
        with open(LOG_FILE, errors="replace") as f:
            lines = f.readlines()[-40:]
        for ln in reversed(lines):
            if re.search(r"error|Error|Traceback|No such|not found|Killed|OOM", ln):
                return ln.strip()[:200]
    except OSError:
        pass
    return None


def write_state(model, backend, provider=None):
    os.makedirs(CFG_DIR, exist_ok=True)
    launcher = read_state().get("launcher")  # preserve — model switches don't change launcher
    st = {"model": model, "backend": backend}
    if provider:
        st["provider"] = provider
    if launcher:
        st["launcher"] = launcher
    with open(STATE_FILE, "w") as f:
        json.dump(st, f)
    # Local backends (mlx/ollama) are Anthropic-native → no router config needed.
    # Cloud ccr-routed providers get their ccr config written here; switching away
    # from cloud clears it so a stale provider/key never lingers in the router config.
    if backend == "cloud" and CLOUD_PROVIDERS.get(provider, {}).get("route") == "ccr":
        configure_ccr_for_cloud(provider, model)
    else:
        _clear_ccr_config()


def _clear_ccr_config():
    try:
        with open(ROUTER_CFG, "w") as f:
            json.dump({"LOG": False, "HOST": "127.0.0.1"}, f, indent=2)
    except Exception:
        pass


# ---------- cloud providers ----------
def read_cloud():
    try:
        with open(CLOUD_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _mask(key):
    if not key:
        return ""
    return ("…" + key[-4:]) if len(key) > 4 else "set"


def write_cloud(provider, key, models, enabled):
    if provider not in CLOUD_PROVIDERS:
        return {"error": "unknown provider"}
    data = read_cloud()
    entry = data.get(provider, {})
    if key:  # only overwrite the key if a new one was supplied
        entry["key"] = key
    entry["models"] = [m.strip() for m in models if m.strip()]
    entry["enabled"] = bool(enabled)
    data[provider] = entry
    os.makedirs(CFG_DIR, exist_ok=True)
    with open(CLOUD_FILE, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(CLOUD_FILE, 0o600)  # keys are secrets
    return {"ok": True, "msg": f"saved {CLOUD_PROVIDERS[provider]['label']}"}


def cloud_providers_view():
    """Provider list for the UI — keys MASKED, never sent in full."""
    saved = read_cloud()
    out = []
    for pid, meta in CLOUD_PROVIDERS.items():
        s = saved.get(pid, {})
        out.append({
            "id": pid, "label": meta["label"], "route": meta["route"],
            "enabled": s.get("enabled", False),
            "has_key": bool(s.get("key")), "key_hint": _mask(s.get("key")),
            "models": s.get("models") or meta["default_models"],
            "default_models": meta["default_models"],
        })
    return out


def configure_ccr_for_cloud(provider, model):
    meta = CLOUD_PROVIDERS[provider]
    key = read_cloud().get(provider, {}).get("key", "")
    block = {"name": provider, "api_base_url": meta["base"],
             "api_key": key, "models": [model]}
    if meta.get("transformer"):
        block["transformer"] = {"use": meta["transformer"]}
    cfg = {"LOG": False, "HOST": "127.0.0.1", "Providers": [block],
           "Router": {k: f"{provider},{model}" for k in
                      ("default", "background", "think", "longContext", "webSearch")}}
    with open(ROUTER_CFG, "w") as f:
        json.dump(cfg, f, indent=2)
    try:
        subprocess.Popen([shutil.which("ccr") or "ccr", "restart"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


# ---------- launchers (agent CLIs: Claude Code, OpenCode, Hermes Agent) ----------
def _find_bin(lid):
    meta = LAUNCHERS[lid]
    p = shutil.which(meta["bin"])
    if p:
        return p
    for ep in meta["extra_paths"]:
        ep = os.path.expanduser(ep)
        if os.path.isfile(ep) and os.access(ep, os.X_OK):
            return ep
    return None


def launchers_view():
    st = read_state()
    cur = st.get("launcher", "claude")
    return [{"id": lid, "label": m["label"], "installed": _find_bin(lid) is not None,
             "install_cmd": m["install"], "cloud_ok": m["cloud_ok"],
             "current": lid == cur} for lid, m in LAUNCHERS.items()]


def set_launcher(launcher):
    if launcher not in LAUNCHERS:
        return {"error": "unknown launcher"}
    st = read_state()
    st["launcher"] = launcher
    with open(STATE_FILE, "w") as f:
        json.dump(st, f)
    return {"ok": True, "msg": f"launcher set to {LAUNCHERS[launcher]['label']}"}


def hermes_install_start():
    if _find_bin("hermes"):
        return {"ok": True, "msg": "already installed"}
    if _HERMES_INSTALL["proc"] is not None and _HERMES_INSTALL["state"] == "installing":
        return {"ok": True, "msg": "already installing"}
    os.makedirs(CFG_DIR, exist_ok=True)
    log = open(HERMES_INSTALL_LOG, "wb")
    proc = subprocess.Popen(
        ["bash", "-c", "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"],
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    _HERMES_INSTALL.update(proc=proc, pid=proc.pid, state="installing")
    return {"ok": True, "msg": "installing Hermes Agent…"}


def hermes_install_status():
    if _HERMES_INSTALL["proc"] is None:
        return {"state": "idle", "installed": _find_bin("hermes") is not None}
    code = _HERMES_INSTALL["proc"].poll()
    if code is None:
        state = "installing"
    elif _find_bin("hermes"):
        state = "done"
    else:
        state = "error"
    _HERMES_INSTALL["state"] = state
    tail = ""
    try:
        with open(HERMES_INSTALL_LOG, errors="replace") as f:
            tail = "".join(f.readlines()[-40:])
    except FileNotFoundError:
        pass
    return {"state": state, "installed": _find_bin("hermes") is not None, "log": tail}


# ---------- backend probes ----------
def _http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=1) as r:
            return r.status == 200
    except Exception:
        return False


def _mlx_api_ok():
    """True only if the thing on MLX_PORT actually speaks the models API — an HTTP 200
    alone is meaningless (a SPA dev server 200s every path, incl. /v1/models)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{MLX_PORT}/v1/models", timeout=1) as r:
            body = json.loads(r.read().decode())
            return isinstance(body, dict) and ("data" in body or "models" in body)
    except Exception:
        return False


def port_squatter():
    """Something answers on MLX_PORT but is NOT a model server → a foreign app owns the
    port and vllm will die at bind time. Detect it so the failure has a name."""
    return _http_ok(f"http://127.0.0.1:{MLX_PORT}/") and not _mlx_api_ok()


def mlx_pid():
    out = subprocess.run(["pgrep", "-f", "vllm-mlx serve"],
                         capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


def mlx_running_model():
    pid = mlx_pid()
    if not pid:
        return None
    cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)],
                         capture_output=True, text=True).stdout
    m = re.search(r"\bserve\s+(\S+)", cmd)
    return m.group(1) if m else None


def rss_mb(pid):
    out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)],
                         capture_output=True, text=True).stdout.strip()
    return round(int(out) / 1024) if out else None


def ollama_up():
    return _http_ok(f"http://127.0.0.1:{OLLAMA_PORT}/api/tags")


def ollama_ps():
    """{name: size_str} of currently loaded ollama models."""
    if not ollama_up():
        return {}
    out = subprocess.run([OLLAMA_BIN, "ps"], capture_output=True, text=True).stdout
    loaded = {}
    for line in out.splitlines()[1:]:
        cols = re.split(r"\s{2,}", line.strip())
        if len(cols) >= 3:
            loaded[cols[0]] = cols[2]
    return loaded


def is_serving(st):
    if st["backend"] == "ollama":
        return st["model"] in ollama_ps()
    return _mlx_api_ok() and mlx_running_model() == st["model"]


def proc_present(st):
    age = marker_age()
    fresh = age is not None and age < MARKER_MAX_AGE
    if st["backend"] == "ollama":
        return fresh
    return mlx_pid() is not None or fresh


# ---------- lifecycle ----------
def warm_ollama(model):
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{OLLAMA_PORT}/api/generate",
            data=json.dumps({"model": model, "prompt": ".", "stream": False,
                             "keep_alive": "30m",
                             "options": {"num_predict": 1, "num_ctx": NUM_CTX}}).encode(),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=600)
        clear_last_error()
    except Exception as e:
        # a silent pass here was Bug 2's ollama half: the load fails, the marker is
        # removed, and the UI just says "stopped" with no reason
        set_last_error(f"ollama could not load {model}: {e}")
    finally:
        try:
            os.remove(MARKER)
        except OSError:
            pass


def start():
    st = read_state()
    if is_serving(st):
        return {"ok": True, "msg": "already running"}
    # A load already in flight must not double-spawn — two racing vllm processes was an
    # observed failure (2026-07-04). But trust only REAL evidence of an in-flight load:
    # for mlx that's a live vllm pid, NOT the marker alone. A marker left behind by a load
    # that already died would otherwise wedge every retry with "already starting…" until it
    # ages out (MARKER_MAX_AGE = 5 min) — the intermittent "refuses to load" (2026-07-09).
    if st["backend"] == "ollama":
        if proc_present(st):            # ollama warms in-process → the fresh marker is the signal
            return {"ok": True, "msg": "already starting…"}
    elif mlx_pid():
        return {"ok": True, "msg": "already starting…"}
    else:
        age = marker_age()
        # a marker <5s old means a spawn just fired and its pid may not be pgrep-visible yet
        # (same threshold status() uses to call a load dead) — don't race it; older = stale.
        if age is not None and age <= 5:
            return {"ok": True, "msg": "already starting…"}
        if age is not None:
            try:
                os.remove(MARKER)      # stale marker from a dead load → clear it, then respawn
            except OSError:
                pass
    clear_last_error()
    os.makedirs(CFG_DIR, exist_ok=True)
    open(MARKER, "w").close()
    if st["backend"] == "ollama":
        if not ollama_up():
            subprocess.Popen([OLLAMA_BIN, "serve"],
                             stdout=open(LOG_FILE, "ab"), stderr=subprocess.STDOUT,
                             start_new_session=True,
                             env={**os.environ,
                                  # server-wide default ctx for requests that don't set
                                  # one (agent lanes via the router) — the KV-cache cap
                                  "OLLAMA_CONTEXT_LENGTH": str(NUM_CTX)})
            for _ in range(20):
                if ollama_up():
                    break
                time.sleep(0.3)
        threading.Thread(target=warm_ollama, args=(st["model"],), daemon=True).start()
        return {"ok": True, "msg": f"loading {st['model']}…"}
    # mlx (vllm-mlx serves the Anthropic API natively → no router needed)
    if port_squatter():
        try:
            os.remove(MARKER)
        except OSError:
            pass
        msg = (f"port {MLX_PORT} is occupied by another app — stop it or set "
               f"SLIPWAY_MLX_PORT, then run again")
        set_last_error(msg)
        return {"ok": False, "msg": msg}
    log = open(LOG_FILE, "ab")
    p = subprocess.Popen([VLLM_BIN, "serve", st["model"], "--port", str(MLX_PORT),
                          "--continuous-batching"],
                         stdout=log, stderr=log, start_new_session=True)
    return {"ok": True, "msg": f"started mlx pid {p.pid}"}


def stop():
    st = read_state()
    try:
        os.remove(MARKER)
    except OSError:
        pass
    if st["backend"] == "ollama":
        if st["model"] in ollama_ps():
            subprocess.run([OLLAMA_BIN, "stop", st["model"]],
                           capture_output=True)
            return {"ok": True, "msg": f"unloaded {st['model']}"}
        return {"ok": True, "msg": "already stopped"}
    pid = mlx_pid()
    if not pid:
        return {"ok": True, "msg": "already stopped"}
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception:
        subprocess.run(["pkill", "-f", "vllm-mlx serve"])
    return {"ok": True, "msg": f"stopped pid {pid}"}


def unload_all():
    """Free all model RAM: stop the MLX server AND unload every loaded Ollama model.

    Honesty contract (2026-07-04, after "unload all seems not to work"): a live agent
    session reloads its model within seconds of `ollama stop` — freeing was true for an
    instant and useless. So: check returncodes (a failed stop must not report freed),
    then RE-POLL after a beat and report anything that came back, naming the cause.
    """
    freed, failed = [], []
    live = [t for t in term_list() if t.get("alive") and t.get("kind") in ("launcher", "hosted")]
    pid = mlx_pid()
    if pid:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:
            subprocess.run(["pkill", "-f", "vllm-mlx serve"])
        freed.append("MLX server")
    for name in list(ollama_ps().keys()):
        r = subprocess.run([OLLAMA_BIN, "stop", name], capture_output=True, text=True)
        if r.returncode == 0:
            freed.append(name)
        else:
            failed.append(f"{name} ({(r.stderr or r.stdout or 'stop failed').strip()[:80]})")
    try:
        os.remove(MARKER)
    except OSError:
        pass
    time.sleep(1.2)
    reloaded = [n for n in ollama_ps() if n in freed]
    parts = []
    if freed:
        parts.append("freed " + ", ".join(n for n in freed if n not in reloaded))
    if reloaded:
        parts.append(f"{', '.join(reloaded)} was reloaded immediately by a live agent session"
                     f" — end the session (Terminals) before unloading")
    if failed:
        parts.append("failed: " + ", ".join(failed))
    if not parts:
        parts.append("nothing was loaded")
    return {"ok": not failed, "freed": freed, "failed": failed, "reloaded": reloaded,
            "live_sessions": len(live), "msg": " · ".join(parts)}


def restart():
    stop()
    for _ in range(40):
        if not is_serving(read_state()) and not mlx_pid():
            break
        time.sleep(0.5)
    return start()


def switch(model, backend, provider=None):
    was = is_serving(read_state()) or proc_present(read_state())
    stop()  # stop any local server from the previous selection
    for _ in range(40):
        if not mlx_pid() and read_state()["model"] not in ollama_ps():
            break
        time.sleep(0.3)
    write_state(model, backend, provider)
    if backend == "cloud":
        return {"ok": True, "msg": f"selected {model} · {provider}"}
    if was:
        return start()
    return {"ok": True, "msg": f"selected {model}"}


# ---------- discovery ----------
def list_models():
    st = read_state()
    models = []
    # MLX models from HF cache (any repo whose name marks it as MLX)
    if os.path.isdir(HF_HUB):
        for d in sorted(os.listdir(HF_HUB)):
            if not d.startswith("models--"):
                continue
            repo = d[len("models--"):].replace("--", "/")
            if "mlx" not in repo.lower():
                continue
            snaps = os.path.join(HF_HUB, d, "snapshots")
            try:
                snap = os.path.join(snaps, os.listdir(snaps)[0])
            except Exception:
                continue
            if not any(x.endswith(".safetensors") for x in os.listdir(snap)):
                continue
            size = subprocess.run(["du", "-sh", os.path.join(HF_HUB, d)],
                                  capture_output=True, text=True).stdout.split("\t")[0]
            models.append({"id": repo, "backend": "mlx",
                           "label": repo.split("/")[-1], "size": size.strip()})
    # Ollama models
    if ollama_up():
        out = subprocess.run([OLLAMA_BIN, "list"], capture_output=True, text=True).stdout
        for line in out.splitlines()[1:]:
            cols = re.split(r"\s{2,}", line.strip())
            if len(cols) >= 3 and "embed" not in cols[0].lower():
                models.append({"id": cols[0], "backend": "ollama",
                               "label": cols[0], "size": cols[2]})
    # Cloud models (enabled providers)
    for p in cloud_providers_view():
        if not p["enabled"]:
            continue
        for mid in p["models"]:
            models.append({"id": mid, "backend": "cloud", "provider": p["id"],
                           "label": mid, "size": p["label"]})
    for m in models:
        m["current"] = (m["id"] == st["model"] and m["backend"] == st["backend"])
    return models


def status():
    st = read_state()
    launcher_label = LAUNCHERS.get(st.get("launcher", "claude"), LAUNCHERS["claude"])["label"]
    if st["backend"] == "cloud":
        prov = st.get("provider", "")
        return {"state": "remote", "model": st["model"], "backend": "cloud",
                "provider": prov, "launcher": launcher_label,
                "port": CLOUD_PROVIDERS.get(prov, {}).get("label", prov),
                "pid": None, "ram": None}
    serving = is_serving(st)
    if serving:
        try:
            os.remove(MARKER)
        except OSError:
            pass
        clear_last_error()
        state = "running"
    elif proc_present(st):
        # an MLX load whose process DIED is a failure now, not "starting" forever
        if st["backend"] != "ollama" and marker_age() is not None and mlx_pid() is None \
                and marker_age() > 5:
            try:
                os.remove(MARKER)
            except OSError:
                pass
            set_last_error(mlx_log_error() or "the model server exited during load — see logs")
            state = "stopped"
        else:
            state = "starting"
    else:
        # a stale marker (load that never served within MARKER_MAX_AGE) also lands here
        if marker_age() is not None:
            try:
                os.remove(MARKER)
            except OSError:
                pass
            if not get_last_error():
                set_last_error("the model never finished loading — see logs")
        state = "stopped"
    ram = None
    if st["backend"] == "mlx" and mlx_pid():
        ram = rss_mb(mlx_pid())
    elif st["backend"] == "ollama":
        sz = ollama_ps().get(st["model"])
        ram = sz  # already human string e.g. "19 GB"
    return {"state": state, "model": st["model"], "backend": st["backend"],
            "launcher": launcher_label,
            "port": OLLAMA_PORT if st["backend"] == "ollama" else MLX_PORT,
            "pid": mlx_pid() if st["backend"] == "mlx" else None,
            "ram": ram,
            "error": get_last_error() if state == "stopped" else None}


def tail_log(n=200):
    st = read_state()
    if st["backend"] == "ollama":
        ps = subprocess.run([OLLAMA_BIN, "ps"], capture_output=True, text=True).stdout
        return "Ollama loaded models (`ollama ps`):\n\n" + (ps or "(none loaded)")
    try:
        with open(LOG_FILE, "r", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except FileNotFoundError:
        return "(no log yet)"


# ---------- huggingface browse + download ----------
def _repo_dir(repo):
    return os.path.join(HF_HUB, "models--" + repo.replace("/", "--"))


def _installed(repo):
    return os.path.isdir(_repo_dir(repo))


def _dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for fn in files:
            fp = os.path.join(root, fn)
            if os.path.islink(fp):  # HF snapshots symlink into blobs/ — count blobs once
                continue
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total


def hf_search(query, mlx_only=True):
    params = {"search": query or "", "sort": "downloads",
              "direction": "-1", "limit": "30"}
    if mlx_only:
        params["filter"] = "mlx"
    url = "https://huggingface.co/api/models?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.load(r)
    except Exception as e:
        return {"error": str(e), "results": []}
    out = []
    for m in data:
        rid = m.get("id", "")
        out.append({"id": rid, "downloads": m.get("downloads", 0),
                    "likes": m.get("likes", 0), "installed": _installed(rid)})
    return {"results": out}


def hf_size(repo):
    """Total download bytes for a repo's main revision, via the tree API."""
    url = f"https://huggingface.co/api/models/{urllib.parse.quote(repo)}/tree/main?recursive=true"
    with urllib.request.urlopen(url, timeout=20) as r:
        files = json.load(r)
    return sum(f.get("size", 0) for f in files if f.get("type") == "file")


def disk_free():
    """Bytes available — matches Finder (includes macOS purgeable space)."""
    try:
        out = subprocess.run(
            ["osascript", "-e",
             'tell application "Finder" to get free space of startup disk'],
            capture_output=True, text=True, timeout=5).stdout.strip()
        if out:
            return int(float(out))
    except Exception:
        pass
    return shutil.disk_usage(HF_HUB).free


def hf_size_check(repo):
    try:
        total = hf_size(repo)
    except Exception as e:
        return {"error": f"could not read model size: {e}"}
    free = disk_free()
    fits = total + DISK_BUFFER <= free
    return {"repo": repo, "total_bytes": total,
            "total_gb": round(total / 1024**3, 1),
            "free_gb": round(free / 1024**3, 1),
            "fits": fits, "installed": _installed(repo)}


def _pid_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, just owned by someone else — still running
    except Exception:
        return False


def _persist_downloads_locked():
    """Write the download registry (no live Popen handles) so a panel restart
    can re-attach to still-running `hf download` processes by pid."""
    data = {repo: {"total": d["total"], "pid": d.get("pid"),
                   "log": d.get("log"), "state": d["state"]}
            for repo, d in DOWNLOADS.items()}
    try:
        os.makedirs(CFG_DIR, exist_ok=True)
        with open(DOWNLOADS_FILE, "w") as f:
            json.dump(data, f)
    except Exception:
        pass


def load_downloads_registry():
    """Call once at startup — recovers in-flight/finished downloads across restarts."""
    try:
        with open(DOWNLOADS_FILE) as f:
            data = json.load(f)
    except Exception:
        return
    with DL_LOCK:
        for repo, d in data.items():
            DOWNLOADS[repo] = {"total": d.get("total", 0), "proc": None,
                               "pid": d.get("pid"), "log": d.get("log"),
                               "state": d.get("state", "downloading")}


def hf_download_start(repo):
    if _installed(repo):
        return {"ok": True, "msg": "already downloaded"}
    with DL_LOCK:
        if repo in DOWNLOADS and DOWNLOADS[repo]["state"] == "downloading":
            return {"ok": True, "msg": "already downloading"}
    chk = hf_size_check(repo)
    if "error" in chk:
        return {"error": chk["error"]}
    if not chk["fits"]:
        return {"error": f"not enough disk: model {chk['total_gb']} GB, "
                         f"only {chk['free_gb']} GB free (need a 10 GB buffer)"}
    os.makedirs(CFG_DIR, exist_ok=True)
    logpath = os.path.join(CFG_DIR, "hf-" + repo.replace("/", "_") + ".log")
    log = open(logpath, "wb")
    proc = subprocess.Popen([HF_BIN, "download", repo],
                            stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    with DL_LOCK:
        DOWNLOADS[repo] = {"total": chk["total_bytes"], "proc": proc, "pid": proc.pid,
                           "log": logpath, "state": "downloading"}
        _persist_downloads_locked()
    return {"ok": True, "msg": f"downloading {repo} ({chk['total_gb']} GB)"}


def hf_downloads_status():
    out = []
    changed = False
    with DL_LOCK:
        items = list(DOWNLOADS.items())
    for repo, d in items:
        cur = _dir_size(_repo_dir(repo))
        if d["state"] == "canceled":
            state, pct = "canceled", 0
        else:
            proc = d.get("proc")
            alive = (proc.poll() is None) if proc is not None else _pid_alive(d.get("pid"))
            if alive:
                state = "downloading"
                pct = min(99, round(cur / d["total"] * 100)) if d["total"] else 0
            else:
                # process is gone — trust on-disk size (not dir-exists, which can
                # be true for a half-finished download) to decide done vs error
                complete = d["total"] and cur >= d["total"] * 0.98
                if complete:
                    state, pct = "done", 100
                else:
                    state = "error"
                    pct = min(99, round(cur / d["total"] * 100)) if d["total"] else 0
        if d.get("state") != state:
            d["state"] = state
            changed = True
        out.append({"repo": repo, "state": state, "pct": pct,
                    "total_gb": round(d["total"] / 1024**3, 1) if d["total"] else 0,
                    "done_gb": round(cur / 1024**3, 1)})
    if changed:
        with DL_LOCK:
            _persist_downloads_locked()
    return out


def hf_cancel(repo):
    with DL_LOCK:
        d = DOWNLOADS.get(repo)
        if not d:
            return {"ok": True, "msg": "not downloading"}
        d["state"] = "canceled"
        pid = d.get("pid")
        proc = d.get("proc")
        _persist_downloads_locked()
    try:
        os.killpg(os.getpgid(proc.pid if proc else pid), signal.SIGTERM)
    except Exception:
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
    return {"ok": True, "msg": f"canceled {repo}"}


def hf_dismiss(repo):
    with DL_LOCK:
        DOWNLOADS.pop(repo, None)
        _persist_downloads_locked()
    return {"ok": True}


def model_delete(model, backend):
    """Remove a local model. Refuses to delete the active selection."""
    st = read_state()
    if model == st["model"] and backend == st["backend"]:
        return {"error": "that's the active model — switch to another first"}
    if backend == "ollama":
        r = subprocess.run([OLLAMA_BIN, "rm", model],
                           capture_output=True, text=True)
        if r.returncode != 0:
            return {"error": r.stderr.strip() or "ollama rm failed"}
        return {"ok": True, "msg": f"deleted {model}"}
    # mlx: remove the HuggingFace cache directory for this repo
    d = _repo_dir(model)
    if not (os.path.isdir(d) and os.path.basename(d).startswith("models--")
            and os.path.realpath(d).startswith(os.path.realpath(HF_HUB))):
        return {"error": "model not found in cache"}
    freed = round(_dir_size(d) / 1024**3, 1)
    shutil.rmtree(d, ignore_errors=True)
    return {"ok": True, "msg": f"deleted {model} (freed ~{freed} GB)"}


# ---------- embedded terminals (stdlib pty + hand-rolled websocket) ----------
def _term_token(sid):
    return hmac.new(TERM_SECRET, sid.encode(), hashlib.sha256).hexdigest()


def _term_token_ok(sid, tok):
    return bool(tok) and hmac.compare_digest(_term_token(sid), tok)


def _term_command(kind):
    """Enum -> argv. The client NEVER supplies a command string."""
    if kind == "shell":
        return [SHELL, "-l"]
    if kind == "launcher":
        if os.path.isfile(CLAUDE_LOCAL) and os.access(CLAUDE_LOCAL, os.X_OK):
            return [CLAUDE_LOCAL]
        return None
    if kind == "hosted":                 # hosted Claude Code (real Anthropic service)
        cb = shutil.which("claude")
        return [cb] if cb else None
    return None


def _set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def term_launch(kind, cwd=None, launcher=None):
    cmd = _term_command(kind)
    if cmd is None:
        return {"error": "unknown session kind"}
    if launcher and launcher not in LAUNCHERS:
        return {"error": "unknown launcher"}
    sid = secrets.token_hex(8)
    os.makedirs(TERM_DIR, exist_ok=True)
    pid, master_fd = pty.fork()
    if pid == 0:  # child: pty.fork already did setsid + dup2 slave->0/1/2
        try:
            if cwd:
                d = os.path.expanduser(cwd)     # allow ~/project paths
                if os.path.isdir(d):
                    os.chdir(d)
            env = dict(os.environ, TERM="xterm-256color")
            if launcher:                       # override claude-local's launcher for this session
                env["SLIPWAY_LAUNCHER"] = launcher
            if kind == "hosted":               # regular Claude Code subscription — strip any local redirect
                for k in ("ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
                          "ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL"):
                    env.pop(k, None)
            os.execvpe(cmd[0], cmd, env)
        except Exception:
            os._exit(127)
    _set_winsize(master_fd, 24, 80)
    if kind == "shell":
        label = "shell"
    elif kind == "hosted":
        label = "Claude Code (hosted)"
    else:
        label = "claude-local · " + launcher if launcher else "claude-local"
    st = read_state()
    entry = {"id": sid, "pid": pid, "master_fd": master_fd, "kind": kind,
             "label": label, "cols": 80, "rows": 24, "created": time.time(),
             "alive": True, "token": _term_token(sid), "launcher": launcher or "",
             "model": st.get("model", ""), "backend": st.get("backend", ""),
             "transcript": os.path.join(TERM_DIR, sid + ".log"), "cwd": cwd or ""}
    with TERM_LOCK:
        TERMINALS[sid] = entry
    _term_history_add(entry)            # persist metadata so History survives panel restarts
    return {"ok": True, "id": sid, "token": entry["token"], "label": label}


def _term_reap(sid):
    with TERM_LOCK:
        e = TERMINALS.get(sid)
        if not e:
            return
        was_alive = e["alive"]
        e["alive"] = False
        fd, pid = e["master_fd"], e["pid"]
        e["master_fd"] = None
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass
    if pid:
        try:
            os.waitpid(pid, os.WNOHANG)
        except (ChildProcessError, OSError):
            pass
    if was_alive:
        # Stamp when the session was noticed dead (lazy — reap fires on kill/WS-EOF/list
        # sweeps, not the exact exit instant). Flows into /api/term/history via **r.
        _term_history_update(sid, {"ended": time.time()})


def term_kill(sid):
    with TERM_LOCK:
        e = TERMINALS.get(sid)
        if not e:
            return {"ok": True, "msg": "gone"}
        pid, alive = e["pid"], e["alive"]
    if alive and pid:
        try:
            os.killpg(pid, signal.SIGTERM)   # pgid == pid (setsid)
        except OSError:
            pass

        def _esc():
            time.sleep(TERM_KILL_GRACE)
            try:
                os.kill(pid, 0)
                os.killpg(pid, signal.SIGKILL)
            except OSError:
                pass
            _term_reap(sid)
        threading.Thread(target=_esc, daemon=True).start()
    else:
        _term_reap(sid)
    return {"ok": True, "msg": "killed"}


def term_list():
    out = []
    with TERM_LOCK:
        items = list(TERMINALS.items())
    for sid, e in items:
        alive = e["alive"] and _pid_alive(e["pid"])
        if not alive and e["alive"]:
            _term_reap(sid)
        out.append({"id": sid, "label": e["label"], "kind": e["kind"],
                    "cols": e["cols"], "rows": e["rows"],
                    "created": e["created"], "alive": alive, "cwd": e.get("cwd", "")})
    return out


# ---- session history (persisted metadata + transcripts, survive panel restarts) ----
TERM_INDEX = os.path.join(TERM_DIR, "index.json")
# The index has two writers (add on launch, update on reap) firing from different threads
# (ThreadingHTTPServer handlers, the kill-grace timer). Serialize + write atomically so a race
# can't tear a read (→ the whole 200-row history wiped) or drop a row.
_TERM_INDEX_LOCK = threading.Lock()


def _iso_now():
    """UTC timestamp in ISO-8601 with a trailing Z (e.g. 2026-07-02T18:04:31Z)."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _term_index_write(data):
    """Atomic replace so no reader ever sees a half-written index."""
    tmp = TERM_INDEX + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, TERM_INDEX)


def _term_history_add(entry):
    """Append a session's metadata to the on-disk index (newest wins, capped)."""
    rec = {k: entry.get(k) for k in ("id", "kind", "label", "launcher", "model",
                                     "backend", "cwd", "created")}
    try:
        os.makedirs(TERM_DIR, exist_ok=True)
        with _TERM_INDEX_LOCK:
            try:
                with open(TERM_INDEX) as f:
                    data = json.load(f)
            except Exception:
                data = []
            data = [r for r in data if r.get("id") != rec["id"]]
            data.append(rec)
            data = data[-200:]                    # keep the last 200 sessions
            _term_index_write(data)
    except Exception:
        pass


def _term_history_update(sid, fields):
    """Update one session's row in the on-disk index (best-effort, like _term_history_add)."""
    try:
        with _TERM_INDEX_LOCK:
            with open(TERM_INDEX) as f:
                data = json.load(f)
            for r in data:
                if r.get("id") == sid:
                    r.update(fields)
                    break
            else:
                return
            _term_index_write(data)
    except Exception:
        pass


def term_history():
    """Past sessions, newest first, each with whether its transcript is on disk."""
    try:
        with open(TERM_INDEX) as f:
            data = json.load(f)
    except Exception:
        data = []
    alive_ids = set()
    with TERM_LOCK:
        alive_ids = {sid for sid, e in TERMINALS.items()
                     if e["alive"] and _pid_alive(e["pid"])}
    out = []
    for r in reversed(data):
        tpath = os.path.join(TERM_DIR, str(r.get("id", "")) + ".log")
        size = os.path.getsize(tpath) if os.path.isfile(tpath) else 0
        # archived is a rail-VISIBILITY flag only; default False for rows written
        # before archiving existed. Never affects the transcript/graph provenance.
        out.append({**r, "alive": r.get("id") in alive_ids,
                    "archived": bool(r.get("archived")),
                    "archived_at": r.get("archived_at"),
                    "transcript_bytes": size})
    return out


def term_archive(sid, archived):
    """Toggle one session's rail-visibility archive flag (never deletes anything)."""
    if not re.fullmatch(r"[0-9a-f]{1,32}", sid or ""):
        return {"error": "bad id"}
    archived = bool(archived)
    fields = {"archived": archived,
              "archived_at": _iso_now() if archived else None}
    _term_history_update(sid, fields)
    return {"ok": True, "id": sid, **fields}


def term_archive_ended():
    """Bulk-archive every ended/dead session; live sessions are left untouched."""
    with TERM_LOCK:
        alive_ids = {sid for sid, e in TERMINALS.items()
                     if e["alive"] and _pid_alive(e["pid"])}
    now = _iso_now()
    changed = []
    try:
        with _TERM_INDEX_LOCK:
            try:
                with open(TERM_INDEX) as f:
                    data = json.load(f)
            except Exception:
                data = []
            for r in data:
                sid = r.get("id")
                if sid and sid not in alive_ids and not r.get("archived"):
                    r["archived"] = True
                    r["archived_at"] = now
                    changed.append(sid)
            if changed:
                _term_index_write(data)
    except Exception:
        pass
    return {"ok": True, "archived": changed, "count": len(changed)}


def term_transcript(sid):
    """Return a session's transcript text (id sanitized; last ~256 KB)."""
    if not re.fullmatch(r"[0-9a-f]{1,32}", sid or ""):
        return {"error": "bad id"}
    tpath = os.path.join(TERM_DIR, sid + ".log")
    if not os.path.isfile(tpath):
        return {"error": "no transcript"}
    try:
        with open(tpath, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 256 * 1024))
            data = f.read()
        return {"ok": True, "text": data.decode("utf-8", "replace"),
                "truncated": size > 256 * 1024}
    except Exception as e:
        return {"error": str(e)}


def term_attach(sid):
    """Re-issue a token for a still-live session (e.g. modal reopened)."""
    with TERM_LOCK:
        e = TERMINALS.get(sid)
        if not e or not e["alive"]:
            return {"error": "no live session"}
        return {"ok": True, "token": e["token"], "label": e["label"]}


def _origin_ok(origin):
    return origin in (f"http://127.0.0.1:{PANEL_PORT}", f"http://localhost:{PANEL_PORT}")


# ---------- http ----------
def asset_version():
    """Cache-buster for /static asset URLs: newest mtime of the css/js bundle.
    Any edit/upgrade changes the query string, so stale tabs can't pin old JS."""
    try:
        return str(int(max(os.path.getmtime(os.path.join(STATIC_DIR, f))
                           for f in os.listdir(STATIC_DIR)
                           if f.endswith((".css", ".js")))))
    except (OSError, ValueError):
        return "0"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json", cache=None):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if cache:
            self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    # ---- static assets (panel UI, vendored xterm.js etc.) ----
    def _serve_static(self, path, prefix, base_dir, cache=None):
        rel = urllib.parse.unquote(urllib.parse.urlparse(path).path[len(prefix):])
        full = os.path.realpath(os.path.join(base_dir, rel))
        if not full.startswith(os.path.realpath(base_dir) + os.sep) or not os.path.isfile(full):
            return self._send(404, json.dumps({"error": "not found"}))
        ctype = {".js": "application/javascript", ".css": "text/css",
                 ".html": "text/html; charset=utf-8",
                 ".woff2": "font/woff2",
                 ".map": "application/json"}.get(os.path.splitext(full)[1],
                                                 "application/octet-stream")
        with open(full, "rb") as f:
            return self._send(200, f.read(), ctype, cache)

    # ---- websocket terminal relay ----
    def _term_ws(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        sid = q.get("id", [""])[0]
        tok = q.get("token", [""])[0]
        origin = self.headers.get("Origin", "")
        if origin and not _origin_ok(origin):
            return self._send(403, json.dumps({"error": "bad origin"}))
        key = self.headers.get("Sec-WebSocket-Key", "")
        if self.headers.get("Upgrade", "").lower() != "websocket" or not key:
            return self._send(400, json.dumps({"error": "not a ws upgrade"}))
        with TERM_LOCK:
            e = TERMINALS.get(sid)
        if not e or not e["alive"] or not _term_token_ok(sid, tok):
            return self._send(403, json.dumps({"error": "bad session/token"}))
        accept = base64.b64encode(hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        self._ws_relay(e)

    def _ws_relay(self, e):
        sock = self.connection
        fd = e["master_fd"]
        sid = e["id"]
        try:
            tlog = open(e["transcript"], "ab")
        except Exception:
            tlog = None
        sock.setblocking(True)
        buf = b""
        try:
            while True:
                try:
                    r, _, _ = select.select([sock, fd], [], [], 30)
                except (OSError, ValueError):
                    break
                if fd in r:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        data = b""
                    if not data:
                        self._ws_send(sock, b"", 0x8)
                        break
                    if tlog:
                        try:
                            tlog.write(data)
                            tlog.flush()
                        except Exception:
                            pass
                    self._ws_send(sock, data, 0x2)
                if sock in r:
                    try:
                        chunk = sock.recv(65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    buf += chunk
                    msgs, buf = self._ws_frames(buf)
                    stop = False
                    for op, payload in msgs:
                        if op == 0x8:
                            self._ws_send(sock, b"", 0x8)
                            stop = True
                            break
                        if op == 0x9:
                            self._ws_send(sock, payload, 0xA)
                            continue
                        if op == 0xA:
                            continue
                        self._handle_client_msg(e, op, payload)
                    if stop:
                        break
                if not r:
                    self._ws_send(sock, b"", 0x9)   # idle keepalive ping
        finally:
            if tlog:
                try:
                    tlog.close()
                except Exception:
                    pass
            # dropping the relay does NOT kill the child (view != process)

    def _handle_client_msg(self, e, op, payload):
        fd = e["master_fd"]
        if fd is None:
            return
        if op == 0x2:  # binary = keystrokes
            try:
                os.write(fd, payload)
            except OSError:
                pass
        elif op == 0x1:  # text = JSON control
            try:
                msg = json.loads(payload)
            except Exception:
                return
            if msg.get("t") == "resize":
                cols = int(msg.get("cols", 80))
                rows = int(msg.get("rows", 24))
                e["cols"], e["rows"] = cols, rows
                _set_winsize(fd, rows, cols)

    def _ws_frames(self, buf):
        """Return (list of complete (opcode,payload), remaining buf). Reassembles fragments."""
        out = []
        frag_op = None
        frag_data = b""
        while True:
            if len(buf) < 2:
                break
            b0, b1 = buf[0], buf[1]
            fin = b0 & 0x80
            opcode = b0 & 0x0f
            masked = b1 & 0x80
            ln = b1 & 0x7f
            idx = 2
            if ln == 126:
                if len(buf) < 4:
                    break
                ln = struct.unpack(">H", buf[2:4])[0]
                idx = 4
            elif ln == 127:
                if len(buf) < 10:
                    break
                ln = struct.unpack(">Q", buf[2:10])[0]
                idx = 10
            if not masked:
                out.append((0x8, b""))   # client frames MUST be masked
                return out, b""
            if len(buf) < idx + 4 + ln:
                break
            mask = buf[idx:idx + 4]
            idx += 4
            raw = buf[idx:idx + ln]
            idx += ln
            payload = bytes(raw[i] ^ mask[i & 3] for i in range(ln))
            buf = buf[idx:]
            if opcode == 0x0:                 # continuation
                frag_data += payload
                if fin:
                    out.append((frag_op, frag_data))
                    frag_op, frag_data = None, b""
            elif opcode in (0x1, 0x2):
                if fin:
                    out.append((opcode, payload))
                else:
                    frag_op, frag_data = opcode, payload
            else:                             # control frame
                out.append((opcode, payload))
        return out, buf

    def _ws_send(self, sock, data, opcode=0x2):
        hdr = bytearray([0x80 | opcode])
        n = len(data)
        if n < 126:
            hdr.append(n)
        elif n < 65536:
            hdr.append(126)
            hdr += struct.pack(">H", n)
        else:
            hdr.append(127)
            hdr += struct.pack(">Q", n)
        try:
            sock.sendall(bytes(hdr) + data)
        except OSError:
            raise

    def do_GET(self):
        if self.path.startswith("/api/term/ws"):
            return self._term_ws()
        if self.path.startswith("/vendor/"):
            # vendored libs never change in place → let the browser keep them
            return self._serve_static(self.path, "/vendor/", VENDOR_DIR,
                                      "public, max-age=31536000, immutable")
        if self.path.startswith("/static/"):
            # panel assets DO change in place → always revalidate (plus the
            # ?v= mtime query on the HTML references busts old cache entries)
            return self._serve_static(self.path, "/static/", STATIC_DIR, "no-cache")
        # "/" may carry embed/theme query params (?embed=1&mode=…, from the Studio iframe)
        if self.path == "/" or self.path.startswith("/?") or self.path.startswith("/index"):
            # read from disk per request so panel.html edits show on refresh
            with open(os.path.join(STATIC_DIR, "panel.html"), "rb") as f:
                html = f.read().replace(b"__V__", asset_version().encode())
            return self._send(200, html, "text/html; charset=utf-8", "no-cache")
        if self.path == "/api/status":
            return self._send(200, json.dumps(status()))
        if self.path == "/api/models":
            return self._send(200, json.dumps({"models": list_models()}))
        if self.path == "/api/logs":
            return self._send(200, json.dumps({"log": tail_log()}))
        if self.path.startswith("/api/hf/search"):
            q = urllib.parse.urlparse(self.path)
            p = urllib.parse.parse_qs(q.query)
            return self._send(200, json.dumps(hf_search(
                p.get("q", [""])[0], p.get("mlx_only", ["1"])[0] != "0")))
        if self.path == "/api/hf/downloads":
            return self._send(200, json.dumps({"downloads": hf_downloads_status()}))
        if self.path == "/api/cloud":
            return self._send(200, json.dumps({"providers": cloud_providers_view()}))
        if self.path == "/api/launchers":
            return self._send(200, json.dumps({"launchers": launchers_view()}))
        if self.path == "/api/launcher/install/status":
            return self._send(200, json.dumps(hermes_install_status()))
        if self.path == "/api/term/list":
            return self._send(200, json.dumps({"terminals": term_list()}))
        if self.path == "/api/term/history":
            return self._send(200, json.dumps({"sessions": term_history()}))
        if self.path.startswith("/api/term/transcript"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self._send(200, json.dumps(term_transcript(q.get("id", [""])[0])))
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if self.path == "/api/start":
            return self._send(200, json.dumps(start()))
        if self.path == "/api/stop":
            return self._send(200, json.dumps(stop()))
        if self.path == "/api/restart":
            return self._send(200, json.dumps(restart()))
        if self.path == "/api/unload-all":
            return self._send(200, json.dumps(unload_all()))
        if self.path == "/api/switch":
            b = self._body()
            if not b.get("model") or not b.get("backend"):
                return self._send(400, json.dumps({"error": "model+backend required"}))
            return self._send(200, json.dumps(
                switch(b["model"], b["backend"], b.get("provider"))))
        if self.path == "/api/cloud/save":
            b = self._body()
            return self._send(200, json.dumps(write_cloud(
                b.get("provider", ""), b.get("key", ""),
                b.get("models", []), b.get("enabled", False))))
        if self.path == "/api/launcher/select":
            return self._send(200, json.dumps(set_launcher(self._body().get("launcher", ""))))
        if self.path == "/api/launcher/install":
            return self._send(200, json.dumps(hermes_install_start()))
        if self.path == "/api/term/launch":
            if self.headers.get("Origin") and not _origin_ok(self.headers.get("Origin")):
                return self._send(403, json.dumps({"error": "bad origin"}))
            b = self._body()
            if b.get("kind") not in ("shell", "launcher", "hosted"):
                return self._send(400, json.dumps({"error": "kind must be shell|launcher|hosted"}))
            return self._send(200, json.dumps(term_launch(b["kind"], b.get("cwd"), b.get("launcher"))))
        if self.path == "/api/term/kill":
            return self._send(200, json.dumps(term_kill(self._body().get("id", ""))))
        if self.path == "/api/term/attach":
            return self._send(200, json.dumps(term_attach(self._body().get("id", ""))))
        if self.path == "/api/term/archive":
            b = self._body()
            if not b.get("id"):
                return self._send(400, json.dumps({"error": "id required"}))
            return self._send(200, json.dumps(
                term_archive(b["id"], b.get("archived", True))))
        if self.path == "/api/term/archive-ended":
            return self._send(200, json.dumps(term_archive_ended()))
        if self.path == "/api/hf/size":
            repo = self._body().get("repo")
            return self._send(200, json.dumps(hf_size_check(repo)) if repo
                              else json.dumps({"error": "repo required"}))
        if self.path == "/api/hf/download":
            repo = self._body().get("repo")
            return self._send(200, json.dumps(hf_download_start(repo)) if repo
                              else json.dumps({"error": "repo required"}))
        if self.path == "/api/hf/cancel":
            return self._send(200, json.dumps(hf_cancel(self._body().get("repo", ""))))
        if self.path == "/api/hf/dismiss":
            return self._send(200, json.dumps(hf_dismiss(self._body().get("repo", ""))))
        if self.path == "/api/model/delete":
            b = self._body()
            if not b.get("model") or not b.get("backend"):
                return self._send(400, json.dumps({"error": "model+backend required"}))
            return self._send(200, json.dumps(model_delete(b["model"], b["backend"])))
        if self.path == "/api/quit":
            also_stop = self._body().get("stop_server")
            self._send(200, json.dumps({"ok": True, "msg": "bye"}))
            def shutdown():
                time.sleep(0.4)
                for sid in list(TERMINALS.keys()):   # end terminal sessions on quit
                    term_kill(sid)
                if also_stop:
                    stop()
                if HTTPD:
                    HTTPD.shutdown()
            threading.Thread(target=shutdown, daemon=True).start()
            return
        self._send(404, json.dumps({"error": "not found"}))


if __name__ == "__main__":
    os.makedirs(CFG_DIR, exist_ok=True)
    if not os.path.exists(STATE_FILE):
        write_state(DEFAULT["model"], DEFAULT["backend"])
    load_downloads_registry()
    print(f"Slipway → http://127.0.0.1:{PANEL_PORT}")
    HTTPD = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Handler)
    HTTPD.serve_forever()
