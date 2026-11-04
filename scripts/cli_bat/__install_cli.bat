start npm install -g @anthropic-ai/claude-code
start npm install -g @openai/codex
start "OpenCode installer" node "%~dp0install_opencode.mjs"
start "Antigravity CLI installer" cmd /d /s /c ""%~dp0install_antigravity.bat""
start npm install -g @github/copilot
rem Grok Build CLI (xai-org/grok-build, command: grok)
start "Grok Build CLI installer" powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://x.ai/cli/install.ps1 | iex"
