#!/usr/bin/env python3
"""Métriques de mise en page d'un PDF (sans le regarder) :
- remplissage de chaque page (bas du dernier texte, hors en-tête / pied) ;
- titres isolés en bas de page (ligne en gros corps suivie de peu de texte) ;
- répartition des corps de texte (hauteur des lignes ≈ corps × 1,2).
Usage : pdf-metrics.py fichier.pdf
"""
import re, subprocess, sys, xml.etree.ElementTree as ET
from collections import Counter

pdf = sys.argv[1]
xhtml = subprocess.run(['pdftotext', '-bbox-layout', pdf, '-'], capture_output=True, text=True).stdout
xhtml = re.sub(r'<!DOCTYPE[^>]*>', '', xhtml).replace('xmlns="http://www.w3.org/1999/xhtml"', '')
root = ET.fromstring(xhtml)
pages = root.findall('.//page')
MM = 72 / 25.4
report_fill, orphans, sizes = [], [], Counter()
for i, pg in enumerate(pages, 1):
    H = float(pg.get('height'))
    top_band, bottom_band = 32, H - 30  # en-tête et pied de page (≈ 11 mm)
    lines = []
    for ln in pg.iter('line'):
        y0, y1 = float(ln.get('yMin')), float(ln.get('yMax'))
        if y0 < top_band or y1 > bottom_band:
            continue
        txt = ' '.join(w.text or '' for w in ln.iter('word')).strip()
        if not txt:
            continue
        h = y1 - y0
        lines.append((y0, y1, h, txt))
        sizes[round(h / 1.2 * 2) / 2] += len(txt)
    if not lines:
        report_fill.append((i, 0.0, ''))
        continue
    content_h = bottom_band - top_band
    last = max(l[1] for l in lines)
    fill = (last - top_band) / content_h
    first_txt = sorted(lines)[0][3][:50]
    report_fill.append((i, fill, first_txt))
    # Titre isolé : ligne de gros corps (≥ 11 pt) dans le dernier cinquième
    # de la page, suivie de moins de 3 lignes.
    for (y0, y1, h, txt) in lines:
        if h / 1.2 >= 10.5 and y0 > top_band + 0.80 * content_h:
            after = [l for l in lines if l[0] > y1 + 1]
            if len(after) < 3:
                orphans.append((i, round(h / 1.2, 1), txt[:60], len(after)))

print(f'{pdf.split("/")[-1]} : {len(pages)} pages')
low = [(i, f, t) for (i, f, t) in report_fill if f < 0.45]
print(f'Pages remplies à moins de 45 % ({len(low)}) :')
for i, f, t in low:
    print(f'  p.{i:>2} {f*100:4.0f} %  « {t} »')
print(f'Titres possiblement isolés en bas de page ({len(orphans)}) :')
for i, s, t, n in orphans:
    print(f'  p.{i:>2} corps≈{s} pt « {t} » ({n} ligne(s) après)')
tot = sum(sizes.values())
print('Répartition du texte par corps estimé (pt, % des caractères) :')
for s in sorted(sizes):
    pct = sizes[s] * 100 / tot
    if pct >= 0.5:
        print(f'  {s:>5} pt : {pct:4.1f} %')
