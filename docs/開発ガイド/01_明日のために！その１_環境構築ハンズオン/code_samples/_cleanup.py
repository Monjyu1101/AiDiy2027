# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""プロジェクトクリーンアップスクリプト

他の担当者にプロジェクトを渡す前に、
不要なキャッシュファイルやビルド成果物を削除します。

このサンプルは backend_server / frontend_web の2構成向けの学習用です。
現行 AiDiy の全階層 temp / _temp / .temp 整理は、リポジトリ直下の
`_cleanup.py` の `cleanup_temp_directories()` を参照してください。

Usage:
 python cleanup.py
"""

import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

# ============================================================
# プロジェクト設定
# ============================================================
# バックエンド設定
BACKEND_PATH = "backend_server" # バックエンドフォルダ名
BACKEND_ENV_LIST = [".venv", "venv"] # Python環境: ".venv" または "venv" (uv使用)

# フロントエンド設定
FRONTEND_PATH = "frontend_web" # フロントエンドフォルダパス

# データベース設定
DATABASE_TYPE = "sqlite" # "postgresql" or "sqlite"
SQLITE_DB_REL_PATH = Path("_data/AiDiy/database.db")

# a/auto 指定時に、以降の質問をデフォルト値で自動回答する
AUTO_MODE = False

# ============================================================


# カラー出力用のクラス
class Colors:
 HEADER = '\033[97m'
 OKBLUE = '\033[94m'
 OKCYAN = '\033[96m'
 OKGREEN = '\033[92m'
 WARNING = '\033[93m'
 FAIL = '\033[91m'
 ENDC = '\033[0m'
 BOLD = '\033[1m'
 UNDERLINE = '\033[4m'


def print_header(message):
 """ヘッダーを表示"""
 print(f"\n{Colors.HEADER}{Colors.BOLD}{'=' * 60}{Colors.ENDC}")
 print(f"{Colors.HEADER}{Colors.BOLD}{message}{Colors.ENDC}")
 print(f"{Colors.HEADER}{Colors.BOLD}{'=' * 60}{Colors.ENDC}\n")


def print_success(message):
 """成功メッセージを表示"""
 print(f"{Colors.OKBLUE}[OK] {message}{Colors.ENDC}")


def print_info(message):
 """情報メッセージを表示"""
 print(f"{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}")


def print_warning(message):
 """警告メッセージを表示"""
 print(f"{Colors.WARNING}[WARN] {message}{Colors.ENDC}")


def print_error(message):
 """エラーメッセージを表示"""
 print(f"{Colors.FAIL}[NG] {message}{Colors.ENDC}")


def ask_yes_no(prompt, default="n"):
 """Y/N の質問をする
 
 Args:
 prompt (str): 質問文
 default (str): デフォルト値 ("y" または "n")
 
 Returns:
 bool: Yesの場合True、Noの場合False
 """
 global AUTO_MODE

 if AUTO_MODE:
 print_info(f"[AUTO] {prompt} -> {'Yes' if default.lower() == 'y' else 'No'} (default)")
 return default.lower() == "y"

 if default == "y":
 prompt_text = f"\n{prompt}([y]/n): "
 else:
 prompt_text = f"\n{prompt}([n]/y): "
 
 while True:
 answer = input(prompt_text).strip().lower()
 
 if answer == "":
 answer = default
 
 if answer in ["y", "yes"]:
 return True
 elif answer in ["n", "no"]:
 return False
 else:
 print_warning("'y' または 'n' で答えてください")


def ask_start_mode(prompt, default="n"):
 """開始質問 (y/n/a) を表示して実行モードを取得

 Returns:
 tuple[bool, bool]: (実行するか, autoモードか)
 """
 if default.lower() == "y":
 prompt_text = f"\n{prompt}([y]/n/a=auto): "
 else:
 prompt_text = f"\n{prompt}([n]/y/a=auto): "

 while True:
 answer = input(prompt_text).strip().lower()

 if answer == "":
 answer = default.lower()

 if answer in ["y", "yes"]:
 return True, False
 if answer in ["n", "no"]:
 return False, False
 if answer in ["a", "auto"]:
 return True, True

 print_warning("'y' または 'n' または 'a'(auto) で答えてください")


def handle_remove_readonly(func, path, exc_info):
 """読み取り専用ファイルを削除できるようにする
 
 Args:
 func: 失敗した関数
 path: ファイルパス
 exc_info: 例外情報
 """
 # 読み取り専用属性を解除
 os.chmod(path, stat.S_IWRITE)
 # 再試行
 func(path)


def remove_directory(path, description):
 """ディレクトリを削除
 
 Args:
 path (Path): 削除するディレクトリのパス
 description (str): 説明文
 
 Returns:
 bool: 削除成功時True
 """
 if path.exists() and path.is_dir():
 try:
 # Windowsで読み取り専用ファイルも削除できるようにonerrorハンドラを指定
 shutil.rmtree(path, onerror=handle_remove_readonly)
 print_success(f"{description} を削除しました: {path}")
 return True
 except Exception as e:
 print_error(f"{description} の削除に失敗しました: {path}")
 print_error(f" 理由: {e}")
 print_warning(" ヒント: 管理者権限で実行するか、手動で削除してください")
 return False
 return False


def remove_file(path, description):
 """ファイルを削除

 Args:
 path (Path): 削除するファイルのパス
 description (str): 説明文

 Returns:
 bool: 削除成功時True
 """
 if path.exists() and path.is_file():
 try:
 if not os.access(path, os.W_OK):
 os.chmod(path, stat.S_IWRITE)
 path.unlink()
 print_success(f"{description} を削除しました: {path}")
 return True
 except Exception as e:
 print_error(f"{description} の削除に失敗しました: {path}")
 print_error(f" 理由: {e}")
 print_warning(" ヒント: 管理者権限で実行するか、手動で削除してください")
 return False
 return False


def clean_directory_contents(path, description):
 """ディレクトリの中身のみを削除(フォルダ自体は残す)
 
 Args:
 path (Path): クリーンアップするディレクトリのパス
 description (str): 説明文
 
 Returns:
 bool: 削除成功時True
 """
 if path.exists() and path.is_dir():
 try:
 deleted_count = 0
 # ディレクトリ内のすべてのファイルとサブディレクトリを削除
 for item in path.iterdir():
 if item.is_dir():
 shutil.rmtree(item, onerror=handle_remove_readonly)
 deleted_count += 1
 else:
 # 読み取り専用属性を解除してから削除
 if not os.access(item, os.W_OK):
 os.chmod(item, stat.S_IWRITE)
 item.unlink()
 deleted_count += 1
 
 if deleted_count > 0:
 print_success(f"{description} の中身を削除しました: {path} ({deleted_count}個)")
 else:
 print_info(f"{description} は空です: {path}")
 return True
 except Exception as e:
 print_error(f"{description} の中身削除に失敗しました: {path}")
 print_error(f" 理由: {e}")
 print_warning(" ヒント: 管理者権限で実行するか、手動で削除してください")
 return False
 return False


def cleanup_server(base_dir):
 """バックエンドフォルダをクリーンアップ
 
 Args:
 base_dir (Path): プロジェクトのルートディレクトリ
 """
 print_header("バックエンドフォルダのクリーンアップ")
 
 server_dir = base_dir / BACKEND_PATH
 if not server_dir.exists():
 print_warning("バックエンドフォルダが見つかりません")
 return
 
 deleted_count = 0
 
 # __pycache__ フォルダを削除
 print_info("__pycache__ フォルダを検索中...")
 for pycache in server_dir.rglob("__pycache__"):
 if remove_directory(pycache, "__pycache__"):
 deleted_count += 1
 
 # .pytest_cache フォルダを削除
 print_info(".pytest_cache フォルダを検索中...")
 for pytest_cache in server_dir.rglob(".pytest_cache"):
 if remove_directory(pytest_cache, ".pytest_cache"):
 deleted_count += 1
 
 # Python環境フォルダ削除の確認 (BACKEND_ENV_LIST に従う)
 print_info(f"削除対象の仮想環境リスト: {', '.join(BACKEND_ENV_LIST)}")
 for venv_name in BACKEND_ENV_LIST:
 venv_dir = server_dir / venv_name
 if venv_dir.exists():
 if ask_yes_no(f" {venv_name} フォルダを削除しますか？", default="y"):
 if remove_directory(venv_dir, venv_name):
 deleted_count += 1
 else:
 print_info(f" {venv_name} フォルダはそのまま残します")
 
 # logs フォルダの中身を削除するか確認(存在する場合のみ)
 logs_dir = server_dir / "logs"
 if logs_dir.exists():
 if ask_yes_no(" logs フォルダの中身をクリアしますか？", default="y"):
 if clean_directory_contents(logs_dir, "logs"):
 deleted_count += 1
 else:
 print_info(" logs フォルダはそのまま残します")
 
 # temp フォルダを削除するか確認(存在する場合のみ)
 temp_dir = server_dir / "temp"
 if temp_dir.exists():
 if ask_yes_no(" temp フォルダを削除しますか？", default="y"):
 if remove_directory(temp_dir, "temp"):
 deleted_count += 1
 else:
 print_info(" temp フォルダはそのまま残します")

 # SQLite データベースファイルの削除
 if DATABASE_TYPE.lower() == "sqlite":
 sqlite_db = base_dir / SQLITE_DB_REL_PATH
 if sqlite_db.exists():
 if ask_yes_no(" SQLite データベースを削除しますか？", default="n"):
 if remove_file(sqlite_db, "SQLite データベース"):
 deleted_count += 1
 else:
 print_info(" SQLite データベースはそのまま残します")
 
 if deleted_count > 0:
 print_success(f"バックエンドフォルダのクリーンアップ完了 ({deleted_count}個削除)")
 else:
 print_info("削除対象のフォルダはありませんでした")


def cleanup_client(base_dir):
 """フロントエンドフォルダをクリーンアップ
 
 Args:
 base_dir (Path): プロジェクトのルートディレクトリ
 """
 print_header("フロントエンドフォルダのクリーンアップ")
 
 client_dir = base_dir / FRONTEND_PATH

 if not client_dir.exists():
 print_warning("フロントエンドフォルダが見つかりません")
 return
 
 deleted_count = 0
 
 # フロントエンドアプリの node_modules フォルダを削除
 node_modules_dir = client_dir / "node_modules"
 if remove_directory(node_modules_dir, f"node_modules ({FRONTEND_PATH})"):
 deleted_count += 1

 # dist フォルダを削除
 dist_dir = client_dir / "dist"
 if remove_directory(dist_dir, "dist"):
 deleted_count += 1
 
 if deleted_count > 0:
 print_success(f"フロントエンドフォルダのクリーンアップ完了 ({deleted_count}個削除)")
 else:
 print_info("削除対象のフォルダはありませんでした")


def uninstall_global_npm_tools():
 """グローバルnpmパッケージをアンインストール"""
 print_header("グローバルnpmツールのアンインストール")

 # npmコマンドを取得（Windows対応）
 npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

 packages = [
 "@anthropic-ai/claude-code",
 "@github/copilot",
 "@openai/codex",
 "opencode-ai",
 ]

 uninstalled_count = 0
 for i, package in enumerate(packages, 1):
 if ask_yes_no(f" [{i}/{len(packages)}] {package} をアンインストールしますか？", default="n"):
 cmd = [npm_cmd, "uninstall", "-g", package]
 print_info(f"実行中: {' '.join(cmd)}")
 try:
 subprocess.run(cmd, check=True, capture_output=False, text=True)
 print_success(f" {package} をアンインストールしました")
 uninstalled_count += 1
 except subprocess.CalledProcessError as e:
 print_error(f" {package} のアンインストールに失敗しました: {e}")
 except FileNotFoundError:
 print_error(f" {npm_cmd} が見つかりません。Node.jsがインストールされているか確認してください")
 break
 else:
 print_info(f" {package} はそのまま残します")

 if uninstalled_count > 0:
 print_success(f"グローバルnpmツールのアンインストール完了 ({uninstalled_count}個削除)")
 else:
 print_info("アンインストール対象はありませんでした")


def main():
 """メイン処理"""
 global AUTO_MODE

 print_header("プロジェクト クリーンアップ")
 
 # プロジェクトのルートディレクトリ
 base_dir = Path(__file__).parent
 
 print_info(f"プロジェクトディレクトリ: {base_dir}")
 print()
 
 # クリーンアップ実行の確認
 run_cleanup, AUTO_MODE = ask_start_mode("フォルダをクリーンアップしますか？", default="n")
 if not run_cleanup:
 print_info("クリーンアップをキャンセルしました")
 return

 if AUTO_MODE:
 print_info("AUTOモードで実行します。以降の質問はデフォルト値で自動回答します。")

 # グローバルnpmツールのアンインストール
 if ask_yes_no("グローバルnpmツール(AI CLIツール)をアンインストールしますか？", default="n"):
 uninstall_global_npm_tools()
 else:
 print_info("グローバルnpmツールのアンインストールをスキップしました")

 # .aidiy_backup フォルダの削除確認（先に実施）
 backup_dir = base_dir / ".aidiy_backup"
 if backup_dir.exists():
 if ask_yes_no(".aidiy_backup フォルダを削除しますか？", default="y"):
 remove_directory(backup_dir, ".aidiy_backup")
 else:
 print_info(".aidiy_backup フォルダはそのまま残します")
 
 # バックエンドフォルダのクリーンアップ
 if ask_yes_no("バックエンドをクリーンアップしますか？", default="y"):
 cleanup_server(base_dir)
 else:
 print_info("バックエンドのクリーンアップをスキップしました")
 
 print()
 
 # フロントエンドフォルダのクリーンアップ
 if ask_yes_no("フロントエンドをクリーンアップしますか？", default="y"):
 cleanup_client(base_dir)
 else:
 print_info("フロントエンドのクリーンアップをスキップしました")

 print()
 print_header("クリーンアップ完了")
 print_success("プロジェクトのクリーンアップが完了しました")
 print_info("他の担当者にプロジェクトを渡す準備ができました")
 print_info("クリーンアップは正常終了しました。5秒後に終了します...")
 time.sleep(5)


if __name__ == "__main__":
 try:
 main()
 except KeyboardInterrupt:
 print()
 print_warning("クリーンアップが中断されました")
 sys.exit(1)
 except Exception as e:
 print_error(f"予期しないエラーが発生しました: {e}")
 sys.exit(1)
