"""ドラッグ境界と解放保証。GUI・待機・通信は実行しない。Windows専用。"""
import asyncio
import logging
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform != "win32":
    raise unittest.SkipTest("Windows操作モジュールの試験")

from tools_proc import windows_control as impl
import log_config
with patch.object(log_config, "get_logger", side_effect=logging.getLogger):
    from tools_proc import tools_windows_control as api
from fastapi import FastAPI
import httpx
from mcp.server.mcpserver import MCPServer


class DragTests(unittest.TestCase):
    def setUp(self):
        self.gui = Mock()
        self.events = Mock()
        self.events.attach_mock(self.gui, "gui")
        self.gui_patch = patch.object(impl, "pyautogui", self.gui)
        self.gui_patch.start()
        self.addCleanup(self.gui_patch.stop)
        self.sleep_patch = patch.object(impl, "time")
        self.sleep = self.sleep_patch.start().sleep
        self.addCleanup(self.sleep_patch.stop)
        self.events.attach_mock(self.sleep, "sleep")
        self.wc = impl.WindowsControl()

    def test_default_preserves_result_and_drag(self):
        self.assertEqual(self.wc.mouse_drag(10, 20, 30, 40),
                         {"from": [10, 20], "to": [30, 40], "button": "left"})
        self.assertEqual(self.events.mock_calls, [call.gui.moveTo(10, 20),
            call.gui.dragTo(30, 40, duration=0.2, button="left")])

    def test_hold_order_and_independent_move_time(self):
        self.wc.mouse_long_press_drag(10, 20, 30, 40, "right", 0, 0.8)
        self.assertEqual(self.events.mock_calls, [call.gui.moveTo(10, 20),
            call.gui.mouseDown(button="right"), call.sleep(0.8),
            call.gui.moveTo(30, 40, duration=0), call.gui.mouseUp(button="right")])

    def test_release_on_down_sleep_and_move_error(self):
        for stage in ("down", "sleep", "move"):
            with self.subTest(stage=stage):
                self.gui.reset_mock(side_effect=True)
                self.sleep.reset_mock(side_effect=True)
                if stage == "down":
                    self.gui.mouseDown.side_effect = RuntimeError("down")
                elif stage == "sleep":
                    self.sleep.side_effect = RuntimeError("sleep")
                elif stage == "move":
                    self.gui.moveTo.side_effect = [None, RuntimeError("move")]
                with self.assertRaises(RuntimeError):
                    self.wc.mouse_long_press_drag(1, 2, 3, 4, hold_duration=0.8)
                self.gui.mouseUp.assert_called_once_with(button="left")

    def test_invalid_input_never_touches_mouse(self):
        for field, values in (("hold_duration", [-1, 10.01, float("nan"), float("inf"), None, True, "1"]),
                              ("duration", [-1, 60.01, float("nan"), float("inf"), None, True]),
                              ("button", ["invalid"]), ("x1", [None, True, 1.5])):
            for value in values:
                with self.subTest(field=field, value=value):
                    args = dict(x1=1, y1=2, x2=3, y2=4)
                    args[field] = value
                    with self.assertRaises(impl.WindowsControlError):
                        self.wc.mouse_long_press_drag(**args)
        self.gui.assert_not_called()
        self.assertEqual(self.gui.mock_calls, [])
        self.sleep.assert_not_called()

    def test_inclusive_time_limits(self):
        self.wc.mouse_long_press_drag(-10, 20, 30, 40, duration=60, hold_duration=10)
        self.sleep.assert_called_once_with(10)
        self.gui.moveTo.assert_called_with(30, 40, duration=60)

    def test_http_default_zero_duration_hold_and_rejection(self):
        app = FastAPI()
        app.include_router(api.create_router(self.wc))
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                base = dict(x1=1, y1=2, x2=3, y2=4)
                self.assertEqual((await client.post("/aidiy_windows_control/mouse_drag", json=base)).status_code, 200)
                self.gui.dragTo.assert_called_with(3, 4, duration=0.2, button="left")
                self.gui.reset_mock()
                response = await client.post("/aidiy_windows_control/mouse_long_press_drag", json={**base, "duration": 0, "hold_duration": 0.8})
                self.assertEqual(response.json()["to"], [3, 4])
                self.gui.moveTo.assert_called_with(3, 4, duration=0)
                self.sleep.assert_called_once_with(0.8)
                self.gui.reset_mock()
                self.assertEqual((await client.post("/aidiy_windows_control/mouse_long_press_drag", json={**base, "hold_duration": 11})).status_code, 422)
                response = await client.post("/aidiy_windows_control/mouse_long_press_drag", json={**base, "duration": -1})
                self.assertIn("error", response.json())
                self.assertEqual(self.gui.mock_calls, [])
        asyncio.run(run())

    def test_mcp_schema_and_dispatch(self):
        mcp = MCPServer("drag-test")
        api.register_tools(mcp, self.wc)
        tool = mcp._tool_manager._tools["mouse_long_press_drag"]
        schema = tool.parameters
        self.assertEqual(schema["properties"]["hold_duration"]["default"], 0.8)
        self.assertEqual(schema["properties"]["hold_duration"]["maximum"], 10)
        self.assertNotIn("hold_duration", schema.get("required", []))
        self.assertNotIn("hold_duration", mcp._tool_manager._tools["mouse_drag"].parameters["properties"])
        async def run():
            await mcp._tool_manager.call_tool("mouse_long_press_drag", {"x1": 1, "y1": 2, "x2": 3, "y2": 4, "hold_duration": 0.8}, context=None)
        asyncio.run(run())
        self.sleep.assert_called_once_with(0.8)
        self.gui.mouseUp.assert_called_once_with(button="left")


if __name__ == "__main__":
    unittest.main()
