"""在独立 Python 获取进程中调用官方 ARC SDK，发布前只输出精确 Game 文件。"""

from __future__ import annotations

import argparse
import importlib
import logging
import os
import shutil
import sys
import tempfile
from contextlib import chdir
from pathlib import Path


def fetch(game_id: str, destination: Path) -> None:
    """使用官方 SDK 的 make 下载指定版本；绝不接受 base ID 的替代版本。"""
    api_key = os.environ.get("ARC_API_KEY", "")
    with tempfile.TemporaryDirectory(prefix="pi-arc-catalog-") as temporary:
        root = Path(temporary)
        # arc-agi 0.9.9 在 import 时读取 cwd 的 .env/.env.example；独立获取进程
        # 必须在空临时目录 import，不能意外拾取宿主凭据。
        logger = logging.Logger("pi-arc-catalog")
        # NORMAL + 空 key 会请求匿名 key，SDK 会在 info 日志输出该 key。
        # NullHandler 不能阻止向 root logger 传播，因此禁用这个专用实例。
        logger.disabled = True
        with chdir(root):
            sdk = importlib.import_module("arc_agi")
            arcade = sdk.Arcade(
                arc_api_key=api_key,
                operation_mode=sdk.OperationMode.NORMAL,
                environments_dir=str(root / "environment_files"),
                recordings_dir=str(root / "recordings"),
                logger=logger,
            )
            # 使用公开 NORMAL 路径：未提供 key 时由 SDK 获取匿名 key；显式 key
            # 或匿名获取失败均直接失败，不切换身份重试。make 会执行官方 Game。
            wrapper = arcade.make(game_id, seed=42, save_recording=False)
        if wrapper is None or wrapper.environment_info.game_id != game_id:
            raise ValueError("official catalog did not return the exact Game ID")
        source = Path(wrapper.environment_info.local_dir or "")
        if not source.is_dir() or not (source / "metadata.json").is_file():
            raise ValueError("official SDK produced no complete Environment")
        if any(destination.iterdir()):
            raise ValueError("staging destination must be empty")
        for entry in source.iterdir():
            if entry.is_file():
                shutil.copy2(entry, destination / entry.name)
            elif entry.is_dir():
                shutil.copytree(entry, destination / entry.name)


def main() -> int:
    """仅使用 argv 传递非秘密路径和 Game ID；凭据只经环境变量进入获取进程。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        fetch(args.game_id, args.destination)
    except Exception as error:
        print(f"catalog fetch rejected: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
