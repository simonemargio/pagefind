#!/usr/bin/env bash
set -eu
cd wrappers/python
python3 -m uv sync --no-root
export VIRTUAL_ENV=$PWD/.venv
# echo "VIRTUAL_ENV=$VIRTUAL_ENV" >> "$GITHUB_ENV"
# echo "PATH=$VIRTUAL_ENV/bin:$PATH" >> "$GITHUB_ENV"
