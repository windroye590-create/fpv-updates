"""Independent ZIP/XML and openpyxl verification of the actual downloaded bytes."""
import datetime
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET
from openpyxl import load_workbook

path=Path(sys.argv[1])
with zipfile.ZipFile(path) as archive:
    assert archive.testzip() is None
    assert not any('..' in n or n.startswith('/') for n in archive.namelist())
    for name in archive.namelist():
        if name.endswith(('.xml','.rels')):ET.fromstring(archive.read(name))
    assert not any('vba' in n.lower() or 'externalLink' in n for n in archive.namelist())
w=load_workbook(path,data_only=False)
assert w.sheetnames==['Результати','Відомість групи','Зведення']
s=w['Результати']
assert s.freeze_panes=='C4' and s.auto_filter.ref=='A3:O7'
rows={s.cell(i,14).value:i for i in range(4,s.max_row+1)}
assert s.cell(rows['r1'],6).value==.8 and s.cell(rows['r1'],6).number_format=='0%'
assert s.cell(rows['r3'],6).value==0
assert s.cell(rows['r2'],6).value is None
assert s.cell(rows['r2'],5).value=='Очікує перевірки'
assert s.cell(rows['r1'],4).value==datetime.datetime(2026,11,8,15,34)
assert s.cell(rows['r1'],9).value==datetime.timedelta(seconds=3661)
assert s.cell(rows['r3'],1).value=='=1+1' and s.cell(rows['r3'],1).data_type=='s'
assert all(c.data_type!='f' for sheet in w for row in sheet for c in row)
assert s.column_dimensions['M'].hidden and s.column_dimensions['N'].hidden
assert w['Відомість групи'].freeze_panes=='D4'
assert s.cell(3,1).font.bold and s.cell(3,1).fill.fgColor.rgb=='FF17365D'
assert s.cell(rows['r2'],5).fill.fgColor.rgb=='FFFFF4D6'
print('Valid Excel workbook: typed dates, durations, grades, literal text and three sheets')
