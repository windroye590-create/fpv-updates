"""Compatibility entry point for the current Windows protocol-2 storage suite.

Usage remains: python windows-storage.py EXE [REPORT_JSON].
The protocol-1 routes and state.bin file are no longer used by the native host.
"""
from pathlib import Path
import runpy


if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('windows-private-storage.py')),
                   run_name='__main__')
