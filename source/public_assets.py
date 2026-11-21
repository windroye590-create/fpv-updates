"""The currently shipped app omits the paused materials reader.

Source files and backend records remain available for a future reactivation.
PDF statement export uses jsPDF and is independent of this reader.
"""
from pathlib import PurePosixPath

def included(relative):
    name = PurePosixPath(relative).as_posix()
    return (not any(part.startswith('.') for part in PurePosixPath(name).parts)
            and name not in {'materials.js', 'learning.js'}
            and not name.startswith('vendor/pdfjs/'))
