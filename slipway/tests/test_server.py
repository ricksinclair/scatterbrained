# test_server.py — unit tests for the 2026-07-04 bugfix batch (stdlib unittest, no deps).
# Run: python3 -m unittest discover tests
import os
import sys
import time
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402


class TempPaths(unittest.TestCase):
    """Redirect the state/marker/error/log paths into a temp dir per test."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.marker = os.path.join(self.tmp.name, ".starting")
        self.err = os.path.join(self.tmp.name, "last-error")
        self.log = os.path.join(self.tmp.name, "server.log")
        self._patches = [
            mock.patch.object(server, "MARKER", self.marker),
            mock.patch.object(server, "ERR_FILE", self.err),
            mock.patch.object(server, "LOG_FILE", self.log),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        self.tmp.cleanup()


class MarkerAge(TempPaths):
    def test_no_marker_is_none(self):
        self.assertIsNone(server.marker_age())

    def test_fresh_marker_counts_as_starting(self):
        open(self.marker, "w").close()
        self.assertTrue(server.proc_present({"backend": "ollama"}))

    def test_stale_marker_no_longer_counts(self):
        open(self.marker, "w").close()
        old = time.time() - server.MARKER_MAX_AGE - 10
        os.utime(self.marker, (old, old))
        self.assertFalse(server.proc_present({"backend": "ollama"}))


class LastError(TempPaths):
    def test_round_trip_and_clear(self):
        server.set_last_error("boom")
        self.assertEqual(server.get_last_error(), "boom")
        server.clear_last_error()
        self.assertIsNone(server.get_last_error())

    def test_mlx_log_error_finds_last_error_line(self):
        with open(self.log, "w") as f:
            f.write("loading weights\nSome info\nError: model not found on disk\nshutting down\n")
        self.assertIn("model not found", server.mlx_log_error())

    def test_warm_ollama_failure_is_captured_not_swallowed(self):
        with mock.patch.object(server.urllib.request, "urlopen", side_effect=OSError("connection refused")):
            server.warm_ollama("ghost:1b")
        self.assertIn("ghost:1b", server.get_last_error())

    def test_warm_ollama_sends_the_context_cap(self):
        seen = {}

        def fake_urlopen(req, timeout=None):
            import json
            seen.update(json.loads(req.data))
            return mock.MagicMock()

        with mock.patch.object(server.urllib.request, "urlopen", fake_urlopen):
            server.warm_ollama("m")
        self.assertEqual(seen["options"]["num_ctx"], server.NUM_CTX)
        self.assertEqual(seen["keep_alive"], "30m")


class UnloadAllHonesty(TempPaths):
    def _run(self, ps_sequence, stop_rc=0, stderr="", live=()):
        """Drive unload_all with scripted ollama_ps() results (called twice: before + re-poll)."""
        seq = list(ps_sequence)
        with mock.patch.object(server, "ollama_ps", side_effect=lambda: dict(seq.pop(0)) if seq else {}), \
             mock.patch.object(server, "mlx_pid", return_value=None), \
             mock.patch.object(server, "term_list", return_value=list(live)), \
             mock.patch.object(server.subprocess, "run",
                               return_value=mock.MagicMock(returncode=stop_rc, stderr=stderr, stdout="")), \
             mock.patch.object(server.time, "sleep"):
            return server.unload_all()

    def test_clean_unload_reports_freed(self):
        out = self._run([{"m1": "5 GB"}, {}])
        self.assertTrue(out["ok"])
        self.assertEqual(out["freed"], ["m1"])
        self.assertEqual(out["reloaded"], [])
        self.assertIn("freed m1", out["msg"])

    def test_failed_stop_is_not_reported_as_freed(self):
        out = self._run([{"m1": "5 GB"}, {}], stop_rc=1, stderr="permission denied")
        self.assertFalse(out["ok"])
        self.assertEqual(out["freed"], [])
        self.assertIn("permission denied", out["msg"])

    def test_reload_by_live_agent_is_named(self):
        live = [{"alive": True, "kind": "launcher"}]
        out = self._run([{"m1": "5 GB"}, {"m1": "5 GB"}], live=live)
        self.assertEqual(out["reloaded"], ["m1"])
        self.assertEqual(out["live_sessions"], 1)
        self.assertIn("reloaded immediately by a live agent session", out["msg"])

    def test_nothing_loaded(self):
        out = self._run([{}, {}])
        self.assertTrue(out["ok"])
        self.assertIn("nothing was loaded", out["msg"])




class PortHonesty(TempPaths):
    """MLX_PORT can be squatted by a foreign app (a SPA dev server 200s every path) —
    the API check must not be fooled, and start() must name the collision."""

    def _urlopen_returning(self, body, status=200):
        m = mock.MagicMock()
        m.__enter__ = lambda s2: s2
        m.__exit__ = mock.MagicMock(return_value=False)
        m.status = status
        m.read.return_value = body
        return m

    def test_spa_html_is_not_a_model_server(self):
        with mock.patch.object(server.urllib.request, "urlopen",
                               return_value=self._urlopen_returning(b"<!DOCTYPE html><html>app</html>")):
            self.assertFalse(server._mlx_api_ok())
            self.assertTrue(server.port_squatter())

    def test_real_models_api_passes(self):
        with mock.patch.object(server.urllib.request, "urlopen",
                               return_value=self._urlopen_returning(b'{"object":"list","data":[]}')):
            self.assertTrue(server._mlx_api_ok())
            self.assertFalse(server.port_squatter())

    def test_start_refuses_squatted_port_with_a_named_error(self):
        with mock.patch.object(server, "read_state",
                               return_value={"model": "m", "backend": "mlx"}), \
             mock.patch.object(server, "is_serving", return_value=False), \
             mock.patch.object(server, "proc_present", return_value=False), \
             mock.patch.object(server, "mlx_pid", return_value=None), \
             mock.patch.object(server, "port_squatter", return_value=True), \
             mock.patch.object(server.os, "makedirs"):
            out = server.start()
        self.assertFalse(out["ok"])
        self.assertIn("occupied by another app", out["msg"])
        self.assertIn("occupied", server.get_last_error())

    def _mlx_start_ctx(self):
        """Common mocks for an mlx start(): not serving, no live vllm, port free."""
        return [
            mock.patch.object(server, "read_state",
                              return_value={"model": "m", "backend": "mlx"}),
            mock.patch.object(server, "is_serving", return_value=False),
            mock.patch.object(server, "mlx_pid", return_value=None),
            mock.patch.object(server, "port_squatter", return_value=False),
            mock.patch.object(server.os, "makedirs"),
            mock.patch.object(server.subprocess, "Popen",
                              return_value=mock.Mock(pid=999)),
        ]

    def test_stale_marker_no_pid_respawns_not_wedged(self):
        # A marker left by a load that already died (age > 5s, no vllm pid) must NOT wedge
        # the retry with "already starting…" — it should clear the stale marker and respawn.
        open(self.marker, "w").close()
        old = time.time() - 60
        os.utime(self.marker, (old, old))
        ctx = self._mlx_start_ctx()
        with ctx[0], ctx[1], ctx[2], ctx[3], ctx[4], ctx[5] as popen:
            out = server.start()
        self.assertTrue(out["ok"])
        self.assertIn("started mlx", out["msg"])
        popen.assert_called_once()

    def test_young_marker_no_pid_still_guards_double_spawn(self):
        # A just-created marker (<=5s) means a spawn just fired whose pid isn't pgrep-visible
        # yet — start() must still say "already starting…" and NOT spawn a second vllm.
        open(self.marker, "w").close()  # age ~0s
        ctx = self._mlx_start_ctx()
        with ctx[0], ctx[1], ctx[2], ctx[3], ctx[4], ctx[5] as popen:
            out = server.start()
        self.assertEqual(out["msg"], "already starting…")
        popen.assert_not_called()

if __name__ == "__main__":
    unittest.main()
