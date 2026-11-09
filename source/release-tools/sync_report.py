"""Embed the browser's report model in the single deployed Apps Script file."""
import argparse
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
START='// BEGIN GENERATED EXCEL REPORT'
END='// END GENERATED EXCEL REPORT'

def expected():
    source=(ROOT/'web/excel-report.js').read_text()
    source=re.sub(r'^export ', '', source, flags=re.M)
    return START+'\nvar LKReport_=(function(){\n'+source+'\nreturn {reportModel:reportModel,xlsxParts:xlsxParts,reportFilename:reportFilename};\n})();\n'+END

def sync(check=False):
    path=ROOT/'Code.gs';source=path.read_text();generated=expected()
    if START in source or END in source:
        if source.count(START)!=1 or source.count(END)!=1:raise ValueError('Ambiguous report markers')
        updated=source[:source.index(START)]+generated+source[source.index(END)+len(END):]
    else:updated=source.rstrip()+'\n\n'+generated+'\n'
    if check:
        if updated!=source:raise SystemExit('Run python3 release-tools/sync_report.py before release')
    elif updated!=source:path.write_text(updated)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');sync(parser.parse_args().check)
